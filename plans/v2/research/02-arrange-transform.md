# Arrange & transform

Fetched 2026-11-23. Status checked against `plans/v1/parity.md` and `src/` (grep for z-index/rotate/flip/reorder done).
Search-result snippets were NOT used as citations; only pages listed below were fetched and read.

## Sources (fetched)
1. Figma Help, Adjust alignment, rotation, position, and dimensions — https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions — 2026-11-23
2. Figma Help, Apply constraints to define how layers resize — https://help.figma.com/hc/en-us/articles/360039957734 — 2026-11-23
3. Figma Help, Scale layers while maintaining proportions (Scale tool) — https://help.figma.com/hc/en-us/articles/360040451453 — 2026-11-23
4. Figma Help, Arrange layers with smart selection — https://help.figma.com/hc/en-us/articles/360040450233 — 2026-11-23
5. Figma blog, Introducing smart selection — https://www.figma.com/blog/introducing-smart-selection/ — 2026-11-23
6. Figma Help, FD4B Clean up your layers (align, distribute, smart selection) — https://help.figma.com/hc/en-us/articles/30979556779159-FD4B-Clean-up-your-layers — 2026-11-23
7. Figma Help, Snap to pixel grid — https://help.figma.com/hc/en-us/articles/360041065034 — 2026-11-23
8. Figma Community forum, shortcut preview for layering objects (bring forward etc.) — https://forum.figma.com/ask-the-community-7/fix-the-shortcut-preview-for-layering-objects-16425 — 2026-11-23 (forum, not official docs)
9. Penpot Help, Shortcuts — https://help.penpot.app/user-guide/first-steps/shortcuts/ — 2026-11-23
10. Penpot Help, Workspace basics (dynamic alignment, equal distances, layer order) — https://help.penpot.app/user-guide/designing/workspace-basics/ — 2026-11-23
11. Framer Academy, Layer positioning modes — https://www.framer.com/academy/lessons/layer-positioning-modes-in-framer — 2026-11-23
12. MDN, CSS `inset` (plus positioned-layout rules for stretch/over-constraint) — https://developer.mozilla.org/en-US/docs/Web/CSS/inset — 2026-11-23
13. MDN, CSS `z-index` — https://developer.mozilla.org/en-US/docs/Web/CSS/z-index — 2026-11-23
14. MDN, CSS `transform-origin` — https://developer.mozilla.org/en-US/docs/Web/CSS/transform-origin — 2026-11-23

Fetch failures (not cited): help.penpot.app/user-guide/layer-basics (404), Figma snapping/guides article 360041062214 (404), sketch.com resizing-constraints (page was only a nav stub). So Figma's smart-guide/equal-spacing snap behaviour is documented here only via Penpot [10]; I found no official Figma page that I could fetch for it.

## Figma features in this area

