# Layers panel, pages and canvas navigation

## Sources (fetched)
1. View layers and assets in the left sidebar (Figma Help) — https://help.figma.com/hc/en-us/articles/360039831974-View-layers-and-assets-in-the-left-sidebar — 2026-11-23
2. Create and manage pages (Figma Help) — https://help.figma.com/hc/en-us/articles/360038511293 — 2026-11-23
3. Rename layers (Figma Help, "Before you Start" id) — https://help.figma.com/hc/en-us/articles/360039958934 — 2026-11-23
4. Adjust your zoom and view options (Figma Help) — https://help.figma.com/hc/en-us/articles/360041065034 — 2026-11-23
5. Add guides to the canvas or frames (Figma Help) — https://help.figma.com/hc/en-us/articles/360040449713-Add-guides-to-the-canvas-or-frames — 2026-11-23
6. Frames (Figma Help) — https://help.figma.com/hc/en-us/articles/360041539473 — 2026-11-23
7. Outlines / hidden layers (Figma Help) — https://help.figma.com/hc/en-us/articles/360041112614 — 2026-11-23
8. Move around (Figma Help; page content is the FigJam variant, only used for hand tool/Space, presets) — https://help.figma.com/hc/en-us/articles/1500004414582 — 2026-11-23
9. Workspace basics (Penpot Help) — https://help.penpot.app/user-guide/workspace-basics/ — 2026-11-23
10. Using the canvas (Framer Help) — https://www.framer.com/help/articles/how-to-use-the-canvas/ — 2026-11-23

Not obtained: uxplanet rename guide (403), Webflow "Expand canvas" (403). Figma has no minimap in any fetched page [4][8]; Framer page does not mention one either [10].

## Figma features in this area

Current baseline (parity.md "Canvas & navigation" and "Layers"): Built = wheel/pinch zoom, Space/H pan, Shift-1/Shift-2, zoom menu 50/100/200, board switcher, rulers (selection range), layers tree with sc-for/sc-if, names, selection sync, drag reorder/reparent, hide/lock, layer search, hit-test. Not built = collapse-all, outline view, guides, side-by-side boards, pixel grid.

