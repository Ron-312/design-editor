# Critic v1 — Design Editor — v1 plan

**Plan reviewed:** plan.md
**Date:** 2026-11-23
**Score:** 5/10 — the write-back core is well researched and correctly ordered, but the sync side rests on remote formats and APIs that the tool docs already contradict, and several core mechanisms (id stability, cascade, merge, local security) are not specified.

---

## TL;DR for Ron

The editing half of this plan is good: source-first mapping, tiny splices, a zero-byte-diff test bar, and building write-back (M2) before the fancy canvas work are all the right calls. The biggest risk is the other half. The plan assumes a Claude Design project is a folder of plain HTML/CSS that two Claude tools can pull and push, and the tools' own docs say otherwise. Designs are made from a fixed "Design" Artifact type that holds your content as data. The design-system tool (`DesignSync`) is scoped to the `/design-sync` skill and belongs to standalone Claude Design, which closes on 2026-12-14, about when M6 would land. Inside the editor, element ids that survive edits, where the cascade is computed, how push merges work and how the localhost server is locked down are all left open. Revise before building: turn M0 into a real go/no-go gate with branches written in advance, drop or defer `DesignSync`, and pin down those four mechanisms. Then re-review.

---

## Strengths

- **Right risk ordering.** M2 (write-back) comes before direct manipulation and Auto Layout, and the Effort section says M5 gets cut before M2's quality bar slips. Most editor projects do this the other way round and regret it.
- **Testable definition of "done right".** The golden round-trip corpus, with "no-op → byte-identical" and "one op → snapshot diff → undo → byte-identical" (§Testing), is a strong, mechanical quality bar.
- **Source-first mapping with serve-time ids** (§Architecture) avoids the DevTools "DOM Tree != HTML" trap that R05 documents. Read-only handling of implicit and script-made nodes is honest.
- **Write target policy is explicit and visible** (selector chip with `file:line`, "affects N elements"). This targets the #1 complaint found in R05 (Webflow and GrapesJS shared-class leakage).
- **M0 spike exists**, and the Risks table names the right first risk (not plain HTML/CSS).
- **Non-goals are drawn tightly** (no JSX, grid, gradients or components in v1).

## Concerns

### [major] The design-system sync path targets a service that closes in three weeks, through a tool scoped to another skill  — §Pull / push, §M6, §Risks
**In plain words:** Half of the push/pull plan goes through a tool that is only meant to be used by one specific skill, and the service behind it shuts down on December 14. The 10–12 day schedule ends right around that date, so this path might work for a few days, or not at all.
**What:** The `DesignSync` tool description says to use it "only with the /design-sync skill, which the user starts", and that "Standalone Claude Design (claude.ai/design) closes by December 14, 2026". The plan has a custom `/design-push` skill call `list_files` / `get_file` / `finalize_plan` / `write_files` directly. The API also has no per-file version or compare-and-swap. `list_files` returns paths only, `updatedAt` exists only at project level (`list_projects`), and `get_file` is capped at 256 KiB. So "re-read the remote version" (push step 1) can only be a project-level timestamp or a content re-fetch, and there is a race between that check and `write_files`. The Risks row ("Build against projects that live in Claude; move any standalone projects first") already concedes the point but leaves the path in scope.
**Why it matters:** A day of M6 and part of M0 would go to a path that is out of policy for the tool and probably dead on arrival. Conflict detection on this path is weaker than the plan implies.
**Best-practice options:** (No external industry pattern applies; this is about the in-session tool contracts.)
- **Drop the design-system remote kind from v1. Support Artifact-backed designs only, and add one M0 question: "where do design-system projects live after 12-14, and with what API?"** Plain words: build only against the place designs will still live next month. Tradeoff: no design-system editing in v1, but nothing is lost that would survive the shutdown anyway. *Pick this: it removes a dying dependency and a policy conflict in one move.*
- Have `/design-push` call the existing `/design-sync` skill for design-system projects instead of calling `DesignSync` itself. Plain words: go through the front door the tool asks for. Tradeoff: it stays in policy, but it still dies on 12-14 and you inherit that skill's one-component-at-a-time flow.
- Keep both kinds, but date-gate the work: M6 ships the design-system path only if it is done before 2026-12-10. Tradeoff: likely wasted work.

