# implement log — Design Editor v2 — the Figma features people reach for next

Records what each wave built and where it departed from the plan.

## Wave 1 (2026-11-23)
- t1 C1 undo boundary per user action: actionId, Writer seal, UndoLog fold, validators, ack/rejection handling — EditOp gains optional actionId and the kinds removeAttr and insertHtml; wrapNode gains style; StyleSource gains range; supersedeKeyOf is shared. client-message validates the new ops. UndoLog.record folds same-actionId records into one entry. Writer seals open batches when the action changes and flushAll drains sealed batches in order, one write and one undo record each. ws-client treats superseded acks as resolved and groups rejections per action (one toast, at most one reload).
  deviated: the Writer seals writer-wide (all files) when the action changes, not per file, following the plan's Final fold-in; one action over several files is one batch per file folded into one entry by UndoLog.record.
  deviated: flushAll seals open batches at the start of every flush, so the open action continues in a new batch that folds through UndoLog.
  deviated: supersedeKeyOf moved from writer.ts to src/shared/types.ts so ws-client can share it.
  deviated: test/server/session.test.ts 'names every declaration a multi-declaration style-only undo restored' needed its two ops sent under one actionId, since id-less ops no longer share an entry.

## Wave 2 (2026-11-23)
- t2 C3a PatchEngine: insertHtml with allow-list, removeAttr, styled wrapNode, coalesced declaration lists — insertHtml is planned through structural-ops and a new insert-html.ts allow-list (elements, attributes, URL schemes, ids renamed per paste, data-bound content refused). removeAttr deletes an attribute with its leading whitespace. wrapNode takes a style that goes into the wrap's start tag. Each inline style or rule folds all setDecl/removeDecl of a flush into one splice; the CSS helpers moved to text-splice. apply runs flush.finish() inside the try so a Refusal becomes {ok:false}.
  deviated: referenced ids are renamed with a per-paste `${mintId()}-` prefix and unreferenced ids dropped (the Final fold-in), not stripped as copyWithoutIds does; the prefix costs one session id and is not in `minted`.
  deviated: insert-html also refuses any tag, comment or declaration the fragment parse dropped, because the whole-tree shape check misses parser fix-ups like `<p><div>` and `a<body onload=x>b`.
  deviated: a pasted table whose `<tr>` gains an implied `<tbody>` is accepted, not refused; no test covers it.
  deviated: appending (before: null) indents like the parent's end tag, not like the last child.
  deviated: a style attribute containing a backslash (CSS escape) is refused, an allow-list rule the plan does not list.
- t3 C3b index source text and rules, probe setEditorStyles and new reads — BoardIndex carries the board's source text and helmet rules (StyleSource with range); BoardView gains previewWidth. The probe adds or removes an editor-only stylesheet on setEditorStyles and answers the `matches` and `documentHeight` reads; probe-schema and probe-client carry them.

## Wave 3 (2026-11-23)
- t4 C2a action registry (aliases, key matching, scopes, hold) and canvas context setters — EditorAction gains kbd (one or more aliases), scope, inTextEntry, hold and disabledReason; run takes the action id. EditorContext gains setMode, fit, cancelGesture, setEditorState, beginAction and apply/preview. The registry binds every alias, matches keys by event.key with a code fallback for non-ASCII layouts, checks scopes (canvas, layers, global) and text entry before matching, prevents in-scope chords, toasts a disabledReason, and releases hold actions on keyup and blur. canvas.actions.ts holds the nine canvas-scoped actions. CanvasView exposes its context through onContext and onEditorStateChange, mints action ids with crypto.randomUUID, and honours a per-board previewWidth (frame, board fit and size label, with the content height measured once per frame load).
  deviated: canvasContext keeps its 4-argument form with the view controls as an optional fifth argument (DETACHED_VIEW no-ops), and onContext and onEditorStateChange are optional props, so App.tsx still compiles until t5 switches it over.
  deviated: the registry accepts keydown events with no element target and calls getModifierState with optional chaining, because layer-actions.test.ts feeds plain-object events in node.
  deviated: ShellSlot and ShellSlotProps exist only as types (the registry test needs them); EditorPlugin has no shellSlots field.
  deviated: the frame's fit uses the displayed frame size (preview width times grown height), not only the effective width.
  deviated: dead keys (macOS Option+E/U/I/N) count as named keys and never fall back to the code.

