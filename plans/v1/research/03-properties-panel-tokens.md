# 03 - Figma properties panel (inspector) and design tokens -> real CSS

Scope: right-side Design panel, number inputs, Mixed values, color picker, Styles, Variables, text, Dev Mode CSS. Every claim cites a URL actually fetched with WebFetch (see Sources). Claims marked (search-snippet) came only from a WebSearch result and were NOT fetched; treat them as unverified.

Conventions: "rule write" = edit the matching CSS rule in the source file; "inline" = style="" attribute on the element; "token" = custom property in :root (or a theme scope).

## 0. Core architecture decision: where does an edit get written?

Figma has one model (layer property). We have three possible write targets. Proposed policy, in priority order:
1. If the selected element's property is currently authored as `var(--x)` in some rule: edit the token only if the user chose "edit token"; otherwise write a new raw value / different var on the element's own rule (the Figma equivalent of "detach"). Ask explicitly; never silently change a token used elsewhere (Figma styles apply edits to every user at once: S-styles).
2. Else, if the element has a class rule that is "its own" (single-use class or id selector): write to that rule.
3. Else (utility/shared class, tag selector, or no rule): write inline `style=""` OR create a new class. Default recommendation: a new generated class/rule next to the shared one, because inline styles outrank everything and make later token edits silently ineffective.
The panel must always show a "Source" affordance: which rule/file:line the value comes from (mirrors Dev Mode's variable chips: S-devmode-inspect).

Pitfall common to everything below: Figma shows one resolved value; CSS has authored value, cascaded winner, and computed value (px, rgb()). Read authored text from the stylesheet AST (for display and round-trip), read `getComputedStyle` only to show what the browser renders and to resolve `auto`/%/inherited. Writing back a computed value (e.g. `rgb(…)` or `16px` for `1rem`) destroys author intent.

## 1. Panel layout (section order)

What Figma does: With a layer selected the Design tab holds Position (alignment, rotation, position), Layout (frame size, constraints, auto layout, layout guides), Appearance (blend mode, corner radius, opacity), Fill, Stroke, Effects, Typography, plus component/instance and export (S-panel). Nothing selected shows local styles/variables and canvas background (S-panel). UI3 put component controls (variants/instances) above color/size attributes; merged width/height and auto layout into a single Layout section "to better match how products are built in code"; kept x/y above w/h to protect muscle memory; property labels are optional; panel is resizable (S-ui3). Edit-access users get Design + Prototype tabs, viewers Comment + Properties (S-panel).

CSS mapping (v1 panel sections):
- Position: `position`, `top/right/bottom/left`, `transform: translate/rotate`, `z-index`. For flow elements there is no x/y: show x/y only for `position:absolute|fixed|sticky` (or items inside a flex/grid parent show "controlled by parent"). Dragging on canvas of a static element = reorder or convert to absolute; ask.
- Layout: `display`, `flex-direction`, `gap`, `align-items`, `justify-content`, `padding`, `width/height/min/max`, `box-sizing`, `overflow`. This maps well to Figma's merged "Layout" section since CSS has no x/y/w/h separation either.
- Appearance: `opacity`, `border-radius`, `mix-blend-mode`.
- Fill: `background-color` / `background-image` (gradients), text color = `color`.
- Stroke: `border`, `outline`, or `box-shadow: inset 0 0 0 Npx` (see pitfalls).
- Effects: `box-shadow`, `text-shadow`, `filter: blur()`, `backdrop-filter: blur()`.
- Typography: `font-family/size/weight/line-height/letter-spacing/text-align/text-decoration/text-transform`.
Priority: MUST (all sections above except where noted below). Order: copy Figma's (Position, Layout, Appearance, Fill, Stroke, Effects, Typography) but put a "Selector / Source" header on top.
Pitfalls: shorthand properties (padding, border, border-radius, background, font, margin, inset) - see section 10.

## 2. Number inputs: scrub, math, units

What Figma does: Typography units are px for size, px/%/Auto for line height (S-text). Scrub: hold Option/Alt over a numeric field to get a scrub cursor, drag changes value; cursor toward top of screen is faster, bottom slower (search-snippet, forum answer, not fetched). Math: operators like -20, *4, /8 are typed after the number (search-snippet, forum quoting Help Center, not fetched; the forum thread itself returned 403 on fetch). Opacity % next to hex is type-only because scrub interfered with neighbouring fields (search-snippet). Number variables used for opacity clamp to 0-100 (S-vars-overview). Arrow keys with Shift for 10x step is standard Figma behaviour but I did not fetch a source; verify before copying.

Implementation:
- Parse input with a tiny safe expression evaluator (numbers, + - * /, parentheses, a unit suffix). Evaluate relative to the current numeric value: `+10`, `*2`, `/2`. Never `eval`.
- Preserve the authored unit. If authored `1.5rem` and user types `+0.25`, write `1.75rem`. If user types `24px` into an `rem` field, accept and write `24px` (switch unit). Provide a small unit dropdown (px, rem, em, %, auto, unset) per field; this is the CSS analog of Figma's px/%/Auto line-height.
- Scrub: pointer-lock drag on the label (Figma-style) with Shift = 10x, Alt = 0.1x. Round to sensible precision (0.01 for rem/em/unitless, integer for px unless Alt).
- `auto`, `normal`, `inherit` and keywords: field shows the keyword; scrubbing from a keyword starts from the computed value.
- Write on every input event live to the DOM (style override via a preview layer), commit to source on pointer-up/Enter, one undo entry per gesture.
Priority: MUST (typed values, arrow-key step, unit preserve); SHOULD (scrub drag, math expressions); LATER (%-of-parent expressions like `100%-100`: (search-snippet) users report this form works with multiple frames selected, plain `-100` does not).
Pitfalls: (a) computed px vs authored rem/em/% - always compute deltas in the authored unit; (b) `width: 50%` plus scrub in px silently changes meaning - keep unit; (c) unitless properties (`line-height: 1.4`, `opacity`, `z-index`, `flex-grow`) must not get `px` appended; a token exporter that appends px to every number is a documented bug source (S-tokens-bridge); (d) `calc()`/`clamp()` authored values are not numbers: show as read-only chip "expression" with an edit-as-text box.

## 3. Mixed values and multi-select

What Figma does: with a mixed selection the Fill area becomes "Selection colors", listing each distinct solid/gradient fill once, grouped by variable, style, and normal fill; clicking a normal fill opens the picker, clicking a style/variable opens the libraries picker with a Detach button; target icon selects all layers using that colour (S-selection-colors). Number fields show "Mixed" and editing sets all (search-snippet: a 2021 forum note says math on a mixed value works).

Implementation: for N selected elements compare the *authored/cascaded value* per property; equal -> show it, different -> "Mixed" placeholder. Typing a value writes it to each element's own target rule (policy in section 0). Relative expressions (`+10`) apply per element against each one's own value. "Selection colors" analog: scan the project's CSS for distinct colour literals and var(--x) references used by the selection; edit one -> rewrite every declaration that used it (scoped to selection by default; "all in project" as explicit option).
Priority: SHOULD for basic Mixed; LATER for Selection-colors/global replace (but it is the single best bulk-edit feature for a CSS source of truth).
Pitfalls: two elements sharing one class are one rule - writing "to each" collapses to one write; detect and de-dup. Writing to a shared rule changes unselected elements: show "affects N other elements" warning (class-usage count).

## 4. Color picker and fills

What Figma does: click fill swatch; solid, gradients, patterns, images, video; models RGB, HEX, CSS, HSL, HSB switchable; hue and opacity sliders; eyedropper samples canvas layers; blend mode; choose from styles/variables or "+" to create one; built-in WCAG AA/AAA contrast checker with auto-fix to nearest compliant colour (S-picker). Switching model only changes display, not rendering (search-snippet). Eyedropper can sample variables/styles too; Tab switches model while sampling (search-snippet).

Implementation:
- Solid: write `background-color` (or `color` for text, `border-color` for strokes). Preserve the authored colour *format*: if source was `#1a73e8` write hex (8-digit `#rrggbbaa` when alpha < 1, or `rgb(r g b / a)`); if source was `hsl(...)` write hsl; if `oklch(...)` write oklch. Display model is a UI choice independent of the written format; add a setting "write as: keep authored / hex / hsl".
- Opacity of a fill is alpha in the colour, NOT the `opacity` property (which fades children/borders too). Keep these two controls separate and labelled (Figma has both: fill opacity vs layer opacity).
- Eyedropper: use the browser `EyeDropper` API (Chromium) - picks screen pixels, so result is a computed rendered colour, not a token. If the sampled pixel exactly matches a known token's value, offer to write `var(--token)`. Sampling through the DOM instead (computed colour of the element under cursor) is the way to "sample a variable" - resolve which custom property the declaration used via the stylesheet AST.
- Gradients: parse `linear-gradient/radial-gradient/conic-gradient` into stops (position, colour, angle) and write back the whole `background-image` value. Multiple backgrounds are comma-separated layers = Figma's multiple fills (top layer first in CSS; Figma lists top first too, but verify). Solid colour over gradient needs `background-image` layer + `background-color`, or a `linear-gradient(c,c)` layer.
- Image fills: `background-image: url()`, `background-size` (fill/fit/tile -> cover/contain/repeat), `background-position`.
- Contrast checker: cheap to compute WCAG ratio of `color` vs nearest resolved background ancestor; SHOULD.
Priority: MUST solid colour (hex/hsl/opacity), SHOULD gradients + eyedropper + contrast badge, LATER image/video fills.
Pitfalls: the effective background may come from an ancestor; `background` shorthand resets sibling longhands (background-image, size, repeat) - when editing colour inside a shorthand `background: url() no-repeat #fff`, patch just the colour token in the shorthand or expand to longhands (see section 10); `currentColor` and `transparent` must remain expressible; wide-gamut/oklch round-trip through hex loses data; `color-mix()`/relative colour syntax is read-only.

## 5. Stroke

What Figma does: colour, weight, position (inside/outside/center; default Inside for shapes, Center for lines), per-side strokes on rectangles/frames/components; SVG export only supports center strokes so inside/outside get simplified (search-snippet from a mirror page; not fetched).
CSS: `border` (inside the border-box by default - matches Figma "Inside" only if `box-sizing:border-box`), `outline` + `outline-offset` (outside, does not affect layout; negative offset = inside), `box-shadow: 0 0 0 Npx c` (outside, follows radius), `box-shadow: inset 0 0 0 Npx c`. Default write: `border-width/style/color` longhands. Per-side = `border-top-width` etc. Offer "Outside" as outline (no layout shift).
Priority: MUST border (all sides, width/style/colour), SHOULD per-side, LATER inside/outside/center choice.
Pitfall: changing border width on `content-box` elements shifts layout; border-style:none with a width set renders nothing (set style solid when user adds a stroke).

## 6. Effects (shadows, blurs)

What Figma does: drop shadow (behind) and inner shadow; each has X, Y, Blur, Spread, Fill (colour+opacity). Blur types: layer blur and background blur, each Uniform or Progressive; up to 8 drop + 8 inner shadows, only one layer/background blur per layer; effects can be reordered by dragging handles; spread only for rectangles/ellipses/frames/components; background blur needs fill opacity 0.10%-99.99% to show (S-effects).
CSS: drop shadow = `box-shadow: x y blur spread color`, inner = `inset`, a comma list in order (first = top-most), so reorder = reorder list items. Layer blur = `filter: blur(Npx)`; background blur = `backdrop-filter: blur(Npx)` (needs a semi-transparent background to be visible: same constraint as Figma). Text uses `text-shadow` (no spread, no inset); transparent PNG/SVG shapes want `filter: drop-shadow()` which differs from box-shadow (follows alpha) - Figma's "show behind transparent areas" toggle maps to this choice.
Priority: MUST box-shadow list editor (add/remove/reorder, x y blur spread colour, inset toggle); SHOULD filter blur + backdrop-filter; LATER text-shadow, progressive blur (no direct CSS equivalent; mask-image + backdrop-filter hack).
Pitfalls: `filter` is a single property holding a function list (blur, brightness, drop-shadow...): editing blur must preserve other functions - parse and patch by function name; `backdrop-filter` needs the `-webkit-` prefix in older Safari; box-shadow colour tokens: `0 4px 8px var(--shadow)` is valid, so allow colour slot = var().

## 7. Typography and text editing on canvas

What Figma does: Typography section: font family, weight, size (px), line height (Auto / px / %), letter spacing, horizontal align (left/center/right/justify), vertical align (only for fixed-size boxes), decoration (underline/strikethrough with style, thickness, offset, skip-ink, colour), case (upper/lower/capitalize/small caps), a Details panel with paragraph indent, paragraph spacing, list spacing, truncation + max lines, wrap style (Auto/Balance/Pretty), OpenType features; text resizing lives in Layout; Enter creates a new paragraph; double-click enters a text layer (S-text). Text styles bundle family/weight/size/line-height/letter-spacing/paragraph spacing/indent/decoration/case/lists/OpenType, excluding alignment, colour and resizing; a style can be applied to whole layer or part of one; properties outside the style stay editable (S-styles).

CSS mapping: `font-family, font-size, font-weight, line-height, letter-spacing, text-align, text-decoration(-line/-style/-thickness/-color), text-underline-offset, text-decoration-skip-ink, text-transform, font-variant-caps, text-indent, text-wrap: balance|pretty, line-clamp/-webkit-line-clamp + overflow, font-feature-settings, font-variation-settings`. Vertical align = flex/grid `align-items` on the box (not `vertical-align`). "Paragraph spacing" = `margin-block` on `p`.
Canvas text editing: double-click -> set `contenteditable="plaintext-only"` (or `true` for rich) on that element only; commit on blur/Esc; on commit diff innerHTML and patch ONLY the text nodes in the source HTML (do not reserialise the whole file). Partial-range styling (Figma applies a style to part of a layer) = wrap the selection in `<span>`; SHOULD be LATER because it mutates DOM structure.
Priority: MUST family/size/weight/line-height/letter-spacing/align/colour + double-click text edit; SHOULD decoration, transform, wrap, line clamp; LATER OpenType, variable-font axes, partial-range spans.
Pitfalls: line-height unitless vs px vs %: Figma % maps to unitless multiplier (150% = 1.5) - write unitless, because % in CSS line-height is relative to the element's own font-size and inherits as a fixed computed length (children don't rescale); `font-size` in rem must stay rem; `font` shorthand resets line-height and family; contenteditable inserts `<div>`/`<br>` on Enter in some browsers - normalise; whitespace collapse means source text indent differs from rendered text; font-weight must be a valid number or keyword for the face (Dev Mode itself falls back to 400 for an unmatched string: S-devmode-inspect).

