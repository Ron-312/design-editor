# Figma ideas for the local Claude Design editor

Synthesis of the five research files in this folder (2026-11-23). Each idea links to the file with
the details, sources and pitfalls.

**The editor in one line:** pull a Claude Design project as plain HTML/CSS → edit it on a Figma-style
canvas → every change is spliced into the real source files → push back to Claude Design.
The DOM/CSS *is* the document; there is no separate design format.

## Core architecture (decided by the research)

| Decision | Why | Ref |
|---|---|---|
| Project renders in an **iframe**; handles, outlines and guides draw in a separate **overlay** layer; zoom is a `transform` on a wrapper | Keeps editor UI out of the page's CSS; transparent shield keeps wheel/pointer events | 01 |
| Parse HTML with **parse5** (source locations) and CSS with **PostCSS** (keeps `raws`) into a source index | Click → exact byte range in a file | 05 |
| Inject a stable **`data-oid`** at serve time only, never on disk | Lovable approach, and Onlook v1's (current Onlook instead has an agent edit a git worktree, see 09 B1-B3); plain HTML maps 1:1 | 05, 09 |
| Edits apply to the live DOM instantly, then a **minimal text splice** is written after a debounce (atomic write, re-index) | Never reprint a whole file — comments and formatting survive; a no-op session = zero-byte diff | 03, 05 |
| **Write target order:** chosen rule → the unique rule that wins the cascade → inline `style`; "extract to class" is explicit | Never write computed values; keep authored units, colour format and `var()` | 02, 03, 05 |
| Panel always shows **which selector + file:line** is being edited, and warns when a class is shared | #1 user complaint about Webflow and GrapesJS | 03, 05 |
| **Undo** = inverse property patches, coalesced per drag/typing burst (plan.md chose file snapshots instead) | Mirrors Figma's object→property model | 04 |
| **Push safety:** base file hashes at pull; on conflict, replay the patch log on the remote text and only ask on same-element/same-property clashes | Never silently overwrite edits made in Claude Design | 04 |
| File watcher reconciles outside edits and ignores the editor's own writes | Pinegrow approach | 05 |
| Hide/lock live in `.editor/`, never in the source | Editor-only state | 04 |

## v1 — must have

**Canvas (01)**
- One hit-test for hover and click: click = top-level parent, double-click/Enter = go deeper, Cmd-click = deepest, Shift-click = multi-select, Tab/Shift-Tab = siblings.
- Context-aware drag: in flex/grid it **reorders** (insertion line); absolute elements write `left/top`; transformed elements edit only `translate`. 3–4px drag threshold. Arrows nudge 1px, Shift 10px.
- 8 resize handles writing `width/height` (respect `box-sizing`, keep units, warn when `flex-grow` overrides), with a live size label.
- Snapping to sibling/parent edges and centres (≈8 screen px ÷ zoom), guides drawn on snap, Ctrl disables.
- Alt-hover red distance lines, labelled margin / padding / gap.
- Zoom and pan: Cmd-wheel and pinch about the cursor, Space-drag, Shift-1 fit, Shift-2 selection.

**Layout = flexbox (02)**
- Auto Layout panel: direction, gap, padding, 9-dot alignment (`justify-content` × `align-items`, axes swap in column; a visible "stretch" state).
- Hug / Fill / Fixed per axis + min/max: Hug = no size; Fill = `flex:1 1 0` (+ `min-width:0`, `min-height:0` in a column; shrink is irrelevant at basis 0) or `align-self:stretch`; Fixed = size + `flex-shrink:0` (editor policy, not a Figma fact). Min/max in any CSS unit, not just px (08).
- Drag padding handles on the canvas (Alt = opposite sides, Alt-Shift = all).
- "Ignore auto layout" = `position:absolute` on the child + `relative` on the parent.

**Properties panel (03)**
- Section order is our design choice (Figma documents no visual order, 08 #27): Position, Layout, Appearance, Typography, Fill, Stroke, Effects; x/y only for positioned elements.
- Number inputs with arrow steps and unit preservation (no `px` on unitless properties like line-height, opacity and z-index).
- Solid colour picker (hex/HSL + alpha), fill alpha separate from `opacity`. Figma's models are Hex, HSB, HSL, CSS, RGB; keep `oklch()`/P3 values unclamped (08 #36-37).
- **Tokens:** a picker over `:root --*` writes `var(--x)`, keeping the variable's case (Figma Dev Mode does not lowercase names, 08 #40); typing a raw value detaches that element only; editing the token itself is an explicit action.
- Shadow list (inset, reorder), border, radius, text properties; double-click text to edit it in place.

**Structure (04)**
- Layers panel = DOM tree, named `data-layer-name` → id → class → tag; reorder, reparent, wrap in container, ungroup, duplicate (strip duplicate ids, block void elements).
- Copy/paste style = authored declarations, with a toast showing what was applied.

## Next — should have
- Marquee select, equal-gap snapping, align/distribute, gap handles, rotation (Shift = 15°). (01)
- Add/remove auto layout, wrap with row/column gap, basic CSS grid (track chips fr/px/auto, spans), a constraints widget for absolute children. (02)
- Drag-to-scrub and math in number inputs, gradients, eyedropper, contrast badge, token create/rename, blur/backdrop-filter, `@media` and `:hover` targets, a CSS tab showing the real rule. (03)
- Layer search, pages = HTML files, viewport frames (mobile/desktop), named versions (git snapshots), "edit all identical". (04)
- Per-file diff panel with revert, like the Chrome DevTools Changes tab. (05)

## Later
- Multi-selection resize, drag to re-parent, corner-radius handles. (01) Select matching, "Mixed" multi-edit, outline view and pixel grid were upgraded by 07 (multi-edit is now a must, in plan M5; the rest in M7). Pixel grid toggles with Cmd+' (Cmd+Shift+' snaps), not Shift+', and shows only at 400%+; zoom presets 50/100/200% have no shortcut (07 #16-17).
- Centre/scale constraints, `auto-fill`/`minmax`, `grid-template-areas`, layout guides. (02)
- Light/dark modes (detect `[data-theme]` / `prefers-color-scheme` first), "Selection colours" replace, image fills. (03)
- Variants as modifier classes, comments as `.editor/` notes, web components. (04)
- Hand edits the editor can't map to Claude Code (Onlook v2 does this). (05)

## Avoid
- A separate JSON model of the page (GrapesJS, Builder.io) — it drifts from the source.
- Saving from the live DOM — the DOM is not the HTML (why DevTools doesn't save Elements edits).
- Reformatting whole files on save.

## Known gaps in the research
- Snapping internals come from tldraw/Moveable docs, not Figma itself. (01)
- Some Figma forum pages returned 403; those claims are marked in the files. (02, 03)
- Penpot/Webflow/Framer write-back details rest on search summaries. (05) PostCSS does expose `source.start.offset` (since 8.0, fixed 8.4.29), so 05's "line/column only" is wrong (09 B12). Onlook's complaint list is partly filled in 09 B4.
