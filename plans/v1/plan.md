# Design Editor — v1 plan

A local, Figma-style visual editor for Claude Design projects.

**Loop:** `/design-pull` → edit on a canvas with the mouse → `/design-push`.
The project's own HTML/CSS files are the document. Every edit is a small splice into those files.
There is no separate design format.

Research behind every decision: `research/00-figma-ideas.md` (summary) and `research/01..05-*.md`
(details + fetched sources); `07..09` re-validate 01..05 against fetched sources, `10` covers features
beyond Figma and `11` the Windows audit. Section refs below like (R01) point at those files. Where 07..09
mark a claim in 01..05 wrong, the plan follows 07..09. (decided: Claude, Ron AFK 2026-11-23)

## Goals

1. Open a pulled Claude Design project and edit it the way Figma feels: select, move, resize, snap,
   measure, Auto Layout, properties panel, tokens, layers.
2. Write changes back so the diff contains only what changed. Formatting and comments stay. An
   unchanged session gives a zero-byte diff.
3. Push back to Claude Design without silently overwriting anything changed there in the meantime.
4. Run the same on macOS and Windows: editor, Writer, pull/push and tests (see Cross-platform).
   (decided: Ron's requirement, recorded by Claude, Ron AFK 2026-11-23)

**Why not just use Claude Design's own canvas editor?** It already does drag, resize, align, arrow-key
nudge, a contrast hint and a layer list. This editor exists for what it is not documented to do, and v1
scope follows these gaps:

- **Precision tools:** snapping with guides, Alt-hover measure lines, and Auto Layout handles (gap and
  padding on the canvas, Hug / Fill / Fixed) (M3, M4).
- **Tokens:** pick a design-system token instead of typing a raw value (M5).
- **Source control and offline:** edits are minimal splices into local files, so `git diff` shows only
  what changed, there is per-file revert and undo, and it works without a network. Claude Design's own
  Artifact version history covers whole-page rollback, so it is not a reason for this editor: Artifact
  versions are whole-snapshot history, so what git adds is line-level diffs, per-file revert and offline
  editing (M0 records what version history actually offers).

Snapping, measurement and token binding are "not stated" in Anthropic's docs, not documented as absent.
M0 confirms each against the real editor, and any that it already has moves to Non-goals.
(decided: deep-critic r2)

The Design type's own docs (`format.md`, SKILL.md) say its properties panel already edits flex/grid
(direction, gap, justify, align), offers Wrap in flex / Wrap in grid, draws board `guides`, and has a
token-aware Theme menu. So treat flex/grid panel editing, wrap and basic token display as **existing**.
Auto Layout handles (M4) and the token picker (M5) shrink to whatever M0 finds missing, such as on-canvas
gap/padding handles, Hug / Fill / Fixed, and binding a token. Not documented either way: on-canvas
snapping to siblings, Alt-measure, gap/padding drag handles. The built-in editor is documented to have
drag, resize, align, layout guides (Shift+G) and no version history.

Kill bar, fixed before M0 runs: go ahead only if M0 finds snapping and Alt-measure missing from the
built-in editor and git line diffs and offline editing matter to Ron. If M0 finds snapping or measure
already built in, re-scope with Ron before M1: shrink v1 to "git-sync + precision tools" (M1-M3 plus
whatever precision tools are still missing), and move Auto Layout panels (M4) and tokens (M5) to Next.
If nothing on the list of things this editor adds survives, stop the project and tell Ron.
(decided: Ron, deep-critic r3; amended deep-critic r4)

## Non-goals (v1)

- Multiplayer, comments, prototyping/interactions, animation.
- React/JSX or other framework sources. v1 targets Design canvases (`*.dc.html`, inline `style`
  primary); plain HTML + CSS (+ inline `<style>`) is the fallback branch only (Appendix A). Script-generated DOM is
  shown but read-only.
- Gradients, image fills, CSS grid editing, light/dark modes, components/variants (all "Next"/"Later" in R00).
- A hosted app. It runs on localhost only.
- Other people's canvases. v1 edits Ron's own canvases only. A canvas cannot render without `support.js`, so
  every canvas runs its scripts, always in the sandbox described in Scripts and trust; opening other people's
  canvases is not a supported path. (decided: deep-critic r3; Ron, deep-critic r1)

## Stack

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere, Node ≥ 22.12 (22 LTS; 20 is end-of-life) | One language for server and UI. (decided: Claude, Ron AFK 2026-11-23) |
| Server | Node HTTP + `ws` WebSocket, bound explicitly to `127.0.0.1` (never a wildcard or `localhost`, which avoids the Windows firewall prompt and the `::1` mismatch; `dns.setDefaultResultOrder('ipv4first')` at startup) on two ports (editor 5300, project 5301; the second port is the default project origin, `*.localhost` is never used) (decided: Claude, Ron AFK 2026-11-23) | Serves editor + project, receives edit ops. Rejects any HTTP request or ws upgrade whose `Host` or `Origin` is not the editor's own (except read-only project fetches, see Scripts and trust); the ws URL carries a random per-launch token, injected into the editor page only (never into `/project/*`). Project scripts run in a sandboxed frame on a second origin, a second port (see Scripts and trust). |
| HTML parse | `parse5` with `sourceCodeLocationInfo` | Exact offsets per element/attribute (R05) |
| CSS parse | `postcss` ≥ 8.4.29 (keeps `raws`) + `postcss-selector-parser`, `specificity` | Byte-faithful rule edits (R03, R05). Ranges come from `node.source.start.offset` / `end.offset`, not line/column conversion (R05's "line/column only" is wrong, R09 B12). (decided: Claude, Ron AFK 2026-11-23) |
| Splicing | `magic-string` | Edits against original offsets, minimal diff (R05) |
| Atomic write | `write-file-atomic` (tmp in the target's directory, fsync, rename) inside our own retry: on `EPERM` / `EACCES` / `EBUSY` back off up to about 3 s, then report "file locked by another program" and keep the edit pending | Windows refuses a rename while an antivirus, indexer or editor holds the file (R11 #9). (decided: Claude, Ron AFK 2026-11-23) |
| Watcher | `chokidar@^5` (ESM, Node ≥ 20; v6 needs Node ≥ 22.22 and is a later bump), no globs, `ignored` as functions | Reconcile outside edits (R05, R11 #11). (decided: Claude, Ron AFK 2026-11-23) |
| Processes | `execFile` with argument arrays and no shell for `git`; `cross-spawn` for `.cmd` tools (npm, npx, vite); npm scripts are single `node scripts/*.mjs` commands | Node ignores PATHEXT and rejects `.cmd` without a shell on Windows (R11 #18-19). (decided: Claude, Ron AFK 2026-11-23) |
| Screenshots | Playwright (headless Chromium on the server), approved as a runtime dependency | M7 visual diff, PNG export, Ask-Claude crops, UI mockup check. (decided: Claude, Ron AFK 2026-11-23) |
| Editor UI | Vite + React for the panels; the canvas overlay is plain DOM/SVG | Panels are form-heavy; overlay must be fast. In dev, Vite runs in `middlewareMode` (`appType: 'custom'`) inside the Node server on the editor port 5300 only; no separate Vite port, and `/project/*` is served by the second listener. The editor's `ws` endpoint is path-scoped (`noServer`, upgrade routed by path), so its Host/Origin/token check never touches Vite's HMR socket, and Vite never transforms `/project/*`. Vite's `server.watch` ignores `projects/` and `.editor/`, so editor writes never trigger HMR. Production serves the built bundle from the same server. |
| Tests | `vitest` (core), Playwright (canvas e2e), GitHub Actions on `windows-latest` + `macos-latest` | |

**UI design:** the editor's visual direction is **B "Warm studio"** (`design/ui-options/b-warm-studio.html`,
dark-first with a full light theme, warm charcoal, a clay accent used only for selection/active/Push; rationale in
`b-warm-studio.md`). Chosen over A and C because it already shows the shared-class warning ("used by 3
layers · This one only"), the toast with Undo + Diff, and leaves the canvas uncovered (C's floating panels
cover artboards). Borrowed from A: rulers that highlight the selection's range, and the Alt-measure status
chip. Screenshots of all three: `design/ui-options/shots/`. The editor UI must follow the chosen mockup and pass a side-by-side screenshot
check against it (Playwright shot of the editor next to the mockup, at the M1 and M7 exits).
(decided: Claude, Ron AFK 2026-11-23)

## Architecture

```
┌──────────────── browser: editor (localhost:5300) ────────────────┐
│  Layers panel │  Canvas viewport (zoom/pan transform)  │ Props   │
│               │  ┌───────────────────────────────┐     │ panel   │
│               │  │ iframe: project (sandboxed,   │     │         │
│               │  │  second origin, probe over    │     │         │
│               │  │  postMessage)                 │     │         │
│               │  │  elements carry data-ed-id    │     │         │
│               │  └───────────────────────────────┘     │         │
│               │  overlay: hover, handles, guides       │         │
└──────────────────────────── edit ops ↕ ws ──────────────────────┘
┌──────────────── node server ─────────────────────────────────────┐
│ SourceIndex (parse5 + postcss) ─ PatchEngine (magic-string)      │
│ RuleLocator ─ UndoLog ─ Writer (debounced, atomic) ─ Watcher     │
└──────────────── project folder on disk (git-tracked) ────────────┘
```

- **Sandboxed iframe.** The server serves the project at `/project/*`, so the injected probe can read
  the frame's DOM and `getBoundingClientRect` for the overlay. The serving layer adds `data-ed-id` to each element it
  serves. The ids never touch disk (R05). Ids are server-owned and stable: `SourceIndex` allocates each id
  once from a per-session counter, never reuses it, and carries it through every patch by updating the
  id-to-node map in place, never re-deriving it from position (`moveNode` keeps the id, `duplicateNode`
  and `wrapNode` mint new ids for the new nodes, `deleteNode` retires the id). The op ack returns the new
  ids and id-to-range updates. On a canvas (the v1 target) the ack ids are used only to write the file;
  the iframe reloads after a structural op and selection, scroll and zoom are restored by the
  carried-over edId, because the runtime owns the DOM and a live edit would fight its re-render. Build
  this path; live structural DOM apply belongs to the plain-HTML branch (Appendix A). (decided:
  deep-critic r1; moved, Claude, Ron AFK 2026-11-23) Only an outside edit seen by the watcher re-parses the file and
  reconciles it against the old tree. Nodes that no longer match get fresh ids, and the iframe reloads
  with selection restored by element path. (decided: deep-critic r1)
- **Scripts and trust.** The server checks `Origin` against an exact allowlist
  (`http://localhost:<port>`, `http://127.0.0.1:<port>`; no substring match) and requires the
  per-session token on the ws and every API call, always. Project scripts always run, for every
  project, and only in the sandbox below. There is no trust mark, no per-script hash, no auto-off when a
  script changes and no re-mark diff UI: the opaque-origin sandbox is the security boundary (the Design
  type relies on the same one), and a gate on every Claude edit would add friction without adding a
  boundary. On top of the sandbox, `/project/*` is also served with
  `connect-src http://127.0.0.1:5301 http://localhost:5301` (the project origin's two hosts, at whatever
  port is configured) in its `Content-Security-Policy`, so a canvas script can `fetch` its own cached
  `/_blob/*` data from the project origin (the Design type lists `fetch` as a place those urls go) and
  call no other host. These are explicit host-sources rather than `'self'`, because the sandboxed frame
  has an opaque origin and `'self'` matching for it is easy to get wrong. The opaque-origin fetch is
  cross-origin, so the 5301 responses carry `Access-Control-Allow-Origin: *`, and the listener stays
  read-only (GET/HEAD of static files, no API, ws or token), so the allowance adds no write or API
  surface. (decided: deep-critic r2) The injected probe needs no
  network of its own (it talks over postMessage only), and its `<script>` tag carries a fresh random per-response
  nonce (never `'unsafe-inline'`) so it keeps working under the CSP; the serving transform strips any
  `nonce` attribute already in the project markup first, so project markup cannot reuse it. The policy
  sets no `script-src` restriction on the project's own scripts, and `sandbox allow-scripts` does not
  restrict `eval` or `new Function`, so the DC runtime's compiled `DCLogic` block runs unchanged. Design
  canvases need `support.js` and their `DCLogic` script to render, and the Design type calls canvas
  content untrusted cross-user input that may only run in a sandboxed frame, so scripts run for every
  canvas, but never beside the editor. (decided: Ron, deep-critic r1) The iframe is
  `sandbox="allow-scripts"` without `allow-same-origin`, and `/project/*` is served from a second origin
  (a second listener in the same Node process on `127.0.0.1:<port+1>`, 5301 by default, so a different
  port gives a different origin with no OS network change; `127.0.0.2` cannot be bound on macOS without
  a root `ifconfig lo0 alias`, and `*.localhost` does not resolve in Safari. That listener serves only
  `/project/*` and assets (never `.editor/` or `.git/`, which hold the token file and history), with no API, no ws and no token, and checks `Host` against exactly
  `127.0.0.1:5301` and `localhost:5301`; the editor listener on 5300 never serves `/project/*`)
  (decided: deep-critic r1) with
  `Content-Security-Policy: sandbox allow-scripts; frame-ancestors http://127.0.0.1:5300 http://localhost:5300`
  (a response header; `frame-ancestors` does not fall back to `default-src`), so only the editor can
  embed project pages and the probe never answers a foreign parent, and even a direct navigation gets an opaque origin
  with no access to the editor, its token or its storage. The serving layer injects a small probe script
  into each page that answers the overlay's reads (`getBoundingClientRect`, `matches()`,
  `getComputedStyle`, the `document.styleSheets` walk) and applies optimistic edits and the
  structural-op handling below over postMessage; the overlay's reads are async, so the probe batches
  them once per frame (about +1 day, in M1). The editor sends with target `'*'` (an opaque origin cannot
  be targeted) and accepts a message only when `e.source === iframe.contentWindow` and
  `e.origin === 'null'`, validating every payload against a schema; the probe accepts only
  `e.source === parent`. Assets and `support.js` are served with `Access-Control-Allow-Origin: *`, since
  an opaque-origin frame fetches them cross-origin, and its CORS-mode loads (an `@font-face`, for
  example) send `Origin: null`. So the exact Host check always applies, but on the `127.0.0.1:5301`
  project origin the Origin check lets GET/HEAD of static files through with `Origin` absent or `null`.
  `null` is never accepted on the editor origin, the API or the ws, which keep the strict allowlist and
  the token. (decided: deep-critic r1) The token is never injected into `/project/*`.
  (decided: deep-critic r4)
  Script-made elements stay read-only. Scripts can also change source elements (toggle
  classes, set inline styles, re-render), and in v1 scripts always run. So (a) if the M2 `getComputedStyle` gate
  still fails after the inline fallback, the edit stays on disk and the panel warns "a script overrides
  this value", and (b) structural ops (`duplicateNode`, `wrapNode`, `moveNode`) are not applied to the
  live DOM; the Writer patches the file and the iframe reloads, because a cloned node would lack the
  page's listeners. Per-node mutation tracking is not built in v1. The runtime owns the DOM of a
  canvas, so the same rule covers every write that is not a plain optimistic style change: undo/redo of
  a structural entry and a text commit also write the file and reload the iframe, and selection and scroll are restored by
  the carried-over edId. Optimistic `setDecl` on a canvas node is a preview only; if the runtime
  re-renders over it, the ack-vs-live check (see Writer) reloads from disk. (decided: deep-critic r1, r2, r4)
- **Source-first mapping.** `SourceIndex` maps `edId → {file, element range, start-tag range, attr ranges}`
  and `ruleId → {file, selector, declaration ranges, media context}`. Implicit parse5 nodes and
  script-made elements have no id → read-only.
- **Write target (canvas).** The element's inline `style` attribute by default; a `<helmet><style>`
  rule in the same `.dc.html` only when the user picks it in the selector chip (see M2). Computed
  values are never written. Authored units, colour format and `var()` (including the variable's case,
  R08 #40) are kept. The browser cascade resolver, `RuleLocator`, `SharedCounter` and the three-step
  write-target policy are plain-HTML branch only and live in Appendix A. (decided: deep-critic r4;
  moved to Appendix A, Claude, Ron AFK 2026-11-23)
- **Edit op** (UI → server): `{target, kind, payload}`. The kinds are `setDecl`, `removeDecl`,
  `setAttr`, `setText`, `moveNode`, `wrapNode`, `unwrapNode`, `duplicateNode` and `deleteNode`.
  On a canvas the UI previews `setDecl` / `removeDecl` in the live iframe at once (<100 ms); every other
  kind writes the file and reloads (see Scripts and trust). The server turns the op into a source patch
  and logs a structured **edit record** `{target, kind, prop, before, after, scope}` (scope = element,
  N repeats or rule). The record is the one format for undo labels, the per-file diff panel, multi-edit
  and the M7 Ask-Claude payload (R09 D1); undo still restores file snapshots, never replays a record.
  A multi-element edit is one op with several targets and one record. (decided: Claude, Ron AFK 2026-11-23)
- **Writer:** debounce 300 ms, splice, re-parse and shape check (for structural ops, `moveNode` /
  `wrapNode` / `unwrapNode` / `duplicateNode`: the re-parsed parent of every touched node must have the
  intended tag sequence and the moved/new nodes must land under the intended parent; on mismatch nothing
  is written, the op is rejected and the UI says why, for example "a `<div>` can't go
  inside a `<p>`"; this catches parser fix-ups such as `p` auto-close, nested `a`/`button`/`form` and
  table foster-parenting, and runs before ids are carried over), atomic write (tmp + rename), re-index
  that file (ids carried over in place, see Sandboxed iframe: the PatchEngine shifts each id's start
  offset by the splice deltas it applied, and the re-parse binds nodes by that shifted offset; ids on
  newly minted nodes come from the op; a moved node and its descendants take the destination offset
  plus their offset inside the moved block), record its hash so the watcher ignores our own
  write. All patches of one flush are collected against the original text and applied by one
  `magic-string` instance in a single pass, then re-parsed: no two patches may overlap (magic-string
  throws), `update` is used rather than `overwrite`, and `move` carries reparenting (R09 B11, D5).
  Bytes are exact: files are read as `Buffer`, decoded as UTF-8 with the BOM kept, parsed and spliced
  as that same string (never trimmed or `\r\n`-normalised), inserted text uses the file's dominant line
  ending, and the result is re-encoded without adding or removing a BOM (R11 #1, #2, #5). (decided:
  Claude, Ron AFK 2026-11-23) After each write the server acks with the value the re-indexed source now resolves for the
  edited target. The UI compares it with what it applied to the live iframe; on mismatch it shows a
  toast and reloads the iframe from disk, so the preview never shows a look the file does not have.
- **Undo:** file pre-image snapshots, not inverse ops. Before each Writer flush, `UndoLog` pushes the
  pre-write text of every file the entry touches, together with that text's `edId -> start offset` map,
  plus the post-write hash; one entry per drag / typing burst (coalesced). Undo writes the pre-image
  back through the Writer and restores its id map with it instead of re-deriving ids: the text is
  byte-identical, so the re-parse binds each stored id to the node at the same start offset, with no
  heuristics, and ranges are refreshed from the re-index. A deleted, moved or wrapped node comes back
  with the id it had, and ids that `duplicateNode` or `wrapNode` minted are retired; the per-session
  counter is never rewound, so no id is handed out twice. Redo does the same from a map captured at undo
  time, so the stored ids hold throughout the M5 golden sequence. The ack returns the restored ids; on a
  canvas undo writes the file, the iframe reloads and selection and scroll are restored by edId (the
  plain-HTML in-place re-sync is in Appendix A). (decided: deep-critic r1) Only an
  outside edit falls back to reconcile plus reload. (decided: deep-critic r2) Byte-identical undo holds by construction,
  and no op kind needs its own inverse. If the watcher sees an outside change to a file (hash differs
  from the entry's post-write hash), that file's undo/redo entries are dropped so undo never clobbers
  outside work. If ops for that file are still pending in the debounce, writes pause, the file is
  re-indexed from disk, and the user is asked whether to keep or discard them (R05).
  Cmd-Z / Cmd-Shift-Z (R04). (decided: deep-critic r1)
- **Editor-only state** (hide, lock, layer collapse, zoom) lives in `.editor/state.json`, never in the
  source (R04). All of `.editor/` (state, `server.json`, locks, `base.json`, cache, shots, asks) is
  git-ignored through `.git/info/exclude`, written at pull's `git init`; nothing in it is tracked
  (`base.json` repeats the synced commit's hashes, so git does not need it). The exclude file lives
  outside the working tree, so it is never a project file, never classified and never pushed, and an
  editor session alone never makes `git status` dirty. (decided: Claude, Ron AFK 2026-11-23)

## Pull / push (Claude Code side)

Two project skills in `.claude/skills/`. They run inside Claude Code because the Claude Design
connection is a Claude tool, not something a shell script can call.

The skills hold no logic. They make the Artifact tool calls and otherwise only run `git` and the
**`edsync` Node CLI** (`node tools/edsync.mjs <verb>`; verbs `lock`, `classify`, `merge`, `check`,
`commit`, `unlock`, `shots`). The CLI does every deterministic step below: the lock, the per-file
classification (it prints a JSON plan: upload / write-remote / merge / conflict / stop), `git merge-file`
and its exit codes, the shape check, the synced commit and `base.json`. It is unit-tested against
throwaway git repos (see Testing). No bash-isms in the skills, so they run the same in PowerShell, cmd
and zsh. (decided: Claude, Ron AFK 2026-11-23; critic v8)

**Testing safety rule:** every automated and manual push test targets a throwaway Artifact copy created
for that test (a new private Design artifact published from pulled files), never one of Ron's real
canvases. Ron's "Test Site" canvas is only ever read (pulled), never pushed to. (decided: Ron's rule,
recorded by Claude, Ron AFK 2026-11-23)

v1 has no pull/push buttons in the editor. Driving Claude Code from the editor would make the localhost
server spawn a session with write and publish rights, a new attack surface (cross-origin,
WebSocket-origin and DNS-rebinding exposure) for little gain. The skills stay the only entry point; a
button can be added after v1 by running `claude -p "/design-push"` without changing them.
(decided: deep-critic r1)

- **`/design-pull <link or name>`**
  1. Fetches the project into `projects/<slug>/`.
  2. `git init` inside `projects/<slug>/` and commits a "pulled" baseline (the first synced commit). Each pulled project is its own
     repo; `projects/` is in the editor repo's `.gitignore`, so project repos are never nested-tracked or
     added as gitlinks. Files meant for `test/fixtures/` are copied in without their `.git`. (decided: deep-critic r1)
     The same step sets local config `core.autocrlf=false`, `core.safecrlf=false`, `core.longpaths=true`,
     writes `* -text` to `.git/info/attributes` (git never converts a project byte, whatever the user's
     global config) and `.editor/` to `.git/info/exclude`. Both files live in `.git/`, so the canvas
     folder gains no file that push would have to special-case. (decided: Claude, Ron AFK 2026-11-23)
  3. Downloads every `/_blob/<id>` the project references, plus `support.js`, through the Artifact tool into
     `.editor/cache/` (keyed by id and type release). The serving layer answers `/_blob/*` and
     `./support.js` from there, because the localhost server holds no claude.ai credentials and cannot
     fetch them itself. `.editor/cache/` is git-ignored and `/design-push` never sends it. The cost is a
     slower pull and a runtime pinned to the pulled release until the next pull, so offline editing works
     after a pull and needs the network only for pull and push. (decided: deep-critic r3)
  4. Writes `.editor/base.json` (remote version + per-file hashes).
  5. Starts the editor on it.

  Re-running `/design-pull` on an existing `projects/<slug>/` is a refresh, never a re-initialise (steps
  1-2 do not run again: no second `git init`, no new baseline from the fresh remote alone). A project is
  dirty when its working tree differs from the synced commit (`git status` not clean), or HEAD is past
  it; pull then refuses and says to run `/design-push` first, like `git pull` on a dirty tree, because it
  cannot overwrite or reset the baseline under unpushed edits. A stash-and-reapply was rejected: the
  re-apply can conflict, and push's classification is already the one merge path. On a clean project
  pull runs push's steps 2, 3 and 5 with no uploads (remote-only changes are written, the synced commit
  and `base.json` advance, rewritten from those bytes), then redoes step 3 to refresh `.editor/cache/`
  for the current type release and any new `/_blob` ids. (decided: deep-critic r2)
- **`/design-push`**
  1. `edsync lock` takes the handshake. **If an editor is running** (`.editor/server.json` names its
     port and token and `GET /health` answers), the CLI calls the editor's `POST /push/begin`. The
     editor flushes the debounce, pauses the Writer, locks the canvas, creates `.editor/push.lock`
     `{nonce, holder, pid, startedAt, expiresAt}` with exclusive-create and a 60 s lease, renews
     `expiresAt` every 20 s from its own timer, and answers with the nonce once the flush is on disk
     (timeout 5 s: push stops and says to retry). The long-lived editor is the heartbeat, so a slow
     publish approval in Claude Code never lapses the lease; if the editor dies there is no writer left
     to guard against. The editor never unlocks on expiry: it releases on `edsync unlock`
     (`POST /push/end`), or after 30 minutes held asks "push may still be running in Claude Code —
     unlock?". **If no editor answers**, the CLI creates the lock itself with a 15-minute lease, and an
     editor started meanwhile opens read-only until the lock is gone or expired. A lock is stale only
     when `expiresAt` has passed; the PID is a hint, never the test (R11 #13). Nobody deletes a lock
     whose nonce is not theirs, and deletes use the Writer's rename retry. The CLI re-checks its nonce
     before every working-tree write (steps 3 and 4) and before the publish, and aborts with nothing sent
     if it is gone. The remote publish refusal and the `base.json` hashes remain the guard against
     remote changes; push never pushes around a live editor. (decided: Claude, Ron AFK 2026-11-23,
     replacing the per-step renewal of deep-critic r2; critic v8)
  2. Re-reads the remote version.
  3. Classifies every file, added and removed artboards included, against the last synced commit (the
     git HEAD that step 5 advances; `base.json` holds its hashes), comparing the local hash and the
     remote hash with the recorded one. A missing file counts as an update like any other. Local-only
     change: uploads it. Remote-only change: writes the remote bytes into `projects/<slug>/` (an outside
     edit for the editor: reconcile plus reload, see below). Unchanged on both sides: nothing. An
     artboard added or removed on the remote only is carried across the same way (the remote
     `canvas.json` arrives with it, so `boards` and `order` stay consistent). Push step 3 also downloads,
     into `.editor/cache/`, any `/_blob` id referenced by a remote-only file it writes and missing from
     the cache, before step 5, so a remote-only artboard never renders with missing assets. (decided:
     deep-critic r2) An artboard added or
     removed locally only stops the push with "add/remove artboards in Claude Design" and nothing is
     sent: the editor has no add/remove op and never writes `canvas.json`, so the `boards` entry and
     `order` slot could not follow the file, and a removal would leave a dangling entry (v1; decided:
     deep-critic r1). Changed on both sides
     to different bytes: step 4. Edited on one side and removed on the other: a conflict (stops the
     push like a text conflict, keep either). This is the two-replica model of Unison's archive: a
     one-sided change moves across, only a both-sided change is a conflict. (decided: deep-critic r4)
  4. For each file changed on both sides, runs `git merge-file -p --diff-algorithm=histogram` (ours =
     editor file, base = the last synced commit, theirs = remote). If the three inputs differ in dominant
     line ending, the merge runs on LF copies and the result is converted back to ours' ending; a
     negative exit is an error, not a merge (R11 #4). (decided: Claude, Ron AFK 2026-11-23) Exit 0 for every file: the merged results go
     through. Any file with a positive exit (conflict count): push stops, sends nothing, and shows the
     conflicting files and hunks for the user to resolve (keep remote, keep ours, or edit by hand), with
     no auto-resolution. It is a line-level text merge, so it may ask on edits that only touch adjacent
     lines or different properties of one element's `style`, but it never overwrites silently. v1 keeps
     it as is. A token-level retry on conflicting hunks (split on attributes and `;`-separated
     declarations, merged with `node-diff3`, `excludeFalseConflicts` on, about half a day) is added to v1
     only if the M0 save-footprint check shows a Save rewriting far more than it changed, or same-line
     clashes show up in M0/M6 use; otherwise it stays in Next. (decided: deep-critic r1) Element/property-level merge (replaying the patch log on the remote
     text, R00/R04) is deferred to Next. (decided: deep-critic r1)
     `project/canvas.json` is never written by the editor and is excluded from the per-file
     `git merge-file`; push sends only artboard files and takes the remote `canvas.json` as is, so frame
     moves made in Claude Design never conflict with editor changes. Key-level JSON merge is deferred to
     Next, to be built only if root resizing becomes a must-have. (decided: deep-critic r3)
  5. Commits the synced state (what both sides now hold, including remote-only files written in step 3)
     as the new "synced" commit and rewrites `base.json` (remote version plus per-file hashes) from
     exactly those bytes, on every push, including a push with no local change that only brings remote
     edits in. So after every push the working tree, the baseline and the remote agree, the next push
     three-way merges against what both sides last agreed on, and a remote-only edit is never uploaded
     back over or seen as "unchanged". (decided: deep-critic r4) The commit is built from the bytes
     that were sent plus the remote bytes written, not from the working tree (`git hash-object -w`,
     `git update-index --cacheinfo`, then commit that index), and once the publish has succeeded step 5
     always runs, so a lease that lapsed after the publish cannot leave the sync unrecorded, and an edit
     made after step 3's read simply shows as a local change for the next push. (decided: Claude, Ron
     AFK 2026-11-23; critic v8 option 1)

  Two guards on the send. Before sending, each file `git merge-file` merged cleanly is parsed with the Writer's
  parse5 shape check (`<x-dc>` and the `data-dc-script` block intact); a file that fails is treated as a
  conflict (the push stops and sends nothing), because a line merge can exit 0 and still splice one side's
  open tag to the other's close. If the publish is refused because the remote changed after step 2's read,
  push does not retry: it deletes the lock, reports the refusal, and the user re-runs `/design-push`, which
  re-reads the remote and re-classifies from step 2. That is safe at any point, because step 5 alone
  advances the synced commit and bytes already identical on both sides classify as unchanged. (decided: deep-critic r1)

  The skill reads the working files once, after the editor's ready ack, hashes them, and sends, commits
  and records in `base.json` exactly those bytes. On finish or abort, push deletes the lock. While
  `.editor/push.lock` is held the canvas, panels and Cmd-Z are read-only with a "Push in progress"
  banner: the editor flushes the pending debounce, then locks the canvas before it answers
  `/push/begin`, and unlocks on `/push/end` (see step 1). Ops are blocked, not queued in memory:
  push may rewrite files and reload the iframe, which would leave queued ops pointing at stale ids and
  offsets, and the live DOM never holds an edit that is not on disk (preview = disk), so a close
  mid-push loses nothing. The lock lasts up to a few minutes (remote reads, publish approval prompts, the commit), so blocking input costs little and cannot lose or
  misapply an edit. (decided: deep-critic r4) On `/push/end` the editor re-indexes every file push rewrote (merged files written in step 4 count as
  outside edits: reconcile plus iframe reload) and resumes the Writer, so no edit is lost and none is
  written under push's feet. Undo entries for the rewritten files only are dropped (see Undo). The
  documented fallback "close the editor before pushing" is not used: it cannot be enforced and would
  silently lose the last debounced edit. (decided: deep-critic r3)

One remote kind in v1: a **design / prototype made in Claude** (an Artifact). Read it with the Artifact
tool, publish to the same URL. Its publish refuses only relative to what this session last read, so the
`base.json` comparison is the real guard. **M0 confirms what it actually looks like on disk.**

The design-system remote (`DesignSync`) is out of v1. That tool is scoped to the `/design-sync` skill and
has no per-file version or compare-and-swap, and standalone claude.ai/design closes 2026-12-14 and goes
read-only. The migration guide says design systems move into Claude but are not editable on their page
yet, and it describes no API for them. **M0 also asks where design-system projects live after the
closure and with what tool.** The path comes back in v2 only if that has an answer. (decided: deep-critic r1)

## Cross-platform (macOS + Windows)

Support: macOS (arm64, x64) and Windows 10/11, Node ≥ 22.12, a Chromium-based browser (Chrome or
Edge; Safari stays unsupported for the editor). From R11; all rules below are
(decided: Claude, Ron AFK 2026-11-23).

- **Bytes.** The Writer is byte-exact (see Writer): `Buffer` in and out, BOM kept, CRLF / LF / mixed
  preserved, inserted text in the file's dominant ending, no `.trim()` or `\r\n` replace on file content.
- **Git.** Project repos are created with `core.autocrlf=false`, `core.longpaths=true` and
  `* -text` in `.git/info/attributes` (pull step 2). The editor repo commits a `.gitattributes` of
  `* text=auto eol=lf` with `test/fixtures/** -text`, so golden fixtures stay byte-stable under any
  `autocrlf`. `git --version` is checked at startup with an install hint; every call is
  `execFile('git', [...])` with `GIT_TERMINAL_PROMPT=0`.
- **Paths.** Ids, URLs, `base.json` and the edit record use project-relative `/` paths; native paths
  exist only at the fs boundary. File lookups are case-insensitive (stored spelling kept); Windows-
  reserved names (`CON`, `NUL`, `COM1`, trailing dot or space, `<>:"|?*`) are rejected at pull.
- **Writes and watcher.** Atomic write with the rename retry (Stack); a write that still fails stays
  pending and visible. The own-write filter is by content hash, not timing. chokidar keeps
  `atomic`, has an `error` handler that re-adds the watcher on `EPERM`, and falls back to polling via
  `CHOKIDAR_USEPOLLING` for synced folders (OneDrive, Dropbox), which the editor warns about.
- **Locks and shutdown.** Leases, not PIDs (push step 1). The editor shuts down via token-guarded
  `POST /shutdown` or stdin close and handles `SIGINT` / `SIGBREAK`; nothing relies on `SIGTERM`,
  which runs no handler on Windows.
- **Network.** Both listeners bind `127.0.0.1` (Stack); Playwright and the CLI use
  `http://127.0.0.1:<port>`, never `localhost`.
- **Skills.** Skills only call the `edsync` Node CLI and `git`, with quoted paths; Git Bash is not
  assumed.
- **CI.** GitHub Actions matrix `os: [windows-latest, macos-latest]` × `autocrlf: [false, true]`
  (set before checkout), `fail-fast: false`: lint, vitest, Playwright Chromium (plus `msedge` on
  Windows), the CRLF/BOM fixtures and a Windows-only locked-file rename test.

## Milestones

Each milestone ends with tests green and a commit.

### M0 — Spike: what a project looks like (1 day, time-boxed, with a two-hour gate)
- Pull one real design artifact by hand. Also find out where design-system projects will live after
  2026-12-14 and with what API (the open question for v2). Record the file layout,
  where CSS lives (files vs `<style>` vs inline), whether there are scripts, and how publish/write
  behaves. Write the result in `research/06-project-format.md`.
- Also check: does a publish → read round-trip return the file byte-for-byte, or add a document
  skeleton (Goal 2 needs a normalisation rule if it does)? Are assets (`/_blob/<id>`) and `support.js`
  origin-relative to claude.ai? A localhost server has no claude.ai credentials, so it cannot proxy them.
  Expected rule, confirmed in `06`: pull fetches each referenced asset, `support.js` and everything
  `support.js` loads at run time (the type's runtime bundle, read through the Artifact tool's `read` on
  the type URL) through the Artifact tool into `.editor/cache/` (keyed by id and type release), the serving layer answers
  `/_blob/*` and `./support.js` from there, and push never sends the cache. This is what makes "works
  without a network" true; the runtime stays pinned to the pulled release until the next pull. M0 also
  checks whether `support.js` waits for a host-page postMessage that the editor's iframe parent will not
  answer, and records the type release the cache was built from. (decided: deep-critic r2) Is the page an ordinary HTML artifact or a typed Design artifact
  whose content lives in data files?
- Also measure the built-in editor's Save footprint: change one property on one element in Claude
  Design, Save, pull, and diff against the previous pull. Record in `06` the lines touched and whether
  anything was reformatted or re-serialised beyond the edit. The push merge (a line-based
  `git merge-file`) only works if a Save touches roughly the lines it changed. Branch, fixed now: a small
  footprint keeps the line merge and the conflict UI as written; a Save that rewrites far more than it
  changed (re-serialised `<x-dc>` body, reformatting) triggers the token-level `node-diff3` retry in push
  step 4 for v1, and say so in `06`. (decided: deep-critic r1)
- Also check how tokens are authored and applied: where the design-system tokens live (e.g.
  `project/ds/*/tokens.json` with a `designSystems` record in `canvas.json`), what the built-in Theme
  menu writes into the artboard when a token is picked (literal value, `var(--x)`, or a variable defined
  by `<helmet><style>`; found by applying a theme colour in Claude Design and reading the result), and
  whether a `var(--x)` in inline `style` survives the runtime. Record it in `06`. (decided: deep-critic r4)
- Every check that publishes or saves (the round-trip, the Save footprint, the Theme-menu write) runs on
  a throwaway copy of Test Site; Test Site itself is only pulled (Testing safety rule). Also confirm in
  code, on LF, CRLF and BOM inputs, that parse5 attribute ranges and PostCSS `source.start.offset`
  slice to the expected text (R09 D6, R11 #2). (decided: Claude, Ron AFK 2026-11-23)
- **Gate (first two hours, go/no-go):** check only that the runtime runs under the serving layer, that
  `data-ed-id` survives template expansion, and that a publish → read round-trip is byte-exact. If any
  fails, stop and apply that check's fallback below (or re-plan before M1); do not spend the rest of the
  day on the remaining checks. At the end of M0, re-estimate M1–M5 from what `06` found and update the
  Effort section. (decided: deep-critic r2)
- **Exit (go/no-go):** the format is known and `research/06-project-format.md` records which branch
  applies. v1 edits **Design canvases**, which is what Claude makes today: `project/canvas.json` plus
  `*.dc.html` artboards (`<x-dc>` root, `{{hole}}` values, `<sc-for>`, `<dc-import>`, `support.js`
  runtime, inline `style` as the main authoring surface). Plain untyped HTML artifacts are a fallback
  only if the project Ron names turns out to be one. M0 runs on one real project of Ron's, is
  time-boxed to one day (about ten separate checks, several needing hands-on work in Claude Design), runs
  the blocking checks first (the gate above), stops there if any fails, and also records three things: what the built-in canvas editor (select, properties panel,
  inline text, undo, Save) already does, what Artifact version history shows and whether a version can
  be diffed or restored, and the 2-3 things this editor adds (snapping and Alt-measure,
  Auto Layout handles, token picker, git diffs, offline). If that list is empty, stop the project and
  tell Ron. The branches are fixed here, before the spike starts; M1 does not start on a guess.
  (decided: deep-critic r2)
  - **Design canvas** (the likely case: the Design type's SKILL.md describes `project/canvas.json` plus
    one `*.dc.html` per artboard, each with `<script src="./support.js">`, an `<x-dc>` root,
    `<helmet><style>`, `{{hole}}` lookups, `<sc-for>`/`<sc-if>`/`<dc-import>`, and inline `style` as
    "what the properties panel edits") → M0 reads one real canvas first and writes `06` with the
    answers to: does `data-ed-id` survive the runtime's template expansion; does the runtime
    (`support.js`, served from the type's fixed files) run under the serving layer; how a canvas is laid
    out from `canvas.json` boards. Architecture, M1 and M2 are written for this branch now, from the
    type's documented format, and each answer has a fallback fixed before M0 runs. Inline `style` is the
    primary write target, with `<helmet><style>` secondary. The cascade resolver, `RuleLocator`,
    `SharedCounter` and the three-step write-target policy are **plain-HTML fallback only** (Appendix A), built only if
    M0 picks that branch or a canvas needs the `<helmet><style>` target. `{{hole}}` values are read-only;
    `<sc-for>` children edit the template node, so the change shows on every repeat at once; the N
    repeats share one id, so selecting any repeat is one selection: hover and selection outline every
    rendered node with that id (the hit-test returns the id, the overlay queries `[data-ed-id]`), the
    optimistic preview applies to all of them, and the panel shows an "affects N repeats" notice (a
    per-item value is a `{{hole}}`, which stays read-only) (decided: deep-critic r4); `<dc-import>` children
    are read-only; push publishes `root` + `files` per artboard. `canvas.json` is read-only in v1: the
    editor never writes it and an artboard root's own size is not resizable (the handle shows "resize the
    frame in Claude Design"); push sends artboard files only and takes the remote `canvas.json` as is, so
    no frame move made in Claude Design can conflict with an editor change. A key-level JSON merge plus a
    style-preserving write (e.g. `jsonc-parser` `modify`) is added only if root resize proves a
    must-have. The core (parse5 offsets, magic-string, Writer, Watcher, snapshot undo) carries over
    unchanged. M0 confirms the format against the real canvas and corrects any of this before M1 starts.
    (decided: deep-critic r3)
    Fallbacks, decided now so M0 answers are pass/fail:
    - ids stripped by template expansion → the serving layer stamps ids after expansion and maps back
      by source-order path inside `<x-dc>` (use the type's own element addressing, the depth-first
      element index plus child-index path documented in the type's `view-state.md`, if M0 confirms it,
      so selections line up with Claude Design's own) (deterministic, since all UI is `<x-dc>` markup, never
      script-built); if that is ambiguous for `<sc-for>` repeats, those nodes are read-only.
    - runtime will not run under the serving layer → **stop; re-plan before M1**, the same as "Anything
      else". There is no static-preview fallback: the page content comes from `renderVals()`, `<sc-for>`,
      `<sc-if>` and `<dc-import>`, so a preview without the runtime is a rewrite of it and "preview = disk"
      would no longer hold. Only an artboard whose markup has none of those could be previewed statically
      (`{{hole}}` filled from its `data-props` defaults), and that is not enough to carry v1; rebuilding
      the evaluator is out of scope. (decided: deep-critic r1)
    - layout from `canvas.json` unclear → open one artboard at a time at its `$preview` size; the
      multi-board canvas view moves to Next.
  - **Plain HTML/CSS files** (and what publish writes back matches what was pulled) → proceed to M1,
    with any asset rule recorded.
  - **Anything else** (JSX, a bundled app, data files with no editable markup) → stop; re-plan before M1.
  - **Publish wraps or rewrites the page** (the pulled source differs from what was published) → add a
    normalisation step to pull/push that strips the wrapper and re-applies it on push, or relax Goal 2
    to "zero-byte diff against the pulled baseline". Decide which in `06`, then continue.
  (decided: deep-critic r1)

### M1 — Read-only canvas (2–3 days, including the probe's batched async reads)
- Server, SourceIndex, serving transform with `data-ed-id`, editor shell with three panels.
- Zoom/pan (Cmd-wheel, pinch, Space-drag, Shift-1 / Shift-2), transparent event shield (R01).
- Hover outline + one shared hit-test. Click / double-click / Cmd-click / Shift-click / Tab /
  Shift-Tab / Enter / Shift-Enter selection rules (R01).
- Layers panel = DOM tree, names from `data-layer-name` → id → class → tag; two-way selection sync (R04).
- Properties panel shows authored values + the selector chip with `file:line` (read-only for now).
- **Exit:** open a pulled project, click anything, and see its layer and the rule it comes from.
  - CI is green on `windows-latest` and `macos-latest`; on both, `server.address().address` is
    `127.0.0.1` for both listeners, and a project path with spaces and non-ASCII characters opens.
  - The editor shell passes the side-by-side screenshot check against the chosen UI mockup (once
    picked). (decided: Claude, Ron AFK 2026-11-23)

### M2 — Write-back core (2 days on the canvas branch, including byte-exact CRLF/BOM handling and text-box trim; +1 day if M0 activates the plain-HTML branch) — the riskiest part, built before any fancy UI
- PatchEngine for `setDecl` / `removeDecl` / `setAttr` / `setText`, Writer, Watcher and UndoLog. On
  the canvas branch (the expected case), `setDecl` and `removeDecl` target the element's inline `style`
  by default. A `<helmet><style>` rule in the same `.dc.html` is written only when the user picks it in
  the selector chip, through a minimal rule lookup by `selectorText` and order in that one block, with
  no cascade sorting. After each write `getComputedStyle` on the live iframe must show the new value; if
  it does not, the panel warns "overridden by `.y`" and the edit stays where it was put. CSS in a
  `/_blob/<id>` asset is read-only on canvases (cached, never pushed; a changed file would be a new
  upload): it is shown, never targeted. The plain-HTML targeting work is in Appendix A and is built
  only if M0 activates that branch. (decided: deep-critic r4)
- Properties panel becomes editable: number inputs with arrow steps and unit preservation, no `px` on
  unitless properties. Solid colour picker (hex/HSL + alpha; any authored CSS colour, `oklch()` and
  `color(display-p3 …)` included, is kept and never clamped to sRGB, R08 #36-37). Opacity, radius,
  border, shadow list, typography (R03). The section order is our design choice, not a Figma fact
  (R08 #27). Typography includes a text-box trim toggle writing `text-box: trim-both cap alphabetic`
  (the final CSS, not Figma's draft `leading-trim`), shown only when
  `CSS.supports('text-box', 'trim-both cap alphabetic')` holds in the iframe, else with a warning
  (R08 C1). (decided: Claude, Ron AFK 2026-11-23)
- Double-click text editing, only on elements whose children are a single text node, using
  `contenteditable="plaintext-only"` (no `<br>`/`<div>` on Enter, plain paste). `setText` diffs the
  **source** text node (never the rendered text) against the new text and splices only the changed span, encoding just `&`, `<` and non-breaking spaces in
  the new characters, so untouched entity spellings stay byte-identical. Elements with inline children
  (`<b>`, `<br>`, several text nodes) are not text-editable in M2: the editor shows a "edit in source"
  hint. The same hint ("contains a live value; edit in source or Tweaks") shows, and `setText`/`setAttr`
  refuse, whenever the source text node or attribute value contains `{{` (e.g. `Hello {{name}}`,
  `x="a {{p}} b"`): the live text is the expanded value, so a splice at its offsets would corrupt the
  hole. Segment-aware editing of the literal parts is Next. (decided: deep-critic r2)
- **Exit:**
  - the golden tests pass (see Testing);
  - an untouched session gives a zero-byte diff;
  - editing one property gives a one-line diff.
  - on both OSes and with `autocrlf` true and false, the LF, CRLF, mixed, BOM and
    no-trailing-newline fixtures give a zero-byte untouched diff, and a one-property edit keeps the
    file's line ending and BOM;
  - Windows: with a child process holding the target open without share-delete, a save retries, then
    succeeds or shows "file locked", and the pending edit survives. (decided: Claude, Ron AFK 2026-11-23)

### M3 — Direct manipulation (2 days)
- Context-aware drag, 3–4 px threshold (R01):
  - flex/grid child → reorder with an insertion line (`moveNode`);
  - absolute element → `left` / `top` in its existing unit;
  - transformed element → only the translate term.
- Arrow nudge 1 / 10 px.
- 8-handle resize writing `width` / `height` (respect `box-sizing`; warn when flex sizing overrides it),
  with a live size label. An artboard root's size is read-only in v1: its handles are disabled with
  "resize the frame in Claude Design", because a root resize must stay in step with `$preview` in
  `data-props` and `boards[path]` in `canvas.json`, which is more than one splice in one file.
  (decided: deep-critic r3)
- Snapping to sibling/parent edges and centres (8 screen px ÷ zoom); guides drawn on snap; Ctrl bypasses. The probe snapshots the dragged element's sibling and parent rects once at drag start, and snapping and Alt-measure then run locally per frame, with no postMessage round trip per mouse move.
- Alt-hover red distance lines labelled margin / padding / gap.
- **Exit:** Playwright e2e — drag, resize and reorder each produce the expected source diff.

### M4 — Auto Layout = flexbox (1–2 days)
- Layout section (R02):
  - direction, gap, padding;
  - 9-dot alignment (axes swap for column). `align-items: normal` and `stretch` read as their own
    "stretch" state, outside the nine cells, and are never rewritten to a cell value unless the user
    picks one (R08 #9);
  - space-between.
- Hug / Fill / Fixed per axis + min/max. Fill = `flex:1 1 0` plus `min-width:0` (`min-height:0` in a
  column) on the main axis, `align-self:stretch` on the cross axis; the shrink value is irrelevant at
  basis 0, and the real overflow guard is the `min-*:0` (R08 #10). Reading classifies Fill as
  `flex-grow > 0` with basis 0, whatever the shrink. Fixed adds `flex-shrink:0` as editor policy, not a
  Figma fact. Min/max fields accept `px`, `rem`, `%` and `var()` and keep the authored unit (Figma is
  px-only); setting `max-*` on a `content-box` element warns that padding adds to it (R08 C2).
  (decided: Claude, Ron AFK 2026-11-23)
- On-canvas padding handles (Alt = opposite sides, Alt-Shift = all).
- "Ignore auto layout" (`position:absolute` + parent `position:relative`, with a warning if that
  changes other absolute descendants).
- **Exit:** a block element can be turned into a row, its alignment and sizing changed, and the
  CSS diff matches the mapping table in R02.

### M5 — Tokens, structure, safety (2½ days, including multi-edit)
- Token picker sourced from `project/ds/*/tokens.json` (the design-system tokens the Theme menu reads),
  falling back to `:root --*` variables only when a canvas has them; with neither, the picker is hidden.
  Picking a token writes exactly what the built-in Theme menu writes into the file (a `var(--x)` or a
  literal value); M0 records which in `research/06-project-format.md`, and M5 copies that form rather
  than inventing one. If M0 shows no such form, the `:root --*` fallback writes `var(--x)`.
  `tokens.json` is read-only. Typing a raw value detaches that element only. "Edit token" is an
  explicit action (R03). (decided: deep-critic r4)
- Layer actions: drag reorder/reparent, wrap in container, ungroup, duplicate (strip duplicate ids),
  delete. Guards against void elements and cycles. Warn when a move changes which selectors match (R04).
  A structural op that would break HTML parsing rules (a block inside `<p>`, a `<div>` inside a heading or
  `<button>`, a `<li>` outside a list, table parts out of place, a nested `<a>` or `<form>`) is rejected with
  a one-line explanation. It is never auto-adjusted: the parser would reparse such source into a different
  tree than the live DOM, and swapping the tag silently rewrites the author's markup and changes which
  selectors match. While dragging, targets known to be invalid are greyed out, using the HTML spec's
  content-model and implied-end-tag rules, and the server re-checks the same rules before patching; any
  invalid nesting those rules miss is caught by the Writer's re-parse shape check, which refuses the move.
  (decided: deep-critic r2)
- Copy / paste style: authored declarations only, with a toast listing what was applied (R04).
- Multi-edit: with several elements selected (ancestors of other selected elements dropped), each
  panel field shows the shared value or "Mixed"; an edit writes the same declaration to every target
  as one op, one edit record and one undo entry; on a canvas each target is its own inline `style`
  (R07 #1). (decided: Claude, Ron AFK 2026-11-23)
- Hide / lock (editor-only). Per-file diff panel with "revert file" (R05), listing the session's edit
  records per file.
- **Exit:** all v1 "must" items in R00 are done.
  - multi-edit of three elements with different widths shows "Mixed", writes three declarations, and
    one Cmd-Z restores every touched file byte-identical.
  - a golden sequence passes: move, duplicate, undo ×2, then a property edit still lands on the
    intended element, and the final diff matches the snapshot.

### M6 — Pull / push: `edsync` CLI + skills (2 days: about 1 day for the CLI and its tests, 1 for skills, editor lock endpoints and the loop)
- The `edsync` CLI with its vitest suite (see Testing), the editor's `/push/begin`, `/push/end`,
  `/health` and `/shutdown` endpoints, then `/design-pull` and `/design-push` as thin skills over them,
  for the Artifact-backed design found in M0. (decided: Claude, Ron AFK 2026-11-23)
- **Where it runs:** a throwaway copy of "Test Site" (a new private Design artifact published from its
  pulled files), never Test Site itself. (decided: deep-critic r1) Test Site is only ever pulled; no
  test pushes to it or to any other real canvas (Testing safety rule). (decided: Claude, Ron AFK 2026-11-23)
- **Exit:** full loop on the throwaway copy, a real project in shape:
  - a pull, an edit and a push show up in Claude Design;
  - a remote edit made in between merges cleanly when it touches different lines; an overlapping edit
    stops the push, shows the conflicting files and hunks, and nothing is sent.
  - a remote edit to artboard A made while artboard B is edited and pushed lands in the working tree on
    that push; a later local edit to A and a second push keeps it (test: two pushes in a row).
  - a publish approval left open for 5 minutes neither unlocks the editor nor leaves the sync
    unrecorded;
  - Windows: the same loop passes once by hand on Windows; a CLI-held lock whose holder is killed is
    taken over only after `expiresAt`; `git merge-file` runs clean and conflict cases with matching and
    mismatched line endings. (decided: Claude, Ron AFK 2026-11-23)

### M7 — Beyond Figma (7½ days; after v1 ships, below the cut line)
From R10 (ranked) and R07's SHOULD items. Every action registers in one action registry
`{id, label, kbd, run, when}` that menus, shortcuts and the palette all read. Playwright on the server
is approved for screenshots; it loads the project origin directly, where the CSP `sandbox` header still
applies. In order (decided: Claude, Ron AFK 2026-11-23):
1. **Command palette** (½ day): Cmd/Ctrl-K fuzzy search over actions, layers (tag, class, text) and
   tokens; suspended while text editing.
2. **Ask Claude about the selection** (1½ days): the editor writes a context bundle to
   `.editor/asks/<id>.json` (file, edId, source range, outer HTML, a few computed styles, a PNG crop,
   the user's text, the edit records so far) and copies a one-line `/design-ask <id>` prompt. The
   editor never spawns Claude Code (decided: deep-critic r1). The `/design-ask` skill edits only that
   range; the watcher sees an outside edit and the per-file diff panel shows it with keep / revert file.
   This is also the "needs AI" route for edits the panel cannot express (R09 D4).
3. **Token usage map** (1 day): list each token and `:root` variable with its use count; click
   highlights users; flag literals equal to a token's value with "convert to `var(--x)`" (a splice).
4. **Accessibility overlay** (1 day): axe-core injected by the probe, run on demand and after edits
   (debounced), violations mapped to edIds and badged; numbered tab-order chips; "fix contrast"
   proposes the nearest passing token.
5. **Responsive multi-viewport** (1 day): N iframes of one artboard at preset widths
   (`.editor/viewports.json`: 390 / 768 / 1440), selection and scroll mirrored by edId. Read-only
   panes except the main one; breakpoint editing stays in Next.
6. **Visual diff before push** (1 day): `edsync shots` renders each artboard to `.editor/shots/` at pull
   and before publish; pixelmatch marks changed regions; the push skill shows the changed-pixel summary
   per artboard before asking for the publish, and the editor shows swipe / diff views.
7. **Small canvas tools** (1 day): persistent margin / padding / gap overlays for the selection;
   select matching (same tag and class set, Opt/Alt-Cmd/Ctrl-A, feeds multi-edit); outline view (an
   editor-only stylesheet injected into the frame, never saved); pixel grid at zoom ≥ 400% with
   Cmd/Ctrl-' to toggle and Cmd/Ctrl-Shift-' to snap (R07 #17; not Shift-'); Alt-drag to duplicate.
8. **Export selection as PNG** (½ day): Playwright element screenshot with `omitBackground`; SVG later.
- **Exit:** each item has a Playwright test on both OSes; Ask Claude round-trips on the throwaway copy
  with the change visible in the diff panel; axe reports a seeded contrast failure on its element; the
  visual diff flags a one-property change on the right artboard and nothing else; the editor passes the
  UI mockup screenshot check again. Cut from the bottom of the list if time runs short.

## Next (after v1)
One line each on why it waits (decided: Claude, Ron AFK 2026-11-23):
- **Rulers and guides** (R07 #4): board `guides` live in `canvas.json`, which v1 never writes.
- **Jujutsu-style whole-project op log** (R09 D2): snapshot undo already gives byte-exact per-file
  undo, and making outside edits ordinary undoable ops would reverse the decided "drop that file's
  entries" rule.
- **Shadow branch / worktree for sync** (R09 D3): `projects/<slug>/` is already an editor-owned repo
  that only the editor and `edsync` write; a worktree adds a second path to serve and watch for no v1
  gain.
- **Mergiraf as the conflict resolver** (R09 D7): v1 keeps the decided line merge plus the conditional
  `node-diff3` retry; revisit if M6 conflicts are frequent.
- **Breakpoint editing into `@media`** (R10 #3): needs multi-viewport first and a `<helmet><style>`
  target on canvases.
- **Annotation pins as batched prompts, version scrubber, presentation mode, plugins, SVG export**
  (R09 D8, R10 #9-12): useful after Ask Claude proves out.

## Testing

- **Golden round-trip corpus** (`test/fixtures/`): real pulled projects plus hand-made edge cases. The
  edge cases are comments, odd indentation, shorthands, `!important`, `@media`, `var()` with fallback,
  `<style>` blocks, inline styles, void elements, implicit `<tbody>`, script-made DOM, entities
  (`&amp;`, `&nbsp;`, `&#8217;`) and an element with inline children. Every fixture also exists in
  LF, CRLF, mixed-ending, UTF-8-BOM and no-trailing-newline variants, committed as `-text`, and each
  variant checks that every parse5 `startOffset` slices to the node's own tag text (R11 #2).
  (decided: Claude, Ron AFK 2026-11-23)
- **Branch scope:** the `<style>`/`@media`/shared-CSS edge cases and the cascade and target-policy unit
  tests below apply to the plain-HTML branch only; on the canvas branch the corpus is the Canvas
  fixtures plus inline-style and `<helmet><style>` cases.
- **Canvas fixtures** (if M0 picks the Design canvas branch): one `.dc.html` with a `{{hole}}` inside an
  inline `style` value, an `<sc-for>`/`<sc-if>` template, a `<dc-import>` and a `<helmet><style>`. Golden
  tests pin the decided rules: editing a non-hole declaration in a style that also contains `{{hole}}`
  changes only that declaration; a `{{hole}}` value, text or an attribute that contains a `{{hole}}`,
  and `<dc-import>` children refuse the edit; an
  `<sc-for>` child edit lands on the template node and reports "affects N repeats". A text node and a
  plain attribute that each mix literal text with a `{{hole}}` (`Hello {{name}}`, `x="a {{p}} b"`)
  refuse `setText` / `setAttr` and leave the file byte-identical.
- For each fixture:
  - **no-op:** open → save → byte-identical;
  - **one op:** apply → the diff equals the expected snapshot → undo → byte-identical.
- **Unit tests:** cascade resolution, target policy, shorthand expand/collapse, unit preservation,
  Hug/Fill/Fixed mapping, the snap maths.
- **`edsync` CLI tests** (vitest, throwaway git repos, a fake remote): one-sided change on each side,
  both-sided clean merge, both-sided conflict, edit vs remove, local artboard add (stop), remote
  artboard add (write + blob fetch), dirty-tree pull refusal, two pushes in a row, a lapsed lease after
  publish (sync still recorded), mismatched line endings, and a negative `git merge-file` exit.
  (decided: Claude, Ron AFK 2026-11-23; critic v8)
- **CI:** GitHub Actions matrix `windows-latest` + `macos-latest` × `autocrlf` false / true runs all
  of the above plus Playwright on every PR (see Cross-platform). Windows-only jobs: the locked-file
  rename test and the lock-takeover test. (decided: Claude, Ron AFK 2026-11-23)
- **Safety rule:** automated and manual push tests target a throwaway Artifact copy created for the
  test, never Ron's real canvases; Test Site is only ever read. Automated tests use a fake remote and
  publish nothing. (decided: Ron's rule, recorded by Claude, Ron AFK 2026-11-23)
- **Playwright e2e** for every M3–M5 exit criterion, driving the real canvas.
- **Preview = disk:** in the e2e suite, after each op, the edited element's computed style in the
  iframe equals that of a fresh load of the written file.
- **Manual check per milestone:** side-by-side screenshot of the project in Claude Design vs the
  editor after a push (to the throwaway copy).

## Risks

| Risk | Mitigation |
|---|---|
| Claude Design files aren't plain HTML/CSS (e.g. JSX, a bundled runtime, a data-driven Design type) | M0 spike first; re-plan before M1 if so; the runtime cannot run locally is a stop, not a fallback |
| Cascade resolution is wrong → edits land in the wrong rule (plain-HTML branch, Appendix A) | The panel always shows the target rule; the browser reports matches and a computed-style check confirms the edit took effect; rules in `@layer`/`@container`/`@scope` fall back to inline with a warning; an `!important` winner is overridden by inline `!important` on that element only (rule 2); golden tests |
| Shared-class edits surprise the user | Default never edits a shared rule silently; "affects N elements" warning |
| Drag-reorder changes which selectors match (`:nth-child`, sibling combinators) | Detect and warn before committing the move |
| Push overwrites remote edits | Base hashes + `git merge-file` stop-on-conflict; Artifact publish refuses stale writes; logic in the tested `edsync` CLI |
| Windows breaks byte-exact writes (CRLF, BOM, locked files) | Byte-exact Writer, `* -text` in project repos, rename retry, CI matrix with CRLF/BOM fixtures (Cross-platform) |
| Standalone claude.ai/design closes 2026-12-14 | v1 supports Artifact-backed designs only; DesignSync is out of scope (tool is scoped to /design-sync and the service closes 12-14; see Pull / push) |

## Open questions for Ron

1. ~~Which real project should M0 and the golden corpus start from?~~ **Decided:** a multi-file design
   artifact Ron owns, with at least one script (a shared CSS file only if M0 picks the plain-HTML branch; on a canvas, `/_blob` CSS is read-only). Real files expose edge cases that
   hand-made ones miss, and this shape exercises shared-rule targeting, cross-file indexing and
   read-only script-made DOM. The hand-made edge cases in Testing stay alongside it. The project is
   "Test Site", Ron's Design canvas at (its link is kept out of this public repo).
   (decided: deep-critic r1) The M0 project should be a real Design canvas
   Ron owns, with at least one `<sc-for>` or `{{hole}}` and one `<dc-import>`; a plain-HTML artifact
   only if M0 finds that Ron's projects are plain HTML. (decided: deep-critic r2) M0 checks that Test
   Site has `<sc-for>` or `{{hole}}` and a `<dc-import>`; if it lacks them, M0 notes that in
   `research/06-project-format.md` and adds hand-made fixtures for those cases. (decided: Ron,
   deep-critic r3)
2. Panels stay in React; the canvas overlay stays plain DOM/SVG. Bundle size is irrelevant for a
   localhost tool, the panels are form-heavy (number inputs, selector chip), and React keeps the
   standard Vite template and ecosystem without `preact/compat` quirks (`onChange` vs `onInput`, no
   synthetic events). Preact remains a cheap later swap via an alias if panels stay on plain hooks.
   (decided: deep-critic r1)

## Effort

The original figure, now superseded by the table below: roughly 10–12 working days for M0–M6, with M0 counted as one day. The M1–M5 estimates are re-made at
the end of M0, once the format and Save footprint are known; the 10–12 day figure is provisional until
then. (decided: deep-critic r2) M2 (write-back) is the critical path. If it slips, cut M5's
layer actions to "Next" before touching M2's quality bar.

Updated for the 2026-11-23 additions (decided: Claude, Ron AFK 2026-11-23):

| Part | Days |
|---|---|
| M0 spike | 1 |
| M1 read-only canvas | 2–3 |
| M2 write-back core (+½ for CRLF/BOM and text-box trim) | 2 |
| M3 direct manipulation | 2 |
| M4 Auto Layout | 1–2 |
| M5 tokens, structure, multi-edit (+½) | 2½ |
| M6 `edsync` CLI + skills (+1, about half moved from skill prose) | 2 |
| Cross-platform: CI matrix, Windows fixes and runs, spread over M1, M2, M6 | 1 |
| **v1 total (M0–M6)** | **13½–15½** |
| M7 Beyond Figma | 7½ |
| **Total with M7** | **21–23** |

**Cut line: v1 ships at the end of M6.** Cross-platform work is never cut (Ron's requirement). Inside
v1, cut in this order: M5 layer actions, then multi-edit, then text-box trim, each to Next, before
touching M2's quality bar. M7 sits below the cut line and is cut from the bottom of its list
(PNG export first, palette last).

## Appendix A — Plain-HTML branch (inactive unless M0 selects it)

Nothing here is built unless M0 picks the plain-HTML branch (or, for the targeting rules, a canvas
needs the `<helmet><style>` target beyond the M2 minimal lookup). Moved out of Architecture and M2
unchanged. (decided: Claude, Ron AFK 2026-11-23; critic v8)

- **Cascade resolution runs in the browser; the server only maps to source.** The overlay walks the
  iframe's `document.styleSheets` (recursing into `@media` / `@layer` / `@container` / `@supports` rules),
  tests each style rule with `element.matches()` under the live `matchMedia`, and sorts the matching
  declarations itself, since no web API reports the winning rule: `!important` first, then `@layer`
  order, then `specificity` (the package already in the stack), then sheet and rule order.
  `getComputedStyle` is only a guard: it confirms the value took effect, and cannot tell apart two rules
  that set the same value. That covers `@layer` order, `@container`,
  the active viewport and script-set state, which a Node re-implementation would miss. The browser sends
  `{edId, property, rulePath}` where `rulePath` is the stylesheet index plus the nested rule-index path.
  The server's `RuleLocator` resolves it to `ruleId` and declaration ranges via the postcss index,
  checking `selectorText` and order because the CSSOM drops invalid rules. The project's CSS is served
  byte-for-byte, so both sides see the same rule order. A rule is a write target only if it is a plain
  style rule, or one inside `@media` or `@supports`. A rule inside `@layer`, `@container`, `@scope` or an
  `@import`ed sheet is shown in the panel but never targeted, and a path that fails to resolve (for
  example an injected stylesheet) is treated the same way: the edit goes to the inline `style` attribute
  with a visible warning. (decided: deep-critic r1)
- **Write target policy** (R03, R05):
  1. the rule the user picked in the panel's selector chip;
  2. else the rule that currently wins the cascade for that property, if only this element matches it
     (counted across every indexed HTML file that loads that stylesheet, not just the open page. The open
     page uses the browser's live `matches()`. Every other file is counted by the server's `SharedCounter`,
     which parses it with `parse5` + `parse5-htmlparser2-tree-adapter` (`css-select-parse5-adapter` is
     archived) and runs `css-select` on the rule's selector. The count is conservative: a selector with a
     dynamic pseudo-class (`:hover`, `:focus`, `:active`, `:visited`, `:checked`, `:target`, or `:not(...)`
     over one), a selector `css-select` throws on, or a file with a `<script>` all count as shared, so the
     worst error is an extra "affects N elements" warning, never a silent shared edit. Hidden iframes are
     not used, since they run untrusted scripts). If the winner is a shared `!important` rule, the edit
     still goes to the element: the Writer emits an inline `style` declaration marked `!important`, which
     outranks every author `!important` (layered or not, any specificity); only user/UA important styles
     and transitions beat it. The panel shows a chip "overrides `!important` in `.x` (file:line)", and
     "Edit shared class" stays the explicit way to change the rule itself. A shared match with a normal
     winner shows the "affects N elements" warning; (decided: deep-critic r2)
  3. else the inline `style` attribute.

  "Edit shared class" and "Extract to class" are explicit actions with a "affects N elements" warning.
  Computed values are never written. Authored units, colour format and `var()` are kept.
- **M2 on this branch (+1 day):** the UI sends the matching rules as stylesheet + rule path, the server
  maps each to its PostCSS rule, an automatic target (policy rules 2 and 3) that fails the
  `getComputedStyle` check falls back to inline, and a rule the user explicitly picked (rule 1) is still
  written where they said, with an "overridden by `.y` (file:line)" warning. (decided: deep-critic r4)
- **Live structural apply and undo re-sync:** with no runtime owning the DOM, the UI stamps the ack ids
  on optimistic nodes and applies structural ops to the iframe DOM without a reload, and undo re-syncs
  the live DOM in place; on a Writer shape-check mismatch the live change is reverted. Built only after
  the canvas reload path. (decided: deep-critic r1)