## 8. Styles vs Variables -> what is the CSS equivalent?

Figma facts: Styles (colour, text, effect, grid) are reusable bundles; editing a local style updates every layer using it immediately; published styles propagate via libraries, subscribed files must accept (S-styles; the fetched page only describes text styles in detail, colour/effect/grid are "mentioned in passing"). Variables are reusable values of types colour, number, string, boolean (also timing and easing) in collections, optionally grouped; a mode assigns one value per variable in the collection; applying a variable to a property makes the layer follow the active mode; up to 5,000 variables per collection (S-vars-overview). Variables can alias (reference) another variable of the same type (S-vars-guide, S-vars-overview). Scope restricts which properties can use a variable: number -> gap/padding, radius, font size/weight/line height/letter spacing/paragraph spacing & indent, opacity, effects, stroke, text content, width/height; colour -> effects, frame fill, shape fill, stroke, text fill; string -> font family, weight/style, text string; "Show in all" enables everything (S-vars-guide). Code syntax: one name per platform (Web, Android, iOS) per variable, shown in Dev Mode snippets (S-vars-guide).

CSS mapping:
- Colour/number/string variable = custom property `--name: value`.
- Styles: no native CSS "bundle", so closest are (a) a CSS class (`.text-h1 { font: ... }`) for text/effect styles and (b) a group of tokens. Recommendation: treat a *class rule used as a style* as the "Style" object; panel shows "Style: .text-h1" with detach (copy declarations onto element rule) and "edit style" (writes the class rule).
- Modes = a selector scope or media query that redefines the same custom properties (section 9).
- Alias = `--semantic: var(--primitive)`. Preserve aliasing: when listing a token show both its authored value (`var(--blue-500)`) and resolved colour swatch.
- Scope = hint only. CSS has no scoping, so implement as a UI filter (show colour tokens only in colour pickers), derived from naming convention (`--color-*`, `--space-*`, `--radius-*`, `--font-*`) or from `@property syntax` if present. Note that real exporters ignore scope (S-tokens-bridge).
- Typed tokens: optional `@property --x { syntax: "<color>"; inherits: true; initial-value: ... }` gives validation and predictable fallback (S-mdn).
Priority: MUST token picker for colour/length (list `--*` declared in `:root`, pick -> writes `var(--x)`; "detach" -> writes resolved value); SHOULD token create from selection ("+" in picker, S-picker), edit token value, rename (rewrites all `var(--old)`); LATER aliases UI, scope filters, `@property` typing, text-style class manager.

