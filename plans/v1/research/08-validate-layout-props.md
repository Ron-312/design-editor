# 08 - Validation of research 02 (layout to CSS) and 03 (properties panel / tokens), plus new ideas

Date of check: 2026-11-23. Every row cites a URL fetched with WebFetch this session (WebSearch snippets are labelled "search only" and never count as CONFIRMED). Existing files and plan.md were not edited.

Legend: CONFIRMED / WRONG (correction given) / STILL UNVERIFIED.

## A. Validation table

### A1. Layout (research/02)

| # | Claim in 02 | Verdict | Evidence / correction |
|---|---|---|---|
| 1 | Hug = auto layout frames only; Fill = children only, can't be top-level; Fixed set by typing; Fill child stops parent hugging on that axis | CONFIRMED | [F1] |
| 2 | Min/max via Width/Height dropdown, combinable, "Remove min and max" | CONFIRMED | [F1]. Extra: min/max accept px only (June 2026 forum request, search only [F20]); grid frames did not offer min/max in the May 2025 beta (search only), but the current grid help page lists min/max for cell objects and grid frames [F3]. |
| 3 | Double-click edge = Hug, Alt+double-click = Fill | CONFIRMED | [F1] |
| 4 | Padding handle: Alt = opposite sides, Alt+Shift = all sides, Shift = big nudge; Alt+click on area types opposite/all | CONFIRMED | [F1]. NEW detail missed: in the right-panel padding field, Cmd/Ctrl+click edits all sides, and typing CSS shorthand `1,2,3,4` works [F1][F2][F3]. Handles are pink, click-to-type [F2]. |
| 5 | Alignment box: arrows, W/A/S/D, B baseline, X toggles auto gap | CONFIRMED | [F1][F2]. B = "text baseline alignment", aimed at mixed font sizes / icon-with-text [F2]. |
| 6 | With Auto gap only 3 alignment positions on the cross axis | CONFIRMED | [F2] (vertical flow: Left/Center/Right; horizontal: Top/Center/Bottom). |
| 7 | Alignment mapping: min/center/max -> `flex-start/center/flex-end`; Auto gap -> `space-between` | CONFIRMED (Figma side) / the `space-around` and `space-evenly` options are in Between/Around/Evenly per the auto layout version article [F4]. CSS side is inference but consistent with MDN `align-items` baseline text [M1]. |
| 8 | Counter-axis `baseline` -> `align-items: baseline` | CONFIRMED (CSS side) | MDN: `baseline`/`first baseline`/`last baseline` exist and are widely available [M1]. Figma exposes only text baseline (first), not `last baseline`. |
| 9 | CSS default `align-items: stretch` has no cell in the 9-dot box | CONFIRMED | For flex items `normal` behaves as `stretch`, and only when cross-size is `auto`; otherwise falls back to `flex-start` [M1]. Editor must treat `normal|stretch` as a distinct "stretch" state. |
| 10 | **Fill main axis = `flex:1 1 0` (shrink 1), disputed vs `1 0 0`** | **STILL UNVERIFIED for what Figma Dev Mode literally prints; but the practical dispute is RESOLVED: shrink value is irrelevant.** | No fetched or searched source quotes Dev Mode output. Figma's updated-auto-layout article says Dev Mode code "maps more directly to CSS flexbox" but states no values and no flex-shrink [F4]. Grida's page is vague (`layoutGrow:1`, "flex 0/1", no flex-shrink/basis) [F5]. Oracle's page returned 404 on fetch; the search summary says Oracle uses `flex: 1 1 0%` (search only). MDN: with `flex-basis:0` the shrink weight = shrink x base size = 0, so shrink 0 vs 1 changes nothing [M2]. **Action:** write `flex: 1 1 0` (or `flex-grow:1; flex-basis:0`); the real guard against overflow is `min-width:0` (flex item default `min-width:auto` floors at min-content) [M2]. Read-side: classify Fill by `flex-grow>0` and basis 0, ignoring shrink. |
| 11 | Fixed on main axis needs `flex-shrink:0` | STILL UNVERIFIED (source of claim was a third-party mapping, not Figma). Reasoning supported by MDN: shrink only applies when sums exceed container and is proportional to base size [M2]. Keep it as editor policy "Fixed means does not shrink", not as a Figma fact. |
| 12 | Fill cross axis = `align-self: stretch` | CONFIRMED (third-party) | Grida: `layoutAlign STRETCH` -> `align-self: stretch`, remove height [F5]. Not stated by Figma itself. |
| 13 | Hug = emit nothing | CONFIRMED (consistent) | Grida: hug has no intrinsic size [F5]. |
| 14 | "Ignore auto layout" (renamed from Absolute); Ctrl-drag in | CONFIRMED | [F1]. Name changed, behaviour same. Windows modifier is S per 02; page I fetched only lists Control(Mac), so Windows key is UNVERIFIED. |
| 15 | Add/suggest/remove: Shift+A, Ctrl+Shift+A (Mac), Option+Shift+A | CONFIRMED | [F1]; Windows: Ctrl+Alt+Shift+A suggest, Alt+Shift+A remove. |
| 16 | Wrap, vertical wrap not masonry; Grid flow; nested multi-dim flows | CONFIRMED | [F1]. |
| 17 | Gap handles on canvas are an unconfirmed affordance | STILL UNVERIFIED | Neither [F1] nor [F2] describes on-canvas gap handles. Only padding handles are documented. |
| 18 | "Auto gap collapse / negative gap = overlap, canvas stacking" | CONFIRMED + refinement | [F2]; in the updated version, auto gap never goes below 0 and children that don't fit collapse to start instead of overlapping; explicit negative gap still overlaps [F4]. |
| 19 | Single child with Auto gap aligns to start (not centered) | NEW CONFIRMED | [F2][F4]: applies to Between; with Around/Evenly it stays centered [F4]. Editor: `justify-content:space-between` with one child behaves exactly like `flex-start` in CSS, so CSS already matches the new Figma behaviour. |
| 20 | box-sizing: Figma includes inside strokes in layout, doesn't match CSS borders | **WRONG-ish / outdated** | Updated auto layout is explicitly designed "to match CSS flexbox and border-box rendering more closely": inside strokes count in layout, padding can't go below total padding, padding overrides max width; outside/center strokes don't affect layout [F4]. New frames default to this version from July 2026; legacy toggle becomes an Update button January 2027 [F4]. So the border-box assumption is now the Figma default, the "mismatch" caveat applies only to legacy frames. |
| 21 | Fill splits space by content area, not total size (new) | NEW CONFIRMED | [F4]: with a thicker stroke a child takes slightly more space so inner content matches siblings; Figma itself recommends grid `fr` for strict equal splits. Relevant to "mirror" semantics: CSS `flex:1 1 0` with `box-sizing:border-box` splits by border-box instead. Cosmetic; note in docs. |
| 22 | Grid: tracks Fixed / Fill (`fr`) / Hug; `A`/`Auto` = 1fr; spans need Fill; separate row/col gap; auto-positioning; auto rows default | CONFIRMED | [F3]. Extra: grid picker accepts math (+ - * /); Cmd/Ctrl or Shift multi-select tracks; drag to reorder tracks (GA May 22 2026) [F3][F6]; child align within cell via Position section [F3]. |
| 23 | Grid hug-track "missing/in progress" | **WRONG (outdated)** | The current grid help page lists Hug contents for tracks and the grid frame [F3]. Map Hug track = `auto` (or `max-content`; `auto` is the safe default). |
| 24 | Grid GA | NEW | "Do more with grid" release, May 22 2026: drag-to-reorder tracks, auto-positioning into empty cells, auto row create/remove [F6]. |
| 25 | Layout guides renamed from layout grids May 2025 | STILL UNVERIFIED | Not re-fetched; the grid page confirms "layout guides' uniform grid is a separate feature" [F3]. Low importance. |
| 26 | Constraints facts (Left/Right/Center/Scale, only non-auto-layout children) | STILL UNVERIFIED this round (not re-fetched). Consistent with [F1] statement that Ignore-auto-layout children "use constraints". |