1. **Rename layer (double-click) and bulk rename (Cmd-R).** Double-click a layer to rename it; Cmd/Ctrl-R opens a modal for many layers: same name, Number up/down, Current-name prefix, Match + regex with `$1`, `$&`, `$n` [3]. Penpot: Tab in rename saves and moves to the next layer, Shift-Tab to the previous [9]. Ubiquitous; renaming is how designers label sections. Status: **Missing** (grep of `src/ui/panels/LayersPanel.tsx` finds no rename; names are read-only, `template-tree.ts:62-65`). HTML/CSS: write/replace `data-layer-name="..."` attribute on the element (the name source already read first in the chain). Bulk: same attribute op over N targets in one undo (multi-edit path exists, `fields.tsx:170`). Regex/Number tokens are pure UI string logic. Effort: single rename S; bulk modal M. Risk: needs an attribute-splice op (add attr when absent, keep quote style); `sc-for` rows rename the template node (affects all repeats; label it).
2. **Collapse all layers.** Button top-right of panel closes every expanded layer, keeping the selection's path open [1]. Penpot: Shift-click an arrow collapses all, Alt-click expands a subtree [9]. Daily use in deep trees. Status: **Missing** (parity.md row "Collapse all layers"; collapsed state is already stored in `editorState.collapsed`, `LayersPanel.tsx:175,243`). HTML/CSS: none; sets `.editor/state.json` collapsed list to all expandable ids except ancestors of the selection. Effort S. Risk: none. Add Alt-click-expand-subtree for free.
3. **Layer type icons.** Each row's icon shows frame/group/text/shape/image/auto-layout (direction-aware)/instance [1]. Common, makes dense trees scannable. Status: **Partial** — only chevron/eye/lock icons exist (`LayersPanel.tsx:349`); no per-type icon found. HTML/CSS mapping (read-only, from tag + computed style known to the tree): `display:flex` row/column icon, `<img>`/`<svg>` image, text-only node T, `position:absolute` leaf, `<sc-for>`/`<sc-if>` badges, `<dc-import>` component. Effort S. Risk: flex direction needs the style the tree builder may not have; use the probe's computed style or a class heuristic.
4. **Layer-reorder keyboard + Tab-to-next.** Penpot: Ctrl/Cmd-Up/Down moves the selected layer in the list; Tab/Shift-Tab select next/prev layer [9]. Figma: Enter/Tab/Shift-Tab select children/siblings [6] (already built, `selection.ts:80-104`). Status: Tab/Enter **Built**; keyboard reorder **Missing** (drag only, `LayersPanel.tsx:201-236`). HTML/CSS: existing move-sibling op (same op the drag writes). Effort S. Risk: must honour forbidden-parent/positional-selector warning already in `structural-ops.ts`.
5. **Zoom to layer from the layers list.** Penpot: double-click a layer's icon zooms to it [9]; Figma Shift-2 [4] already built. Status: **Missing** from the panel (viewport.ts has the math, `CanvasView.tsx:403-411`). HTML/CSS: none. Effort S.
6. **Pages list (multiple pages per file) and page ops.** Pages have own canvas; create, rename (double-click), drag-reorder, duplicate, "Move to page" keeps coordinates [2]. Penpot: `---` page name makes a divider [9]. Status: **Partial** — our "board switcher" (`TopBar.tsx:69`, `store.ts:10`) is the equivalent (one `.dc.html` = one canvas, artboards = boards). HTML/CSS mapping: page = file, board = top-level artboard node; "move to page" = cut/paste node between files (cross-file structural op, new). Rename of a board = `data-layer-name` (item 1). Effort: reorder/rename boards S; move between files L. Risk: cross-file undo atomicity; reject move-to-page for v2, keep board list (rename + reorder + duplicate board via existing duplicate op).
7. **Multiple frames visible side by side on one canvas.** Figma canvas shows all top-level frames; Shift-1 fits all [4][8]. Status: **Missing / out of scope** (parity.md: one artboard mounted at a time). HTML/CSS: mount N iframes (one per artboard, or one iframe of the whole canvas file laid out as the .dc.html already is) in the world space; selection/edit already addressed by edId so edits are unchanged. Effort L. Risk: N probes and N overlays, perf, per-board scroll/hover routing; largest architectural change in this area. Cheaper partial: a "board overview" zoom-out thumbnail strip.
8. **Zoom presets and keys.** Zoom field accepts typed values and presets; Shift-+ / Shift-- , Shift-1 fit, Shift-2 selection [4]; Framer Cmd +/- doubles zoom [10]; Penpot Shift-0 = 100% [9]. Status: **Partial** — menu 50/100/200 and Shift-1/2 built; no keys for in/out/100%, no typed value (`TopBar.tsx:112,138`; parity.md notes no Shift-0 / Cmd +/-). HTML/CSS: none. Effort S. Add Shift-0 (100%), Cmd +/- (steps), editable percent field.
9. **Outline (wireframe) mode.** Cmd/Ctrl-Shift-O shows outlines of layers, including hidden ones, so they can be selected [7]; option for hidden layers and object bounds noted in forum (not an official page we fetched). Status: **Missing** (parity.md M7 #7). HTML/CSS: inject an editor-only stylesheet into the iframe: `* { outline:1px solid rgba(..); background:transparent !important; }` via the probe, never touching the source; hidden layers (already applied at serve time by `serve-transform.ts:56`) rendered with `display:revert` while mode on. Effort S-M. Risk: `!important` overrides; strip when leaving mode; text colour stays.
10. **Guides and rulers.** Drag from ruler to make a guide, guides at canvas or frame level, Option-drag duplicates, Option shows distances, remove by drag back / Delete / right-click [5]. Penpot adds double-click pill to type an exact position, board guides (square/row/column) shown only in viewport, toggle visibility Ctrl-' and snapping Shift-Ctrl-' [9]. Status: rulers **Built** (`CanvasView.tsx:511,585`); guides **Missing** (plan Next). HTML/CSS: guides are editor-only (store in `.editor/state.json`, like hide/lock) and feed the existing snap engine (`snap.ts:33`); never written to source. Frame layout guides (columns) could map to a visual overlay of the grid, not CSS writes. Effort M. Risk: persistence per board and per unit (px vs zoom).
11. **Hand tool / Space-pan, recenter.** H, hold Space, trackpad drag, "Recenter" button [8]. Status: **Built** (`CanvasView.tsx:437,445`); recenter **Missing**, trivial (reuse fit). S.
12. **Frame presets and Frame tool.** With Frame tool (F/A), sidebar offers Phone/Tablet/Desktop/Presentation/Watch/Paper/Social presets; a selected frame can switch preset; Resize to fit contents shortcut; Cmd-Alt-G frame selection [6]. Status: **Missing** for presets and "create a board"; wrap-in-container Mod-G **Built** (`structural-ops.ts:263`). HTML/CSS: preset = `width`/`height` px on the artboard root (or `min-height` for responsive); "resize to fit" = `height:auto`/`fit-content`; new frame = insert a `<div>` with `width/height` (and `position:relative; overflow:hidden` for clip). Effort S for preset dropdown on a selected board; M for "new board" tool. Risk: artboard root resize disabled by design (`resize.tool.ts:32`), so preset dropdown must be the sanctioned path and respect token/units.
13. **Highlight on hover (layers panel)** [1] and **Minimize UI (Cmd-Shift-\\)** [1]. Hover highlight likely Partial via shared hit-test; Minimize UI Missing, S, purely UI. Low value in a single-file tool.
14. **Pixel grid (Cmd-') and snap to pixel grid (Cmd-Shift-')** shown at 400%+ [4]. Status: **Missing**. HTML/CSS: editor overlay; snapping writes rounded px. Effort S-M. Low demand for HTML work.
15. **Focus mode (F in Penpot)** [9]: isolates selection. Missing. HTML/CSS: editor-only `visibility` of siblings in the probe. S; nice for deep trees.

## Recommended for v2 (ranked)
1. Rename layers (double-click -> `data-layer-name`) with Tab-to-next — biggest gap, trivially expressive for the file — S
2. Collapse all layers (+ Alt-click expand subtree) — planned already, state exists — S
3. Zoom keys: Shift-0, Cmd +/-, typed zoom percent, recenter — closes zoom parity — S
4. Layer type icons (flex dir, text, image, repeat, import) — scannability — S
5. Outline mode (Cmd-Shift-O) via editor-only injected CSS — reveals structure, hidden layers — S-M
6. Frame/board presets dropdown + resize-to-fit on selected board — responsive checks — S-M
7. Guides (editor-only, persisted in state.json, feed snap.ts) — completes rulers — M
8. Bulk rename modal (Cmd-R, Number, Match/regex) — power users after #1 — M

(Also cheap: keyboard layer reorder with Cmd-Up/Down, zoom-to-layer from the list, focus mode.)

## Not worth it
- Move layers between pages (cross-file) — needs a two-file atomic op and undo; boards in one file cover most use.
- Pages list as separate canvas files — one `.dc.html` is the unit; board switcher already serves.
- Page separators (`---` name) — only meaningful with real pages list.
- Pixel grid / snap-to-pixel — little value for HTML/CSS layout, which is not pixel-bitmap bound.
- Minimap — none of Figma [4][8] or Framer [10] pages we fetched document one.
- Minimize-UI toggle — cosmetic; not a data feature.
- Multi-board side-by-side — valuable but L-size architectural rewrite of the single-iframe model (see #7); defer unless v2 is willing to pay for N probes. Webflow's "Expand canvas" is a comparable feature but its page returned 403, so no claim made.
- Starter-plan page limits, multiplayer cursors, prototype connection visibility [2][4] — N/A.