## Wave 4 (2026-11-23)
- t5 C2b App shell: registry routing, focus return, shell slots, editor-state setter — App keeps the context CanvasView hands back through onContext and passes onEditorStateChange. Every keydown goes to registry.handleKeyDown, keyup to handleKeyUp and window blur to handleBlur. New optional slots prop (default defaultShellSlots, loaded from src/ui/shell/*.slot.tsx) renders top-bar slots after ZoomMenu and overlay slots at the end of .app. A click in the properties panel on a non-text control returns focus to the canvas viewport. Preview widths persist next to zoom, pan and selection through withPreviewWidths.
  deviated: src/ui/store.ts is unchanged; the preview width is persisted in App because CanvasView reads it from editorState.boards[path].previewWidth.
  deviated: App keeps isTextEntry, now only for the focus-return check, not for gating keydown.
  deviated: focus return finds the panel with the selector aside.props and also checks document.activeElement.
  deviated: top-bar slots sit right after the zoom menu, a placement the plan leaves open.
- t14 M10 colour picker and field action ids (preview, hold-step) — New colour.ts (notation, hsva, oklch gamut mapping), hold-step.ts (useHeldStep, one action id per held key) and colour-picker.tsx (square, hue and alpha sliders, notation select, outside-sRGB badge, EyeDropper when available; drag previews, one write on release, Escape restores). Declaration gains preview and an optional actionId on write; TextInput steps through useHeldStep; ColourField renders ColourPicker.
  deviated: a colour field bound to var(--token) still shows the token pill and no swatch button, so the picker cannot open from it.
  deviated: choosing a notation in the menu writes nothing; it only sets the notation the next write uses.
  deviated: the picker writes modern comma-free notation even when the authored value used legacy commas.
  deviated: oklch is written with 4 decimals for L and C and 2 for H, and isOutsideSrgb allows 0.001 slack per channel.

## Wave 5 (2026-11-23)
- t6 M8 layer commands: Backspace delete, ungroup alias, toggles via setEditorState, Frame selection, z-order — Backspace deletes like Delete, Mod+Backspace ungroups, toggles go through setEditorState, Frame selection sends one styled wrapNode with an inferred auto layout (new infer-layout.ts), and the z-order keys move absolute layers in the DOM or write z-index for flex/grid items, with per-platform keys via kbdByPlatform.
  deviated: per-platform kbd uses Ron's new EditorAction.kbdByPlatform field in plugin-api.ts and registry.ts; only the Windows override is spelled out and macOS falls back to kbd.
- t7 M8 command palette (Mod-K, Mod-/) — palette.open action, fuzzy matching over actions and layers in palette.ts, and an overlay dialog slot with combobox and listbox.
  deviated: the QWERTZ assertion needed a fix in registry.ts mayMatchCode, made by Ron rather than this task.
- t8 M8 layer copy / cut / paste and Copy as CSS / HTML — clipboard events handled by an overlay slot, with source-HTML slicing, a private MIME and paste-target rules in clipboard.ts, plus Copy as CSS and Copy as HTML actions. writer.ts acks now count insertHtml as structural so pasted layers get selected.
- t10 M9 multi-selection tracking, group move and arrow nudges as hold actions — move.tool tracks every selected box and moves several absolute elements together under one action id; arrow and Shift+arrow nudges are hold actions in nudge.actions.ts.
  deviated: a flex-child reorder is sent without the press's actionId (still one undo entry).
  deviated: selectedBox() keeps its single-element meaning for resize.tool; the union rect is internal to move.tool.
  deviated: the mixed-selection toast fires on drag release and on the nudge keypress; the plan gives no timing.
- t13 M9 align / distribute and flip — align.ts maths, align.actions.ts (Alt-A/H/D/W/V/S, Alt-Shift-H/V) and flip.actions.ts (Shift-H/V, negating authored scale).
  deviated: when() checks only the synchronous part; an align that does not apply shows the disabledReason toast from run.
  deviated: no same-parent check on aligned siblings; board-px deltas apply to each element's own anchored inset.
  deviated: a single absolute element aligns to its own bounds as a silent no-op.
- t15 M10 appearance, stroke, shadows and effects — shadows.ts, radius.ts and effects.ts plus Appearance, Stroke and Effects controls in style.section (independent corners and sides, shadow list, layer and background blur, blend mode).
  deviated: multi-property split and join build ops in style.section and call ctx.apply directly, skipping the override-warning check, since Declaration.remove takes no actionId.
  deviated: shadow length inputs use a local LengthInput without arrow-key stepping, since TextInput is not exported.
  deviated: unparseable box-shadow shows raw text with a remove button only.
  deviated: new shadow layer defaults to 0 4px 12px rgb(0 0 0 / 25%).
- t16 M10 text controls and M11 image fit sections — text-layout.ts, a Text section (alignment, case, decoration, italic, wrap style, resizing, max lines) and an Image section (object-fit, object-position).
  deviated: Auto width also removes an authored height.
  deviated: the max-lines flex/grid warning is a toast, not an inline note.
  deviated: case, decoration and wrap style are mutually exclusive toggles; Max lines uses its own input without arrow stepping.
- t18 M11 layers panel: rename, collapse all, type icons, Mod-F in the registry — layers-panel.actions.ts (Mod+F find, Alt+L collapse all), layer-icons.tsx type icons, double-click rename with Enter, Escape and Tab, and Alt-click subtree collapse.
  deviated: Collapse all leaves the artboard root expanded.
  deviated: blur commits a rename and Shift-Tab does not move backwards.
  deviated: dc-import rows cannot be renamed; root rows show the frame icon.
- t19 M11 zoom keys, outline mode and the preview-width control — stepZoom, zoom and outline actions, a zoom percentage field in TopBar, an outline overlay slot and a preview-width slot with presets and a custom field.
  deviated: the board's own width is read from data-board-width on BoardSwitcher tabs (boardWidthOf), since neither BoardIndex nor EditorContext carries it.
  deviated: the 'Edits apply to all widths' bar floats over the canvas with fixed positioning, not as a row above the board.
  deviated: outline mode is a module-level flag in view.actions.ts, not editor state.

## Wave 6 (2026-11-23)
- t9 M8 select all / invert and the Electron Edit menu — select.all (Mod+A) and select.invert (Mod+Shift+A) pick unlocked, visible element children of the last-selected element's parent (or the artboard root). A select-all overlay slot replays Mod-A through the registry for the Electron menu's cancelable editor:select-all event; src/desktop/menu.ts holds menuTemplate with a Select All item replacing the role, and scripts/electron-suite.mjs runs in installers.yml after the smoke step.
  deviated: the slot replays a Mod-A chord through registry.handleKeyDown instead of calling the action, so the registry's text-entry, scope and text-editing gates decide.
  deviated: only children with kind 'element' are selectable; sc-for, sc-if and dc-import children are excluded.
  deviated: scripts/electron-suite.mjs was not run locally; its fixture assumptions (hero h1/p/img siblings, role-item click paste adding a second h1) are unverified.
- t11 M9 marquee select — marquee.tool (priority 0) claims every press, hit-tests, draws a marquee over container backgrounds and hands leaf presses to the move tool; selection.ts gains isMarqueeContainer, marqueeSelection and MarqueeCandidate.
  deviated: container test and candidate rects are read per child, not as one batched probe read.
  deviated: a childless hit is decided without a display read so a click selects as soon as the hit lands.
  deviated: Shift is taken from the press; a candidate's first rect is its rect; locked or hidden children are not filtered from candidates.
- t12 M9 resize keeps units, takes modifiers and snaps edges — resize writes width and height in the authored unit via units.ts toAuthoredUnit, snapEdges snaps only moving edges, Shift keeps ratio, Alt centres (absolute or fixed only), and all writes share one action id.
  deviated: authored keywords such as auto are written as px without a toast; the warning toast is for calc() and viewport units.
  deviated: guideMark is copied into resize.tool since move.tool keeps it private.
  deviated: rem converts with the artboard root's computed font-size, because probe reads are keyed by edId.
  deviated: Shift+Alt scales around the centre on both axes, insets are written only in Alt mode, and a snap mirrors the opposite edge under Alt.
- t17 M10 auto layout: wrap, spacing modes, baseline, Shift-A / Alt-Shift-A — layout section gains Wrap, Row and Column gap, align-content, a Spacing mode select and Baseline; layout.add-auto-layout (Shift+A) infers a flex container from the children and layout.remove-auto-layout (Alt+Shift+A) removes the authored layout properties. applyWrites is now synchronous and takes an action id.
  deviated: the Space between toggle is replaced by the Spacing mode menu, and Baseline takes its slot.
  deviated: Shift-A always writes flex-direction and ignores absolute or fixed children.
  deviated: Alt-Shift-A removes only inline-style declarations, also removes the v2 wrap properties, and uses scope ['canvas','layers'] rather than 'global'.
- t20 M11 read-only Code tab — PropertiesPanel gains Design and Code tabs; CodeTab shows the inline style and matched rules with file:line, state or pseudo-element label, media condition and exact source, each with a copy button, via code-rules.ts codeBlocksOf and the probe's matches read.
  deviated: for a multi-layer selection the Code tab shows the first selected element only.
  deviated: the inline block's button reads "Copy declarations", and the copy buttons are text buttons since the icon set has none.