### A2. Properties panel / tokens (research/03)

| # | Claim in 03 | Verdict | Evidence / correction |
|---|---|---|---|
| 27 | **Panel section order: Position, Layout, Appearance, Fill, Stroke, Effects, Typography** | **WRONG / at best UNVERIFIED** | The Figma properties-panel article lists: alignment/rotation/position, frame size and orientation, corner radius, constraints, layout guides, component properties, instance, auto layout, blend modes, text, fill, stroke, effects, export, but says it is not a visual-order claim [F7]. UI3 blog: component controls sit above colour/size; width/height + auto layout merged into one Layout section; x/y kept above w/h; labels optional; panels resizable; it gives no full order [F8]. No fetched source supports a section named "Appearance" holding blend/radius/opacity as a block; that is a plausible UI3 memory but UNVERIFIED. Practical order to use: Position (align, x/y, rotation) -> Layout (w/h, auto layout, constraints) -> Appearance-like (radius, opacity, blend) -> Typography -> Fill -> Stroke -> Effects -> Export. Text above Fill matches [F7]. Treat as a design choice, not a Figma fact. |
| 28 | UI3: x/y above w/h, merged Layout, optional labels, resizable panel | CONFIRMED | [F8]. |
| 29 | Option/Alt-drag scrubbing on numeric fields; faster toward top | STILL UNVERIFIED (official), community-supported | Search only: forum replies say hold Option/Alt and drag over any numeric input, speed depends on cursor height [F16-search]. Reliability complaints (not every field, e.g. corner radius on Windows) [F16-search]. Figma's properties-panel help page has no scrub/math text [F7]. |
| 30 | Math operators in fields (`-20`, `*4`, `/8`) | STILL UNVERIFIED | No Figma page fetched mentions it, except the grid picker which explicitly accepts + - * / [F3]. Padding accepts CSS shorthand `1,2,3,4` [F2][F3]. Keep as editor feature; don't claim Figma parity. |
| 31 | Shift+arrow = 10x step | STILL UNVERIFIED | Search found no Figma-specific confirmation; only a generic browser article and complaints that Shift/arrow stopped working in some fields [F16-search]. Mark as editor policy. Arrows nudge values per grid page [F3]. |
| 32 | Typography units: px size; line height px / % / Auto; letter spacing | CONFIRMED | [F9]: line height fixed px or % of font size, default Auto; switching units rounds to nearest px. Letter spacing is tracking/1000 em; paragraph spacing/indent in px. |
| 33 | "Figma % line-height -> unitless in CSS" | STILL UNVERIFIED as Figma output (editor policy; sound per CSS). |
| 34 | Wrap style Auto/Balance/Pretty -> `text-wrap` | CONFIRMED | [F9]: Dev Mode prints `text-wrap: balance|pretty`, Auto emits nothing; Balance not recommended past 6 lines; line breaks may differ from browsers. |
| 35 | Truncation + max lines | CONFIRMED + nuance | [F9]: max lines requires truncation on and resizing auto height/width (or hug). |
| 36 | Color picker models "RGB, HEX, CSS, HSL, HSB" | **WRONG (minor)** | Five models: Hex, HSB, HSL, CSS, RGB [F10]. The CSS model accepts input in supported CSS formats including OKLCH and OKLab as input only; it does not have an OKLCH display model [F10]. The color-picker article lists WCAG AA/AAA contrast check with auto-fix, eyedropper, variables/styles, blend modes; no conic/mesh mention [F11]. |
| 37 | Display P3 vs sRGB | NEW CONFIRMED | New files default to sRGB; Display P3 is a per-file profile [F12]. Relevant to `color(display-p3 ...)` / `oklch()` authored in CSS: our picker must not clamp to sRGB. |
| 38 | Variables: types colour/number/string/boolean; 5,000 per collection; aliases same type; scoping; code syntax Web/Android/iOS | CONFIRMED | [F13] (code syntax: up to three, one per platform; Dev Mode snippets support CSS, SwiftUI, Compose). Entry point moved to left-nav Variables tab with minimizable modal and search/type filter [F13]. Types list lives on another page, boolean not re-verified. |
| 39 | Modes need paid/Education plans | CONFIRMED | [F13]. |
| 40 | Dev Mode emits `var(--name, fallback)` and normalises names | CONFIRMED | [F14]: `font-weight: var(--Thin-100, 100);`, `🔵 Blue 0000FF` -> `--blue-0000FF`. String variables for weight output numeric or 400. Dev Mode suggests matching variables for raw values when exact match and scope fits [F14]. Name casing: Dev Mode keeps case (`--Thin-100`), the third-party "lowercased" claim in 03 is WRONG for Figma's own output. |
| 41 | Mode export convention `:root` / `[data-theme]` / `prefers-color-scheme` | STILL UNVERIFIED (third-party convention, not Figma behaviour). |
| 42 | Dev Mode unit setting, rem | NEW | Inspect panel has settings icon -> "Set unit scale..." (search only [F17]); rem assumed 16px by default per Tokens Studio doc (search only). Not confirmed from Figma page. |
| 43 | Variables bind to layout-grid fields and each corner radius | NEW (search/fetch of forum index) | [F15] forum "product updates" listing: variables bind to layout-grid count/width/margin/offset/gutter; per-corner radius binding; incompatible modes selectable (use default value). Dates "about 2 years ago". |
| 44 | `@property` typed tokens, `var()` fallback semantics | UNVERIFIED this round (MDN not re-fetched); no conflict found. |

