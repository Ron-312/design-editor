# Design Editor v2 — the Figma features people reach for next

v1 built the editor core: one artboard at a time, select / move / resize / snap / measure, Auto
Layout as flexbox, a properties panel, tokens, structure ops, byte-exact write-back and pull/push
(`plans/v1/plan.md`, status in `plans/v1/parity.md`). v2 adds the everyday Figma features v1 left out,
chosen from ten fetched research files (`plans/v2/research/01–10`, merged in `00-summary.md`).

Decisions in this plan were made by Claude for Ron and are tagged `(decided: Claude 2026-11-23)`;
Ron confirms or changes them.

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
actions. The two contract changes are listed first so they land before the features that use them.

## Contract changes (first, one task)
1. **Action key aliases.** `EditorAction.kbd` becomes `string | readonly string[]`; the registry binds
   every alias and the palette shows the first. Backspace and Delete both bind to delete.
   (decided: Claude 2026-11-23)
2. **`insertHtml` edit op.** New `EditKind` `insertHtml` with payload
   `{ parent: EdId; before: EdId | null; html: string }` (target is `[parent]`). The server parses the
   fragment with parse5, then **rejects** it unless every node passes the allow-list: no `<script>`,
   `<iframe>`, `<object>`, `<embed>`, `<base>`, `<meta>`, `<link>`; no `on*` attribute; no
   `javascript:` / `data:` URL except `data:image/*` in `src`; `style` attributes allowed. It must
   pass the existing content-model check for the parent (`src/server/edit/shape-check.ts`). The
   fragment is spliced as text before `before` (or before the parent's end tag), indented to match
   the next sibling, with the file's line endings. One op is one undo entry and reloads the frame,
   like the other structural ops; the ack's `mintedIds` lists the new top-level elements so the UI can
   select them. (decided: Claude 2026-11-23)

## M8 — Keyboard, clipboard, command palette (2 days)
1. **Backspace deletes** the selection (alias of Delete) when focus is not in a text field.
2. **Select all / invert.** Mod-A selects every sibling in the current scope (the selection's parent's
   element children, or the artboard root's children when nothing is selected); Mod-Shift-A selects the
   scope's children that are not selected. Locked and hidden layers are skipped.
3. **Command palette** on Mod-K and Mod-/: a fuzzy list of actions (label + platform shortcut glyphs:
   ⌘⌥⇧ on macOS, Ctrl+Alt+Shift on Windows) and layers (name, tag, class, text); Enter runs or selects,
   Escape closes. It never opens while text editing or while an input has focus. It reads only the
   action registry and the board index — no second list of commands.
4. **Layer copy / cut / paste.** Handle the document `copy` / `cut` / `paste` events (not the async
   Clipboard API, so it works in the browser, Edge and Electron alike) when focus is on the canvas or
   the layers panel. Copy puts the selected elements' **source text** (from the SourceIndex ranges, so
   no `data-ed-id`) on the clipboard as `text/html` and `text/plain`, in document order. Cut = copy
   then `deleteNode`. Paste: if exactly one element is selected and it can hold the fragment (content
   model), append inside it; otherwise insert after the last selected element; with nothing selected,
   append to the artboard root. Paste sends `insertHtml` and selects the minted ids. Pasted HTML from
   other apps goes through the same allow-list, so a rejected paste shows one toast naming the reason.
5. **Copy as CSS** (Mod-Alt-Shift-C) — the selection's authored declarations as a CSS block; **Copy as
   HTML** from the layer context menu and the palette.
6. **Frame selection** (Mod-Alt-G): wrap the selection in a `<div>` (existing `wrapNode`), then add
   auto layout inferred as in M10 #8. Cmd-Backspace / Ctrl-Backspace is an alias of ungroup.
7. **Z-order** Mod-] / Mod-[ (one step) and Mod-Shift-] / Mod-Shift-[ (to front / back). For an
   absolutely positioned element, move it in DOM order among its siblings (`moveNode`), which changes
   paint order only. For a flex or grid item, write `z-index` instead, because DOM order would move it
   in the layout. For anything else the action is disabled with a tooltip. (decided: Claude 2026-11-23)
- **Exit:** unit tests for the alias registry, the scope rules, palette filtering and suspension, the
  allow-list (each rejected construct, plus a clean fragment), indentation and line endings of the
  `insertHtml` splice (LF, CRLF, BOM) and z-order per layout kind. Playwright: copy two elements and
  paste them into another container, cut then undo restores the file byte-identical, Backspace deletes,
  Mod-K runs an action.

## M9 — Multi-selection and arrange (2½ days)
1. **Marquee select.** A drag that starts on empty canvas or on the artboard background draws a
   rectangle; on release it selects the candidates whose rects intersect it. Candidates are the
   children of the current scope (as in M8 #2), read with one batched `rects` probe read at drag start.
   Shift adds to the selection; Escape cancels. The move tool keeps priority when the press lands on a
   selected element.
2. **Move and nudge several elements.** When every selected element is absolutely positioned, a drag
   or arrow nudge moves them together: one `setDecl` op per element per changed property, all sent in
   the same tick so the Writer's 300 ms debounce makes them one undo entry. Snapping uses the
   selection's union rect. A mixed selection (any non-absolute element) keeps v1's refusal toast.
3. **Align and distribute** (Alt-A left, Alt-H centre, Alt-D right, Alt-W top, Alt-V middle, Alt-S
   bottom; Alt-Shift-H / Alt-Shift-V distribute, 3+ elements). For absolutely positioned siblings, write
   `left`/`top` (or the authored `right`/`bottom`) so their boxes align to the selection's bounds. For a
   single flex child, align along the cross axis by setting `align-self`. Anything else is disabled.
   One undo entry per command. (decided: Claude 2026-11-23)
4. **Resize keeps units and takes modifiers.** Resize writes the new size in the property's authored
   unit: px as now; rem/em converted with the computed root / element font size; % converted with the
   containing block's computed width or height. Unknown units (calc(), vw) fall back to px with a toast.
   Shift keeps the aspect ratio of the box at drag start; Alt resizes from the centre for absolutely
   positioned elements (writing the offsets too).
5. **Resize snapping**: the moving edges snap to the same targets as move (`src/ui/canvas/snap.ts`),
   with guides; Ctrl bypasses, as in move.
6. **Flip** horizontal / vertical (Shift-H / Shift-V) writes `scale: -1 1` / `scale: 1 -1`, toggling
   back to removing the property.
- **Exit:** unit tests for marquee hit sets (including Shift-add), multi-move writes and the single
  undo entry, align/distribute maths with hand-computed numbers, unit conversion for px/rem/em/% and
  the fallback, aspect and centre resize, edge snapping. Playwright: marquee-select three columns,
  nudge two absolute elements and undo once, align left, resize a rem width and see rem in the file.

## M10 — Properties panel (3 days)
1. **Colour picker** popover on every colour field: saturation/value square, hue and alpha sliders,
   a notation dropdown (hex, rgb, hsl, oklch) that defaults to the authored format, and an eyedropper
   button using the `EyeDropper` API where available (Chromium, Edge, Electron), hidden otherwise.
   Dragging previews live (`setDecl` preview) and commits once on release.
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
9. **Token binding writes `var(--x)`** when the token is a `:root` custom property; tokens that exist
   only in `tokens.json` keep writing the literal value, because the canvas runtime may not define
   them as variables (decided: Claude 2026-11-23). The field shows the bound token name either way.
- **Exit:** unit tests for colour conversion round-trips per notation (and keeping the authored one),
  the shadow parser on comma/colour-function edge cases, radius split/join, the line-clamp block and
  its warning, Shift-A inference on row / column / single-child cases, and `var()` binding. Playwright:
  pick a colour with the square and see one write, add a shadow layer, set text-align, wrap a flex row.

## M11 — Layers, navigation, code tab (2 days)
1. **Rename a layer** by double-clicking its name in the layers panel: writes `data-layer-name` with
   `setAttr` (the name source v1 already reads first, `src/server/source/template-tree.ts:62`). Enter
   commits, Escape cancels, Tab moves to the next layer. An empty name removes the attribute.
2. **Collapse all** (Alt-L) and Alt-click on a disclosure arrow to expand or collapse the subtree. The
   collapsed set already lives in `.editor/state.json`.
3. **Zoom keys**: Shift-0 to 100%, Mod-= / Mod-- around the viewport centre, Shift-2 zoom to
   selection, and a typed percentage in the zoom menu.
4. **Outline mode** (Mod-Shift-O): the probe adds an editor-only stylesheet (outlines on every
   element, fills and text hidden) and removes it on toggle; never serialised, never saved.
5. **Layer type icons**: flex row, flex column, grid, text, image, repeat (`<sc-for>`), condition
   (`<sc-if>`), import (`<dc-import>`).
6. **Code tab** next to Design in the properties panel: the selection's authored inline style and each
   matching `<helmet><style>` rule as exact source text with `file:line`, plus Copy declaration / Copy
   rule buttons. Read-only in v2.
7. **Image fit**: for `<img>`, an `object-fit` dropdown (fill, contain, cover, none, scale-down) and an
   `object-position` field.
8. **Preview width**: the board width control gains presets (375, 768, 1280, 1440) and a custom width
   field. View-only; it never writes the file.
- **Exit:** unit tests for rename (set, clear, cancel, Tab), subtree collapse, zoom maths, outline
  stylesheet injection and removal, icon choice per node kind, code-tab grouping by source. Playwright:
  rename a layer and see `data-layer-name` in the file, outline mode on and off leaves a zero-byte
  diff, preview width 375 re-lays out the board without a write.

## Testing
Same bar as v1: tests first by a separate agent, one owner per file, the repo gate (`npm run check`)
green per wave, Playwright for anything that needs real layout, both OSes in CI (Chrome and Edge on
Windows). Every new keyboard shortcut is checked against the existing ones for conflicts in one unit
test over the registry. Every new write has a byte-exact test: the diff is exactly the intended lines,
with CRLF and BOM fixtures.

## Risks
- **Keyboard conflicts** with the browser and Electron menus (Mod-K in browsers, Alt-letters on
  Windows AltGr layouts): the conflict test covers the registry; Alt-letter align commands also exist
  in the palette so a blocked key never strands a feature.
- **Paste safety**: pasted HTML is untrusted. The allow-list is server-side, so a crafted message cannot
  bypass the UI.
- **Unit conversion drift**: rem/%-preserving resize rounds; values are rounded to 2 decimals and the
  test fixes the rounding.
- **Canvas semantics** still unconfirmed by a live pull (v1 M0). Nothing in v2 depends on
  `<dc-import>`, `data-props` or theme blocks; `data-layer-name` and the `-webkit-line-clamp` block are
  plain HTML/CSS the runtime passes through.

## Effort
About 9½ days: contract ½, M8 2, M9 2½, M10 3, M11 2 — less with parallel waves.
