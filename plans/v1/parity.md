# Figma parity audit — v1 (branch implement/v1)

Audited 2026-11-23 against `research/00-figma-ideas.md`, `01–05`, `07–11` and `plan.md` (M1–M7, Non-goals, Next).
Every row was checked in `src/` and `test/`. README and plan text were not taken as proof.
**Built** means the code exists and a unit or e2e test exercises it. Paths are relative to the repo root.
Test shorthand: `cv` = `test/ui/canvas/canvas-view.test.tsx`, `pp` = `test/ui/panels/properties-panel.test.tsx`,
`al` = `test/ui/panels/auto-layout.test.ts`, `lp` = `test/ui/panels/layers-panel.test.tsx`, `e2e/mN` = `test/e2e/mN-*.spec.ts`.

Note: plan.md has no "Considered and rejected" section. Scope exclusions come from its Non-goals and Next lists.

## Canvas & navigation

| Feature | Planned in | Status | Evidence (impl · test) | Note |
|---|---|---|---|---|
| Iframe + overlay + transparent event shield | M1 | Built | `src/ui/canvas/CanvasView.tsx:486`, `:284` · `cv:635` | |
| Zoom about cursor: Cmd/Ctrl-wheel, trackpad pinch | M1 | Built | `CanvasView.tsx:270-286`, `src/ui/canvas/viewport.ts:42` · `cv:521`, `test/ui/canvas/viewport.test.ts:24` | A plain wheel pans |
| Space-drag pan; Hand tool (H) | M1 | Built | `CanvasView.tsx:445`, `:437` · `cv:552`, `cv:597`, `e2e/m1:174` | |
| Shift-1 fit board, Shift-2 zoom to selection | M1 | Built | `CanvasView.tsx:403-411`, `:426-427` · `cv:572`, `cv:619`, `e2e/m1:143` | |
| Zoom menu: in/out, 50/100/200% presets | R07 #16 | Built | `src/ui/TopBar.tsx:96`, `:112` · `test/ui/app.test.tsx:438` | Menu only: there are no Shift-0 or Cmd +/- keys (R07 #11) |
| Board switcher, selection and zoom kept per board | M1 | Built | `TopBar.tsx:69`, `src/ui/store.ts:10`, `:119` · `cv:483`, `test/ui/store.test.ts:44`, `app.test.tsx:423` | |
| Interact toggle (hold I / Preview switch) + "page reset" notice | M1 | Built | `CanvasView.tsx:450` · `cv:642`, `cv:656`, `cv:700`, `app.test.tsx:452` | |
| Offline-font banner | Goals | Built | `src/ui/App.tsx:75`, `:166`; `src/probe/probe.ts:227` · `e2e/m1:76` | |
| Rulers showing the selection range | plan Next (R07 #4) | Built | `CanvasView.tsx:511`, `:585` · `cv:868`, `cv:883` | Built early. Guides are not built (Next) |
| Multi-board side-by-side view | plan Next | Out of scope | — | One artboard is mounted at a time |
| Pixel grid (Cmd-'), outline view | M7 #7 | Not built | — | |

## Selection

| Feature | Planned in | Status | Evidence (impl · test) | Note |
|---|---|---|---|---|
| One hit-test for hover and click; hover outline | M1 | Built | `CanvasView.tsx:418`, `:432` · `cv:788`, `cv:804`, `cv:830` | |
| Click = smallest layer (an icon's `<svg>` is one layer), Cmd/Ctrl-click = enclosing layer, double-click on the selected text = edit it | M1 | Built | `src/ui/canvas/selection.ts:43-81`, `CanvasView.tsx:451` · `test/ui/canvas/selection.test.ts:83-186`, `cv:814`, `cv:863-898`, `cv:973-1016`, `e2e/m1:51` | Differs from Figma, where a click picks the top level and Cmd-click the deepest (Ron, 2026-11-24) |
| Shift-click add/remove; ancestors of selected elements dropped | M1, M5 | Built | `selection.ts:71`, `store.ts:126` · `selection.test.ts:188-210`, `cv:900-932`, `store.test.ts:72-88` | |
| Enter / Shift-Enter / Tab / Shift-Tab / Esc | M1 | Built | `selection.ts:80-104`, `CanvasView.tsx:428-436` · `selection.test.ts:212-243`, `cv:934`, `cv:945`, `cv:1354` | |
| Hit-test skips locked layers | M5 | Built | `selection.ts:48` · `selection.test.ts:56-113`, `cv:846` | |
| Marquee select | R00 Next | Not built | — | Not scheduled in any milestone |
| Select matching (Opt-Cmd-A) | M7 #7 | Not built | — | |

## Move / resize / snap / measure

| Feature | Planned in | Status | Evidence (impl · test) | Note |
|---|---|---|---|---|
| Dragging an absolute element writes left/top in the authored unit | M3 | Built | `src/ui/canvas/tools/move.tool.ts:71`, `:88`, `:308` · `test/ui/canvas/move-tool.test.ts:125-166`, `e2e/m3:131` | |
| Dragging a flex/grid child reorders it, with an insertion line | M3 | Built | `move.tool.ts:121`, `:356` · `move-tool.test.ts:396-434`, `e2e/m3:166` | |
| Dragging a transformed element edits only the translate term | M3 | Built | `move.tool.ts:95` · `test/ui/canvas/move-mapping.test.ts:69-73`, `move-tool.test.ts:469-477` | No e2e |
| 3–4 px drag threshold | M3 | Built | `move.tool.ts:56`, `:79` · `move-tool.test.ts:196-205`, `e2e/m3:147` | |
| Arrow nudge 1 px, Shift 10 px | M3 | Built | `move.tool.ts:62-68`, `:453-472` · `move-tool.test.ts:504-558`, `e2e/m3:147` | Single selection only; flex children are not nudged |
| Moving several selected elements | Figma basic (not planned) | Not built | `move.tool.ts:178` (null for 2+) · `move-tool.test.ts:246` | The move tool ignores multi-selections |
| 8 resize handles, box-sizing respected, live size label | M3 | Partial | `src/ui/canvas/tools/resize.tool.ts:8`, `:50`, `:59`, `:116` · `test/ui/canvas/resize-tool.test.ts:96`, `:207`, `:223`, `e2e/m3:251`, `:275` | Always writes whole `px` (`:136`): a rem/% width becomes px (R00 says keep units). No Shift (aspect) or Alt (from centre) |
| Warning when flex sizing overrides a resize | M3 | Built | `resize.tool.ts:33`, `:140` · `resize-tool.test.ts:314-388`, `e2e/m3:296` | |
| Artboard root handles disabled | M3 | Built | `resize.tool.ts:32`, `:69` · `resize-tool.test.ts:121`, `e2e/m3:310` | |
| Snap to sibling/parent edges and centres (8 screen px ÷ zoom), guides, Ctrl bypass, rects read once | M3 | Built | `src/ui/canvas/snap.ts:33`, `:64`; `move.tool.ts:348` · `test/ui/canvas/snap.test.ts`, `move-tool.test.ts:288`, `:353-382`, `e2e/m3:188`, `:206`, `:225` | Move only: resize does not snap |
| Alt-hover red distance lines labelled margin / padding / gap | M3 | Built | `src/ui/canvas/tools/measure.tool.ts:46-113` · `test/ui/canvas/measure-tool.test.ts:70-97`, `e2e/m3:328`, `:350` | |
| Equal-gap snapping, align / distribute | R00 Next | Not built | — | Not scheduled |
| Rotation | R00 Next | Partial | `src/ui/panels/sections/position.section.tsx:93` · `pp:627` | Panel field only. No canvas handle or Shift-15° |
| Alt-drag to duplicate | M7 #7 | Not built | — | |

## Auto layout

| Feature | Planned in | Status | Evidence (impl · test) | Note |
|---|---|---|---|---|
| Add auto layout (`display:flex`) | M4 | Built | `src/ui/panels/sections/layout.section.tsx:136` · `al:313`, `e2e/m4:67` | No "remove auto layout" control |
| Direction | M4 | Built | `layout.section.tsx:158` · `al:321-331`, `e2e/m4:67` | |
| Gap and padding fields | M4 | Built | `layout.section.tsx:178`, `:212` · `al:340`, `al:349` | |
| 9-dot alignment (axes swap in a column) + separate "stretch" state | M4 | Built | `src/ui/panels/auto-layout.ts:40`, `:75`, `:85`; `layout.section.tsx:181`, `:197` · `al:364-449`, `e2e/m4:67` | |
| Space-between | M4 | Built | `layout.section.tsx:201` · `al:461` | |
| Hug / Fill / Fixed per axis | M4 | Built | `auto-layout.ts:94`, `:121`; `layout.section.tsx:227` · `al:471-562`, `e2e/m4:67` | |
| Min/max in any unit + content-box max warning | M4 | Built | `layout.section.tsx:267`, `:354` · `al:576-606` | |
| On-canvas padding drag (Alt = opposite sides, Alt-Shift = all) | M4 | Built | `src/ui/canvas/tools/padding.tool.ts:52`, `:64`, `:84` · `test/ui/canvas/padding-tool.test.ts:50-87`, `al:698-726` | No e2e |
| Ignore auto layout (absolute + relative parent, warning) | M4 | Built | `layout.section.tsx:312`, `:362` · `al:617-640` | |
| Gap handles on canvas, flex-wrap, constraints widget | R00 Next | Not built | — | Not scheduled |
| CSS grid editing | Non-goals | Out of scope | — | |

## Properties panel

| Feature | Planned in | Status | Evidence (impl · test) | Note |
|---|---|---|---|---|
| Selector chip with `file:line`; pick a `<helmet><style>` rule | M1, M2 | Built | `src/ui/panels/PropertiesPanel.tsx:142`, `:168` · `pp:281`, `pp:290`, `e2e/m1:39` | |
| Warning when a class is shared by other elements | R00 arch, README | Partial | `PropertiesPanel.tsx:225` · `pp:305` | Only the `<sc-for>` "affects N repeats" notice exists. Picking a shared `<helmet>` rule gives no warning |
| "Overridden by `.y`" check after a write | M2 | Built | `src/ui/panels/fields.tsx:140-157` · `pp:319-341`, `e2e/m2:100` | |
| Number inputs: arrow steps (Shift 10), authored unit kept, no px on unitless props | M2 | Built | `src/ui/panels/css-values.ts:25`, `:39`, `:68`; `fields.tsx:381` · `test/ui/panels/css-values.test.ts:12-70`, `pp:366-399` | |
| Drag-to-scrub, maths in inputs | R00 Next | Not built | — | |
| Solid colour: hex/HSL + alpha, authored format kept, no sRGB clamp | M2 | Partial | `fields.tsx:442`; `css-values.ts:161`, `:188` · `pp:482-524`, `css-values.test.ts:78-120` | Text fields and a swatch only: no visual picker (HSB square, hue slider, model switch) and no eyedropper |
| Opacity, radius | M2 | Built | `src/ui/panels/sections/style.section.tsx:25` · `pp:535`, `pp:297` | One radius value: no per-corner radius |
| Stroke (border colour + width) | M2 | Built | `style.section.tsx:38` · `pp:535` | No border style, no per-side borders |
| Shadow list | M2 (R00: inset, reorder) | Partial | `style.section.tsx:47` · `pp:554-573` | Lists and removes only. No add, edit, inset or reorder |
| Typography (family, weight, size, line-height, letter-spacing) | M2 | Built | `style.section.tsx:124` · `pp:382`, `pp:535` | No text-align, decoration or case |
| Text-box trim toggle (with CSS.supports check) | M2 | Built | `style.section.tsx:82`, `:101` · `pp:644-680` | |
| X/Y for positioned elements; read-only placement in auto layout | M2, R00 | Built | `position.section.tsx:77-93` · `pp:609`, `pp:617` | |
| Fixed section order | M2 | Built | `PropertiesPanel.tsx:15` · `pp:781-798` | |
| Double-click text edit in place (plaintext-only, cancels on redraw, refuses `{{holes}}`) | M2 | Built | `src/probe/probe.ts:162`, `:167`; `CanvasView.tsx:340`; `src/server/edit/text-splice.ts:168` · `test/probe/probe-unit.test.ts:432`, `:447`, `cv:834-868`, `cv:1123`, `test/server/edit/patch-engine.test.ts:243`, `e2e/m2:152` | Text with inline children shows "edit in source" (by design) |
| Multi-edit: "Mixed", one op, one undo | M5 | Built | `fields.tsx:170` · `pp:688`, `pp:698`, `e2e/m5:166` | |
| Gradients, image fills | Non-goals | Out of scope | — | |
| Blur/backdrop-filter, `@media`/`:hover` targets, CSS tab, contrast badge | R00 Next | Not built | — | `@media` editing is plan Next |

## Tokens

| Feature | Planned in | Status | Evidence (impl · test) | Note |
|---|---|---|---|---|
| Token picker from `tokens.json`, `:root` fallback writes `var()`, hidden with no tokens | M5 | Built | `fields.tsx:331`, `:335` · `pp:711-739`, `e2e/m5:253`, `test/server/editor-services.test.ts:106` | |
| Bound-token pill; typing a raw value detaches only that element | M5 | Built | `fields.tsx:318-322`, `:466` · `pp:748-762` | |
| Tokens tab listing names and values | shell | Built | `src/ui/panels/TokensPanel.tsx:10` · `app.test.tsx:524` | |
| "Edit token" as an explicit action | M5 | Not built | — | `tokens.json` is read-only and no edit action exists |
| Token create/rename; token usage map | R00 Next, M7 #3 | Not built | — | |
| Light/dark modes | Non-goals | Out of scope | — | |

## Layers

| Feature | Planned in | Status | Evidence (impl · test) | Note |
|---|---|---|---|---|
| Template-tree layers (`sc-for` as one row, `sc-for`/`sc-if` labelled, `dc-import` leaf, unrendered rows dimmed) | M1 | Built | `src/ui/panels/LayersPanel.tsx:53`, `:144` · `lp:248-300` | |
| Names: `data-layer-name` → id → class → tag | M1 | Built | `src/server/source/template-tree.ts:62-65` · `lp:248` | |
| Two-way selection sync | M1 | Built | `LayersPanel.tsx:238` · `lp:368`, `lp:376`, `app.test.tsx:342`, `e2e/m1:39` | |
| Drag reorder/reparent; forbidden parents greyed | M5 | Built | `LayersPanel.tsx:102`, `:201-236` · `lp:390-458`, `e2e/m5:134` | |
| Hide / lock, editor-only (`.editor/state.json`); hide applied at serve time | M5 | Built | `LayersPanel.tsx:243`; `src/server/serve/serve-transform.ts:56`; `src/server/editor-state.ts:10` · `lp:468-490`, `test/server/serve/serve-transform.test.ts:173`, `editor-services.test.ts:126`, `e2e/m5:267` | |
| Layer search (Cmd-F) | R00 Next | Built | `LayersPanel.tsx:65`, `:70`, `:189` · `lp:330-356` | Built early |
| Collapse all layers | R07 #13 | Not built | — | Rows collapse one at a time |

## Structure ops

| Feature | Planned in | Status | Evidence (impl · test) | Note |
|---|---|---|---|---|
| Wrap in container (Mod-G) | M5 | Built | `src/server/edit/structural-ops.ts:263`; `src/ui/actions/layer.actions.ts:47-53` · `test/server/edit/structural-ops.test.ts:272`, `test/ui/actions/layer-actions.test.ts:154`, `e2e/m5:216` | |
| Ungroup (Mod-Shift-G) | M5 | Built | `structural-ops.ts:265` · `structural-ops.test.ts:302-313`, `layer-actions.test.ts:163`, `e2e/m5:216` | |
| Duplicate (Mod-D), ids stripped, fresh edIds | M5 | Built | `structural-ops.ts:195`, `:226` · `structural-ops.test.ts:232-257`, `layer-actions.test.ts:172`, `e2e/m5:134` | |
| Delete | M5 | Built | `structural-ops.ts:246`; `layer.actions.ts:58` · `structural-ops.test.ts:320`, `e2e/m5:239` | Bound to `Delete` only. The Mac delete key sends Backspace, which does nothing |
| Guards: void parent, cycles, HTML content model (p, headings, button, li, tables, nested a/form) | M5 | Built | `structural-ops.ts:69-76`, `:103`; `src/shared/content-model.ts:97` · `structural-ops.test.ts:158`, `:165`, `:332-398`, `e2e/m5:216` | |
| Warning when a move changes positional selector matches | M5 | Built | `structural-ops.ts:115`, `:323` · `structural-ops.test.ts:201-226`, `layer-actions.test.ts:234` | |
| Copy/paste style (authored declarations, toast) | M5 | Built | `src/ui/actions/style-clipboard.actions.ts:12-45` · `layer-actions.test.ts:257-323` | No e2e |
| Components/variants, "edit all identical" | Non-goals / R00 Next | Out of scope | — | |

## Undo / history / write-back

| Feature | Planned in | Status | Evidence (impl · test) | Note |
|---|---|---|---|---|
| Snapshot undo/redo, byte-identical | M2 | Built | `src/server/edit/undo-log.ts:49`; `src/server/edit/writer.ts:119` · `test/server/edit/undo-log.test.ts`, `e2e/m2:120` | |
| One entry per drag/typing burst or multi-target op | M2, M5 | Built | `writer.ts:70` · `undo-log.test.ts:198`, `:214`, `:230`, `e2e/m3:275` | |
| Style-only undo without a reload | M2 | Built | `src/server/session.ts:157` · `test/server/session.test.ts:428`, `app.test.tsx:604` | |
| Outside edits reconciled, that file's undo dropped, own writes ignored | M2 | Built | `src/server/watch/reconcile.ts:40`, `src/server/watch/watcher.ts:46` · `session.test.ts:444`, `:463`, `test/server/watch/watcher.test.ts:135` | |
| Save toast with Undo + Diff | plan UI | Built | `App.tsx:326`, `:362` · `app.test.tsx:645-666` | |
| Per-file diff panel with "Revert file" | M5 | Built | `src/ui/DiffPanel.tsx:26`; `session.ts:201` · `test/ui/diff-panel.test.tsx:70-118`, `session.test.ts:838`, `e2e/m2:136`, `e2e/m5:197` | |
| Byte-exact splices: zero-byte untouched diff, one-line edit, CRLF/BOM kept | M2 | Built | `src/server/edit/patch-engine.ts:163`, `text-splice.ts` · `test/server/edit/golden.test.ts:130-147`, `e2e/m2:62`, `:78` | |
| Locked-file retry (Windows) | M2 | Built | `src/core/atomic-write.ts:15` · `test/server/edit/writer.test.ts:237`, `test/core/atomic-write.test.ts` | |
| Named versions / version scrubber | R00 Next, plan Next | Out of scope | — | |

## Sync

| Feature | Planned in | Status | Evidence (impl · test) | Note |
|---|---|---|---|---|
| `edsync` pull/ingest, three-way merge, stop on conflict, send nothing | M6 | Built | `src/edsync/merge.ts:83`, `src/edsync/classify.ts:105`, `src/edsync/cli.ts:269` · `test/edsync/merge.test.ts:62-124`, `test/edsync/classify.test.ts:96-119`, `test/edsync/loop.test.ts:205` | Tested against a fake remote only. The M6 exit (a live loop on a throwaway canvas) has not run |
| Push lock: lease, editor read-only during push | M6 | Built | `src/core/push-lock.ts`, `session.ts:287` · `test/core/push-lock.test.ts`, `session.test.ts:538`, `:620`, `loop.test.ts:172`, `app.test.tsx:565` | |

## Keyboard shortcuts

| Feature | Planned in | Status | Evidence (impl · test) | Note |
|---|---|---|---|---|
| Action registry `{id,label,kbd,run,when}`; Mod = Cmd/Ctrl; paused during text edit | M7 (built early) | Built | `src/ui/actions/registry.ts:45` · `test/ui/registry.test.ts:27-109` | |
| Figma-matching keys: Mod-Z / Mod-Shift-Z, Mod-G, Mod-Shift-G, Mod-D, Mod-Shift-H, Mod-Shift-L, Mod-Alt-C/V, Shift-1/2, V, H, Space, I, Enter, Tab, Esc, arrows, Mod-F | M1–M5 | Built | `history.actions.ts:5-8`, `layer.actions.ts:47-61`, `style-clipboard.actions.ts:39-45`, `CanvasView.tsx:424-441` · `layer-actions.test.ts:154-200`, `app.test.tsx:753`, `e2e/m2:120`, `e2e/m5:267` | |
| Other common Figma keys: Backspace delete, Shift-A auto layout, Mod-A, Mod-]/[, Mod-C/V/X layers, Shift-0, Mod +/- | not planned | Not built | — | |

## Beyond Figma (M7, below the cut line)

| Feature | Planned in | Status | Evidence | Note |
|---|---|---|---|---|
| Command palette (Mod-K) | M7 #1 | Not built | — | The registry it needs already exists |
| Ask Claude about the selection | M7 #2 | Not built | — | |
| Token usage map | M7 #3 | Not built | — | |
| Accessibility overlay (axe) | M7 #4 | Not built | — | |
| Responsive multi-viewport | M7 #5 | Not built | — | |
| Visual diff before push | M7 #6 | Not built | — | |
| Spacing overlays, select matching, outline view, pixel grid, Alt-drag duplicate | M7 #7 | Not built | — | |
| Export selection as PNG | M7 #8 | Not built | — | |

## Other exclusions (Non-goals / plan Next)

| Feature | Planned in | Status | Evidence | Note |
|---|---|---|---|---|
| Multiplayer, comments, prototyping, animation | Non-goals | Out of scope | — | |
| Ruler guides (drag out, snap) | plan Next | Out of scope | — | Guides live in `canvas.json`, which v1 never writes |
| Breakpoint editing into `@media` | plan Next | Out of scope | — | |
| Presentation mode, plugins, SVG export | plan Next | Out of scope | — | `src/ui/plugin-api.ts` is an internal tool/section API, not plugins |

**Counts:** Built 71 · Partial 5 · Not built 21 · Deliberately out of scope 10 (107 rows).

## Gaps worth doing next

Ranked by how much a Figma user would miss each one.

1. **Backspace deletes a layer** (the Mac delete key does nothing now) — S
2. **Move, nudge and resize several selected elements together** (the move tool ignores multi-selections) — M
3. **Marquee select** by dragging on empty canvas — M
4. **A real colour picker** (HSB square, hue/alpha sliders, eyedropper) on top of the current text fields — M
5. **Align / distribute** for multi-selections, plus Shift-A to add auto layout and a "remove auto layout" control — M
6. **Resize keeps the authored unit** (rem/%), snaps like move does, and supports Shift (aspect) and Alt (from centre) — M
7. **Editable shadow list** (add, edit, inset, reorder) and per-corner radius — S
8. **Command palette (Mod-K)** over the existing action registry, plus copy/paste of layers (Mod-C/V) — S
