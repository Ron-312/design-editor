# Critic v6 — Design Editor — v1 plan

**Plan reviewed:** plan.md
**Date:** 2026-11-23
**Score:** 7/10 — the approach and the M0 go/no-go gate are right, but one claim the sandbox design rests on is false on Ron's Mac (checked on this machine), and the probe and push-merge parts have gaps that would show up on day one.

---

## TL;DR for Ron

This is a careful, well-gated plan. Its biggest strength is the M0 spike with a fixed kill bar and fallbacks decided ahead of time, so nobody writes code on a guess about the canvas format. Its biggest risk is the sandbox serving design: it puts the project on a second origin, `127.0.0.2`, and that address cannot be bound on your Mac. I tested it here and got `EADDRNOTAVAIL`, because macOS only enables `127.0.0.1` on loopback. The fix is small: use a second port, or `*.localhost`. Two other gaps are worth closing before M1. First, the injected probe is the editor's only view into the frame, and it is blocked whenever a project is served with `script-src 'none'`. Second, nobody has measured how much of a file Claude Design's own editor rewrites when it saves, and that decides whether the text merge on push is usable or conflicts on every round. Ship after these fixes; no rethink needed.

---

## Strengths

- **M0 is a real gate.** The kill bar is fixed before the spike runs (Goals, "Kill bar"), each canvas-format unknown has a pass/fail fallback (M0 "Fallbacks, decided now"), and the plain-HTML machinery (cascade resolver, `RuleLocator`, `SharedCounter`) is fenced off as "built only if M0 picks that branch". This keeps a lot of speculative work out of the canvas path.
- **Honest framing against the built-in editor.** The plan lists what Claude Design already does (flex/grid panel, Wrap in flex/grid, guides, Theme menu) and shrinks M4/M5 to the gaps. That matches the Design type's `format.md`, which I read: the panel "edits the full set" of flex/grid properties.
- **Undo by file pre-image snapshots** (Undo) sidesteps per-op inverses, and byte-identical undo holds by construction. Dropping entries when the watcher sees an outside change is the right guard.
- **Push classification uses the two-replica model** (Pull/push step 3): a change on one side moves across, and only a change on both sides goes to `git merge-file`. `canvas.json` is kept out of the merge, and step 5 rewrites `base.json` from the bytes actually sent on every push. This closes the usual "remote edit re-uploaded as unchanged" bug.
- **Push handshake** (lock, flush, `push.ready`, canvas read-only) blocks ops rather than queueing them, so preview always equals disk and nothing is applied against stale offsets.
- **Write-back discipline:** parse5 offsets plus magic-string, a re-parse shape check before ids carry over, and an ack-vs-live check. Together they make "preview = disk" an enforced invariant, not a hope.

## Concerns

