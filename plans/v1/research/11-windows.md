# 11 - Windows (and macOS) cross-platform audit

Scope: what breaks or differs on Windows for the design in plan.md (Node >=20 server, Vite + React UI, parse5 + magic-string byte-exact splices, atomic tmp + rename writes, chokidar, `.editor/push.lock`, `git merge-file`, two localhost origins, Claude Code pull/push skills).

Method: every claim below carries a URL that was fetched (WebFetch) or returned by WebSearch in this session. Items marked "(inference)" are my reasoning, not a sourced statement, and should be proven by a Windows CI test before the plan depends on them. Priority: MUST = changes the plan or a milestone exit; SHOULD = do it, low cost.

## Issue table

| # | Area | Problem | Fix / library | Plan impact |
|---|------|---------|---------------|-------------|
| 1 | CRLF vs LF in project files | Git for Windows users commonly run `core.autocrlf=true` (GitHub's guide tells Windows users to set it: S9), which rewrites LF to CRLF on checkout. A project cloned that way hands the Writer CRLF files, and the pull/push `git merge-file` base/ours/theirs may mix endings. A "zero-byte diff" is judged against the bytes on disk, so the Writer must never normalise. | Writer: read as `Buffer`, decode with `TextDecoder('utf-8', {ignoreBOM:true})`, never `split('\n')`/`join`; splice by UTF-16 offsets taken from parse5; **detect the file's dominant EOL once (`\r\n` vs `\n`, record mixed) and emit inserted text in that EOL**. Project repo gets a committed `.gitattributes` (see #3). | **MUST** (Writer spec + test fixtures) |
| 2 | parse5 offsets with CR / BOM | parse5's preprocessor treats CRLF as one line break for line/col, but the offset counts the raw buffer, so a skipped LF still occupies an index; a BOM is not stripped and occupies offset 0 (S14). So parse5 offsets index the raw string correctly *if you feed it the raw string including BOM*. Danger is only if code strips the BOM (or `\r`) before parsing and then splices the original. | Rule: parse and splice the **same** string; never `.trim()`, `.replace(/\r\n/g,'\n')` or strip BOM before parse. Add property test: for each CRLF / LF / mixed / BOM fixture, untouched session = identical bytes, and every `sourceCodeLocation.startOffset` slices to the node's expected tag text. Do not rely on line/col (CRLF merges to one line break, S14). | **MUST** (M0 spike fixture list + M2 tests) |
| 3 | `core.autocrlf` + `.gitattributes` in per-project repos | `.gitattributes` beats `core.autocrlf` per path: `-text` = no conversion on checkin or checkout; `text eol=lf` forces LF in index and working tree even on Windows; `text` alone is converted per platform default (CRLF on Windows) (S3). `binary` macro = `-diff -merge -text` (S3). | Two policies, pick one explicitly: (a) **byte-preserving (recommended for an editor whose bar is zero-byte diff)**: per-project `.gitattributes` with `*.html -text`, `*.css -text`, `*.js -text`, `*.json -text`, so git never rewrites bytes and the Writer never sees a converted file; or (b) normalise: `* text=auto eol=lf` and `git add --renormalize .` once (S3, S10). The editor creates the per-project repo itself, so it should also run `git config core.autocrlf false` and `core.safecrlf false` **locally in that repo** (git config scopes: local beats global, S3 refs autocrlf as fallback only when attributes unspecified). Do not add `-text` to files from other repos. | **MUST** (decide in M0; write into Pull/push) |
| 4 | `git merge-file` on mixed endings | `git merge-file` is a three-way line merge on the given files; its docs say nothing about attributes or EOL conversion (S5). Lines that differ only by `\r` conflict spuriously (inference; docs silent). Exit code is the conflict count, negative on error, truncated to 127 (S5). | Before merging, the push skill checks that base/ours/theirs have the same dominant EOL; if not, **normalise only the copy fed to merge-file and convert the merged result back to the file's original EOL**, or abort with a clear message. Check exit `<0` as error and `>0` as conflict; do not rely on stdout only. Keep `-p --diff-algorithm=histogram` as planned (S5). Pass temp file paths without shell (see #11). | **MUST** (Pull/push step 4) |
| 5 | BOM | UTF-8 BOM is common from Windows editors (Notepad historically, VS). parse5 does not strip it, it counts as a char at offset 0 (S14). Chromium/HTML parse ignores it, so the editor DOM looks fine but any `startOffset` arithmetic on a "stripped" copy would shift by 1. | Preserve: detect BOM bytes `EF BB BF`, decode with `ignoreBOM:true` so U+FEFF stays in the string, and re-encode without adding or removing it. CSS and JS same. | **MUST** (test fixture) |
| 6 | Path separators | Windows APIs accept `/` and convert it (except in `\\?\` paths) but `path.join` yields `\`; chokidar regex `ignored` patterns are tested against forward-slash paths even on Windows (S2). File-id keys such as `"css/main.css"` compared to `path.join` output break. | One internal canonical form: project-relative POSIX paths (`path.posix`, `/`) for ids, URLs, `base.json`, `canvas.json`; convert at the fs boundary only (`path.join(root, ...rel.split('/'))`). Never persist absolute paths. Write chokidar `ignored` as functions or `/` regexes (S2). | **MUST** (data-model rule) |
| 7 | Case-insensitive paths | NTFS and default APFS are case-insensitive; Microsoft: "Do not assume case sensitivity" (S12). `Foo.html` vs `foo.html` can alias; git sets `core.ignorecase` on clone/init (S3 summary, general knowledge from page not read in full: treat as inference). | Compare/lookup file ids with a normalised key (`toLowerCase()` for lookup only; keep the stored spelling for writes). Reject on save/rename-collision rather than overwrite. Validate imported project paths for reserved names and characters (S12: `CON, PRN, AUX, NUL, COM1-9, LPT1-9`, `< > : " \| ? *`, trailing dot/space). | SHOULD (MUST if the editor creates or renames files) |
| 8 | Long paths (MAX_PATH 260) | Win32 default limit 260 chars; long-path behaviour needs both registry `LongPathsEnabled=1` and an app manifest `longPathAware`; the doc itself cites cloning a git repo into a deep folder as the trigger (S11). Git for Windows also errors on long paths unless `core.longpaths=true` (S13). Node ships long-path-aware (not verified here; inference). | Put `.editor/` and tmp files at short names (`.editor/tmp/<8 hex>`); default project root suggestion short (`%USERPROFILE%\design\<name>`); run `git -c core.longpaths=true ...` for every git call; on `ENAMETOOLONG`/`ENOENT` for long paths show an actionable error pointing at the registry setting (S11). | SHOULD |
| 9 | Atomic rename on Windows | POSIX `rename` replaces a file even with open handles; Windows `MoveFileEx` fails with Access denied/EPERM/EBUSY if another process (AV, indexer, preview, git) holds the target open without `FILE_SHARE_DELETE` (S16, S17 community reports; Raymond Chen explains FILE_SHARE_DELETE is the prerequisite for rename/delete, S16). `write-file-atomic` does tmp file in same dir, fsync, rename, unlink on failure, but **has no retry on rename and no Windows-specific handling** (S1 source). graceful-fs retries rename for ~1s on EACCES/EPERM on Windows (S15). | Wrap rename in our own bounded retry: on `EPERM`/`EACCES`/`EBUSY` retry with backoff (e.g. 10, 20, 40 ... up to ~2-3 s total, longer than graceful-fs's 1 s, which one report calls short for AV scans, S15), then surface "file locked by another program" and keep the pending edit in memory (do not drop). Use `write-file-atomic` for the tmp+fsync+rename+cleanup, retry around it; or `fs-no-eperm-anymore` style loop (S15). Tmp name in the **same directory** (S1) so the rename never crosses volumes (cross-device rename fails, S17). The Writer debounce must treat a rename failure as retryable state, not fatal. Do not hold the target open (read with `readFile`, not a long-lived handle). | **MUST** (Writer atomic-write spec; test with a second process holding the file) |
| 10 | Atomic write is not atomic vs watcher | tmp+rename creates `add`/`unlink` noise and (Windows) can fire several change events. chokidar `atomic` (default true on native backends) merges unlink+add within 100 ms into one `change` and ignores editor temp files (S2). | Keep `atomic` default, **and** self-write suppression by content hash (own write = hash matches what we just wrote), not by timing. Name our tmp files with a distinct prefix and add to `ignored`. | **MUST** (Watcher spec) |
| 11 | chokidar version / Node floor | chokidar v5 (ESM-only) needs Node >=20; **v6 needs Node >=22.22** and adds a native `fs.watch(recursive)` backend on macOS and Windows (S2). Plan says Node >=20. v4+ removed globs (S2). | Pin `chokidar@^5` (matches Node 20) or raise the floor to Node 22 LTS and take v6; decide in Stack table. Either way, no globs; use `ignored` functions. | **MUST** (Stack table: Node floor vs chokidar major) |
| 12 | chokidar / fs.watch on Windows | Folder renames of a watched dir fail with "folder in use" on Windows (issue #1281, chokidar 3.5.2); watcher can miss changes after a watched dir or its parent is deleted (issue #1278); EPERM from `fs.watch` on removed/recreated paths, chokidar has a Windows branch that open/closes the path before reporting EPERM (S18). `ignorePermissionErrors` default false so EPERM/EACCES are emitted (S2). Polling does not compare inodes on Windows (S2). `awaitWriteFinish` can hold events until size is stable (S2). | Watch the **project directory itself non-recursively + the few known file ids**, not `node_modules`/`.git`; attach `watcher.on('error')` and treat EPERM as "re-add watcher", not crash; on `unlinkDir` of the project root re-create the watcher. Use `awaitWriteFinish: {stabilityThreshold: 100-200}` only for external edits; fall back to `usePolling` via `CHOKIDAR_USEPOLLING` env for network/OneDrive folders (S2). Always `.close()` watcher before renaming/deleting the project folder (S18). Warn when the project lives in OneDrive/Dropbox/network drive (inference). | SHOULD |
| 13 | Lock file semantics and liveness | `open(..., 'wx')` is exclusive-create on all platforms (Node fs flag, general knowledge from fs docs; fetch returned a summary only, S4). `process.kill(pid, 0)` is documented as the platform-independent existence probe on Windows (S6). Windows: SIGTERM/SIGINT/SIGKILL via `kill` terminate unconditionally, and no graceful handler runs (S6), so a killed editor leaves a stale lock. PID reuse is not solved by signal 0 (inference). Deleting a lock held open by another process fails on Windows (EPERM/EBUSY, as #9). proper-lockfile uses mkdir plus mtime heartbeats and stale threshold (default 10 s, update stale/2), not PID checks (S19). | The plan's lease design (`expiresAt` + nonce + heartbeat) is the right one on Windows: **do not depend on PID liveness; use PID only as a hint**, combine with `startedAt`/hostname/nonce. Stale decision = `expiresAt` passed. Release = unlink with the same bounded retry as #9. Do not unlink a lock whose nonce is not ours. Never use `SIGTERM` as the graceful-shutdown path on Windows (S6): shut down via an HTTP `/shutdown` endpoint or stdin close; handle `SIGINT` and `SIGBREAK` (S6). | **MUST** (state in plan: lease, not PID) |
| 14 | `localhost` -> `::1` vs `127.0.0.1` | Since Node 17 DNS results are returned in resolver order, so `localhost` often yields `::1` first; a server on `127.0.0.1` then gives `ECONNREFUSED ::1:PORT` (S20, S21). Vite default `server.host` is `localhost` and the docs warn about this reordering (S22). A report shows Vite on Windows binding only `::1` and a client expecting `127.0.0.1` (S22). Plan's CSP lists both `localhost` and `127.0.0.1` for the project origin, good. | Bind **explicitly** to `127.0.0.1` for editor and project servers (and optionally also `::1` as a second listener); set Vite `server.host:'127.0.0.1'`, `strictPort:true` (S22). Server's own fetches use `127.0.0.1`. Call `dns.setDefaultResultOrder('ipv4first')` at startup (S20). Print the URL with `127.0.0.1`. Playwright `baseURL` use `127.0.0.1`. | **MUST** (Architecture bind rule) |
| 15 | `*.localhost` subdomains | Chromium resolves `localhost` and `*.localhost` to loopback itself, bypassing OS DNS, and treats them as secure contexts; the Blink intent was confirmed for all six Blink platforms including Windows (S7). Safari did not support it (plan already knows). Chromium proxy note: with a system proxy, `<-loopback>` bypass may be needed (S7 search result). Firefox historically differed (S7 search result). | Keep **second port on 127.0.0.1** as the default (zero dependency on name resolution, works in every browser, proxy-agnostic); offer `*.localhost` only as an opt-in. On Windows corporate proxies, document `NO_PROXY`/`<-loopback>`. Ensure cookies/storage separation is by origin (port differs) not name. | SHOULD (plan already prefers port; keep) |
| 16 | Firewall prompt on bind | Evidence is indirect: a report says binding to 127.0.0.1 rather than a wildcard avoids the prompt in most configs, another shows a prompt still appearing, and no Microsoft document confirms it for Node (S23). A wildcard bind (`0.0.0.0`/`::`) is what triggers the Defender prompt in general (inference; S23 consistent). | Never bind `0.0.0.0` or omit host (Node default listens on `::`/all). Always pass `'127.0.0.1'`. Add a test: start server on Windows runner, assert `server.address().address === '127.0.0.1'`. README: if a prompt appears choose Private networks only. | **MUST** (same rule as #14) |
| 17 | Git availability | Git for Windows is a separate install; `git.exe` may not be on PATH in a fresh shell. Git for Windows doc/FAQ page checked covers long paths (S13), not PATH. | Startup preflight: `git --version` via `execFile`; fail with install link (Git for Windows) and minimum version; resolve once and reuse the absolute path. Needed by editor (per-project repo) and skills. Ensure `merge-file --diff-algorithm` is supported (S5). Set `GIT_TERMINAL_PROMPT=0`. | **MUST** (preflight + docs) |
| 18 | Spawning processes, shell quoting | Node ignores PATHEXT, shebangs, and mishandles `.cmd` shims, spaces, quotes (S8). Since the April 2024 security releases `spawn` of `.bat`/`.cmd` without `shell` throws `EINVAL` (S9). `shell:true` on Windows uses `cmd.exe` and passing args with shell is deprecated (S10). | Use `execFile`/`spawn` with **no shell and an args array** for `git` (a real `.exe`), so no quoting is needed. For anything that resolves to `.cmd` (npx, npm, vite) use `cross-spawn` (S8) or `execa` (built on it). Never build command strings from file names. Set `windowsHide:true` (S10). Env var names are case-insensitive on Windows, do not pass both `PATH` and `Path` (S10). | **MUST** (rule + lint) |
| 19 | npm scripts portability | npm runs scripts with `cmd.exe` on Windows, `/bin/sh` on POSIX (S11b). POSIX `VAR=x cmd` and `&&`-chains with quotes/globs misbehave. `cross-env` fixes env vars but the repo is **archived (Nov 2025)** (S24). | Keep scripts to a single command each; move logic into Node scripts (`node scripts/dev.mjs`) using `cross-spawn`; avoid `rm -rf`, `cp`, `$VAR`, single quotes; use `rimraf`/`node:fs.rm` or Node scripts. For env, use `process.env` in Node scripts or `env-cmd` instead of the archived `cross-env` (S24). Optionally `.npmrc script-shell` not needed. | SHOULD |
| 20 | Skills (pull/push) on Windows | Claude Code skills are markdown instructions that run shell commands; bash-isms (`sed`, `$(...)`, `rm`) fail in PowerShell/cmd (inference; npm shell fact S11b). | Skills call only `node <path>/cli.mjs <verb>` (our own cross-platform CLI) and `git` with arg arrays; no inline shell logic. Quote paths with spaces; document that Git Bash is not assumed. | **MUST** (Pull/push design: skills = thin wrappers over a Node CLI) |
| 21 | Playwright on Windows | Playwright docs: Windows and macOS CI agents "no additional configuration is required" (S25). Browsers install to `%USERPROFILE%\AppData\Local\ms-playwright`; branded Chrome/Edge ignore `PLAYWRIGHT_BROWSERS_PATH`; Edge channel installs with `npx playwright install msedge` (S26). | CI: `npx playwright install --with-deps chromium` on both OSes (`--with-deps` is a Linux concern, harmless elsewhere, S25). Use Chromium project plus an optional `msedge` channel project on Windows (it is the default browser there). `webServer` command through a Node script (#19), `url: 'http://127.0.0.1:5300'`. Normalise path assertions. Cache `ms-playwright` per OS. | SHOULD |
| 22 | Vite dev on Windows | See #14: pin host and port; watch via chokidar inside Vite uses fs.watch with the same Windows caveats (#12). | `server.host:'127.0.0.1', strictPort:true`; `server.watch` ignore `.editor/` and project dir so editor writes don't trigger HMR reload loops. | SHOULD |
| 23 | CI matrix | `windows-latest` = Windows Server 2025 x64, `macos-latest` = macOS 26 arm64; `windows-2022`, `macos-15`, `macos-26-intel` exist (S27). The checkout action page does not document line endings (S28), but runners run git with whatever autocrlf is set, so tests that assume LF may fail unless `.gitattributes` pins it (S3, S29). | Matrix below. Pin `.gitattributes` in the editor repo (`* text=auto eol=lf`, plus `-text` on golden fixtures) so fixtures are byte-stable. Add a dedicated CRLF fixture folder committed as `-text`. Run `git config --global core.autocrlf true` in one Windows job to reproduce Git-for-Windows default users. | **MUST** (M1 exit: CI green on both) |
| 24 | Editor repo's own `.gitattributes` for golden fixtures | Same as #3 for fixtures: `text eol=lf` rewrites a CRLF golden file on commit even if previously CRLF (S3). | `fixtures/**` -text (never normalise), source `* text=auto eol=lf`. Add `.editorconfig` `end_of_line = lf` for source. | MUST (test integrity) |
| 25 | Antivirus / indexer touching tmp files | AV scans newly created files; this is the root of the rename EPERM retries (S15). | Keep tmp in same dir (S1) but short-lived; retry (#9); consider `fsync:false` only if latency matters (S1 says the option exists) - default keep fsync. | SHOULD |

## Proposed plan section ("Cross-platform")

> ### Cross-platform (macOS + Windows)
>
> Support matrix: macOS (arm64 and x64) and Windows 10/11, Node 22 LTS (or >=20 if chokidar stays on v5), Chromium-based browser. CI runs `windows-latest` and `macos-latest` on every PR.
>
> **Bytes.** The Writer reads and writes `Buffer`s. Text is decoded as UTF-8 with the BOM kept in the string, parsed by parse5 without any normalisation, and spliced at parse5 offsets (which index the raw string, CR and BOM included). Inserted text uses the file's dominant line ending (detected once per file; `\n` if none). Nothing ever calls `.trim()`, `replace(/\r\n/g, ...)` or `normalize()` on file content. Fixtures cover LF, CRLF, mixed, BOM, no trailing newline.
>
> **Git.** Each project repo is created by the editor with local config `core.autocrlf=false`, `core.longpaths=true`, and a committed `.gitattributes` of `*.html -text`, `*.css -text`, `*.js -text`, `*.json -text` (git never rewrites project bytes). Pull/push compares the dominant line ending of base/ours/theirs; if they differ, the merge runs on LF-normalised copies and the result is converted back, or the push aborts with an explanation. `git` is preflight-checked at startup. All git calls use `execFile` with argument arrays and no shell.
>
> **Paths.** Ids, URLs, `base.json` and `canvas.json` use project-relative `/` paths. Conversion to native paths happens only at the fs layer. Lookups are case-insensitive (stored spelling preserved); names that are reserved on Windows are rejected. Tmp files live in the target's directory with short names.
>
> **Atomic writes.** tmp + fsync + rename via `write-file-atomic`, wrapped in a bounded retry (EPERM, EACCES, EBUSY; backoff to about 3 s). A failed write stays pending and visible ("file locked by another program"); edits are never dropped. The own-write filter is by content hash.
>
> **Watcher.** chokidar (version pinned to the Node floor), no globs, `ignored` as functions, `error` handler that re-adds the watcher on EPERM, `usePolling` fallback through `CHOKIDAR_USEPOLLING`; the watcher is closed before the project folder is moved or deleted.
>
> **Lock files.** Leases, not PIDs: `{nonce, pid, startedAt, expiresAt}` created with exclusive-create; stale only when `expiresAt` has passed; the holder heartbeats; release and delete use the retry wrapper; never delete a lock whose nonce is not ours. Shutdown is via an HTTP endpoint or stdin close, since `SIGTERM` does not run handlers on Windows.
>
> **Network.** Both servers bind `127.0.0.1` explicitly (never a wildcard), avoiding the Windows firewall prompt and the `::1` mismatch; `dns.setDefaultResultOrder('ipv4first')`; Vite `host:'127.0.0.1'`, `strictPort:true`. The project origin is a second port by default; `*.localhost` is opt-in.
>
> **Processes and scripts.** No shell strings. `git` through `execFile`; `.cmd` tools through `cross-spawn`. npm scripts are single commands calling Node scripts; no `cross-env` (archived). Pull/push skills only invoke `node cli.mjs <verb>` and `git`.
>
> **CI.** Matrix `os: [windows-latest, macos-latest]`, `fail-fast: false`; jobs: lint, unit (Writer/RuleLocator byte tests), a Windows-only "locked file" rename test, a CRLF job with `core.autocrlf=true`, and Playwright Chromium (plus `msedge` on Windows).

### Example workflow

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest]
        autocrlf: [false, true]   # reproduce Git for Windows default
    runs-on: ${{ matrix.os }}
    steps:
      - run: git config --global core.autocrlf ${{ matrix.autocrlf }}
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
```

Notes: set autocrlf before checkout so the checkout itself is converted; the repo's `.gitattributes` must make golden fixtures `-text` so both values pass. Matrix labels from S27; Playwright Windows/macOS note S25.

## Windows-only tests to add (acceptance)

1. Untouched session on CRLF, LF, mixed, BOM fixtures: zero-byte diff (also with `autocrlf=true`).
2. Edit then `git diff` shows only the intended lines, EOL preserved.
3. Hold the target open from a child process (no share-delete) while saving: save retries then succeeds or reports locked; the pending edit survives.
4. Lock lease: kill -9 the holder, new holder takes over after `expiresAt`, not before.
5. `server.address()` is `127.0.0.1` for both servers; client reached via `localhost` (::1 first) still works because the client uses `127.0.0.1`.
6. Project path with spaces and non-ASCII; path >260 chars with `core.longpaths`.
7. `git merge-file` clean and conflict cases with matching and mismatching EOL.

## Open items I could not source

- Exact Git for Windows installer default for `core.autocrlf`: the GitHub guide tells Windows users to set `true` (S9) but I did not fetch the installer doc. Treat "many Windows users have autocrlf=true" as the safe assumption.
- `git merge-file` EOL behaviour is undocumented in the man page (S5); the mismatch-conflict claim is inference and needs a test.
- Node `fs.watch` Caveats section was not retrievable (fetch summaries truncated); Windows watcher behaviour above comes from chokidar docs and issues.
- Firewall-prompt avoidance by loopback bind is supported only by community reports (S23).
- parse5 offset behaviour was read from the preprocessor source summary (S14); confirm with a test against the pinned version.

## Sources

Fetched with WebFetch:

- S1 write-file-atomic README: https://github.com/npm/write-file-atomic ; source: https://raw.githubusercontent.com/npm/write-file-atomic/main/lib/index.js
- S2 chokidar README: https://github.com/paulmillr/chokidar
- S3 gitattributes: https://git-scm.com/docs/gitattributes
- S4 Node fs docs (summaries only): https://nodejs.org/api/fs.html
- S5 git merge-file: https://git-scm.com/docs/git-merge-file
- S6 Node process docs (signal 0, Windows signals): https://nodejs.org/api/process.html
- S8 cross-spawn: https://github.com/moxystudio/node-cross-spawn
- S9 Node April 2024 security release (CVE-2024-27980, EINVAL): https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2
- S10 Node child_process docs (Windows notes): https://nodejs.org/api/child_process.html
- S11 Microsoft, Maximum Path Length Limitation: https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation
- S11b npm config script-shell: https://docs.npmjs.com/cli/v10/using-npm/config
- S12 Microsoft, Naming Files, Paths, and Namespaces: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
- S13 Git for Windows FAQ (long paths): https://gitforwindows.org/faq.html
- S14 parse5 preprocessor source: https://raw.githubusercontent.com/inikulin/parse5/master/packages/parse5/lib/tokenizer/preprocessor.ts
- S10b GitHub Docs, line endings (autocrlf true, `.gitattributes`, renormalize): https://docs.github.com/en/get-started/git-basics/configuring-git-to-handle-line-endings (cited above as S9/S10 for autocrlf and renormalize in the table; in the table "S9" for autocrlf and "S10" for renormalize both refer to this page)
- S7 Chromium blink-dev intent (localhost resolves to loopback, all six platforms): https://groups.google.com/a/chromium.org/g/blink-dev/c/RC9dSw-O3fE
- S21 Node issue 40537 (localhost ::1): https://github.com/nodejs/node/issues/40537
- S24 cross-env (archived Nov 2025): https://github.com/kentcdodds/cross-env
- S25 Playwright CI: https://playwright.dev/docs/ci
- S26 Playwright browsers: https://playwright.dev/docs/browsers
- S27 actions/runner-images labels: https://github.com/actions/runner-images
- S28 actions/checkout: https://github.com/actions/checkout

Returned by WebSearch (result pages, not individually fetched; claims limited to what the result text stated):

- S15 graceful-fs rename retry and AV: https://github.com/isaacs/node-graceful-fs and https://www.github.com/isaacs/node-graceful-fs/issues/247 ; fs-no-eperm-anymore: https://npmjs.com/package/fs-no-eperm-anymore
- S16/S17 rename vs open handles, FILE_SHARE_DELETE: https://devblogs.microsoft.com/oldnewthing/20211022-00/?p=105822 ; https://forum.rclone.org/t/windows-vfscache-failed-cache-rename-over-an-open-handle-returns-errc-0-success-silently-losing-atomic-temp-rename-saves/54004 ; https://github.com/anthropics/claude-code/issues/25476
- S18 chokidar Windows issues: https://redirect.github.com/paulmillr/chokidar/issues/1281 ; https://redirect.github.com/paulmillr/chokidar/issues/1278 ; nodefs handler https://chromium.googlesource.com/devtools/devtools-frontend/+/HEAD/node_modules/chokidar/lib/nodefs-handler.js
- S19 proper-lockfile: https://github.com/alessioalex/node-proper-lockfile ; https://unpkg.com/proper-lockfile@4.1.2/README.md
- S20 Node dns docs (setDefaultResultOrder): https://nodejs.org/api/dns.md
- S22 Vite server options and Windows `::1` report: https://vite.dev/config/server-options ; https://github.com/vitejs/vite/issues/16350 ; https://github.com/7shep/universal/pull/100/files
- S23 firewall prompt reports: https://learn.microsoft.com/en-us/answers/a/7961055 ; https://community.intel.com/t5/Intel-MPI-Library/Intel-oneAPI-2022-3-MPI-triggers-Windows-Firewall/m-p/1436897
- S29 line endings and `.gitattributes` in CI: https://docs.github.com/dealing-with-lineendings ; https://lore.kernel.org/all/543904d5608af500617eb4094a8b40cce29f55b8.1493728172.git.johannes.schindelin@gmx.de/
- Chromium `*.localhost` additional context: https://bugs.webkit.org/show_bug.cgi?id=160504 ; https://bugzilla.mozilla.org/show_bug.cgi?id=1433933
