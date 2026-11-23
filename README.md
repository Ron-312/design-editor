# design-editor

A local, Figma-style visual editor for **Claude Design** canvases.

Claude makes the design. You hand-tune it with the mouse: select, drag, resize, snap, measure,
Auto Layout, a real properties panel, design tokens. Every change is spliced straight into the
canvas's own HTML. There is no conversion and no separate design file, and an untouched session
leaves a zero-byte diff. When you're done, one command syncs it back to Claude Design.

```
/design-pull <canvas link>   →   edit on the canvas   →   /design-push
```

Runs on **macOS and Windows**.

> **Status: v1 built (M0–M6), not yet tried against a live canvas.** The editor, write-back and the
> pull/push sync are implemented and tested (about 1,550 unit tests at 99% function coverage, 36 browser tests; CI runs on macOS and Windows, Chrome and Edge).
> The canvas format details were built from Claude Design's documented format and hand-made sample
> canvases; a live check against a real canvas is the next step. What is built versus planned, feature by
> feature, is in [`plans/v1/parity.md`](plans/v1/parity.md). "Beyond Figma" (M7) is planned, not built.

![Editor — dark](docs/screenshots/editor-dark.png)

![Editor — light](docs/screenshots/editor-light.png)

## Desktop app

Installers for macOS (`.dmg`, Apple Silicon and Intel) and Windows (setup `.exe`) are built by the
[installers workflow](.github/workflows/installers.yml); download them from the run's artifacts, or build
them yourself with `npm run dist:mac` / `npm run dist:win`. The app opens a canvas folder that
`/design-pull` made (File → Open Canvas Folder…) and needs [Git](https://git-scm.com/downloads) installed.

The builds are not signed with a paid certificate yet:
- **macOS:** the first time, right-click the app → **Open** → **Open**.
- **Windows:** on the SmartScreen prompt, click **More info** → **Run anyway**.

Pulling from and pushing to Claude Design still happens in Claude Code (`/design-pull`, `/design-push`);
the app is the editor in between, and push works while it is open.

## Getting started

Requires **Node 22.12+** and **Git 2.44+** (macOS or Windows).

```bash
git clone https://github.com/Ron-312/design-editor.git
cd design-editor
npm install
```

Then, in Claude Code opened in this folder:

```
/design-pull <your Claude Design canvas link>
```

That pulls the canvas into `projects/<slug>/`, caches its assets for offline use, and starts the editor
on `http://127.0.0.1:5300` (it builds the UI on first start). Edit on the canvas; every change is saved
straight into the canvas files. When you're done:

```
/design-push
```

Push does a three-way merge with whatever changed in Claude Design meanwhile and stops on any conflict
instead of overwriting.

To run the editor on an already-pulled project yourself: `npm start -- --project projects/<slug>`.

## What it does

- **Canvas that feels like Figma.**
  - Click picks the top-level element, double-click goes deeper, Cmd/Ctrl-click picks the deepest element.
  - Drag a child of a flex or grid layout to reorder it; drag an absolutely positioned element to move it.
  - 8 resize handles (they write px), edge and centre snapping with guides while moving, Alt-hover red
    distance lines, zoom and pan.
- **Auto Layout is CSS flexbox.** Direction, gap, padding handles, 9-dot alignment, and Hug / Fill / Fixed
  sizing. All of it is written as real CSS.
- **Properties panel.**
  - Shows exactly which rule and line you're editing (`style · hero.dc.html:42`).
  - Warns when an edit inside a repeated block (`<sc-for>`) changes every repeat.
  - Number inputs keep your units; colour fields keep the colour format you wrote (hex, rgb, hsl).
  - The token picker reads `tokens.json`.
- **Clean write-back.** Byte-exact splices, so formatting, comments, line endings (CRLF/LF) and BOMs all
  survive. Undo uses file snapshots.
- **Safe sync.** Push does a three-way merge against what you pulled, never silently overwrites
  remote edits, and stops on any conflict.

## How it works

```
browser: editor UI (React panels + overlay)  ──ws──  Node server on 127.0.0.1
   └─ sandboxed iframe (second port) running the canvas         ├─ SourceIndex (parse5 + PostCSS offsets)
                                                                ├─ PatchEngine (magic-string splices)
                                                                ├─ Writer (atomic, retry on Windows locks)
                                                                └─ edsync CLI (pull / push / merge, git)
```

The full design, decisions and trade-offs are in [`plans/v1/plan.md`](plans/v1/plan.md). The research
behind it (Figma's interaction model, layout-to-CSS mapping, prior art like Onlook / Webflow / Penpot,
Windows pitfalls) is in [`plans/v1/research/`](plans/v1/research/), with sources.

## Development

```bash
npm run check          # typecheck + lint + unit tests
npx playwright test    # browser tests (run `npx playwright install chromium` once)
```

## UI direction

The UI follows mockup **B — Warm studio**, chosen from three directions. The app next to the mockup:

![App vs mockup](docs/screenshots/compare-dark.png)

| A — Quiet precision | B — Warm studio (chosen) | C — Floating focus |
|---|---|---|
| ![A](design/ui-options/shots/a-quiet-precision-default.png) | ![B](design/ui-options/shots/b-warm-studio-default.png) | ![C](design/ui-options/shots/c-floating-focus-default.png) |

## License

MIT
