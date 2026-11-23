# Responsive design, preview/prototype, comments, version history, images

## Sources (fetched, 2026-11-23)
1. Figma — Version history — https://help.figma.com/hc/en-us/articles/360038006754
2. Figma — Present designs and prototypes (Preview/Present) — https://help.figma.com/hc/en-us/articles/360040318013-Present-designs-and-prototypes
3. Figma — Comments — https://help.figma.com/hc/en-us/articles/360041547593
4. Figma — Image fill modes — https://help.figma.com/hc/en-us/articles/360041098433
5. Figma — Prototype interactions (triggers/actions) — https://help.figma.com/hc/en-us/articles/360040314193
6. Figma — Design an interactive button — https://help.figma.com/hc/en-us/articles/20953528101783-Design-an-interactive-button
7. Figma — Working with images (best practices) — https://www.figma.com/best-practices/working-with-images-in-figma/
8. Framer Academy — Breakpoints — https://www.framer.com/academy/lessons/framer-fundamentals-breakpoints
9. Framer blog — Responsive breakpoints guide — https://www.framer.com/blog/responsive-breakpoints/
10. Webflow University — Cascading rules — https://university.webflow.com/glossary/cascading-rules
11. Webflow dev docs — breakpoint-style-migrator (widths, cascade) — https://developers.webflow.com/mcp/prompts/breakpoint-style-migrator
(help.webflow.com breakpoint pages returned 403; not cited. The pages for 8-11 do not document media-query syntax; the CSS mapping below is standard CSS, not claimed from them.)
Repo evidence: plans/v1/parity.md (rows: lines 21, 94, 144, 169, 178-181), src/server/source/style-index.ts:14,101 (helmet rule index).

## Figma features in this area

### 1. Breakpoints with inheritance (Framer/Webflow model)
- What: Framer breakpoints are alternate layouts; a new one inherits from the primary, and each overrides only what it needs (type size, stack direction, gap, padding, width, visibility); the width is the minimum viewport where it applies [8]. Webflow cascades from desktop (992+) down: tablet 768-991, mobile landscape 480-767, mobile portrait <=479; a smaller breakpoint overrides, moving a style up replaces the base for all that lack overrides [10][11].
- Reliance: core for any web-targeting tool; Framer advises adding one only when the layout fails [8].
- Status: **Missing** (parity.md:94 "@media editing... Not built", :180 out of scope, :169 multi-viewport not built). Helmet rule indexing exists (style-index.ts:101) but only for plain rules.
- HTML/CSS: a breakpoint = `@media (max-width: Npx){ <sel>{...} }` block inside the same `<helmet><style>`. Edit writes declarations into the existing @media rule for the selector (insert the block if missing, append at the end so it wins the cascade). Inline styles beat @media, so while a breakpoint is active, writes must go to a helmet class/id rule, not `style=""` (or element gets a generated class). Desktop-first = max-width queries; min-width mobile-first is a toggle.
- Effort: L (rule parser must understand at-rule nesting; selector minting for inline-styled elements; "overridden here" indicator). Risk: byte-exact splice into nested rules; specificity traps; elements styled only inline.

