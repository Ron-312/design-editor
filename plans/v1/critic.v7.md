# Critic v7 — Design Editor — v1 plan

**Plan reviewed:** plan.md
**Date:** 2026-11-23
**Score:** 7/10 — the approach is right and checks out against the Design type's own docs, but the push lock, editing text that contains a `{{hole}}`, the CSP, and re-pull each have a concrete hole that would corrupt a file, break a canvas, or lose edits.

---

## TL;DR for Ron

This is a careful plan. Its canvas assumptions match what the Design type actually documents (I read its SKILL.md, `format.md` and `view-state.md`): `project/canvas.json` with `boards` and `order`, `.dc.html` artboards with an `<x-dc>` root, `{{hole}}` lookups, `<sc-for>`, `<dc-import>`, and inline `style` as what the properties panel edits. The biggest strength is the order of work. M0 is a go/no-go spike with fallbacks fixed in advance, and M2 (write-back) is built before any fancy UI. The biggest risk is the push lock. It treats the lock as stale when the recorded PID is dead, but a Claude Code skill runs each step as a short-lived shell command, so that PID dies almost at once. The editor would then unlock in the middle of a push. Three smaller gaps also need fixing:

- Editing text like `Hello {{name}}` would splice the edit into the wrong place in the file.
- `connect-src 'none'` breaks canvases that `fetch()` their uploaded data, which the Design type allows.
- Running `/design-pull` again on an existing project is not defined.

Fix those four in the plan (each is a paragraph), then build. No rethink is needed.

---

## Strengths

- **Built on the real format.** The Design canvas branch (§M0 Exit, "Design canvas") matches the type's documented shapes: `canvas.json` `boards` keyed by path, `$preview` in `data-props`, `<helmet><style>`, `/_blob/<id>` uploads, and "a changed file is a new upload". So the decision to treat `/_blob` CSS as read-only (§M2) is right.
- **The sandbox model matches the type's own rule.** `format.md` calls canvas content "untrusted cross-user input" that runs only in a sandboxed preview frame. The plan's opaque-origin iframe on a second port (§Scripts and trust) applies exactly that rule. It also avoids the `127.0.0.2` and `*.localhost` traps on macOS and Safari.
- **Snapshot undo instead of inverse ops** (§Undo) makes byte-identical undo hold by construction, and storing an id map with each snapshot avoids re-deriving ids.
- **Two-replica push classification** (§/design-push step 3): a one-sided change moves across and only a change on both sides is a conflict. The synced commit advances only in step 5, so a refused publish is safe to re-run. `git merge-file --diff-algorithm` exists in the local git (2.54.0).
- **The kill bar comes before M0** (§Goals): if the built-in editor already does snapping and measure, the scope shrinks before any code is written.
- **The Writer runs a shape check after the splice** (§Writer). It catches parser fix-ups such as `p` auto-close and table foster-parenting that a text splice cannot see.

## Concerns

