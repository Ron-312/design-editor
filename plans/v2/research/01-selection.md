# Selection and multi-select

## Sources (fetched)
1. Figma Help, "Select layers and objects" — https://help.figma.com/hc/en-us/articles/360040449873 — 2026-11-23
2. Figma Help, "Adjust alignment, rotation, position, and dimensions" — https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions — 2026-11-23
3. Figma Forum, "What does matching mean at Select all matching layers" — https://forum.figma.com/t/what-does-matching-means-at-select-all-matching-layers/30164 — 2026-11-23
4. Figma Forum, "Allow multi-edit selection of matching layers within the same frame" — https://forum.figma.com/suggest-a-feature-11/allow-multi-edit-selection-of-matching-layers-within-the-same-frame-33729/index2.html — 2026-11-23
5. Penpot Help, "Shortcuts" — https://help.penpot.app/user-guide/first-steps/shortcuts/ — 2026-11-23

Fetch failures (not cited): Penpot layer-basics (404), Webflow arrow-key navigation (403), Webflow University shortcuts (404). Webflow, Framer, Sketch and Onlook behaviour is therefore not claimed here.

Repo status is from plans/v1/parity.md (Selection section, lines 27-37; Move section, lines 47-49; top-8 list, lines 186-194) and src/.

## Figma features in this area

