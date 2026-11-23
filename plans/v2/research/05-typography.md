# Typography

## Sources (fetched)
1. Figma Help, text properties (article 360039956634) — https://help.figma.com/hc/en-us/articles/360039956634 — 2026-11-23
2. Figma Help, adjust text dimensions and resizing — https://help.figma.com/hc/en-us/articles/27378154668951-Adjust-text-dimensions-and-resizing — 2026-11-23
3. Figma Help, text style breakpoints (Sites) — https://help.figma.com/hc/en-us/articles/31242838116119-Customize-a-text-style-for-multiple-breakpoints — 2026-11-23
4. MDN text-box-trim — https://developer.mozilla.org/en-US/docs/Web/CSS/text-box-trim — 2026-11-23
5. MDN line-clamp — https://developer.mozilla.org/en-US/docs/Web/CSS/line-clamp — 2026-11-23
6. MDN font-feature-settings — https://developer.mozilla.org/en-US/docs/Web/CSS/font-feature-settings — 2026-11-23
7. MDN text-wrap-style — https://developer.mozilla.org/en-US/docs/Web/CSS/text-wrap-style — 2026-11-23
8. Framer, variable fonts update — https://www.framer.com/updates/variable-fonts — 2026-11-23
Search-only (result snippets, pages NOT fetched; treated as weaker): [S1] Figma text-styles create/apply search summary (help.figma.com/hc/en-us/articles/360039957034); [S2] Figma lists search summary (help.figma.com/hc/en-us/articles/360040449773 + forum threads).
Internal: plans/v1/parity.md, plans/v1/research/03-properties-panel-tokens.md section 7 (already researched typography at a shallow level), src/ui/panels/sections/style.section.tsx.

## Current state (verified in src)
`style.section.tsx:128-136` has only: font-family (plain text field), font-weight (number field), font-size, line-height, letter-spacing, and a "Trim text box" toggle writing `text-box: trim-both cap alphabetic` with a CSS.supports check (`:5`, `:88`, `:101`). grep of `src/` finds no text-align, text-decoration, text-transform, text-wrap, line-clamp, white-space, font-style or font-feature code. Double-click in-place plaintext edit exists (parity.md:91).

## Figma features in this area

### 1. Text alignment (horizontal L/C/R/Justify; vertical T/M/B)
- Horizontal: left/center/right/justify. Vertical top/middle/bottom works only on Fixed-size layers [1].
- Reliance: very high; first thing used after size/weight.
- Status: **Missing** (parity.md:87 "No text-align").
- CSS: `text-align: left|center|right|justify` on the text element. Vertical: no CSS property on the text itself; needs the box to be `display:flex; flex-direction:column; justify-content:flex-start|center|flex-end` (or `display:grid; align-content`). Writing that changes the element's display, so offer only when the element is a leaf text box with fixed height, and show it as "vertical align" disabled otherwise (mirrors Figma's own restriction [1]).
- Effort: S (horizontal), M (vertical).
- Risk: setting display:flex on an element whose children are inline text/spans turns each child into a flex item and breaks inline flow; gate on "no element children".

### 2. Font picker (search, families, weights/styles, preview)
- Browse web, local and shared fonts; weights listed under the family; keyboard shortcuts step weight [1]. Framer adds Google Fonts / Fontshare / Variable categories [8].
- Reliance: very high.
- Status: **Partial** — free-text `font-family` and numeric weight (`style.section.tsx:128-129`); no search, preview, weight names, or Google Fonts loading.
- CSS: `font-family: "Inter", sans-serif` (keep authored fallback stack), `font-weight: 100..900`, `font-style: normal|italic`. If the family is not loaded, a Google Fonts `<link>` (css2) already lives in `<helmet>` (plans/v1/research/06-project-format.md:25); adding a family = splice a new family param into that link URL. Picker list sources: families already used in the canvas, `tokens.json` font tokens, a bundled Google Fonts catalogue (metadata only), `document.fonts`.
- Effort: M (combobox with search + "in this canvas" group + weight dropdown with names, italic toggle); L if it also edits the Google Fonts link.
- Risk: offline-font banner exists (App.tsx:75) so preview must degrade; local-font enumeration (`queryLocalFonts`) needs a permission prompt and is Chromium-only; do not offer local fonts since the artboard cannot rely on them on another machine.

### 3. Text styles (reusable bundles)
- A style bundles family, weight, size, line height, letter spacing, paragraph spacing etc.; text colour is separate; non-style properties stay editable after applying [S1][1]. In Figma Sites a style can vary font size/line height/letter spacing/paragraph spacing per breakpoint [3].
- Reliance: very high in design systems.
- Status: **Missing** as a feature (parity has token/class notes only; research/03 recommended "class rule as a style", not built). Tokens panel exists (`TokensPanel.tsx`) but not text-style bundles.
- CSS: a text style = a class rule `.text-h1 { font-family:…; font-size:…; font-weight:…; line-height:…; letter-spacing:… }` in `<helmet><style>`; applying = add class to element's `class` attribute and remove the equivalent inline declarations; creating = write a new rule; detach = copy declarations inline. Breakpoint variants = `@media` blocks inside the same rule set (note: breakpoint editing is out of scope in v1 plan Next).
- Effort: L (create from selection, picker with list of text classes, apply/detach, edit-style-updates-all, show "Style: .text-h1").
- Risk: specificity clashes between class and existing inline styles; need to strip overridden inline props or show them as "overrides". Partial-range application impossible without spans (see 11).

