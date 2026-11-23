# Fills, strokes, effects and the colour picker

## Sources (fetched)
Fetched 2026-11-23 with WebFetch unless marked (search) = content taken from a WebSearch result summary only.
1. Figma Help, Update fills using the color picker — https://help.figma.com/hc/en-us/articles/360041003774-Apply-paints-with-the-color-picker — 2026-11-23
2. Figma Help, same article, short URL — https://help.figma.com/hc/en-us/articles/360041003774 — 2026-11-23
3. Figma Help, Strokes — https://help.figma.com/hc/en-us/articles/360049283914 — 2026-11-23
4. Figma Help, Apply shadow or blur effects — https://help.figma.com/hc/en-us/articles/360041488473 — 2026-11-23
5. Figma Help, Use gradients as a fill or stroke — https://help.figma.com/hc/en-us/articles/34208860210199-Use-gradients-as-a-fill-or-stroke — 2026-11-23
6. Figma Help, Corner radius and smoothing — https://help.figma.com/hc/en-us/articles/360050986854 — 2026-11-23
7. Figma Help, Blend modes — https://help.figma.com/hc/en-us/articles/360040667874 — 2026-11-23
8. Figma Help, Image fills — https://help.figma.com/hc/en-us/articles/360041098433 — 2026-11-23
9. MDN corner-shape — https://developer.mozilla.org/en-US/docs/Web/CSS/corner-shape — 2026-11-23
10. MDN conic-gradient() — https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/conic-gradient — 2026-11-23
11. MDN EyeDropper API — https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper_API — 2026-11-23
12. MDN background-blend-mode — https://developer.mozilla.org/en-US/docs/Web/CSS/background-blend-mode — 2026-11-23
13. MDN backdrop-filter — https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter — 2026-11-23
14. (search) Figma Help, Color models in Figma Design — https://help.figma.com/hc/en-us/articles/360043042113 — 2026-11-23 (result summary only)
15. (search) Figma forum threads on stroke vs CSS (border/outline/box-shadow mapping; community opinion, not Figma docs): https://forum.figma.com/t/css-outline-and-outline-offset/56091 , https://forum.figma.com/suggest-a-feature-11/allow-separated-stroke-positions-and-width-25339 — 2026-11-23
16. (search) Framer Dictionary, Fill / Blend modes — https://www.framer.com/dictionary/fill , https://www.framer.com/ja/dictionary/blend-modes — 2026-11-23
17. (search) Figma forum, corner smoothing not in Dev Mode / CSS — https://forum.figma.com/t/where-can-developers-find-the-corner-smoothing-value/241 — 2026-11-23

Repo baseline: plans/v1/parity.md:83-94 and :192-195 (picker, per-corner radius, editable shadows are listed as next gaps; gradients/image fills "Out of scope"; blur/backdrop-filter "Not built"). Code: `src/ui/panels/sections/style.section.tsx:25-45` (opacity + one radius, one `background-color`, `border-color` + `border-width`), `:47-70` (shadow list: show + remove only), `src/ui/panels/fields.tsx:442` (`ColourField`: text + alpha %, no picker). grep of `src/` finds no `background-image`, `mix-blend`, `backdrop` writers.

## Figma features in this area

### 1. Visual colour picker (square, hue and alpha sliders, notation dropdown)
- Does: picker opens from the Fill/Stroke swatch; has a colour area, hue slider, opacity slider, and a notation dropdown (RGB, HEX, CSS, HSL, HSB), plus a contrast check [1]. Models only change how a value is shown, not how it renders; the CSS model takes a full CSS colour string incl. oklch/oklab/P3 [14]. (Note: [1] calls the area a "color palette", it does not name an HSB square.)
- Reliance: very high; every Figma user touches it daily.
- Status: Partial. Text + alpha % only (`fields.tsx:442`), parity.md:83, :192.
- CSS mapping: write `background-color` / `color` / `border-color` / gradient stop colours in the authored format (`inAuthoredColorFormat`, `css-values.ts`). Square = S/B (or OKLCH C/L) drag; hue slider; alpha writes `/ a` or `rgb a`. Keep oklch/P3 unclamped (v1 decision, 00-figma-ideas.md:44).
- Effort: M. Risk: round-tripping authored format (hex vs hsl vs oklch) so a drag does not rewrite the user's format; low-res of HSB for wide-gamut values.