### [major] The push lock's stale check uses a PID that a skill does not have  — §Pull / push, `/design-push` step 1
**In plain words:** Push puts up a "do not edit" sign and writes its process number on it, so the editor can take the sign down if push crashes. But a Claude Code skill is not one long-running program. Each step is a separate short command that ends right away, so the number on the sign belongs to a process that is already gone. The editor would see a "dead" owner and unlock while push is still working.
**What:** Step 1 writes "the push's PID" into `.editor/push.lock`, and the editor "unlocks when the lock file is gone (or its PID is dead)". Each Bash tool call in a skill is a fresh process that exits when the command returns, so whatever PID the lock-creating command records is dead within milliseconds. The PID of the Claude Code parent is not specified and is not stable across sessions either. The plan also says "The lock lasts seconds". In practice the lock covers remote reads, `git merge-file`, Artifact publish calls that may wait on approval prompts, and the final commit. That is tens of seconds to minutes, and Esc or Ctrl-C can kill the session part-way through.
**Why it matters:** The editor resumes writing while push is between "read files" and "commit synced state". Push then commits and records bytes that no longer match the working tree, or it publishes bytes the editor has since changed. That is exactly the "written under push's feet" case the handshake exists to prevent. The opposite mistake (never treating the lock as stale) leaves the canvas read-only for good after an interrupted push.
**Best-practice options:**
1. **A lease with an expiry plus a fencing nonce.** *Plain words: the sign carries a "valid until" time and a random ticket number. Push renews the time at each step and checks the ticket is still its own before it does anything that counts.* The lock file holds `{nonce, expiresAt}` (for example 120 s). Each skill step rewrites `expiresAt`. The editor treats the lock as stale only after `expiresAt`. Before publish and before the step-5 commit, push re-reads the lock and aborts if the nonce is not its own. This is the lease-plus-fencing-token pattern: leases stop a crashed holder from blocking forever, and the token stops a paused holder from acting after its lease is gone. (Kleppmann, "How to do distributed locking", https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html; tox-dev filelock docs on leases and fencing, https://docsearch.algolia.com/mcp/docs/repo/tox-dev/filelock). Cost: a few lines per skill step.
2. **A kernel `flock` held by one long-lived helper.** *Plain words: one background program holds the lock for the whole push, and the OS releases it automatically when that program dies.* A `design-push-lock` Node helper holds an `flock` (released on fd close) and the skill steps talk to it. This is reliable on one host, but it adds a process to manage from inside a skill. (Lock patterns noted in agent-file-tools `fs_lock.rs`, https://docs.rs/agent-file-tools/0.37.1/src/aft/fs_lock.rs.html.)
3. **Record Claude Code's own PID plus its start time.** This is cheap, but it ties the lock to one session and needs a PID-reuse check.
I'd pick **option 1**: it fits a skill made of discrete steps, it needs no helper process, and the nonce check also covers the "editor resumed early" race. Also replace "lasts seconds" with "lasts up to a few minutes" in the banner rationale.

### [major] Editing text that contains a `{{hole}}` splices the edit at the wrong offset  — §M2, double-click text editing
**In plain words:** On a canvas, the file can say `Hello {{name}}` while the screen shows `Hello Ron`. If you edit the on-screen text and the editor compares old and new screen text to find what changed, the position it finds is a position in the rendered text, not in the file. Past the hole, the two no longer line up, so the edit lands in the wrong place and breaks the hole.
**What:** M2 allows text editing "only on elements whose children are a single text node". In the source, `Hello {{name}}` is a single text node, so it qualifies. `setText` "diffs old against new text and splices only the changed span". If it diffs the live (expanded) text, "Hello Ron" → "Hello Bob" gives span 6–9, and spliced into the source that turns `{{name}}` into `Bobme}}`. `format.md` confirms that holes interpolate inside text and attributes (`x="a {{p}} b"`). The general rule "`{{hole}}` values are read-only" (§M0 Design canvas) gives no mechanism for this mixed case. The Canvas fixtures test a hole inside an inline `style` value, but not inside text or a plain attribute.
**Why it matters:** The file is corrupted silently. The re-parse shape check passes, because the HTML is still well formed. The ack-vs-live check may also pass, because the runtime renders whatever the broken hole resolves to.
**Best-practice options:** This is local to the `.dc.html` format, so no external pattern applies.
1. **Read-only whenever the source text node or attribute contains `{{`.** *Plain words: if the file has a placeholder in that text, don't let it be typed over on the canvas.* Show "contains a live value; edit in source or Tweaks". Add golden fixtures: text with a hole refuses `setText`, and an interpolated attribute refuses `setAttr`. Cost: about an hour.
2. **Segment-aware editing.** Split the source text into literal and hole segments, make only the literal spans editable, and map each edit back through the segment table. This is nicer to use, but it is about a day of work and has caret edge cases.
I'd pick **option 1** for v1. The Design type says copy should be literal markup and holes are levers, so mixed text is rare. Also state that `setText` always diffs against the **source** text node, never the live text.

### [major] `connect-src 'none'` breaks canvases that fetch their own uploaded data  — §Scripts and trust
**In plain words:** The plan blocks every network call from the canvas, including calls back to the editor's own local server. But the Design type explicitly lets a canvas load its uploaded data files (JSON and the like) with `fetch`. Those canvases would render empty or throw errors in the editor while working fine in Claude Design.
**What:** The Design SKILL.md step 3 lists `fetch(…)` as a place a `/_blob/<id>` url goes, alongside `<img src>`, `url()`, `<link>` and `<script src>`. `connect-src 'none'` blocks every `fetch` and XHR, same-origin included (MDN: "No resources of this type may be loaded"). The plan's own design also caches `/_blob/*` on the 5301 origin and lets GET with `Origin: null` through, so these requests would be safe to allow.
**Why it matters:** "Preview = disk" fails for any data-driven artboard. The failure looks like a broken canvas, not a policy block, so it will cost debugging time. M0 does not check for it.
**Best-practice options:**
1. **`connect-src http://127.0.0.1:5301 http://localhost:5301` as explicit host-sources.** *Plain words: allow calls back to the local project server only, and nothing else.* Use host-sources rather than `'self'`, because how `'self'` resolves for an opaque-origin sandboxed document is defined through the policy's self-origin and is easy to get wrong. (MDN connect-src, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src; CSP Level 3 on self-origin, https://www.w3.org/TR/CSP/). The 5301 listener already serves only cached, read-only files, so the attack surface does not grow.
2. Keep `'none'` and add an M0 check ("does any artboard `fetch`?"). This is cheaper, but it fails later on any canvas that does.
I'd pick **option 1**.

### [major] Running `/design-pull` again on an existing project is undefined  — §Pull / push, `/design-pull` steps 1–2
**In plain words:** The plan says the cached runtime stays pinned "until the next pull", so pulling again is expected. But pull's steps are "download into the folder, `git init`, commit a baseline". Run that on a folder you have been editing and it either overwrites your unpushed edits or resets the "last agreed" baseline, so the next push can no longer tell your changes from Claude Design's.
**What:** Pull steps 1–4 are written for a fresh folder only. Nothing says what happens when `projects/<slug>/` exists, has uncommitted editor writes, or has commits past the synced one. Writing a new `base.json` from the fresh remote would make the next push classify every local edit as "local-only" against a baseline that never saw it, or overwrite those edits outright. Refreshing `.editor/cache/` (a new type release, or a new `/_blob`) also needs re-pull, and push step 3 can bring in remote-only artboards whose new `/_blob` ids are not cached yet.
**Why it matters:** Unpushed work can be lost, or the three-way merge base can be corrupted. A remote-only artboard that push brings in can also render with missing assets until someone re-pulls, which is the risky operation.
**Best-practice options:**
1. **Refuse on a dirty project, and treat re-pull as "refresh".** *Plain words: like `git pull`, which refuses to run when it would overwrite your local changes, pull stops if you have unpushed edits and tells you to push first.* On a clean project (working tree == synced commit), re-pull runs push's steps 2, 3 and 5 with no uploads and then refreshes the cache. Also have push step 3 fetch any new `/_blob` ids for files it brings in. (git-pull docs, `--autostash` and the default refusal on a dirty tree, https://git-scm.com/docs/git-pull.)
2. Allow re-pull on a dirty tree by stashing the edits, refreshing, and re-applying them. That is more convenient, but the stash can conflict when re-applied, which is the problem push already solves.
I'd pick **option 1**: it reuses push's classification code and adds no new merge path.

### [minor] M0 re-derives things the Design type already documents, and misses two runtime facts  — §M0, §Pull/push step 3
**In plain words:** Some of M0's open questions are answered in the type's own docs, and one key fact is missing: `support.js` is not one of the type's files. The real runtime is a bundled React file inside the type.
**What:** (a) The type's file list has `artifact-type/dc-runtime.js` (a bundle containing React 18.3.1) and no `support.js`. So `./support.js` is served by the canvas host and probably loads the runtime or talks to the host page. Pull must cache everything it loads, not just `support.js`, and M0 should check whether it expects the type's `app.js` parent over postMessage, since the editor's iframe parent will not answer. The type's files can be read with the Artifact tool's `read` on the type URL. (b) `view-state.md` documents the built-in editor's element addressing: `tid` is the depth-first element index inside `<x-dc>` (including `<helmet>` and its children, `<sc-for>` and `<dc-import>`), `path` is child indices, and an `<sc-for>` child is one template node. That is the deterministic "source-order path" the id fallback needs, and matching it means selections line up with Claude Design's own. (c) The runtime renders through React, so the "do ids survive" question is really "does `data-*` on the template pass to the rendered element". That is likely, but it is still worth the M0 check.
**Why it matters:** These facts shorten M0 and harden the id fallback. Without (a), pull can cache an incomplete runtime and canvases fail offline.
**Best-practice options:** These come from the type's own docs; no external pattern applies. **Add (a) and (b) to M0's checklist and to the id fallback text.** Write down that pull caches `support.js` and its transitive loads, keyed by type release (`release 1795227355-bde3` at the time of writing).

### [minor] Any website can frame the project origin, and the probe answers its parent  — §Scripts and trust
**In plain words:** The project server's pages can be embedded by any site you visit while the editor runs, and the injected helper script answers questions from whatever page embeds it. A malicious page could read your design's contents that way.
**What:** On 5301 a top-level navigation or iframe GET carries no `Origin`, so it passes the Host check, and the probe "accepts only `e.source === parent`". When evil.com is the parent, that check passes too. Newer Chrome local-network-access prompts reduce the risk, but Safari and Firefox behave differently.
**Why it matters:** The exposure is low (Ron's own designs, and only while the editor runs), but the fix is one header.
**Best-practice options:** **Add `frame-ancestors http://127.0.0.1:5300 http://localhost:5300` to the 5301 CSP on HTML responses.** *Plain words: only the editor may embed the project pages.* frame-ancestors must be sent as a header and does not fall back to default-src (MDN frame-ancestors, https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors). Alternatively, the probe could ignore messages until a handshake, but the header is simpler.

### [minor] M0 and the overall estimate are optimistic  — §M0, §Effort
**In plain words:** M0 is called "½ day" and "takes minutes", but it lists about ten separate investigations, several of which need hands-on work in Claude Design.
**What:** M0 covers the file layout, the publish round-trip bytes, assets and runtime, the Save footprint (an edit in Claude Design, then a re-pull and a diff), what the Theme menu writes, Artifact version history, a survey of the built-in editor, the future of design systems after 2026-12-14, id survival, and layout from `canvas.json`. M1 (2–3 days) covers the server, SourceIndex, probe, zoom and pan, the full selection rules, layers and props. M5 (2 days) covers tokens, all the layer actions with content-model checks, copy and paste of styles, hide and lock, and a diff panel.
**Why it matters:** An over-tight M0 tempts you to skip the checks that decide the go/no-go. A 10–12 day total sets the wrong expectation.
**Best-practice options:** This is local, with no external pattern. **Time-box M0 to one day, with a two-hour gate first (runtime runs under the serving layer, ids survive, publish round-trip is byte-exact). Stop there if any of those fails, and re-estimate M1–M5 at the end of M0.**

### [nit] The Edit op line contradicts the canvas rule  — §Architecture, Edit op
**In plain words:** One sentence says every edit shows up instantly, but on a canvas, structural edits wait for a reload.
**What:** "The UI applies the op to the live iframe DOM/CSSOM at once (<100 ms)" holds only for `setDecl` and `removeDecl`. On a canvas, structural ops, text commits and undo write the file and reload (§Scripts and trust).
**Best-practice options:** **Qualify the sentence: "style ops apply live; on a canvas, structural ops, text commits and undo write and reload."** This is a local fix.

### [nit] The probe nonce does nothing  — §Scripts and trust
**In plain words:** The plan gives its helper script a one-time pass to get past a security rule, but no such rule is set, so the pass has no effect. Stripping `nonce` attributes from the project's own markup also changes the served page for no gain.
**What:** The CSP "sets no `script-src` restriction", so a nonce has no effect, and the nonce-stripping transform is dead code.
**Best-practice options:** **Drop the nonce and the stripping**, or keep them only if a `script-src` is added later. This is a local fix.

---

## Decisions Ron needs to make

1. **Push lock liveness** — a lease with expiry plus a nonce check, a helper process holding an `flock`, or the Claude Code PID with a start-time check. Recommendation: lease plus nonce. It fits a skill made of separate steps and also guards publish and commit.
2. **Text that contains `{{hole}}`** — read-only with an "edit in source" hint, or segment-aware editing of the literal parts. Recommendation: read-only in v1, with golden fixtures for text and attribute holes.
3. **Canvas network policy** — allow `connect-src` back to the 5301 project origin only, or keep `'none'` and treat fetching canvases as unsupported. Recommendation: allow 5301 as explicit host-sources.
4. **Re-pull policy** — refuse on a dirty project and run a no-upload refresh when clean, or stash and re-apply. Recommendation: refuse when dirty, and refresh through push's classification.
5. **M0 time-box** — keep ½ day, or one day with a two-hour go/no-go gate and a re-estimate after. Recommendation: one day with the gate.

---

## Verdict

**Ship after addressing blockers** — there are no blockers. Fold the four majors (lock lease, `{{hole}}` text, connect-src, re-pull) into the plan first: each is a local fix of a paragraph or two, and the architecture does not change.
