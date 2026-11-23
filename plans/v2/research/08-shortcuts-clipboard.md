# Shortcuts, clipboard and quick actions

## Sources (fetched)
1. Copy and paste objects (Figma Help) — https://help.figma.com/hc/en-us/articles/4409078832791 — 2026-11-23
2. Copy and paste properties between layers (Figma Help) — https://help.figma.com/hc/en-us/articles/4412765442967-Copy-and-paste-properties-between-layers — 2026-11-23
3. Use quick actions / Actions menu (Figma Help) — https://help.figma.com/hc/en-us/articles/23570416033943-Use-quick-actions — 2026-11-23
4. Group layers and frames (Figma Help) — https://help.figma.com/hc/en-us/articles/360039832054 — 2026-11-23
5. Keyboard shortcuts for Figma Design (Figma Help; select/view/help only) — https://help.figma.com/hc/en-us/articles/360040328653-Keyboard-shortcuts-for-Figma-Design — 2026-11-23
6. Forum: duplicate in place without offset (Figma Forum) — https://forum.figma.com/t/keyboard-shortcut-to-duplicate-in-place-without-offset/86207 — 2026-11-23
7. Forum: Undo improvements (Figma Forum) — https://forum.figma.com/t/undo-improvements/52618 — 2026-11-23
8. Essential Figma shortcuts (Envato Tuts+; Cmd+/ quick search, Cmd+D, Cmd+G) — https://webdesign.tutsplus.com/essential-figma-shortcuts--cms-35478t — 2026-11-23
9. Framer Quick Actions — https://www.framer.com/updates/quick-actions — 2026-11-23
10. Penpot shortcuts — https://help.penpot.app/user-guide/first-steps/shortcuts/ — 2026-11-23

Search-snippet-only (not fetched, so not cited as fact): a Figma forum thread says there is no action-history panel, only version history; a post says Copy as SVG has no shortcut (forum.figma.com/t/why-there-is-not-shortcut-for-copy-as-svg/41219, returned 403 on fetch). Help pages for Copy-as-SVG and the full shortcut list could not be fetched (defkey 403, framer help 404); items depending on them are marked "unverified".

## Figma features in this area

Our current bindings (src/ui/actions/layer.actions.ts:51-60, history.actions.ts:6-7, style-clipboard.actions.ts:38-45): Mod+G wrap, Mod+Shift+G ungroup, Mod+D duplicate, `Delete` only, Mod+Shift+H/L, Mod+Z / Mod+Shift+Z, Mod+Alt+C/V style. `Mod` = Cmd on Mac, Ctrl on Windows (registry.ts:28-37). The registry ignores keys while text editing (registry.ts:57). Everything below is checked against that.

