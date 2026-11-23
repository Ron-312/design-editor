# implement log — Design Editor v1 (M0 stand-in through M6)

Records what each wave built and where it departed from the plan.

## Wave 1 (2026-11-23)
- t1 Scaffold repo and declare shared contracts — package.json, configs, CI workflow, check/e2e/build scripts, and shared contracts (src/shared/types.ts, protocol.ts, sync.ts, src/ui/plugin-api.ts).
  deviated: ESLint 10 needs Node ^22.13, one patch above the plan's 22.12 floor (dev-only; ESLint 9 is deprecated). write-file-atomic pinned to ^7 (v8 needs Node 22.22). TypeScript ~6.0 because typescript-eslint's peer range rules out TS 7.
  deviated: could not find "Ron's adjustment (1)" in the plan or repo; plugin-api.ts is read as an extension contract where each UI feature is its own plugin, with registry entry {id, label, kbd, run, when} taken from M7. Revisit if the adjustment meant something else.
  deviated: EditRecord gains `files: ProjectPath[]` for the per-file diff panel.
  deviated: EditOp is {target: EdId[], kind, payload}; setDecl/removeDecl carry an optional `rule`; moveNode uses {parent, before: EdId | null} instead of an index.
  deviated: PushLock timestamps are epoch milliseconds.
  deviated: `npm run build` fails until src/ui/index.html exists and `npm run e2e` fails until scripts/start.mjs exists, so CI fails at those steps until later tasks land. `npm run check` passes.

## Wave 2 (2026-11-23)
- t2 M0 stand-in: canvas fixtures, runtime stand-in, 06 format note — canvas fixture project and fetched blobs, edge-ending fixtures, a runtime stand-in (fetched/support.js), and plans/v1/research/06-project-format.md.
  deviated: could not find "Ron's adjustment (2)" in the plan or repo; read it as M0 running as a stand-in with no live checks.
  deviated: sc-if `when`, sc-for `as`, dc-import mounting, and the tokens.json leaf shape are assumptions not found in the documented format; marked as assumed in 06.
  deviated: the tokens.json-picks-write-the-literal decision is the stand-in default the tests need, not an observation of the Theme menu.
  deviated: card.dc.html is also listed as a board in canvas.json (360x220); the plan does not say whether imported components are boards.
- t10 M1 UI plumbing: probe client, ws client, store, action registry — probe schema validation, MessageChannel probe client, ws client with ack-vs-preview check, per-board editor store, and the keyboard action registry.
  deviated: a `restored` message reloads the frame only when `reload` is set; the ack-vs-live check for undo previews has to be added by the task that wires undo previews.
  deviated: `rejected` also reloads the frame when the op had previewed values.
  deviated: during a push lock, sendOp is refused rather than queued, since a push can rewrite files and queued ids would go stale.
