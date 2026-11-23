# 07 - Validation of research/01-canvas-interactions.md + new canvas ideas

Date: 2026-11-23. Every row cites a URL fetched this session (WebFetch). "Search-only" means a WebSearch snippet, not a fetched page.

## Part 1. Validation table

| # | Claim in 01 | Verdict | Evidence / correction |
|---|---|---|---|
| 1 | Click selects top-level parent; double-click/Enter goes one level down; Shift+Enter up; Tab/Shift+Tab siblings | CONFIRMED | https://help.figma.com/hc/en-us/articles/360040449873 |
| 2 | Cmd/Ctrl+click deep-selects nested layer | CONFIRMED | same page |
| 3 | Shift+click add/remove; marquee selects what it touches; Cmd/Ctrl while marqueeing includes nested; top-level-frame marquee only selects other top-level layers | CONFIRMED (marquee = "touches", i.e. intersect, so the 01 "fully inside vs intersect, design call" doubt is resolved: intersect) | same page |
| 4 | Esc/empty click clears; Cmd/Ctrl+A select all | CONFIRMED (Esc not stated on fetched text, empty-click/Esc stays standard) | same page |
| 5 | Select matching layers = Alt+Cmd+A | CONFIRMED (Opt+Cmd+A Mac, Alt+Ctrl+A Win). Note: the separate "select matching" button was folded into multi-edit (users noticed) | same page; https://forum.figma.com/t/meet-multi-edit/66201 |
| 6 | Hover highlight is a preference | CONFIRMED but narrower: help page says hovering in the LAYERS PANEL highlights on canvas, toggle "Highlight on hover". Canvas hover outline itself is standard behaviour, not documented on that page | https://help.figma.com/hc/en-us/articles/360040449873 |
| 7 | Nudge 1 / Shift 10, configurable | CONFIRMED (in points, resolution independent) | https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions |
| 8 | Snap to objects; hold Ctrl to disable; snap to pixel grid separate | CONFIRMED. Extra: "Snap to geometry" is vector-edit-only; Ctrl disables for geometry/objects; pixel-grid snap only usable when grid visible | same |
| 9 | Resize: Ctrl disables aspect lock, Shift enables when unlocked | CONFIRMED | same |
| 10 | Alt/Option resize from center ("not verified") | CONFIRMED as behaviour, but NOT on the official help page (that article does not cover it). Backed by shortcut sheets: Alt-drag = resize from center, Alt while moving = duplicate. Treat as community-documented | https://www.nobledesktop.com/shortcuts/figma/pc ; https://defkey.com/figma-shortcuts |
| 11 | Rotation: Shift snaps 15 degrees; rotation origin changeable | CONFIRMED (origin key = Opt+R / Alt+R) | 360039956914 page |
| 12 | Alignment keys Alt+A/D/W/S/H/V | CONFIRMED, but 01 table is imprecise: A=left, D=right, W=top, S=bottom, V=vertical centers, H=horizontal centers. Shift+click on align = align to parent frame | same |
| 13 | Distribute keeps outermost fixed; needs 2+; Tidy up uses grid aligned to selection top-left | CONFIRMED (01's "most common spacing" nuance not re-verified) | same |
| 14 | Alt-measure: select, hold Alt, hover; red line with H and V distances; bounds not stroke; Cmd+Alt / Ctrl+Alt for nested; masks/locked/low-opacity block it | CONFIRMED. Corrections/additions: nested modifier shows a "single measurement"; text measures to layer bounds not baseline; guides are measurable (select one, Alt-hover another = both positions); works in vector edit between anchors | https://help.figma.com/hc/en-us/articles/360039956974 |
| 15 | Zoom fit Shift+1, zoom to selection Shift+2 | CONFIRMED for Figma Design (previously only FigJam page fetched) plus zoom in/out = Shift + / Shift -. Caveat: with "Use number keys for opacity" off, plain 1/2 also work; some users report Shift+2 conflicts with pixel grid (search-only, forum) | https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options |
| 16 | "zoom presets 50/100/200%" with shortcuts | WRONG (shortcuts): the zoom article lists NO shortcut for 50/100/200; they are menu/typed values. Cmd/Ctrl +/- also zooms | same page |
| 17 | Toggle pixel grid = Shift+' | WRONG / conflicting. Zoom article: pixel grid = Cmd+' (Mac) / Ctrl+' ; grid only visible at 400%+; SNAP to pixel grid = Cmd+Shift+' / Ctrl+Shift+'. The alignment article summary said Shift+' toggles grid, so Figma's own pages disagree; trust the zoom article | 360041065034 vs 360039956914 |
| 18 | Space = hand, H hand tool; scroll pans, Shift+scroll horizontal; Cmd/Ctrl+scroll or pinch zoom; Recenter button | PARTLY CONFIRMED: Cmd/Ctrl+scroll and pinch zoom confirmed for Design. Hand tool/Space not covered by the Design article; still based on FigJam page. Faster pan with Shift+arrows exists | 360041065034 ; https://help.figma.com/hc/en-us/articles/360040328653-Use-Figma-products-with-a-keyboard |
| 19 | Figma pinch-zoom depends on wheel ctrlKey (Chrome) | NOT RE-CHECKED this round (engineering blog, outside brief). Remains as 01 stated; it is the de-facto web standard | n/a |
| 20 | Moveable: snapThreshold default 5, snapGap default true, nearest wins, snapDigit | CONFIRMED with a wrinkle: docs are inconsistent (Members says 5; type says 0 and splits into horizontal/vertical thresholds defaulting to 5). snapGap=true, snapDigit=0, snapRenderThreshold=1 (guide drawn only if within 1px of snapped position) | https://daybrush.com/moveable/release/latest/doc/Moveable.Snappable.html |
| 21 | tldraw: threshold 8 screen px / zoom; excludes selected, off-viewport; groups contribute children; gap snaps (center in gap, repeat gap) | CONFIRMED. Extra: gaps computed per axis; a gap exists only when shapes overlap on the perpendicular axis; shapes can opt out via canSnap | https://tldraw.dev/sdk-features/snapping |
| 22 | Ctrl to disable snap is problematic on Mac (Ctrl+click = right click) | Figma itself uses Control (confirmed), so Mac Figma users live with it; our alt (Cmd) is a design choice. Unchanged | 360039956914 |
| 23 | Layers panel mirrors tree, shift-click ranges | Not re-verified (not in fetched text); LOW RISK, STILL UNVERIFIED | - |
| 24 | Axis lock with Shift while dragging "[A; not in fetched pages]" | STILL UNVERIFIED on official pages (universally standard; not documented in Figma help we fetched) | - |
| 25 | Drag threshold 3-4px; one undo step per gesture; 60fps design rules | Own analysis, no Figma doc; STILL UNVERIFIED (reasonable engineering) | - |
| 26 | Smart-guide noise from patents | STILL UNVERIFIED (not fetched this round) | - |
| 27 | Guide to keyboard shortcuts URL 404 | Superseded: shortcut sheets fetched (below). Figma's own forum 403s on fetch | - |
| 28 | Outline view shortcut (not in 01) | CONFLICTING: Cmd+Y (Mac) / Ctrl+Shift+3 (Win) per Raycast list; Shift+O per Nobledesktop (legacy; Figma has a "use old shortcuts for outlines" setting, search-only). Zoom help page does not cover outlines | https://www.raycast.com/arturdz/figma-shortcuts ; https://www.nobledesktop.com/shortcuts/figma/pc |

Summary of 01 corrections: (a) Shift+' is not safely "pixel grid toggle" (Cmd+' toggles; Cmd+Shift+' snaps; grid only at 400%+); (b) no shortcuts for 50/100/200%; (c) Alt-resize-from-center is real but third-party-sourced; (d) marquee semantics = touch/intersect; (e) hover highlight documented only for Layers-panel hover; (f) alignment key map should be spelled out exactly.

## Part 2. New canvas features missed or newer

Check on what Figma shipped: the current release-notes page only exposed Nov 2026 entries (3D transform Nov 12, AI object select Nov 6; none are canvas-editing basics), so no 2025-26 release note changes the core model. Sources: https://www.figma.com/release-notes/ . Canvas-related 2025 items seen via search only: July 2025 "keyboard canvas controls" and April 2025 collapse-all-layers (forum livestream recaps, search-only).

Ranked:

1. **Multi-edit / bulk property edit (MUST)** - select across parents, one edit applies to all; Shift+align aligns to parent; mixed values show as "Mixed", relative maths like "Mixed + 24" (search-only). Source: https://help.figma.com/hc/en-us/articles/21635177948567 . Build: selection is an array of element refs; property panel reads computed values for each, shows "Mixed" when they differ, writes the same CSS declaration to each source rule in one operation = one undo step. Cheap and exactly what the source-splicing model is good at. Dedupe ancestors.
2. **Select matching (SHOULD, upgrade from LATER)** - Opt+Cmd+A; Edit menu "select all with same fill/stroke", quick actions "same font/instance" (https://help.figma.com/hc/en-us/articles/360040449873 ; https://help.figma.com/hc/en-us/articles/23570416033943-Use-quick-actions). Build: `querySelectorAll` on same tag+class set, or same computed value of a chosen property; feeds multi-edit. Particularly strong in HTML because classes already define "matching".
3. **Quick actions / command palette, Cmd+K (SHOULD)** - one searchable entry to commands (align, flip, rulers toggle, collapse layers, frame selection, select same font). Same quick-actions page. Build: a fuzzy-filter list over a command registry that every toolbar button and shortcut also uses; free discoverability and easy to extend. Note Cmd+K collides with link-insertion in text edit; suspend while editing.
4. **Rulers + guides (SHOULD, upgrade from LATER)** - Shift+R toggles rulers; drag from ruler to create a guide; Alt-drag from a guide copies; drag back or Delete to remove; Alt-hover measures guide distances and guides count as snap objects (help page: https://help.figma.com/hc/en-us/articles/360040449713-Add-guides-to-the-canvas-or-frames ; note the page itself lists only the View menu for rulers, Shift+R comes from forum/shortcut sheets). Build: ruler divs in overlay in screen space with ticks computed from zoom; guides stored as editor metadata (sidecar, e.g. canvas.json editor key or a separate file, NOT in the artboard HTML); added to the snap candidate list. Needs a decision where guides persist.
5. **Layout-grid overlay + snap (LATER-SHOULD)** - Ctrl+G / Ctrl+Shift+4 toggles layout guides (zoom article). Build: read a CSS grid/columns on the artboard and draw its tracks from `getComputedStyle(gridTemplateColumns)`; snap candidates from track lines. Good fit since HTML often uses real grids.
6. **Pixel grid + snap-to-pixel (SHOULD)** - Cmd+' grid visible at 400%+, Cmd+Shift+' snap (zoom article). Build: CSS background repeating-linear-gradient on overlay sized 1css-px*zoom, drawn only when zoom >= 4; snap-to-integer on writes (already in 01).
7. **Outline view (SHOULD)** - Cmd+Y/Shift+O (shortcut conflicting, pick our own e.g. Cmd+Y). Build: inject a debug stylesheet into the iframe `* { outline:1px solid rgba(...) !important; background:none !important}` as an editor-only layer (never saved). Superb for finding transparent click-swallowers (the 01 hit-test pitfall) and zero-size elements.
8. **Scale tool K (LATER)** - proportional scale with a multiplier input; scales children, strokes, blurs; ignores constraints; not on locked layers or instance children (search-only for K, official page not fetched; forum reports K input-focus behaviour changed Nov 2025). Build for HTML is hard (scale fonts, padding, radii, shadows); cheap alternative: `transform: scale()` or a "scale all lengths in subtree" command. Defer.
9. **Alt-drag duplicate and Alt-resize-from-center (SHOULD)** - third-party-sourced but ubiquitous. Build: duplicate = clone source node after the original (new id), then drag the clone; center-resize = resize writes symmetric left/top/width/height deltas.
10. **Copy/paste properties, paste over selection, frame selection (Cmd+Alt+G), flip, ungroup, hide/lock (Ctrl+Shift+H / L) (LATER)** - shortcut sheet https://defkey.com/figma-shortcuts . Mapping: wrap in div, remove wrapper, `visibility`/`display` toggled via an editor data-attr only (non-destructive), lock = editor-side flag ignored by hit-test.
11. **Selection-to-zoom shortcuts and zoom +/-: Shift+ +/- (SHOULD)** (zoom article) - trivial.
12. **Hold-Shift keyboard panning, keyboard box-selection tool (Opt+Space) (LATER)** - a11y feature on https://help.figma.com/hc/en-us/articles/360040328653-Use-Figma-products-with-a-keyboard .
13. **Collapse all layers (SHOULD for layers panel)** - quick actions page. Trivial tree op.
14. **Minimap (LATER, likely skip)** - Figma has no native minimap; community requests only (search-only: forum threads) and Sketch has one. For a canvas with a handful of artboards, Shift+1 and a frame list suffice; build later as a scaled thumbnail strip if boards are many.
15. **Pixel preview (LATER)** - Ctrl+P rendering at 1x without anti-aliasing; not meaningful for DOM; skip.

Top picks to add to the plan: multi-edit with Mixed values, select-matching by class, Cmd+K command palette, outline view as debugging layer, rulers+guides as snap sources, Alt-duplicate/center-resize.

## Sources (fetched this session)
- https://help.figma.com/hc/en-us/articles/360040449873 (selection)
- https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions
- https://help.figma.com/hc/en-us/articles/360039956974 (measure)
- https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options
- https://help.figma.com/hc/en-us/articles/360040449713-Add-guides-to-the-canvas-or-frames
- https://help.figma.com/hc/en-us/articles/23570416033943-Use-quick-actions
- https://help.figma.com/hc/en-us/articles/21635177948567 (multi-edit)
- https://help.figma.com/hc/en-us/articles/360040328653-Use-Figma-products-with-a-keyboard
- https://forum.figma.com/t/meet-multi-edit/66201
- https://www.figma.com/release-notes/
- https://tldraw.dev/sdk-features/snapping
- https://daybrush.com/moveable/release/latest/doc/Moveable.Snappable.html
- https://defkey.com/figma-shortcuts ; https://www.nobledesktop.com/shortcuts/figma/pc ; https://www.raycast.com/arturdz/figma-shortcuts (third-party shortcut sheets, lower trust; they disagree with each other on outlines)
Search-only (not fetched): forum threads on Shift+2 preference conflict, scale tool K behaviour, minimap requests, "old shortcuts for outlines" setting, Figma Config/UI3 recaps. Figma forum pages return 403 to fetch (except the multi-edit post).