### 1. Backspace deletes
- Figma: ungroup/delete family; Mac delete key is Backspace. Penpot lists Mac delete as Backspace and Win as Del/Supr [10]. Most important keystroke after undo.
- Status: **Partial** — only `Delete` bound (layer.actions.ts:58); the Mac delete key does nothing (parity.md gap #1).
- Mapping: second chord `Backspace` -> `deleteNode` (removes the element's source span). Registry has one `kbd` string per action, so allow `kbd: string | string[]`.
- Effort S. Risk: must stay inert in inputs (already paused while text editing; also guard the Properties panel inputs).

### 2. Copy / cut / paste of layers (Mod-C / X / V)
- Figma: copy the selection, paste into same/other page or file; pasted objects keep x/y relative to their parent, centered on an axis that does not fit; with a frame selected, paste goes inside it [1]. Multi-paste: one object into many selected frames [1].
- Usage: daily, near-universal.
- Status: **Missing** (parity.md:158; only style clipboard exists, style-clipboard.actions.ts:5 WeakMap per context).
- Mapping: copy = serialize the selected subtree(s) outer HTML plus the rules that apply only to them (inline styles come with it; `<helmet><style>` class rules are the hard part: copy only if the class is still defined in the destination file, else inline the matched declarations); also write `text/html` to the system clipboard so paste works across canvases and into other apps. Paste = new `pasteNode` structural op (insert after selection or as last child of a selected container) with fresh edIds, reusing the duplicate path's id stripping (structural-ops.ts:225, parity.md:125). Cut = copy + `deleteNode` in one undo entry.
- Effort M. Risk: duplicate ids and class-rule portability across `.dc.html` files; define "paste into a selected container" vs "paste next to selection" (Figma pastes into a selected frame [1]).

### 3. Paste over selection / Paste to replace
- Figma: Paste over selection (Cmd/Ctrl+Shift+V) places the copy on top of the selected frame, at its x/y, not inside it. Paste to replace (Cmd/Ctrl+Shift+R) swaps the selection for the clipboard object, and the new one inherits the replaced one's constraints [1].
- Usage: moderate (placeholder swapping, wireframe to real content).
- Status: **Missing**.
- Mapping: replace = one op: insert pasted subtree at the target's position in its parent, copy the target's layout-bearing declarations (`flex`, `grid-area`, `width/height` if fixed, `position/inset`, `margin`) onto the new root, then delete the target; single undo entry. Paste-over = paste as a sibling with `position:absolute` plus matching `inset`, only meaningful in absolute parents.
- Effort M (replace), S on top of #2. Risk: paste-over has no clean flow-layout equivalent; skip it, ship replace only.

### 4. Copy / paste properties
- Figma: Cmd+Alt+C/V (Ctrl+Alt+C/V on Windows) copy and paste all supported properties; single fill/stroke/effect can be copied from the sidebar row with plain Cmd+C then pasted onto another layer; text properties apply to a highlighted range [2].
- Status: **Built** for whole-style (style-clipboard.actions.ts:12-45, authored inline declarations, `{{hole}}` skipped, toast). **Partial** versus Figma: no per-property copy from a panel row, no copy from a class rule (only inline), no cross-session persistence.
- Mapping: panel-row copy = put one declaration group (e.g. `background`, `border*`, `box-shadow`) into the same WeakMap; Mod+C with a panel row focused feeds it. Paste uses existing `setDecl`.
- Effort S. Risk: Windows Ctrl+Alt is AltGr on some layouts (inference, not sourced); keep a menu/palette route for the same action.

### 5. Duplicate with offset memory (Cmd-D repeat) and Alt-drag
- Figma: Cmd/Ctrl+D duplicates; top-level frames go to the right, others land on top of the original [1]. Repeat: Ctrl+D "repeat[s] the last offset that was used" [6]; there is no duplicate-in-place shortcut, only a request [6]. Alt/Option+drag duplicates [1].
- Usage: very common for rows of cards/items.
- Status: **Partial** — Mod+D exists (layer.actions.ts:57); no offset memory; Alt-drag is Not built (parity.md:56).
- Mapping: in flow layout the duplicate is inserted after the original (offset is meaningless, DOM order is the offset). Offset memory only matters when the target has `position:absolute`/`transform`: remember the last move delta (dx,dy) applied after a duplicate and write `left/top` (or `inset`) of the next duplicate as source + delta. Alt-drag = duplicateNode then moveNode to drop target, one undo entry.
- Effort S (offset memory for absolute), M (Alt-drag, shares drag code). Risk: in flow layouts a "Cmd-D then drag-reorder" has no offset to repeat; document that.

### 6. Group / ungroup / frame selection
- Figma: Group Cmd/Ctrl+G; make a frame Cmd+Option+G / Ctrl+Alt+G; ungroup Shift+Cmd/Ctrl+G or Cmd+Delete / Ctrl+Backspace, same command for groups and frames [4]. Groups take children's combined size; frames have set size [4].
- Status: **Partial** — Mod+G wraps in a `div` and Mod+Shift+G unwraps (layer.actions.ts:52-56). No separate "frame" variant, no Cmd+Delete ungroup alias.
- Mapping: Group = `wrapNode` tag `div` with no extra CSS (shrink-wraps; in an absolute parent write `position:absolute; inset` from union rect). Frame selection (Mod+Alt+G) = same wrap but also write `display:flex` (or `position:relative` + explicit `width/height` of the union rect) so it behaves as a sized container; the payload today only takes `tag` (structural-ops.ts:263), add an optional `style`.
- Effort S. Risk: choose one clear meaning for "frame" in HTML (recommend: `div` with `position:relative; width; height` when children are absolute, `display:flex` when flow).

### 7. Command palette / Actions menu
- Figma: opened with Cmd/Ctrl+K from the toolbar Actions icon; search box finds actions by keyword (e.g. "align"), grouped as layer operations, selection and styling, editing tools, view and navigation, file management, preferences; also AI tools, plugins, widgets, "Find more like" asset search [3]. Older shortcut Cmd+/ [8] (snippet says it may still work; unverified in current docs). Framer: Cmd/Ctrl+K, finds pages and components, navigates, shows shortcuts [9]. Penpot: no palette, only Ctrl+F [10].
- Usage: high among power users; also how copy-as-SVG is reached in Figma (Quick Actions then type, per forum snippet, unverified).
- Status: **Missing** (parity.md:165); the registry already has id/label/kbd/when (registry.ts:45), so it is cheap.
- Mapping: list every `EditorAction` filtered by `when(ctx)`, show label + formatted `kbd` per platform, fuzzy filter, Enter runs `run(ctx)`. Extra sources: layers by tag/class/text (jump-to-selection), design tokens (apply `var(--x)`), canvas boards.
- Effort S (actions only), M (layers + tokens). Risk: `Mod+K` conflicts nothing today; keep Cmd+/ as an alias to match Figma muscle memory.

### 8. Copy as CSS / SVG / PNG
- Figma: Copy as PNG is Cmd/Ctrl+Shift+C, 2x by default, pasteable with Cmd+Shift+V; Copy/Paste as > Copy as code gives CSS, iOS or Android [1]. Copy as SVG is in the same right-click submenu [Search snippet, unverified]; no confirmed shortcut.
- Usage: Copy as CSS moderate (dev handoff); PNG moderate (sharing).
- Status: **Missing** (parity.md:172 lists PNG export only as M7 #8; SVG export out of scope).
- Mapping: Copy as CSS is almost free for us: the authored declarations of the selection (inline + matched rule) printed as a rule block, written to the system clipboard (`navigator.clipboard.writeText`); the existing `authoredStyleOf` (style-clipboard.actions.ts:16) is the source. Copy as HTML = outer HTML of the node (the same payload as #2). PNG needs rasterization (SVG foreignObject or html-to-image) — large fidelity risk with fonts and `{{holes}}`.
- Effort S (CSS, HTML), L (PNG). Risk: clipboard API needs a user gesture and a secure context (localhost qualifies).

### 9. Undo history panel
- Figma: no action list; users want one and cite Illustrator's History panel, complain that each click/selection is an undo step, undo depth is limited, and the Edit menu does not name the last action [7]. Version history is the fallback (snippet only).
- Status: **Partial** — our undo is stronger than Figma's: snapshot undo per file, byte-identical, one entry per burst or multi-target op, selections are not steps (parity.md:136-138). No list UI.
- Mapping: expose the undo-log entries (`src/server/edit/undo-log.ts`) as a list with labels ("Set width", "Wrap in container"); click an entry = undo/redo to that point. Name the next undo in the Edit menu/toast ("Undo Duplicate").
- Effort M. Risk: entries need human labels; the log stores snapshots, not op names, today.

### 10. Remaining common keys (parity.md:159)
- Select all (Mod+A), Mod+C/V/X layers, Mod+]/[ arrange, Shift+A auto layout, arrow nudge. Figma nudges 1px, 10px with Shift; Cmd/Ctrl+arrow resizes [8]. Select next/prev sibling with Tab / Shift+Tab, Enter/Esc for child/parent [5]; Tab/Enter/Esc already built (parity.md:158).
- Status: Mod+A, Mod+]/[ **Missing**; nudge **Missing** for multi-selection (parity gap #2).
- Mapping: nudge = `left/top` or `transform: translate` on absolute elements, `margin` otherwise (confirm with 01-selection.md); Mod+]/[ = `z-index` swap or DOM reorder (`moveNode`); Mod+A = select all siblings of the current selection.
- Effort S each.

### 11. Platform differences (we ship Mac and Windows)
- Mac Backspace vs Windows Delete/Backspace: Figma Windows ungroup also uses Ctrl+Backspace [4]; Penpot Mac delete is the Backspace key [10].
- Cmd+Alt+G/C/V = Ctrl+Alt+G/C/V on Windows [2][4]; Ctrl+Alt may be AltGr on European layouts (inference, unverified) — always offer menu/palette entry.
- Redo: registry binds Mod+Shift+Z only (history.actions.ts:7); Windows users expect Ctrl+Y too (not verified in a fetched source) — add as alias.
- Show the platform's glyphs in tooltips/palette (⌘⌥⇧ vs Ctrl+Alt+Shift); Penpot's table does this split [10].

## Recommended for v2
1. Backspace deletes (add key alias support in the registry) — Mac users lose the main delete key today — S
2. Layer copy / cut / paste (Mod+C/X/V, HTML on the system clipboard) — biggest missing editing primitive, enables cross-canvas moves — M
3. Command palette Mod+K (alias Mod+/) over the action registry, show platform-correct shortcuts — registry already exists, also makes shortcuts discoverable — S
4. Frame selection (Mod+Alt+G) plus Cmd/Ctrl+Backspace ungroup alias — completes the group family with a real flex/sized container — S
5. Paste to replace (Mod+Shift+R) inheriting the target's layout declarations — placeholder swapping — S after #2
6. Copy as CSS / HTML (right-click and palette) — near-free from existing authored-declaration code; dev handoff — S
7. Duplicate offset memory for absolute-positioned elements, then Alt-drag duplicate — row/grid building — S + M
8. Undo history list with named steps, "Undo <action>" label — beats Figma's gap; needs op labels in the undo log — M

## Not worth it
- Paste over selection (Mod+Shift+V): a z-stacking trick with no flow-layout meaning in HTML; replace covers the real use [1].
- Duplicate-in-place without offset: Figma itself lacks it [6]; in flow layout our duplicate already inserts adjacent.
- Copy as PNG: needs HTML rasterization (fonts, `{{holes}}`) with high fidelity risk; already tracked as M7 #8 — do after CSS/HTML copy.
- Copy as iOS / Android code: not our target platform [1].
- Copy as SVG: SVG export is out of scope in v1 (parity.md:181) and no confirmed Figma shortcut exists.
- Figma AI actions, plugins and widgets in the Actions menu: not applicable [3]; our own Ask-Claude action is M7 #2.
- Paste-with-view-centering heuristics (paste centers on screen when out of view) [1]: meaningless when paste targets a DOM position.
- Penpot-style Shift+G ungroup remap: would collide with Figma's Mod+Shift+G muscle memory we already match [10].