## B. Net corrections to carry into the plan

1. Fill: write `flex: 1 1 0` plus `min-width:0` (or `min-height:0` for column). flex-shrink is a non-issue at basis 0 [M2]. Do not cite Dev Mode as the source of `1 0 0`.
2. Drop "Figma border box mismatch" caveat: updated auto layout (default for new frames since July 2026) is border-box-like [F4]. Keep `box-sizing:border-box` as expected.
3. Grid tracks support Hug now [F3].
4. Panel section order is not documented as a visual order [F7][F8]; do not claim Appearance/Position grouping as Figma fact. Use the order in A2 #27 as a design choice.
5. Scrub, math, Shift+arrow: keep as features, remove "Figma does this" claims except Option-drag scrub (community-attested) and grid picker math [F3].
6. Variable names from Dev Mode are not lowercased [F14].
7. Color model list is Hex, HSB, HSL, CSS, RGB [F10].

## C. New ideas (ranked)

### MUST

1. **Text-box trim (Figma "Vertical trim")** - Figma Dev Mode still prints draft `leading-trim: both` and says it maps to `leading-trim`/`text-edge` [F9][F18]. Final CSS is `text-box-trim` + `text-box-edge`, shorthand `text-box`. MDN: Baseline 2026, newly available since August 2026 [M3]. Toggle writes:
   ```css
   text-box: trim-both cap alphabetic;   /* = text-box-trim:trim-both; text-box-edge:cap alphabetic */
   ```
   Options: `trim-start | trim-end | trim-both | none`; edge `text|cap|ex` over, `text|alphabetic` under [M3]. Gate behind a capability check: `CSS.supports('text-box','trim-both cap alphabetic')`, show a warning if false. Caveat: Figma's trimmed bounds and the browser's may differ (forum thread, unanswered by Figma) [F18].