### [major] "A Claude Design project is plain HTML/CSS" is contradicted by the Artifact docs, and M0 has no pre-planned branch for that  — §Pull / push, §M0, §Risks
**In plain words:** The whole editor assumes the design is a normal web page made of files. The Artifact tool's docs say designs are made from a ready-made "Design" template whose page is fixed and which stores your content as data. If that is true, you can't open the design as plain HTML, and 8–10 days of M1–M5 rest on a guess.
**What:** The Artifact tool docs say decks and designs are created "from a Slides or Design Artifact type", that "the type's page and files stay fixed", and that the content goes into "the type's own store, or Claude's data files published to that url". The docs also say "Only the page itself is wrapped in a document skeleton at publish time", so even a hand-written HTML artifact may not round-trip byte-for-byte (wrapper added on publish, and possibly returned on read). Assets live in an artifact asset store under absolute URLs, which a local `/project/*` server would have to rewrite or proxy. The M0 exit is only "the plan is updated if it is not plain HTML/CSS". There is no stated go/no-go and no alternative design.
**Why it matters:** This is the single assumption every later milestone depends on. If designs are typed and data-driven, the parse5/postcss SourceIndex has nothing to index. If publish adds a wrapper, Goal 2 (zero-byte diff) is unreachable without normalisation.
**Best-practice options:** (Local to these tools; no external pattern applies.)
- **Make M0 a hard gate with branches written now. A: the remote is plain HTML/CSS files, so proceed as planned. B: it is a typed Design artifact with data files, so stop and re-plan around editing only Claude's own data files with a locally rendered copy of the type page. C: anything else, so stop. M0 also checks whether `read` returns the skeleton-wrapped page, and how assets and relative paths resolve.** Plain words: decide in advance what each M0 answer means, so the spike leads to an action. Tradeoff: about an hour of writing now, and it prevents building M1 on sand. *Pick this.*
- Narrow v1 to "hand-written multi-file HTML artifacts published with `files`", which the plan controls end to end. Tradeoff: it may exclude the designs Ron actually makes in Claude Design.
- Run M0 before even finalising the stack (it may change parse5/postcss to a JSON data editor). Tradeoff: it delays everything by half a day, which is cheap.

