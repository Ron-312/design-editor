# Components, styles and variables

Fetched 2026-11-23. Figma/Penpot claims cite [n]. Mapping and effort are my own inference. Webflow and Framer help pages returned 403/404/parse errors, so they are NOT cited; Penpot is the comparable tool used.
Canvas format: `plans/v1/research/06-project-format.md` (stand-in, not live-verified): inline `style` is the main authoring surface, `<helmet><style>` for rules, `ds/core/tokens.json` nested `{value}` leaves, `<dc-import src>`, `<sc-for>`/`<sc-if>`, `{{holes}}` read-only.

## Sources (fetched)
1. Guide to variables in Figma — https://help.figma.com/hc/en-us/articles/15145852043927-Guide-to-variables-in-Figma — 2026-11-23
2. Modes for variables — https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables — 2026-11-23
3. Apply variables to designs — https://help.figma.com/hc/en-us/articles/15343107263511-Apply-variables-to-designs — 2026-11-23
4. Detach an instance from the component — https://help.figma.com/hc/en-us/articles/360038665754-Detach-an-instance-from-the-component — 2026-11-23
5. Explore component properties — https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties — 2026-11-23
6. Swap instances / overrides (help article 360039150733) — https://help.figma.com/hc/en-us/articles/360039150733 — 2026-11-23
7. Styles in Figma — https://help.figma.com/hc/en-us/articles/360039238753 — 2026-11-23
8. Guide to components in Figma — https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma — 2026-11-23
9. Penpot design tokens user guide — https://help.penpot.app/user-guide/design-tokens/ — 2026-11-23
10. Penpot: developer's guide to design tokens and CSS variables — https://penpot.app/blog/the-developers-guide-to-design-tokens-and-css-variables/ — 2026-11-23
Failed (not used): create-and-manage-variables (404), webflow-way variables (parse error), Webflow help (403), Framer help (404).
Repo checked: `src/ui/panels/fields.tsx:300-345`, `TokensPanel.tsx:10`, `src/server/editor-services.ts:62-95`, `parity.md` Tokens/Structure rows.

## Figma features in this area

### 1. Apply a variable to a field (picker, pill, detach)
- Colour variables apply to fills, strokes, shadow colours; number variables to size, gap, padding, radius, opacity, type metrics, stroke weight; string to font family/weight/text; detach via a hover icon, clearing a number field detaches [3].
- Heavy use: the main way design-system files are used.
- Status: **Built** for colour and number fields: `fields.tsx:331` picker, `:318-322` pill, raw value detaches (parity Tokens rows). Gap: write form for `tokens.json` is the literal value, not a reference (`fields.tsx:300-335`, `tokenValue`), so binding is lost on write. Number tokens in non-colour fields unverified.
- Mapping: `var(--x)` in the property value (inline or rule). Token picker filtered by scope (below).
- Effort S (scopes) · Risk: whether the real runtime/Theme menu accepts `var()` from `tokens.json` is an open M0 question.

### 2. Variable scopes
- Each variable restricts where it can be applied (colour: frame/shape/text fill, stroke, effects; number: gap, padding, radius, font, opacity, size...; string: family, weight, text) [1].
- Keeps pickers short. Status: **Missing**; picker shows every token on every field (`fields.tsx:331`).
- Mapping: infer scope from the token's value and path (`color.*`, `space.*`) or a `$type`/`scope` key in tokens.json; filter the picker per CSS property. No file writes.
- Effort S.

### 3. Token create / edit / rename / alias
- Collections, groups, aliases to another variable of the same type, edit once to update all users, rename [1]. Penpot: aliases `{dimension.small}`, rename offers to remap references [9].
- Status: **Missing** (parity: "Edit token" Not built; `tokens.json` read-only; tokens panel is list-only, `TokensPanel.tsx:10`).
- Mapping: edit leaf `value` in `tokens.json` (the file is a second write target, a second undo entry); alias = value `{path}` in token data and `var(--a)` in CSS [10]; rename = rewrite every `var(--old)` in `.dc.html` files (grep + splice) plus the key. For `:root --*` canvases, edit the declaration in `<helmet><style>`.
- Effort M (L with rename). Risk: tokens.json belongs to the design system and `edsync` push may or may not carry it; Design-system location after 2026-12-14 is unknown (06-project-format.md).