### 2. Eyedropper
- Does: samples a colour from another layer on canvas, applies/creates variables and styles [1]; Tab cycles the readout model (search result in a help excerpt).
- Reliance: high.
- Status: Missing (parity.md:83).
- CSS mapping: two options: (a) native `EyeDropper().open()` returns `sRGBHex`, needs secure context + user gesture, Chromium only, can sample outside the window [11]; (b) sample from the canvas iframe via `getComputedStyle` of the element under the pointer (exact, keeps oklch, can offer `var(--token)` when value matches a token). Option (b) is the better fit; (a) is a fallback for images/pixels.
- Effort: S (b) / S (a). Risk: (a) loses authored format and is unavailable in Firefox/Safari; the Electron desktop shell is Chromium so (a) works there.

### 3. Document colours and Selection colours
- Does: picker lists colours already in the file and added libraries [2]; "Selection colors" lists every fill/stroke across a mixed selection and lets you change one swatch for all [1,2].
- Reliance: medium-high (consistency, bulk recolour).
- Status: Missing (token picker exists: parity.md:100, `fields.tsx:331`; "Selection colours replace" listed as non-built in 00-figma-ideas.md:62).
- CSS mapping: scan canvas `style=""` and `<helmet><style>` for colour values (colour props, gradient stops, shadows), dedupe by canonical value, show as swatches; replace = rewrite every matching declaration byte-exact. Tokens (`:root --*`) come first.
- Effort: M (scan) + S (replace). Risk: equality of colours in different formats (`#fff` vs `rgb(255 255 255)`); scoping "all in file" vs "all in selection".

### 4. Multiple fills (fill stack per layer)
- Does: a layer can hold several fills; Figma lists solid/gradient/pattern/image/video types in the picker [1]. Each fill can have its own blend mode [7]; Framer likewise layers fills with blend modes [16]. [1,2] do not describe stacking in detail.
- Reliance: high for gradient-over-colour, image + tint overlay.
- Status: Missing (single `background-color` only, `style.section.tsx:34`).
- CSS mapping: first fill = bottom. Solid colours above the bottom fill become `linear-gradient(c, c)` layers in `background-image` (CSS `background-color` is one-per-element, only on the last layer). So: `background: <layerN>, ..., <layer1>, <color>`. Per-fill blend = `background-blend-mode` comma list, same order [12]. Reorder = reorder comma list (use existing `splitTopLevel`, `style.section.tsx:~10`). Hide = comment-free removal; Figma "hidden fill" has no CSS form, so the editor needs to keep it as a disabled state (e.g. drop to editor-side memory, or write nothing).
- Effort: L. Risk: parsing arbitrary authored `background` shorthands (url(), multiple values, position/size/repeat per layer); only edit layers it understands, leave the rest verbatim and show as "raw layer"; hidden fills have no CSS home.

