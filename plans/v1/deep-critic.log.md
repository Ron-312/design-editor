# deep-critic log — Design Editor — v1 plan

This file is the audit trail of what deep-critic changed in the plan and why.

## Round 1 — critic v1, 5/10 (2026-11-23)
**Critic:** critic.v1.md
### Folded in
- [major] The design-system sync path targets a service that closes in three weeks, through a tool scoped to another skill — v1 is Artifact-only; DesignSync dropped from Pull / push, M0, M6 and Risks (§Pull / push, M0, M6, Risks)
- [major] The localhost editor server can write to disk but has no origin or auth check — server bound to 127.0.0.1, Host/Origin check, per-launch ws token kept out of `/project/*` (§Stack)
- [major] "A Claude Design project is plain HTML/CSS" is contradicted by the Artifact docs — M0 checks publish wrapping, asset URLs and typed Design; exit is now go/no-go (§M0)
- [major] Push merge is underspecified — `git merge-file` per file, stop on conflict, no auto-resolution; Artifact publish guard corrected to "relative to last read"; M6 exit and Risks updated (§Pull / push, M6, Risks)
- [major] Element ids are not specified to survive re-indexing or structural edits — server-owned counter ids carried in place, new ids in the op ack; M5 golden move/duplicate/undo sequence (§Architecture, M5)
- [major] Computing the cascade on the server can't see runtime state — matching in the iframe, server maps rule path to source; `@layer`/`@container`/`@scope`/`@import` rules go inline with a warning; computed-style check before commit (§M2, Architecture, Risks)
- [minor] Write-target rule 2 checks matches on one page only, and inline fallback is unsafe next to !important — match count spans all indexed HTML files; an `!important` winner is the target (§Architecture write target policy, Risks)
- [minor] The live preview and the file on disk can drift apart — write ack carries the resolved value, mismatch reloads the iframe; e2e "Preview = disk" test (§Architecture Writer, Testing)
- [minor] Undo as inverse ops is fragile next to external edits — pre-image snapshot undo; outside changes drop that file's entries; pending debounced ops ask keep/discard (§Architecture Undo)
### Decisions adopted — Ron to confirm
- Keep or drop the design-system (DesignSync) remote kind in v1 → **Drop it; Artifact-backed designs only, and M0 asks where design-system projects live after 2026-12-14** — standalone Claude Design closes 2026-12-14 and the migration guide names no API for design systems  (critic's recommendation, verified)
- What M0's possible answers mean (go/no-go) → **Three branches fixed in M0's exit: plain HTML proceeds; typed Design stops and re-plans; publish wrapping adds normalisation or relaxes Goal 2** — spike practice fixes the result-to-outcome mapping before the work starts  (critic's recommendation, verified)
- Push merge strategy → **Line-level `git merge-file` against the pulled baseline, stop on any conflict; property-level merge deferred to Next** — standard standalone three-way merge with a conflict-count exit code; property-level replay is a large build  (critic's recommendation, verified)
- Where cascade resolution runs → **In the browser against the live iframe CSSOM; the server only maps the rule to its source range** — the engine defines the cascade, as DevTools does; a Node re-implementation misses runtime state and `@layer`  (critic's recommendation, verified)
- How element ids are allocated and kept → **Server-owned stable ids, allocated once, carried through every patch, never reused; remap only after an outside edit** — path/index identity is fragile; canvas-to-source tools assign ids once  (critic's recommendation, verified)
- Whether pulled projects' scripts run in the editor → **Origin allowlist + per-session token always; scripts run only for projects Ron marks as his own, toggle default off, CSP `script-src 'none'` otherwise** — a same-origin scripted iframe can reach the parent  (critic's recommendation, verified)
- Undo model → **Per-file pre-image snapshots, not inverse ops** — single-user editor with small files; byte-identical undo by construction  (critic's recommendation, verified)
- Which real project seeds M0 and the golden corpus (Q1) → **A multi-file design artifact Ron owns, with shared CSS and a script, plus the hand-made edge cases** — exercises shared-rule targeting, cross-file indexing and script-made DOM; the decision's design-system seed clause was dropped since DesignSync is out of v1  (critic's recommendation, verified)
- React for panels or something lighter (Q2) → **Keep React for panels; overlay stays plain DOM/SVG** — bundle size is irrelevant on localhost; avoids `preact/compat` quirks  (critic's recommendation, verified)
- Pull/push as skills only, or also editor buttons (Q3) → **Skills only in v1** — buttons would make the localhost server spawn a session with publish rights; can be added later via `claude -p`  (critic's recommendation, verified)
- Where pulled projects and their git repos live → **`projects/<slug>/`, each its own repo, `projects/` gitignored in the editor repo** — avoids embedded-repo nesting; a submodule does not fit per-user mutable content  (critic's recommendation, verified)
### Skipped
- Where pulled projects live and how serve-time ids could collide — nit
- The schedule is optimistic and the cut line is too narrow; M6 lands at the service deadline — over verifier cap

## Round 2 — critic v2, 4/10 (2026-11-23)
**Critic:** critic.v2.md
### Folded in
- [blocker] The v1 remote kind is a typed Design canvas, which is the plan's own stop branch — M0 exit now has a Design canvas branch (06 answers on ids, runtime, layout; re-plan Architecture/M1/M2 before M1; core carries over); "anything else" stops; Q1 seeds M0 with a real canvas (§M0, Open questions)
- [major] The !important exception rests on a false premise — shared `!important` winner now gets an inline `!important` on that element with an "overrides" chip; Risks row corrected (§Write target policy, Risks)
- [major] Rendered DOM is not the source DOM once scripts run — with scripts on, a failed computed-style gate keeps the edit and warns; structural ops patch the file and reload instead of touching the live DOM (§Scripts and trust)
- [major] Structural moves can produce HTML that re-parses into a different tree — Writer re-parse shape check refuses structural ops whose re-parsed tree differs; M5 points at it as the backstop (§Writer, M5)
- [major] How ids survive a re-parse and a snapshot undo is undefined — UndoLog stores an `edId -> start offset` map with each pre-image; Writer binds ids by splice-shifted offsets (§Undo, Writer)
- [major] Rule 2's cross-file match count needs a matcher the architecture doesn't have — server `SharedCounter` with css-select over parse5 htmlparser2-adapter trees, conservative on dynamic pseudo-classes and scripts (§Write target policy)
- [minor] An explicitly picked rule can be silently overridden to inline — computed-style fallback applies only to automatic targets; a picked rule is written with an "overridden by" warning (§M2)
- [minor] In-place text editing will mangle entities and mixed content — single-text-node elements only, `plaintext-only`, diff-splice of the changed span; entities and inline children added to the golden corpus (§M2, Testing)
- [minor] The Vite dev server breaks the single-origin and ws-origin assumptions — Vite in `middlewareMode` inside the Node server on port 5300; path-scoped ws (§Stack)
### Decisions adopted — Ron to confirm
- What v1 actually edits → **Design canvases (.dc.html artboards + canvas.json), confirmed by an M0 check on one real project of Ron's first** — /design produces canvases today, so a plain-HTML v1 risks editing nothing Ron has; the parse5/magic-string/Writer/undo core carries over  (critic's recommendation, verified)
- What the local editor must do that the Design canvas editor can't → **Gaps vs the built-in canvas editor written into Goals before M1; scope follows them** — the built-in editor covers drag/resize/align/layers; snapping, measure, tokens, offline and version history are not documented, and M0 confirms the unstated ones  (critic's recommendation, verified)
- Shared !important winner → **Inline `!important` on that element only, with an "overrides !important in .x" chip; editing the shared rule stays explicit** — per the cascade sort order, an inline `!important` beats every author `!important`, layered or not  (critic's recommendation, verified)
- Structural ops that break HTML parsing rules → **Reject with an explanation and grey out invalid drop targets; never auto-convert tags** — the parser would re-parse such source into a different tree; tag swaps silently rewrite markup and selector matches  (critic's recommendation, verified)
- How ids are restored on undo → **UndoLog entries snapshot each touched file's id map beside the pre-image; undo/redo restore it, no reconcile, no reload** — memento undo must restore identity with state; counter stays monotonic  (critic's recommendation, verified)
- Script trust once the runtime must run → **Trust Ron's own Design canvases (scripts same-origin, token reachable); keep exact Origin/Host checks and per-session token; no second-origin iframe in v1** — canvases cannot render without support.js; a second origin would cost the overlay's direct DOM access  (critic's recommendation, verified)
- Cross-file uniqueness check → **Server-side css-select over parse5 trees, conservative: dynamic pseudo-classes, script-bearing pages and selector errors count as shared** — css-select is the standard Node selector engine; `css-select-parse5-adapter` is archived, so `parse5-htmlparser2-tree-adapter` is used  (critic's recommendation, verified)
### Skipped
- The computed-style check has false negatives — nit
- Push edge cases: concurrent writes, added/deleted files, merged result locally — over verifier cap
- M2 bundles the full properties UI into the riskiest milestone — over verifier cap

## Round 3 — critic v3, 6/10 (2026-11-23)
**Critic:** critic.v3.md
### Folded in
- [major] The detailed design is for the fallback; the likely case (Design canvas) has no design and no plan B — Non-goals now name Design canvases as v1 target; M0 canvas branch gets a pass/fail fallback per question (id mapping, static preview, one-artboard view) and the cascade machinery is marked plain-HTML fallback only (§M0, §Non-goals)
- [major] "Claude Design has no version history" is wrong for canvas artifacts — Goals sentence replaced with whole-snapshot vs line-diff framing; M0 records what Artifact version history offers (§Goals, §M0)
- [major] canvas.json and artboard sizes are coupled and shared — artboard-root resize is read-only in v1; push excludes canvas.json from merge and takes the remote copy (§M3, §Pull / push)
- [minor] Assets and the runtime only work on claude.ai — M0 asks whether `/_blob/*` and `support.js` are origin-relative and states the expected cache rule (§M0)
- [minor] No handshake between /design-push and a running editor — push reads and hashes the files once after the ready ack and sends exactly those bytes; merged files count as outside edits (merged into the lock handshake from the decision below) (§Pull / push)
- [minor] "The engine's own result" for the cascade winner does not exist as a web API — resolver sorts matching declarations itself (`!important`, `@layer`, specificity, order); `getComputedStyle` is only a guard (§Architecture)
- [minor] The golden corpus has no canvas-specific edge cases — added canvas fixtures for `{{hole}}` in inline style, `<sc-for>`/`<sc-if>`, `<dc-import>`, `<helmet><style>` (§Testing)
### Decisions adopted — Ron to confirm
- Design for canvases now or after M0? → **Write Architecture/M1/M2 for Design canvases now from the documented format, with a fallback per M0 question; cascade machinery is plain-HTML fallback only** — a spike only works if the alternatives are known before it runs; the parse5/magic-string/Writer/undo core carries over (critic's recommendation, verified)
- canvas.json in v1: read-only, or a JSON-aware merge? → **Read-only: no artboard-root resize, push never writes or merges it** — root resize is a three-place edit that breaks one-splice-per-file; `jsonc-parser` `modify` keeps a merge a cheap later upgrade (critic's recommendation, verified)
- Cache assets and the runtime at pull for offline use? → **/design-pull downloads every `/_blob/*` asset and `support.js` into `.editor/cache/`; the serving layer answers from there; push never sends the cache** — standard vendoring pattern and the only option, since localhost has no claude.ai credentials (critic's recommendation, verified)
- How push and a running editor coordinate → **`.editor/push.lock` / `push.ready` handshake: editor flushes the debounce and acks, push proceeds, editor re-indexes on release** — cooperative lock file as with git's index.lock; "close the editor first" cannot be enforced and loses the last debounced edit (critic's recommendation, verified)
- Scope v1 to canvases Ron owns only? → **Explicit non-goal: other people's canvases are out of scope** — canvases need scripts to render, and scripts run only for projects marked as Ron's own (critic's recommendation, verified)
- Is the remaining value enough, given the built-in properties panel and Artifact version history? → **Yes, keep going; the M0 kill switch stays** — git line diffs, offline, snapping, measure, Auto Layout handles and tokens justify ~2 weeks without the version-history argument (Ron's answer)
- Name the M0 project → **"Test Site" (its link is kept out of this public repo); hand-made fixtures if it lacks `<sc-for>`/`{{hole}}`/`<dc-import>`** — closes the open item without stalling M0 (Ron's answer)
### Skipped
- Effort is estimated before the re-plan the plan itself requires — nit
- Undo while ops are still in the debounce window is unspecified — nit

## Round 4 — critic v4, 5/10 (2026-11-23)
**Critic:** critic.v4.md
### Folded in
- [major] The built-in editor already documents most of the "why build this" list — Goals now list flex/grid panel, wrap, guides and Theme menu as existing; M4/M5 shrink to what M0 finds missing; kill bar rewritten (merged with the kill-bar decision) (§Goals)
- [major] Push never pulls remote-only changes into the working tree — push classifies every file against the last synced commit, writes remote-only changes locally, advances baseline and base.json every push; M6 exit adds a two-pushes-in-a-row test (merged with the push sync decision) (§Pull / push, §M6)
- [major] Canvas tokens are not `:root --*` variables — M0 records where tokens live and what the Theme menu writes; M5 picker reads design-system tokens and copies that form (merged with the token-source decision) (§M0, §M5)
- [major] The canvas runtime is React, so mutating the live DOM in place is unsafe — with scripts on, structural undo/redo and text commits also write and reload; optimistic setDecl is preview only (§Architecture: Scripts and trust)
- [major] The trust model keys on who owns the canvas — the "mine" mark is bound to hashes of every executable source; a change switches scripts off until Ron re-marks; the second-origin clause was superseded by the sandbox decision (§Architecture: Scripts and trust)
- [major] The plan body is still built around the plain-HTML fallback — M2 scoped to inline style plus picked `<helmet><style>` on canvases, cascade machinery only on the plain-HTML branch; Testing gets a branch-scope bullet; Open question 1 drops the shared CSS file requirement (merged with the cascade-machinery decision) (§M2, §Testing, §Open questions)
- [minor] `<sc-for>` repeats break the one-id-one-node assumption — all repeats share one id, outlined and previewed together (merged with the sc-for decision) (§M0)
- [minor] Edits made while a push is running are not specified — canvas, panels and Cmd-Z are read-only with a banner while push.lock is held; ops blocked, not queued (merged with the editing-during-push decision) (§Pull / push)
### Decisions adopted — Ron to confirm
- Kill bar for M0 → **Go only if M0 finds snapping and Alt-measure missing and git diffs/offline matter to Ron; otherwise re-scope to git-sync + precision (M4/M5 to Next)** — a pre-set kill bar keeps the spike pass/fail; Anthropic documents drag/resize/align/guides and no version history, snapping/measure unstated  (critic's recommendation, verified)
- Trust model for canvas scripts → **Serve /project/* sandboxed (allow-scripts only) from a second origin 127.0.0.2, read through an injected probe over postMessage** — allow-scripts + allow-same-origin on a same-origin frame gives no isolation; the Design type calls canvas content untrusted; about +1 day in M1  (critic's recommendation, verified)
- Push sync model → **Full two-way sync against the last synced commit; one-sided changes move both ways, baseline and base.json advance every push** — Unison's archive model; a stale baseline lets a later push overwrite remote-only edits  (critic's recommendation, verified)
- Token source on canvases → **Picker reads project/ds/*/tokens.json, writes what the Theme menu writes; :root --* fallback; no picker with neither** — the Design type makes tokens.json the source of truth; copy the built-in convention  (critic's recommendation, verified)
- Where the plain-HTML cascade machinery lives → **M2 builds canvases only (inline style + picked `<helmet><style>`); resolver, RuleLocator, SharedCounter, target policy only if M0 activates plain HTML; M2 = 1½ days (+1)** — YAGNI; the shared core makes deferral cheap  (critic's recommendation, verified)
- Editing during push → **Read-only canvas with a banner while push.lock is held; no in-memory op queue** — push may rewrite files and reload, so queued ops would target stale ids; the lock lasts seconds  (critic's recommendation, verified)
- What an edit to a `<sc-for>` repeat does on screen → **Lands on the template node, shows on every repeat, all repeats outlined together** — one template node in source; Webflow and Wix repeaters behave the same  (critic's recommendation, verified)
### Skipped
- Canvas e2e tests need the runtime, which lives only in a git-ignored cache — nit
- `support.js` is likely not a published file of the canvas — nit

## Round 1 — critic v6, 7/10 (2026-11-23)
**Critic:** critic.v6.md
### Folded in
- [major] The second origin 127.0.0.2 cannot be bound on macOS — `/project/*` moves to a second listener on `127.0.0.1:5301` (project-only, no API/ws/token, exact Host check); Stack Server and Editor UI rows updated (merged with the second-origin decision) (§Architecture: Scripts and trust, §Stack)
- [major] The probe can't run under `script-src 'none'` — superseded by Ron's no-trust-mark decision: no `script-src 'none'` anywhere; probe carries a per-response nonce, source `nonce` attributes stripped, `eval`/`new Function` for `DCLogic` unaffected (merged with the scripts-off and trust-marking decisions) (§Architecture: Scripts and trust)
- [major] Claude Design's Save footprint is unmeasured — new M0 bullet measures it; push step 4 adds a conditional token-level `node-diff3` retry (merged with the merge-granularity decision) (§M0, §Pull / push step 4)
- [minor] Requests from the sandboxed frame carry `Origin: null` — project origin lets static GET/HEAD through with `Origin` absent or `null`; editor, API and ws keep the strict allowlist; Stack Server row notes the exception (§Architecture: Scripts and trust, §Stack)
- [minor] The "static preview" fallback is a re-implementation of the runtime — fallback replaced by stop-and-re-plan; Risks row notes it (merged with the runtime decision) (§M0, §Risks)
- [minor] Local artboard add/remove conflicts with read-only `canvas.json` — remote-only add/remove carried across; local-only add/remove stops the push (merged with the artboard decision) (§Pull / push step 3)
- [minor] No-reload structural-edit machinery never runs on the main branch — canvases write, reload and restore by edId (built first); live DOM apply only on the plain-HTML branch; Undo updated (merged with the live-apply decision) (§Architecture: Sandboxed iframe, Undo)
- [minor] Push has no story for a publish refusal or a merged file that no longer parses — new "two guards" paragraph: parse5 shape check on clean merges, no retry on refusal, re-run is safe (§Pull / push)
- [minor] M1 is under-sized — M1 now 2–3 days; M3 snapping snapshots sibling/parent rects at drag start and runs locally per frame (§M1, §M3)
### Decisions adopted — Ron to confirm
- Second origin for the sandbox → **Serve /project/* from a second port on 127.0.0.1 (same Node process, second listener); no hostname alias, no sudo** — an origin includes the port; 127.0.0.2 hits EADDRNOTAVAIL on macOS, `*.localhost` fails in Safari, a loopback alias needs root; the sandbox is the boundary and auth is a token, not cookies  (critic's recommendation, verified)
- What "scripts off" means → **Per-response nonce on the injected probe; project scripts never get the nonce** — standard CSP nonce pattern; folded into the trust decision below, since Ron's answer removes scripts-off entirely and keeps only the probe nonce and the strip-`nonce` rule  (critic's recommendation, verified)
- Merge granularity if M0 shows big save footprints → **Keep line-level `git merge-file`; measure the Save footprint in M0; add a token-level `node-diff3` retry in v1 only if needed** — `git merge-file` has no word mode, `node-diff3` merges any token array, so the retry is a bolt-on; conflicts stay safe meanwhile  (critic's recommendation, verified)
- "Runtime won't run locally" in M0 → **Stop and re-plan before M1; no static-preview fallback** — a defaults-only preview cannot render `renderVals()`, `<sc-for>`, `<sc-if>` or `<dc-import>`, so it would be a runtime rewrite and break preview = disk  (critic's recommendation, verified)
- Local artboard add/remove on push → **Refuse local-only add/remove with "add/remove artboards in Claude Design"; carry remote-only add/remove** — the `boards` entry and `order` slot live in `canvas.json`, which push never sends; same shape as Unison's one-sided restrictions  (critic's recommendation, verified)
- Build live structural DOM apply in v1? → **Defer to the plain-HTML branch; canvases write, reload and restore selection by edId** — the runtime owns a canvas's DOM, and external mutation of runtime-managed nodes is a documented hazard  (critic's recommendation, verified)
- Where M6 runs → **A throwaway copy of Test Site; pushes to the real Test Site only after Ron approves that push** — M6 forces conflicts on purpose, and push is the one step that writes to Ron's account  (critic's recommendation, verified)
- Script-hash trust marking → **Drop per-script hashes, auto-off and the re-mark diff; scripts always run in the opaque-origin sandbox plus CSP `connect-src 'none'`; the probe runs via a per-response nonce** — the sandbox is already the boundary; the hash gate only added friction on every Claude edit  (Ron's answer)
### Skipped
- The M6 exit test pushes to Ron's real canvas — nit (covered anyway by the "Where M6 runs" decision)
- Where .editor/ lives, and what the project repo ignores — nit

## Round 2 — critic v7, 7/10 (2026-11-23)
**Critic:** critic.v7.md
### Folded in
- [major] `connect-src 'none'` breaks canvases that fetch their own uploaded data — `/project/*` CSP now `connect-src http://127.0.0.1:5301 http://localhost:5301` (explicit host-sources, not `'self'`); probe "needs no network of its own" (merged with the canvas network policy decision) (§Architecture: Scripts and trust)
- [major] Running `/design-pull` again on an existing project is undefined — new re-pull paragraph: refuse on a dirty tree, clean refresh via push's steps 2, 3 and 5 with no uploads, then cache refresh; push step 3 fetches missing `/_blob` ids for remote-only files (merged with the re-pull decision) (§Pull / push)
- [major] The push lock's stale check uses a PID that a skill does not have — `push.lock` holds `{nonce, expiresAt}` (120 s lease renewed each step); stale only after expiry; nonce and lease re-checked before publish and step-5 commit; editor unlocks on expiry; lock duration now "up to a few minutes" (merged with the push lock liveness decision) (§Pull / push, /design-push)
- [major] Editing text that contains a `{{hole}}` splices the edit at the wrong offset — `setText` diffs the source text node; text/attributes containing `{{` are read-only with an "edit in source" hint; golden fixtures for mixed text and attribute holes (merged with the `{{hole}}` text decision) (§M2, §Testing: Canvas fixtures)
- [minor] Any website can frame the project origin, and the probe answers its parent — `frame-ancestors http://127.0.0.1:5300 http://localhost:5300` added to the project CSP header (§Architecture: Scripts and trust)
- [minor] M0 re-derives things the Design type already documents, and misses two runtime facts — pull caches everything `support.js` loads (runtime bundle via `read` on the type URL); M0 checks for a host-page postMessage wait and records the type release; id fallback uses the type's `view-state.md` addressing if confirmed (§M0)
- [minor] M0 and the overall estimate are optimistic — M0 is a one-day time-box with a two-hour gate on the three kill-risks; M1–M5 re-estimated at M0's end; Effort figure marked provisional (merged with the M0 time-box decision) (§M0, §Effort)
### Decisions adopted — Ron to confirm
- Push lock liveness → **Lease plus nonce: push.lock holds {nonce, expiresAt}, renewed each step, stale only after expiresAt; nonce and expiry re-checked before publish and before the step-5 commit** — a skill's shell steps are short-lived, so no PID outlives a step; leases are the established crashed-holder pattern (git index.lock, filelock); remote publish refusal plus base.json hashes stay the real compare-and-swap  (critic's recommendation, verified)
- Text that contains `{{hole}}` → **Read-only in v1 with an "edit in source" hint, golden fixtures for text and attribute holes; segment-aware editing goes to Next** — visual editors over bound content (Webflow CMS, Lovable) refuse rather than guess a splice; a rendered-text diff silently corrupts the hole  (critic's recommendation, verified)
- Canvas network policy → **`connect-src http://127.0.0.1:5301 http://localhost:5301` instead of `'none'`** — the Design type's `/_blob` urls are used by `fetch()`; the 5301 listener is read-only, tokenless and already CORS-open, so no new surface  (critic's recommendation, verified)
- Re-pull policy → **Refuse re-pull on a dirty project; on a clean one run a no-upload refresh through push's classification, then refresh the cache** — keeps one merge path; a stash re-apply can conflict; the baseline cannot be rewritten under unpushed edits  (critic's recommendation, verified)
- M0 time-box → **One-day time-box with a two-hour go/no-go gate first, and a re-estimate of M1-M5 at its end** — about ten checks, several hands-on; spike practice fixes the investment and decides at the end  (critic's recommendation, verified)
### Skipped
- The Edit op line contradicts the canvas rule — nit
- The probe nonce does nothing — nit

## Round 1 — critic v9, 7/10 (2026-11-23)
**Critic:** plans/v1/critic.v9.md
### Folded in
- [major] The Claude Code ↔ edsync data contract is undefined — new `ingest` verb and a "Hand-off contract" paragraph: snapshot dir in the default scratchpad via `--remote-dir`, `classify` prints the exact `files` map; `base.json` holds synced-commit hashes only; CLI tests add ingest and partial-publish re-run (merged with the remote-bytes decision) (§Pull / push, §Testing)
- [major] The throwaway copy of Test Site has no recipe, and asset URLs are per artifact — copy recipe (Design `type_url`, server-side asset copy, `/_blob` id rewrite via `edsync rewrite-blobs`, id map in `06`) added after the Testing safety rule, referenced from M0 and M6 (merged with the copy-assets decision) (§Pull / push, §M0, §M6)
- [minor] The kill bar and re-scope need Ron, but there is no default while he is away — kill bar applied mechanically at M0's exit; shrink applied without waiting, recorded in `06` for Ron to confirm (merged with the kill-bar decision) (§Goals)
- [minor] git merge-file --diff-algorithm needs Git ≥ 2.44, and the startup check sets no minimum — Git >= 2.44 required, checked at editor startup and every `edsync` verb, no Myers fallback (merged with the Git-version decision) (§Cross-platform)
- [minor] Origin: null plus Access-Control-Allow-Origin: * lets any web page read the project origin — project documents served only under a per-launch 128-bit `/project/<secret>/` prefix, `Referrer-Policy: no-referrer`, `/_blob/<id>` the only root exception; Local Network Access defence in depth (merged with the project-origin decision) (§Architecture: Scripts and trust)
- [minor] Inline text editing uses contenteditable on React-owned runtime DOM — in-place edit kept; probe `MutationObserver` cancels on any foreign mutation with a toast; checked on an interactive artboard (merged with the text-surface decision) (§M2)
- [minor] Fixed ports and one editor per project are an unstated decision — one editor at a time, `EADDRINUSE` exits with a clear message and `--port`, project port = editor+1, all allowlists built from the bound ports (merged with the port-policy decision) (§Stack)
- Publish shape (decision) — push sends every changed artboard in one publish call; M0 checks whether one refused file rejects the whole call (§Pull / push: Two guards, §M0)
### Decisions adopted — Ron to confirm
- Kill-bar default while Ron is away → **Treat git diffs and offline as mattering, auto-apply the written shrink if M0 finds snapping or Alt-measure built in, stop only if nothing survives** — spike practice maps findings to a verdict mechanically; the shrink only removes scope and is reversible  (critic's recommendation, verified)
- How remote bytes reach edsync → **Skill reads remote files into the default scratchpad folder and passes it as `--remote-dir`; new `ingest` verb does pull steps 1-4** — a save there needs no prompt, so unattended pulls do not stall; flags plus JSON output is the standard CLI composition and keeps byte decisions in the tested CLI  (critic's recommendation, verified)
- Publish shape → **One publish call carries every changed artboard, with an M0 check of whether one refused file rejects the whole call** — multi-file changes go as one atomic unit, as in Git and SVN; the existing recovery covers a partial publish  (critic's recommendation, verified)
- The throwaway copy's assets → **Copy assets server-side (`from_url` + `asset_ids`) and rewrite each `/_blob` id, map recorded in `06`; keeping original ids only as an observed M0 shortcut** — asset urls belong to one artifact; copy-then-rewrite is the established cross-container pattern  (critic's recommendation, verified)
- Minimum Git version → **Require Git >= 2.44, checked at editor startup and every edsync verb, refuse with an upgrade hint** — `--diff-algorithm` first shipped in 2.44; current Apple, Homebrew and Git for Windows builds are newer; a Myers fallback would be an untested second merge path  (critic's recommendation, verified)
- Project-origin read exposure → **Per-launch secret path prefix for project documents on 5301; `Origin: null` never an allow; Local Network Access only an extra layer** — any page can send `Origin: null` and ACAO is `*`; a capability URL closes the read without breaking the opaque-origin sandbox  (critic's recommendation, verified)
- Text-editing surface → **Keep in-place `contenteditable="plaintext-only"` plus a probe MutationObserver that cancels on a runtime re-render** — in-place DOM text gives exact fonts, wrapping and native IME; `plaintext-only` is Baseline since March 2025; an overlay is the canvas-text pattern  (critic's recommendation, verified)
- Port policy → **One editor at a time; fail loudly on `EADDRINUSE`, no auto-pick; derive every host/origin from the bound ports** — the port pair is a security boundary; Vite's `strictPort` exists because silent port moves cause origin mismatches  (critic's recommendation, verified)
### Skipped
- Version-history statements contradict each other — nit
- The watcher's ignore list is not stated — nit

## Round 2 — critic v10, 7/10 (2026-11-23)
**Critic:** plans/v1/critic.v10.md
### Folded in
- [major] Interactive artboards: state the editor cannot reach and reloads that reset it — M1 Interact toggle with a "page reset" notice; Non-goal for holding state across edits (merged with decision r2d1) (§M1, Non-goals)
- [major] "Works without a network" is not true for canvases that use Google Fonts — offline claim narrowed to "except Google Fonts" in Goals, pull step 3 and M0, with a font-not-loaded banner (merged with decision r2d2) (§Goals, Pull step 3, M0)
- [major] The usable loop (pull → edit → push) arrives last — build order M0, M1, M2, M6, M3, M4, M5; cut line now "v1 ships once M0–M2 and M6 are green" (merged with decision r2d3) (§Milestones, Effort)
- [minor] The multi-artboard canvas is an unmade decision — one artboard at a time is the v1 design, the M0 layout check is record-only, multi-board view first in Next (merged with decision r2d4) (§M0 fallbacks, M0 Design canvas branch, Next)
- [minor] Which tree the Layers panel shows on a canvas is undefined — Layers rows come from SourceIndex's template tree on canvases (merged with decision r2d5) (§M1)
- [minor] The asset and support.js fetch skips the scratchpad hand-off — new `edsync cache --from <dir>` verb in the verb list, hand-off contract, pull step 3, push step 3 and the CLI tests (merged with decision r2d8) (§Pull / push, Testing)
- [minor] The kill-bar shrink rule is ambiguous and drops the likely differentiators — per-feature subtraction; M1, M2, M6 always kept (merged with decision r2d6) (§Goals, Kill bar)
### Decisions adopted — Ron to confirm
- Interactive artboards in v1 → **Interact toggle (held `I` or switch), "page reset" notice, style-only undo without a reload; about ½ day in M1** — a canvas/preview toggle is the established answer (Framer Preview, Drupal Experience Builder overlay issue) and the plan already has the event shield; this overrides the concern patch's "no separate no-reload path" for style-only undo  (critic's recommendation, verified)
- Google Fonts when offline → **Narrow the offline claim to "except Google Fonts" with a banner; caching css2/woff2 is Next** — the Design type's one allowed network use; detection keys off the `<link>` error and `FontFace.status`, since `document.fonts.check()` returns true for a family with no `@font-face`  (critic's recommendation, verified)
- Milestone order → **Build M0, M1, M2, M6, M3, M4, M5 (walking skeleton)** — front-loads the only external integration at no extra days  (critic's recommendation, verified)
- Canvas view in v1 → **One artboard at a time at `boards[path]` w×h with a board switcher; multi-board lazily mounted iframes first in Next** — each artboard is its own runtime and iframe; one mounted frame keeps probe routing and hit-testing simple  (critic's recommendation, verified)
- Layers tree source on canvases → **SourceIndex's template tree, not the live DOM** — matches the per-template-node id model; follows Onlook's AST-authoritative mapping  (critic's recommendation, verified)
- Kill-bar shrink rule → **Per-feature subtraction at M0's exit; M1/M2/M6 always kept; stop only if no differentiator survives** — Shape Up scope hammering; unambiguous to apply while Ron is away  (critic's recommendation, verified)
- Probe channel hardening → **MessageChannel port handed over at probe boot; text commits only for editor-opened sessions** — project scripts share the probe's window, so origin/source checks cannot tell forged messages apart; a private port can (MDN, WHATWG web messaging)  (critic's recommendation, verified)
- Asset cache fetch path → **Fetch into the Artifact tool's scratchpad, then `edsync cache --from <dir>` copies into `.editor/cache/` and reports missing transitive `/_blob` ids** — a save outside the default folder prompts per file; staging-then-move is the package-manager pattern  (critic's recommendation, verified)
### Skipped
- Canvas scripts forging probe postMessages (r2c7) — the "considered and rejected" note rejects the MessageChannel port that decision r2d7 adopts this same round; recording both would contradict the plan, so the decision stands and the note was not added
- [nit] The probe's CSP nonce does nothing — nit
- [nit] The M0 partial-publish question is already answered by the tool contract — nit