## 9. Modes (light/dark) -> CSS

Figma: modes are columns of values per variable; light/dark, languages, device sizes (S-vars-overview). Multiple modes require paid/Education plans (S-vars-guide).
How exporters map it (S-tokens-bridge, search-snippet for dev.to approach confirmed by fetched dev.to article for per-theme files): default mode -> `:root`; each non-default theme mode -> `[data-theme="dark"]`; modes named "dark" also get `@media (prefers-color-scheme: dark) { :root { ... } }`; breakpoint collections -> mobile-first `@media (min-width)`; other collections (brand) -> default mode only; cross-product modes need separate collections that compose via cascade. Alternative from a plugin (search-snippet only): `light-dark(a, b)` with `color-scheme: light dark` on :root.
Editor design: detect existing convention in the project (look for `[data-theme]`, `.dark`, `@media (prefers-color-scheme)`, `light-dark()`); show a "Mode" switcher that (a) sets the attribute/class on `<html>` in the preview, or (b) forces colour-scheme via emulation. Editing a token while mode = dark writes into the dark scope's declaration, not `:root`. If the project has no mode scopes, hide the switcher (v1) - do not invent a theming system.
Priority: LATER (MUST only if the Claude Design projects actually use dark mode; add a detector early because it affects where token edits land).
Pitfalls: a token overridden in a mode block must be edited there; if a token exists only in `:root`, editing under dark mode would create a new override - ask; `light-dark()` embeds both values in one declaration so you must patch the correct argument; custom properties inherit, so a `data-theme` on a subtree creates local theming (nested modes, which Figma also supports by setting mode on a frame, unverified).

