# v2 research summary

Ten areas, one file each (01–10), each researched by a separate agent with fetched sources. This page
merges their ranked lists against what v1 built (`plans/v1/parity.md`) and sorts every recommendation
into **v2** (in `plans/v2/plan.md`) or **later**. The tie-breaker for v2 was: how much a Figma user
would miss it, whether it maps cleanly onto HTML/CSS the canvas already holds, and whether it depends on
the unconfirmed canvas semantics (`<dc-import>`, `data-props`, theme blocks), which wait for the live
M0 check.

| # | Feature | From | Size | Decision |
|---|---|---|---|---|
| 1 | Backspace deletes (registry key aliases) | 08 | S | v2 · M8 |
| 2 | Select all / invert in scope (Mod-A, Mod-Shift-A) | 01 | S | v2 · M8 |
| 3 | Command palette (Mod-K, Mod-/) over actions and layers | 08, v1 M7 #1 | S | v2 · M8 |
| 4 | Layer copy / cut / paste as HTML | 08 | M | v2 · M8 |
| 5 | Copy as CSS / copy as HTML | 08, 09 | S | v2 · M8 |
| 6 | Frame selection (Mod-Alt-G) | 08 | S | v2 · M8 |
| 7 | Z-order (Mod-] / Mod-[ and Shift variants) | 02, 08 | S | v2 · M8 |
| 8 | Marquee select | 01 | M | v2 · M9 |
| 9 | Multi-selection move and nudge as one undo entry | 01, 02 | M | v2 · M9 |
| 10 | Align and distribute (Alt-A/D/H/W/V/S) | 02 | M | v2 · M9 |
| 11 | Resize keeps authored units; Shift aspect; Alt from centre | 02 | M | v2 · M9 |
| 12 | Resize snapping on the moving edges | 02 | S-M | v2 · M9 |
| 13 | Flip horizontal / vertical (`scale`) | 02 | S | v2 · M9 |
| 14 | Colour picker (square, hue, alpha, notation, eyedropper) | 04 | M | v2 · M10 |
| 15 | Per-corner radius with link toggle | 04 | S | v2 · M10 |
| 16 | Editable shadow list | 04 | S-M | v2 · M10 |
| 17 | Blur, background blur, blend mode | 04 | S | v2 · M10 |
| 18 | Stroke style and per-side widths | 04 | M | v2 · M10 |
| 19 | Text align, case, decoration, italic | 05 | S | v2 · M10 |
| 20 | Text resizing mode (auto width / auto height / fixed) | 05 | S | v2 · M10 |
| 21 | Max lines (line clamp) and wrap style (balance / pretty) | 05 | S | v2 · M10 |
| 22 | Auto layout: wrap, spacing modes, baseline | 03 | S-M | v2 · M10 |
| 23 | Shift-A add auto layout (inferred) / Alt-Shift-A remove | 03 | S | v2 · M10 |
| 24 | Token binding writes `var(--x)` for `:root` variables | 06 | S | v2 · M10 |
| 25 | Rename layer (writes `data-layer-name`) | 07 | S | v2 · M11 |
| 26 | Collapse all; Alt-click expands a subtree | 07 | S | v2 · M11 |
| 27 | Zoom keys (Shift-0, Mod-=/-, Shift-2, typed %) | 07 | S | v2 · M11 |
| 28 | Outline mode (editor-only stylesheet) | 07, v1 M7 #7 | S-M | v2 · M11 |
| 29 | Layer type icons | 07 | S | v2 · M11 |
| 30 | Code tab: authored CSS by source, file:line, copy | 09 | S | v2 · M11 |
| 31 | Image fit (`object-fit` / `object-position`) | 10 | S | v2 · M11 |
| 32 | Preview width presets and custom width (view only) | 10 | S | v2 · M11 |
| — | Breakpoint editing into `@media` | 10 | L | later: needs multi-viewport and a helmet target |
| — | Components via `<dc-import>`; theme modes; detach | 06 | M-L | later: canvas semantics unconfirmed until M0 |
| — | Create style from selection (hoist to a class rule) | 06, 05 | M | later: needs the cascade view first |
| — | Editable code view, cascade view, class management | 09 | M | later: v2 ships the read-only code tab first |
| — | Gradients, multiple fills, image fills | 04 | M-L | later: background shorthand parsing |
| — | Image drop / replace | 10 | M | later: needs an asset-location decision |
| — | Grid editing, Suggest auto layout | 03 | M | later |
| — | Rotation handle, constraints widget, gap handles | 02 | M | later |
| — | Select matching, selection colours, bulk rename, guides | 01, 04, 07 | M | later |
| — | Named versions on git, comments, present mode | 10 | M | later |
| — | Annotations, visual compare | 09 | M-L | later |

Rejected in the area files (each with its reason there): prototype flows and Smart Animate, scale tool,
negative gap with stacking order, vector networks, variant sets as a data model, multi-user features,
image adjustments, pixel grid, minimap, iOS/Android code, codegen plugins.

## Source quality

Most claims cite help.figma.com, MDN or the Penpot docs fetched in the run. Webflow help returned 403 to
every agent, so Webflow claims are either absent or marked "search snippet, unverified" in the file.
Figma's shortcut reference, its Copy-as-SVG page and a few forum threads also could not be fetched; the
files say which claims rest on those.
