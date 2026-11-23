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
