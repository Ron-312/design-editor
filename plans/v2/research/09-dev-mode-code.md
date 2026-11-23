# Dev Mode, Inspect & Code view

## Sources (fetched)
1. Figma Help, "Before you start" (Dev Mode overview) — https://help.figma.com/hc/en-us/articles/15023124644247 — 2026-11-23
2. Figma blog, "Dev Mode fast follows: 200+ new features and fixes" — https://www.figma.com/blog/dev-mode-fast-follows-200-new-features-and-fixes/ — 2026-11-23
3. Figma blog, "What's next for Dev Mode: annotations, compare changes, plugins" — https://www.figma.com/blog/dev-mode-ga/ — 2026-11-23
4. Figma blog, "The art and science of annotations in Dev Mode" — https://www.figma.com/blog/annotations-in-dev-mode/ — 2026-11-23
5. Figma Help, "Add measurements and annotate designs" — https://help.figma.com/hc/en-us/articles/20774752502935 — 2026-11-23
6. Onlook, Features page — https://www.onlook.com/features — 2026-11-23
7. Onlook, GitHub README — https://github.com/onlook-dev/onlook — 2026-11-23
8. Penpot Help, "Inspect designs" — https://help.penpot.app/user-guide/inspect/ — 2026-11-23
9. Chrome DevTools, CSS features reference — https://developer.chrome.com/docs/devtools/css/reference — 2026-11-23

Fetch failures (not used as evidence): help.webflow.com style-selectors / style-panel / style-labels (403), deepwiki Onlook (429). Webflow claims below come from WebSearch snippets only (help.webflow.com/hc/en-us/articles/33961365722899, /33961332425875): treat as unverified.

Repo baseline (parity.md + grep of src/): there is NO code view, no Inspect mode, no annotations, no computed-style view. Existing adjacent pieces: selector chip with `file:line` (`src/ui/panels/PropertiesPanel.tsx:142-175`), "overridden by" warning (`src/ui/panels/fields.tsx:140-157`), per-file diff panel with Revert (`src/ui/DiffPanel.tsx:26`), Alt-hover red distance lines (`src/ui/canvas/tools/measure.tool.ts:46-113`), style copy/paste (`src/ui/actions/style-clipboard.actions.ts:12-45`).

## Figma features in this area

### 1. Inspect panel "Code" section (CSS snippet for the selection)
- Does: in Dev Mode, selecting a layer shows auto-generated CSS/iOS/Android snippets; language and units set in a dropdown [1]. Shift-click copies all snippets at once; padding emitted per side; line-height as % and px; rem can be applied to text only while the rest stays px [2].
- Reliance: the core of Dev Mode; every handoff flow uses it. High.
- Status: Missing. Our panel edits values but never shows the final rule as text.
- HTML/CSS mapping: we do not need codegen. Show the REAL source: the exact `style="..."` attribute and each matching `<helmet><style>` rule as authored text (byte-identical to file, with `file:line`), plus Copy buttons (whole rule, single declaration). No units dropdown needed: authored units are already kept.
- Effort: S-M. Risk: low; data already in `index.styles` (StyleSource has file/line/target).

### 2. Code/List toggle with click-to-copy values
- Does: Layer properties toggle between Code (default) and List; clicking a List value copies it [1]. Penpot Inspect: copy button per property or per section (e.g. all layout props) [8].
- Reliance: common, quick "grab a value" action.
- Status: Missing (only style copy/paste of whole declarations, `style-clipboard.actions.ts:12`).
- Mapping: copy a single `prop: value;`, a whole rule, or "all declarations" to clipboard; mirrors DevTools "Copy declaration / Copy all declarations / Copy all declarations as JS" [9].
- Effort: S. Risk: none.

