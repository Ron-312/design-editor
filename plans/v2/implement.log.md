# implement log — Design Editor v2 — the Figma features people reach for next

Records what each wave built and where it departed from the plan.

## Wave 1 (2026-11-23)
- t1 C1 undo boundary per user action: actionId, Writer seal, UndoLog fold, validators, ack/rejection handling — EditOp gains optional actionId and the kinds removeAttr and insertHtml; wrapNode gains style; StyleSource gains range; supersedeKeyOf is shared. client-message validates the new ops. UndoLog.record folds same-actionId records into one entry. Writer seals open batches when the action changes and flushAll drains sealed batches in order, one write and one undo record each. ws-client treats superseded acks as resolved and groups rejections per action (one toast, at most one reload).
  deviated: the Writer seals writer-wide (all files) when the action changes, not per file, following the plan's Final fold-in; one action over several files is one batch per file folded into one entry by UndoLog.record.
  deviated: flushAll seals open batches at the start of every flush, so the open action continues in a new batch that folds through UndoLog.
  deviated: supersedeKeyOf moved from writer.ts to src/shared/types.ts so ws-client can share it.
  deviated: test/server/session.test.ts 'names every declaration a multi-declaration style-only undo restored' needed its two ops sent under one actionId, since id-less ops no longer share an entry.
