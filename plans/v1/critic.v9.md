# Critic v9 — Design Editor — v1 plan

**Plan reviewed:** plans/v1/plan.md
**Date:** 2026-11-23
**Score:** 7/10 — the editor core, sandbox and merge model are sound and checked against the real Design type docs, but the Claude-Code-to-`edsync` hand-off and the throwaway-copy recipe that M0 and M6 depend on are not specified.

---

## TL;DR for Ron

This is a strong, careful plan. Its claims about the Design canvas format match the type's own docs (I read `SKILL.md`, `format.md` and `view-state.md` from the Design type, release 1795227355-bde3): inline `style` is what the properties panel edits, `<helmet><style>` is secondary, `canvas.json` has the `boards`/`order` shape the plan assumes, and `view-state.md` defines the tid/path addressing that the id fallback borrows. The biggest strength is the editor core: byte-exact splices, snapshot undo, and "preview = disk" with a reload after every structural op. The biggest risk is the seam between Claude Code and the `edsync` CLI. The plan never says how remote files get from the Artifact tool into `edsync`, how pull's steps map to CLI verbs, or whether push publishes in one call or several. It also never says how to make the throwaway copy of Test Site, and asset URLs are stored per artifact, so a naive copy points at the original's `/_blob` ids. Both gaps sit on the M0 gate and the M6 exit, so close them before M0. Then ship.

---

## Strengths

- **Grounded in the real format.** §Architecture "Write target (canvas)" and the M0 Design-canvas branch match the Design type's `SKILL.md`, which says inline `style="…"` "is what the properties panel edits" and that `<helmet><style>` is for page basics. The id fallback in M0 reuses `view-state.md`'s depth-first `tid` plus child-index `path` addressing. That addressing does exist and counts `<helmet>`, `<sc-for>` and `<dc-import>` as the plan expects.
- **"Preview = disk" by construction.** On a canvas only `setDecl`/`removeDecl` are previewed live. Every other op writes the file and reloads (§Scripts and trust, §Edit op). That avoids fighting the runtime's re-render, which matters because `format.md` shows the runtime is React-based (`DCLogic` with `setState` and React lifecycle).
- **Snapshot undo with stored id maps** (§Undo). Byte-identical undo holds by construction, and no op needs its own inverse. Ids are never re-derived from position.
- **The merge model is right-sized** (§Pull/push step 3-4). It is a two-replica model: one-sided changes move across, a change on both sides runs `git merge-file`, and any conflict stops the push with nothing sent. A parse5 shape check runs after a clean merge, and `canvas.json` is never written. Local artboard add/remove stops the push, which matches the type's own rule ("Removing an artboard: ask the user to delete it in the page").
- **The sandbox design is careful.** The frame is opaque-origin with `allow-scripts` only and served from a second port. It has `frame-ancestors`, an exact Host check, a per-response probe nonce, `e.source` + `e.origin === 'null'` checks on postMessage, and no token in `/project/*`. This matches `format.md`'s rule that design content is untrusted and "runs ONLY inside the editor's sandboxed preview iframe".
- **Cross-platform detail is concrete** (§Cross-platform): `* -text` in `.git/info/attributes`, the rename retry on `EPERM`/`EBUSY`, leases instead of PIDs, `SIGBREAK`, `cross-spawn` for `.cmd`, and an `autocrlf` CI matrix.
- **The M0 gate has fallbacks fixed in advance** (§M0 Gate, Fallbacks), so M1 never starts on a guess. "Runtime won't run, so stop" is the honest call, not a static-preview trap.

## Concerns

### [major] The Claude Code ↔ `edsync` data contract is undefined — §Pull / push
**In plain words:** Pull and push are split between Claude, which can talk to Claude Design, and a small program, which does the careful file logic. The plan never says how files pass between the two. Where do the downloaded remote files land? Which command turns a fresh download into a project? Does Claude publish everything in one go or file by file? Each of those choices changes whether push is safe.
**What:**
- **Where remote bytes land.** The Artifact tool's `read` with `path`/`paths` saves files into the artifact's folder in Claude's scratchpad by default. Saving anywhere else "asks the person first", and the Design `SKILL.md` says "No `out_dir` on `read`". So remote bytes land outside `projects/<slug>/`, and `edsync` must be told where they are. No verb takes that input.
- **Pull has no verb.** The verbs are `lock`, `classify`, `merge`, `check`, `commit`, `unlock` and `shots`. Pull steps 1-4 (place the files, `git init` plus config plus attributes/exclude, the blob cache, `base.json`) belong to no verb. So that logic lands in skill prose, which contradicts "the skills hold no logic".
- **"Remote version" has no source.** `base.json` stores a "remote version", but nothing in the Artifact tool's read result is named as that version. The per-file hashes are the real guard, so the field is either undefined or redundant.
- **The publish shape is open.** The M0 canvas branch says "push publishes `root` + `files` per artboard", but step 4 implies one send. With several calls, a refusal on call 2 leaves call 1 published. The recovery ("identical bytes classify as unchanged") does cover this, but only if it is designed for. It is also unknown whether a multi-file publish that one file refuses is refused as a whole. The type docs say a refused publish "names the file to re-read".

