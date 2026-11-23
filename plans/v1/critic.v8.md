# Critic v8 — Design Editor — v1 plan

**Plan reviewed:** plan.md
**Date:** 2026-11-23
**Score:** 7/10 — the approach is right and its claims about the Design format check out against the live type, but the push protocol has one real timing hole, its logic has no tested home, and the `.editor/` folder breaks the "clean tree" checks the plan depends on.

---

## TL;DR for Ron

This is a careful, well-researched plan. The editor is built on the Design canvas format, and the claims it relies on hold up against the Design type itself (release `1795227355-bde3`). Inline `style` is what the panel edits. The panel already edits flex and grid. The Theme menu reads `project/ds/<folder>/tokens.json`. Elements are addressed by `tid:path`. Canvas content may only run in a sandbox. The biggest strength is the order of work: a kill bar and a two-hour gate come before any code, and every fallback is decided in advance. The biggest risk is in `/design-push`. Its 120-second lease cannot be renewed while Claude Code waits for you to approve the publish, so the editor can unlock in the middle of a push, and a push that has already published can then abort without recording the sync. Three cheap fixes also need to land before M1:
- put push's merge-and-commit logic in a tested script instead of skill prose;
- tell git to ignore all of `.editor/`, not just the cache;
- move the plain-HTML fallback out of the main Architecture text, where it contradicts the canvas rules.

Ship after fixing those four majors. None of them needs another full review.

---

## Strengths

- **The format claims are right.** I read the Design type's `SKILL.md`, `reference/format.md` and `reference/view-state.md` (release `1795227355-bde3`). Each claim the plan makes about them holds:
  - inline `style` is "what the properties panel edits";
  - the panel edits flex and grid, and offers Wrap in flex / Wrap in grid;
  - board `guides` exist;
  - the Theme menu needs `project/ds/<folder>/tokens.json` and a `designSystems` record;
  - element addressing is depth-first `tid` plus a child-index `path` inside `<x-dc>`;
  - `<sc-for>` repeats share one template node;
  - canvas content is "untrusted cross-user input" that runs only in a sandboxed frame.
  The plan's §"Why not just use Claude Design's own canvas editor?" therefore starts from a correct picture of what already exists.
- **Kill bar and gate (§Goals, §M0).** Go/no-go criteria are fixed before the spike, and a two-hour gate covers the three checks that could sink the project: the runtime runs locally, `data-ed-id` survives template expansion, and publish/read round-trips are byte-exact. Running the cheap, fatal checks first is the right order.
- **Snapshot undo instead of inverse ops (§Undo).** Undo restores the file's pre-write text together with its stored id map. That makes byte-identical undo true by construction and removes a whole class of per-op inverse bugs.
- **Security layout (§Scripts and trust).** The project runs on a second origin and port, in an opaque sandbox with no `allow-same-origin`. `frame-ancestors` is pinned to the editor. Host and Origin are checked against exact lists. The token never reaches `/project/*`, and the 5301 listener is GET/HEAD only. This is a sound boundary for running canvas scripts.
- **Push classification (§/design-push step 3).** It uses Unison's two-replica model: a change on one side moves across, and only a change on both sides is a conflict. Push takes `canvas.json` from the remote as is, and refuses local artboard adds and removes. These choices remove the hardest merge cases instead of solving them badly.
- **Every M0 answer has a fallback fixed in advance (§M0 Exit).** For example, if ids are stripped, the fallback uses the type's own `tid:path` addressing, which is verified to exist.
- **"Preview = disk" is a test, not a hope (§Testing).** Each e2e op is compared with a fresh load of the written file.

## Concerns

