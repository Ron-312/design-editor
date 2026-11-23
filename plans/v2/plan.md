# Design Editor v2 — the Figma features people reach for next

v1 built the editor core: one artboard at a time, select / move / resize / snap / measure, Auto
Layout as flexbox, a properties panel, tokens, structure ops, byte-exact write-back and pull/push
(`plans/v1/plan.md`, status in `plans/v1/parity.md`). v2 adds the everyday Figma features v1 left out,
chosen from ten fetched research files (`plans/v2/research/01–10`, merged in `00-summary.md`).

Decisions in this plan were made by Claude for Ron and are tagged `(decided: Claude 2026-11-23)`;
deep-critic r4 checked them against the code and current practice and they stand (decided: deep-critic r4); Ron confirms or changes them.

## Goals
1. A Figma user's muscle memory works: Backspace deletes, Mod-A selects all, copy/paste moves layers,
   marquee selects, several selected elements move together, Mod-K finds any action.
2. The properties panel covers what Figma's covers for HTML/CSS: a real colour picker, per-corner
   radius, editable shadows, blur and blend, stroke style, the common text controls, and the rest of
   Auto Layout (wrap, spacing modes, baseline).
3. The canvas stays honest: every new control writes real CSS or DOM that the file keeps, nothing
   Figma-only. Editor-only views (outline mode, preview width) never touch the files.
4. Nothing in v1 gets worse: byte-exact write-back, the zero-byte untouched diff, one undo entry per
   user action, macOS + Windows, Chrome + Edge + the Electron app.

## Non-goals (v2)
- Breakpoint editing into `@media`, components via `<dc-import>`, theme modes, creating class rules from
  a selection, gradients and multiple fills, image drop/replace, grid editing, rotation handle,
  constraints, named versions, comments. Each waits for a reason given in `research/00-summary.md`;
  most need the live M0 check of the canvas format first.
- An editable code view. v2 ships the read-only code tab; editing CSS as text comes after.

## What stays the same
The server, the edit pipeline (SourceIndex → PatchEngine → Writer), the probe protocol and the plugin
registries (`src/ui/canvas/tools/*.tool.ts`, `src/ui/panels/sections/*.section.tsx`,
`src/ui/actions/*.actions.ts`) are unchanged in shape. New features are new tools, sections and
actions. The contract changes are listed first so they land before the features that use them.

