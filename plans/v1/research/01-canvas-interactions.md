# 01 - Figma canvas interaction model, applied to a DOM/CSS editor

Scope: how Figma's canvas behaves (selection, move, resize, rotate, snapping, measuring, zoom/pan, shortcuts) and how to reproduce it in a browser editor where the DOM/CSS *is* the document. Claims marked [F] come from a fetched Figma help page, [T] from a fetched technical page, [A] are my own design analysis (not from a source).

## 0. Architecture decision (applies to everything below)

- Figma renders on its own WebGL canvas and deliberately avoids HTML/SVG/2D canvas [T: madebyevan]. We are the opposite: the page stays real DOM, so the editor must be an **overlay layer** (absolutely positioned, `pointer-events` controlled, above an iframe or a scaled wrapper) that draws hover outlines, selection boxes, handles, guides and labels. Nothing editor-related may be written into the source files.
- Preview the project in an `<iframe>` (same-origin, srcdoc/blob or local server) so project CSS cannot collide with editor CSS. Overlay lives in the parent document; map coordinates with `iframe.getBoundingClientRect()` + zoom transform. [A]
- Zoom: apply `transform: scale(z)` to a wrapper around the iframe (or the iframe itself), and keep the overlay in screen space (recompute rects each frame). Do NOT use CSS `zoom` on the project content, it changes layout and thus the real document. [A]
- Source of truth: model each edit as an operation {element-path/selector, property, value}; the drag is only a live preview (inline style or a scratch stylesheet), committed on pointer-up into the real CSS rule/inline style. [A]

## 1. Selection