## 10. When to write var(--token) vs a raw value; shorthands; cascade

Rules:
- Property currently authored as `var(--x)` and user edits via a token picker -> keep var. User types a raw value into a field showing a token chip -> replace with raw value on that element's rule only (detach). Never rewrite `:root` unless user clicked "Edit token".
- Creating a token from a value: add `--name: value` to `:root` (or the mode scope), replace that one declaration with `var(--name)`; offer "replace all N matches" (Selection-colors analog).
- Fallbacks: Dev Mode emits `var(--Thin-100, 100)` i.e. token with raw fallback (S-devmode-inspect); only write fallback when the token might be undefined (e.g. component used outside `:root` scope). MDN: everything after the first comma is the fallback, so `var(--x, red, blue)` falls back to `red, blue` - quote carefully (S-mdn).
- Invalid substitution: custom properties accept any value; error appears only at computed-value time and the property silently becomes inherited/initial (S-mdn). So after writing `var(--x)` always read back computed style; if it equals initial/inherited unexpectedly show a "token invalid for this property" warning.
- Cascade/specificity: edit the declaration that actually wins. Compute with `getMatchedCSSRules`-style walk (iterate `document.styleSheets`, `matches(selector)`, compare specificity + order + `!important` + layer). If the winning rule is in a different file/`@media`/`@layer`, write there. If the user's edit would be overridden by a more specific rule, either edit that rule or bump by adding to the element's own selector; show a "overridden by" notice.
- Media queries: panel edits apply to the "current breakpoint" (a viewport width selector). Writes go inside the matching `@media` block of the rule; add one if absent. v1: base styles only, show a clear "editing base / editing @media (max-width: ...)" badge.
- Pseudo-states (`:hover`, `:focus`): state switcher that forces state and writes to the `:hover` rule.
- Shorthands: do not rewrite a shorthand wholesale from one longhand edit. Strategy: parse shorthand into longhands, change one, re-emit shortest valid form; or if the rule authored longhands, patch the longhand. Particularly `padding/margin/inset/border-radius` (1-4 value forms: expand then collapse), `border` (width style color), `background` (resets all background longhands; keep layers), `font` (resets line-height/family/etc), `transition`, `grid-template`, `flex`. Preserve declaration order, comments, and `!important`. Use a CST-preserving parser (postcss, css-tree with positions, or recast-like patching) and splice exact byte ranges instead of reserialising the stylesheet.
- Inline styles: if the element already has `style="..."` and the property is set there, edit there (it wins). Otherwise do not add inline unless the element has no class and rule creation is not possible.
Priority: MUST (winning-declaration detection, shorthand-safe patching, byte-range splice); SHOULD media/state targets; everything here is correctness-critical for "every change is written to the real source".