### 5. Gradients (linear, radial, angular, diamond) and the gradient editor
- Does: four types; two stops by default, click bar to add, drag to move, Delete/minus to remove; flip and rotate buttons; gradients on strokes too; stops can bind variables [5]. Angular runs clockwise from the start [5]. Diamond has separate width/height [5].
- Reliance: high.
- Status: Out of scope in v1 (parity.md:93); no code.
- CSS mapping: linear = `linear-gradient(<angle>, stop pos, ...)`; radial = `radial-gradient(<shape> <size> at <x% y%>, ...)`; angular = `conic-gradient(from <angle> at <x y>, stop <angle|%>, ...)` (clockwise from 12 o'clock; Baseline) [10]; diamond has no CSS primitive: not worth mapping exactly (see Not worth it). Optional `in oklch` interpolation keyword [10]. Stop colours reuse the colour picker; stops can write `var(--token)`. Stroke gradient: `border-image` kills `border-radius`, so use a two-background trick (`background: linear-gradient(bg) padding-box, linear-gradient(...) border-box; border: Npx solid transparent`) or `mask` composite; document as a limitation.
- Effort: M (parse + render + bar editor with stops; on-canvas handles another M). Risk: parsing authored gradients incl. hints, hard stops (same position twice), `calc()` positions; canvas-handle editing needs the element's box geometry.

### 6. Image fills (fill / fit / crop / tile, adjustments)
- Does: modes Fill, Fit, Crop (non-destructive, rotate freely), Tile (scale % of original); 90 degree rotation of the fill; sliders exposure, contrast, saturation, temperature, tint, highlights, shadows [8]. Cannot scale the image itself, only the object it fills [8].
- Reliance: high for mocks, but on HTML canvases images are normally `<img>` or `background-image: url()` already authored.
- Status: Out of scope in v1 (parity.md:93).
- CSS mapping: Fill = `background-size: cover; background-position: center`; Fit = `contain; no-repeat`; Tile = `background-repeat: repeat; background-size: <n>%`/px; Crop = explicit `background-size` + `background-position`. For `<img>`: `object-fit: cover|contain` + `object-position`. Adjustments partly map to `filter: brightness() contrast() saturate()`; exposure/temperature/tint/highlights/shadows have no CSS equivalent (`filter` would apply to the whole element, not just the fill; use a pseudo-element or skip).
- Effort: M for mode switch + position; adjustments L and low value. Risk: need asset URL/picker (file input -> where do we copy the file in the canvas folder?).

### 7. Strokes: position inside/outside/center, per-side weights, style
- Does: position inside/outside/center (shapes default inside) [3]; per-side weights on rectangles/frames (All/Top/Bottom/Left/Right/Custom, 0 removes a side) [3]; dash and gap lengths, custom dash arrays, caps, joins, multiple stroke fills (all share position/weight/style) [3]. Weight is not part of the layer's displayed dimensions [3].
- Reliance: high (borders and outlines everywhere).
- Status: Partial. Colour + one width (`style.section.tsx:38-45`, parity.md:85 "no border style, no per-side borders").
- CSS mapping:
  - Per side: `border-top/right/bottom/left-width|-style|-color`, with `box-sizing: border-box` (check what the element uses).
  - Style: `border-style: solid|dashed|dotted|double|none`. CSS dashes are browser-fixed, not Figma-style custom arrays; dash length/gap needs SVG or `repeating-linear-gradient` borders: not worth it.
  - Position: CSS `border` is "inside" the box under `border-box` (= Figma "inside" without changing outer size). "Outside" = `outline: Npx solid c; outline-offset: 0` (follows border-radius in current browsers) or `box-shadow: 0 0 0 Npx c`; "center" = outline with negative offset half the width, or a border plus compensated padding. Community mapping recommends exactly these [15]. Inside via `box-shadow: inset 0 0 0 Npx c` is the other pattern (doesn't affect layout) [15].
  - Multiple strokes: a stack of `box-shadow ... 0 0 0 Npx` rings or outline + border.
- Effort: S (style + per-side + colour per side), M (position toggle with layout-aware rewrite). Risk: `outline` and `box-shadow` strokes are not layout-affecting, while `border` is, so switching position changes layout; Figma users expect stroke weight to not move siblings in some modes, so surface that in the UI; per-side + radius edge cases; overlap with the shadow list (box-shadow ring is also a shadow row).

### 8. Per-corner radius and corner smoothing
- Does: "Independent corners" toggle exposes four radius fields (and variables); alt-drag on canvas handles; smoothing slider applies to the whole shape, iOS preset 60% [6]. Not in Dev Mode / CSS handoff [17].
- Reliance: medium-high (radius universal, independent corners moderate, smoothing niche).
- Status: Missing (one `border-radius`, `style.section.tsx:28`, parity.md:84, :195).
- CSS mapping: `border-radius: tl tr br bl` (or the four longhands `border-top-left-radius` etc.), eight values with `/` for elliptical, keep authored unit (rem, %). Smoothing: `corner-shape: squircle` (= `superellipse(2)`), only changes shape inside the radius, limited availability so wrap in `@supports (corner-shape: squircle)` [9]; Figma's 60% is a different curve, so map to a few presets rather than a slider.
- Effort: S (four fields + link toggle), S (squircle toggle). Risk: `@supports` write goes into `<helmet><style>`, new rule creation is a v1 limit (check); shorthand with `/` must round trip.

### 9. Shadows: add/edit/inset/reorder, spread, drop vs inner
- Does: up to 8 drop and 8 inner shadows per layer; each has x, y, blur, spread, colour+opacity; drop spread works only on rectangles, ellipses, frames; "show behind transparent areas"; reorder by drag; effect blend modes [4,7]. Framer has drop and inner shadow with spread too [16].
- Reliance: very high.
- Status: Partial. Lists and removes only (`style.section.tsx:47-70`, parity.md:86, :195).
- CSS mapping: `box-shadow: [inset] x y blur spread color, ...`; reorder = reorder comma items; Figma blur radius = CSS blur radius (same meaning, CSS blur 2x std-dev; Figma's "blur" matches CSS numerically in practice but verify). Non-rect shape (`<svg>`, text, `img` with alpha) needs `filter: drop-shadow(x y blur color)` (no spread, no inset). "Show behind transparent areas" has no CSS equivalent: `box-shadow` is clipped inside the border box only for inset; outer `box-shadow` is already not drawn under the element's own box.
- Effort: S-M (rows with fields, `splitTopLevel` already exists). Risk: Figma inner-shadow offsets measure from the outer edge while CSS inset starts at the padding box, so with a border, offsets differ by the border width [15]; choose CSS semantics and label them.

### 10. Layer blur and background blur
- Does: one layer blur and one background blur per layer (uniform or progressive); background blur requires fill opacity strictly between 0.1% and 99.99% to be visible [4]. Also Noise, Texture, Glass effects [4].
- Reliance: medium (glassmorphism, blurs on overlays).
- Status: Not built (parity.md:94).
- CSS mapping: layer blur = `filter: blur(Npx)` (shares the property with brightness/drop-shadow; edit only the `blur()` function, preserve others); background blur = `backdrop-filter: blur(Npx)` (+ `-webkit-backdrop-filter` if already authored). Requires a transparent or partly transparent background; ancestors with opacity<1, filter, mask, mix-blend-mode become backdrop roots and neutralise the effect [13]. Progressive blur has no CSS equivalent (mask-image + stacked layers): skip.
- Effort: S. Risk: warn in UI when the element background is opaque, matching Figma's own constraint [4,13].

### 11. Layer opacity and blend modes
- Does: 19 blend modes; apply to a whole layer, or an individual fill, stroke, or effect; Pass through default for layers, Normal for fills/effects; one blend mode per layer/fill/effect [7].
- Reliance: medium (opacity: universal and already built; blend: niche but visible in marketing designs).
- Status: Opacity Built (`style.section.tsx:28`, parity.md:84). Blend modes Missing.
- CSS mapping: layer blend = `mix-blend-mode: <mode>`; fill blend = `background-blend-mode` comma list [12]; both share the `<blend-mode>` value set (normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity, plus-lighter) [12]. Figma's "Plus darker" has no CSS equivalent; "Pass through" = default behaviour without isolation; "Normal on a frame" ~ `isolation: isolate`.
- Effort: S (dropdown for `mix-blend-mode`). Risk: stacking-context side effects (opacity<1 and `isolation` create isolation groups).

## Recommended for v2 (ranked)
1. Editable shadow list (add, edit fields, inset toggle, spread, reorder) — shipped gap already ranked #7 in parity, high usage, parser exists — S-M
2. Per-corner radius (+ link toggle, keep unit) and optional `corner-shape: squircle` — parity gap, low risk — S
3. Real colour picker (square, hue/alpha, notation dropdown incl. oklch, authored format kept) — parity gap #4, most-touched control — M
4. Eyedropper reading computed colours from the canvas element (native EyeDropper as fallback) — cheap, pairs with picker — S
5. Stroke: border-style + per-side widths/colours + inside/outside/center position (border vs outline vs inset box-shadow) — Figma users expect these, current UI is one width — M
6. Gradient fills: linear/radial/conic with stop bar and angle; stops use picker and tokens — most-missed fill type, 3 of 4 types map cleanly — M
7. Layer blur and backdrop blur fields, `mix-blend-mode` dropdown, with "background must be transparent" warning — tiny, covers glassmorphism — S
8. Colour usage list (document/selection colours) with replace-all — bulk recolour and token adoption — M

## Not worth it
- Diamond gradient: no CSS primitive; only approximable with four-corner conic/linear compositing.
- Figma dash/gap arrays and dashed stroke caps: CSS `border-style: dashed` cannot set lengths; would need SVG or gradient hacks.
- Stroke caps, joins, miter angle, width profile, brush/dynamic strokes: vector-only; no HTML/CSS form for boxes [3].
- Progressive (variable) blur: no CSS property; needs mask stacks.
- Noise, Texture, Glass effects: no CSS equivalents (SVG filters only) [4].
- Image adjustments (exposure, temperature, tint, highlights, shadows): only brightness/contrast/saturate exist in `filter`, and they filter the whole element, not just the fill [8].
- Hidden fills/strokes as a toggled state: no CSS home; would need editor-side storage and would break byte-exact splicing.
- "Show behind transparent areas": no CSS meaning for `box-shadow`.
- Pass through vs Normal as a layer property: mostly implicit in CSS stacking; expose only if `isolation` is wanted.
- Corner smoothing slider at Figma's percentage values: Figma's curve is not CSS; and Figma itself omits it from Dev Mode [17]; presets via `corner-shape` suffice.
- Video and pattern fills: not core and no clean authored-HTML mapping.