### 3. Editable code view with live CSS editing (the differentiator)
- Does: Chrome DevTools Styles pane: double-click name/value to edit, click rule body to add a declaration, per-declaration checkbox to disable (struck through), Up/Down 1/0.1, Shift 10, Cmd+Shift 100 [9]. Onlook markets a visual editor whose edits write real code with "the code remains the source of truth" [6]; its README says edits go via an agent to real files and Git tracks them, and lists CodeMirror in the desktop stack, but fetched pages do not describe a code panel [7].
- Reliance: any dev inspecting; designers rarely. Our users are Claude Design canvas authors, who live next to HTML/CSS, so higher than in Figma.
- Status: Missing. Panel fields exist for ~20 properties only; no free-form property add (parity.md lists "CSS tab" as Not built).
- Mapping: a "CSS" tab listing declarations of the chosen target (inline or helmet rule) as editable rows `name: value` + enable checkbox. Write = same splice ops the panel already uses (patch-engine, byte-exact). Disable = wrap the declaration in `/* ... */` inside the rule (or remove for inline attrs, where comments are not legal: keep a note). Add = append `prop: value;`. Validate property/value with `CSS.supports()` before writing. Nudge keys reuse `css-values.ts` stepping.
- Effort: M. Risk: comment-disable must round-trip byte-exact; inline `style=""` cannot hold comments, so disable there is delete-with-undo.

### 4. Specificity / cascade view and computed pane
- Does: DevTools hovers a selector to show specificity and highlights matching elements; overridden declarations are struck through; Computed pane shows only applied values, with Show All, filter and Group [9].
- Reliance: heavy for debugging "why isn't my edit applying".
- Status: Partial: overridden warning after a write (`fields.tsx:140-157`). No pre-edit cascade view; shared-class warning only for `sc-for` (`PropertiesPanel.tsx:225`, parity.md Partial).
- Mapping: read-only; use `getMatchedCSSRules`-style walk of iframe `document.styleSheets` + `getComputedStyle` in the probe, list rules matching the selected element in cascade order with specificity tuple, strike losers. "Matches N elements" count via `querySelectorAll(selector).length` closes the shared-class gap.
- Effort: M. Risk: probe round-trip; cross-origin sheets irrelevant (inline helmet only).

### 5. Measurements and redlines
- Does: Dev Mode Measurement tool (Shift M) drags a dimension between layers; saved, shared, editable text; Alt/Option hover measures on any plan but is not saved [5]. Dimension lines stay attached and update with the design [4]. Penpot Inspect shows distances to other layers and board edges on hover [8].
- Reliance: medium; designers redline for devs.
- Status: Built for transient Alt-hover (`measure.tool.ts:46`). Persistent measurements Missing.
- Mapping: persisted dims would need an overlay file (like `.editor/state.json`, `src/server/editor-state.ts:10`), NOT in the canvas HTML. Value is low because the HTML is the spec.
- Effort: M. Risk: stale after edits unless anchored to edIds.

### 6. Annotations with property pins and categories
- Does: note on a layer, optionally "+ Property" (alignment, sizing) that auto-updates; preset categories Development/Interaction/Accessibility/Content, filterable; shown in Dev Mode; plugin API for bulk [5][4]. Lines auto-position and collapse by zoom [4].
- Reliance: medium for teams; useful here because Claude Code reads the repo.
- Status: Missing.
- Mapping: store notes in `.editor/state.json` keyed by edId, OR as `data-note="..."` / HTML comment spliced above the element so Claude Code sees it. The Accessibility category maps naturally to real attributes (`aria-label`, `alt`, `role`, `tabindex`).
- Effort: M. Risk: where notes live (editor-only vs in the HTML). An in-HTML `data-note` pollutes files.

### 7. "Ready for dev" status, Focus view, Completed
- Does: mark a frame/component/section ready; a Ready-for-dev list; Focus view shows one ready design with annotated version history; Completed status on Org/Enterprise [1].
- Reliance: team workflow, not single-user.
- Status: Missing.
- Mapping: only a per-board flag in editor state; no CSS.
- Effort: S. Risk: no value without multi-user. Reject (see below).

### 8. Compare changes (visual + code diff)
- Does: Compare changes link below layer info opens frame history; diffs shown visually and in code [1][3]. Component instances can compare with main component [1].
- Reliance: medium; devs checking what changed since handoff.
- Status: Partial. DiffPanel shows per-file diffs and Revert (`DiffPanel.tsx:26`). No visual before/after and no "since this version".
- Mapping: git/snapshot-based; render before/after in two iframes or an onion-skin overlay; text diff already exists. Chrome's Changes tab / "Copy all CSS changes" is the same idea for edits [9].
- Effort: M-L (visual), S ("copy all CSS changes" as a patch/summary string from existing undo log records).
- Risk: visual diff needs snapshot of pre-edit HTML (undo-log already stores snapshots).

