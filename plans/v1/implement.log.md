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

## Wave 3 (2026-11-23)
- t3 M1 SourceIndex: byte-exact parse, ids, template tree, style index — bytes.ts (decode/encode, EOL, lineLocator), source-index.ts (stable edIds bound by start offset, locate, flags), template-tree.ts, style-index.ts (inline and helmet rules, hole-safe PostCSS), and shared/paths.ts.
  deviated: RuleIds are minted fresh on every indexFile call; only edIds carry over between re-indexes.
  deviated: a helmet with several style blocks is one rule sequence in source order when findRule counts the order.
  deviated: textEditable is false for script and style even with a single text node.
  deviated: readOnly 'artboard-root' is not set on the x-dc root row; the plan does not tie it to the SourceIndex.
- t11 M1 canvas: viewport, shield, overlay, selection, board switcher — CanvasView.tsx, viewport.ts, overlay.ts, selection.ts in src/ui/canvas/.

## Wave 4 (2026-11-23)
- t4 Core git, atomic write, push lock; edsync ingest and cache — core/git.ts (runGit, gitOutput, git version check), core/atomic-write.ts (retry while locked), core/push-lock.ts (lease lock with nonce), edsync/cache.ts (cache fetched blobs and support.js, rewrite /_blob ids) and edsync/ingest.ts (fresh-project import with git init and base.json).
  deviated: on an existing clean project, ingest only checks it is synced and prints the fetch list; writing remote changes and advancing the commit belongs to the push classify/merge/commit steps (t9).
  deviated: stale push-lock takeover is compare-and-delete then a second exclusive create, not an atomic swap; the nonce re-check before each write still applies.
  deviated: an empty or unparseable lock file is treated as held, never stale.
  deviated: ingest does not call ensureSupportedGit; the CLI entry (t9) must do it before every verb.
  deviated: cacheFetched rescans every cached blob each round so `missing` stays correct across interleaved rounds; support.js is not scanned.
- t5 M2/M5 PatchEngine: style, attr, text and structural ops — patch-engine.ts, text-splice.ts, structural-ops.ts, shape-check.ts and shared/content-model.ts; each flush plans all ops as splices against the original text, applies them in one pass, and re-checks the shape tree.
- t6 M1 project origin: 5301 listener, serve transform, probe — serve-transform.ts, blob-cache.ts, project-server.ts and the probe (probe.ts, bundle.ts) on the project port.
  deviated: support.js is served from .editor/cache/support.js but edsync cache writes it to .editor/cache/<release>/support.js; not reconciled yet.
  deviated: hide is an injected style rule after the probe; `locked` is accepted but changes nothing in the served bytes.
  deviated: hit-testing treats `top` and `deeper` the same (id'd ancestor under `within`); only `deepest` is used today.
  deviated: adds a realpath containment check and blocks every dot-segment, beyond what the tests ask.
  deviated: the probe bundle is built with vite build() since vite is the only declared bundler dependency.

## Wave 5 (2026-11-23)
- t7 M2 Writer, snapshot UndoLog, Watcher and reconcile — adds the debounced Writer with one undo entry per flush, the snapshot UndoLog, the chokidar project watcher and the tag-LCS reconcile.
  deviated: minted ids use the Writer's own `n<k>` counter because SourceIndex keeps its minting private.
  deviated: `resolved` is null for `<helmet><style>` rule edits since RuleIds are re-minted on every index, so the UI reloads for them.
  deviated: the watcher also keeps a per-file last-seen hash, built from the initial scan, because macOS fs.watch replays recent writes.
  deviated: coalescing is one undo entry per flush; pauses over 300 ms in a burst give separate entries.
  deviated: a structural flush with several ops lists all minted ids in each ack; a still-locked write stays pending with no retry timer; unlink events and restoreByPath are not sent anywhere yet.
- t12 M1/M2 panels: layers tree, properties panel, fields, tokens — adds the Layers tree with drag-drop, the Properties panel with Appearance, Fill, Stroke, Effects and Typography sections, and shared field components.
  deviated: no visual colour-picker popover yet; the picker is a Colour text input plus Alpha %, and a hex typed over oklch() is written as hex.
  deviated: the post-write script-override warning only sees px values; the text-box trim switch is always shown with a warning when unsupported.
  deviated: the token picker lists every token without a kind filter and the selector chip lists only rules shared by every selected element.
  deviated: panel CSS lives in scoped style blocks and depends on B Warm CSS variables defined by the app shell.

## Wave 6 (2026-11-23)
- t8 Editor server, edit session, push endpoints, services, main — adds the 127.0.0.1 editor listener (Host, Origin and token checks, /health, /shutdown, /push/begin, /push/end, path-scoped WebSocket edit session, Vite middleware in dev), the edit session over Writer, UndoLog and Watcher with the push lock, editor services (tokens, state.json, diff/revert), the startEditor composition root and scripts/start.mjs.
  deviated: startEditor binds the editor and project ports before the slow startup work (git check, probe bundle, session open) finishes and the editor answers 503 until the session is attached, instead of running the steps one after another; this narrows the window in which another process can take a port.

## Wave 7 (2026-11-23)
- t9 M6 edsync classify, merge, commit, CLI and the two skills — finished the edsync CLI (classify, merge with line-ending and shape guards, sync-commit with outbox/object store/pending sync/base.json, verbs lock, classify, merge, check, commit, unlock, ingest, cache, rewrite-blobs, editor handshake), the tools/edsync.mjs entry and the design-pull and design-push skills.
  deviated: refreshing an existing project through /design-pull runs classify, merge and commit with no uploads, and ingest still only checks that the project is synced; the node-diff3 token-level retry and key-level JSON merge are left for Next, as the plan says.
- t13 M1/M2 editor shell, diff panel, history; M1 and M2 e2e — added the editor shell (top bar with sync strip, undo/redo and theme toggle; Layers and Changes tabs; banners and toasts; properties panel), DiffPanel with per-file revert, history undo/redo actions and the M1 and M2 e2e specs.
  deviated: the token picker gets an empty token list because the server protocol carries no tokens; there is no visible Interact switch (hold-I from t11 remains); after a style-only undo the resolved values are trusted and re-applied as a preview rather than compared with the live values.