### 4. Create a variable from a selected value ("extract")
- Figma's docs fetched do not describe extraction; they mention the eyedropper creating variables [1]. I will not claim more.
- My proposal: right-click a colour/size field > "Make token" writes `--name: value` to `:root` and replaces the value with `var(--name)`; also bulk "extract all hardcoded colours" listing repeated literals in the canvas.
- Status: **Missing**. Effort M. Risk: naming UX; where to put new tokens (`:root` in `<helmet><style>` is safe; tokens.json is design-system-owned).

### 5. Modes (light/dark, themes)
- A collection has mode columns; a layer or page gets "Apply variable mode"; Auto = inherits nearest ancestor's mode, else default; explicit modes stay fixed [2]. Penpot themes/sets: one active option per group, lower set overrides same-named tokens [9].
- Parity says Light/dark modes are a Non-goal.
- Mapping (strong, since CSS already models it): mode = `[data-theme="dark"] { --color-bg: ...}` override block in `<helmet><style>`; nested modes = the attribute on any ancestor, inheritance is native CSS cascade [10]. "Apply mode" = write `data-theme="x"` on the selected element; viewing a mode on the whole board = editor-side toggle that sets the attribute on the artboard root at serve time (like hide, `serve-transform.ts:56`), not a source write.
- Editing a token value while a mode is active writes into that mode's block.
- Effort M-L (read modes; preview switch S; editing in mode M). Risk: mode block selector convention is unspecified on Claude Design canvases; `tokens.json` has no mode concept in its documented shape (`{value}` leaves) so modes would exist only in `:root`/`[data-*]` CSS.

### 6. Local styles (colour / text / effect)
- Reusable bundles; change one, all users update; text style = family, size, line-height, letter-spacing; effect style holds multiple shadows/blurs; styles can hold variables, but not vice versa [7][1].
- Status: **Missing**. The nearest built thing is copy/paste style (`style-clipboard.actions.ts:12-45`).
- Mapping: a style = a CSS class in `<helmet><style>` (`.t-heading { font: ...}`); apply = add the class to `class`; "create style from selection" = hoist the element's inline declarations (text group or shadow) into a new rule and add the class, removing the hoisted inline props; edit style = edit the rule via the existing rule-picker (parity: selector chip picks a `<helmet>` rule, built); detach = copy rule declarations back inline and drop the class. Already-built overridden-by check covers specificity.
- Effort M. Risk: shared-class warning is only Partial in v1 (parity row, "Picking a shared rule gives no warning"); style editing must show "affects N elements" first. Classes with `{{hole}}` or in `<sc-for>` multiply the blast radius.

### 7. Components, main component and instances
- A main component defines properties; instances are linked copies that update with it [8].
- Parity: Out of scope ("Components/variants").
- Mapping: Claude Design canvases already have a component notion: `<dc-import src="./card.dc.html">` mounts a file's `<x-dc>` children inside the element (assumed, 06-project-format.md). So main = the imported `.dc.html`, instance = each `<dc-import>`; "Go to main" = open that file as a board; "edit main" = edits splice into the imported file and every instance updates (the iframe sees them). Within one file, repeated content is `<sc-for>`.
- Status: layers show `dc-import` as a leaf (parity). Effort M for "Go to main + show instance count"; L for creating a component (extract subtree to a new `.dc.html`, replace with `<dc-import>`, add to `canvas.json`... which the editor never writes).
- Risk: unverified runtime behaviour, scoping of CSS between files, and props passing (`data-props` only on root).