### 2. Frame resizing / responsive viewport preview
- What: Preview window can be dragged to resize, Shift keeps proportions; Responsive / Fit width / Fixed modes [2]. Framer custom breakpoints are added by dragging the preview window or entering a width [9].
- Reliance: very common for testing responsive layout.
- Status: **Missing** (parity.md:169 multi-viewport M7 #5). Artboard root handles are disabled (parity.md:51), so artboards cannot be resized to test.
- HTML/CSS: not a source edit. Canvas-side: a width control on the artboard iframe/wrapper (viewport width, not the root element's CSS width) so real `@media` fires. Optional side-by-side set (e.g. 375/768/1280) = N iframes of the same file.
- Effort: S for one resizable preview width with presets; M for side-by-side. Risk: artboard root may have fixed px width authored; resizing must be a view-only override (never written).

### 3. Preview / Present mode
- What: Preview inline (Shift+Space), Present in a new tab; arrows to navigate, R restart; scaling modes Fit width, Responsive, 100%, Fill; optional device frame [2].
- Reliance: heavy in prototyping; for a CSS canvas it reduces to "see it live".
- Status: **Partial** — Interact toggle (hold I / Preview switch) exists (parity.md:21, CanvasView.tsx:450); presentation mode is out of scope (parity.md:181).
- HTML/CSS: none written. Full-window render of the artboard at chosen width with scripts/hover live; Space/arrow to step through artboards (ordered by canvas position left-to-right then top-to-bottom, as Figma does without flows [2]).
- Effort: S-M. Risk: low; dependent on item 2's viewport control.

### 4. Interactive states (hover / pressed)
- What: Figma builds a button with default, hover, pressed variants wired by While hovering, Mouse down, Mouse leave, Mouse up, Change to + Smart animate 150 ms [6]. Triggers include click, drag, hover [5].
- Reliance: common for buttons/links; in Figma it requires components+variants (which we lack).
- Status: **Missing** (parity.md:94 `:hover` targets not built). Non-goal: prototyping (parity.md:178).
- HTML/CSS: map the variant model directly to pseudo-classes: a "State" switch in Properties (Default / Hover / Active / Focus / Disabled) writes into a helmet rule `<sel>:hover{...}`, `:active`, `:focus-visible`; plus `transition: all 150ms ease` (a Figma-default analogue [6]). Canvas "force state" via probe so the state is visible without hovering (like devtools :hov). Mouse leave is free (CSS reverts).
- Effort: M (needs the same "write to helmet rule" path as item 1; force-state in probe). Risk: no toggle/"saved" state (would need JS/classes) — skip those. Selector for elements with only inline styles.

### 5. Comments / annotations
- What: Comments pin to a canvas point/region, cluster when zoomed out; C enters comment mode (blocks edits), Shift+C hides; sidebar with search/sort/filter, @mentions, resolve, deleting a thread is permanent [3].
- Reliance: central for teams; with a local single-user tool, mostly notes-to-self and notes-to-Claude.
- Status: **Missing**; parity.md:178 lists comments under non-goals (multiplayer reasoning).
- HTML/CSS: do not write into the .dc.html. Store in a sidecar (`<canvas>.comments.json` next to canvas.json) anchored to a stable element key (path/id) plus offset, falling back to canvas coords. Optional: "send comment to Claude" which prompts a fix for that element.
- Effort: M. Risk: anchoring drift after edits (Figma pins to canvas, not layer [3]; element anchors are better for us but must survive structural edits).

### 6. Version history and named versions
- What: autosave checkpoint every 30 min; Save to Version History (Cmd+Opt+S) with title (<=25 chars shown) and description; viewing a snapshot read-only; restore is non-destructive (adds a checkpoint of current state first); duplicate from a version [1].
- Reliance: important safety net; we already have git underneath.
- Status: **Partial** — snapshot undo/redo and per-file diff with Revert file are built (parity.md:132-143); named versions/scrubber out of scope (parity.md:144).
- HTML/CSS: no CSS write. Implement as git tags/commits (or lightweight refs under `refs/design-editor/`): "Save version" = commit of canvas files with message title+description; list = `git log --format` for those commits; view = read blob at that rev (render in read-only artboard); restore = write blob via the existing atomic writer, which keeps undo (restore stays undoable, matching Figma's non-destructive restore [1]). Per Ron's rule, commit only when asked: the button is that ask.
- Effort: M. Risk: repo may not be git or may have dirty unrelated changes; commit only the canvas files (pathspec).

### 7. Image placement and fit (drag-drop, replace, object-fit)
- What: Figma image fills have Fill, Fit, Crop, Tile modes [4]; images are placed via drag-drop, paste, or Place Image (Shift+Cmd+K), multi-image drops are laid out in aligned rows of ten [7]; replacing an image should keep the mode.
- Reliance: very common; images are the commonest non-text content.
- Status: **Missing** (parity.md:93 image fills "Out of scope"). No `<img>`, `object-fit` or drop handling in src/ (grep).
- HTML/CSS mapping: Fill = `object-fit: cover`, Fit = `contain`, Crop = `object-fit: cover; object-position: X% Y%` (plus optional `aspect-ratio`), Tile = on a non-img box `background-image:url(); background-repeat:repeat; background-size:Npx`. Drop = copy the file into the canvas assets folder (collision-safe name) and splice `<img src="assets/x.png" alt="">` as child at the drop target (flex/grid-aware insertion); replace = swap `src` only, so `object-fit`/size stay (Figma's replace keeps mode [4 search result, unverified]). Background-image variant for frames: `background: url() center/cover`.
- Effort: M (drop endpoint writing binary + DOM insert op; fit/position fields S). Risk: path/relative-URL rules for blob stylesheets; large files; add `alt` (a11y).

## Recommended for v2 (ranked)
1. Image drop + replace + Fit control (`<img>`, `object-fit`/`object-position`, asset copy) — images are the biggest missing content type; spec maps 1:1 — M.
2. Resizable preview width with presets (375/768/1280), view-only — makes real `@media` testable and unblocks #3 — S.
3. Breakpoint editing into `@media` (max-width, override-only writes, "overridden at this width" indicator) — the Framer/Webflow core, matches CSS exactly — L.
4. Hover/active/focus state editor with force-state on canvas, writes `:hover`/`:active` + `transition` — M.
5. Named versions on git (save with title/description, list, view, non-destructive restore) — safety net using existing git/undo — M.
6. Present mode (full-window artboard at chosen width, arrow-step artboards, R reset) — S-M.
7. Comments sidecar with element anchors and "send to Claude" — M.
8. Side-by-side multi-viewport (same file at N widths) — M.

## Not worth it
- Flow starting points / prototype connections / Smart Animate / Change-to between frames [5][6] — cross-frame prototype graph has no HTML equivalent without JS; parity.md:178 non-goal.
- Toggle/"saved" button states (Mouse up toggling variants [6]) — requires JS or checkbox hacks; not stateless CSS.
- Device frames in Present [2] — cosmetic, not CSS.
- Multi-user comment features (mentions, Slack/Teams replies, notifications) [3] — single-user local tool.
- Figma image adjustments (exposure, temperature, tint) [4] — would be `filter:` chains; low payoff, defer (the CSS `filter` section is a separate area).
- Image downsampling >4000px [7] — Figma-internal performance, irrelevant.
- Webflow-style bidirectional upward breakpoints (1280/1440/1920) — rare; max-width desktop-first covers v2 (not verified from fetched pages).
