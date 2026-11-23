# deep-critic log — Design Editor v2 — the Figma features people reach for next

This file is the audit trail of what deep-critic changed in the plan and why.

## Round 1 — critic v1, 5/10 (2026-11-23)
**Critic:** /Users/ronhershkovitz/Projects/design-editor/plans/v2/critic.v1.md
### Folded in
- [blocker] The key registry matches event.key, so many of the new chords can never fire — Testing now specifies code-vs-key matching and tests with real Option/Shift-composed events; layout-map glyphs in the palette (§Testing)
- [major] Several plan claims about the current code are wrong — M11 #3 notes Shift-1/Shift-2 already exist; M11 #8 is a new top-bar control read by frame, fit, outline and rulers. M10 #9 part superseded by the token-binding decision; M10 Exit drops "`var()` binding" (§M10, §M11)
- [major] Undo grouping is a 300 ms time window, not a per-action boundary — Frame selection is one `wrapNode` op with a `style` payload; M9 #2 states the one-op rule and arrow-hold entry (§M8 #6, §M9 #2)
- [major] The paste pipeline is a deny-list, rejects normal clipboard HTML and diverges from Duplicate — merged with the allow-list decision: unwrap CF_HTML/meta/wrappers, strip ids, explicit table; M8 #4 paste shares the path and notes the class-rule limitation (§Contract #2, §M8 #4)
- [major] Marquee start rule cannot be decided when the press happens — merged into the marquee decision: synchronous claim, hit test started at press, sub-threshold press falls through to `selectAt` (§M9 #1)
- [major] More protocol changes than the two the plan lists — added contract #4 `removeAttr` and #5 probe `setEditorStyles`; "five contract changes"; M11 #1 and #4 point at them (§Contract changes)
- [minor] Copy as CSS / HTML from the palette or a context menu cannot use the copy event — they write with `navigator.clipboard.writeText` (§M8 #5)
- [minor] Z-order keys and semantics need tightening — merged into the z-order decision (Figma's per-platform chords, toast when nothing would change) (§M8 #7)
- [minor] Electron menu roles and Windows Ctrl+Alt need an explicit check — Electron Edit-menu `selectAll` becomes an IPC item; risks bullet lists Mod-Alt-G and Mod-Alt-Shift-C as palette-backed (§M8 #2, §Risks)
- [minor] Some property writes silently destroy authored values — Flip negates the authored `scale` factor and removes it only at `1 1` (§M9 #6)
### Decisions adopted — Ron to confirm
- Key aliases and event.code vs event.key matching → **Chords match on event.code for letters, digits and punctuation and on event.key for named keys; every pressed editor shortcut moves into the action registry** — macOS Option/Shift and non-Latin layouts change event.key, so Mod-Alt-C, Mod-Alt-G and Mod-Shift-]/[ could never match; tinykeys and ProseMirror use the physical key with modifiers (critic's recommendation, verified)
- insertHtml with a server-side filter → **A true allow-list table (tags, attributes per tag, URL schemes), run last after unwrapping CF_HTML/<meta> and stripping ids as duplicateNode does, plus a private MIME type as the intra-editor fast path** — the old rule was a deny-list that let `<style>`, `srcset`, `formaction`, `xlink:href` and `url()` through; OWASP says sanitise with a known-good set as the last step (critic's recommendation, verified)
- How undo steps are bounded → **An explicit per-action boundary (an actionId on every op; the Writer closes the undo entry when the actionId changes), plus an optional wrapNode style payload so Frame selection is one op** — a 300 ms window splits wrap-then-style and merges quick commands; Yjs and tldraw add explicit boundaries (critic's recommendation, verified)
- Z-order → **Figma's per-platform chords (⌘]/⌘[ and ⌥⌘]/⌥⌘[ on macOS; Ctrl+]/Ctrl+[ and Ctrl+Shift+]/[ on Windows), and a step that passes the next overlapping sibling in the same paint layer** — Cmd-Shift-]/[ is Chrome's tab switch on macOS, and stepping past a non-overlapping or static sibling changes nothing on screen (critic's recommendation, verified)
- Align for a multi-child flex selection → **Stays disabled; align never writes align-items on the parent (that stays in the Auto Layout section)** — writing on the container would move unselected siblings (Ron's answer)
- Token binding → **Drop "show the token name for a literal value": a pill only for an authored `var(--x)`; M10 #9 adds no new work over v1** — a literal keeps no record of its token and two tokens can share a value; Figma only suggests matches (critic's recommendation, verified)
- Marquee start rule → **A drag on empty canvas or a container's own background marquees that container's children; a drag on an unselected leaf selects and moves it, the mode decided once the hit test returns** — HTML boards are covered in containers, so the M9 exit test needs Figma's drag-inside-a-frame rule at every level (critic's recommendation, verified)
- Outline mode shortcut → **Keep Mod-Shift-O (same as Figma); works in the desktop app, and the action is also in the Mod-K palette** — Chrome and Edge may reserve the chord (Ron's answer)
- Preview width storage → **Per board in `.editor/state.json`, beside zoom, pan and selection; absent when the board shows its authored width** — saved zoom and pan only make sense at that width; Firefox RDM and Figma persist the preview device (critic's recommendation, verified)
### Skipped
- EyeDropper in Electron on Windows — nit
- r1c5 part A (literal-to-token pill in M10 #9) and its Exit wording — superseded by the token-binding decision
- r1c4 "drag on an unselected leaf marquees its siblings and does not move it" — superseded by the marquee decision (leaf drag selects and moves)
- r1c5 part C "never written to `.editor/state.json`" — superseded by the preview-width storage decision

## Round 2 — critic v2, 5/10 (2026-11-23)
**Critic:** /Users/ronhershkovitz/Projects/design-editor/plans/v2/critic.v2.md
### Folded in
- [major] actionId only splits undo entries and never merges them — merged with the undo-coalescing decision: `UndoLog.record` folds a same-`actionId` flush into the top entry; M9 #2 points at it; M9 exit adds the two-flushes-one-entry test (§Contract #3, §M9)
- [major] Copy and the Code tab need source text the UI never receives — new contract #8 (`BoardIndex.text`, `StyleSource.range`), merged with the source-text decision in M8 #4 (§Contract changes, §M8 #4)
- [major] Matching letter shortcuts on event.code sends AZERTY/QWERTZ users into Ctrl+W / Cmd+Q — merged with the key-first decision in contract #1 and Testing; AZERTY, QWERTZ and Hebrew test events added (§Contract #1, §Testing)
- [major] A document-wide registry with no focus scope hijacks Enter, Tab, Escape and arrows — merged with the scope decision: `scope?: 'canvas' | 'layers' | 'global'`, bare keys canvas-scoped, focus-target registry test (§Contract #1)
- [major] insertHtml into the artboard root is refused by the structural guard — `target` is `[]`, parent validated like `moveNode`'s; M8 Playwright adds root and top-level-sibling pastes (§Contract #2, §M8 exit)
- [major] The Electron select-all plan copies an IPC mechanism v1 does not have — merged with the executeJavaScript decision (§M8 #2)
- [major] "Five contract changes" undercounts — added contract #6 action ids and validators, #7 view/editor-state setters; intro no longer counts; Effort contract 1, about 10 days (§Contract changes, §Effort)
- [minor] Multi-element move and marquee need a move-tool rework; settle-before-threshold timing assumed — pointer positions recorded while the hit is pending, nothing replayed; multi-selection tracking named as its own task (§M9 #1, #2)
- [minor] Preview width keeps the board height and lets edits at 375 px change the desktop design — merged with the preview-width decision: height follows content, persistent "Edits apply to all widths" bar; label sentence left as is, the critic's clip-the-height clause dropped for the decision (§M11 #8)
- [minor] Frame selection's layout inference is under-specified — merged with the Frame selection decision: direction + margin-box gap, padding 0, disabled for absolute or non-neighbouring layers (the concern's plain-div fallback for absolute dropped for the decision) (§M8 #6)
### Decisions adopted — Ron to confirm
- How shortcuts match keys → **Key first with a code fallback: an ASCII letter or digit in `event.key` matches as typed; anything else matches on `event.code`** — command shortcuts belong to the key's label (ProseMirror, CodeMirror, VS Code); code-only sends AZERTY Mod+Z/Mod+A to Ctrl+W/Cmd+Q; the fallback keeps macOS Option/Shift and Hebrew working (critic's recommendation, verified)
- How one action becomes one undo step → **Coalesce by actionId in `UndoLog.record`: a same-actionId flush folds into the top entry** — the 300 ms debounce flushes a held key's first nudge alone; tldraw `squashToMark` and ProseMirror/CodeMirror history join at record time (critic's recommendation, verified)
- How the UI gets source text for copy and the Code tab → **`BoardIndex` carries the board's source text; the UI slices it with the same message's ranges** — `clipboardData` is only writable synchronously in the event; `index` is already resent after every edit (critic's recommendation, verified)
- Electron Mod-A routing → **Custom Select All item calls `executeJavaScript` to dispatch a cancelable DOM event, falling back to `webContents.selectAll()`; no preload** — the window is sandboxed with no preload; `before-input-event` cannot see DOM focus (critic's recommendation, verified)
- Editing while a preview width is set → **Editing stays enabled, a persistent "Edits apply to all widths" bar, frame height follows content** — no `@media` editing in v2; Plasmic and Webflow keep edit scope visible; the authored height clips narrow layouts (critic's recommendation, verified)
- Shortcut focus scope → **`scope?: 'canvas' | 'layers' | 'global'` on `EditorAction`, checked against the keydown target before matching or `preventDefault`** — VS Code `when` focus contexts and TanStack Hotkeys scopes; keeps one registry and the conflict test (critic's recommendation, verified)
- Drag on an unselected nested container → **Keep the plan's rule: marquee its children; a selected container moves; Ron confirms after trying the M9 build** — Figma's rule for sections and top-level frames; most HTML containers are block-flow with a null move mode (critic's recommendation, verified)
- Frame selection (Mod-Alt-G) → **Auto-layout wrapper (inferred direction + gap, padding 0), disabled for absolute or non-adjacent selections; Mod-G stays the plain wrap** — Framer Shift-A and Subframe wrap-in-stack; a plain div restacks flex items (critic's recommendation, verified)
- Pasting the board's own data-bound elements → **Keep refusing `{{…}}` holes and `<sc-for>`/`<sc-if>`/`<dc-import>`/`<helmet>` under any MIME type; documented limitation, toast points to Duplicate and drag-reorder** — custom clipboard formats prove nothing about origin (Chrome docs) (critic's recommendation, verified)
### Skipped
- Small correctness notes — nit
- Paste edge cases left open — over verifier cap
- The conflict test only checks the registry against itself, not against browser and OS chords — over verifier cap

## Round 3 — critic v3, 6/10 (2026-11-23)
**Critic:** /Users/ronhershkovitz/Projects/design-editor/plans/v2/critic.v3.md
### Folded in
- [major] The PatchEngine cannot apply multi-declaration edits in one flush — new contract #9 with the planning rules and byte-exact tests; merged with the coalescing decision in #3 (§Contract changes #3, #9)
- [major] Superseded ops make the UI report a false "different value" and reload the frame — `settleAck` compares only the newest pending op per target+prop, no toast/reload/duplicate record for superseded acks; merged into the drag-preview decision; M10 #1 previews through `ctx.preview` (§Contract #6, §M10 #1)
- [major] `insertHtml` with `target: []` is dropped by the validator and cannot be routed by the Writer — payload is `{ before, html }` with `target: [parent]`; only the insertHtml path skips the root refusal (§Contract #2)
- [major] "One held arrow = one undo entry" contradicts "the registry mints one id per run" — `run` receives its id; `hold` actions keep one id across `event.repeat` until keyup/blur; `Writer.submit` seals pending batches synchronously; Writer and registry tests in M9 Exit (§Contract #3, #6, §M9 Exit)
- [major] "Matching `<helmet><style>` rules join `styles`" needs a selector matcher the server does not have — `styles` stays inline-only; rules go in `BoardIndex.rules`; matching moves to a probe read (merged with the Code-tab decision) (§Contract #8, §M8 #4, §M11 #6)
- [major] A disabled shortcut falls through to the browser — in-scope chords are always `preventDefault`-ed, even when `when` fails; merged with the swallow decision (§Contract #1)
- [minor] Scope rules regress v1: Mod-F becomes layers-only, Delete's scope is ambiguous — merged with the scope decision: list scopes, Delete and Shift-letters `['canvas','layers']`, Mod-F global (§Contract #1)
- [minor] Marquee changes v1's select-on-press and needs tool hand-off and cancel APIs — `cancelGesture()` in contract #7; select on hit return with move-tool hand-off via `onPointerDown`; double-click and Escape-mid-marquee tests (§Contract #7, §M9 #1, §M9 Exit)
- [minor] `EditorAction.when` is synchronous, but v2's enable rules need async probe reads — `when` reads only index and selection; layout refusals are decided in `run` and shown as a toast (§Contract #1)
- [minor] Mod-Shift-A (invert selection) collides with Chrome's tab search — listed in Risks with the palette fallback; merged with the Mod-Shift-A decision (§Risks)
### Decisions adopted — Ron to confirm
- How multi-property edits are written → **PatchEngine coalesces every setDecl/removeDecl on one declaration list into one splice per flush; multi-property actions stop awaiting each op** — overlapping per-op splices throw or write `style="; …"`; magic-string and LSP require non-overlapping edits; serial awaits cost 300 ms per property and write intermediate files (critic's recommendation, verified)
- Continuous drags (colour square, scrubbing) → **Preview through `ctx.preview`, one `apply` on release, Escape re-previews the original; `settleAck` checks only the newest pending op per target+prop** — repeated `apply` makes every superseded ack toast and reload; v1 resize, the platform input/change split and tldraw's bailToMark all commit once (critic's recommendation, verified)
- Where rule matching for the Code tab happens → **In the probe with `element.matches()` on the live DOM via a new async `matches` read; `index.styles` stays inline-only** — the server has no selector matcher, putting rules in `styles` would change v1's selector chip, and the live DOM sees `<sc-for>`/`<sc-if>` output (critic's recommendation, verified)
- Disabled shortcuts: swallow or pass through → **An in-scope chord is always prevented even when `when` fails; nothing runs, and the disabled reason toasts when the action has one** — a disabled Mod-[ / Mod-] reaches the browser as Back/Forward and Alt-D focuses the address bar; CodeMirror's `KeyBinding.preventDefault` does the same (critic's recommendation, verified)
- Scope of Mod-F and Delete/Backspace → **Mod-F stays `'global'` and fires from text fields as in v1; Delete/Backspace and bare Shift-letter commands are `['canvas','layers']`** — v1 binds Mod-F on `document` and `layer.delete` globally; narrower scopes would break Goal 4 (critic's recommendation, verified)
- When a click selects under the marquee tool → **Select when the press's `hitTest` returns, as v1's `selectAt` does; a container-background hit is selected only on a click, and a marquee adds to the selection as it was at press** — keeps v1's feel and lets double-click read the selection; tldraw's select tool behaves the same (critic's recommendation, verified)
- Mod-Shift-A in browsers → **Keep Mod-Shift-A with no second alias; hand-check in Chrome and Edge on both OSes before M8 closes, palette entry as fallback** — tab search is not in Chromium's reserved commands, so the page gets the keydown first (critic's recommendation, verified)
- Effort re-baseline → **Contract stage split into C1 (undo/actionId, ~1½ d), C2 (shortcut registry, ~1 d), C3 (new ops/probe/index, ~1 d); about 12½ days, v2 scope kept** — the contract changes touch about a dozen files and cannot land as one task with one owner per file; cutting features would not shrink this work (critic's recommendation, verified)
### Skipped
- Alt-letter glyphs and keys differ on AZERTY Mac vs Windows — nit
- The Windows AltGraph guard may disable every Ctrl+Alt chord — over verifier cap
- The contract stage is underestimated and bundles too much into one task — over verifier cap (the effort decision above re-baselines the stage anyway)

## Round 4 — critic v4, 6/10 (2026-11-23)
**Critic:** /Users/ronhershkovitz/Projects/design-editor/plans/v2/critic.v4.md
### Folded in
- [major] Matching all punctuation on event.code sends zoom keys to z-order and the palette on non-US layouts — key-first for every printable key, code fallback only when nothing matched and a modifier is held; M8 #7 reworded; QWERTZ/AZERTY/US punctuation tests added (§Contract #1, M8 #7, Testing; merged with decision r4d1)
- [major] insertHtml would fail the existing shape check — planned like `duplicateNode`: parse in parent context, mint and carry an id per element, attach to `shape`; parser fix-ups refused; `mintedIds` holds the whole subtree (§Contract #2)
- [major] Sealing on every new actionId splits a held ArrowUp in a field into one undo entry per step — field stepping gets a hold id (mint on non-repeat keydown, reuse while `repeat`, drop on keyup/blur), with a test (§Contract #6; merged with decision r4d2)
- [minor] Mod-F declared 'global' but must fire from a text field — text-entry check moves into the registry with an `inTextEntry` flag that only Mod-F sets; test for both cases (§Contract #1)
- [minor] Contracts #3 and #9 describe declaration coalescing two different ways — #9 now builds one splice from set and removed declarations, per #3; new remove-first-and-last-set-middle test (§Contract #9)
- [minor] Sealed batches unspecified on pause, discard and write-failure paths — one writer-wide ordered queue; `hasPending`, `paused`, discard, board removal and failed writes defined (§Contract #3)
- [minor] Preview-width auto height can loop with vh content — height capped at 4x board.h, measured with the frame held at board.h, never on its own resize; 110vh test (§M11 #8)
- [minor] The Code tab will hide :hover, :focus and ::before rules — pseudo-classes and pseudo-elements stripped before `matches()`, rule listed with a state label (§M11 #6)
### Decisions adopted — Ron to confirm
- Key-matching rule for punctuation → **Key first for every printable key; fall back to the US character for event.code only when nothing matched, a modifier is held and the key is not an ASCII letter or digit** — ProseMirror and CodeMirror look up event.key first and retry the base key only with a modifier; code-first sends QWERTZ Ctrl+"+" to Bring forward; Mod-+ alias added for QWERTZ zoom in (critic's recommendation, verified)
- Undo grouping for held field steps and rapid single-shot edits → **Hold-style action id for field stepping; ops without an id never merge by time** — matches tldraw's onKeyDown/onKeyRepeat nudge; a time window would bring back timing-based undo (critic's recommendation, verified)
- Nested-container drag behaviour → **Keep the rule: an unselected nested container marquees its children, a selected one moves or reorders; Ron confirms in the M9 build** — Figma does this for sections; choosing by move mode would make look-alike boxes behave differently (critic's recommendation, verified)
- Confirm the Claude-made decisions tagged (decided: Claude 2026-11-23) → **All five confirmed; removeAttr planned as an attribute op beside setAttr, not a structural one** — a structural kind would hit the artboard-root refusal and `requireRow`, so the root's layer name could not be cleared (critic's recommendation, verified)
- Cross-board paste drops <helmet><style> class rules → **Accept the loss for v2; paste succeeds and shows one toast naming classes the target board's rules never name** — rename-on-conflict (Webflow) needs a selector matcher the server lacks; a silent loss is the worst outcome (critic's recommendation, verified)
- Effort of about 12½ days with a 3-day contract stage → **Keep the estimate and the 3-task stage; the round-4 fixes go into C1/C2/C3** — each fix changes a contract a feature depends on and reuses an existing mechanism (critic's recommendation, verified)
### Skipped
- Two probe protocol additions are missing from the contract list — nit