### 1. Marquee (drag-select) on empty canvas
- Drag on empty canvas selects everything in the box; Cmd/Ctrl while dragging includes nested layers [1].
- Very common; it is the default way to grab a cluster. Without it, multi-select is click-only.
- Status: **Missing**. parity.md:36 "Not built", also ranked #3 in the parity list (:191). `selection.ts` has click logic only.
- HTML/CSS mapping: no CSS written. Hit-test the box against `getBoundingClientRect()` of candidate elements. Default candidates are the children of the current scope (artboard children, or the children of the entered container). With Mod, deepest-leaf candidates. Intersect-vs-contain is an open choice (Figma docs [1] don't say). Shift keeps the existing set and toggles. Skip locked and hidden nodes (as `selection.ts:34` does). Drop ancestors when a descendant is also selected (existing rule, `store.ts:126`).
- Effort: M. Needs a drag state and an overlay rectangle in CanvasView. Rect data is cached once per pointer-down, not read per move.
- Risk: pointer conflict with the move tool, which already owns drags that start on an element. Marquee must start only on the artboard background or on non-selected empty space. Flex children whose rects are not in document flow (transformed) still use rendered rects, which is fine.

### 2. Select all, invert, clear (Cmd-A, Cmd-Shift-A, Esc)
- Cmd/Ctrl-A selects everything, Cmd/Ctrl-Shift-A inverts, Esc or empty click clears [1].
- Common, small but expected.
- Status: Esc **Built** (parity.md:34). Cmd-A **Missing** (parity.md:159 "Mod-A ... Not built"). Invert **Missing**.
- HTML/CSS mapping: pure selection logic over the tree. "All" = all siblings in the current scope (the selection's parent, else the artboard's top-level children), matching Figma's scope behaviour. Invert = scope siblings minus selection. No writes.
- Effort: S.
- Risk: scope definition. Must exclude locked and hidden nodes and `{{hole}}` template nodes.

### 3. Select matching layers / select all with same fill, stroke, font, effect
- Edit menu offers "select all with the same" fill, stroke, effect, text property or font; "Select matching layers" has Opt-Cmd-A [1].
- Forum notes: "matching" for the shortcut means variants of one component set, scoped to a section; staff do not plan same-frame matching [3][4]. This is a known pain point. Users want same-frame matching, which we can offer because our match key is a CSS rule, not a component identity.
- Common in cleanup and restyling work; high value for us because it is the natural partner of the shared-class warning.
- Status: **Missing** (parity.md:37, :171 "M7 #7").
- HTML/CSS mapping, no writes, only querying:
  - Same class: elements matching the selected element's class list (`el.matches('.btn.primary')`), the strongest signal in HTML.
  - Same tag + same rule (the `<helmet><style>` selector the panel already resolves).
  - Same fill / same font / same border: compare resolved declarations (`background-color`, `color`, `font-family`+`font-size`+`font-weight`, `border`, `box-shadow`) via `getComputedStyle` normalised, within scope = current artboard (or whole canvas).
  - Same component instance: elements sharing a `data-` component marker or repeated-template origin, if the project format has one (check 06-project-format).
- Effort: M. Query is S. A "Select all with same ▸" menu plus a count toast is the M part.
- Risk: computed-style equality is fuzzy (rgb vs hex, inherited values). Normalise through the existing css-values helpers. Show the match count before selecting, since Figma's lack of feedback is a forum complaint [3].

### 4. Selection Colors panel (edit all fills/strokes/text colours in a mixed selection)
- With 2+ layers selected, the right sidebar lists each distinct fill, stroke and style once, and editing one entry changes it everywhere in the selection [1].
- Used heavily for re-theming a frame. Also works across a parent selection's descendants in Figma.
- Status: **Missing**. Grep of src/ finds no "selection colors". v1 research 00 lists "Selection colours replace" as Next only (00-figma-ideas.md:62).
- HTML/CSS mapping: for each selected element AND its descendants, collect the colour-bearing declarations (`color`, `background-color`, `border-*-color`, `fill`, `stroke`, `outline-color`, `box-shadow` colour, gradient stops). Group by normalised value; each row shows swatch plus a count. Editing a row writes `{prop: newValue}` ops to every owning rule or inline style (the existing multi-target op, one undo, as in `fields.tsx:170`). If a value is a `var(--token)`, the row shows the token and edits write to the token definition in `tokens.json` only if the user confirms.
- Effort: M-L. Collection is simple; correct write-back per declaration site (class rule vs inline vs shared rule) reuses the existing writer but needs the "shared class" warning per row.
- Risk: one value may live in a shared rule used outside the selection; the replace then changes more than selected. Must warn, as the panel already does for shared classes.

### 5. Multi-selection properties with "Mixed"
- Properties panel shows one value if all agree, "Mixed" otherwise; typing applies to all; equations such as `Mixed+100` add to each layer's own value [2].
- Common.
- Status: Mixed multi-edit **Built** (parity.md:92, `fields.tsx:170`). Relative equations on Mixed fields: not found, **Missing**.
- HTML/CSS mapping: a numeric field with "Mixed" placeholder accepts `+N` / `-N` / `*N` and writes, per element, `prop: <own value + N><own unit>`. Reads each element's authored value via the existing `declarationIn`.
- Effort: S.
- Risk: elements whose value is unauthored (inherited or default) have nothing to add to; skip them and report the skipped count.

### 6. Move, nudge and resize a multi-selection
- Arrow keys nudge the selection by 1, Shift by 10 (preferences adjustable) [2]. Multi-selection rotates about the selection's centre [2]. The article does not describe multi-selection resize [2]; Figma resizes via the shared bounding box with the Scale tool for proportional change (observed in third-party results only, not fetched, so not relied on).
- Very common; parity.md ranks it #2.
- Status: **Missing**. `move.tool.ts:178` returns null for 2+ selections (parity.md:48). Nudge is single-only (parity.md:47). Resize handles are single-only (parity.md:49).
- HTML/CSS mapping, same ops as the single case applied to each member in one undo entry:
  - Absolute or positioned elements: add dx/dy to `left`/`top` (or `translate`) per element, preserving authored units.
  - Flex/grid children: moving is reordering within the parent (existing re-parent/reorder op), not a position write; the parity note says flex children are not nudged. Keep that rule, and skip these members with a message.
  - Resize of a multi-selection: scale each member's `width`/`height` (and `left`/`top` offsets) by the bounding-box ratio. Only meaningful when all members are absolutely positioned in one container.
- Effort: M for move and nudge. L for multi-resize.
- Risk: mixed selections (some flex children, some absolute) need a defined behaviour. Recommend moving only the positionable ones and surfacing the rest, not blocking.

### 7. Parent / child / sibling keys (Enter, Shift-Enter, Tab, Shift-Tab)
- Enter goes down a level, Shift-Enter selects the parent, Tab/Shift-Tab step through siblings [1]. Penpot uses the same keys [5].
- Common among keyboard users.
- Status: **Built** (parity.md:34, `selection.ts:80-104`, tests `selection.test.ts:111-138`).
- Gap: Figma's Tab behaviour with a multi-selection and Penpot's note that Enter-children works for a single selection only [5]. Our behaviour for multi is untested in the docs we fetched; no new work recommended.

### 8. Click / double-click / Cmd-click depth, Shift-click toggle, locked layers
- Click selects top-level, double-click or Enter goes one level, Cmd/Ctrl-click picks the deepest, Shift-click toggles; locked layers are not hit on canvas [1].
- Status: **Built** (parity.md:32-35). Nothing to add.

### 9. "Select layer" context menu (pick from all layers under the cursor)
- Right-click, "Select layer" lists every layer beneath the pointer; hidden layers are excluded, locked ones are listed with a padlock [1].
- Moderately common for overlapped elements; helps absolutely positioned stacks where click picks the top one.
- Status: **Missing** (no context menu entry found in parity.md).
- HTML/CSS mapping: `document.elementsFromPoint(x, y)` mapped to editor ids, filtered to editable nodes; menu click sets the selection. No writes.
- Effort: S. Risk: needs the editor's right-click menu to exist; otherwise add a minimal one.

### 10. Layers-panel range and toggle select (Shift = range, Cmd = add)
- Shift-click selects the run between two layers; Cmd/Ctrl-click adds one [1]. Penpot matches this [5].
- Status: not confirmed in parity.md (the Layers panel row mentions two-way sync only, :113). Needs a grep of `LayersPanel.tsx` before scheduling; treat as **Unknown/likely Partial**.
- HTML/CSS mapping: selection only; range = siblings between anchor and target in DOM order within one parent.
- Effort: S.

## Recommended for v2
1. Multi-selection move and nudge (arrow, Shift-arrow, drag) — the move tool refuses 2+ elements today, the biggest daily gap — M
2. Marquee select with Shift toggle and Mod-for-deep — expected default way to multi-select — M
3. Select all with same ▸ class / fill / font / border (plus select-matching count) — fast restyling; fixes the same-frame limit users complain about in Figma [3][4] — M
4. Cmd-A select all in scope and Cmd-Shift-A invert — trivial and expected; pairs with marquee — S
5. Selection Colors panel with replace — one place to re-theme a selection; reuses multi-target ops — M-L
6. Layers-panel Shift range and Cmd toggle selection (verify first) — keyboard-free multi-select path — S
7. "Select layer" under-cursor context menu (`elementsFromPoint`) — resolves overlap picking for absolute layouts — S
8. Mixed-value equations (`+10` on a Mixed field) — cheap extension of the existing multi-edit — S

## Not worth it
- Multi-selection resize (bounding-box scale) as its own item: Figma's docs don't cover it [2], and it only makes sense for absolute members; defer until multi-move ships.
- Multi-selection rotate about the selection centre [2]: needs a canvas rotation handle first (parity.md:55 says panel field only), and `transform: rotate` on several elements around a shared pivot rewrites `transform-origin` too.
- Component-set "Select matching layers" semantic [3]: there is no component-set data model in HTML; the class and rule match in item 3 replaces it.
- View-only purple selection outlines [1]: a multiplayer-viewing concept with no value in a local editor.
- Per-user preference for nudge amount [2]: low value; fixed 1/10 is built (parity.md:47).