### 1.1 Click selects top-level/"parent first", double-click/Enter goes deeper  - MUST
- Figma: clicking a nested object selects its top-level parent by default; double-click or Enter selects one level deeper; Cmd/Ctrl+click deep-selects the actual nested layer directly. [F: help.figma.com/360040449873]
- DOM: define a "selection root" (e.g. direct children of `<body>`/sections). On click, `document.elementsFromPoint(x,y)` in the iframe, filter out ignorable nodes, walk up to the child-of-current-scope. Double-click: pick the child of the current selection that contains the point. Cmd/Ctrl+click: take `elementsFromPoint()[0]` (deepest).
- Pitfalls: Figma itself notes the deep-select modifier is "indiscriminate" and picks the deepest element [F forum summary via search]; in HTML the deepest hit is often a text node's wrapper `<span>`/`<b>` or a pseudo-element-driven decoration, so filter inline text-level elements to their block parent unless in text-edit mode. `pointer-events:none` elements and `::before/::after` can't be hit; transparent full-size overlays inside the project will swallow clicks (offer "select layer under" via repeated Alt+click or right-click menu, mirroring Figma's "Select layer" menu listing all layers under the cursor [F]).

### 1.2 Keyboard tree navigation  - MUST (cheap)
- Figma: Enter = select child, Shift+Enter = select parent, Tab / Shift+Tab = next/previous sibling. [F]
- DOM: `el.firstElementChild`, `el.parentElement`, `nextElementSibling/previousElementSibling`. Skip `<script>`, `<style>`, `display:none`.
- Pitfall: do not let Tab leave the editor to the browser focus order; `preventDefault` when canvas has focus.

### 1.3 Multi-select: Shift+click toggle, marquee  - MUST (shift-click), SHOULD (marquee)
- Figma: Shift+click adds/removes; drag on empty canvas draws a marquee selecting everything inside; Cmd/Ctrl while marqueeing includes nested layers; a marquee that selects a top-level frame only selects other top-level layers; selecting a parent also selects its children (so check before moving). [F]
- DOM: marquee = compare rect to `getBoundingClientRect()` of candidates at the current scope level; "fully inside" vs "intersect" - Figma uses selection of what the box touches/contains; pick intersect-for-small-boxes is a design call [A].
- Pitfall: multi-selected elements with different parents/layout modes (a flex child plus an absolute one) need a rule: moving them as a group is only well-defined if all are absolute or all in the same flex parent; otherwise restrict to a bounding-box move for absolute ones and disable reorder.
- Pitfall: never include an element AND its ancestor in the selection set when moving (double-translate). Dedupe by ancestry. [A, echoes Figma's own warning in F]

### 1.4 Hover outline  - MUST
- Figma: hovering a layer highlights it (blue box), also from the Layers panel; this is a preference ("Highlight on hover"). [F: 360040449873] The page doesn't describe a name label on hover, but selection shows a dimension label under the bounding box (blue size label). [F: 360039956914]
- DOM: on `pointermove` (rAF-throttled) run the same hit-test as click (with the current scope rules) and draw a 1px outline div in the overlay at the target's rect. Never put the outline on the element itself (would change layout/appear in source).
- Show a small tag label (e.g. `div.card`, w x h) as a *nice-to-have*; the size label under the selection is SHOULD.
- Pitfall: hover must follow the same scope as click, else the user sees one thing highlighted and another selected. Single hit-test function used by both.

### 1.5 Esc / click empty clears; Select all; select matching  - MUST (Esc, click empty), LATER (matching)
- Figma: Esc or empty click clears; Cmd/Ctrl+A selects all; "Select matching layers" via Alt+Cmd+A. [F]
- DOM analog of "matching" = same tag+class or same CSS rule: nice for bulk-editing but LATER.

### 1.6 Layers panel as a DOM tree  - SHOULD
- Figma's panel mirrors the tree, shift-click ranges, hover highlights canvas. [F] Our version is a collapsible DOM outline; it doubles as the escape hatch when hit-testing can't reach an element (zero-size, covered, `pointer-events:none`).

## 2. Moving

### 2.1 Drag to move - the key HTML-specific design  - MUST
Figma has one model (x/y). HTML has several; the drag behaviour must depend on the element's context [A]:
| Element context | Drag does | CSS written |
|---|---|---|
| `position:absolute|fixed` | translate in parent's coordinate space | `left`/`top` (or `right`/`bottom` if that's what the rule already uses - preserve the anchor edge in use) |
| `position:relative` (offset) | adjust offset | `left/top` (keeps flow slot) |
| Child of flex/grid container (in-flow) | **reorder** among siblings, show insertion indicator; not a free move | change DOM order (or `order` only if the source already uses it) |
| Block flow (normal) | reorder among block siblings, or no free drag | DOM order; optional `margin-*` nudge as an explicit alt-drag mode |
| `transform`-positioned | adjust translate | `transform: translate(...)` preserve existing rotate/scale in the transform list |
- Figma analog: in auto-layout frames, drag reorders children along the frame's flow axis and spacing is a separate gap property [F: 31289464393751]. The same page states you can't reorder inside an instance; our analog is "inside a repeated/templated component, warn".
- Implementation: on pointer-down capture start rect + computed style; during drag apply live preview via a transient transform on the element (cheap, no reflow), commit real `left/top` on pointer-up. For reorder, compute the insertion index by comparing pointer position to siblings' midpoints along the container's main axis (use `getComputedStyle(parent).flexDirection`/wrap, handle `row-reverse`/RTL), draw a 2px indicator line in the overlay between siblings, commit by moving the node in the HTML source.
- Allow "drag out of container to re-parent": hit-test the container under the pointer (`elementsFromPoint`), highlight the drop container, convert position (e.g. flex child -> absolute child needs `position:absolute` + parent `position:relative`; warn since it changes layout). SHOULD/LATER; for v1, limit to reorder within parent + free move for absolute.
- Pitfalls: (a) converting px deltas to the unit already in the rule (`%`, `rem`, `vw`): keep the unit, recompute (`delta/parentSize*100`) else the design stops being responsive - this is the biggest "round-trip fidelity" trap. (b) `left/top` percent bases differ from `transform` bases (self size). (c) writing inline style vs the existing class rule: decide policy (edit the matching rule if the element is unique to it, otherwise inline style or a generated class) - show which. (d) margin collapsing and `gap` shifts when a sibling is dragged out.

### 2.2 Arrow-key nudge: 1px, Shift = 10px  - MUST
- Figma: arrows move by the small nudge (default 1), Shift for big nudge (default 10), configurable. [F: 360039956914]
- DOM: same write path as drag (left/top/transform). For flex children, arrows reorder siblings in flow direction (Figma also lets arrows reorder auto-layout children [F: 31289464393751]). Coalesce repeated nudges into one undo step (debounce ~300ms or until keyup).

### 2.3 Axis lock with Shift while dragging  - SHOULD
- Common design-tool behaviour [A; not in fetched pages]. Lock to the dominant axis after a ~3px dead zone.

### 2.4 Drag threshold  - MUST
- Don't start a move until pointer travels ~3-4px, otherwise every click becomes a 1px move and rewrites CSS. [A]

## 3. Resize and rotate

### 3.1 Eight handles, edges + corners  - MUST
- Figma: drag edges/corners; lock aspect via toggle, Ctrl temporarily disables lock, Shift temporarily enables it when the lock is off. A blue size label sits under the box. [F: 360039956914] (The page does not describe Alt/Option-resize-from-center; commonly known Figma behaviour but I did not verify it from a fetched page.)
- DOM: handle div positioned at the selection rect in overlay space; during drag compute new rect from the handle's anchor (opposite edge/corner fixed), apply preview, commit.
- CSS written: `width`/`height` (preserve the unit; if the rule has `max-width`/`min-*` or `flex-basis`/`flex:1` surface it; for flex children with `flex-grow` writing `width` may do nothing -> write `flex-basis` or warn). Dragging a left/top handle of an absolute element changes both `left/top` and `width/height`. For `auto`-sized elements (inline text blocks) the first resize converts `auto` to a fixed value - make that explicit with a small badge ("Fixed width").
- `box-sizing`: the handle rect is the border box (getBoundingClientRect); if the element is `content-box` you must subtract padding+border before writing `width`. Frequent source of off-by-padding bugs.
- Pitfall: scale from transforms: `getBoundingClientRect` already includes ancestor transforms and zoom; divide by the accumulated scale to get CSS px. For rotated elements use `offsetWidth/offsetHeight` + `getComputedStyle().transform` matrix, not the bounding rect (which is the rotated AABB).

### 3.2 Multi-selection resize  - LATER
- Figma ambiguity (uniform scale vs UI-style resize) is explicitly a design problem. [T: andrewkchan figma2] Skip for v1; only allow multi-move, alignment.

### 3.3 Rotation: drag just outside a corner, Shift = 15 degree steps  - SHOULD
- Figma: rotate by dragging just outside bounds; Shift snaps to 15 degrees; rotation origin changeable. [F: 360039956914]
- DOM: write `transform: rotate(Xdeg)` merged into the existing transform list (parse, replace only the rotate term); `transform-origin` defaults to center 50% 50%. Cursor icon changes in a hit-zone outside the corner handles. Many HTML designs never use rotate: SHOULD not MUST.
- Pitfall: transforms don't affect layout so neighbours don't reflow - that's correct and expected, but the overlay must draw the rotated box (use the 4 transformed corners via `getBoxQuads` polyfill or compute from matrix).

### 3.4 Corner radius handles / padding handles  - LATER
- Figma-style on-canvas border-radius dot and padding/gap handles; map to `border-radius`, `padding-*`, `gap`. Highly valuable for HTML since padding/gap are the main spacing levers (see 5.3).

## 4. Snapping and smart guides

### 4.1 Snap to object edges and centers  - MUST
- Figma: "Snap to objects" aligns object centers and outer edges; hold Ctrl to temporarily disable; snap to pixel grid is a separate toggle (avoids blurry exports). [F: 360039956914]
- Reference design: Moveable computes guidelines from other elements' edges/centers, snaps when within `snapThreshold` (default 5), closest wins, draws the guide only within a render threshold, optionally shows distance digits. [T: daybrush.com/moveable Snappable docs; search snippet of snap.ts] tldraw: threshold default **8 screen px divided by zoom**, snap targets exclude selected, off-viewport shapes; frames included, groups contribute children; indicators cleared on drag end. [T: tldraw.dev/sdk-features/snapping]
- Algorithm [A, consistent with the above]: per axis build candidate lines from siblings (and parent edges/center): x in {left, centerX, right}, y in {top, centerY, bottom}. For the dragged rect take its three x and three y values; find the minimal |candidate - mine| per axis below threshold/zoom; apply the delta; draw a 1px red/magenta line spanning the two aligned rects.
- Candidate set: siblings in the same parent + the parent's box + nearby visible elements within the viewport. Cap candidates (e.g. 200) via a spatial pre-filter, else guides become noise (a patent-lit warning that guides from every object clutter dense files, seen in my search; I did not fetch it so treat as unverified).
- CSS written: snapping only changes the number written to `left/top` (absolute) - for flex children it does not apply except to the insertion indicator.
- Pitfalls: (1) threshold in screen px / zoom, not canvas px. (2) Stroke/border and rotation: bounds should be the border box; rotated element snaps on its AABB. (3) Cache candidate rects at drag start (don't call `getBoundingClientRect` for all elements each frame; layout thrash). (4) Sub-pixel: snap targets may be fractional (`12.5px`); round writes to 0.5 or 1px. (5) Alt/Ctrl toggles: Figma uses Ctrl to disable on Mac/Win [F]; Mac Ctrl+click is right-click, so pick a different modifier or Cmd.

### 4.2 Equal-spacing (gap) snapping  - SHOULD
- tldraw "gap snaps": center a selection in a larger gap or repeat an existing gap on the opposite side. [T: tldraw.dev] Moveable has `snapGap`, default true. [T: Moveable docs] Visually: pink/red gap brackets with px values.
- Implementation: from sorted sibling rects along an axis, compute existing gaps; candidate positions = positions that make the new gap equal to an existing gap. Same threshold machinery.

### 4.3 Snap to pixel grid / round to integers  - SHOULD
- [F: 360039956914]. For web: always write integer px unless unit is relative; toggle optional.

## 5. Measurement, spacing and distance feedback

### 5.1 Alt-hover red distance lines  - MUST (high "precision feel", low cost)
- Figma: select an object, hold Option/Alt, hover another -> red line with horizontal and vertical distances; measured between bounding boxes (not outer stroke); nested layers need Cmd+Opt / Ctrl+Alt; locked/masked/low-opacity layers can block it; polygons with odd sides have oversize bounds. [F: help.figma.com/hc/en-us/articles/360039956974]
- DOM: with selection A and hover target B, compute rects, then for each axis: if overlapping on that axis -> gap is the distance between facing edges, drawn as a line at the midpoint of the overlap; if B is inside A -> four inset distances (to each edge). Render lines + a small red pill label in overlay. Also hold Alt with nothing hovered = distances to parent edges.
- Report CSS-meaningful numbers: also show whether the gap is margin/padding/gap (via computed style of the relevant element) -> huge value for an HTML editor, e.g. "24 (gap)" vs "24 (margin-top)". [A]
- Pitfalls: Alt+click on Mac can toggle browser behaviours; `keydown` for Altkey in an iframe loses focus - forward key events from the iframe to the parent. Bounding-box semantics: DOM border box (include border, exclude margin) - explain in UI.

### 5.2 Live size/position label during drag and resize  - MUST
- Figma shows a blue dimension label under selection [F: 360039956914]. Show `W x H` while resizing and `x, y` (or dx, dy) while moving, next to the pointer.

### 5.3 Spacing / padding / gap handles and distribute  - SHOULD
- Figma: Distribute evens spacing keeping outermost layers fixed (needs >=2 selected, one axis); Tidy up arranges into rows/columns/grid using the most common spacing value; auto layout gap can be a number or Auto (Between/Evenly/Around). [F: 360039956914, 31289464393751]
- DOM mapping: for flex/grid parent, a gap handle between two children writes `gap` (or `column-gap`/`row-gap`) on the parent, affecting all siblings consistently - better than Figma's per-item moves. Padding handles at the inside of a selected container write `padding-*`. For absolute siblings, Distribute writes left/top values. Alignment commands (Alt+A/D/W/S/H/V in Figma [F]) map to left/top for absolute; for flex children map to `align-self`/`justify-self` or margin auto.
- Pitfall: gap handle should show only for flex/grid with `gap`; legacy margin-based spacing needs margin writes on each child (confusing) - label it.

## 6. Zoom and pan

### 6.1 Navigation controls  - MUST
- Figma: Space-hold = temporary hand tool, H hand tool; scroll pans (Shift+scroll horizontal); Cmd/Ctrl+scroll or pinch zooms; Shift+1 zoom to fit, Shift+2 zoom to selection; zoom presets 50/100/200%; Recenter button. [F: help.figma.com/hc/en-us/articles/1500004414582 (FigJam/board page; same canvas conventions as Figma design)] Note the fetched page is the FigJam variant; Shift+1/Shift+2 for Figma design are confirmed by Figma-staff-forum snippets seen in search, not by a fetched design page, so treat design-file parity as likely, not verified.
- Technical detail: Figma pinch-zoom depends on the browser delivering trackpad pinch as a `wheel` event with `ctrlKey=true` (Chrome), while Firefox/Safari differ. [T: madebyevan.com/figma/building-a-professional-design-tool-on-the-web]
- DOM: single `wheel` listener on the stage, `preventDefault`, `passive:false`. If `e.ctrlKey||e.metaKey` -> zoom about the cursor: `newPan = cursor - (cursor - pan) * (newZ/oldZ)`; else pan by `deltaX/deltaY`. Space+drag pans. Clamp zoom 2%-6400%. Keep a `{zoom, panX, panY}` state and apply as one `transform: translate() scale()` with `transform-origin: 0 0`.
- Pitfalls: wheel events over the iframe don't reach the parent - cover the iframe with a transparent shield div while in "design" mode (also needed for pointer-event control) or forward events. Text becomes blurry on `scale()`; set `will-change: transform` carefully (it can rasterise blurry at high zoom) or re-render at settled zoom. Overlay line widths/handle sizes must stay constant in screen px (inverse-scale them, or render overlay in screen space).

### 6.2 Zoom-aware everything  - MUST
- Snap threshold /zoom [T: tldraw], handle size constant, 1px guide lines constant, hit-test slop for thin elements (hairlines of height 1px: expand hit rect to >=6 screen px).

## 7. Keyboard shortcuts (v1 set, based on Figma)

| Action | Figma key [F] | v1 |
|---|---|---|
| Deselect | Esc | MUST |
| Select child / parent | Enter / Shift+Enter | MUST |
| Next/prev sibling | Tab / Shift+Tab | MUST |
| Select all | Cmd/Ctrl+A | MUST |
| Nudge 1 / 10 | Arrows / Shift+Arrows | MUST |
| Measure | hold Alt | MUST |
| Deep select | Cmd/Ctrl+click | MUST |
| Zoom fit / to selection | Shift+1 / Shift+2 | MUST |
| Pan | Space+drag / H | MUST |
| Align | Alt+A/D/W/S/H/V | SHOULD |
| Flip | Shift+H / Shift+V | LATER |
| Toggle pixel grid | Shift+' | LATER |
| Duplicate/Delete/Undo/Redo | (standard; not on fetched page) | MUST |
- Pitfall: shortcut keys must only act when the canvas (not a text input in the property panel) has focus; and while inline text editing (contenteditable) all of them are suspended. Keystrokes inside the iframe must be re-dispatched to the parent.

## 8. What makes it "feel precise" (distilled)

1. Everything snaps, and the snap is visible: red/magenta line + distance pill; never an unexplained jump. [F, T]
2. Hit-testing consistent between hover and click (same function), with a clearly distinct "selection scope" (parent first, deepest on modifier). [F]
3. Constant on-screen size for UI chrome regardless of zoom. [T: tldraw threshold/zoom]
4. Numbers visible during every drag (W x H, dx, dy) and integer by default. [F]
5. Modifier keys are *temporary inversions* (hold Ctrl to disable snap, Shift to flip aspect lock, Alt to measure) rather than modes. [F]
6. 60fps feedback: use rAF, cache rects at drag start, drag via `transform` preview, commit CSS once at pointer-up. Figma's own team cites performance/quality as the thing users notice by absence. [T: madebyevan.com]
7. One undo step per gesture; coalesced nudges. [A]

## 9. Priority summary

MUST v1: overlay architecture; hit-test + hover outline; click/dbl-click/Enter/Tab selection and Cmd+click deep select; Shift multi-select; move (absolute -> left/top; flex child -> reorder; keep units); arrow nudges 1/10; 8-handle resize with width/height + box-sizing handling; live size labels; snap to sibling/parent edges+centers with zoom-scaled threshold and Ctrl-disable; Alt-hover distance lines; zoom (cursor-anchored)/pan/fit; drag threshold; single undo step per gesture.
SHOULD: marquee; layers/DOM tree panel; equal-gap snapping; rotation with Shift 15; gap/padding handles; align/distribute; axis-lock; integer/pixel-grid toggle; tag label on hover.
LATER: multi-selection resize; re-parenting drag between containers; select-matching; corner radius handles; flip; guides/rulers; transform-origin editing.

## Gaps in research (honest)
- I did not find a Figma-authored description of smart-guide/snap internals; Figma's engineering posts I fetched cover rendering/architecture only. Snapping algorithm details come from Moveable and tldraw docs plus my own analysis.
- Alt-resize-from-center and spacing-handle drag behaviour were not confirmed from a fetched Figma page.
- Figma's "Guide to keyboard shortcuts" URL returned 404; shortcuts above come from the selection, alignment and zoom pages actually fetched.

## Sources (fetched)
- https://help.figma.com/hc/en-us/articles/360040449873 (select layers and objects; hover highlight)
- https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions (nudge, snapping, resize, rotate, distribute)
- https://help.figma.com/hc/en-us/articles/360039956974 (measure distances)
- https://help.figma.com/hc/en-us/articles/1500004414582 (move around: pan/zoom; FigJam-flavoured)
- https://help.figma.com/hc/en-us/articles/31289464393751 (auto layout flows, reorder by dragging, gap)
- https://madebyevan.com/figma/building-a-professional-design-tool-on-the-web/ (Figma editor/rendering, pinch-zoom wheel events)
- https://andrewkchan.dev/posts/figma2.html (engineering learnings; multi-resize ambiguity)
- https://hackernoon.com/mastering-object-snapping-in-fabricjs-introducing-the-snappyrect-class (six guide positions; pitfalls)
- https://daybrush.com/moveable/release/latest/doc/Moveable.Snappable.html (snap options)
- https://tldraw.dev/sdk-features/snapping (snap thresholds/zoom, gap snaps, indicators)
- https://help.figma.com/hc/en-us/articles/360041053973-Guide-to-keyboard-shortcuts-in-Figma (fetch attempted, 404; not used)
Search-result-only (not fetched, used only as hedged context): forum.figma.com threads on deep select / Shift+2 preference conflict; patents on smart-guide noise.