2. **Min/max with the Hug/Fill/Fixed control** (already in 02, but note px-only in Figma; our editor should allow rem/%/`var()`): `min-width`, `max-width`, `min-height`, `max-height`. Also `padding overrides max-width` is automatic in border-box CSS only when `max-width` + `box-sizing:border-box`; warn on content-box [F4].
3. **Fill => min-width:0 auto-write** as above (correctness fix).
4. **Preserve `normal|stretch` alignment state** in the 9-dot box [M1].

### SHOULD

5. **Baseline alignment (B key)** - container toggle:
   ```css
   align-items: baseline;   /* optional: first baseline | last baseline */
   ```
   Only valid on the cross axis; for `flex-direction:column` there is no useful baseline row (text baseline concept applies to row) [F2][M1].
6. **Text wrap style** Auto/Balance/Pretty: `text-wrap: balance|pretty` (Auto = remove declaration) [F9].
7. **Grid track UI** with Fixed/Fill/Hug chips: `200px` / `1fr` / `auto`; typing `A` = `1fr`; grid picker accepts math; track multi-select; reorder tracks (rewrites `grid-template-*` list and child `grid-column/row` indices) [F3][F6]. Prefer `minmax(0,1fr)` to avoid min-content blowout (inference). Span: `grid-column: span N; grid-row: span N`; child cell alignment: `justify-self` / `align-self` [F3].
8. **Padding field gestures**: Cmd/Ctrl+click = all sides, type `1,2,3,4` CSS-shorthand [F1][F2]. Emit `padding: a b c d` shorthand with comma input converted.
9. **Variable chips and exact-match suggestion**: when a raw value equals a token (and type/scope fits), suggest `var(--token)`; show `var(--name, fallback)` form read-only [F14].
10. **Inspect-style CSS tab with unit scale**: px <-> rem with configurable base, mirroring "Set unit scale..." (search only [F17]); copy value on click [F14].
11. **Color picker: CSS model that accepts any CSS colour string including `oklch()`/`oklab()` input** [F10] and keeps authored format; show contrast AA/AAA with auto-fix [F11]. Profile awareness: do not clamp `color(display-p3 ...)` [F12].
12. **Variable binding in more fields** (grid track/gap, per-corner radius): UI should allow `var()` in any length slot [F15][F13 scope].

