# Advanced auto layout and grid

Scope: wrap, min/max, ignore-auto-layout, Auto spacing, negative gap, baseline, strokes, canvas stacking, Grid flow, Shift-A family. Already built per `plans/v1/parity.md:58-72`: add auto layout, direction, gap/padding, 9-dot, space-between, hug/fill/fixed, min/max, padding drag, ignore auto layout. v1 research 02 (`plans/v1/research/02-layout-to-css.md` §1, §5) already described wrap/grid at SHOULD level, but parity.md:71-72 lists them Not built / Out of scope. v2 below is about promoting them with concrete specs.

## Sources (fetched)
1. Use the horizontal and vertical flows in auto layout (Figma Help) — https://help.figma.com/hc/en-us/articles/31289464393751 — 2026-11-23
2. Guide to auto layout (Figma Help; wrap, min/max, ignore auto layout, shortcuts) — https://help.figma.com/hc/en-us/articles/360040451373 — 2026-11-23
3. Use the grid auto layout flow (Figma Help) — https://help.figma.com/hc/articles/31289469907863 — 2026-11-23
4. Combine auto layout flows (Figma Help) — https://help.figma.com/hc/en-us/articles/31441443713047 — 2026-11-23
5. Strokes in auto layout (Figma Help, new stroke behaviour) — https://help.figma.com/hc/articles/42031586813719 — 2026-11-23
6. Plugin API `strokesIncludedInLayout` — https://developers.figma.com/docs/plugins/api/properties/nodes-strokesincludedinlayout — 2026-11-23
7. Penpot Flexible Layouts — https://help.penpot.app/user-guide/flexible-layouts/ — 2026-11-23
8. Framer Academy, stacks vs grids (thin; no wrap/distribution detail) — https://www.framer.com/academy/lessons/framer-fundamentals-stacks-vs-grids — 2026-11-23
9. Figma forum, "Launched: wrap elements in auto layout" — https://forum.figma.com/suggest-a-feature-11/launched-wrap-elements-in-auto-layout-to-multiple-lines-20107/index10.html — 2026-11-23
10. Figma forum, "Grid for auto layout is horribly limited" — https://forum.figma.com/share-your-feedback-26/grid-for-auto-layout-is-horribly-limited-in-scope-and-very-awkward-to-use-40316 — 2026-11-23

Not fetched, so not relied on: Webflow docs (search returned none), Framer wrap/distribution reference pages (search snippets only), Figma forum threads on wrap+fill quirks (snippets only).

## Figma features in this area