### 1. Align left/centre/right/top/middle/bottom
- What: six align buttons; shortcuts Alt+A/H/D (left/h-centre/right) and Alt+W/V/S (top/v-centre/bottom). Shift-click aligns the multi-selection as a group to its parent frame [1]. Penpot has the same keys [9] and aligns relative to the selection bounds [10].
- Reliance: very high (daily), alongside distribute the top missing basic.
- Status: **Missing** (parity.md "Equal-gap snapping, align / distribute — Not built"; gap #5). No align code in `src/`.
- Mapping: depends on parent context. (a) Absolute/positioned siblings: write `left`/`top` (or `translate` term if transformed, as `move.tool.ts:95` does) so edges/centres match the selection bbox; keep authored unit (`%` stays `%`). (b) Single element in a flex parent: align = `align-self` (cross axis) / `margin-inline: auto` (main axis); a multi-selection inside a flex/grid parent should instead set the PARENT's `justify-content`/`align-items` (the 9-dot control) rather than coordinates. (c) Mixed or static-flow elements: disable the button with a reason, not a silent `position:absolute` rewrite.
- Effort: M (rect read via existing `ctx.read({kind:'rects'})`, one multi-target op = one undo; needs multi-selection move math from gap #2).
- Risk: align to a bbox written as px loses `%`/rem units; static-flow elements have no coordinates to write.

### 2. Distribute spacing (horizontal / vertical)
- What: needs 2+ (Figma: evenly spaces, outermost layers fixed) [1][6]; found under Position "More actions" [6]. Penpot: Ctrl+Shift+Alt+H / V [9].
- Reliance: high.
- Status: **Missing**.
- Mapping: absolute elements: write `left`/`top` for the interior items. Flow children of a flex parent: the real CSS equivalent is `gap` on the parent (equal) or `justify-content: space-between`, both already in the Layout section (`layout.section.tsx:178,201`); so distribute on flow children should be a shortcut that sets those, not coordinates.
- Effort: M (same plumbing as align; share it).
- Risk: with unequal sizes, "equal gap" is the correct semantic (not equal centres); say so in the tooltip.

### 3. Tidy up
- What: on a 1D selection acts like distribute, on 2D arranges into a grid aligned to the selection's top-left [1]; also the route to making a Smart selection [4][6]. (The search snippet claimed limits like 99 layers; not verified from a fetched page, ignored.)
- Reliance: medium; mostly design-board housekeeping, which an HTML canvas rarely needs.
- Status: **Missing**.
- Mapping: absolute siblings only: sort by position, write `left`/`top`. Flow children: would be `display:flex; gap` (1D) or `display:grid` (2D), i.e. a structure change, not a coordinate pass.
- Effort: L for the grid case; S once distribute exists for 1D.
- Risk: low payoff for CSS-authored pages. Skip the 2D grid.

### 4. Smart selection: pink spacing handles, mark/rearrange/resize with equal gaps
- What: for evenly spaced 1D/2D selections, pink handles between layers drag the gap, tooltip shows px; click a pink ring to mark layers and drag to rearrange (blue indicator), Cmd/Ctrl swaps, resize marked layers while keeping spacing, Alt resizes from centre, deleting closes the gap [4][5].
- Reliance: medium; liked but discoverability is low.
- Status: **Missing** (parity "Gap handles on canvas — Not built"; plan Next).
- Mapping: for a flex parent it is exactly `gap` (or `column-gap`/`row-gap`) on the parent and `order`/DOM reorder for rearranging. Drag handle in the gap of a flex container writes `gap`; this is already the model of the padding handles (`padding.tool.ts:52`). For absolute siblings write `left/top` of the later items.
- Effort: M for flex gap handle (reuse padding tool); L for rearrange/resize variants.
- Risk: only the flex-gap handle maps cleanly; skip the "marked resize" variant.

### 5. Rotation on canvas (handle outside corners, Shift = 15° steps, rotation origin)
- What: rotate by dragging outside a corner; Shift snaps to 15° increments; origin changeable with Alt/Option+R then drag [1].
- Reliance: medium-high for illustration/decor, low for UI layouts.
- Status: **Partial**. Panel field only (`position.section.tsx:93`, writes the CSS `rotate` property, default unit `deg`, `css-values.ts:19`); no canvas handle (parity row "Rotation").
- Mapping: write `rotate: <n>deg` (individual property, not `transform`, so it does not collide with the `translate` that the move tool uses). Origin: `transform-origin: x% y%`; MDN [14] confirms default `50% 50%`, percentages refer to the element's own box, and rotation about another origin is a pure CSS equivalence. Rotating changes the bbox: resize/snap/rects must use the transformed bounds.
- Effort: M (handle hit zones + 15° snap + angle label); origin change +S.
- Risk: an element that already authors `transform: rotate()` should be edited in place; `rotate` property wins/combines in a defined order, so warn when both exist.

### 6. Flip horizontal / vertical
- What: Shift+H / Shift+V [1]. Penpot lists different keys (Ctrl+H/V), with a possible doc error [9].
- Reliance: low-medium.
- Status: **Missing** (no flip code in `src/`).
- Mapping: `scale: -1 1` / `scale: 1 -1` (individual `scale` property, toggled; composes with `rotate`) or toggle `scaleX(-1)` in `transform`. Mirrors text too, as in Figma. Good for icons/images only.
- Effort: S. Risk: text becomes mirrored; mapping to `scale` is a CSS-only idea (Figma keeps size positive).

### 7. Resize modifiers: Shift (keep aspect), Alt (from centre), aspect-ratio lock, bypass constraints
- What: with ratio unlocked Shift locks it temporarily; with it locked Ctrl disables it [1]. Alt/Option resizes from the centre (confirmed in smart-selection resizing [4]; Penpot Shift = ratio, Alt = from centre was seen only in search snippets, not fetched, so not relied on). Cmd/Ctrl while resizing bypasses constraints [2]. Lock-ratio toggle shortcut in Penpot is Shift+L [9].
- Reliance: very high. Corner-drag resize with Shift is muscle memory.
- Status: **Partial**. Handles exist (`resize.tool.ts:8-140`); parity says no Shift/Alt, always writes whole `px` (`resize.tool.ts:136`), no snapping.
- Mapping: Shift: write both `width` and `height` scaled equally, or (better for images) write one dimension plus `aspect-ratio: w / h` and leave the other `auto`. Alt: write size AND shift `left`/`top` (positioned) or `margin` (static) by half the delta; for flow elements disable. Keep authored unit (`rem`/`%` via the existing unit helpers in `css-values.ts`).
- Effort: M (Shift S, Alt M, keep-unit S, combined as parity gap #6).
- Risk: Alt-from-centre has no clean CSS for flex children, so apply only to absolute/relative-positioned ones.

### 8. Scale tool (K)
- What: proportional scale of selection by dragging the box, a multiplier, or typing one dimension; anchor point chooses the fixed point; scales strokes and blurs; ignores nested constraints; not for locked layers [3].
- Reliance: low-medium.
- Status: **Missing**.
- Mapping: the faithful web equivalent is `transform: scale()` / `scale:` with `transform-origin`, but that does not reflow layout and is not what a designer expects. The Figma behaviour (rewrite every size, font-size, border, padding of the subtree) is a recursive multi-property rewrite.
- Effort: L. Risk: high, many properties/units/`calc()`; see Not worth it.

### 9. Constraints (left/right/left+right/centre/scale; same vertical)
- What: per-axis, default Top+Left; Scale keeps size and position proportional (70px of 100px stays 70%); Shift-click combines edges; Cmd/Ctrl bypasses while resizing; not available inside auto layout or for top-level frames; groups push them to children [2]. Penpot defaults to Scale [search snippet only, not relied on].
- Reliance: medium; mostly a responsive-frame tool. Auto layout replaced most uses [2].
- Status: **Missing** (parity "constraints widget — Not built", plan Next).
- Mapping (exact, from CSS positioned layout [12]) for an `position:absolute` child of a positioned parent:
  - Left: `left:Npx` (default). Right: `right:Npx` (drop `left`). Left+right: `left` and `right`, `width:auto` (element stretches; if `width` is also set the CSS over-constrains and `right` is ignored in LTR [12], so the op must remove `width`). Centre: `left:50%; transform: translateX(-50%)` or `left:calc(50% + Δ)`. Scale: all offsets and sizes in `%` (percentages resolve against containing block width for left/right, height for top/bottom [12]).
  - Vertical is the mirror with `top`/`bottom`/`height`/`translateY`.
  - Framer's "Absolute" layer pinned to top/right/bottom/left edges is the same model, which validates the mapping [11].
- Effort: M (widget + converting offsets between edges; needs parent rect). Panel writes only; canvas bypass key is just not required.
- Risk: centre uses a `translate`, which collides with the move tool's translate term (`move.tool.ts:95`); prefer `left:calc(50% + Δ)` plus `translate: -50% 0` only when the element has no translate already. Only offer for `position:absolute` children.

### 10. Bring forward / send backward / front / back (z-order)
- What: Ctrl/Cmd+] bring forward, Ctrl/Cmd+[ send backward, Shift variants front/back per the forum [8] (forum source: shortcuts disagree across lists; not official). Penpot: Ctrl+Up/Down and Shift for front/back [9], and notes that stacking follows layer order bottom-to-top [10].
- Reliance: high for overlapping designs.
- Status: **Partial**. Layers panel drag reorder exists (`LayersPanel.tsx:102`, `moveNode` op); no shortcut or "bring forward" action. `z-index` is editable as a plain number (`css-values.ts:4`) but not driven by the arrange action.
- Mapping: preferred, DOM order, as in Figma: `moveNode` one sibling later = in front, because later siblings paint above earlier ones at the same stack level [13]. Only use `z-index` when the element is positioned (z-index applies to positioned or flex/grid items [13]) and the author already uses `z-index` on siblings; then write `z-index: max+1`. Not valid for flow order in flex/grid (reordering changes layout). So: if parent is flex/grid, DOM move is a layout change, so use `z-index` (works on flex/grid items [13]); if parent is block/absolute use DOM order.
- Effort: S (actions on top of `moveNode`/`setDecl`); registry already exists.
- Risk: stacking contexts (`z-index:integer` makes a local context [13]) may make a bump not visible; verify by re-reading the rendered order or warn.

### 11. Snapping while resizing; equal-spacing smart guides
- What: Penpot shows distances between neighbours and snaps to equal gaps when dragging near 2+ layers [10]; layers also snap to the pixel grid by default [10], Figma's equivalent is the pixel-grid toggle (Cmd/Ctrl+Shift+') where frames and components always snap [7]. Figma's own resize/equal-gap snapping page could not be fetched (404), so not described here.
- Reliance: high, snapping on resize is expected; equal-gap guides medium.
- Status: **Partial**. Move snaps to sibling/parent edges and centres (`snap.ts:33,64`); resize does NOT snap (parity row). Equal-gap snapping Not built.
- Mapping: no CSS change, only edges of the written width/height/left/top are adjusted to the snap target. Reuse `snap.ts` candidate set; snap only moving edges for the active handle. Equal-gap: compute neighbour gaps in the same read and show pink distance marks; the resulting write is still a normal offset.
- Effort: resize snap S-M (reuse); equal-gap guides M.
- Risk: none for the write path; just needs rects of siblings, already read once per drag.

### 12. Multi-selection move/nudge/resize (prerequisite of align/distribute)
- Not in the assignment list but gates items 1, 2, 7. Status: **Missing** (`move.tool.ts:178` returns null for 2+). Mapping: one op batch writing each target; selection bbox scaling for resize is L.

## Recommended for v2 (ranked, max 8)
1. Resize modifiers + keep authored unit: Shift (aspect), Alt (from centre), unit-preserving `width/height`, `aspect-ratio` for images, so resizing stops rewriting `rem`/`%` to px — M
2. Resize snapping using the existing `snap.ts` candidates (moving edges only) — S-M
3. Multi-selection move/nudge, one undo entry — M (unlocks 4)
4. Align (6 buttons + Alt+A/H/D/W/V/S) and Distribute for absolute siblings; for flex children set parent `align-items`/`justify-content`/`gap` instead — M
5. Z-order actions (Mod-]/[ and Shift variants): DOM order for block/absolute parents, `z-index` for flex/grid items — S
6. Canvas rotation handle with Shift = 15° writing `rotate:` and optional `transform-origin` — M
7. Constraints widget for `position:absolute` children (left/right/both/centre/scale → `left/right/width/%`) — M
8. Gap handles on canvas for a flex parent writing `gap`, plus equal-gap distance marks while moving — M

Flip (`scale: -1 1`, size S) is the cheapest add-on if there is room, but it ranks below these.

## Not worth it
- Scale tool (K): faithful version means recursively rewriting sizes, font-size, borders and padding of a subtree across units and `calc()`; the cheap version (`transform: scale`) does not reflow and surprises users [3].
- Tidy up 2D grid: converting free elements into a grid is a layout/structure change, and the 1D case is covered by distribute [1][6].
- Smart selection rearrange/marked-resize/swap: only the flex-gap handle maps cleanly to CSS; the rest duplicates drag-reorder in flex [4][5].
- Rotation origin change (Alt+R): needs `transform-origin` UI for a rare case; do it only if rotation handle ships and demand appears [1][14].
- Pixel-grid snap toggle: parity already lists it as M7 #7; subpixel CSS is not a real problem on a web canvas [7].
- Bypass-constraints modifier (Cmd/Ctrl-resize): there is no live constraint engine in CSS to bypass; the write is just offsets [2].
- Alt-from-centre for flex/grid children: no CSS expresses it without turning the element absolute; disable instead.