### [major] Push's lease cannot be renewed while it waits on a publish approval  — §Pull / push (/design-push step 1, step 5)
**In plain words:** Push holds a "do not touch" sign on the project that expires after two minutes unless push keeps renewing it. Push can only renew it between steps. When Claude Code stops to ask you "allow this publish?", nothing runs. If you take longer than two minutes, the sign expires, the editor unlocks and you can keep editing, and then push finishes the publish and stops at the end with an "aborted" message even though it already sent your files.
**What:** Step 1 says push "rewrites `expiresAt` at the start of every step (including while it waits on a publish approval)". The second half of that sentence cannot happen. The approval prompt blocks the model, so no shell command runs while it is open. The re-check happens "before the publish", and the approval sits on the publish call itself, so a lease that lapses during the approval goes unnoticed until the step-5 check. That check then aborts after a successful publish. The remote now holds the sent bytes, but the synced commit and `base.json` do not record them. The next push sees "changed on both sides" and has to three-way merge your own bytes against themselves. That usually merges cleanly, but it is a needless merge path. Meanwhile the editor, seeing an expired lease, "unlocks when … its `expiresAt` has passed" and resumes writing while push is still running. That breaks the invariant "it never pushes around a live editor". The plan's reason for having no process-based liveness ("no PID recorded by push would outlive it") is also not quite true: Claude Code can run a background command that outlives a single step.
**Why it matters:** This is the one path where a normal human pause (reading the approval prompt) turns a correct push into a reported failure, and an unlocked editor into a concurrent writer. It will happen on the first slow approval.
**Best-practice options:**
1. **Build the synced commit from the bytes that were sent, not from the working tree, so a lapsed lease after the publish is harmless.** *In plain words: once the remote has accepted the files, always record exactly those files as "both sides agree", whatever the editor did meanwhile.* Step 3 already keeps the bytes it read. Step 5 writes them to the index with `git hash-object -w` and `git update-index --cacheinfo`, then commits that tree and writes `base.json` from those hashes. It leaves the working tree alone, so any edit made after the lease lapsed simply shows up as a local change for the next push. Also re-check the lock before the step-3 and step-4 working-tree writes, not only before the publish. This is the content version of a fencing check: whoever writes the record checks it against what was actually sent, instead of trusting that the lease held. Kleppmann's point is that a lease holder can pause past expiry without noticing, so the protected write must carry its own check. Cost: about an hour. I'd pick this because it makes the lease a convenience instead of a correctness requirement. (Kleppmann, "How to do distributed locking", https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
2. Add a background heartbeat. *In plain words: a small helper process keeps renewing the sign until push is finished.* Push starts a `run_in_background` loop that rewrites `expiresAt` every 20–30 s, well under the TTL, and records its PID in the lock. The editor treats the lock as live while that PID is alive. Push kills the loop when it finishes or aborts. If the Claude Code session dies, the loop dies and the lease lapses normally. This is the standard lease plus heartbeat pattern. Cost: one more process to manage. Use it with option 1, not instead of it. (Unmesh Joshi, "Lease", Patterns of Distributed Systems, https://www.martinfowler.com/articles/patterns-of-distributed-systems/lease.html)
3. Use a long lease and never unlock silently. *In plain words: make the sign last 15 minutes, and when it expires, ask instead of unlocking.* On expiry the editor shows "push may still be running in Claude Code — unlock anyway?". This is the simplest option, but on its own it still leaves the abort-after-publish case.

### [major] Push and pull logic has no home in code and no automated tests  — §Pull / push, §Testing
**In plain words:** The most dangerous part of the system, the code that decides what gets uploaded, merged or overwritten, is described as steps Claude follows from a skill file. Nothing says it is a program, and nothing tests it. An AI following a ten-step recipe by hand will eventually skip or reorder a step.
**What:** §Pull / push specifies a lock handshake, per-file three-way classification (hashes of local, remote and recorded), `git merge-file` with exit-code handling, a parse5 shape check on merged files, remote-only writes with blob downloads, and a synced commit plus `base.json` rewrite. Every step is deterministic except the Artifact tool calls. Yet the plan only says the work is done by "two project skills". §Testing covers the editor core (golden corpus, unit tests, Playwright) and has no test for classification, merge outcomes, conflict reporting or the dirty-tree refusal. The only check is the M6 manual loop on a throwaway canvas.
**Why it matters:** A misclassification here silently overwrites work on one side or the other. That is exactly what Goal 3 forbids, and it is the case the M6 manual loop is least likely to hit.
**Best-practice options:**
1. **Write a `design-sync` Node CLI in the repo with subcommands (`lock`, `classify`, `merge`, `check`, `commit`, `unlock`) and unit-test it with vitest against throwaway git repos; the skill only makes the Artifact tool calls and runs the CLI.** *In plain words: turn the recipe into a program, test the program, and have Claude just press its buttons.* `classify` prints a JSON plan (upload / write-remote / merge / conflict / stop), and the skill shows or applies it. This is the "plan-validate-execute" pattern and the low-freedom guidance in Anthropic's skill best practices, which say to prefer scripts for deterministic operations because they are more reliable than generated steps. Cost: about one day, which mostly moves effort out of M6 rather than adding to it. Add test cases for: one-sided change on each side, both-sided clean merge, both-sided conflict, edit vs remove, local artboard add (stop), remote artboard add (write + blob fetch), dirty-tree pull refusal, and two pushes in a row. (Anthropic, "Skill authoring best practices" — "Set appropriate degrees of freedom", "Provide utility scripts", "Create verifiable intermediate outputs", https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
2. Keep the skill as prose and add three skill evaluations, as the same guide recommends. This is cheaper, but it tests the model's obedience, not the logic, and it stays non-deterministic.

### [major] `.editor/` working files are not git-ignored, so the "clean tree" checks break  — §Pull / push (/design-pull refresh), §Architecture (Editor-only state), Goal 2
**In plain words:** The editor keeps its own notes (zoom, hidden layers, lock files, sync hashes) in a `.editor/` folder inside each project's git repo. The plan only tells git to ignore the cache subfolder. After any editor session git therefore sees new or changed files, decides the project is "dirty", and refuses to pull, even if you changed nothing.
**What:** The only ignore rule stated is "`.editor/cache/` is git-ignored". `.editor/state.json` (hide, lock, collapse, zoom), `.editor/server.json`, `.editor/push.lock`, `.editor/push.ready` and `.editor/base.json` all live in the same tree. Pull defines dirty as "`git status` not clean". Goal 2 says "an unchanged session gives a zero-byte diff", and step 5 "commits the synced state". Without an ignore rule, a zoom change makes pull refuse, and a broad `git add` in step 5 commits lock and state files. A committed `.gitignore` in the project root would itself be a non-artboard file in the project folder, and the plan does not say how push classifies it.
**Why it matters:** The refresh path ("pull refuses and says to run `/design-push` first") would fire after almost every editing session. That would train you to push just to pull, which defeats the point of the check.
**Best-practice options:**
1. **At `git init` (pull step 2), write `.editor/` into `.git/info/exclude`.** *In plain words: tell this one repo, privately, to never look at the editor's folder.* The git docs describe `info/exclude` as the place for repo-specific patterns that belong to one user's workflow and should not be shared. It lives outside the working tree, so it is never a project file, never classified and never pushed. Decide separately whether `base.json` should be tracked. Its hashes are the synced commit's hashes, so it can be ignored too. Cost: one line. (git, "gitignore — Specifies intentionally untracked files to ignore", https://git-scm.com/docs/gitignore)
2. Move editor state outside the project repo, for example to `projects/.editor/<slug>/`. This is clean, but the watcher and the skills then need a second path.
3. Use a committed `.gitignore`. This is standard for build output, but here it puts an extra file in the canvas folder that the push classifier must special-case.

### [major] The plain-HTML fallback is spread through the core Architecture, and the general text contradicts the canvas rules  — §Architecture, §M2
**In plain words:** The plan describes two editors at once: the canvas editor it will actually build, and a plain-HTML editor it builds only if M0 finds an unexpected format. The plain-HTML design is written into the main text as if it were the default, with canvas exceptions added afterwards. Several sentences now say the opposite of the canvas rules, and an implementer following the plan literally would build the wrong thing first.
**What:** Examples:
- §Edit op says "The UI applies the op to the live iframe DOM/CSSOM at once (<100 ms)", but on a canvas structural ops are never applied live: the file is written and the frame reloads.
- §Writer says "on mismatch nothing is written, the live DOM change is reverted". On a canvas there is no live structural change to revert.
- §Scripts and trust still says "when scripts are on" and "hold only when scripts are off", but scripts now always run: the trust mark was removed, so the scripts-off case no longer exists in v1.
- §Write target policy (three steps, `SharedCounter`, inline `!important` override) and the browser cascade resolver take about 40 lines of Architecture, yet §M0 Exit says they are "plain-HTML fallback only".
- The CSP and connect-src design, the `@layer`/`@container` targeting rules and the "affects N elements" counting all serve that inactive branch.
The plan is about 630 lines, and many of its "(decided: …)" notes qualify an earlier sentence instead of replacing it.
**Why it matters:** Ron's `/deep-implement` agents read the plan literally. A contradiction between a general statement and a later exception is how an agent ends up building live structural apply, or the cascade resolver, in M1 or M2. Martin Fowler calls the cost of keeping a presumptive feature around the cost of carry: it makes everything else built alongside it harder to change and debug.
**Best-practice options:**
1. **Rewrite §Architecture for the canvas branch only, and move everything plain-HTML-only into an appendix headed "Plain-HTML branch — inactive unless M0 selects it".** *In plain words: one clear description of what will be built, plus a separate drawer for the backup plan.* The appendix holds the cascade resolver, `RuleLocator`, `SharedCounter`, the three-step target policy, the `!important` rule, live structural apply and the plain-HTML test cases. Fold each "(decided: …)" note into the sentence it amends, so every rule is stated once. Cost: about two hours of editing and no design change. (Martin Fowler, "Yagni", https://martinfowler.com/bliki/Yagni.html)
2. Delete the plain-HTML design and re-plan if M0 picks that branch, as the plan already does for "Anything else". This is leaner, but it throws away researched work that would be needed if Test Site turns out to be plain HTML.

### [minor] M2 packs the write-back engine and the whole editable panel into 1½ days  — §M2, §Effort
**In plain words:** The milestone the plan calls "the riskiest part" is also given the most work for the least time.
**What:** M2 contains:
- the PatchEngine for four op kinds, plus the Writer (debounce, splice, re-parse, shape check, atomic write, id carry-over, ack-vs-live) and the Watcher;
- snapshot undo;
- the golden corpus and its tests;
- the whole editable properties panel: number inputs with unit preservation, a colour picker with alpha, opacity, radius, border, a shadow list and typography;
- plain-text in-place editing with `{{` refusal and entity-preserving splices.
All of that is estimated at 1½ days. By comparison, M1, which is read-only, gets 2–3 days. The cut rule protects M2 by cutting M5's layer actions, but the overrun risk is inside M2 itself. The plan does say estimates are re-made after M0.
**Why it matters:** If M2 is squeezed, its golden-test quality bar is the first thing to give, and that quality bar is the whole point of the project.
**Best-practice options:** This is a local planning issue, so no external pattern applies.
1. **Split it into M2a (PatchEngine, Writer, Watcher, UndoLog, golden tests, exit: zero-byte and one-line diffs) and M2b (the editable panel controls and text editing), and estimate them separately, for example 1½ + 1½ days.** *In plain words: finish and prove the engine before building the controls that drive it.*
2. Keep M2 as written and move the shadow list and typography panels to M5. This is smaller, but it keeps text editing, the riskiest part of the UI, inside the core milestone.

### [minor] The page's own scripts can forge probe messages, and a text commit writes to disk  — §Scripts and trust, §M2 (text editing)
**In plain words:** The editor trusts a message because it came from the preview frame. Any script on the canvas runs in that same frame, so it can send the same messages. One of those messages, "the user finished editing this text", makes the editor write to your files.
**What:** The editor accepts a message when `e.source === iframe.contentWindow` and `e.origin === 'null'`. The probe shares its JavaScript realm with the project scripts, so a project script can post probe-shaped messages that pass both checks. The sandbox flag also stays on the frame across navigation, so any page loaded into it reports `'null'` as well. Most probe traffic is read-only overlay data, where a forged message only draws a wrong outline. But the text editor is an in-frame `contenteditable`, so its committed text must come from the frame. A forged commit becomes a `setText` and a disk write that you never asked for. The schema check rejects malformed messages, not unrequested ones. The risk is low, because v1 edits Ron's own canvases, but those canvases can include other people's hand edits made in Claude Design.
**Why it matters:** The plan argues that the sandbox "is the security boundary". The postMessage channel is a write path across that boundary, and the plan does not say how it is guarded.
**Best-practice options:**
1. **Accept write-carrying messages only while the editor is in the matching state: a text commit is taken once, for the `edId` the editor itself opened through a double-click on its event shield, while that edit session is open; everything else from the frame is treated as untrusted read data.** *In plain words: only listen for "here is the new text" right after you asked for it, and only for that element.* MDN says to verify the sender and also "always verify the syntax of the received message". Checking the state goes one step further. Cost: about an hour. (MDN, "Window: postMessage() — Security concerns", https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
2. Edit text in an input field on the editor's side, laid over the element. This removes the write path entirely, but the text no longer edits in place with the page's own font and wrapping, so it feels less like Figma.

### [minor] The serving transform will also rewrite `.dc.html` files the runtime fetches for `<dc-import>`  — §Sandboxed iframe / Scripts and trust
**In plain words:** The server changes every page it serves: it adds ids and the probe script. When a canvas pulls in a child artboard through `<dc-import>`, the runtime may download that child file as data. The child would then arrive with the editor's additions in it, which could confuse the runtime or run a second probe.
**What:** `<dc-import name="Card">` mounts the sibling `Card.dc.html`, and its `<helmet>` reruns in importers (format.md, SKILL.md). The plan's transform injects `data-ed-id` everywhere, plus a nonce'd probe `<script>`, and strips existing `nonce` attributes, all "on each page", with no distinction between a frame navigation and a runtime `fetch`. The plan's own CSP `connect-src` explicitly allows those fetches. M0 does not check how the runtime loads children.
**Why it matters:** At best it causes stray ids on read-only children. At worst the runtime fails on imports, and the gate passes on a canvas with no `<dc-import>` before Test Site breaks in M1.
**Best-practice options:**
1. **Transform only responses whose `Sec-Fetch-Dest` is `iframe` (the editor's frame load), serve raw bytes for `empty` (a `fetch`), and add "how does the runtime load a `<dc-import>` child" to the M0 checks.** *In plain words: rewrite the page the editor shows, and hand anything the page downloads for itself through untouched.* `Sec-Fetch-Dest` is set by the browser and cannot be forged by page scripts. (MDN, "Sec-Fetch-Dest", https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Dest)
2. Mark the frame's own URL with a query flag (`?ed=1`) and transform only requests that carry it. Relative fetches by the runtime won't carry it. This works in every browser without depending on Fetch Metadata support.

### [nit] Carrying ids through a move is described as shifting offsets, which doesn't fit a moved node  — §Writer
**In plain words:** The rule for keeping an element's id after an edit assumes the element stays roughly where it was in the file. A moved element jumps somewhere else.
**What:** "The PatchEngine shifts each id's start offset by the splice deltas it applied". That works for nodes around an insertion. It does not work for the node `moveNode` relocates, or for its descendants, whose new offset is the destination plus their offset inside the moved block. State that rule, and add a golden test that moves a node with children and then edits a child.
**Best-practice options:** This is local and no external pattern applies. Compute moved-subtree ids as destination offset plus relative offset, and pin it with the M5 golden sequence extended to include a child edit.

### [nit] "Works without a network" overlooks Google Fonts links  — §/design-pull step 3
**In plain words:** Canvases are allowed to load fonts from Google, and those are not saved at pull time, so offline the text renders in a fallback font.
**What:** The Design format allows "a Google Fonts `css2` `<link>` in `<helmet>`". Pull caches `/_blob` assets and `support.js`, but not those fonts. Either cache them as well, rewriting the URLs only in the served copy, or state that offline previews use fallback fonts.
**Best-practice options:** This is local. **State the limitation in v1.** Caching would mean rewriting URLs in the served copy, which is more serving-layer surface for little gain.

### [nit] Version history is described two ways  — §Goals
**In plain words:** One paragraph says Claude Design has whole-page version history. A few lines later the plan says the built-in editor has "no version history".
**What:** Lines 28–31 rely on "Artifact version history covers whole-page rollback", while line 43 says the built-in editor is documented to have "no version history". Both can be true: Artifact versions exist, but the canvas UI may not show them. Say which, since M0 records it anyway.
**Best-practice options:** This is local. Reword it as "Artifact versions exist at the platform level; the canvas UI is not documented to show them (M0 confirms)."

---

## Decisions Ron needs to make

1. **How push survives a slow publish approval** — Options: (a) build the synced commit from the sent bytes, so a lapsed lease after the publish is harmless, plus a background heartbeat; (b) a 15-minute lease, with the editor asking before it unlocks on expiry; (c) keep the 120 s lease as written. Tradeoff: (a) costs about an hour plus one helper process and closes the hole; (b) is simpler but still aborts after a successful publish. Recommendation: (a).
2. **Where the push and pull logic lives** — Options: (a) a tested `design-sync` CLI that the skills call; (b) step-by-step prose in the skills, plus skill evals. Tradeoff: (a) costs about one day, mostly moved out of M6, and is deterministic and testable; (b) is faster to write but untestable and drifts between runs. Recommendation: (a).
3. **How `.editor/` is kept out of git** — Options: (a) `.git/info/exclude` written at pull; (b) move editor state to `projects/.editor/<slug>/`; (c) a committed `.gitignore`. Also decide whether `base.json` is tracked. Recommendation: (a), with `base.json` ignored, since the synced commit already holds the same hashes.
4. **What to do with the plain-HTML branch text** — Options: (a) move it to an appendix and rewrite Architecture for canvases only; (b) delete it and re-plan if M0 picks plain HTML. Recommendation: (a).
5. **Splitting M2** — Options: (a) M2a engine plus golden tests, then M2b panel controls plus text editing, estimated separately; (b) keep M2 whole and move the shadow and typography panels to M5. Recommendation: (a).
6. **Text-editing surface (hidden decision)** — Options: (a) in-frame `contenteditable`, as planned, with state-gated acceptance of commits; (b) an input field on the editor's side laid over the element. Tradeoff: (a) keeps true in-place rendering; (b) removes the write path from the frame. Recommendation: (a).
7. **Offline fonts (hidden decision)** — Options: (a) state that offline previews use fallback fonts; (b) cache Google Fonts at pull and rewrite them in the served copy. Recommendation: (a) for v1.

---

## Verdict

**Ship after addressing blockers.** There are no blockers. Treat the four majors as must-fix before M1: the push lease and synced-commit rule, the tested sync CLI, the `.editor/` ignore rule, and the canvas-only Architecture rewrite. None of them changes the design, and all four together come to about two days of work.