## 11. Dev Mode CSS view -> our "CSS" tab

What Figma does: Inspect panel shows styles/variables applied; toggle Code (default) / List; autogenerated snippet per layer; language dropdown with CSS settings such as unit of measure; clicking a value in List view copies it; Code Connect substitutes real component code; codegen plugins (Tailwind, React) (S-devmode-guide). Variable references appear in CSS where possible (`font-weight: var(--Thin-100, 100);`), string variables output plain values, names are normalised to valid CSS (`🔵 Blue 0000FF` -> `--blue-0000FF`), and the Variable details modal shows a usage snippet (S-devmode-inspect). Variable code syntax lets designers set the exact name per platform (S-vars-guide). Figma's own variable->CSS name rule in third-party tooling: lowercased, `/` and spaces -> `-`, collection name not a prefix (S-tokens-bridge, third-party, not official).

For us the CSS output is the source: show a read-only-ish "CSS" tab that is simply the matched rule(s) text, with file:line, and make it editable (textarea writes back through the same patcher). Highlights: authored vs computed toggle ("Computed" tab like browser devtools), token chips with resolved swatch, copy-on-click. Because the DOM/CSS is the document, no code generation is needed - the value is trust: the user sees exactly the text that will be written.
Priority: SHOULD (showing the rule text + file:line is cheap and builds trust; editing it as raw CSS is a good escape hatch); LATER computed tab and unit toggle (px<->rem).