**Why it matters:** M6 is budgeted at about 1 day for the CLI. Without a contract, the skill authors will invent one, and the "unit-tested deterministic core" claim then no longer covers the parts that move bytes. A partial publish without a planned recovery is exactly the "silently overwrite" Goal 3 forbids.
**Best-practice options:** (This is local to this toolchain; no external pattern was relevant beyond the general "functional core, imperative shell" split the plan already follows.)
- **Option 1 — snapshot-directory contract (pick this).** *Plain words: Claude always downloads to a folder, and the program reads that folder.* The skill reads every `project/*` file plus `canvas.json` in one `read` with `paths` into the default scratchpad folder. It then calls `edsync ingest --remote-dir <dir>` for pull and `edsync classify --remote-dir <dir> --nonce <n>` for push. `classify` prints the exact Artifact `files` map to publish (keys `project/<path>`, `root` = `projects/<slug>`). Drop "remote version" from `base.json`, or define it as the sha256 of the sorted per-file hash list. Add `ingest` (pull steps 1-4) to the verb list and the CLI test list. Cost: about ½ day added to M6. It keeps every byte decision in tested code.
- **Option 2 — one publish call per push, always.** *Plain words: send all changed files at once, so it either all lands or none of it does.* Publish all changed artboards in a single call. The plan's 255-files-per-call ceiling is far above a canvas's size. Add an M0 check: "does a refusal on one file reject the whole call?" If it does not, keep the existing "re-run and identical bytes classify as unchanged" recovery and add a CLI test for a partial publish. Cheap; do it together with Option 1.

