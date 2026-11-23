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
