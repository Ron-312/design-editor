# Critic v2 — Design Editor v2: the Figma features people reach for next

**Plan reviewed:** plans/v2/plan.md
**Date:** 2026-11-23
**Score:** 5/10 — the feature choice and the byte-exact discipline are right, but several load-bearing mechanics (undo grouping, copy, root paste, Electron select-all, shortcut scope) do not work against the code as it is today, and the contract list misses about half of the plumbing the features need.

---

## TL;DR for Ron

The feature set is well chosen and the plan is careful in the right places: a server-side allow-list for pasted HTML, `removeAttr` for byte-exact rename undo, and z-order that only acts on overlapping siblings. The biggest strength is that every new control writes plain CSS/HTML through the existing pipeline. The biggest risk is that the plan describes how things *should* work in a few places where the code works differently, and I checked each one:
- Pasting at the top level of a board is refused by the existing guard against restructuring the artboard root.
- The UI never has the file's source text, so the synchronous `copy` event can't put it on the clipboard.
- The `actionId` rule can split undo steps but never merge them, so a held arrow key still makes two or more undo entries.
- v1 has no Electron IPC or preload to copy "as v1 did for undo".
- Moving Enter, Tab and the arrows into the document-wide registry would break buttons, layer rows and Tab focus.

None of these are hard to fix, but each needs a decision or a new contract item before implementation starts. **Revise and re-review.**

---

## Strengths