### [major] The second origin `127.0.0.2` cannot be bound on macOS — §Architecture, Scripts and trust; §Stack (Server)
**In plain words:** The plan isolates the project page by serving it from a second local address, `127.0.0.2`. On a Mac that address doesn't exist unless you add it by hand with `sudo`, so the server can't open it and the canvas never loads.
**What:** `ifconfig lo0` on this machine shows only `inet 127.0.0.1`, and `http.createServer().listen(5399,'127.0.0.2')` fails with `EADDRNOTAVAIL` (Node v26.10.0, Darwin 25.6.0). The Stack row also says the server is "bound to `127.0.0.1`", so a request to `127.0.0.2` would never reach it even on Linux. The sandboxing still holds, since `sandbox="allow-scripts"` plus the CSP `sandbox allow-scripts` header already give the frame an opaque origin. What breaks is the transport.
**Why it matters:** M1 cannot start as specified. And the standard macOS workaround (`sudo ifconfig lo0 alias`, re-applied after every reboot) is a system-network change that a localhost tool shouldn't need.
**Best-practice options:**
- **(a) A second port on `127.0.0.1` (e.g. editor `:5300`, project `:5301`), served by a second listener in the same Node process.** *Plain words: a different port is already a different origin, so you get the same isolation with no OS changes.* Origins differ by port, so the editor's storage and token stay out of reach, and the exact Host/Origin allowlists stay simple. Tradeoff: two listeners, and Vite `middlewareMode` stays on `:5300` only. Source: MDN, Same-origin policy — https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy. **Pick this: zero setup and works in every browser.**
- (b) `http://project.localhost:5300`. *Plain words: a made-up subdomain of localhost that browsers send to loopback themselves.* Chrome and Firefox hard-code `*.localhost` to loopback and treat it as a secure context. Tradeoff: the Host check must accept `project.localhost`; non-browser clients (curl, Playwright's request API) may not resolve it; it is the same port, so routing is by Host. Sources: Chromium blink-dev intent — https://groups.google.com/a/chromium.org/g/blink-dev/c/RC9dSw-O3fE ; W3C note on let-localhost-be-localhost — https://lists.w3.org/Archives/Public/public-webapps-github/2021Jun/0904.html
- (c) A loopback alias via `sudo ifconfig lo0 alias 127.0.0.2` plus a LaunchDaemon. *Plain words: make the Mac pretend it has a second address.* Tradeoff: needs root and a persistent system setting; not worth it. Source: HashiCorp, loopback alias on macOS — https://support.hashicorp.com/hc/en-us/articles/5976755662739

### [major] The probe can't run when a project is served with `script-src 'none'`, so the editor goes blind — §Architecture, Scripts and trust; §Non-goals
**In plain words:** The editor can't see inside the sandboxed page directly. It relies on a small helper script injected into the page. The plan's "scripts off" mode blocks all scripts, which blocks that helper too, so hover, selection and measuring stop working.
**What:** The frame is cross-origin and opaque, so every overlay read (`getBoundingClientRect`, `matches()`, `getComputedStyle`, hit-testing) goes through the injected probe over postMessage. But the plan serves every unmarked project, and any of Ron's own canvases whose script hashes change after a pull, with `Content-Security-Policy: script-src 'none'`. That header blocks the injected probe as well as the project's scripts. The plan says such canvases "show blank". The real effect is wider: the editor cannot even show the diff-and-re-mark flow on a working canvas, and any plain-HTML project (the fallback branch, which does not need scripts to render) becomes uneditable with scripts off. A related point: the DC runtime compiles `class Component extends DCLogic` from a `text/x-dc` block, which probably needs `'unsafe-eval'` if any `script-src` list is ever applied to Ron's canvases.
**Why it matters:** "Scripts off" was meant to be a safe read-only mode. It becomes a dead editor, exactly after every pull that brings in a Claude edit to `renderVals()`, which happens often on canvases.
**Best-practice options:**
- **(a) Serve scripts-off pages with `script-src 'nonce-<per-response random>'` and put that nonce only on the injected probe `<script>`.** *Plain words: a one-time password on the editor's own helper, so it runs and nothing else does.* The project's own scripts stay blocked; the probe keeps working. Strip any `nonce` attribute already in the source before serving, so project markup can't reuse it. Tradeoff: a per-response nonce in the serving transform, which is trivial. Sources: MDN, `nonce` global attribute — https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/nonce ; MDN, CSP `script-src` — https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Security-Policy/script-src. **Pick this: it keeps the trust model and the editor working.**
- (b) A hash source (`'sha256-…'`) for a static probe. *Plain words: allow exactly one known script by its fingerprint.* Tradeoff: the probe must be byte-static, with config passed via postMessage, not inlined. Source: same MDN `script-src` page.
- Either way, state in the plan which CSP applies to Ron's own canvases with scripts on: `sandbox allow-scripts` alone, or a `script-src` list that must include `'unsafe-eval'` if M0 shows the runtime uses `new Function`.

### [major] Nobody has measured how much Claude Design's own editor rewrites on save, and the text merge depends on it — §Pull / push step 4; §M0
**In plain words:** Push merges your local edits with edits made in Claude Design, line by line. If Claude Design's editor rewrites big chunks of a file every time it saves, almost every push will stop with a conflict you have to sort out by hand.
**What:** The merge is `git merge-file` on lines. I checked here: edits to two adjacent lines already conflict (exit 1). On canvases the main write target is the inline `style="…"` attribute, so every property of an element sits on one line. The built-in editor also does more than splice: `format.md` says dragging an item out of a flex/grid makes the editor "freeze the remaining siblings and the parent's size", which writes declarations onto several elements. M0 records what the built-in editor *can do* but not *what its Save writes*: a splice, a re-serialisation of the whole `<x-dc>` body, or reformatting. If it re-serialises, Goal 3's merge stops on nearly every round trip, and Goal 2 (minimal diffs) only holds for one side.
**Why it matters:** The value of this editor is git-friendly round trips. If every push conflicts, the loop is unusable even though it is safe.
**Best-practice options:**
- **(a) Add one M0 check: make a single property edit in Claude Design's editor, Save, re-read the file, and diff it against the pull. Record the footprint (lines touched, reformatting) in `06`. Add a kill-bar branch for it: if a save rewrites far more than it changed, plan the token-level merge below for v1, not Next.** *Plain words: measure it in ten minutes before building on it.* No external pattern beyond the spike; this is local to the Design type.
- (b) If the footprint is small but same-line clashes are common, keep `git merge-file` and, on conflict, retry the merge for that hunk at the token level (attributes, `;`-separated declarations) with `node-diff3`, which merges arbitrary token arrays and has `excludeFalseConflicts`. *Plain words: merge words and CSS properties, not whole lines, so two edits to different properties of one element don't collide.* Tradeoff: one more library and a tokenizer for the start tag, about half a day. Sources: node-diff3 — https://github.com/bhousel/node-diff3 ; git-merge-file docs (exit status = conflict count; histogram option) — https://git-scm.com/docs/git-merge-file
- (c) Accept conflicts but make them cheap, by showing them as "keep remote / keep ours" per hunk. Already in the plan; fine alone only if (a) shows small footprints.

### [minor] Requests from the sandboxed frame carry `Origin: null` and will hit the exact Origin check — §Architecture, Scripts and trust; §Stack
**In plain words:** A page in an opaque sandbox introduces itself to the server as "null". The plan's rule rejects any request whose origin isn't the editor's own, so the page's fonts and data fetches would be refused.
**What:** The Stack row says the server "rejects any HTTP request … whose `Host` or `Origin` is not the editor's own", and Scripts and trust extends "the exact Host/Origin checks" to the project pair. But CORS-mode subresource loads from an opaque-origin document (an `@font-face` from `/_blob/*`, or `fetch()` from `DCLogic`) send `Origin: null`, not the project origin. The plan already sets `Access-Control-Allow-Origin: *` on assets, which suggests the intent, but the check as written would 403 them first.
**Why it matters:** Fonts silently fall back and data-driven artboards render empty. The canvas looks different from Claude Design, which breaks the per-milestone screenshot check.
**Best-practice options:**
- **On the project listener, allow GET/HEAD of static files with `Origin` absent or `null` (and Host = the project origin). Keep the API and ws on the editor listener, strictly allowlisted and token-gated, and never accept `null` there.** *Plain words: the project server only hands out read-only files, so let the sandbox fetch them, and keep the doors that change things locked.* Sources: MDN, CSP `sandbox` (opaque origin, "The `Origin` … is `null`") — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox ; W3C webappsec thread on trusting `null` — https://lists.w3.org/Archives/Public/public-webappsec/2017May/0021.html

### [minor] The "static preview" fallback is really a re-implementation of the DC runtime — §M0, Fallbacks
**In plain words:** If the canvas runtime won't run locally, the plan falls back to drawing the page without it. But the page's content comes from JavaScript logic and a React-style template engine, so "without it" means rebuilding that engine.
**What:** The fallback is "render a static preview with `{{hole}}` filled from its `data-props` defaults". `format.md` shows holes come from `renderVals()` (arbitrary JS, often derived values and arrays for `<sc-for>`), not from `data-props` defaults. The runtime is React-based (`class`→`className`, React class lifecycle), and `<sc-if>`, `<sc-for>` and `<dc-import>` all need evaluation. A defaults-only preview would show empty loops and wrong branches, so it isn't a small fallback.
**Why it matters:** If M0 hits this branch, M1/M2 estimates are off by days, and "preview = disk" no longer holds.
**Best-practice options:**
- **Make "runtime won't run locally" a re-plan trigger (like "Anything else → stop"), not a silent fallback. Narrow the static preview to markup with no `<sc-for>`, `<sc-if>` or `<dc-import>`.** *Plain words: call it what it is, a stop sign, and don't promise a cheap substitute.* Local to this format; no external pattern applies.

### [minor] Local artboard add/remove conflicts with "`canvas.json` is read-only" — §Pull / push step 3; §M0 Design canvas
**In plain words:** Push says it carries added and removed artboards across, but it never sends the index file that lists artboards. A removed file would leave a dangling entry, and an added one would have no frame.
**What:** Step 3 says "An artboard added or removed on only one side is carried across". The Design SKILL.md says removing an artboard means "the file removed plus both [`boards` entry and `order` slot] taken out", and adding one needs a `boards` entry. That entry is optional to *render*, but the SKILL says to "list each". Push never sends `canvas.json`. The editor has no add/remove-artboard op, so this happens only through hand edits or git, but the plan claims to handle it.
**Why it matters:** A stale `boards` entry pointing to a missing file, or an unplaced artboard, leaves Claude Design in a state its own skill calls invalid.
**Best-practice options:**
- **For v1, a local-only add or remove of an artboard stops the push with "add/remove artboards in Claude Design". Remote add/remove is still taken as is.** *Plain words: support the direction that is safe and refuse the other clearly.* Local fix; no external pattern applies.

### [minor] The no-reload structural-edit machinery never runs on the main branch — §Architecture, Sandboxed iframe / Scripts and trust; §Undo
**In plain words:** The plan builds a clever way to move and duplicate elements without reloading the page. Canvases always run scripts, though, and with scripts on the plan reloads anyway, so that machinery is only used on the fallback branch.
**What:** Design canvases need `support.js`, so scripts are always on for v1's target, and Scripts and trust says structural ops, structural undo/redo and text commits "write the file and reload the iframe" in that case. The optimistic structural DOM apply, the UI stamping minted ids on optimistic nodes, and "re-sync the live iframe DOM in place" on undo (Sandboxed iframe, Undo) are therefore plain-HTML-only. On a React-rendered DOM they would also break reconciliation.
**Why it matters:** It is days of tricky code on the critical path (M2/M5) that the expected branch never uses.
**Best-practice options:**
- **Label live structural apply and in-place undo re-sync "plain-HTML branch only", like the cascade resolver. On canvases, build only the write, reload and restore-selection-by-edId path.** *Plain words: build the simple path first and add the fancy one only where it is used.* Local scoping; no external pattern applies.

### [minor] Push has no story for a publish refusal or for a merged file that no longer parses — §Pull / push steps 2–5
**In plain words:** If someone saves in Claude Design during a push, the upload is refused, and the plan doesn't say what happens next. A text merge can also produce broken markup that gets uploaded without a check.
**What:** The Artifact publish is refused when the remote changed since this session's read (the Design SKILL says a refusal "names the file to re-read"). Steps 2–5 don't say whether push loops back to step 2, how many times, or whether the lock stays held meanwhile. Step 4 sends `git merge-file` output after exit 0 without running the Writer's parse and shape check on it. Line merges can splice one side's open tag with the other's close.
**Why it matters:** A half-pushed state is recoverable (identical bytes on both sides converge), but an unvalidated merge can publish a broken artboard.
**Best-practice options:**
- **On refusal: keep the lock, go back to step 2 at most twice, then stop and report. Before sending, parse each merged file with parse5 and check that `<x-dc>` and the `data-dc-script` block are intact; on failure, treat it as a conflict.** *Plain words: retry a little, and never upload something you haven't parsed.* Standard optimistic-concurrency retry. Source for the merge behaviour: git-merge-file — https://git-scm.com/docs/git-merge-file

### [minor] M1 is under-sized — §M1; §Effort
**In plain words:** The first build step packs about a week of work into one or two days.
**What:** M1 covers the server, SourceIndex, the serving transform, the two-origin sandbox, the probe's batched async RPC (with "+1 day" noted inside the Architecture text), the editor shell, zoom/pan with an event shield, hit-testing through postMessage, eight selection gestures, a two-way-synced layers panel and a read-only properties panel with the selector chip. Snapping and Alt-measure in M3 also have to read sibling rects across that async boundary, and the plan doesn't say they are cached at drag start.
**Why it matters:** The 10–12 day estimate drives the "cut M5 layer actions" fallback. If M1 alone takes four days, the cut lands too late.
**Best-practice options:**
- **Re-estimate M1 at 3–4 days. Say that the probe snapshots sibling and parent rects once at drag start, so snapping runs locally per frame.** *Plain words: be honest about the first week, and avoid a round trip per mouse move.* Snapshotting at drag start is how tldraw and Moveable-style editors keep snapping cheap (R01 covers the maths). No further external source needed.

### [nit] The M6 exit test pushes to Ron's real canvas — §M6
**In plain words:** The final test edits and pushes a real project, so a bug would land in Ron's actual design.
**What:** "a pull, an edit and a push show up in Claude Design" on "Test Site". Ron's standing rule is to ask before each step on external accounts.
**Best-practice options:** **Run M6 against a throwaway canvas (a copy of Test Site), and ask Ron before each push to a real one.** Local; no external pattern applies.

### [nit] Where `.editor/` lives, and what the project repo ignores — §Pull / push; §Editor-only state
**In plain words:** The plan doesn't say whether the editor's working folder sits inside each project's git repo, or keep it out of commits and uploads.
**What:** `base.json`, `push.lock`, `state.json` and `cache/` are under `.editor/`. Pull does `git init` in `projects/<slug>/` and commits a baseline, and push classifies "every file". Neither says `.editor/` is in that repo's `.gitignore` and excluded from classification. Only `cache/` is stated.
**Best-practice options:** **State `projects/<slug>/.editor/` with a pull-written `.gitignore` entry, and have push classify only `project/**`.** Local; no external pattern applies.

---

## Decisions Ron needs to make

1. **Second origin for the sandbox.** A second port on `127.0.0.1`, `project.localhost`, or a sudo loopback alias. Recommendation: a second port; it needs no setup and works everywhere.
2. **What "scripts off" means.** A nonce-allowed probe (the editor still works, read-only) or fully blank. Recommendation: the nonce probe; otherwise every pull that touches `renderVals()` blinds the editor.
3. **Merge granularity if M0 shows big save footprints.** Keep the line merge (frequent conflicts), add a token-level `node-diff3` retry in v1, or stop the project. Recommendation: measure first in M0; add the token retry only if same-line clashes show up.
4. **"Runtime won't run locally" in M0.** A static-preview fallback or a stop-and-re-plan trigger. Recommendation: stop and re-plan; the fallback is a runtime rewrite.
5. **Local artboard add/remove on push.** Refuse with a message, or let push edit `canvas.json` keys. Recommendation: refuse in v1.
6. **Build live structural DOM apply in v1?** It is only used on the plain-HTML branch. Recommendation: defer it to that branch.
7. **Where M6 runs.** A throwaway canvas or Test Site itself. Recommendation: a throwaway copy.
8. **Script-hash trust marking (hidden decision).** The opaque-origin sandbox is already the security boundary (the Design type itself relies on it), so per-script hashes, auto-off and a re-mark diff UI add friction on every Claude edit for defence in depth. Keep it, or simplify to "sandbox always, plus `connect-src` limits". No strong recommendation; keep it if the diff UI stays small.

---

## Verdict

**Ship after addressing blockers.** There are no true blockers in design terms. Fix the unbindable `127.0.0.2` origin and the probe-vs-CSP gap in the plan text, and add the save-footprint check to M0, before M1 starts.
