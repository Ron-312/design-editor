# 02 - Figma layout system mapped to CSS (for the local HTML/CSS visual editor)

Scope: Auto Layout, resizing (Hug/Fill/Fixed, min/max), constraints, Grid auto layout, layout guides, Dev Mode CSS output, on-canvas affordances. Claims are from pages fetched this session (Sources at end). Lines marked **[inference]** are my engineering conclusions, not stated by a source.

Key framing: Figma's model is a *property-per-frame* model that is deliberately close to CSS. The editor does not need a conversion layer; it needs a **read/write adapter** per Figma concept that reads computed style of the element, shows the Figma-style control, and writes the minimal CSS declaration back to the source rule.

---

## 0. Cross-cutting rules for the editor

1. **Mode detection by computed style.** Classify the selected element's parent and the element itself: parent `display:flex|inline-flex` -> "auto layout child"; `display:grid` -> "grid child"; else "flow/absolute child". The element's own `display` decides whether the Auto Layout panel (direction/gap/padding/alignment) is shown. Figma itself exposes constraints only for children that are NOT in auto layout (or that "ignore auto layout") [S1, S2]; same gating applies in CSS: `left/right/top/bottom` only matter when `position` is not `static`.
2. **Write to source, not computed.** Resolve which rule/inline style owns each property and edit there; never inline the full computed value set (inherited-style pitfall).
3. **Emit minimal CSS.** Figma Dev Mode community mapping omits Hug entirely (nothing emitted) and omits `align-self` when `auto` [S9]. Mirror that: removing a declaration is the way to "hug".
4. **box-sizing.** Figma includes inside strokes in layout by default, which "doesn't match how CSS renders borders" [S3]. Treat padding/size numbers as border-box; if the project uses content-box, show a warning or normalise via `box-sizing:border-box`.
5. **Units.** Figma is px-only. Existing HTML may use rem/%/fr/clamp. Editor must show the authored value (`1.5rem`) and preserve unit on edit; only offer px conversion explicitly.

---

## 1. Auto Layout container: direction, gap, padding, alignment, wrap

**What Figma does.** Flows: Horizontal, Vertical, Grid, plus Wrap for H/V; children placed along axis [S1, S3]. Gap = space between children (fixed or Auto); padding settable uniform / per-axis / per-side; padding accepts CSS-shorthand-order input (`1,2,3,4` = top,right,bottom,left) [S3]. Alignment is set on the *parent* via the alignment box [S3].

**CSS.**

| Figma | CSS |
|---|---|
| Horizontal / Vertical | `display:flex; flex-direction:row` / `column` [S7: layoutMode table] |
| Grid | `display:grid` (see section 5) |
| Gap (fixed) | `gap` (itemSpacing) [S7] |
| Wrap gaps (two values) | `row-gap` / `column-gap`; main-axis gap = `column-gap` for row, `row-gap` for column [S3, S7] |
| Padding | `padding` (shorthand when all sides equal) [S7] |
| Wrap | `flex-wrap:wrap` [S7]; vertical wrap is `flex-direction:column; flex-wrap:wrap` [S3]. Figma wrap keeps order, not masonry [S3]. |
| Auto gap "Between/Around/Evenly" | `justify-content: space-between / space-around / space-evenly` [S3] |
| Primary-axis align min/center/max | `justify-content: flex-start/center/flex-end` [S7] |
| Counter-axis align min/center/max/baseline | `align-items: flex-start/center/flex-end/baseline` [S7] |
| Wrap row distribution | `align-content: flex-start` / `space-between` (only with wrap) [S7] |
| Alignment box with Auto gap | options narrow to one axis (left/center/right for vertical) [S3] = primary axis is owned by `space-*`; only `align-items` remains |

**Editor UI on an existing element.**
- If `display:flex`: show Direction toggle (row/column [+ reverse as "LATER"]), Wrap toggle, Gap field (split into row/column when wrap), Padding (per-side, linked toggle), 9-dot alignment box mapped to (justify-content x align-items) with axis swapped when direction=column; X-key/toggle switches the primary axis to `space-between` (then `around`/`evenly` in a menu).
- If `display:block`: offer "Add auto layout" (Shift+A in Figma [S1]) -> writes `display:flex; flex-direction:column` (blocks stack vertically; this preserves the visual stacking). **[inference]** Warn: block children become flex items, so margin collapse disappears and inline children (text runs, `<span>`) become separate items; text nodes get wrapped in anonymous flex items.
- If `display:grid`: show grid panel (section 5), not the flex panel.
- "Remove auto layout" (Option+Shift+A [S1]) -> set `display:block`, but leave other flex props in place or remove them; prefer removing to avoid dead CSS.

