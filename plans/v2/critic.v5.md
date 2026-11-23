# Critic v5 — Design Editor v2: the Figma features people reach for next

**Plan reviewed:** plans/v2/plan.md
**Date:** 2026-11-23
**Score:** 8/10. The contracts match the real code and solve real v1 limits. One common flow, copy and then paste with the copied card still selected, nests the copy inside the original. A handful of smaller gaps around undo grouping, focus and previews remain.

---

## TL;DR for Ron

The plan is in good shape. I checked its load-bearing claims against `src/` and they hold:
- `Writer.submit`/`flushAll` and the per-flush undo entry
- `PatchEngine` planning every op against the original text (hence `overlapping patches`)
- `startList`
- `copyWithoutIds`/`cloneInto`/`shapeMismatch`
- `isEditOp`'s non-empty target rule
- `layout.section.tsx:applyWrites` awaiting each op
- `App.tsx:180`'s text-entry filter
- `data-layer-name` as the first name source
- the focusable `[data-canvas-viewport]`

Its biggest strength is the contract stage. Grouping undo by user action, coalescing several declaration ops on one list in a flush, and the server-side paste allow-list fix real weaknesses in v1 before any feature depends on them.

The biggest risk is a UX bug in the paste rule (M8 #4). "If exactly one element is selected and it can hold the fragment, append inside it" means the everyday Mod-C, Mod-V on a card puts the copy inside that same card. Fix that rule before M8.

The rest are minor:
- The undo seal is per file, but the flush still records every file as one entry.
- A refused multi-op action raises one toast per op.
- Clicking a panel button stops Delete working, which is a v1 regression.
- Preview-width measurement flickers during drags.

Ship after fixing the paste rule. Fold in the minors as you go.

---

## Strengths

- **The contracts come first and are grounded in the code.** Contract #3 (seal per `actionId`, fold in `UndoLog.record`) matches how `Writer.flushAll` and `UndoLog` work today. Contract #9 targets the real failure: `orderedSplices` throws `overlapping patches` when two ops touch one declaration list, because every op is planned against the original text.
- **`insertHtml` reuses `duplicateNode`'s machinery.** It mints ids per element, carries them at `indent.length + offset`, attaches the subtree to `shape`, and lets `shapeMismatch` refuse parser fix-ups. That is the right way to keep the whole-tree shape check sound.
- **The paste allow-list is a server-side parse5 walk with an explicit table**, not a UI-side sanitizer. A crafted WebSocket message cannot get around it, and the private MIME type is rightly not treated as proof of origin.
- **One preview and one commit for continuous drags** (`ctx.preview`, then a single `apply` on release). It matches v1's resize tool and keeps the disk quiet.
- **Keyboard matching is specified to the event level**, with AZERTY, QWERTZ, Hebrew and macOS Option tests. The disabled-but-in-scope chord is prevented so Mod-[ and Alt-D never reach the browser.
- **The Electron select-all design** (a custom menu item, a fixed `executeJavaScript` string, a cancelable DOM event, a native fallback) avoids adding a preload bridge to a sandboxed window.
- **Non-goals are sharp.** No `@media` writing, no components and no class creation keep v2 from rewriting the edit pipeline.

## Concerns

### [major] Paste with the copied element still selected nests the copy inside the original  — §M8 #4

**In plain words:** The most common copy-paste is "select a card, copy, paste" to get a second card. Under the plan's rule the card is still selected and a `<div>` can hold a `<div>`, so the paste goes *inside* the original card instead of next to it.

**What:** M8 #4: "if exactly one element is selected and it can hold the fragment (content model), append inside it; otherwise insert after the last selected element." After Mod-C the selection does not change. Mod-V then finds exactly one selected element, the source itself, and the content model allows the fragment, so it appends inside. The same rule also puts a copied `<span>`/`<a>` inside a selected `<p>` or heading, because phrasing content is allowed there. That turns a text-editable leaf into one with inline children, and v1 then refuses text editing on it (`INLINE_CHILDREN`). The Playwright exit only covers "copy two elements and paste them into another container", so it would not catch this.

**Why it matters:** The flow Figma users reach for first produces a nested duplicate that breaks layout. Undo restores it, but the feature feels broken on first use.

**Best-practice options:**
1. **Paste after the source when the selection is the copy source** *(plain words: if what you have selected is what you just copied, paste goes next to it, not into it)*. The UI keeps the last copy's `{board, edIds}` in memory, or inside the private `application/x-design-editor+html` payload as data the server ignores. When the current selection equals that set, paste inserts after the last selected element. Figma separates "paste into the selected frame" from "Paste over selection", which places the object "on top of a selected frame, not inside it" — [Copy and paste objects, Figma Help](https://help.figma.com/hc/en-us/articles/4409078832791). The help article does not spell out the self-selected case, so confirm the exact behaviour by hand. Cheap, local, and no server change. **Pick this.**
2. **Paste inside only for layout containers** *(plain words: only boxes that already hold other boxes accept a paste)*. The selected element must have element children, or be a flex or grid container, and must not be text-editable. Otherwise paste goes after it. This also fixes the `<span>`-into-`<p>` case. Combine it with option 1, because a card with children is still a container.
3. Add Figma's "Paste over selection" (Mod-Shift-V) as an explicit "paste as sibling" command. That is useful on its own but does not fix the default.

### [minor] The undo seal is per file, but `flushAll` still records every file's open batch as one undo entry  — §Contract changes #3

**In plain words:** The plan promises that one undo step never covers two actions. Today's flush writes all boards with pending edits as one undo entry, and the new seal only looks at one file. Two quick actions on two different boards can therefore still be undone together.

**What:** `Writer.submit` seals "when an op's `actionId` differs from the **file's** pending batch". `Writer.flushAll` (writer.ts) loops over every open file and calls `this.options.undo.record({ records, snapshots: flushed.map(...) })` once for all of them. Every board is opened at session start (`session.ts:66`), and switching boards does not flush. So action A on board 1 followed within 300 ms by action B on board 2 leaves both open, and the next flush records them as one entry. The plan says "flushAll drains that queue first … each batch as its own undo entry" but does not say how the files' *open* batches are recorded after the queue is drained. The queue order also stops being action order once a later action on board 1 seals A while B is still open on board 2.

**Why it matters:** It breaks the plan's own invariant ("A flush therefore never spans two actions") and Goal 4 (one undo entry per user action). It is rare in practice, which makes it hard to diagnose when it does happen.

**Best-practice options:**
1. **Seal writer-wide** *(plain words: any new action closes every open batch, not just the one in its own file)*. In `submit`, when `op.actionId` differs from the writer's last-seen `actionId`, move every file's `open.pending` onto the sealed queue in the order they were first touched. Yjs follows the same model: `stopCapturing()` is one call on the `UndoManager` that ends the current capture for its whole scope ([Y.UndoManager, Yjs docs](https://docs.yjs.dev/api/undo-manager)). A one-line rule change. **Pick this.**
2. Keep the per-file seal, but have `flushAll` group the remaining open batches by `actionId`, one entry per id. That is correct too, but it spreads the rule across two places.
3. Add a Writer test that submits A on file 1 and B on file 2 inside one debounce, then expects two entries in A-then-B order.

### [minor] A refused multi-op action raises one error toast and one reload per op  — §Contract changes #3, #6 (ws-client)

**In plain words:** v2 often sends several edits as one action, such as moving five elements or the radius join. If the server refuses that batch, the UI shows the same error once for every edit in it, and reloads the canvas each time.

**What:** `Writer.reject` sends a `rejected` message for every opId in the batch. `ws-client.ts:settleRejection` calls `store.toast(...)` and, for a previewed op, `reloadFrame()` once per opId. The plan adds `actionId`, so all of an action's ops share a flush and are refused together. A five-element align or multi-nudge refused by one locked or `{{hole}}` element shows ten identical toasts. The plan requires one toast for a rejected paste, but says nothing for other multi-op actions.

**Why it matters:** The canvas flickers and the toasts pile up on exactly the multi-select features v2 adds.

**Best-practice options:**
1. **Dedupe by `actionId` in the ws client** *(plain words: one action, one toast)*. Keep `actionId` on each pending op. On rejection, toast and reload only for the first op of that action that settles, and resolve the others silently. Toast libraries do this with a stable toast id. TanStack's site passes Sonner's `id` so repeats replace each other instead of stacking ([TanStack/tanstack.com PR #1095](https://github.com/TanStack/tanstack.com/pull/1095)), and Chakra's docs say the id is mostly used "when you need to prevent duplicate" ([Chakra UI Toast](https://chakra-ui.com/toast)). **Pick this.**
2. Have the server send one `rejected` per action carrying all the opIds. That is cleaner on the wire but changes the protocol shape the plan otherwise keeps.

### [minor] Delete, Backspace and the arrow keys stop working after a click on a properties-panel control, which regresses v1  — §Contract changes #1

**In plain words:** In v1, Delete removes the selection unless you are typing in a field. In v2, Delete only works when the canvas or the layers panel has focus. After you click a toggle in the properties panel, focus stays on that button, and Delete silently does nothing.

**What:** v1 binds `layer.delete` to `Delete` with no scope, so it fires anywhere `isTextEntry` is false. Contract #1 makes Delete/Backspace `['canvas', 'layers']`, and `'canvas'` matches only inside `[data-canvas-viewport]` or on `document.body`. Panel buttons (the segmented toggles in `layout.section.tsx`, `ToggleButton`) are focusable `<button>`s and keep focus after a click. The scope check is right for Enter, Escape and the arrows, which a focused button needs for itself. It costs Delete and the Shift-letter commands for no gain, since a `<button>` has no use for Delete.

**Why it matters:** Goal 4 says nothing in v1 gets worse. "Select, tweak a property, press Delete" is a common flow, and it would fail with no feedback.

**Best-practice options:**
1. **Hand focus back to the canvas after a pointer press on a non-text panel control** *(plain words: clicking a panel button doesn't steal the keyboard from the canvas)*. On `pointerup` of a button or toggle in the properties panel, call `viewport.focus({ preventScroll: true })`. Keyboard users who Tab into the panel keep their focus. tldraw keeps its own "editor focus" separate from DOM focus, says the browser's focus cannot be relied on to decide whether shortcuts work, and refocuses the container so shortcuts keep working ([Focus, tldraw docs](https://tldraw.dev/sdk-features/focus)). **Pick this.**
2. Add a `'panel'` scope that matches a focused non-text control in the properties panel, and give it to Delete/Backspace and the Shift-letter commands. That keeps the DOM focus as it is, at the cost of one more scope.
3. Extend the registry test so Delete fires with a properties-panel `<button>` as `event.target`.

### [minor] Preview-width height measurement resizes the frame on every DOM mutation, including drag previews  — §M11 #8

**In plain words:** To avoid an endless-growth loop, the plan shrinks the canvas frame back to the board's height before each measurement. It measures on every DOM change, and a drag changes the DOM on every mouse move. So while you drag at a preview width, the frame shrinks and regrows every frame, and the positions you snap to come from a frame of the wrong size.

**What:** The measurement is "taken with the frame held at `board.h`, only on a preview-width change or a DOM mutation." `previewDecl` writes inline styles in the frame, which is an attribute mutation. The colour square, number scrubbing, move and resize all preview on every pointermove. The resize is asynchronous across the MessagePort (the editor resizes the iframe, the probe measures, the editor resizes again), so each move costs a visible collapse and regrow. Any `rects` or `snapRects` read that lands during that window measures `vh`-based layout at `board.h`.

**Why it matters:** Editing stays enabled at preview widths on purpose (decided r2), and that is exactly when this produces flicker and snapping that jumps around.

**Best-practice options:**
1. **Measure only on settled changes** *(plain words: re-measure when an edit is saved or the width changes, not while you drag)*. Trigger on preview-width change, frame `ready` and acks or reloads, and ignore mutations caused by `previewDecl` (the probe knows which mutations it made). A guard that skips the resize when the height has not changed is the standard fix for this loop. iframe-resizer's maintainers describe `vh` growth inside iframes as a browser limitation with no simple workaround ([iframe-resizer issue #163](https://github.com/davidjbradshaw/iframe-resizer/issues/163); [iframe-resizer upgrade notes](https://iframe-resizer.com/upgrade)). Drupal Canvas hit the same unbounded growth from `vh` sections ([Drupal Canvas #3591832](https://git.drupalcode.org/project/canvas/-/work_items/3591832)). **Pick this.**
2. Measure in a hidden second iframe at `board.h`. That gives no flicker but doubles the probe and loading cost.
3. Grow only, never shrink, until the width changes. That is simple, but it leaves the frame too tall after content is deleted.

### [minor] "Container background" versus "leaf" is undefined for marquee, so text with inline children starts a marquee  — §M9 #1

**In plain words:** The plan decides between "drag to move" and "drag to box-select" by whether the deepest thing under the mouse has children. A paragraph with one bold word does have a child, so dragging on its plain text starts a box selection over its inline pieces instead of selecting and moving the paragraph.

**What:** The marquee starts when "the deepest hit is the container itself, not one of its children", and its candidates are "that container's element children". A `<p>` with a `<strong>`, an `<a>` wrapping a `<span>`, or a button with an icon is a container by that reading. A press on the bare text of such a `<p>` hits the `<p>`, so it marquees its phrasing children. A plain `<p>` with no inline children is a leaf, which `clickSelection` maps to the top-level ancestor (`scopedTarget` → `path[1]`) and then moves. Two paragraphs that look the same react differently, which is the inconsistency the r1/r2 rationale wanted to avoid.

**Why it matters:** Rich text is everywhere in HTML boards. Ron is to try this in the M9 build, but the rule an implementer codes from is ambiguous today.

**Best-practice options:**
1. **Define "container" as a box that lays out blocks** *(plain words: only layout boxes start a box-select; text-ish elements always act like leaves)*. The hit has at least one element child that is not phrasing content, or its computed `display` is flex, grid or block-with-block-children, and the hit is not text-editable or a phrasing parent. Everything else is a leaf. This is a local rule; no external pattern applies beyond Figma's sections and top-level frames, which the plan already cites. **Pick this.**
2. Treat any hit whose `TemplateNode` is text-like (`p`, `h1–h6`, `a`, `button`, `li`, `span`) as a leaf by tag. Simpler, but brittle for `div`-based text.

### [minor] The Electron key and clipboard paths are never exercised by a test  — §Testing, §M8 #2, §M8 #4

**In plain words:** The desktop app is one of the three targets, but every automated end-to-end test runs in Chrome or Edge. The parts that only exist in Electron have no running test: the custom Select All menu item, and copy and paste going through the Edit menu's roles.

**What:** In Electron, Mod-C/X/V go through the Edit menu's `role: 'copy' | 'cut' | 'paste'` (`main.ts:108`), which run the native command in the focused frame rather than the browser's own key handling. M8 #4 relies on the DOM `copy`/`paste` events firing with focus on a non-editable canvas `div`. M8 #2's `executeJavaScript` / `dispatchEvent` / `selectAll()` fallback is only unit-tested over the menu template.

**Why it matters:** Goal 4 lists the Electron app. A regression there (paste doing nothing on the canvas in the desktop app, or select-all hitting the native selection) would only show up by hand.

**Best-practice options:**
1. **Add a small Playwright Electron suite** *(plain words: launch the real desktop app in a test and press the menu items)*. Use `_electron.launch` ([Playwright: Electron](https://playwright.dev/docs/api/class-electron)), click menu items with `electron-playwright-helpers` ([spaceagetv/electron-playwright-helpers](https://github.com/spaceagetv/electron-playwright-helpers)), and check the clipboard through `electronApp.evaluate` as Playwright's own Electron tests do. Electron's guide recommends Playwright for this ([Automated Testing, Electron docs](https://electronjs.org/docs/latest/tutorial/automated-testing)). Cover: Mod-A on the canvas selects layers, Mod-A in a field selects text, and Mod-C then Mod-V on the canvas pastes. **Pick this.**
2. Add a manual checklist to the M8 exit, the way the plan already does for Mod-Shift-A in Chrome and Edge. Cheaper, but it is not repeatable.

### [nit] Stripping every `id` on paste breaks internal SVG references  — §Contract changes #2

**In plain words:** Pasted SVG icons often point at their own parts by id, such as a gradient or a clip path. Removing all ids leaves those pointers dangling, so the icon renders wrong.

**What:** The allow-list permits "basic inline SVG shapes" and `#` URLs, then strips every `id` "exactly as `duplicateNode` does". `fill="url(#g)"`, `clip-path="url(#c)"`, `<use href="#…">`, `aria-labelledby` and `<label for>` lose their targets. It also drops the layer name for elements named only by `id`, since `data-layer-name → id → class → tag` is the naming order (`template-tree.ts:62`).

**Best-practice options:**
1. **Rewrite ids with a unique per-paste prefix, and rewrite references inside the fragment to match** *(plain words: rename instead of delete)*. This is SVGO's `prefixIds` approach ([prefixIds, SVGO docs](https://svgo.dev/docs/plugins/prefixIds/)), with a per-instance prefix as SVGO issue #674 recommends for repeated pastes ([svg/svgo #674](https://www.github.com/svg/svgo/issues/674)). **Pick this if SVG paste matters.**
2. Keep stripping, but refuse fragments that contain internal `url(#…)` or `href="#…"` references, with a toast. Honest, and it costs nothing.

### [nit] The colour picker's gamut handling is unspecified for oklch values outside sRGB  — §M10 #1

**In plain words:** The picker square works in ordinary screen colours (sRGB). An authored `oklch()` colour can be more vivid than sRGB, and moving only the alpha slider could quietly dull it.

**What:** The square and the hue slider are HSV in sRGB. The plan keeps the authored notation and tests round-trips, but does not say what happens to an out-of-gamut `oklch` or `color(display-p3 …)` value when one channel changes.

**Best-practice options:**
1. **Change only the channel the user touched in the authored space, and gamut-map only what the square shows** *(plain words: don't recompute what you didn't edit)*. Use a library with CSS Color 4 gamut mapping, such as Color.js `toGamut({ space: 'srgb', method: 'oklch.chroma' })` ([Color.js gamut mapping](https://unpkg.com/colorjs.io@0.0.3/docs/gamut-mapping.md)). Show an "outside sRGB" mark the way Color.js's docs do. **Pick this.**
2. Clip to sRGB and warn. The CSSWG notes that clipping P3 to sRGB looks fine in practice ([CSSWG Gamut Mapping Breakout](https://lists.w3.org/Archives/Public/www-archive/2024Mar/att-0006/CSSWG_Gamut_Mapping_Breakout.pdf)), but it still rewrites the author's value.

### [nit] The key-matching rule is written three times, and the copies already differ  — §Contract changes #1, §Testing, §Risks

**In plain words:** The same tricky algorithm appears in three places with slightly different wording. Whoever implements it has to guess which copy is the real one.

**What:** Contract #1 says a Windows Ctrl+Alt chord is *skipped entirely* while `AltGraph` is set, and that macOS Option alone triggers the code fallback. Testing says the fallback runs only when "a modifier is held outside AltGr". Contract #1 also says the order follows "CodeMirror's rule", but CodeMirror's fallback deliberately excludes macOS Option alone, `!(browser.mac && event.altKey && !(event.ctrlKey || event.metaKey))` ([codemirror/view keymap.ts](https://github.com/codemirror/view/blob/main/src/keymap.ts)). The plan's inclusion of Option alone is a deliberate difference, not CodeMirror's rule. Contract #8 and M8 #4 likewise repeat the `BoardIndex.text`/`rules` decision. Contract #1 is one ~70-line paragraph that mixes three decision rounds.

**Best-practice options:**
1. **State the matching algorithm once, as a numbered list in contract #1, and have Testing list only the cases** *(plain words: one source of truth)*. Note the Option-alone difference from CodeMirror explicitly. This is a local fix; no external pattern applies. **Pick this.**

---

## Decisions Ron needs to make

1. **Paste target when the copied element is still selected** (hidden decision): inside it, or after it. **Recommend after it, and paste inside only layout containers** (the major concern above).
2. **Focus after panel clicks** (hidden decision): return focus to the canvas after a pointer press on non-text panel controls, or add a `'panel'` scope for Delete and the Shift-letters. **Recommend returning focus**, the tldraw model.
3. **What counts as a "container" for marquee** (decided r1/r2/r4; Ron tries it in the M9 build): confirm nested containers marquee on first drag, and pick a container definition that excludes text with inline children. **Recommend layout boxes only.**
4. **Undo seal scope** (hidden decision): writer-wide or per file. **Recommend writer-wide**, so one action is one entry across boards.
5. **Cross-board paste loses class rules** (decided r4: accept, with a toast listing missing classes). Agree. Copying rules needs selector matching the server does not have.
6. **Mod-Shift-O and Mod-Shift-A may be taken by Chrome or Edge** (decided Ron r1 / r3: palette fallback, no second alias). Agree, provided the hand check before M8 closes actually runs.
7. **Confirm the "decided: Claude 2026-11-23" items**: `removeAttr` as an attribute op, `setEditorStyles`, the view and editor-state setters, the validators, and the align rules (single flex child only). They are sound, but they are Claude's calls awaiting yours.
8. **Effort and budget**: 12½ days, with the contract stage at 3½. M10 (a colour picker with four notations plus the eyedropper, a shadow list editor, radius, effects, stroke, text and auto-layout additions) in 3 days is the tightest estimate. Confirm, or split M10 across two waves.

---

## Verdict

**Ship after addressing blockers.** There are no blockers. Fix the M8 #4 paste rule (the one major) before M8 starts, and fold the minors into their milestones. The contracts are sound and verified against the code.