## 12. Misc UI details worth copying

- Property labels toggle and resizable panel (S-ui3): MUST-lite (panel resize SHOULD).
- Press Tab to cycle colour models, eyedropper shortcut `I` (search-snippet).
- "Nothing selected" state shows project-level things (tokens list, page background) (S-panel): map to body/`:root` + token manager. SHOULD.
- Contrast warning icon (S-picker): SHOULD.
- Effects limits (8 shadows, one blur) are Figma-isms; do not impose in CSS.

## Priority summary
MUST v1: panel sections with source/selector header; winning-declaration detection and byte-range patching; number input with typed math-free values + unit preservation + arrow step; solid colour picker with hex/HSL + alpha preserving authored format; token picker (list `:root --*`, write var(), detach on raw override); text props + double-click text edit; border/radius/opacity; box-shadow list editor; shorthand-safe writes; inline-vs-rule policy.
SHOULD: scrub drag and expression math; Mixed on multi-select; gradients; eyedropper; contrast badge; create/edit/rename token; blur/backdrop-filter; media-query and pseudo-state targets; CSS tab with file:line.
LATER: modes/themes switcher, aliases and scope UI, Selection-colors global replace, image fills, partial-range text spans, OpenType/variable-font, `@property` typing, progressive blur.

## Sources (fetched)
- S-panel: https://help.figma.com/hc/en-us/articles/360039832014-Explore-the-properties-panel
- S-vars-guide: https://help.figma.com/hc/articles/15145852043927 (Create and manage variables: types, scoping, code syntax, aliases, modes)
- S-vars-overview: https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes
- (overview) https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma
- S-picker: https://help.figma.com/hc/en-us/articles/360041003774-Apply-paints-with-the-color-picker
- S-selection-colors: https://help.figma.com/hc/en-us/articles/360042553434
- S-styles: https://help.figma.com/hc/en-us/articles/360039957034-Apply-styles
- S-effects: https://help.figma.com/hc/en-us/articles/360041488473
- S-text: https://help.figma.com/hc/en-us/articles/360039956634
- S-devmode-guide: https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode
- S-devmode-inspect: https://help.figma.com/hc/en-us/articles/27882809912471
- S-ui3: https://www.figma.com/blog/behind-our-redesign-ui3/
- S-tokens-bridge: https://cdn.jsdelivr.net/npm/figma-code-agent@1.0.2/knowledge/design-tokens-variables.md (third-party)
- dev.to article: https://dev.to/alexandersstudi/export-figma-variables-to-css-custom-properties-using-style-dictionary-3pjh (third-party)
- S-mdn: https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties
- Fetched but low value: https://help.figma.com/hc/en-us/articles/360039956434-Apply-effects-to-layers (text/stroke only)

## Search-snippet only (not fetched; unverified)
- Scrub with Option/Alt, math operators, `100%-100`: https://forum.figma.com/t/using-expression-as-a-variables-value/45743/32 (403 on fetch), https://forum.figma.com/archive-21/improve-mathematical-computations-in-the-width-and-height-fields-36040
- Opacity percent type-only: https://forum.figma.com/report-a-problem-6/bug-scrub-drag-percentage-opacity-values-broken-58377
- Stroke placement / per-side: https://figma-signup.helpjuice.com/additional-properties/apply-and-adjust-stroke-properties
- Eyedropper details: https://figma-signup.helpjuice.com/color-gradients-and-images/sample-colors-with-the-eyedropper-tool
- light-dark() plugin approach: https://kolibri-sync.gitbook.io/kolibri-sync/4.-solution/4.5-exporting-from-figma-to-css-cf003