**Priority:** MUST (direction, gap, padding, 9-dot alignment, space-between). SHOULD (wrap + dual gaps, evenly/around, baseline). LATER (`flex-direction: *-reverse`, `place-content`, `order`).

**Pitfalls.**
- 9-dot box semantic flip: for `column`, horizontal dots map to `align-items`, vertical dots to `justify-content`. Must read `flex-direction` first.
- Existing `align-items:stretch` (CSS default!) has no cell in the 9-dot picker. Figma gets stretch from child Fill, not container [S7 "STRETCH is absent from counter-axis mapping"]. Editor: show alignment box as "none/stretch" state when `align-items` is `normal|stretch`; do not silently overwrite.
- Hug makes some alignment choices look identical because no free space exists [S3] - the UI should not report "nothing happened" as a bug.
- Gap fallback: authored layouts often use `margin` between children rather than `gap`; the editor can't claim a "gap" it can't see. **[inference]** Show gap as mixed/derived read-only with a "convert margins to gap" action (LATER).
- `gap` can be set by CSS variables/`calc()`; keep the token when present.
- Negative gap (Figma allows overlap with "canvas stacking" first/last-on-top, canvas-only [S3]) = negative margins in CSS; LATER, skip.
- Padding on an element with `box-sizing:content-box` changes its outer size; Figma: "frame can't shrink below padding" [S3].

---

## 2. Resizing modes: Hug / Fill / Fixed, min/max

**What Figma does.**
- Hug contents: auto layout frames only; frame = children + padding [S1].
- Fill container: children only; stretches into parent's available space [S1].
- Fixed: constant size; typing a value or manual resize sets it [S1].
- If any child is Fill on an axis, the parent can no longer Hug on that axis and becomes Fixed [S1].
- Min/max width/height combinable with the above, via the Width/Height dropdown; can use variables [S1].

