---
name: design-pull
description: Pull a Claude Design canvas into projects/<slug>/ for the local editor, or refresh one already pulled. Use when the user runs /design-pull with a canvas link or name.
---

# /design-pull

This skill holds no logic. It makes the Artifact tool calls, and every other step is one
`node tools/edsync.mjs <verb>` command run from the editor repo root. The commands are the same in
PowerShell, cmd and zsh. Quote every path you pass, and never build a command out of shell
variables.

## Inputs

- The canvas: a claude.ai artifact link, or a name to find with the Artifact tool's `list` action.
- `<slug>`: the canvas name in lower case with dashes, such as `test-site`. The project lives in
  `projects/<slug>/`.

## Steps

1. **Read the remote.** List the canvas's files with the Artifact tool (`action: "list"`,
   `scope: "files"`), then read every `project/*` file plus `project/canvas.json` in one Artifact
   `read` with `paths`. Let the files land in the tool's default scratchpad folder: never point the
   read into the project, because a save outside that folder asks the user on every file and stalls
   an unattended pull. The result names the folder it saved into; that is the snapshot folder.

2. **Ingest the snapshot.** Run:

```
node tools/edsync.mjs ingest --remote-dir "<snapshot folder>" --slug <slug>
```

   A new project is placed in `projects/<slug>/`, gets its own git repo and a pulled baseline, and
   `.editor/base.json`. An existing project is refreshed instead: remote-only changes are written and
   the synced commit advances. If it exits non-zero saying to run /design-push first, the project has
   unpushed edits: tell the user and stop. Any other non-zero exit: report its message and stop.

   The JSON it prints lists `blobIds` (the `/_blob/<id>` assets the project uses) and `supportJs`
   (true when the artboards load `./support.js`).

3. **Fetch the assets.** Read every id in `blobIds` with the Artifact tool's `read` and `paths` on the
   canvas, and, when `supportJs` is true, `support.js` from the canvas's type URL. Leave them in the
   default scratchpad folder as before. Then run:

```
node tools/edsync.mjs cache --slug <slug> --from "<fetched folder>" --release <type release>
```

   `<type release>` is the version of the Design type the canvas was read from, as recorded in
   `plans/v1/research/06-project-format.md`.

   The JSON it prints has `missing`: ids that fetched stylesheets or scripts reference and the cache
   still lacks. While `missing` is not empty, read those ids into the scratchpad the same way and
   re-run the cache command on the new folder. Repeat until it prints no missing ids.

4. **Start the editor** on `projects/<slug>` for the user (the npm `start` script with `--project projects/<slug>`),
   and tell them the pull is done and which project it made or refreshed. No build step comes first: on a fresh
   checkout, where `dist/ui` does not exist yet, the `start` script builds the UI into it (the same build as the
   npm `build` script, under a minute) before it starts the editor.

Pulling only ever reads the remote. It never publishes.
