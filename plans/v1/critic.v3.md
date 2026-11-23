# Critic v3 — Design Editor — v1 plan

**Plan reviewed:** plan.md
**Date:** 2026-11-23
**Score:** 6/10 — the write-back core is sound and carefully argued, but nearly all of that detail is written for the fallback case (plain HTML/CSS), while the case the plan itself calls likely (Design canvases) is only a list of questions with no fallback answers.

---

## TL;DR for Ron

The engine at the heart of the plan is good. It uses exact source offsets, tiny text splices, undo by restoring whole-file snapshots, and a push that stops on any conflict. That is the right way to build "edit visually, keep the git diff clean". The biggest risk is a mismatch. The plan says v1 edits Claude Design canvases (`canvas.json` plus `*.dc.html` artboards run by `support.js`), but the Architecture, the write-target policy and M1–M2 are all written for plain HTML/CSS files, and the Non-goals still say "v1 is plain HTML + CSS". I checked the Design type's own instructions. Canvases put template holes inside inline styles (`color: {{accent}}`), load images from `/_blob/<id>` paths that only work on claude.ai, and keep frame sizes in a shared `canvas.json` that has to agree with each artboard. None of that is designed yet, and M0 has no plan B if the injected ids do not survive the runtime. One claim used to justify the project is also wrong: canvas artifacts do keep versions. Run M0 now. Before M1, rewrite Architecture for canvases with a fallback for each M0 question, then re-review.

---

## Strengths

- **Source-first mapping with server-owned ids** (§Architecture, Same-origin iframe). The ids are minted once, carried through each patch by shifting offsets and never re-derived from position, so a structural edit does not need an iframe reload. This removes a whole class of drift bugs.
- **Snapshot undo instead of inverse ops** (§Undo). Restoring the pre-image text together with its `edId → offset` map makes byte-identical undo true by construction, and no op kind needs its own inverse. This is the most robust choice available.
- **Writer shape check after re-parse** (§Writer, M5). It catches parser fix-ups such as `<p>` auto-close, nested `<a>` and table foster-parenting before anything lands on disk. It refuses the move instead of silently reshaping the author's markup.
- **Push never overwrites** (§Pull / push). `git merge-file` against the pulled baseline stops on any conflict and sends nothing. The plan is honest that line-level merge will sometimes ask more often than needed.
- **An explicit kill switch** (§M0 exit). If the built-in canvas editor already covers the gaps, the project stops. Few plans write that down.
- **Security is thought through** (§Stack, Scripts and trust). It uses an exact Origin allowlist and a per-launch token, keeps no pull/push buttons that would let a localhost server start a Claude session, and serves untrusted projects with CSP `script-src 'none'`.

## Concerns

### [major] The detailed design is for the fallback; the likely case (Design canvas) has no design and no plan B  — §Non-goals, §Architecture, §M0 "Design canvas" branch
**In plain words:** The plan spends most of its pages on how to edit ordinary web pages, then says the real target is a different format that it will design later. If the spike's answers are bad, such as the canvas runtime throwing away the editor's tags, the plan does not say what happens next.
**What:** §Non-goals still says "v1 is plain HTML + CSS (+ inline `<style>`)", while §M0 says "v1 edits **Design canvases**" and lists plain HTML as "a fallback only". The cascade resolver, `RuleLocator`, `SharedCounter`, the `@layer`/`@container` rules and the three-step write-target policy are all built for stylesheet-heavy plain HTML. I read the Design type's SKILL.md (Artifact type `QKN21svewxgyPb6SYRqWnd`). It confirms the canvas facts the plan expects, and those facts make most of that machinery secondary:
- inline `style="…"` is "what the properties panel edits";
- `<helmet><style>` is only for page basics;
- `{{hole}}` lookups appear inside inline style values (`color: {{accent}}`);
- `data-props` (single-quoted JSON) holds `$preview` w×h.

The M0 branch asks three go/no-go questions but gives no fallback for any of them:
- whether `data-ed-id` survives `support.js` template expansion;
- whether the runtime runs off claude.ai;
- how boards are laid out.