**CSS (primary axis = parent's flex direction, counter axis = other).** Consolidated from the code-agent mapping [S7] and Figma community/other mappings [S8, S9]; sources disagree on details, which I flag.

| Mode | Primary axis | Counter axis |
|---|---|---|
| Fill | `flex:1 1 0` (S7: `flex-grow:1; flex-basis:0`; S8/another: `flex:1 1 0%`) | `align-self:stretch` (S7, S8, S9), remove explicit cross size. If a max exists on the cross axis, S7 uses `width/height:100%` + max instead. |
| Fixed | explicit `width/height` + `flex-shrink:0` [S7] | explicit size [S7] |
| Hug | emit nothing (omit width/height; `flex:0 1 auto` default) [S7] | nothing |
| min/max | `min-width/max-width/min-height/max-height`, emitted only when >0 / finite [S7] | same |

Note: the exact string `flex:1 0 0` is NOT confirmed by anything fetched; S7 says flex-basis:0 is required "or siblings split space by content size". **[inference]** Use `flex:1 1 0` (shrink 1) plus `min-width:0` to let long content shrink; Figma's behaviour of never overflowing is closest to that. Also `width:fit-content` for Hug is not stated by any source; **[inference]** it is useful only for block-level/absolute elements (see pitfalls); in flex items "omit size" is the Figma-faithful output.

**Editor UI.** Width and Height each get a 3-way segmented control (Fixed / Hug / Fill) + min/max sub-fields. Reading current state from the element:
- Parent flex, size axis = main: `flex-grow>0` -> Fill; explicit `width`/`height` px/rem/% -> Fixed; `auto` and grow 0 -> Hug.
- Parent flex, cross axis: `align-self`/parent `align-items` = stretch and size `auto` -> Fill; explicit -> Fixed; auto + non-stretch -> Hug.
- Parent not flex (block): Fill = `width:100%` (or `auto` for block width, which already fills), Hug = `width:fit-content`, Fixed = explicit. **[inference]**
- Parent grid: Fill = `width:auto` + default `justify-self:stretch`, or track `fr`; see section 5.
- Disabled combos mirrored from Figma: Fill disabled on root/top-level frames; Hug disabled on non-containers (text is allowed Hug) [S1]. And when setting Fill on a child of a Hug parent, auto-switch the parent axis to Fixed with a visible toast, as Figma does [S1].
- Double-click edge to hug/fill shortcuts [S1] are SHOULD.

**Priority:** MUST (Fixed/Hug/Fill both axes, min/max). SHOULD (auto-parent-switch rule, edge double-click, typed `%`).

**Pitfalls.**
- Percentages: `width:50%` is neither Fixed nor Fill. Classify as "Fixed (%)" and preserve the unit; don't rewrite to px.
- `flex-basis` vs `width`: in a row, a pre-existing `flex-basis:200px` overrides `width`. Read both; editor writes to whichever is authored.
- Flex items have `min-width:auto`, so a Fill child with long text will not shrink below content; add `min-width:0` (editor should do this automatically when setting Fill, and mention it).
- Replaced elements (img) and `aspect-ratio` complicate Hug/Fill; keep aspect-ratio lock as a separate toggle (LATER).
- Text: Figma disallows max height and max lines together [S1]; CSS line-clamp is separate - LATER.
- Figma Hug on a container is only valid for auto layout frames; a plain `div` with absolutely positioned children has zero size in CSS - show a warning when Hug yields 0.
- Because Figma's "Auto" size == Hug [S7], do not label CSS `auto` as "Fill" in UI.

---

## 3. Absolute-positioned children inside auto layout ("Ignore auto layout")

**What Figma does.** Child is removed from flow but stays in the frame; doesn't affect siblings; behaves like a regular frame child so constraints apply; resizing/layout options unavailable. Enabled from the right panel, or drag in while holding Ctrl (Mac) / S (Win) [S1].

**CSS.** Child `position:absolute` with offsets from its constraints; parent must become `position:relative` since auto layout does not make it a positioning context in CSS [S7].

**Editor UI.** A toggle "Ignore auto layout / Absolute" on a flex/grid child: writes `position:absolute` plus `top/left` (or right/bottom per constraint, section 4) computed from the current box relative to the offset parent; ensure the parent (or nearest positioned ancestor) is positioned: if the direct parent is `static` add `position:relative` to the parent's rule and tell the user. Toggle off: remove `position`, `top/left/right/bottom`, `transform`, `inset`, and re-enter the flow at the original DOM index (DOM order is the flow order, nothing to restore).

**Priority:** MUST (needed for overlay badges, floating buttons, and for free-position frames).

**Pitfalls.**
- Setting `position:relative` on the parent can alter existing absolute descendants' reference box (they attach to nearest positioned ancestor). **[inference]** Detect and warn.
- `position:absolute` on a flex child makes it ignore `align-self`, and its static position changes; offsets must be measured, not copied.
- `position:fixed/sticky` are other cases: show read-only chip.
- z-index/stacking contexts: Figma layer order = DOM order; absolute children paint above siblings unless `z-index`. Expose z-order via DOM reorder, not raw z-index (LATER).

---

## 4. Constraints (non-auto-layout parents)

**What Figma does.** Per-axis: Left / Right / Left&Right / Center / Scale (horizontal) and Top / Bottom / Top&Bottom / Center / Scale (vertical). Default Top+Left. Constraints apply only to layers inside a frame, NOT to children in auto layout (unless they ignore it); nested frames can have them; groups don't (applied to children) [S2]. Scale: 70px in a 100px frame becomes 140px at 200px frame [S2]. Hold Cmd/Ctrl while resizing to bypass constraints [S2]. Pinned edges show as blue dotted lines [S2].

**CSS** [S7 table, **[inference]** for exact scale/center forms where S7 gives only "percentage-based"]:

| Constraint | CSS (child `position:absolute` in `position:relative` parent) |
|---|---|
| Left | `left:Xpx` |
| Right | `right:Xpx` |
| Left & Right | `left:Xpx; right:Ypx` (width:auto) |
| Center (H) | `left:50%; transform:translateX(-50%)` (S7). Alternative without transform: `left:calc(50% + offset)` + `margin-left:-w/2`. |
| Scale (H) | `left:X%; width:W%` percentages of parent |
| Top / Bottom / Top&Bottom / Center / Scale | same on the vertical axis (`top`, `bottom`, `top+bottom`, `top:50%;translateY(-50%)`, `top:%;height:%`) |

**Editor UI.** The familiar 3x3 constraint widget (blue lines to edges; click lines to pin; shift for both) shown on any absolutely positioned child of a non-flex/non-grid parent. Selection writes the `left/right/top/bottom/width/height/transform` combination and converts the unit to px (pinned) or % (scale) from the *measured* box.

**Priority:** SHOULD for v1 (Left/Right/Top/Bottom/Left&Right/Top&Bottom are cheap). Center and Scale LATER (transform and % complications).

**Pitfalls.**
- `transform:translate(-50%)` creates a stacking context and containing block for fixed descendants, blurs text at fractional px, and conflicts with other existing transforms (rotation from a rotate handle). Compose onto the existing `transform` rather than overwrite, or use `inset:0; margin:auto` with explicit width for true centering. **[inference]**
- `right:` with a parent whose width is also changing in the editor is relative to the padding box, not the content box (padding of parent is ignored by absolute offsets). Figma constraints measure to frame edge as well, so this actually matches.
- Percent `top/height` need parent with definite height.
- Existing responsive sites do not use constraints; many elements are in normal flow. Do not offer constraints on flow children (Figma doesn't either [S2]); offer "Ignore auto layout" first.
- Group semantics: HTML has no groups; applying to a wrapper `div` is the right equivalent.

---

## 5. Grid auto layout

**What Figma does.** Rows and columns with cells; children span multiple cells; row/column counts via grid picker; rows default to `auto` and count grows with content [S4]. Track sizing: drag edge = Fixed; Fill = fractional units (`fr` share = value / total fr) ; Hug; min/max; type `Auto`/`A` = 1fr [S4]. Separate row/column gaps; padding with shorthand [S4]. Span requires child to be Fill; stretch on canvas to cell edge, or Column span / Row span fields [S4]. Automatic positioning left-to-right, top-to-bottom; turning it off keeps empty cells [S4]. Search results/forum: no wrapping; hug for tracks was missing / in progress at the time [S5-search, unconfirmed beyond the search snippet]. The help page itself does not state CSS mapping, only links `fr` to MDN [S4].

**CSS** (closest equivalents; **[inference]**, mapping not stated by Figma):

| Figma | CSS |
|---|---|
| Grid flow | `display:grid` |
| Column/row tracks | `grid-template-columns/rows` e.g. `repeat(3, 1fr)` (S6 shows `repeat(3,1fr)`), `200px`, `auto`, `minmax()` |
| Fill track | `Nfr` |
| Hug track | `auto` or `max-content` |
| Row gap / col gap | `row-gap` / `column-gap` |
| Span | `grid-column: span N` / `grid-row: span N` (S6 shows `grid-row: span 2`) |
| Auto positioning on | default auto-placement; off = explicit `grid-column/row-start` |
| Padding | `padding` |

**Editor UI on an existing grid element.** Read `getComputedStyle().gridTemplateColumns/Rows` (resolved pixel tracks) AND the authored value (to keep `repeat/minmax/auto-fill`). Render a track overlay (column/row headers with size chips: `1fr`, `240px`, `auto`), drag a track edge to set px, click chip to cycle Fixed/Fill/Hug. Child: Column span / Row span fields, drag child edge to cell boundary to set span. Gap fields row/column.

**Priority:** SHOULD for display + gap + padding + span fields + editing simple `repeat(N, 1fr)` / px lists; LATER for `auto-fill/auto-fit`, `minmax`, named lines/areas, subgrid, dense packing, spanning via drag.

**Pitfalls.**
- Authored `repeat(auto-fill, minmax(...))` has data-dependent track counts; track overlay is read-only for those, and edits must not rewrite to a fixed count silently.
- `grid-template-areas` layouts: children placed by `grid-area`; Figma's model (cell indices) does not represent it; show area names read-only.
- Implicit tracks (`grid-auto-rows`) vs explicit; Figma's default row `auto` ~ `grid-auto-rows:auto`.
- Items spanning in Figma require "Fill"; in CSS, a grid item with a fixed width inside a wider cell is allowed - map as Fixed + `justify-self:start`.
- `fr` has implicit `min-width:auto` (min-content) blowout; suggest `minmax(0,1fr)`.
- Figma does not map to subgrid, masonry, or `grid-auto-flow:column` etc.

---

## 6. Layout guides (formerly layout grids) - NOT layout

Renamed from "layout grid" to "layout guide" in May 2025; a visual aid separate from grid auto layout [S5]. Types: Uniform grid (square size), Column, Row; Column/Row types Left/Center/Right/Stretch; stretch has count, margin, gutter; fixed has width + offset [S5]. Snapping behaviour is not documented on that page.

**CSS correspondence [inference]:** a 12-col stretch guide with margin/gutter ~ `grid-template-columns:repeat(12,1fr); column-gap:gutter; padding-inline:margin`; but guides do not create layout, they only snap.

**Editor UI.** Overlay-only: configurable column/row/uniform guide drawn above the selected container, with snapping of drag and resize to guide lines. Optionally read from existing `display:grid` columns or from a project-level `container` width. Never written to CSS unless the user "applies as grid".

**Priority:** LATER (nice-to-have). A simple pixel/uniform grid snap and smart guides are SHOULD but belong to a snapping topic.

**Pitfall.** Do not confuse with Grid auto layout (S5 explicitly warns).

---

## 7. On-canvas affordances

What Figma shows [S1, S3]:
- **Padding handles:** hover a selected auto layout frame to show pink padding handles; drag to change, click to type [S3]. Alt/Option while dragging = mirror opposite sides; Alt+Shift = all sides; Shift = bigger nudge [S1]. Alt+click on a padding area to type opposite-sides value, add Shift for all sides [S1].
- **Gap handles (spacing between items):** Figma's help pages fetched do not describe gap handles on-canvas in detail; the guide only references padding handles explicitly. (Gap dragging between children is a known Figma affordance but I did not confirm it from fetched pages; treat as [inference]/design suggestion.)
- **Alignment box (9-dot):** in the right panel; arrow keys move position, W/A/S/D align to edges, B baseline, X toggle auto gap [S1, S3]. With Auto gap, only 3 positions [S3].
- Resizing: double-click edge = Hug, Alt+double-click edge = Fill [S1]; manual resize to the full parent space sets Fill [S1].
- Constraints widget blue dotted lines [S2].
- Add / suggest / remove auto layout shortcuts: Shift+A, Ctrl+Shift+A (suggest, Mac), Option+Shift+A (remove) [S1].

Editor implementation (all MUST/SHOULD):
- Overlay layer (absolutely positioned in an iframe-adjacent layer, using `getBoundingClientRect` + `getComputedStyle` padding values). Draw 4 padding bands as translucent pink strips inside the content box; drag a strip -> write `padding-*`. Modifier keys as in Figma. MUST.
- Gap handles: for flex/grid, draw the gap strips between adjacent children (computed from child rects), drag to change `gap`. For `justify-content:space-between` show them as read-only distributed gaps. SHOULD.
- Side-by-side with value chips (`16`, `1rem` if authored in rem).
- Drag-reorder children within a flex container with an insertion line; writes DOM order. SHOULD (belongs to the layers/drag topic).
- Dragging an element INTO a container: Figma auto-inserts; holding Ctrl/S makes it absolute [S1]. For us: drop -> DOM reparent; modifier -> absolute.

Pitfalls: padding handle drag on elements with percentage padding (`padding:5%`) are relative to the parent width; preserve unit or confirm conversion. Overlay must be recomputed on scroll/resize/zoom; the iframe's CSS transform zoom affects measured rects. Margin is NOT padding; Figma has no margin; many HTML elements use margin for spacing, so show margin as a separate (LATER) green overlay.

---

## 8. How Figma Dev Mode itself translates layout to CSS (and its weaknesses)

- Dev Mode populates a Code section with autogenerated snippets on click; the Inspect tab lists layout properties; units configurable in Inspect settings [S10]. The help page does not document the layout->CSS rules.
- Third-party/derived mapping: auto layout -> `display:flex`, direction -> `flex-direction`, gap -> `gap`, padding -> `padding`, Fill -> `align-self:stretch` (counter) [S6]; the code-agent reference gives the full table (Fill = `flex-grow:1; flex-basis:0`, Fixed = explicit size + `flex-shrink:0`, Hug = nothing; wrap = `flex-wrap:wrap` + `align-content`; absolute children = `position:absolute` in `position:relative` parent; constraints = left/right/top/bottom, center = `left:50%` + translate; min/max emitted only when set) [S7].
- Gap/padding in Dev Mode appear only when auto layout is used; Fill and min/max need an auto layout parent [search snippets from forum; unconfirmed beyond snippet].
- Reported issues: the `align-items` output seeming wrong (container-level vs item-level stretch) and layout code missing in some cases [search snippets]. Takeaway **[inference]**: Dev Mode CSS is a hint; our editor reads the real DOM so it avoids this class of bug, but it should mirror the *minimal-emission* conventions above.

Editor use: reuse the S7 table inversely (CSS -> Figma control state).

---

## 9. Ranked summary

| # | Idea | Priority |
|---|---|---|
| 1 | Auto-layout panel for `display:flex` (direction, gap, padding, 9-dot alignment, space-between) | MUST |
| 2 | Hug/Fill/Fixed per axis + min/max, derived from computed style, minimal CSS emission | MUST |
| 3 | On-canvas padding handles (with Alt/Shift modifiers), gap handles | MUST (padding) / SHOULD (gap) |
| 4 | "Ignore auto layout" = `position:absolute` + auto `position:relative` on parent | MUST |
| 5 | Add/remove auto layout (block <-> flex) | SHOULD |
| 6 | Flex-wrap + dual gaps, evenly/around | SHOULD |
| 7 | Grid panel: tracks overlay, gaps, spans | SHOULD (basic) / LATER (auto-fill, areas) |
| 8 | Constraints widget for absolute children (pin L/R/T/B, L&R, T&B) | SHOULD; Center/Scale LATER |
| 9 | Layout guides / snapping overlay | LATER |
| 10 | margins-to-gap conversion, reverse direction, order | LATER |

Cross-cutting pitfalls: confirm `display` before showing flex controls; the CSS default `align-items:stretch` has no 9-dot cell; keep authored units/tokens (`rem`, `%`, `var()`, `clamp()`); `min-width:0` on Fill children; box-sizing; edit the owning rule (class vs inline vs media query: edits from the editor should target the active breakpoint rule); shared classes mean one edit changes many elements (show "applies to N elements" indicator).

---

## Sources (all fetched via WebFetch this session)

- [S1] Figma Help, Guide to auto layout: https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout
- [S2] Figma Help, Apply constraints to define how layers resize: https://help.figma.com/hc/en-us/articles/360039957734-Apply-constraints-to-define-how-layers-resize
- [S3] Figma Help, Use the horizontal and vertical flows in auto layout: https://help.figma.com/hc/en-us/articles/31289464393751
- [S4] Figma Help, Use the grid auto layout flow: https://help.figma.com/hc/en-us/articles/31289469907863
- [S5] Figma Help, Create layout guides (layout grids): https://help.figma.com/hc/en-us/articles/360040450513-Create-layout-grids-in-Figma-Design
- [S6] LogRocket, Designer's guide to flexbox and grid layout: https://blog.logrocket.com/ux-design/designers-guide-flexbox-grid-layout
- [S7] figma-code-agent, Auto Layout -> CSS Flexbox Mapping: https://cdn.jsdelivr.net/npm/figma-code-agent@1.0.2/knowledge/design-to-code-layout.md
- [S8] Grida docs, Figma autolayout to CSS: https://grida.co/docs/@designto-code/figma-autolayout
- [S10] Figma Help, Dev Mode inspect: https://help.figma.com/hc/en-us/articles/22012921621015

Search-only (WebSearch results; direct fetch failed with 403 or not fetched, so claims drawn from them are marked "search snippet"): Figma forum threads on flexbox output and auto layout inspect code (forum.figma.com), grid forum thread on hug tracks. [S9] in the text refers to the WebSearch result summary on Fill/Hug mappings from various sources (Oracle flex sizing docs, Figma forum), not a single fetched page.