### 9. Variables/tokens shown in Inspect + variable suggestions
- Does: Dev Mode lists variables applied to a layer and suggests a variable when a raw value closely matches [1][2].
- Reliance: design-system teams.
- Status: Partial: token picker + bound pill built (`fields.tsx:318-335`); no suggestion.
- Mapping: when a written raw colour/length equals or is within delta of a `tokens.json` value, show "Use var(--x)" chip that writes `var(--x)`. Exact-match is deterministic and cheap.
- Effort: S. Risk: low.

### 10. Codegen plugins (HTML/React/Tailwind) and asset export
- Does: nearly 80 community codegen plugins (Tailwind, React, Vue) [2]; plugins can emit HTML/React/Tailwind [3]. Export PNG/JPG/SVG/PDF, auto-detected icons [1].
- Reliance: heavy in Figma because Figma has no real code.
- Status: Missing, and mostly moot: our source already IS HTML/CSS.
- Mapping: "Copy element as HTML" (outerHTML slice from source with the matching helmet rules) is the useful 5 %: the portable snippet. Raster export of a node = screenshot of iframe region.
- Effort: S (copy HTML), M (PNG export). Risk: none.

### 11. Class management (Webflow-style, search-snippet only, unverified by fetch)
- Search snippets claim: a Style selectors panel lists every class/combo class/tag, with rename, search, clean up unused; and inherited-vs-local style labels with click-to-see-source.
- Reliance: Webflow's central workflow.
- Status: Partial. We can pick a `<helmet>` rule and see where it is (`PropertiesPanel.tsx:168`); no class list, rename, unused finder, or apply/remove class on an element.
- Mapping: classes are real `class="a b"` attributes and `.a {}` rules in helmet. Ops: add/remove class token on `class=` (attribute splice), rename class = rename in selector text + all `class=` occurrences across the board (one multi-splice op, one undo), list unused = selectors with zero matches in DOM.
- Effort: M (apply/remove), M (rename). Risk: renames must handle `sc-for`/dynamic `{{}}` class holes; refuse like text-splice does (`text-splice.ts:168`).

## Recommended for v2
1. CSS source tab (read-only first): authored inline style + each matching helmet rule as exact text with `file:line` and copy buttons (single declaration / whole rule) — closes the biggest Dev Mode gap with data we already hold — S.
2. Editable declaration rows with enable/disable checkbox, add-property, arrow stepping — free-form CSS beyond the ~20 panel properties; our code view differentiator versus Figma's read-only snippets — M.
3. Cascade view for the selection: matching rules in order, specificity tuple, struck-through losers, "matches N elements" for shared classes — answers "why didn't my edit apply" before the write — M.
4. Class chips on the element: add/remove class token, list classes, rename class board-wide with shared-class warning — Webflow-style class management mapped to real `class=` — M.
5. Copy element as HTML (+ its matching rules) and "Copy all CSS changes" from the session's undo records — portable handoff text, nearly free — S.
6. Token suggestion chip when a raw value equals a `tokens.json` value — Dev Mode does it [2]; exact match is trivial — S.
7. Annotations stored in `.editor/state.json` (note + category + optional pinned property), shown on canvas, optional a11y category that writes `aria-*` — useful context for Claude Code — M.
8. Visual compare: before/after overlay or slider against the pre-edit snapshot beside the existing text diff — M-L.

## Not worth it
- Ready for dev / Completed / Focus view [1]: team status workflow; single local user, no CSS meaning.
- Codegen plugin ecosystem, Tailwind/React/Vue output [2][3]: our files are already HTML/CSS; no translation layer needed.
- iOS/Android snippets [1]: out of scope for HTML canvases.
- CSS units dropdown / px-to-rem conversion [1][2]: we preserve authored units; converting would rewrite author values.
- Persisted measurement lines [5]: HTML is the spec and Alt-hover already exists; maintenance of anchored dims is not worth it.
- Code Connect / component playground [1]: requires a component data model we do not have.
- Framer-style code overrides / React HOCs: React-specific, no HTML/CSS equivalent (searched; only snippets, not fetched).
- Penpot "paste CSS to create design": (search snippet) no fetched evidence it exists; skip.
- Chrome "Sync CSS changes" workspace mapping [9]: we already write straight to files.