## Contract changes (first, three tasks)
1. **Action key aliases.** `EditorAction.kbd` becomes `string | readonly string[]`; the registry binds
   every alias and the palette shows the first. Backspace and Delete both bind to delete.
   Chords match key first, with a code fallback. If `event.key` is a single ASCII letter or digit,
   the chord matches on it and never falls back. On AZERTY and QWERTZ, Mod+Z is then undo on the key
   labelled Z, and the key at QWERTY-Z (labelled W) never fires undo. Matching on code would send
   Mod+Z and Mod+A to the user's Ctrl+W and Cmd+Q. Any other single character is looked up on
   `event.key` first, with Shift folded into the character. This covers punctuation, an Option-composed
   or Shift symbol, and a Hebrew or Cyrillic letter. QWERTZ Ctrl+Shift+7 types `/`, so it is `Mod-/`.
   Only when nothing matched and a modifier is held (Option alone on macOS included, for the Alt-letter
   align commands) does the chord retry on the US character for `event.code` (`KeyC`, `Digit0`,
   `BracketRight`). `⌘⌥C` arriving as `ç`, Shift-0 arriving as `)`, `⌥⌘]` and non-Latin letters
   reach their bindings this way. Punctuation follows its label. On QWERTZ, Ctrl+"+" (at US `]`) is
   zoom in and Ctrl+"-" (at US `/`) is zoom out, not Bring forward and the palette, and on AZERTY
   Mod-- still zooms. This is ProseMirror's `keydownHandler` order and CodeMirror's rule. They fall
   back on the layout-following `keyCode`, and the fallback here uses `event.code`, so letters and
   digits are excluded from it (decided: deep-critic r4).
   A named key (Delete, Backspace, Enter, Escape, Tab, arrows) matches on `event.key`. On Windows a Ctrl+Alt chord is skipped while `getModifierState('AltGraph')` is true.
   (decided: deep-critic r2) Every pressed editor shortcut moves into the
   registry as an action: CanvasView's V, H, Enter, Tab, Escape and Shift-1/2, the move tool's arrow
   nudges, and the layers panel's Mod-F. Space (pan) and I (interact) are held keys, so they stay in
   CanvasView and are listed as reserved in the conflict test. (decided: deep-critic r1)
   `EditorAction` also gains `scope?: 'canvas' | 'layers' | 'global'` (default `'global'`), and the
   registry checks it against the keydown target before it matches or calls `preventDefault()`.
   `'canvas'` matches inside `[data-canvas-viewport]` (the check `isOnCanvas` makes today) or when
   nothing has focus (`document.body`). `'layers'` matches inside the layers panel. `'global'` matches
   anywhere except text entry. `scope` also takes a list, and a list matches where any of its scopes
   match. Navigation keys bound with no Mod or Alt are `'canvas'`: V, H, Enter, Tab, Escape, Shift-1/2
   and the arrow nudges. A focused button, menu or layer row therefore keeps its own Enter, Escape and
   arrows, and Tab still moves focus outside the canvas. Delete/Backspace and the bare Shift-letter
   commands (Shift-H/V flip, Shift-A, Shift-0) are `['canvas', 'layers']`, so as in Figma they work from
   a focused layer row. The text-entry check moves out of App's keydown hook
   (`if (!isTextEntry(event.target))`) into the registry, which skips every binding whose target is a
   text field unless the action sets `inTextEntry: true`. Only Mod-F sets it, so it matches from a text
   field, the layer search box included, as v1's `document` listener does. The palette, Mod-Z and every
   other chord keep the default and stay native in inputs. The registry test asserts both: Mod-F fires
   from the search input, and a chord without the flag does not. (decided: deep-critic r4) Without that, Mod-F from the canvas or a field
   would open the browser's Find bar. (decided: deep-critic r3)
   Other Mod or Alt chords (the style-copy chords) stay `'global'`. The conflict test flags two
   bindings of the same chord only when their scopes overlap (`'global'` overlaps every scope). The
   registry test fires Enter, Tab, Escape and the arrows with a button, a layer row and the canvas as
   `event.target` and asserts that only the canvas one runs and that `preventDefault` is called only
   then. A second test checks v1 behaviour: Mod-F focuses layer search from the canvas and from the
   search input, and Delete removes the selection from a focused layer row. This follows VS Code's
   focus `when` contexts. (decided: deep-critic r2)
   A chord that matches a binding whose scope applies is always prevented, even when the action's
   `when` fails: the registry calls `preventDefault()`, runs nothing, and shows the action's disabled
   reason (its tooltip text) as a toast when it has one, so that disabled bare keys such as the arrows
   or Delete with nothing selected stay silent. Mod-[ / Mod-] are Back/Forward and Alt-D focuses the
   address bar in Chrome and Edge, so a disabled z-order or align key must never reach the browser.
   CodeMirror's `KeyBinding.preventDefault` handles the same case. Chords outside their scope still
   pass through. The registry test asserts that a disabled in-scope chord (Mod-[, Alt-D) is prevented
   and runs nothing, and that an out-of-scope one is not prevented. (decided: deep-critic r3)
   `when` stays synchronous and reads only what the SourceIndex and the selection already hold
   (read-only, selection size, neighbouring-sibling run). Refusals that depend on layout (positioned,
   flex child, overlap) are decided in `run` from fresh `ctx.read`s and shown as a toast with the
   tooltip wording, as v1's mixed-selection refusal is. Menu, palette and shortcut therefore share one
   path, and the "disabled with a tooltip" lines in M8-M9 mean this toast. (decided: deep-critic r3)
2. **`insertHtml` edit op.** New `EditKind` `insertHtml` with payload
   `{ before: EdId | null; html: string }` and `target: [parent]`. The parent is the target, so
   `isEditOp`'s non-empty-target rule, `Writer.submit`'s `ownerOf(op.target[0])`, `Flush.record` and
   `elementScope` need no change, and the op is rejected with a reply, never dropped, when the parent is
   gone. The engine takes the parent from `target[0]` and checks it with `requireRow(parent)`. Its
   `insertHtml` path does not run `planStructural`'s artboard-root refusal, because the root is the
   default paste parent, and every other structural op keeps that refusal. The server first
   unwraps the platform packaging: it keeps only the content between `<!--StartFragment-->` and
   `<!--EndFragment-->` when they are present, and drops a leading `<meta charset>` and the
   `<html>`/`<head>`/`<body>` wrappers. It then strips every `id` attribute exactly as `duplicateNode`
   does (`copyWithoutIds`), so a same-board paste cannot duplicate ids. Last, it parses the result with
   parse5 and **rejects** it unless every node passes an explicit allow-list table in
   `src/server/edit/insert-html.ts`, a parse5 walk rather than DOMPurify, which needs a DOM. The table
   lists the permitted tags (the flow and phrasing content the editor already creates, `img`, and basic
   inline SVG shapes), the permitted attributes per tag (global `class`, `style`, `title`, `lang`, `dir`,
   `aria-*`, `data-*` except `data-ed-id`, plus per-tag ones such as `img[src alt width height]` and
   `a[href]`), and the URL schemes allowed in URL attributes and in `url()` inside `style` (relative,
   `#`, `http`, `https`, `mailto`, and `data:image/*` in `src` and `url()` only). Anything not in the
   table is refused, including `<script>`, `<style>`, `<template>`, `<iframe>`, `<object>`, `<embed>`,
   `<base>`, `<link>`, `<form>`, `math`, any `on*` attribute, `srcset`, `action`, `formaction`,
   `xlink:href`, and the canvas's own `<helmet>`, `<sc-for>`, `<sc-if>`, `<dc-import>` and `{{…}}` holes.
   Nothing modifies the fragment after this check except the indentation splice. On copy, the UI also
   writes the fragment under a private type, `application/x-design-editor+html`, and prefers that type
   on paste, so its own copies skip the unwrap heuristics. The server still runs the full check on
   every `insertHtml`, whatever the source. It must
   also pass the flush's whole-tree shape check (`shapeMismatch` in `src/server/edit/shape-check.ts`),
   which refuses any re-parsed element that has no bound id, so `insertHtml` is planned like
   `duplicateNode`: the engine parses the cleaned fragment with parse5 `parseFragment` in the parent's
   context with `sourceCodeLocationInfo`, mints one id per fragment element, carries each at
   `indent.length + offset` in the single splice, and attaches the subtree to `shape` under the parent
   before `before` (as `cloneInto` does). Parser fix-ups (`<p>` inside `<p>`, a `<tr>` gaining an
   implicit `<tbody>`) then fail the check and the op is refused, not written; a test pastes
   `<p><div></div></p>` and expects that refusal. The fragment is spliced as text before `before` (or
   before the parent's end tag), indented to match the next sibling, with the file's line endings. One
   op is one undo entry and reloads the frame, like the other structural ops. The ack's `mintedIds`
   holds every new id (the whole subtree, as for `duplicateNode`); the UI selects only the top-level
   ones, the minted ids whose parent is the target. (decided: deep-critic r1, r4)
3. **Undo boundary per user action.** Undo steps are bounded by the action, not by timing. Every
   `EditOp` the UI sends carries an `actionId`, minted once per user action: one command, one drag from
   press to release, one typing burst in a field, one paste, and one arrow-key hold from keydown to
   keyup. `Writer.submit` seals synchronously: when an op's `actionId` differs from the file's pending
   batch, it moves `open.pending` as one whole batch onto a single writer-wide queue of sealed
   `{file, actionId, ops}` batches, kept in the order the actions happened, before appending the new
   op. `flushAll` drains that queue first, in order, each batch as its own undo entry. A sealed batch
   is never merged back into `open.pending`, and every path that treats `open.pending` treats the
   sealed batches of that file the same way. `hasPending` and `outsideChange`'s `paused` count them.
   Discard (`resolvePending(file, false)`) and board removal reject their opIds. A failed
   `atomicWrite` puts the batch back at the front of the queue, unmerged. (decided: deep-critic r4) The next action's op can
   therefore never join the previous action's flush, however late the serialized flush runs. A flush therefore never spans two actions. Nor is one
   action ever split across entries: `UndoEntry` gains the flush's `actionId`, and `UndoLog.record`
   folds a flush into the top undo entry when both have the same `actionId` and no undo or redo has run
   since. The merged entry keeps each file's earliest pre-image snapshot, adds snapshots for newly
   touched files, takes each file's latest `postWriteHash`, appends the records and ANDs `styleOnly`. A
   held arrow key, or a drag whose debounce fires mid-gesture, is therefore one entry however many
   flushes it takes; this matters because the 300 ms debounce can fire mid-action, for example when a
   held arrow key's repeat delay exceeds 300 ms. This is tldraw's model: changes since the last
   stopping point form one step, and `squashToMark` folds several into one. (decided: deep-critic r2)
   The 300 ms
   debounce stays only to batch writes and to merge a drag's or a typing burst's superseded values
   within one action. `wrapNode` gains an optional `style` payload, inline declarations written on the
   new wrapper in the same splice, so a styled wrap is one op. This follows Yjs's `stopCapturing()` on
   top of its capture window and tldraw's stopping point at the start of each interaction.
   (decided: deep-critic r1)
   One flush can carry several declaration ops for the same list, so `PatchEngine` coalesces them:
   every `setDecl`/`removeDecl` in the flush that targets one declaration list (one inline `style`
   attribute or one rule) is folded into the final list, which is written as one splice from the first
   changed declaration to the last. Untouched declarations keep their bytes and the list keeps its own
   separators (`separatorsOf`). This generalises `startList`, which already does this for appends to an
   empty list. Today each op is planned against the original text, so removing the last two
   declarations throws "overlapping patches" and removing the only one while appending another writes
   `style="; …"`. magic-string edits and LSP text edits both require non-overlapping ranges in one
   pass. v1's serial awaits (`layout.section.tsx:applyWrites`) cost 300 ms per property and write
   intermediate files that edsync and the watcher see, so multi-property actions send their ops
   together under one `actionId`, and `applyWrites` stops awaiting each ack. The planning rules and
   byte-exact tests are in #9. (decided: deep-critic r3)
4. **`removeAttr` edit op.** New `EditKind` `removeAttr` with payload `{ name: string }`; the splice
   deletes the attribute together with its leading whitespace, so removing what `setAttr` added restores
   the file byte-for-byte. `setAttr` cannot do this because `setAttrSplice` only inserts or replaces.
   M11 #1 uses it for an empty layer name. It is an attribute op planned beside `setAttr`, not a
   structural kind. It runs the same `requireEditable` and `isAttrEditable` checks, and it shares
   `setAttr`'s supersede key (`attr <name>`), so only the last set or remove in a flush is planned. It
   is a no-op when the attribute is absent, and it reloads the frame as `setAttr` does. Keeping it out of
   `STRUCTURAL_KINDS` keeps it clear of `planStructural`'s artboard-root refusal and `requireRow`, so
   the root's layer name can be cleared just as it can be set. (decided: Claude 2026-11-23; attribute-op
   path: decided: deep-critic r4)
5. **Probe `setEditorStyles` message.** New `EditorToProbe` `{ type: 'setEditorStyles'; css: string |
   null }`: the probe keeps one editor-only `<style>` element, replaced by `css` or removed on `null`.
   The editor re-sends the current value on every probe `ready`, because every structural op reloads
   the frame. M11 #4 (outline mode) uses it; nothing is serialised. (decided: Claude 2026-11-23)
6. **Action ids and validators.** `EditorContext.apply(op, actionId?)` takes the id, and
   `ctx.beginAction()` returns a fresh one. A tool calls it on pointer-down and passes the id to every
   `apply` until release or cancel. A single-shot caller omits it and the context mints one. A registry
   action's `run` is handed its id as an argument, minted once at the start of the run, so an async
   `run` (`pasteStyle`) passes the same id to every `apply` across its awaits. An action may be marked
   `hold`: the registry then keeps one id while `event.repeat` is true for the same chord and releases
   it on that key's `keyup` or on window blur, so a held arrow key is one action. The arrow nudges are
   `hold` actions. Field stepping follows the same rule outside the registry, since App never sends keys
   from a text field to it (`App.tsx:180`): one hold helper, used by `TextInput`'s `onStep`
   (`NumberField.step`) and by the keyboard steps of M10's sliders and scrub fields, calls
   `ctx.beginAction()` on a non-repeat ArrowUp/ArrowDown keydown, passes that id to `declaration.write`
   while `event.repeat` is true, and releases it on keyup or blur. A held ArrowUp in a number field is
   therefore one undo entry and one write, as in v1. Separate presses are separate actions. An op
   without an id never joins a batch by timing, so each click on a segmented toggle is its own action.
   This is tldraw's nudge: `onKeyDown` marks a history stopping point and `onKeyRepeat` does not. A
   test sends three repeat keydowns then keyup to a `NumberField`, within the debounce, and sees one
   undo entry and one write. (decided: deep-critic r4) A continuous drag (M10 #1's colour square, number scrubbing) does not call `apply`
   while it moves. `EditorContext` gains `preview(op)`, which wraps the probe's existing `previewDecl`
   and writes nothing. The drag previews on every move and calls `apply` once on release, so it makes
   one write and gets one ack. Escape re-previews the original value, so nothing reaches disk. v1's
   resize tool already commits this way, the platform's `input`/`change` split works the same way, and
   so does tldraw's mark-then-`bailToMark`. Typing bursts and held arrow keys still send several ops
   under one id, and the Writer acks every superseded opId with the final record and `resolved`, so
   `ws-client.ts:settleAck` compares `previewed` only for the newest pending op with that target and
   prop. It treats an ack for an op superseded by that newer op as a plain confirmation, resolving its
   promise with no toast, no `reloadFrame` and no `store.addRecord`, and records only the newest op's
   ack. Tests cover a burst of three ops on one property giving one record, no toast and no reload, and
   a held-arrow nudge whose acks arrive superseded. (decided: deep-critic r3) In `src/server/client-message.ts`, `PAYLOAD_CHECKS` gains `insertHtml` and
   `removeAttr`, and the `actionId` and `wrapNode.style` fields are accepted. Each validator has a
   rejection test, since the closed record drops unknown kinds and fields silently.
   (decided: Claude 2026-11-23)
7. **View and editor-state setters.** `EditorContext` gains `setMode('select' | 'hand')`,
   `fit(kind: 'board' | 'selection' | '100')`, `cancelGesture()` (the Escape action drops the claimed
   gesture through the tool's `onCancel`) and `setEditorState(patch)` for editor-only state
   (collapsed layers, outline, preview width, locked, hidden). Zoom still goes through `setViewport`.
   M8's V, H and zoom actions, M10 #8 and M11 use these instead of clicking DOM buttons;
   `layer.actions.ts:toggleEditorState` moves onto `setEditorState`. (decided: Claude 2026-11-23)
8. **Source text in the index.** `BoardIndex` gains `text: string`, the board's source exactly as the
   server indexed it, sent in the same `index` message as the ranges so offsets and text cannot
   disagree. `StyleSource` gains `range: SourceRange` (the whole rule, or the inline `style`
   attribute). Copy (M8 #4) and the Code tab (M11 #6) slice this text in the UI, because the `copy`
   event handler has to fill `clipboardData` synchronously and cannot ask the server. Boards are small
   and the index is already resent after every edit, so the added size is accepted.
   (decided: deep-critic r2) `BoardIndex` also gains `rules: StyleSource[]`, the board's
   `<helmet><style>` rules with their ranges, for the Code tab; `styles` stays inline-only (M11 #6;
   decided: deep-critic r3).
9. **Several declaration ops on one list in one flush.** v1 never sends them (the layout panel awaits
   each op), but one action's ops now share a flush (#3), so `Flush` must plan them together.
   `setDecl` and `removeDecl` ops on the same declaration list (one inline `style` or one rule) are
   collected during planning, and `Flush` applies #3's rule: it builds the final list from the
   surviving and set declarations, with the list's existing separators (`separatorsOf`) and any
   trailing `;` kept, and emits one splice from the first touched declaration to the last. A `setDecl`
   on an existing declaration therefore never gets its own value splice when the same flush touches that
   list's other declarations, because it would fall inside the removal span and overlap. A `setDecl`
   that appends to a list whose declarations are all removed in the same flush starts the list afresh,
   as `startList` does for an empty one, so no leading `;` is left. A flush that touches a single
   declaration keeps the per-declaration splice (decided: deep-critic r4). Tests drive the real engine:
   remove the last two of three declarations, remove all of two, remove-all then set two longhands
   (`border-radius` to its four corner longhands), remove one while setting another, and remove the
   first and last of three while setting the middle one, each asserting
   the exact output bytes and no `overlapping patches` error. M10's multi-property commands (radius
   join, Alt-Shift-A remove auto layout, text resizing mode, line-clamp removal) send their ops under
   one `actionId` without awaiting each ack. (decided: deep-critic r3)

## M8 — Keyboard, clipboard, command palette (2 days)
1. **Backspace deletes** the selection (alias of Delete) when focus is not in a text field.
2. **Select all / invert.** Mod-A selects every sibling in the current scope (the selection's parent's
   element children, or the artboard root's children when nothing is selected); Mod-Shift-A selects the
   scope's children that are not selected. Locked and hidden layers are skipped. In the Electron app,
   replace the Edit menu's `selectAll` role with a custom item (accelerator CmdOrCtrl+A). A role ignores
   `click`, so the role has to go. v1 has no preload or IPC (it only leaves out the Undo/Redo roles),
   and the window stays sandboxed with no preload. The item's `click` calls
   `webContents.executeJavaScript` with a fixed string that dispatches a cancelable `editor:select-all`
   event on `window` and returns the result of `dispatchEvent`. The editor cancels the event and runs
   its own select-all unless a text field (or text editing in the canvas frame) has focus. If the event
   is not cancelled, main calls `webContents.selectAll()`, the native command in the focused frame. This
   way the menu accelerator cannot win on any OS. The string never carries data. A unit test over the
   menu template checks that the item exists and that no `selectAll` role is left. Rejected
   alternatives: a contextBridge preload is the canonical channel but adds a new bridge surface for one
   signal, and `before-input-event` cannot see DOM focus. (decided: deep-critic r2)
3. **Command palette** on Mod-K and Mod-/: a fuzzy list of actions (label + platform shortcut glyphs:
   ⌘⌥⇧ on macOS, Ctrl+Alt+Shift on Windows) and layers (name, tag, class, text); Enter runs or selects,
   Escape closes. It never opens while text editing or while an input has focus. It reads only the
   action registry and the board index — no second list of commands.
4. **Layer copy / cut / paste.** Handle the document `copy` / `cut` / `paste` events (not the async
   Clipboard API, so it works in the browser, Edge and Electron alike) when focus is on the canvas or
   the layers panel. Copy puts the selected elements' **source text** (so
   no `data-ed-id`) on the clipboard as `text/html` and `text/plain`, in document order. `BoardIndex`
   gains `text: string`, the board's source exactly as the server indexed it (contract #8). Its
   `locations` offsets index that string, and the server already re-sends `index` after every flush,
   undo, redo and reconcile. The `copy` handler slices `text` by the same message's `element` ranges,
   because `clipboardData` can be set only synchronously inside the event. The M11 #6 Code tab slices
   the same `text`, so each `StyleSource` gains its `range`, and the board's `<helmet><style>` rules
   go in a new `BoardIndex.rules` list (each a `StyleSource` with its `range`), not in `styles`
   (M11 #6). The server has no selector matcher, and a non-inline entry in `styles` would turn on rule
   choices in v1's write-target chip (`targetsOf`) that v1 never showed (deep-critic r3).
   (decided: deep-critic r2) Cut = copy
   then `deleteNode`. Paste: if the selection is, or contains, an element the clipboard was copied from (the UI keeps
   the last copy's board and edIds), insert the copy as siblings after the last selected element; else if
   exactly one element is selected and it can hold the fragment (content model), append inside it;
   (decided: Claude 2026-11-23, critic v5) otherwise insert after the last selected element; with nothing selected,
   append to the artboard root. Paste sends `insertHtml` and selects the minted ids. Paste uses the same
   unwrap and allow-list, so HTML from other apps and the editor's own copies take one path; a rejected
   paste shows one toast naming the reason. Class rules defined in the source board's
   `<helmet><style>` do not travel with a paste into another board. Copying them would need selector
   matching and rename-on-conflict, which Webflow does by duplicating clashing classes (research/08).
   The server has neither, so v2 accepts the loss. The paste still goes through, but when the
   fragment's `class` tokens include any that no `selector` in the target board's `BoardIndex.rules`
   names as `.name`, the UI shows one toast listing those classes. (decided: deep-critic r4) Copies of the board's own data-bound elements are also refused on
   paste, even within the same board. This covers anything carrying a `{{…}}` hole or an `<sc-for>`,
   `<sc-if>` or `<dc-import>`. The private MIME type is no proof of origin, because any web page can
   write it, so the server's allow-list treats it like any other paste. The refusal toast names
   Duplicate (Mod-D) and drag-reorder in the layers panel, which copy and move such elements with their
   bindings intact. (decided: deep-critic r2)
5. **Copy as CSS** (Mod-Alt-Shift-C) — the selection's authored declarations as a CSS block; **Copy as
   HTML** from the layer context menu and the palette. These commands run from a menu, the palette or a
   non-Mod-C shortcut, so no `copy` event fires: they write with `navigator.clipboard.writeText` (user
   activation is present, and 127.0.0.1 and Electron are secure contexts; writing needs no permission
   prompt). Only Mod-C/X/V use the events from #4.
6. **Frame selection** (Mod-Alt-G): wrap the selection in a `<div>` with one `wrapNode` op. Its
   `style` payload (contract #3) carries an auto layout: `display: flex`, a direction inferred as in
   M10 #8, and a gap equal to the median space between neighbouring children's margin boxes, floored at
   0. Flex does not collapse margins, so measuring between margin boxes keeps authored margins from
   being counted twice. There is no padding, because the wrapper hugs its children. Mod-G stays the
   plain wrap. A plain `<div>` would restack flex items, so this variant keeps the layout (Framer's
   Shift-A and Subframe's wrap-in-stack behave the same way). The action is disabled when any selected
   layer is absolutely or fixedly positioned, with the tooltip "Frame selection needs in-flow layers —
   use Wrap in container (Mod-G)". It is also disabled when the layers are not neighbouring siblings,
   with the server's `siblingRun` wording: "only neighbouring layers can be wrapped together"
   (decided: deep-critic r2). The inference reads the
   selection's rects before the op, because the wrap reloads the frame and the wrapper's id is only
   known after the ack. Wrap and layout are therefore one op and one undo entry; a follow-up `setDecls`
   on the wrapper is not used, since it would need that id. Cmd-Backspace / Ctrl-Backspace is an alias
   of ungroup.
7. **Z-order**, with Figma's keys: Mod-] / Mod-[ for one step, and to front / to back on ⌥⌘] / ⌥⌘[ on
   macOS and Ctrl+Shift+] / Ctrl+Shift+[ on Windows. Cmd-Shift-] / [ is the browser's tab switch on
   macOS, so it is not used. These four actions take a per-platform `kbd`. Option and Shift change `event.key`, so the
   actions reach their bindings through the code fallback (`BracketRight` / `BracketLeft`). For an absolutely
   positioned element, move it in DOM order among its siblings (`moveNode`), which changes paint order
   only. For a flex or grid item, write `z-index` instead, because DOM order would move it in the
   layout. One step passes the **next sibling in the same paint layer whose rect overlaps** the
   element (one batched `rects` read). Siblings in the same paint layer are positioned siblings with
   the same `z-index` for a DOM move, and any sibling for `z-index`. A step past a static or
   non-overlapping sibling would change nothing on screen. For flex and grid items, a step writes that
   sibling's `z-index` ± 1, and to front / to back writes the overlapping siblings' max + 1 / min − 1.
   With no overlapping sibling in that direction, the action writes nothing and shows a toast. For
   anything else the action is disabled with a tooltip. (decided: deep-critic r1)
- **Exit:** unit tests for the alias registry, the scope rules, palette filtering and suspension, the
  allow-list (each rejected construct, plus a clean fragment), indentation and line endings of the
  `insertHtml` splice (LF, CRLF, BOM) and z-order per layout kind. Playwright: copy two elements and
  paste them into another container, paste with nothing selected appends to the artboard root, paste
  after a top-level element lands as its sibling at the root, cut then undo restores the file byte-identical, Backspace deletes,
  Mod-K runs an action.

## M9 — Multi-selection and arrange (2½ days)
1. **Marquee select.** A drag that starts on empty canvas, or on a container's own background (the
   deepest hit is the container itself, not one of its children), draws a rectangle. On release it
   selects the candidates whose rects intersect it. Candidates are that container's element children
   (the artboard root's children on empty canvas), read with one batched `rects` probe read at drag
   start. A drag that starts on an unselected leaf selects it as a click would, then moves it. The
   canvas claims the press synchronously, as the move tool does, starts the `hitTest` read at the same
   moment and records pointer positions meanwhile. Nothing is replayed, because the drag rect and the
   move delta are both computed from the press point and the latest pointer. Marquee or move is decided
   when the hit returns, and that is also when a click selects. This is the same moment v1 selects,
   because `selectAt` already awaits the `hitTest` started at press. A leaf hit is selected then, and an
   empty-canvas hit clears the selection unless Shift is held. When the hit is an unselected leaf, the
   canvas selects it and calls the move tool's `onPointerDown` with the stored press pointer; no new
   hand-off API. A container-background hit is selected only if the press is released without crossing
   the threshold, so a marquee never flashes the container first. A marquee adds to the selection as it
   was at press. A flick that crosses the threshold first just draws once it settles. A release before
   the hit returns is still a click, applied when the hit lands. Double-click reads the selection that
   hit set, and a test double-clicks after a claimed press. (decided: deep-critic r3) Shift adds to the
   selection; Escape cancels. The move tool keeps priority when the press lands on a selected element.
   This is the rule Figma uses for sections and top-level frames: a drag inside an unselected one
   marquees its contents, and a drag on a selected one moves it. Here it applies at every level, because
   an HTML board is covered in containers, so a drag on a parent's padding marquees its columns. An
   unselected nested container, such as a card in a flex row, also marquees its children on drag. A
   click selects the card, and a drag after that moves or reorders it. Moving it on the first drag, as
   Figma does for nested frames, would do nothing for most block-flow containers, since their move mode
   is null. Picking the gesture by move mode would also make boxes that look alike react differently to
   the same drag, so the one rule holds at every level. Ron tries it in the M9 build. If a card should
   move on its first drag, only the press dispatch changes. (decided: deep-critic r1; nested
   containers: deep-critic r2) (decided: deep-critic r4)
2. **Move and nudge several elements.** When every selected element is absolutely positioned, a drag
   or arrow nudge moves them together: one `setDecl` op per element per changed property, all under one
   `actionId`, so they are one undo entry (contract #3). Undo entries never span actions, so an action
   that needs the minted id of an earlier op must be one op, not two; a held arrow key makes one entry
   from keydown to keyup (by the coalescing in contract #3). Snapping uses the
   selection's union rect. Multi-selection tracking is its own task: `selectedBox` /
   `remeasureSelection` (single-element today) become a union rect plus a per-element `DragPlan`, and
   the press-claim tests the union. Tests cover a drag that outruns the hit and a press on one of
   several selected elements. A mixed selection (any non-absolute element) keeps v1's refusal toast.
3. **Align and distribute** (Alt-A left, Alt-H centre, Alt-D right, Alt-W top, Alt-V middle, Alt-S
   bottom; Alt-Shift-H / Alt-Shift-V distribute, 3+ elements). For absolutely positioned siblings, write
   `left`/`top` (or the authored `right`/`bottom`) so their boxes align to the selection's bounds. For a
   single flex child, align along the cross axis by setting `align-self`. Anything else is disabled,
   including a selection of two or more flex children: align never writes `align-items` on the parent,
   which would move unselected siblings too and stays in the Auto Layout section (M11).
   One undo entry per command. (decided: Claude 2026-11-23; multi-child flex: decided: Ron, deep-critic r1)
4. **Resize keeps units and takes modifiers.** Resize writes the new size in the property's authored
   unit: px as now; rem/em converted with the computed root / element font size; % converted with the
   containing block's computed width or height. Unknown units (calc(), vw) fall back to px with a toast.
   Shift keeps the aspect ratio of the box at drag start; Alt resizes from the centre for absolutely
   positioned elements (writing the offsets too).
5. **Resize snapping**: the moving edges snap to the same targets as move (`src/ui/canvas/snap.ts`),
   with guides; Ctrl bypasses, as in move.
6. **Flip** horizontal / vertical (Shift-H / Shift-V) negates the x / y factor of the authored `scale`
   (a single value counts as both axes, so `1.2` becomes `-1.2 1.2`; no `scale` counts as `1 1`), and
   removes the property only when the result is `1 1`, so flipping twice restores the authored bytes.
- **Exit:** unit tests for marquee hit sets (including Shift-add), multi-move writes and the single
  undo entry, two flushes more than 300 ms apart with the same `actionId` leaving one undo entry that
  one undo restores to the pre-action file, align/distribute maths with hand-computed numbers, unit conversion for px/rem/em/% and
  the fallback, aspect and centre resize, edge snapping, a Writer test that submits an op under id A,
  then under id B before the queued flush runs, and sees two entries, a registry test that fires
  repeated arrow keydowns then keyup and sees one undo entry, a double-click after a claimed press
  (selects, then enters text edit), Escape mid-marquee leaving the selection unchanged. Playwright:
  marquee-select three columns,
  nudge two absolute elements and undo once, align left, resize a rem width and see rem in the file.

## M10 — Properties panel (3 days)
1. **Colour picker** popover on every colour field: saturation/value square, hue and alpha sliders,
   a notation dropdown (hex, rgb, hsl, oklch) that defaults to the authored format, and an eyedropper
   button using the `EyeDropper` API where available (Chromium, Edge, Electron), hidden otherwise.
   Dragging previews live through `ctx.preview` and commits with one `apply` on release (contract #6);
   Escape re-previews the original value.
2. **Per-corner radius**: a link toggle splits `border-radius` into the four `border-*-radius`
   properties, keeping the authored unit, and joins them back when all four match.
3. **Shadows**: the `box-shadow` list becomes editable — add, remove, reorder, and edit x, y, blur,
   spread, colour and inset per layer — parsed and serialised with comma-safe splitting.
4. **Effects**: layer blur (`filter: blur()`), background blur (`backdrop-filter: blur()`) and a
   `mix-blend-mode` dropdown. Existing `filter` functions other than blur are kept as they are.
5. **Stroke**: `border-style` (solid, dashed, dotted, none) and a per-side toggle for widths.
6. **Text**: alignment (`text-align` left/center/right/justify), case (`text-transform`), decoration
   (`text-decoration-line`), italic (`font-style`), resizing mode (auto width = `white-space: nowrap`
   and no width; auto height = fixed width, no height; fixed = both), max lines (the
   `display:-webkit-box; -webkit-line-clamp; -webkit-box-orient: vertical; overflow:hidden` block,
   with a warning when it would replace a flex or grid `display`), and wrap style (`text-wrap-style:
   balance | pretty`).
7. **Auto layout**: wrap (`flex-wrap`, with `row-gap` / `column-gap` once wrapping, and
   `align-content`), a spacing mode menu (packed / `space-between` / `space-evenly` / `space-around`)
   and baseline alignment (`align-items: baseline`, row containers only).
8. **Shift-A adds auto layout** to the selected container, inferring direction from the children's
   rects (row if their centres spread more horizontally), gap from the median space between them and
   padding from the children's union inset; **Alt-Shift-A removes** it (the flex properties v1 writes).
9. **Token binding stays as v1 built it**: a `:root` token writes `var(--x)` and a `tokens.json` token
   writes its literal value (`tokenValue`, `src/ui/panels/fields.tsx:331`), so M10 adds no work here.
   The token pill shows only for an authored `var(--x)`. A literal never shows a token name, because
   nothing records which token it came from, and two tokens can share a value. Finding literals that
   equal a token is left to the token usage map, as a suggestion the user applies (decided: deep-critic r1).
- **Exit:** unit tests for colour conversion round-trips per notation (and keeping the authored one),
  the shadow parser on comma/colour-function edge cases, radius split/join, the line-clamp block and
  its warning, and Shift-A inference on row / column / single-child cases. Playwright:
  pick a colour with the square and see one write, add a shadow layer, set text-align, wrap a flex row.

## M11 — Layers, navigation, code tab (2 days)
1. **Rename a layer** by double-clicking its name in the layers panel: writes `data-layer-name` with
   `setAttr` (the name source v1 already reads first, `src/server/source/template-tree.ts:62`). Enter
   commits, Escape cancels, Tab moves to the next layer. An empty name removes the attribute
   (`removeAttr`, contract #4).
2. **Collapse all** (Alt-L) and Alt-click on a disclosure arrow to expand or collapse the subtree. The
   collapsed set already lives in `.editor/state.json`.
3. **Zoom keys**: Shift-0 to 100%, Mod-= (alias Mod-+, the unshifted key on QWERTZ) / Mod-- around the viewport centre, and a typed percentage in
   the zoom menu. Shift-1 (fit board) and Shift-2 (zoom to selection) already exist
   (`CanvasView.tsx:426-427`).
4. **Outline mode** (Mod-Shift-O, as in Figma): the probe adds an editor-only stylesheet (outlines on
   every element, fills and text hidden; `setEditorStyles`, contract #5) and removes it on toggle; never
   serialised, never saved. The chord works in the desktop app; Chrome (bookmarks manager) and Edge
   (Favorites) may keep it, so Toggle outline mode is also a Mod-K palette action (decided: Ron,
   deep-critic r1).
5. **Layer type icons**: flex row, flex column, grid, text, image, repeat (`<sc-for>`), condition
   (`<sc-if>`), import (`<dc-import>`).
6. **Code tab** next to Design in the properties panel: the selection's authored inline style and each
   matching `<helmet><style>` rule as exact source text with `file:line`, plus Copy declaration / Copy
   rule buttons. Read-only in v2. The probe decides which rules match. A new read
   `{ kind: 'matches'; edId; selectors }` returns `{ kind: 'matches'; matched: boolean[] }`. For each
   selector in `BoardIndex.rules`, it runs `element.matches()` on every rendered instance of the element,
   and a selector that throws counts as no match. Before matching, the probe strips state pseudo-classes
   (`:hover`, `:focus`, `:active`, `:focus-visible`) and pseudo-elements (`::before`, `::after`,
   `::placeholder`) from the selector, because `matches()` ignores them or fails on them. The rule is
   matched on what remains and listed with a label such as "on :hover" or "::before". The tab shows
   rule text only; it does not force states (decided: deep-critic r4). `@media` rules are listed with their condition. The
   browser's own matcher sees what actually renders (`<sc-for>`/`<sc-if>` output, script-made nodes),
   the same live matching DevTools uses. A matcher over the template cannot see that, and the tab can
   wait for an async read. `index.styles` stays inline-only, so v1's selector chip offers the same
   targets as before. (decided: deep-critic r3)
7. **Image fit**: for `<img>`, an `object-fit` dropdown (fill, contain, cover, none, scale-down) and an
   `object-position` field.
8. **Preview width**: a new control in the top bar (none exists; it only shows `board.w` today) with
   presets (375, 768, 1280, 1440) and a custom width field. It sets a per-board `previewWidth`.
   `ArtboardFrame` (iframe width), `boardFit`, the board outline and size label, and the rulers read the
   effective width (`previewWidth ?? board.w`); the probe viewport is resized with the iframe.
   View-only; it never writes the file. While a preview width is set, the frame height follows the
   content. The probe reports the document's `scrollHeight`, and the frame, outline, size label and
   rulers use `min(max(board.h, scrollHeight), 4 * board.h)`, so a board that grows taller at a narrow
   width is not cut off. `vh` units resolve against the iframe's own height, so measuring while the
   frame is already grown would feed back (`min-height: 110vh` grows the frame, which grows the content,
   without end). The measurement is therefore taken with the frame held at `board.h`, only on a
   preview-width change or a DOM mutation, never on the frame's own resize, and the result is not fed
   back into the next measurement. Test: a board with a `min-height: 110vh` child settles at one height
   at width 375 (decided: deep-critic r4). Editing stays enabled. A persistent bar above the board reads
   "Edits apply to all widths" for as long as a preview width is set, because v2 writes no `@media` and
   every style edit lands in the base declaration. Editors that support breakpoints keep the scope of an
   edit visible at all times, and a read-only canvas would stop you fixing what the preview shows
   (decided: deep-critic r2). The width is saved per board in `.editor/state.json` as an
   optional `previewWidth` next to zoom, pan and selection, and is absent while the board shows its
   authored width. Zoom and pan saved at a preview width only make sense at that width, so the width
   is restored along with them. The board label reads "375 preview" while it is set, so a restored
   width is never mistaken for the authored one, and clearing the field or choosing the board's own
   width clears it (decided: deep-critic r1).
- **Exit:** unit tests for rename (set, clear, cancel, Tab), subtree collapse, zoom maths, outline
  stylesheet injection and removal, icon choice per node kind, code-tab grouping by source. Playwright:
  rename a layer and see `data-layer-name` in the file, outline mode on and off leaves a zero-byte
  diff, preview width 375 re-lays out the board without a write.

## Testing
Same bar as v1: tests first by a separate agent, one owner per file, the repo gate (`npm run check`)
green per wave, Playwright for anything that needs real layout, both OSes in CI (Chrome and Edge on
Windows). Every new keyboard shortcut is checked against the existing ones for conflicts in one unit
test over the registry. The registry matches an ASCII letter or digit only on `event.key`. Any other single-character key
(Option-composed, Shift symbols, non-Latin letters, punctuation) matches on `event.key` first. It
falls back to `event.code` (`KeyA`, `Digit0`, `BracketRight`) only when nothing matched and a
modifier is held outside AltGr. Named keys (Delete, Backspace, Enter, arrows) match on `event.key` (contract #1).
This is needed because on macOS Option-A yields "å" and Shift-0 yields ")" in `event.key`, and on
QWERTZ the "+" and "-" keys sit on `BracketRight` and `Slash`. It also
fixes the v1 Mod-Alt-C / Mod-Alt-V style-copy chords. The unit test feeds the registry real
`KeyboardEvent` values:
- Option-composed and Shift-symbol: `{key:'å', code:'KeyA', altKey:true}` and
  `{key:'}', code:'BracketRight', metaKey, shiftKey}`.
- AZERTY: `{key:'z', code:'KeyW', ctrlKey}` is undo, and `{key:'w', code:'KeyZ', ctrlKey}` matches
  nothing.
- QWERTZ: `{key:'z', code:'KeyY', ctrlKey}` is undo.
- QWERTZ punctuation: `{key:'+', code:'BracketRight', ctrlKey}` is zoom in and does not match Bring
  forward, `{key:'-', code:'Slash', ctrlKey}` is zoom out and does not open the palette, and
  `{key:'/', code:'Digit7', ctrlKey, shiftKey}` opens the palette. AZERTY: `{key:'-', code:'Digit6',
  ctrlKey}` is zoom out. US: `{key:']', code:'BracketRight', ctrlKey}` is Bring forward.
- Hebrew: `{key:'ז', code:'KeyZ', metaKey}` is undo.

The conflict test also checks the reserved held keys left in CanvasView (contract #1). Palette
glyphs show the bound letter, which is the key's label under key-first matching. Only code-matched
punctuation glyphs come from `navigator.keyboard.getLayoutMap()` when available, else the US
character. Every new write has a byte-exact test: the diff is exactly the intended lines,
with CRLF and BOM fixtures.

## Risks
- **Keyboard conflicts** with the browser and Electron menus (Mod-K in browsers, Mod-Shift-A for Chrome and Edge tab search, Alt-letters on
  Windows AltGr layouts): the conflict test covers the registry. The Alt-letter align commands, Frame selection (Mod-Alt-G), Copy as CSS
  (Mod-Alt-Shift-C) and Invert selection (Mod-Shift-A) are also in the palette, so a blocked key never cuts a user off from a feature.
  Tab search is not one of Chromium's reserved commands (those are new, close and restore tab or window, tab cycling and exit). The page
  sees the keydown first, and the registry's `preventDefault` keeps the chord. Before M8 closes, Mod-Shift-A on the canvas is checked by
  hand in Chrome and Edge on macOS and Windows. If a browser still takes the chord, the palette entry is the fallback and no second alias is added
  (decided: deep-critic r3).
- **Paste safety**: pasted HTML is untrusted. The allow-list is server-side, so a crafted message cannot
  bypass the UI.
- **Unit conversion drift**: rem/%-preserving resize rounds; values are rounded to 2 decimals and the
  test fixes the rounding.
- **Canvas semantics** still unconfirmed by a live pull (v1 M0). Nothing in v2 depends on
  `<dc-import>`, `data-props` or theme blocks; `data-layer-name` and the `-webkit-line-clamp` block are
  plain HTML/CSS the runtime passes through.

## Effort
About 12½ days: contracts 3, M8 2, M9 2½, M10 3, M11 2 — less with parallel waves. The contract stage is three tasks, because with one owner per file its changes cannot all land as one. C1 (about 1½ days) is contracts #3, #6 and #9: `actionId`, the Writer flush and `UndoLog` coalescing, the PatchEngine and ack changes they need, and the validators, each with tests. C1 also includes the hold id for field stepping, so a held ArrowUp in a field makes one undo entry and one write. It goes first, because undo and write-back correctness is what every feature builds on. C2 (about 1 day) is #1 and #7: the registry's aliases, key-first matching with the modifier-only code fallback (with the QWERTZ/AZERTY zoom tests), scopes, the shortcuts moved out of CanvasView, the move tool and the layers panel, and the view setters they call. C3 (about 1 day) is #2, #4, #5 and #8: `insertHtml` and its allow-list, `removeAttr`, `setEditorStyles` and the index's source text. `insertHtml` mints and carries an id for every pasted element and adds the fragment to `shape`, as `duplicateNode` already does. C2 and C3 run in parallel after C1. These fixes go into the contract stage, not into M8–M11, because each one changes a contract a feature depends on. Each reuses an existing mechanism, so the stage estimates hold. The v2 scope is kept: the extra days come from the contract work, and cutting a feature would not reduce it. (decided: deep-critic r4)

## Final fold-in (critic v5)
Decisions for the last critique's concerns, each (decided: Claude 2026-11-23, critic v5):
- **Undo across files.** The undo seal is the action, not the file: the Writer flushes as soon as the
  actionId changes, so one flush never holds two actions, and `flushAll` records one entry per
  actionId even when it spans several files.
- **Refused multi-op actions.** The ws client groups rejections by actionId: one toast and at most one
  reload per action, however many of its ops were refused.
- **Delete, Backspace and arrows after a panel click.** Clicking a panel control that is not a text
  entry (buttons, segmented controls, swatches) hands focus back to the canvas viewport afterwards, so
  canvas-scoped shortcuts keep working as in v1. Text inputs keep focus.
- **Preview-width height.** Measure the board's content height on frame load, after a reload-ack and
  when the preview width changes — never on DOM mutation, so drag previews cannot resize the frame.
- **Marquee leaf vs container.** An element counts as a container for marquee only if it is the artboard
  root or has at least one element child whose computed `display` is not inline-level (`inline`,
  `inline-block`, `contents`). Text with inline children (`<p>` with `<strong>`) is a leaf: a drag on it
  selects and moves it.
- **Electron tests.** Add a Playwright `_electron` suite next to `scripts/smoke-app.mjs` that drives the
  packaged app through its menu (via `Menu.getApplicationMenu()` in `electronApp.evaluate`): Mod-A on
  the canvas selects layers, Mod-A in a field selects text, Mod-C then Mod-V on the canvas pastes. It
  runs in the installers workflow on both OSes.
- **Ids in pasted SVG.** Instead of deleting ids, rename each with a unique per-paste prefix and rewrite
  the fragment's own references (`href="#x"`, `url(#x)`) to match; ids nothing references are dropped,
  as `duplicateNode` does.
- **oklch outside sRGB.** The picker square works in sRGB; an authored oklch value outside sRGB shows an
  "outside sRGB" badge and keeps its text until the user drags, which writes the gamut-mapped value
  (chroma reduced) in oklch.
- **One key-matching rule.** §Contract changes #1 is the only statement of the key-matching rule; the
  Testing and Risks sections refer to it instead of restating it.