### [major] The throwaway copy of Test Site has no recipe, and asset URLs are per artifact — §Testing safety rule, §M0, §M6
**In plain words:** Every test that publishes runs on a copy of Test Site. The plan only says the copy is "published from pulled files". Pictures and fonts in Claude Design live in each artifact's own storage. A copy made by re-sending the files will still point at the original's pictures, and may show them broken. So the tests may not look like the real thing, and the M0 go/no-go checks run on that copy.
**What:** The Design type instructs that every asset file is uploaded and its `/_blob/<id>` URL goes into the HTML verbatim. The Artifact tool's asset reuse (`from_url` + `asset_ids`) copies assets server-side and "the result gives each copy's new url in this artifact, to reference exactly as given". In other words, asset URLs belong to one artifact. A copy also needs a new canvas created from the Design `type_url`, a `canvas.json` with `createdOnFiles`, and the `project/ds/<folder>/tokens.json` design-system install if Test Site has one. The M0 gate ("publish → read round-trip is byte-exact"), the Save-footprint check and the Theme-menu check all run on this copy.
**Why it matters:** If `/_blob` ids do not resolve across artifacts, the copy renders without images and fonts. The M0 checks then measure a different page than Ron's, and the M6 "remote artboard add → blob fetch" path is never exercised for real. If the ids are rewritten, the copy's bytes differ from Test Site's. That is fine, but only if it is known and recorded.
**Best-practice options:** (local to the Artifact platform; the source is the Artifact tool's asset-reuse documentation, which has no public URL)
- **Option 1 — server-side asset copy plus id rewrite (pick this).** *Plain words: copy the pictures into the new artifact properly and point the files at the copies.* Create the copy from the Design `type_url`. Copy every referenced asset with `from_url` = Test Site and `asset_ids`. Rewrite each `/_blob/<old>` to the returned URL in the copy's files. Copy `project/ds/*` the way the type's install step says. Record the id map in `research/06-project-format.md`. Write this as an `edsync`-assisted recipe (`edsync rewrite-blobs --map map.json`) so M6 tests can create fresh copies. About ½ day in M0.
- **Option 2 — first test whether ids resolve across artifacts.** *Plain words: check first whether the original's pictures already show in a copy.* Make the copy with the original ids and look at whether the assets render. If they do, skip the rewrite. This adds a check to M0's list and needs a fallback (Option 1) anyway.

### [minor] The kill bar and re-scope need Ron, but there is no default while he is away — §Goals (kill bar)
**In plain words:** Before building, the plan checks whether this editor is still worth making, but two of its conditions ask Ron's opinion ("matters to Ron", "re-scope with Ron"). Ron is away, so the build would stall at M0's exit.
**What:** "go ahead only if … git line diffs and offline editing matter to Ron" and "re-scope with Ron before M1" have no rule for when Ron cannot be reached.
**Why it matters:** An agent-driven M0 either blocks indefinitely or improvises the scope.
**Best-practice options:** (local decision rule; no external pattern)
- **Treat Ron's commissioning of the project as "git diffs and offline matter: yes" (pick this).** If M0 finds snapping or measure already built in, apply the already-written shrink automatically: v1 becomes M1-M3 plus the remaining precision tools, and M4 and M5 move to Next. Record this in `06` and continue. Stop only when nothing on the list survives. This is the most conservative choice that keeps v1 shippable.
- Pause at M0's exit until Ron answers. This is safer for scope but blocks all progress.

### [minor] `git merge-file --diff-algorithm` needs Git ≥ 2.44, and the startup check sets no minimum — §Cross-platform (Git), §Pull/push step 4
**In plain words:** Push's merge uses an option that only exists in Git 2.44 (2024) and newer. Older Git, such as the one that came with older Xcode command-line tools, will reject it, so every merge would error out.
**What:** Startup only runs `git --version` "with an install hint". Push step 4 treats a negative exit as an error, so on an old Git every both-sided change becomes an error rather than a merge. (This Mac has 2.54.0, so it works here. The requirement is cross-platform and must hold on any machine.)
**Why it matters:** The failure is invisible in CI, where runners have current Git, and in any other place where testing uses a current Git.
**Best-practice options:**
- **Enforce Git ≥ 2.44 at editor startup and in every `edsync` verb, with a clear upgrade message (pick this).** *Plain words: refuse to start with an old Git and say why.* It is one comparison. The option is documented from 2.44 ([git-merge-file 2.44.0 docs](https://git-scm.com/docs/git-merge-file/2.44.0); origin [git/git PR #1606](https://github.com/git/git/pull/1606)).
- Detect the version and drop `--diff-algorithm=histogram` (fall back to Myers) on older Git. This keeps working but produces worse merges on brace-heavy markup, and adds a code path to test.

### [minor] `Origin: null` plus `Access-Control-Allow-Origin: *` lets any web page read the project origin — §Scripts and trust
**In plain words:** The project server lets requests through when they say their origin is "null", because the editor's sandboxed frame says exactly that. But any website can make a sandboxed frame that says "null" too. So, apart from a browser permission prompt, a site Ron visits could read his canvas files from his own machine while the editor runs.
**What:** The 5301 listener allows GET/HEAD of static files with `Origin` absent or `null` and answers with ACAO `*`. A sandboxed iframe on any site gets the null origin ([PortSwigger, CORS](https://portswigger.net/web-security/cors); [PortSwigger research: "any website can easily obtain the null origin"](https://portswigger.net/research/exploiting-cors-misconfigurations-for-bitcoins-and-bounties)). The Host check does not stop this, because the request's Host really is `127.0.0.1:5301`. The plan's justification, "adds no write or API surface", is true but ignores the read side. Chrome 142+ Local Network Access does prompt before a public site can reach loopback ([Chrome LNA blog](https://developer.chrome.com/blog/local-network-access)). So the risk is real but gated behind a prompt, on Ron's own canvases only.
**Why it matters:** The cost is low (Ron's own designs), but the plan presents the second-origin design as the security boundary, and it is weaker than stated.
**Best-practice options:**
- **Per-launch secret path prefix for project documents (pick this).** *Plain words: put a random code in the project URLs, so only the editor knows where the files are.* Serve the `.dc.html` files and `canvas.json` under `/p/<random-per-launch>/project/…` and give the iframe that URL. Relative URLs (`./support.js`, `<dc-import>` siblings) keep resolving. `/_blob/<id>` stays at the root, since its ids are already unguessable 32-hex values. Treat `Origin: null` as "no authority", never as an allow. Keep Chrome LNA as defence in depth. This needs an M0 check that the runtime does not hard-code root-relative paths to artboards.
- Rely on LNA alone and document it. This costs nothing but depends on Ron never clicking "allow" for a site that asks.

### [minor] Inline text editing uses `contenteditable` on React-owned runtime DOM — §M2 (double-click text editing)
**In plain words:** The canvas runtime is built on React. React expects to own the text on the page, so letting the user type directly into that text can confuse it, and a re-render while typing can lose or garble the edit.
**What:** `format.md` describes `DCLogic` with `state`/`setState` and React class lifecycle, so the runtime reconciles the DOM. React's docs warn that React cannot keep updating an element's content once the user has edited it ([react.dev, common components: suppressContentEditableWarning](https://react.dev/reference/react-dom/components/common); [facebook/react#5837](https://github.com/facebook/react/issues/5837)). The commit path (write file, reload) is safe. The risk is a re-render *during* editing, for example from a timer, `state` or a hover handler.
**Why it matters:** Typed text can be lost or doubled before commit on interactive artboards, which is hard to debug.
**Best-practice options:**
- **Keep `contenteditable="plaintext-only"`, add an M0/M2 check on an interactive artboard, and freeze edits on re-render (pick this).** *Plain words: test it on a live artboard, and if the page redraws while typing, cancel the edit safely.* The probe watches the edited node with a `MutationObserver`. A mutation it did not cause commits or cancels the edit, and never merges. This is cheap and already fits the reload model.
- An overlay `<textarea>` in the editor layer, positioned over the element's rect with copied computed font metrics. This fully avoids the runtime but costs about a day and gives imperfect visual fidelity.

### [minor] Fixed ports and one editor per project are an unstated decision — §Stack, §Scripts and trust
**In plain words:** The editor always uses ports 5300 and 5301. Opening a second project, or having another program on those ports, will fail, and the plan does not say what happens then.
**What:** `.editor/server.json` is per project, which implies one server per project. The CSP `connect-src` and `frame-ancestors` and the Host allowlist all name 5300/5301 explicitly ("at whatever port is configured").
**Why it matters:** A confusing failure on the first day of use, or a server that silently uses a different port while the CSP still names the defaults.
**Best-practice options:** (local; no external pattern)
- **One editor at a time in v1 (pick this).** On `EADDRINUSE`, exit with "another editor (or program) is using port 5300; close it or pass `--port`". Build every CSP and allowlist host from the actually bound ports, and write them to `server.json`.
- Auto-pick the next free pair. This is friendlier, but stale `server.json` files and CLI discovery get harder.

### [nit] Version-history statements contradict each other — §Goals
"Claude Design's own Artifact version history covers whole-page rollback" (lines 32-35) sits beside "the built-in editor is documented to have … no version history" (line 47). Keep one statement, and let M0's record of what version history offers settle it.

### [nit] The watcher's ignore list is not stated — §Cross-platform (Writes and watcher)
Vite's `server.watch` ignores are listed, but chokidar's are not. Name `.git/` and `.editor/` explicitly. Otherwise `edsync commit` (writes under `.git/`) and `state.json` saves produce outside-edit events that the hash filter then has to reject.

---

## Decisions Ron needs to make

1. **Kill-bar default while Ron is away** — Options: (a) treat "git diffs and offline matter" as yes, auto-apply the written shrink if M0 finds snapping or measure built in, and stop only if nothing survives; (b) pause at M0's exit until Ron answers. Recommendation: (a), the most conservative choice that keeps v1 moving.
2. **How remote bytes reach `edsync`** — Options: (a) the default scratchpad read folder passed as `--remote-dir`, plus a new `ingest` verb for pull; (b) `out_dir` into `projects/<slug>/.editor/remote/`, which prompts Ron on every save outside the default. Recommendation: (a).
3. **Publish shape** — Options: (a) one publish call carrying every changed artboard; (b) one call per artboard. Recommendation: (a), plus an M0 check of whether a one-file refusal rejects the whole call.
4. **The throwaway copy's assets** — Options: (a) a server-side asset copy (`from_url` + `asset_ids`) plus a `/_blob` id rewrite, recorded in `06`; (b) keep the original ids if M0 shows they resolve across artifacts. Recommendation: (a) as the default, with (b) only as an observed shortcut.
5. **Minimum Git version** — Options: (a) require ≥ 2.44; (b) fall back to Myers on older Git. Recommendation: (a).
6. **Project-origin read exposure** — Options: (a) a per-launch secret path prefix for documents, with `Origin: null` never treated as an allow; (b) rely on Chrome Local Network Access. Recommendation: (a).
7. **Text-editing surface** — Options: (a) keep `contenteditable` plus a `MutationObserver` cancel-on-re-render, checked on an interactive artboard; (b) an overlay textarea in the editor layer. Recommendation: (a).
8. **Port policy** — Options: (a) one editor at a time, a clear error on `EADDRINUSE`, all hosts derived from the bound ports; (b) auto-pick the next free pair. Recommendation: (a).

---

## Verdict

**Ship after addressing blockers** — there are no blockers, but the two majors (the `edsync` data contract and the throwaway-copy recipe) sit on the M0 gate and the M6 exit and should be written into the plan before M0 starts; the minors can be folded in as they come up.