### 1. Wrap (horizontal and vertical)
- Does: children move to a new row/column when they no longer fit; not masonry, auto-layout order is kept [1][2]. With wrap on there are two gap values: within a line and between lines [1].
- Reliance: very high; forum shows wrap was a long-standing top request and "the bottleneck" for card lists/tag rows [9].
- Status: **Missing** (parity.md:71 "flex-wrap ... Not scheduled"; no `flex-wrap` anywhere in `src/` outside theme CSS; Gap field is single, `layout.section.tsx:178`).
- CSS: toggle writes `flex-wrap: wrap` / removes it (`nowrap`). Gap splits into `row-gap` + `column-gap` (shorthand `gap: R C`); in a column container main-axis gap is `row-gap`. Vertical wrap = `flex-direction:column; flex-wrap:wrap` (needs a bounded height to wrap). Line distribution = `align-content` (flex-start / space-between / etc.) which only has effect when wrapped.
- Effort: M (panel toggle, two-value gap, 9-dot/align-content semantics, Fill children caveat: `flex:1` items fill the line rather than forcing a wrap, so show a hint to set a min-width/flex-basis).
- Risk: 9-dot currently maps justify/align-items only; wrap adds `align-content`, which the 9-dot cross-axis cell should write when wrapped (Figma's cross axis then distributes lines). Must keep existing `align-items` writes byte-stable for non-wrap.

### 2. Min / max width and height
- Does: added from the Width/Height dropdown, combinable with Hug/Fill/Fixed; "Remove min and max" clears them [2].
- Reliance: high (responsive cards, readable text columns).
- Status: **Built** (`layout.section.tsx:267`, `:354`; parity.md:68). Not rerun. One gap: no dropdown affordance on the Size row hint "has min/max" (Figma shows two-line icon) — S, optional.
- CSS: `min-width`/`max-width`/`min-height`/`max-height`.

### 3. Ignore auto layout (absolute inside auto layout)
- Does: child leaves the flow but stays in the frame; constraints apply to it; Ctrl-drag (Mac) / S (Win) into a frame sets it on drop [2].
- Status: **Built** (`layout.section.tsx:312`, `:362`). Missing only the Ctrl-drag gesture and parent auto-`position:relative` is already handled with a warning (parity.md:70). Gesture: S, low value.
- CSS: `position:absolute` + `top/left` (+ parent `position:relative`), already implemented.

### 4. Auto spacing: Between / Evenly / Around
- Does: gap field accepts "Auto" with three modes: Between (default, no edge space), Evenly (1:1 gaps and edges), Around (gaps 2x edge space); applies to horizontal and vertical flows [1][2]. If content is too big the gap floors at 0 [1].
- Reliance: medium (nav bars, toolbars; Between is the common one).
- Status: **Partial** (Between only, `layout.section.tsx:201-204`; no Evenly/Around).
- CSS: `justify-content: space-between | space-evenly | space-around`. Penpot exposes the same set [7]. Note CSS `space-around` is 1:2 edge:gap, same as Figma's Around.
- Effort: S (replace the single toggle by a small menu: Between/Evenly/Around; keep gap field showing "Auto", disabled while any space-* is set; clicking the 9-dot main axis cell resets to start/center/end).
- Risk: low. Existing toggle at `:201` must keep its test `al:461`.

### 5. Negative gap and canvas stacking order
- Does: negative spacing allowed; with overlap, last layer on top by default, switchable to First-on-top; "solely a visual change", layer panel order is unchanged [1]. Gap stops at 0 for Auto when too large [1].
- Reliance: low-medium (overlapped avatars, stacked cards).
- Status: **Missing** (v1 02 §1 line 53 deferred it).
- CSS: negative gap in flex is not valid (`gap` cannot be negative). Equivalent: `margin-left:-Npx` (or `margin-top`) on every child except the first, i.e. an op on every child, not on the container. "Last on top" is the CSS default paint order (DOM order); "First on top" needs `z-index` descending or `flex-direction: row-reverse` trick; a clean write is `.container > * {position:relative}` plus `z-index` per child — touches N children.
- Effort: L (many-child writes, selectors, cleanup when gap reset). Risk: fragile; mutating each child's margin conflicts with user margins. Verdict: not worth it for v2 (see Not worth it).

### 6. Text baseline alignment
- Does: toggle in the alignment box (key B) aligns text children on their baseline [2][1].
- Reliance: medium (label + value rows, buttons with icon + text, mixed font sizes).
- Status: **Missing** (`auto-layout.ts:74` only notes baseline as a "no cell" state; no write path).
- CSS: container `align-items: baseline` (or `first baseline`/`last baseline`); in column containers it has no useful meaning (ignored on cross axis for blocks unless wrap). Per-child `align-self: baseline`.
- Effort: S (a toggle next to the 9-dot; reading `align-items:baseline` already exists as a non-cell state). Risk: low; only offer for row direction.

### 7. Include strokes in layout (box model)
- Does: a stroke setting on the frame; inside strokes count toward layout (like CSS border-box); outside/center strokes never count and are painted like `outline`; new frames default to this from July 2026 [5][6]. Strokes included "behaves like border-box" [6].
- Reliance: medium; matters to numeric correctness of padding/size.
- Status: **Partial**: only a content-box warning for max-width (`layout.section.tsx:269-270`); the editor's theme sets border-box only for its own chrome (`theme.css:67`). parity has no row for stroke-in-layout.
- CSS: inside stroke = `border` with `box-sizing:border-box`; outside/center = `outline` (+ `outline-offset`) which does not affect layout. Mapping is natural; the real task is when the stroke section writes `border` vs `outline` vs `box-shadow` (that choice lives in the Stroke section, `style.section.tsx:146`, not here). Offer a stroke position select: Inside=border, Outside=outline, Center=outline with negative offset (half width) — confirm that is wanted by that section's owner.
- Effort: M. Risk: switching border→outline changes layout of siblings; warn.

### 8. Grid auto layout (third flow)
- Does: frame set to Grid with column/row counts via picker; rows default `auto` and grow as needed; tracks sized Fixed / Fill (fr) / Hug / min-max; typing `Auto` = 1fr; gap row/column, padding with CSS shorthand; child span via Column span / Row span fields (requires child Fill) or dragging to a cell edge; automatic positioning on by default (off = explicit cells); align child in its cell via the Position buttons; reorder tracks by grabber, add/delete tracks [3].
- Limits cited by users: no Hug for tracks (at time of thread), fixed-only rows, no reflow when columns change, no responsive auto-fill/columns, gap variables, cannot insert row beside selection [10]. Min/max unavailable on grid-flow containers was reported in search snippet only (not fetched, not used).
- Reliance: rising; Figma pitches it for bento/dashboards/editorial layouts [3]. Web-design equivalent: card grids, galleries, bento. Penpot ships grid with fr/auto/px tracks, Auto/Manual/Area placement, spans by merging cells, named areas [7].
- Status: **Missing**; parity.md:72 "CSS grid editing — Out of scope (Non-goals)". `grid-template` appears in `src/` only inside the editor's own CSS (`PropertiesPanel.tsx:281-285`, `layout.section.tsx:382-388`), never as a user-facing editor. Existing grid parents get reorder-by-drag only (`move.tool.ts:121`, `:356`).
- CSS: container `display:grid; grid-template-columns: repeat(N, 1fr) | 240px | auto | minmax(a,b); grid-template-rows (or leave `grid-auto-rows:auto`); gap/row-gap/column-gap; padding`. Child: `grid-column: span N`, `grid-row: span N` (auto placement), or `grid-column: a / b` for explicit; cell alignment `justify-self/align-self`. Penpot maps manual cells and areas to `grid-column`/`grid-row` [7]. Hand-authored `repeat(auto-fill, minmax(...))` should be read-only/chip-displayed, not rewritten.
- Effort: L for full parity; M for a "Grid-lite" (switch `display:grid`, simple `repeat(N,1fr)`/px list editing, gap pair, child span fields). Risk: authored templates with `grid-template-areas`, `auto-fill`, `subgrid` must round-trip byte-exactly: only write when the value parses as a simple track list, otherwise show read-only.

### 9. Shift-A add / remove / suggest auto layout
- Does: Shift-A adds auto layout to the selection; Option/Alt-Shift-A removes it; Ctrl-Shift-A (Mac) suggests auto layout [2]. Double-click a frame edge sets Hug; Alt-double-click sets Fill [2]. A parent stops hugging on an axis if a child is Fill [2].
- Reliance: very high for Shift-A (daily); remove is common; suggest is occasional.
- Status: **Missing** for the shortcut and for remove (parity.md:62, :159, :193 item 5; "No remove auto layout control"). Add via panel is built.
- CSS: Add = `display:flex` + `flex-direction` (row if children laid out horizontally else column, inferred from measured child rects; `gap` from the median distance; `padding` from measured insets) — matches Figma "suggest". Multi-select + Shift-A = Wrap in container (already built, `structural-ops.ts:263`) then add flex to the wrapper. Remove = delete `display:flex`, `flex-direction`, `gap`, `justify-content`, `align-items`, `flex-wrap` from the rule, restore `display:block` only if it was authored; children keep `flex:*`/`align-self` — those become dead, so also offer to clear them. Suggest = same inference, but no user choice: heuristic on child bounding boxes (rows if y-overlap, else column).
- Effort: S for shortcut + remove; M for suggest inference. Risk: removing flex changes visual layout (children that relied on Fill now collapse); should preview or warn; a `display:flex` set by a shared class rule affects other elements: reuse the existing "locked/shared rule" warning in `useDeclaration` (`layout.section.tsx:145-146`).

## Recommended for v2
1. Shift-A add auto layout + Alt-Shift-A remove (with infer-direction and gap/padding from measured boxes) — daily Figma habit, parity gap #5 — S
2. Flex wrap toggle with row-gap/column-gap split and align-content — closes the biggest layout hole, card lists/tag rows — M
3. Auto spacing menu Between/Evenly/Around — completes the Gap "Auto" concept, three `justify-content` values — S
4. Baseline alignment toggle (`align-items: baseline`) for row containers — real typographic alignment, tiny — S
5. Grid-lite: `display:grid` editing for simple track lists, gap pair, child column/row span fields — reverses a v1 non-goal because grid is now Figma's third flow and pervasive on the web — M
6. Stroke position + layout inclusion (Inside=border, Outside/Center=outline) with sibling-layout warning — numeric correctness, partly done by content-box warning — M
7. Suggest auto layout (infer from child geometry) — fast restructuring for imported/pasted designs — M
8. Min/max indicator on the Size row (two-line icon, "remove min and max" action) — small polish over built feature — S

## Not worth it
- Negative gap with canvas stacking order: CSS `gap` cannot be negative; needs per-child negative margins plus z-index writes on N children, fragile and conflicts with authored margins [1].
- Ctrl/S-drag to set ignore-auto-layout on drop: gesture sugar [2]; panel toggle already built.
- Grid track drag-reorder, bulk row/column delete, swap pink circles: Figma-specific cell-index model [3]; CSS grid auto-placement has no matching state.
- Grid `Hug` track via drag or full track overlay with pill handles: L effort, and Figma's own users report it as incomplete [10]; revisit after Grid-lite ships.
- Named grid areas / `grid-template-areas` editing: Penpot supports areas [7], but Figma does not, so low user pull; show read-only.
- Framer-specific wrap/distribution parity: Framer's fetched lesson had no wrap/distribution details [8]; nothing to borrow beyond what Figma/Penpot already show.
- Webflow comparison: no Webflow page fetched this run, so no claims made.