- **The edit pipeline stays the same** (§What stays the same). Every feature goes through SourceIndex → PatchEngine → Writer as setDecl, removeDecl, setAttr or a structural op, so byte-exact write-back and the snapshot undo carry over without new code.
- **Paste safety is designed server-side** (§Contract 2). It uses an explicit parse5 allow-list instead of DOMPurify, reuses `copyWithoutIds`, and refuses `<helmet>`, `<sc-*>`, `<dc-import>` and `{{…}}`. That is the right threat model for a ws channel the UI does not fully control.
- **`removeAttr` is introduced for a real reason** (§Contract 4). I confirmed that `setAttrSplice` (`src/server/edit/text-splice.ts:61`) only inserts or replaces, so clearing a name could not otherwise restore the original bytes.
- **Z-order respects layout** (§M8 #7). It uses a DOM move for absolutely positioned elements and `z-index` for flex or grid items, and only steps past overlapping siblings in the same paint layer, so the editor never writes a change that does nothing visible.
- **Wrap and layout are one op** (§M8 #6, §Contract 3). The `style` payload on `wrapNode` avoids depending on the minted id. That matches how `wrapNode` mints and carries the wrapper id today (`structural-ops.ts:wrapNode`).
- **Several decisions are explicit.** Token binding stays as v1 built it, and align never writes `align-items`. Both remove scope instead of adding it.
- **The two layout-line claims I checked are accurate:** `CanvasView.tsx:426-427` (Shift-1 and Shift-2) and `fields.tsx:331` (`tokenValue`).

## Concerns

### [major] `actionId` only splits undo entries and never merges them, so one held key or slow action still makes several entries  — §Contract 3, §M9 #2
**In plain words:** The plan promises "one undo step per user action". The mechanism it describes only stops two actions from sharing a step. It does nothing to stop one action from being split across two steps when the 300 ms save timer fires in the middle of it.

**What:** `Writer.armDebounce` (`src/server/edit/writer.ts`) flushes after 300 ms of quiet, and every `flushAll` calls `UndoLog.record` as a new entry. A held arrow key sends its first nudge on keydown. The OS key-repeat delay comes next: about 500 ms by default on Windows, and often longer than 300 ms on macOS. The first nudge is therefore flushed and recorded alone, and the repeats become a second entry. The `actionId` is identical across both flushes, but nothing merges them. The same happens to a multi-element nudge whose `readDragPlan` probe reads (one per element per repeat, `move.tool.ts:nudge`) straddle a flush. The plan's sentence "a held arrow key makes one entry from keydown to keyup" is false under the mechanism it specifies.

**Why it matters:** Goal 4 ("one undo entry per user action") fails in the exact case M9's exit test names: nudge two absolute elements and undo once. The test may pass on a fast CI machine with synthetic key events and fail for real users.

**Best-practice options:**
- **Coalesce by actionId in `UndoLog.record` (pick).** *Plain words: if the new save belongs to the same action as the last undo step, fold it into that step instead of adding one.* When the top entry's `actionId` equals the new one, merge the records, keep each file's earliest pre-image snapshot, and take the latest `postWriteHash`. This is tldraw's model: changes accumulate until the next stopping point, and `squashToMark` folds everything since a mark into one step. Small, local, and it keeps the debounce purely a write-batching device. (tldraw, "History (undo/redo)", https://tldraw.dev/sdk-features/history)
- **An explicit `endAction` message, with the Writer holding pending ops until it arrives.** *Plain words: the UI says "action finished" and nothing is saved before that.* This is Yjs's `stopCapturing()` boundary without the timeout. Its downside is that a lost keyup (window blur mid-hold) leaves edits unsaved, so it needs a timeout fallback anyway. (Yjs docs, "Y.UndoManager", https://docs.yjs.dev/api/undo-manager)
- The two can be combined. Coalescing alone is enough for correctness.

### [major] Matching letter shortcuts on `event.code` sends AZERTY/QWERTZ users into browser-reserved keys (Ctrl+W, Cmd+Q)  — §Contract 1 (decided: deep-critic r1), §Testing
**In plain words:** Matching by key *position* means a French user who presses the key labelled "Z" to undo gets nothing. The key in the QWERTY "Z" position is labelled "W" on their keyboard, and Ctrl+W closes the browser tab. The palette's own glyphs, taken from `getLayoutMap()`, would even tell them to press Ctrl+W.

**What:** The decision trades "letter shortcuts follow QWERTY positions on AZERTY or QWERTZ" for robust Option and Shift handling. It underrates what that trade costs. On AZERTY the QWERTY positions of Z, A and Q are labelled W, Q and A, so the editor's Mod+Z, Mod+A and Mod+Shift+A land on the user's Ctrl/Cmd+W, Cmd+Q and so on. Those are browser and OS chords a page cannot override: Ctrl+W closes the tab and Cmd+Q quits Chrome. On QWERTZ, Mod+Z (undo) moves to the key labelled Y. Ron types Hebrew, and there `event.key` is a Hebrew letter, so the code fallback is genuinely needed. That argues for a hybrid, not for matching on code only.

**Why it matters:** Undo, select-all and delete are the core of Goal 1. On common European layouts they either do nothing or close or quit the app.

**Best-practice options:**
- **Key first, code fallback (pick).** *Plain words: use the letter the user's keyboard actually typed, and look at key position only when that letter isn't a plain Latin one.* If `event.key` is a single ASCII letter or digit, match on it. If it is non-ASCII (Option-composed `å`, Shift symbols, Hebrew or Cyrillic letters), match on `event.code`. Punctuation shortcuts (`[`, `]`, `=`) keep code matching. This fixes AZERTY and QWERTZ, keeps macOS Option and Shift working, and keeps Hebrew working. Palette glyphs then show the key's label for letters. (javascript.info "Keyboard: keydown and keyup", https://javascript.info/keyboard-events; Mozilla Hacks "Internationalize your keyboard controls", https://hacks.mozilla.org/2017/03/internationalize-your-keyboard-controls/)
- Code-only plus a per-layout remap table, as `keyboard-i18n` does. Its downside is a table to maintain for every layout.
- Code-only as decided, plus a test that asserts no binding maps onto a reserved chord on the AZERTY and QWERTZ layout maps. That fixes the worst failure but still leaves French undo on the "W" key.

### [major] A document-wide registry with no focus scope will hijack Enter, Tab, Escape and the arrows from buttons, layer rows and focus navigation  — §Contract 1
**In plain words:** Today Enter, Tab, Escape and the arrows only do canvas things when the canvas has focus. The plan moves them into the global shortcut list, which fires wherever focus is except text fields. Pressing Enter on a focused button or layer row, or Tab to move between controls, would run a canvas command instead.

**What:**
- `CanvasView.onKeyDown` is attached to the canvas `div` (`tabIndex=0`, `CanvasView.tsx:478-481`).
- The arrow-nudge listener checks `isOnCanvas(event.target)` (`move.tool.ts:nudgeOnArrow`).
- The registry is called from a `document` keydown listener that skips only `input, textarea, select` and contentEditable (`App.tsx:72,180`). `registry.handleKeyDown` calls `preventDefault()` on every match.
- Layer rows handle Enter and Space themselves without stopping propagation (`LayersPanel.tsx:322-345`), and the TopBar menus close on Escape (`TopBar.tsx:49`).

Once Enter, Tab, Escape and the arrows move into the registry, Enter on a focused layer row both toggles the row and selects a child. Enter on any `<button>` is cancelled. Tab can no longer move focus anywhere in the app.

**Why it matters:** It breaks keyboard access to every panel and makes the editor unusable without a mouse. `EditorAction.when(ctx)` cannot express "only when the canvas is focused" because it never sees the event target.

**Best-practice options:**
- **Focus contexts on actions (pick).** *Plain words: each shortcut says where it is active — on the canvas, in the layers list, or anywhere.* Add `scope?: 'canvas' | 'layers' | 'global'` to `EditorAction`, or pass the event target into `when`, and have the registry check `event.target.closest('[data-canvas-viewport]')` and similar. This is VS Code's `when` clause model with `editorTextFocus`, `listFocus` and `inputFocus`. (VS Code "When clause contexts", https://code.visualstudio.com/api/references/when-clause-contexts)
- Leave Tab, Enter and Escape in CanvasView as canvas-local keys and only *list* them in the conflict test, as the plan already does for Space and I. That is less uniform but zero-risk. The WAI-ARIA APG warns against shortcuts that take over Tab, Enter or Escape outside their own component. (W3C APG "Developing a Keyboard Interface", https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)

### [major] Copy (and the Code tab) need source text the UI never receives, and the `copy` event must be answered synchronously  — §M8 #4, §M11 #6
**In plain words:** The plan copies "the selected elements' source text from the SourceIndex ranges". Those ranges live on the server; the browser side only has offsets, not the file's text. Copy also has to put data on the clipboard *inside* the copy event, so there is no time to ask the server.

**What:** `BoardIndex` (`src/shared/protocol.ts`) carries `tree`, `locations`, `styles` and `frameSrc`, but no file text. The served iframe document has `data-ed-id` stamped on every element (`serve-transform.ts:stampId`), so it is not the source either. `clipboardData.setData` only works synchronously inside the ClipboardEvent handler. The Code tab ("exact source text with `file:line`") has the same gap: `StyleSource` has parsed declarations, not the rule's original text with its comments and spacing.

**Why it matters:** M8 #4 and M11 #6 cannot be built as written, and the fix is a protocol change that is not among the "five contract changes".

**Best-practice options:**
- **Ship the file text with the index (pick).** *Plain words: send the board's raw text to the UI along with the tree, so the UI can cut out any element or rule itself, instantly.* Add `text: string` (or per-element source slices) to the `index` message. Boards are small, it is already resent on every change, and both copy and the Code tab become pure slicing. (MDN "Element: copy event", https://developer.mozilla.org/docs/Web/Events/copy — the sync API works only within the ClipboardEvent handler)
- Async `navigator.clipboard.write([new ClipboardItem({ 'text/html': promise })])`, where a Promise value lets the write start inside the user gesture while the server answers. This loses the private-MIME path (async custom types need the `web ` prefix) and adds a round-trip. (MDN "ClipboardItem()", https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem/ClipboardItem)

### [major] `insertHtml` into the artboard root, and therefore any top-level paste, is refused by the existing structural guard  — §Contract 2, §M8 #4
**In plain words:** The plan's default paste target ("nothing selected → append to the artboard root", or "insert after the last selected element", whose parent is often the root) is exactly the case the current engine refuses with "the artboard root can't be restructured".

**What:** The plan says `insertHtml`'s target is `[parent]`. `Flush.planStructural` (`patch-engine.ts:317-321`) runs `requireRow(id)` and `if (id === this.indexed.tree?.edId) refuse(READ_ONLY['artboard-root'])` on every structural target. `moveNode` avoids this only because its parent travels in the *payload*. The ack also gives every structural op the *flush-wide* `minted` list (`writer.ts:acks`), while the plan wants only the new top-level elements.

**Why it matters:** Paste into an empty selection, or after a top-level section, fails for the most common board shape. The paste exit test ("paste them into another container") would pass while root-level paste is broken.

**Best-practice options:** No external pattern applies; this is local. **Make `insertHtml` take `target: []`-free semantics:** put the parent in the payload, which the plan already has, and validate it as `moveNode` validates `payload.parent`. That means `requireRow(parent)` without the artboard-root refusal, plus the content-model check. Also return `minted` per op (top-level ids in a separate field), and mint ids for every inserted element so the shape check and layers see them. Add a Playwright case: paste with nothing selected.

### [major] The Electron select-all plan copies an IPC mechanism v1 does not have  — §M8 #2
**In plain words:** The plan says to send a message to the page "as v1 did for undo". v1 did no such thing: it simply left the Undo/Redo items out of the menu. The app also has no bridge script that could receive such a message.

**What:** `src/desktop/main.ts:buildMenu` documents "No Undo/Redo roles: Mod-Z must reach the editor" and just omits them. The `BrowserWindow` has `contextIsolation: true, sandbox: true` and no `preload`, so there is no `ipcRenderer` in the page. A custom menu item's `click` cannot reach the renderer without new plumbing.

**Why it matters:** This is a factual error about the code, and it hides a new desktop-side change: a preload script and a `contextBridge` API, with their own security review. That work is not in the effort estimate or in any test.

**Best-practice options:**
- **Menu `click` → `webContents.executeJavaScript` dispatching a DOM event (pick).** *Plain words: the menu item runs one line in the page that says "select-all was pressed", and the page decides whether that means text or layers.* It needs no preload, keeps the sandbox intact, and is a one-function change. (Electron "MenuItem", https://www.electronjs.org/docs/latest/api/menu-item — a `role` ignores `click`, so the role must be replaced)
- Add a preload with `contextBridge.exposeInMainWorld('editorMenu', { onSelectAll })`. This is the canonical route, but it introduces a preload where none exists.
- `webContents.on('before-input-event')` in main, intercepting Cmd/Ctrl+A before the page. Main cannot tell whether a text field is focused, so this does not fit. (Electron "Keyboard Shortcuts", https://electronjs.org/docs/latest/tutorial/keyboard-shortcuts)

### [major] "Five contract changes" undercounts: the features need about five more cross-cutting API changes  — §What stays the same, §Contract changes
**In plain words:** The plan says new features are "just new tools, sections and actions" once the five contract changes land. Several features need things plugins currently have no way to do: preview a colour without saving it, tag edits with the action they belong to, switch tool or zoom from an action, and change editor-only state such as collapsed layers or preview width.

**What:** `EditorContext` (`src/ui/plugin-api.ts`) has:
- `apply(op)`, which always sends to the server, and no preview-only call. M10 #1 needs "previews live, commits once on release".
- No way to attach an `actionId` to `apply`. Contract 3 says every op carries one but not how tools mint or pass it.
- No setters for mode (V/H), fit and zoom (Shift-0/1/2, Mod-=), or editor state (collapse all, outline, preview width). v1 already works around this by clicking DOM buttons (`layer.actions.ts:toggleEditorState`).

On the server, `client-message.ts:PAYLOAD_CHECKS` is a closed `Record<EditKind, …>` that drops unknown kinds and fields, so `insertHtml`, `removeAttr`, `wrapNode.style` and `actionId` all need validator changes. That is mechanical but belongs in the contract task.

**Why it matters:** The contract task is sized at ½ day. These changes touch `plugin-api.ts`, `App.tsx`, `store.ts`, `ws-client.ts` and the validators, which are exactly the shared files the "one owner per file" wave rule will serialise. The ½-day figure is unrealistic, and features will be built before the API they need exists.

**Best-practice options:** No external pattern applies; this is local. **List them as contract items 6–10:**
- `ctx.preview(edIds, prop, value)`
- `ctx.beginAction()` returning an id that `apply` takes, or the registry minting one per run
- `ctx.view` commands (setMode, fit, zoomTo)
- `ctx.setEditorState(patch)`
- the BoardIndex text from the copy concern

Add validator updates for every new payload field. Re-estimate the contract task at 1½–2 days.

### [minor] Multi-element move and marquee need a rework of the move tool that the plan doesn't mention, and the marquee "settle before threshold" timing is assumed  — §M9 #1, #2
**In plain words:** Today the move tool only knows how to drag one selected element. Moving several at once means rewriting how it tracks the selection. The marquee also relies on a probe answer arriving before the mouse has moved 3 px, which a quick flick can beat.

**What:**
- `selectedBox()` and `remeasureSelection` (`move.tool.ts`) are single-element: `edIds.length !== 1 → null`. Press-claiming tests only that one rect, and `readDragPlan` takes one edId.
- The marquee settles "when `hitTest` returns, before the drag threshold". But probe reads are batched once per frame over a MessagePort, and `DRAG_THRESHOLD_PX = 3`, so a fast drag can cross the threshold first. The plan does not say what happens then (buffer the moves, or treat it as a marquee).

**Why it matters:** M9's 2½ days assume extending code that must actually be rewritten. An unspecified race shows up as flaky Playwright runs.

**Best-practice options:** This is local. Define the fallback: buffer pointer moves until the hit settles, then replay them. Treat multi-selection tracking (a union rect plus per-element plans) as its own M9 task with its own tests.

### [minor] Preview width keeps the board height and silently lets edits at 375 px change the desktop design  — §M11 #8
**In plain words:** Narrowing the preview makes content taller, but the frame keeps the board's original height, so the bottom gets cut off. Worse, any style edit made while previewing at phone width is written to the base styles, so it also changes the desktop layout. Users will assume they are making a mobile tweak.

**What:** `ArtboardFrame` uses `board.h` (`CanvasView.tsx:530`), and the plan only changes the width. `@media` editing is a non-goal, so every edit at a preview width writes the unconditional declaration.

**Why it matters:** This undercuts Goal 3 ("the canvas stays honest") through a quiet, surprising write.

**Best-practice options:** This is local. Let the height follow the content (probe `scrollHeight`) while previewing, and show a persistent banner such as "Edits apply to all widths". Alternatively, make the canvas read-only while a preview width is set. See Decision 5.

### [minor] Frame selection's layout inference is under-specified for wrappers  — §M8 #6
**In plain words:** The plan infers padding for the new wrapper from how far the children sit inside it. A wrapper made to fit its children has no such gap, so that rule always gives zero. The plan also doesn't say what happens with absolutely positioned or non-adjacent selections.

**What:**
- "Padding from the children's union inset" (borrowed from M10 #8) is meaningless when the wrapper is created around exactly those children.
- `wrapNode` refuses non-neighbouring siblings (`structural-ops.ts:siblingRun`).
- For absolutely positioned children a flex wrapper changes nothing visible and collapses to 0×0.
- Figma's Ctrl+Alt+G makes a plain frame; Shift+A is the one that adds auto layout.

**Why it matters:** Users get surprising wrappers or refusals with no toast wording defined.

**Best-practice options:** This is local. Infer only direction and gap and leave padding at 0. Disable the action, with a tooltip, for absolute or non-adjacent selections. State the refusal wording.

### [minor] Paste edge cases left open  — §Contract 2, §M8 #4
**In plain words:** Some ordinary pastes have no defined result: plain text from a text editor, and copies of the board's own data-bound elements (which the safety rules refuse). Re-indenting a multi-line fragment can also change the text inside `<pre>`.

**What:**
- A `text/plain`-only paste has no rule: it creates a text node, a text layer, or a refusal.
- Copies of elements with `{{…}}` holes or inside `<sc-for>` are refused on paste even within the same board. Duplicate allows them, which is fine, but should be stated.
- The "indentation splice" does not say whether interior lines are re-indented. Re-indenting them alters `<pre>` and `white-space: pre` content and breaks the "nothing modifies the fragment" promise.
- `setAttr` then `removeAttr` on the same name in one flush would produce overlapping splices unless `supersedeKey` treats them as one key.

**Why it matters:** These become refusals or odd results that each need a toast, and the `<pre>` case is a silent content change.

**Best-practice options:** This is local:
- Indent the first line only.
- Treat a plain-text paste as a `<p>` text layer, or refuse it with a toast.
- Document the holes refusal next to the existing helmet-class limitation.
- Give `removeAttr` the same `attr <name>` supersede key as `setAttr`.

### [minor] The conflict test only checks the registry against itself, not against browser and OS chords  — §Testing, §Risks
**In plain words:** The test makes sure two editor shortcuts don't clash with each other. It doesn't check against keys the browser keeps for itself: on Windows Chrome and Edge, Alt+D jumps to the address bar and Alt+F opens the browser menu, and Cmd+[ / Cmd+] are Back and Forward on macOS Chrome.

**What:** Align right is Alt-D and z-order is Mod-[ / Mod-]. Those can be cancelled with `preventDefault`, but whether that works in Chrome, Edge and Electron on each OS is unverified. The Electron Windows menu (File, Edit, View, Window) may also take Alt-letter mnemonics.

**Why it matters:** Users get a shortcut that silently does the browser thing on one platform.

**Best-practice options:** Add a per-platform list of reserved and known browser chords to the conflict test (Ctrl+W/T/N, Cmd+Q, Alt+D, Alt+F, Ctrl+Shift+O), and a Playwright check on Windows Edge that Alt-D reaches the editor. The palette fallback already covers the failure mode. (Google "Chrome keyboard shortcuts", https://support.google.com/chrome/answer/157179; W3C APG on avoiding browser conflicts, https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)

### [nit] Small correctness notes  — §M10 #1, #6, §M11 #4
**In plain words:** These are minor places where the browser or Electron behaves a little differently from what the plan assumes.

**What:**
- **EyeDropper in Electron.** It is present, but on Windows it cannot pick colours outside the app window (Electron issue noted by Blockbench).
- **Outline mode.** An editor stylesheet loses to authored inline `!important`, so those fills stay visible.
- **`text-wrap-style`.** It is newer than the `text-wrap: balance` shorthand. Writing the shorthand reaches more browsers that view the canvas.

**Why it matters:** These are cosmetic and platform-specific.

**Best-practice options:**
- Feature-detect `'EyeDropper' in window` and accept the in-window limit on Windows Electron. (Chrome Developers "EyeDropper API", https://developer.chrome.com/docs/capabilities/web-apis/eyedropper; "How Blockbench uses the EyeDropper API", https://developer.chrome.com/blog/how-blockbench-uses-the-eyedropper-api.md.txt)
- Note the `!important` exception in outline mode.
- Prefer `text-wrap: balance | pretty`.

---

## Decisions Ron needs to make

1. **How shortcuts match keys.** The options are:
   - code-only, as decided in r1: robust for Option, Shift and Hebrew, but AZERTY/QWERTZ letters land on Ctrl+W and Cmd+Q;
   - key-first with a code fallback for non-ASCII keys: fixes European layouts and keeps Option, Shift and Hebrew working;
   - code plus per-layout remap tables: most work.

   Recommendation: key-first with a code fallback.
2. **How one action becomes one undo step.** The options are coalescing by `actionId` in `UndoLog.record` (small and robust), or an explicit `endAction` message with the Writer holding writes (needs a timeout fallback). Recommendation: coalesce in UndoLog.
3. **How the UI gets source text for copy and the Code tab.** The options are:
   - send the file text with each `index` message: simple, synchronous, small payloads;
   - per-element source slices: more protocol;
   - async ClipboardItem with a Promise: loses the private MIME type and adds a round-trip.

   Recommendation: send the file text with the index.
4. **Electron Mod-A routing.** The options are:
   - a menu `click` that runs `executeJavaScript` to dispatch a DOM event: no preload;
   - a new preload with contextBridge: canonical, new surface;
   - `before-input-event`: cannot see focus.

   Recommendation: executeJavaScript dispatch.
5. **Editing while a preview width is set.** The options are to allow it with a persistent "edits apply to all widths" banner, make the canvas read-only while previewing, or allow it silently (as written). Recommendation: allow it with the banner, and let the frame height follow the content.
6. **Shortcut focus scope.** The options are adding scope or focus contexts to `EditorAction`, or keeping Enter, Tab, Escape and the arrows canvas-local in CanvasView and only listing them in the conflict test. Recommendation: add a `scope` field.
7. **Drag on an unselected nested container: marquee (plan, r1) or move it (Figma).** The plan's rule fits HTML boards full of containers but goes against Goal 1's muscle memory for cards. Recommendation: keep the plan's rule, and confirm it with Ron after a hands-on try.
8. **Frame selection (Mod-Alt-G): plain wrapper like Figma, or an auto-layout wrapper (plan).** In HTML, a plain div changes how flex children lay out, so the inference has value. Recommendation: auto-layout wrapper with direction and gap only, padding 0, disabled for absolute or non-adjacent selections.
9. **Pasting the board's own data-bound elements (`{{…}}`, `<sc-for>`).** The options are to keep refusing (any web page can also write the private MIME type, so it can't be trusted) or allow it. Recommendation: keep refusing, document it, and point to Duplicate and drag-reorder.

---

## Verdict

**Revise & re-review.** The approach is right, but these must be resolved on paper before a test-first build can proceed:
- root-level paste;
- copy's source text;
- undo coalescing;
- shortcut scope and layout matching;
- the Electron IPC claim;
- the missing contract items.