If ids do not survive, the whole mapping layer (§Source-first mapping) has no replacement. Neither M1 nor M2 can start, and the plan does not say what would be built.
**Why it matters:** M1–M2 (4 days, the "critical path") cannot be executed or estimated as written. Engineering time could also go into cascade and shared-rule code that the canvas path barely uses, while canvas-specific needs stay unplanned: hole-bearing inline styles, `<sc-for>` repeat mapping, the `$preview`/`canvas.json` coupling and `/_blob/` assets.
**Best-practice options:**
- **(A) Pre-write the canvas architecture now from the type's SKILL.md and `format.md`, and give each M0 question a written fallback.** *Plain words: design for the format you know you will get, and decide plan B before the experiment, not after it.* For example: if ids are stripped, map by source-order path inside `<x-dc>`, which is deterministic because "all UI is `<x-dc>` markup, never script-built". If the runtime will not run locally, render a static preview with holes filled from `data-props` defaults. Move `RuleLocator`/`SharedCounter` to "plain-HTML fallback, built only if M0 picks that branch". Tradeoff: about half a day of rewriting now, and a few fallbacks may turn out unused. This is what spike practice prescribes: a spike answers one specific question, and if it shows the problem is harder than expected, the team picks a different design. That only works if the alternatives are known. Sources: James Shore, *The Art of Agile Development: Spike Solutions* (https://www.jamesshore.com/v2/books/aoad1/spike_solutions); Ward Cunningham, *Spike Solution* (https://c2.com/xp/SpikeSolution.html).
- (B) Keep the plan as is and re-plan after M0. *Plain words: wait and see.* Tradeoff: no up-front cost, but the review effort so far has polished the branch least likely to be used, and the re-plan will be unreviewed.
- (C) Drop canvases and target plain-HTML artifacts only. *Plain words: shrink to what is already designed.* Tradeoff: cheap, but the plan itself says Claude makes canvases today, so the editor would have almost nothing to open.

I pick **(A)**: the format is documented well enough to design against today, and the M0 questions become pass/fail checks with known consequences.

### [major] "Claude Design has no version history" is wrong for canvas artifacts; the case for building this rests partly on it  — §Goals ("Why not just use Claude Design's own canvas editor?")
**In plain words:** One of the three reasons given for building the editor is that Claude Design keeps no history. Canvases are Artifacts, and Artifacts do keep versions, so that reason is weaker than stated.
**What:** The Artifact tool's own contract exposes a version history to anyone with edit access (`ver`: "A version of that Artifact … its history, if you can edit it") and a version pin or rollback (`contract`). A canvas is an Artifact made from the Design type. The Design type's SKILL.md also shows a built-in properties panel that edits inline `style`, plus live multiplayer (`room`) and comments. No research file sources the "no version history" claim. I grepped `research/` and found nothing on it.
**Why it matters:** The M0 kill-switch compares this editor against the built-in one. If the comparison starts from a wrong premise, the go/no-go is biased toward "go". The remaining differences are still real: line-level `git diff`, per-file revert, offline use, snapping, Alt-measure, Auto Layout handles and the token picker. They should be stated as they are.
**Best-practice options:** No external pattern applies; this is a factual correction.
- **Reword the third gap to "line-level diffs, per-file revert and offline editing (Artifact versions are whole-snapshot history)", and add "what Artifact version history shows and whether a version can be diffed or restored" to the M0 checklist.** *Plain words: say exactly what git adds over the built-in history, and measure it in M0.* Tradeoff: none. It makes the kill-switch honest.

### [major] `canvas.json` and artboard sizes are coupled and shared, and the plan never mentions them  — §Pull / push, §M3 (resize), §Write target policy
**In plain words:** Each artboard's size is stored in two places that must agree, and the index file that holds frame positions is also edited by anyone moving frames in Claude Design. A line-based merge of that file will flag a conflict on almost any concurrent change.
**What:** Per the Design type's SKILL.md, `project/canvas.json` holds `boards[path] = {x,y,w,h,…}`. For a fixed artboard the root element is fixed at `w×h`, and `$preview` in `data-props` must equal `w×h`. People also "move, add and resize artboards" in the page. Three gaps follow:
- §M3's 8-handle resize writes `width`/`height` on whatever element is selected, but resizing an artboard root needs a coordinated three-place edit (root inline style, `data-props.$preview`, `canvas.json` boards). That breaks the plan's "every edit is a small splice into one file" model.
- §Pull / push merges per file with `git merge-file`. If `canvas.json` is stored as one line, as the type's own example is, any concurrent frame move by someone else conflicts with any editor change. The same is true of the single-quoted `data-props` JSON attribute.
- The serving transform and the layout of multiple artboards on the canvas (§M0 "how a canvas is laid out from canvas.json boards") are listed as questions with no owner milestone.

