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