### 4. Line height, letter spacing, paragraph spacing, paragraph indent, list spacing
- Line height px or % (default Auto = font's built-in); letter spacing; paragraph spacing px; paragraph indent only with left alignment; list spacing px [1].
- Status: line height and letter spacing **Built** (`style.section.tsx:133-134`) but plain number fields: no unit/Auto switch. Paragraph spacing, indent, list spacing **Missing**.
- CSS: `line-height` (write unitless for %, per research/03:88; `normal` for Auto), `letter-spacing` (px or em; Figma tracking/1000 = em [1]), paragraph spacing = `margin-block` on `p` children (or `gap` if the container is flex column), `text-indent`, list spacing = `margin-block` on `li`.
- Effort: S (unit switcher Auto/px/% for line height; letter spacing px/%/em; indent), M (paragraph spacing, which targets children not the selected element).
- Risk: paragraph spacing semantics differ from Figma (one text layer with paragraphs vs DOM with `<p>` children); only show when the selection has `<p>` children.

### 5. Text resizing modes (auto width / auto height / fixed)
- Auto width grows horizontally, newline only on Enter; auto height wraps and grows vertically; fixed keeps both. Click-create = auto width, drag-create = fixed, manual resize = fixed. Set in Layout section [2][S1].
- Reliance: high; core to text handling.
- Status: **Partial** — layout.section has width/height sizing for frames (hug/fixed), but nothing text-specific; resize of text turns into fixed width/height implicitly.
- CSS: auto width = `width: max-content` (or `fit-content`) + `white-space: nowrap`; auto height = fixed `width` (or max-width) + `height: auto`, `white-space: normal`; fixed = both set, plus `overflow: hidden` optional. In a flex parent: hug/fill/fixed already mapped by layout section; the text-specific part is only `white-space`.
- Effort: S (a 3-way toggle composed from existing width/height writers + white-space).
- Risk: setting `white-space:nowrap` affects `\n` handling vs. Figma "newline on Enter" (use `white-space: pre` to keep authored line breaks).

### 6. Truncation and max lines
- Truncate hides overflow and adds an ellipsis; max lines requires truncation plus auto height/auto width (and Hug in auto layout) [1].
- Reliance: medium-high for cards/lists.
- Status: **Missing**.
- CSS: modern `line-clamp: N; overflow:hidden` is not Baseline [5]; safe form is `display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:N; overflow:hidden` (all three required together [5]). One line: `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`. Writing `display:-webkit-box` replaces flex/block display, so refuse when the element is an auto-layout container.
- Effort: S (toggle + N field; writes the 4-prop block, removes on toggle off).
- Risk: display conflict with flex; warn rather than silently rewrite.

### 7. Case and decoration
- Case: upper, lower, capitalize, small caps; non-destructive. Decoration: underline/strikethrough with style (solid/dotted/wavy), thickness, offset, skip-ink, colour [1].
- Reliance: medium-high (case/underline very common).
- Status: **Missing** (parity.md:87).
- CSS: `text-transform: uppercase|lowercase|capitalize|none`; small caps = `font-variant-caps: small-caps` (MDN advises `font-variant-caps` over `"smcp"` tag [6]); `text-decoration-line: underline|line-through`, `text-decoration-style: solid|dotted|wavy`, `text-decoration-thickness`, `text-underline-offset`, `text-decoration-skip-ink`, `text-decoration-color` (these decoration props are not re-verified in a fetched page this run; only the Figma side is cited [1]).
- Effort: S (icon segmented controls; a details popover for underline style/thickness/offset).
- Risk: `text-decoration` shorthand in authored CSS must be parsed to longhands before editing (shorthand rule in research/03:121).

### 8. Wrap style (Auto / Balance / Pretty)
- Auto fits as many words as possible; Balance evens line lengths (headlines); Pretty avoids single-word last lines (body) [1].
- Reliance: medium; growing since Figma shipped it.
- Status: **Missing**.
- CSS: `text-wrap-style: balance|pretty|stable` (or `text-wrap: balance|pretty`); Baseline 2024; balance applies only to <=6 lines in Chromium, <=10 in Firefox [7]. `stable` targets contenteditable [7] and is useful while the editor edits text in place.
- Effort: S (3-way segmented control).
- Risk: none; progressive enhancement. Show the line-limit hint.

### 9. Vertical trim (leading trim)
- Removes extra space above and below text so the box matches visible glyphs; does not change text measurements but can change parent size; Dev Mode shows `leading-trim: both` [1].
- Status: **Built** (toggle, `style.section.tsx:101`, parity.md:88). Gaps: only one preset (`trim-both cap alphabetic`) and the toggle is global; no edge choice (cap/ex/alphabetic, trim start/end).
- CSS: `text-box-trim: trim-both|trim-start|trim-end` + `text-box-edge: cap alphabetic` or `text`; `text-box` shorthand [4]. Baseline 2026 "newly available" per MDN [4].
- Effort: S for edge options (optional).
- Risk: older browsers; the CSS.supports check already covers it.

### 10. OpenType features and variable fonts
- Numbers: fractions, super/subscript, slashed zero, proportional/monospace, lining/old-style; stylistic sets, character variants, spacing; features depend on the font. Variable fonts get a Variable tab for weight, width, optical size, slant, custom axes [1]. Framer shows variable axes next to OpenType options and has a Variable category in its font picker [8].
- Reliance: low-medium overall, but tabular numbers and variable weight are common in dashboards/product UI.
- Status: **Missing**.
- CSS: prefer high-level `font-variant-numeric` (`tabular-nums`, `slashed-zero`, `diagonal-fractions`, `oldstyle-nums`), `font-variant-ligatures`, `font-variant-caps`, `font-variant-position` (sub/super), and only fall back to `font-feature-settings: "ss01", "tnum"` for features with no variant property [6]; axes via `font-variation-settings: "wght" 650, "wdth" 90` (or plain `font-weight`/`font-stretch` where possible) [6].
- Effort: M for a curated toggle set (tabular nums, slashed zero, fractions, ligatures off, small caps) with no font introspection; L for per-font feature discovery (needs parsing the font's GSUB via the loaded font file or Google Fonts axis metadata) and axis sliders.
- Risk: features are no-ops when the font lacks them and nothing in CSS reports that; don't show detected-feature UI unless font metadata is available.

### 11. Mixed styles inside one text layer and lists
- A style can be applied to part of a text layer; the Figma help notes mixed letter-spacing selections scale proportionally and mixed sup/sub use faux glyphs [1]. Lists: ordered/unordered, up to 5 indent levels, bullets not customisable, list spacing default 0 [S2 snippet, not fetched].
- Reliance: high for rich text (bold word in a paragraph, links), medium for lists.
- Status: **Missing** (research/03 deferred "partial-range spans"); in-place edit is plaintext-only and refuses text with inline children (parity.md:91).
- CSS/DOM: partial-range style = wrap the selection in `<span style="…">` (or `<strong>/<em>/<a>`); lists = `<ul>/<ol><li>` with `list-style-type`, `padding-inline-start`, `li` margin for spacing. Needs a rich-text edit mode with a splice that rewrites the element's inner HTML, which breaks the byte-exact, plaintext-only text-splice design.
- Effort: L (rich-text edit + span normalisation + selection model + safe splice, holes `{{…}}` refusal).
- Risk: highest in this area; contenteditable DOM output varies and challenges byte-exact diffs. Defer.

### 12. Case of font size scale / text-style tokens via variables
- Figma lets number variables drive size/line height/letter spacing/paragraph spacing (research/03:92). Equivalent: `font-size: var(--font-size-lg)`; tokens panel exists. Status: **Partial** (tokens built, binding of typography fields to tokens not verified — check `NumberField` token support before building). Effort S.

## Recommended for v2 (ranked)
1. Text alignment (horizontal L/C/R/Justify segmented control; vertical only on flex leaf boxes) — most-missed basic control, trivial CSS — S/M.
2. Case + decoration (`text-transform`, `text-decoration-*`, small caps) — common, pure CSS, no DOM change — S.
3. Line-height/letter-spacing unit switcher (Auto/px/%→unitless/em) plus text-indent — fixes the "plain number field" gap and avoids wrong units — S.
4. Text resizing 3-way toggle (auto width / auto height / fixed, writes width/height/white-space) — core text behaviour — S.
5. Font picker upgrade (searchable combobox: canvas fonts + token fonts + Google Fonts list, named weights, italic; link splice later) — second most visible gap — M (L with link edit).
6. Truncate + max lines (`-webkit-line-clamp` block, one-line ellipsis) with display-conflict warning — common for cards — S.
7. Wrap style Balance/Pretty (`text-wrap-style`) — cheap modern win — S.
8. Text styles as class rules (create/apply/detach/edit) — biggest design-system value but biggest scope — L.

## Not worth it
- Local font enumeration (`queryLocalFonts`): permission prompt, Chromium-only, breaks on other machines.
- Partial-range mixed styles and rich lists (item 11): breaks the plaintext-only byte-exact text splice; revisit after text styles. Ordered/unordered list bullets are not even customisable in Figma [S2].
- Per-font OpenType feature discovery and axis sliders (item 10, L part): needs font-file parsing; ship the curated toggles only.
- Breakpoint text styles [3]: depends on `@media` editing, out of scope in v1 plan Next; Figma limits it to Sites.
- Paragraph spacing for a single multi-paragraph text node: no CSS analog without `<p>` children; only expose when children exist.
- Scale tool font-size scaling [2]: Figma itself recommends editing font size instead.
- Underline details popover beyond style/thickness/offset: low value.