### 8. Instance overrides, reset, push to main
- Overrides preserved on swap when layer names match; Reset one/all; "Push changes to main component" only for same-file main [6].
- Mapping: override = inline style/attribute on a node inside the imported subtree, but the instance's inner DOM belongs to another file, so v1 write-back cannot target it with per-instance identity. Only per-instance props via `data-props` (JSON attr) or `{{holes}}` are real overrides. Reset = delete that attr; push-to-main = splice into the imported file.
- Status: **Missing**. Effort L. Risk: high; defer.

### 9. Component properties (boolean, text, instance swap, variant, slot)
- Boolean toggles layer visibility, text exposes content, instance swap picks nested component with preferred list, variant = set of variations, slot = free content area [5].
- Mapping: boolean = `<sc-if when="{{flag}}">`; text = `{{hole}}`; variant = class or attribute toggle (`data-variant="primary"`), written to the instance; instance swap = change `src` on `<dc-import>`; slot = children of `<dc-import>` (unconfirmed whether the runtime supports slots). Holes are read-only in the editor today; to edit them it would set the value in `renderVals()` or `data-props`, i.e. script editing.
- Status: **Missing**. Effort S for swap (change `src`, pick among `canvas.json` boards), M for variant class toggle.
- Risk: depends on live-runtime semantics.

### 10. Swap instance
- Replace the instance with another component, keeping overrides where layer names match [6].
- Mapping: rewrite `src` attribute of one `<dc-import>`. Candidates: other `.dc.html` files in the project. Effort S. Risk: the swapped file's expected `data-props` may differ.

### 11. Detach instance
- Makes the instance a plain frame, keeping layers and properties; Cmd+Opt+B [4].
- Mapping: replace `<dc-import>` by the imported file's `<x-dc>` children, inlined with fresh edIds (duplicate op already strips ids and mints edIds, `structural-ops.ts:195,226`). Rules from the helmet of the imported file must be merged (class collisions). Effort M. Risk: `{{holes}}` bound to the child's `Component` script are lost; script-driven content breaks.

### 12. Variants / component sets
- Mapping: CSS classes or `data-*` attribute on one element with rules per state; Penpot variants write similar. Without a separate data model, a "variant" is only a class toggle plus a rule. Effort M. Low value outside the Design tool's own model; see Not worth it.

## Recommended for v2
1. Write `var(--token)` references, not literals, when binding from `tokens.json` (plus when `:root` has the name) — keeps bindings alive; today the literal is written — S (verify against M0 first).
2. Token scopes: filter picker by property and token type — less wrong binding, quick win — S.
3. Create style from selection (hoist inline declarations into a class rule in `<helmet><style>`, apply/detach/edit rule, "affects N" warning) — the missing styles feature and maps cleanly to CSS — M.
4. Make token from value + edit token value / alias in `:root` and tokens.json — closes the "Edit token" gap — M.
5. Theme modes read-only first: detect `[data-theme]`/`prefers-color-scheme` override blocks, preview switch (serve-time attribute), then edit value in the active mode — M.
6. `<dc-import>` instance basics: Go to main (open imported board), instance count, swap `src`, per-instance props via `data-props` — M.
7. Detach `<dc-import>` into inline subtree — Figma-habit action, needs style merge — M.
8. Rename token with reference remap across `.dc.html` files — safe refactor; needs usage map (M7 #3) — M/L.

## Not worth it
- Create component from selection (extract to new `.dc.html`): needs `canvas.json` writes the editor avoids and unverified runtime import semantics — L.
- Instance-level overrides inside an imported component: the instance DOM has no per-instance source node.
- Push changes to main from an instance [6]: only meaningful once overrides exist.
- Slots [5]: runtime slot support unconfirmed.
- Variant sets as a data model [5]: classes/attributes cover it; no separate UI worth building.
- Mode conflicts / team-library publishing [2]: libraries and publishing do not exist here.
- Boolean variables bound to visibility [3]: `<sc-if>` holes are read-only data; Figma itself cannot bind booleans to boolean props either [2].
- Style libraries, shared across files [7]: only one project at a time.
- Code-syntax names per platform [1]: only web/CSS exists.
- Penpot token math expressions (`{a} * 2`) [9]: CSS `calc()` already does this in source.