### [major] Push merge is underspecified, diverges from the research, and is budgeted at a fraction of a day  — §Pull / push step 3, §M6
**In plain words:** "Merge automatically and only ask when both sides changed the same property of the same element" sounds simple, but it needs a merge that understands HTML and CSS, not lines of text. The plan doesn't say how to build that, and gives all of push/pull one day.
**What:** Step 3 says "three-way merge per file against the git baseline … asks only when the same element and property were changed on both sides". A git-style merge is line-based. It cannot tell "same element, same property", and it reports a conflict for unrelated edits on adjacent lines (for example two declarations on one minified line). R00 proposed a different approach ("replay the patch log on the remote text"), and the plan switches without saying so. Separately, "Its publish already refuses when a newer version exists, which gives conflict detection for free" overstates it: the Artifact tool refuses relative to what *this conversation* last read, and `/design-push` runs in a different session from the pull. So the refusal only guards the gap between push's own re-read and its publish. The `base.json` comparison does all the real work.
**Why it matters:** It could ship a merge that either asks too often (line conflicts) or silently splices badly (a semantic merge done quickly), on the one path whose goal is "never silently overwrite".
**Best-practice options:**
- **v1 uses `git merge-file` (base = pulled baseline, current = local, other = remote) with `--diff-algorithm=histogram`. Exit 0 = clean, push. Any conflict = stop and show the hunks, with no auto-resolution. Element/property-level merge moves to "Next".** Plain words: use git's proven text merge and stop safely on anything it can't settle. Tradeoff: sometimes asks when a smarter merge wouldn't, but it is never wrong silently, and it fits M6's one day. Source: git-merge-file(1), https://man.archlinux.org/man/git-merge-file.1.en.raw (exit status = number of conflicts; histogram "can help avoid mismerges"). *Pick this.*
- Persist the op log and replay it on the remote text (R00's idea). Ops must then be addressed by a stable source path (selector + structural path), not by serve-time `data-ed-id`. Plain words: redo your edits on top of their version. Tradeoff: it gives true property-level clash detection, but a replay target can vanish and it is several days of work.
- Refuse push whenever the remote changed: pull, rebase locally (same `git merge-file`), then push. Tradeoff: simplest, and an extra step for Ron.

### [major] Element ids are not specified to survive re-indexing or structural edits  — §Architecture (SourceIndex, Writer), §Undo, §M5
**In plain words:** Each element gets a hidden id so a click can be traced to its source. The plan never says whether that id stays the same after a file changes. If ids are just "the 37th element", moving or duplicating one renumbers everything after it, and selection, layers and undo start pointing at the wrong elements.
**What:** The Writer step "re-index that file" rebuilds the SourceIndex after each write. Nothing says how `edId`s are allocated (by position? by offset? a counter?) or carried across a re-index. Structural ops (`moveNode`, `wrapNode`, `duplicateNode`, `deleteNode`) are applied to the live DOM first, so the client and server must agree on ids for newly created nodes. Undo entries reference `target`, which goes stale if ids shift. A watcher-driven external edit re-indexes too.
**Why it matters:** Stale ids cause edits to land on the wrong element. That is the exact failure the whole architecture exists to prevent, and the golden tests (single op, then undo) won't catch it, because it shows up only after sequences of structural ops.
**Best-practice options:**
- **The server owns id allocation. The PatchEngine carries existing ids through every structural op (update the id → node map in place; never re-derive by position), allocates ids for new nodes, and returns them in the op ack. The client stamps them onto the optimistic DOM nodes. External edits remap ids by structural diff and drop only what can't be matched.** Plain words: ids are names the server hands out and keeps, never seat numbers. Tradeoff: more PatchEngine bookkeeping, and ids that stay stable for the whole session. Lovable describes the same goal with compile-time ids that "persist through visual changes": https://lovable.dev/en/blog/visual-edits. *Pick this.*
- After every structural write, reload the iframe from disk and remap selection by source path. Tradeoff: simple and always correct, but it flickers, loses scroll and script state, and undo still needs path-based targets.
- Add a multi-op golden sequence (move, duplicate, undo×2, then an edit) to M2/M5 exits, whichever option is chosen.

### [major] The localhost editor server can write to disk but has no origin or auth check, and project scripts run inside the editor's origin  — §Stack, §Architecture
**In plain words:** Any website you visit could quietly connect to the editor's local server and tell it to rewrite your files. A script inside a pulled design (possibly written by someone else) also runs with the same powers as the editor itself.
**What:** The server is "Node HTTP + `ws` WebSocket" on localhost:5300, and ws ops cause file writes. Browsers let any page open a WebSocket to localhost, and `ws` does not check `Origin` by default. The iframe is same-origin by design, so project scripts (which the plan shows, read-only) can reach `parent`, the editor's ws connection and its APIs.
**Why it matters:** Vite shipped exactly this flaw. Its WebSocket accepted connections from any origin, and the advisory notes it "applies to users that only run the Vite dev server on the local machine." Here the impact is worse, because this socket writes files.
**Best-practice options:**
- **Bind to 127.0.0.1, validate the `Origin` and `Host` headers on the ws upgrade and on HTTP, and require a random per-launch token in the ws URL (injected into the editor page only, never into `/project/*`). Document that project scripts are trusted code.** Plain words: only the editor tab that knows the secret can talk to the server. Tradeoff: a few lines of code; it does not stop a hostile project script that runs same-origin. Source: GHSA-vg6x-rcgg-rjx6 / CVE-2025-24010, https://osv.dev/vulnerability/GHSA-vg6x-rcgg-rjx6 (Vite's fix was an Origin check plus a token). *Pick this as the v1 baseline.*
- Also add a "run project scripts" toggle, default off for projects Ron didn't author (serve with scripts stripped, or with a CSP `script-src 'none'` header on `/project/*`). Tradeoff: script-made DOM disappears until enabled.
- Serve the project from a separate origin (another port) and talk over `postMessage`. Tradeoff: real isolation, but it loses direct DOM and `getBoundingClientRect` access, which the overlay design depends on.

### [major] Computing the cascade on the server can't see runtime state and leaves out modern cascade features  — §Architecture (CascadeResolver), §M2
**In plain words:** Deciding which CSS rule "wins" depends on things only the browser knows, like the current window width and classes that scripts add. The plan computes it in Node from the files alone, and its list of rules skips newer CSS features that change who wins.
**What:** M2 lists CascadeResolver as "specificity, order, `!important`, `@media` currently active". "Currently active" `@media` is a property of the iframe viewport, not of the files. Script-added classes and states change matching. The list also omits `@layer`: layer order beats specificity, unlayered beats layered, and `!important` reverses layer order. It omits `:is()`/`:where()` specificity, `@container`, `@supports`, `@import` order, `@scope` proximity and shadow DOM. Matching selectors in Node also needs a DOM-matching library that the Stack doesn't list.
**Why it matters:** The wrong winner means edits land in a rule that has no visible effect, or in the wrong rule. The plan lists that as risk #2, and the mitigation ("panel shows the target rule") only helps if the resolver is right.
**Best-practice options:**
- **Resolve matching in the iframe. For each rule in `document.styleSheets`, test `el.matches(rule.selectorText)`, read conditions from the live CSSOM (`matchMedia`, layer and container context), and send the list of matching rules (stylesheet + rule index) to the server. The server maps each to its PostCSS rule and byte ranges. Cases it can't map fall back to inline with a visible warning.** Plain words: let the browser say what matches, and let the server say where it lives in the file. Tradeoff: CSSOM drops invalid rules, so index mapping needs a selectorText + order check, but it is correct for live state. Sources: MDN "Introduction to the CSS cascade", https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_cascade/Cascade (layers inside origin/importance, scoping proximity); MDN `Element.matches`, https://developer.mozilla.org/en-US/docs/Web/API/Element/matches; Chrome "Cascade layers", https://developer.chrome.com/blog/cascade-layers (layer precedence beats specificity). *Pick this.*
- Keep the server-side resolver but state a supported subset: refuse to target rules inside `@layer`/`@container`/`@scope`, and treat them as "inline only". Tradeoff: simpler and honest, but weaker on modern CSS that Claude may generate.

### [minor] Write-target rule 2 checks matches on one page only, and "inline fallback is safe by construction" is false next to `!important`  — §Architecture (Write target policy), §Risks
**In plain words:** A rule can look like it styles only this element on this page while a shared stylesheet uses it on other pages too. Writing an inline style also does nothing when the current winner is marked `!important`.
**What:** "If only this element matches it" is evaluated against the open page. Projects with several HTML files sharing a CSS file can match elsewhere. If the winning declaration is `!important`, a normal inline `style` loses. The live preview and the source both show no change, and the Risks table calls inline "safe by construction".
**Why it matters:** Silent cross-page edits, or edits that seem to do nothing, are both the class of surprise the policy exists to prevent.
**Best-practice options:** (Local logic; no external pattern needed.)
- **Count matches across every indexed HTML file that loads the stylesheet, and treat >1 as shared. When the winner is `!important`, target that rule (with the shared warning) instead of inline, or offer inline `!important` explicitly.** Plain words: check all pages, and never write a value that can't win. *Pick this.*

### [minor] The live preview and the file on disk can drift apart with nothing to detect it  — §Architecture (Edit op), §Writer
**In plain words:** The editor changes what you see immediately and writes the file separately. If the two disagree (a patch lands differently than the preview showed), nothing notices.
**What:** Ops are applied to DOM/CSSOM by the UI and turned into source patches by the server independently. R05 cites 10Web's warning that preview, edit store and disk must stay coherent. The plan has no reconciliation step.
**Why it matters:** Ron would approve a look that is not what the file says, and then push it.
**Best-practice options:**
- **After each write, hot-swap the changed stylesheet or `<style>` text from disk into the iframe (CSS-HMR style), then compare the edited element's computed value with the preview's. On mismatch, toast and reload.** Plain words: always re-show what's really on disk. Tradeoff: a small amount of code and a strong invariant. Source: 10Web write-up (fetched in R05), https://10web.io/blog/building-a-visual-point-click-editor-on-top-of-agent-generated-react-what-it-takes/. *Pick this.*
- Reload the iframe after every write. Tradeoff: simplest, but flickers and loses state.

### [minor] Undo as inverse ops is fragile next to external edits; snapshot undo is simpler and guarantees byte-identity  — §Architecture (Undo, Watcher), §M2
**In plain words:** Undo works by computing the opposite of each edit, which is easy to get subtly wrong (whitespace, removed lines), and it breaks if the file changed underneath. Keeping a copy of the file before each edit is simpler and always exact.
**What:** "Inverse ops in a stack" must invert every op kind exactly, including the whitespace of added or removed declarations, to meet "undo → byte-identical". The plan also has no policy for an external change (watcher) while the undo stack or pending debounced ops refer to old offsets. R05 says "ask/merge if dirty"; the plan says only "reconcile".
**Why it matters:** Undo bugs are the most trust-destroying bugs in an editor, and the zero-diff goal depends on them.
**Best-practice options:** (Local; design-sized files make this cheap, so no external pattern is needed.)
- **Undo stores the pre-image text of each touched file per coalesced transaction, and undo restores it (then re-index plus id remap). On an external change to a file, clear or rebase that file's undo entries, and if ops are pending, pause writes and ask.** Plain words: undo = put the old file back. *Pick this.*
- Keep inverse ops but add a property test (random op sequences → undo all → byte-identical) to M2's exit.

### [minor] The schedule is optimistic and the cut line is too narrow; M6 lands at the service deadline  — §Effort, §Milestones
**In plain words:** Ten to twelve days for a Figma-feel canvas plus a correct write-back engine plus sync is tight, and the plan names only one thing to drop if time runs out.
**What:** M3 (drag, resize, snapping, distance lines) is 2 days, and M5 (tokens, layer actions, copy/paste style, diff panel) is 2 days. Counting working days from 2026-11-23, M6 falls around 2026-12-09, days before the 12-14 closure. The only fallback is "cut M5's layer actions".
**Why it matters:** Without a ranked cut list, slips land wherever they happen, not where they hurt least.
**Best-practice options:** (Local planning; no external pattern.)
- **Write a ranked cut list now, for example: Alt distance lines → on-canvas padding handles → copy/paste style → snapping → layer actions. Move M6's Artifact-only path ahead of M3 so sync is proven before the deadline.** *Pick this.*

### [nit] Where pulled projects live and how serve-time ids could collide  — §Pull / push step 1–2, §Architecture
**In plain words:** Two small loose ends: the pulled project gets its own git repo inside the editor's folder, and the injected `data-ed-id` attribute is visible to the design's own CSS and scripts.
**What:** `projects/<slug>/` with `git init` nests a repo inside the editor repo. `data-ed-id` can affect `[data-*]` selectors, `outerHTML` comparisons or `dataset` iteration in project scripts.
**Best-practice options:** (Local.)
- **Keep pulled projects outside the editor repo (or gitignore `projects/`), and pick a namespaced attribute unlikely to collide (`data-dsed-id`). Add a fixture with a `[data-*]` selector.** *Pick this.*

---

## Decisions Ron needs to make

1. **Keep or drop the design-system (`DesignSync`) remote kind in v1.** Keeping it means a path out of the tool's stated scope, which closes 2026-12-14. Dropping it means Artifact designs only. *Recommend: drop it for v1, and ask in M0 where design-system projects live after the closure.*
2. **What M0's possible answers mean (go/no-go).** Plain HTML files → proceed. Typed Design artifact with data files → stop and re-plan. Publish wraps the page → add a normalisation step or relax Goal 2. *Recommend: write these branches into M0 before starting it.*
3. **Push merge strategy.** The options are line-level `git merge-file` that stops on any conflict, op-log replay with property-level clash detection, or refusing push whenever the remote changed. *Recommend: `git merge-file` + stop on conflict for v1; semantic merge in Next.*
4. **Where cascade resolution runs.** In the browser via CSSOM (correct for live state) or in Node from source (simpler, misses runtime state and `@layer`/`@container`). *Recommend: the browser decides matching, the server maps to source.*
5. **How element ids are allocated and kept.** Server-owned stable ids carried through patches, or iframe reload + path remap after structural edits. *Recommend: server-owned stable ids.*
6. **Whether pulled projects' scripts run in the editor.** Running them gives full fidelity, but they share the editor's origin. A toggle, default off for projects Ron didn't author, is the alternative. *Recommend: origin + token check always; scripts on for Ron's own projects, toggle for others.*
7. **Undo model.** File pre-image snapshots or inverse ops. *Recommend: snapshots.*
8. **Which real project seeds M0 and the golden corpus** (plan Q1). *Recommend: a multi-file design artifact Ron owns, with a shared CSS file and at least one script.*
9. **React for panels or something lighter** (plan Q2). React fits form-heavy panels, and the overlay is already vanilla. *Recommend: keep React.*
10. **Pull/push as skills only, or also editor buttons** (plan Q3). Buttons need the editor to drive a Claude Code session, which is a new integration with its own security surface. *Recommend: skills only in v1.*
11. **Where pulled projects and their git repos live.** Inside `projects/` of the editor repo (nested repos) or in a separate folder. *Recommend: a separate folder, or gitignore `projects/`.*

---

## Verdict

**Revise & re-review.** The write-back core is sound, but the remote-format premise, the `DesignSync` dependency, and four core mechanisms (id stability, cascade location, merge, local security) must be settled in the plan before M1 starts.