### LATER

13. **Variable modes / extended collections**: extended collections are Enterprise, parent collection extended per brand with overrides; extensions can't add variables or change scope (search only [F19]). CSS mapping: parent = `:root{...}`, each extension = a scoped override `[data-brand="x"]{ --token: ... }`; do not write new tokens from an extension scope. Editing a token while a mode is active writes into the matching scope (already in 03).
14. **Auto layout version awareness**: legacy vs updated frames differ (strokes, min padding, single-child Between). We read CSS, so only relevant when importing from Figma. Skip.
15. **Canvas stacking** (first/last on top with negative gap) [F2]: CSS equivalent is negative `gap` + `z-index` / `order`; skip.
16. **Subgrid** (`grid-template-columns: subgrid`, Baseline widely available since Sept 2023 [M4]); Figma has no equivalent, so show read-only in grid panel.
17. **Line-height unit toggle** px/%/Auto: Auto = `line-height: normal`; % = unitless multiplier (editor policy) [F9].

## D. Still-open items for a hands-on check in the Figma app
- Literal Dev Mode output for Fill (`flex: 1 0 0` vs `1 1 0`).
- Real visual order of the Design tab in UI3.
- Option+drag scrub, Shift+arrow step, math syntax.
- Whether canvas gap handles exist.
- Whether Dev Mode text trim output has switched to `text-box-trim` since the September 2026 forum post (search only).

## Sources

Figma (fetched):
- [F1] https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout
- [F2] https://help.figma.com/hc/en-us/articles/31289464393751
- [F3] https://help.figma.com/hc/en-us/articles/31289469907863
- [F4] https://help.figma.com/hc/articles/42031586813719
- [F6] https://www.figma.com/release-notes/archive/ (May 22 2026 "Do more with grid"; also https://www.figma.com/release-notes/ lists Nov 2026 3D transform and Dev Mode agent)
- [F7] https://help.figma.com/hc/en-us/articles/360039832014-Explore-the-properties-panel
- [F8] https://www.figma.com/blog/behind-our-redesign-ui3/
- [F9] https://help.figma.com/hc/en-us/articles/360039956634
- [F10] https://help.figma.com/hc/en-us/articles/360043042113
- [F11] https://help.figma.com/hc/en-us/articles/360041003774-Apply-paints-with-the-color-picker
- [F12] https://help.figma.com/hc/en-us/articles/360039825114
- [F13] https://help.figma.com/hc/articles/15145852043927
- [F14] https://help.figma.com/hc/en-us/articles/27882809912471
- [F15] https://forum.figma.com/news-and-updates-1/index5.html
- [F18] https://forum.figma.com/report-a-problem-6/text-layer-height-and-vertical-trim-do-not-map-clearly-to-browser-css-line-boxes-57490
- [F5] https://grida.co/docs/@designto-code/figma-autolayout (third party)

MDN (fetched):
- [M1] https://developer.mozilla.org/en-US/docs/Web/CSS/align-items
- [M2] https://developer.mozilla.org/en-US/docs/Web/CSS/flex-shrink
- [M3] https://developer.mozilla.org/en-US/docs/Web/CSS/text-box-trim
- [M4] https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Subgrid

Search only (WebSearch result pages, not fetched; claims labelled accordingly):
- [F16-search] https://forum.figma.com/report-a-problem-6/option-drag-alt-drag-not-working-in-all-number-fields-37280 and https://forum.figma.com/suggest-a-feature-11/sliding-values-they-re-fantastic-but-not-always-video-8160
- [F17] https://help.figma.com/hc/en-us/articles/15023202277399 (Inspect unit scale, via search summary)
- [F19] https://forum.figma.com/ask-the-community-7/extended-collections-for-enterprise-plans-only-46810 and https://www.figma.com/blog/schema-2025-design-systems-recap/
- [F20] https://forum.figma.com/suggest-a-feature-11/launched-min-and-max-width-for-auto-layout-13043/index10.html
- Oracle flex sizing (fetch 404, search summary only): https://docs.oracle.com/en/industries/financial-services/banking-digital-experience/25.1.0.0.0/txuxp/flex-sizing-child-behavior.html
- Flex search: https://grida.co/docs/@designto-code/figma-autolayout, https://cdn.jsdelivr.net/npm/figma-code-agent@1.0.2/knowledge/design-to-code-layout.md