**Why it matters:** Either root resizes silently desync the frame from its content, which shows as clipping or blank space in Claude Design, or every push after any remote frame move stops on a conflict that the user resolves by hand in raw JSON.
**Best-practice options:**
- **(A) v1 treats `canvas.json` and the artboard root's size as read-only.** Resizing a root shows "resize the frame in Claude Design". Push never writes `canvas.json`, only artboard files. *Plain words: don't touch the shared index in v1.* Tradeoff: one lost interaction, with zero merge risk. No external pattern needed.
- (B) Write `canvas.json` and merge it at key level, not line level. Parse base, ours and theirs, then 3-way merge per `boards[path]` key. Conflict only when the same board's same field changed on both sides. *Plain words: merge the JSON as data, not as text lines.* This is the established custom-merge-driver pattern: the driver receives `%O %A %B`, writes the result to `%A` and exits non-zero on conflict. Note that `git merge-file` cannot call a named driver, so the skill would run the JSON merge itself. Tradeoff: about a day of work, and the result must be re-serialised in the file's original style to keep Goal 2. Sources: *gitattributes — Defining a custom merge driver* (https://git-scm.com/docs/gitattributes); `git-json-merge` (https://github.com/bkad/git-json-merge).

I pick **(A)** for v1 and add (B) only if root resizing turns out to be a must-have.

### [minor] Assets and the runtime only work on claude.ai; the local server cannot proxy them  — §M0 checklist, Goal "works without a network"
**In plain words:** Images in a canvas point to a path that only means something on claude.ai, and the local server has no login to fetch them. The editor would show broken images unless pull downloads them first.
**What:** The SKILL.md says every asset goes in "VERBATIM" as `/_blob/<id>`, an origin-relative path, and that `support.js` is a fixed file of the type (one release of the Design type, contract `0.2.47`). §M0 asks whether assets are "absolute store URLs the serving transform must rewrite or proxy". They are not absolute, and proxying needs claude.ai credentials, which a localhost server does not have. Only the Claude session's Artifact tool can fetch them, using `read` with an asset id or path.
**Why it matters:** Images break in the preview. "Offline" fails. Layout checks such as "Preview = disk" and the screenshot comparison come out wrong wherever an image's size matters.
**Best-practice options:** No external pattern is relevant; local fix.
- **`/design-pull` downloads every referenced `/_blob/<id>` and `support.js` into `.editor/cache/` (keyed by id and type release), and the serving layer answers `/_blob/*` and `./support.js` from there. Push never sends the cache.** *Plain words: download what the page needs at pull time and serve it locally.* Tradeoff: a slower pull, and a runtime pinned to the pulled release until the next pull.

### [minor] No handshake between `/design-push` and a running editor  — §Pull / push, §Writer, §Undo
**In plain words:** Push can read the files while the editor is still about to save, and when push writes merged text back, the editor treats it as someone else's edit and throws away your undo history.
**What:** The Writer debounces for 300 ms and the skill is "the only entry point", but nothing tells the server to flush and pause. Step 3 writes merge results into the working files. The watcher then sees an outside change, drops undo for those files and reloads. Step 4 updates `base.json` while the editor may be writing again.
**Why it matters:** A push can miss the last edit or commit a "pushed" checkpoint that does not match what was sent, and it costs undo history every time a merge runs.
**Best-practice options:** No external pattern is needed; local fix.
- **The skill writes `.editor/push.lock`. The server, which watches `.editor/`, flushes pending ops, pauses the Writer and writes `.editor/push.ready`. The skill waits for that file, pushes, then deletes the lock. Merged files are re-indexed as "own write" (their hash recorded), so undo survives up to the merge point.** *Plain words: the push asks the editor to save and hold still, and the editor confirms.* Tradeoff: a small protocol, with no new network surface. The simplest alternative is "close the editor before pushing", which needs no code but is easy to forget.

### [minor] "The engine's own result" for the cascade winner does not exist as a web API  — §Architecture (Cascade resolution)
**In plain words:** Browsers tell you which rules match an element and what the final value is, but not which rule won. The editor has to work that out itself.
**What:** `element.matches()` gives the candidate rules and `getComputedStyle` gives the final value, but no page-level API returns the winning declaration. Even the DevTools protocol's `CSS.getMatchedStylesForNode` returns matched rules with origin and specificity and leaves the ordering to the caller. So the browser side must still sort by origin and importance, then layer, then specificity, then order. The `getComputedStyle` check cannot tell apart two rules that set the same value.
**Why it matters:** This is less important on the canvas path, where inline style is primary. On the plain-HTML fallback, though, "using the engine's own result" hides the part most likely to be wrong.
**Best-practice options:**
- **State it plainly. The browser resolver sorts candidates by importance, then `@layer` order, then specificity (the `specificity` package already in the stack), then sheet and rule order. The computed-style check is a guard, not the decider.** *Plain words: write down the sort the editor does, and test it.* Sources: Chrome DevTools Protocol, CSS domain (https://chromedevtools.github.io/devtools-protocol/tot/CSS/; my fetch returned only a redirect stub, so the return shape is taken from the WebKit protocol schema at https://opensource.apple.com/source/JavaScriptCore/JavaScriptCore-7602.4.8/inspector/protocol/CSS.json).

### [minor] The golden corpus has no canvas-specific edge cases  — §Testing
**In plain words:** The tests cover tricky plain-HTML cases but none of the canvas features the editor is supposed to handle.
**What:** The list of edge cases has no fixtures for:
- `{{hole}}` inside an inline `style` value;
- `<sc-for>`/`<sc-if>` templates;
- `<dc-import>`;
- `<helmet><style>`;
- single-quoted `data-props` JSON;
- `/_blob/` URLs;
- a `canvas.json` round-trip.

**Why it matters:** The decided rules have no test pinning them: `{{hole}}` read-only, "affects N repeats" and `<dc-import>` children read-only.
**Best-practice options:** No external pattern; local fix.
- **Add those fixtures. Add one golden test: "edit a non-hole declaration in a style that also contains `{{hole}}` → only that declaration changes".**

### [nit] Effort is estimated before the re-plan the plan itself requires  — §Effort
**What:** "10–12 working days for M0–M6" covers a canvas architecture that does not exist yet.
**Fix:** Mark it provisional and re-estimate M1–M6 in `research/06-project-format.md` at the M0 exit.

### [nit] Undo while ops are still in the debounce window is unspecified  — §Undo
**What:** The undo entry is pushed "before each Writer flush". If Cmd-Z arrives within 300 ms of an edit, it is unclear whether undo flushes first (so the entry exists) or drops the pending ops.
**Fix:** Cmd-Z flushes pending ops for the affected files, then undoes. State it and add it to the golden sequence.

---

## Decisions Ron needs to make

1. **Design for canvases now or after M0?** One option is to rewrite Architecture/M1/M2 for Design canvases now from the type's documented format, with a fallback per M0 question, and demote the cascade machinery to "plain-HTML only". The other is to keep the current text and re-plan after M0. Recommendation: rewrite now. The format is documented, and the current detail serves the less likely branch.
2. **`canvas.json` in v1: read-only, or a JSON-aware merge?** Read-only means no artboard-root resize from the editor and no merge risk. A key-level merge costs about a day plus re-serialisation that preserves style. Recommendation: read-only in v1.
3. **Cache assets and the runtime at pull for offline use?** One option is to download `/_blob/*` and `support.js` into `.editor/cache/` during `/design-pull`. The other is to require a network connection and drop the offline goal. Recommendation: cache at pull, since the local server cannot authenticate to claude.ai anyway.
4. **How push and a running editor coordinate.** The options are a lock/ready file handshake or a documented rule to close the editor before pushing. Recommendation: the lock handshake. It is a small protocol and avoids losing the last edit.
5. **Scope v1 to canvases Ron owns only?** A canvas cannot render without `support.js`, and untrusted projects are served with `script-src 'none'`, so other people's canvases will be blank unless "Run scripts" is turned on. Recommendation: state "v1 edits Ron's own canvases" as a non-goal boundary instead of leaving it implied.
6. **Is the remaining value enough, given the built-in properties panel and Artifact version history?** The M0 kill-switch is already decided. Ron should confirm that git line diffs, offline use, snapping, measure, Auto Layout handles and tokens justify about 2 weeks once "no version history" is dropped. No recommendation; this is Ron's product call.
7. **Name the M0 project.** It is still open: "Ron to name the project before M0 starts". It should be a canvas with `<sc-for>` or `{{hole}}` and a `<dc-import>`.

---

## Verdict

**Revise & re-review.** The write-back core is ready. The target format the plan commits to is not designed, two of its facts are wrong (version history, asset URLs), and the shared `canvas.json` is missing. All of this should be fixed on paper before M1 starts.
