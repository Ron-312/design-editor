---
name: design-push
description: Push the edits made in the local editor for projects/<slug>/ back to their Claude Design canvas, merging remote edits made in between. Use when the user runs /design-push.
---

# /design-push

This skill holds no logic. It makes the Artifact tool calls, and every other step is one
`node tools/edsync.mjs <verb>` command run from the editor repo root. The CLI decides which bytes
move; the skill never picks files itself. The commands are the same in PowerShell, cmd and zsh. Quote
every path you pass, and never build a command out of shell variables.

## Safety rule

Never push to Ron's "Test Site" canvas or to any other real canvas while testing. Test Site is only
ever pulled. A push test targets a throwaway copy made for that test.

## Steps

1. **Take the push lock.** Run:

```
node tools/edsync.mjs lock --slug <slug>
```

   It prints `{"nonce": "...", "holder": "..."}`. Keep the nonce for every later step. When the editor
   is running it flushes its edits and locks the canvas first. A non-zero exit means another push
   holds the lock or the editor did not answer in time: report the message to the user and stop.
   From here on, every way out of this skill runs the unlock in step 6.

2. **Re-read the remote.** List the canvas's files with the Artifact tool (`action: "list"`,
   `scope: "files"`), then read every `project/*` file plus `project/canvas.json` in one Artifact
   `read` with `paths`. Let the files land in the tool's default scratchpad folder: never point the
   read into the project. The folder the result names is the snapshot folder.

3. **Classify.** Run:

```
node tools/edsync.mjs classify --slug <slug> --remote-dir "<snapshot folder>" --nonce <nonce>
```

   It prints the plan, one entry per file: `upload`, `write-remote`, `merge`, `unchanged`,
   `conflict` or `stop`. Remote-only and cleanly merged files are already written into
   `projects/<slug>/`.

   - Exit 2 means the push stopped and nothing is to be sent. Show the user each `conflict` file with
     its `hunks` (they choose: keep Claude Design's version, keep the editor's, or edit by hand) and
     each `stop` file (add or remove artboards in Claude Design). Then unlock (step 6) and stop.
   - Exit 1 is an error, for example a lost lock. Report its message, unlock (step 6) and stop.
   - When `missingBlobs` is not empty, read those ids into the scratchpad with the Artifact tool's
     `read` and `paths`, and run `node tools/edsync.mjs cache --slug <slug> --from "<fetched folder>" --release <type release>`
     until it prints no missing ids, before the commit.

4. **Publish once.** When `publish` is not null, make a single Artifact publish to the canvas `url`
   with `root` and `files` exactly as classify printed them: one call carrying every changed artboard,
   never one call per artboard. When `publish` is null there is nothing to send; go to step 5.

   If the publish is refused because the remote changed since step 2, report the refusal to the user,
   delete the lock with `node tools/edsync.mjs unlock --slug <slug> --nonce <nonce>`, and leave the
   re-run of /design-push to the user. Files that already landed classify as unchanged next time.

5. **Record the sync.** Once the publish succeeded, or nothing was to be sent, run:

```
node tools/edsync.mjs commit --slug <slug> --nonce <nonce>
```

   It commits what both sides now hold as the new synced commit and rewrites `.editor/base.json`, even
   when the lease lapsed during a slow publish approval.

6. **Unlock.** On finish or abort, run:

```
node tools/edsync.mjs unlock --slug <slug> --nonce <nonce>
```

   The editor reloads the files the push rewrote and accepts edits again. Tell the user what was sent,
   what came in from Claude Design, and the synced commit.
