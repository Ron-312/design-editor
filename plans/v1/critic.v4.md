# Critic v4 — Design Editor — v1 plan

**Plan reviewed:** plan.md
**Date:** 2026-11-23
**Score:** 5/10 — the write-back core is careful, but the Design type's own docs undercut the "why build this" list and the token feature, and the push flow can still overwrite remote edits silently.

---

## TL;DR for Ron

The engineering core is strong: source-first mapping, byte-exact splices, snapshot undo, a go/no-go spike and stop-on-conflict push are all the right calls. The biggest risk is the premise. I read the Design type's own SKILL.md and `format.md` (release 1795227355-bde3). They document things the plan lists as reasons to build this editor. The built-in properties panel "edits the full set" of flex and grid properties. It has "Wrap in flex" and "Wrap in grid", per-artboard layout guides, and a Theme menu fed by design-system tokens. So Auto Layout and tokens are mostly not gaps, and what is left is git diffs, offline use and maybe snapping/measure. Four more things need fixing. Canvas tokens are not `:root --*` variables. The canvas runtime is React, which breaks the plan's "mutate the live DOM in place" model. The type itself calls canvas content untrusted input that must run sandboxed. And push never brings remote-only changes into your local files, so a later push can silently undo them. Revise and re-review. Set the M0 kill bar against the documented feature list now, not after the spike.

---

## Strengths

- **Source-first mapping with server-owned ids** (§Architecture, Same-origin iframe). Ids that never touch disk, allocated once and carried through patches, avoid the DevTools "DOM tree ≠ HTML" trap the research cites (R05).
- **Snapshot undo, not inverse ops** (§Undo). Byte-identical undo holds by construction, with no per-op inverse to get wrong. Restoring the stored id map with the pre-image is a neat answer to id drift.
- **Writer re-parse shape check** (§Writer). Refusing a structural op when parse5 would re-parent the node (the `p` auto-close, foster-parenting) catches a real class of silent corruption before it hits disk.
- **M0 is a real go/no-go with pre-decided fallbacks** (§M0). Branches, kill switch and fallbacks are written before the spike, so M0 answers are pass/fail.
- **Push never auto-resolves** (§/design-push 4). It stops on any conflict, and the lock + `push.ready` handshake fixes the lost-debounce problem honestly.
- **Verified claims hold:** the Design format (`project/canvas.json`, `*.dc.html`, `<x-dc>`, `<helmet><style>`, `{{hole}}`, `<sc-for>`, `<dc-import>`, inline `style` as what the panel edits, `$preview` in `data-props`) matches the type's SKILL.md. `git merge-file --diff-algorithm` exists in local git 2.54 and its exit codes are as stated.

## Concerns

### [major] The built-in editor already documents most of the "why build this" list  — §Goals ("Why not just use Claude Design's own canvas editor?"), decided: Ron r3
**In plain words:** The plan says Claude Design's editor does not document Auto Layout handles, tokens or guides, so building our own is worth about 2 weeks. The Design type's own docs say it has a full flex/grid panel, wrap-in-flex/grid, layout guides and a Theme menu for tokens. Most of the reason to build this is already in the product.
**What:** The r3 decision rests on "snapping, measurement and token binding are 'not stated' in Anthropic's docs". The Design type's `artifact-type/reference/format.md` states: stacks and grids "are first-class in the editor: the properties panel edits the full set" (direction, gap, justify, align, `flex-grow` / `align-self`). It also says viewers use "Wrap in flex" / "Wrap in grid", and dragging an item out of a stack "freezes the remaining siblings". `canvas.json` boards carry `guides` (columns/rows/grid) that the canvas draws over the artboard. SKILL.md says that without `project/ds/<folder>/tokens.json` "the Theme menu shows bare hexes", which means a token-aware Theme menu exists. On top of that it lists inline text retyping ("WYSIWYG editor") and a Tweaks tab. The r3 evidence missed these type files, which are the closest thing to docs for the canvas editor. Not stated is only on-canvas snapping to siblings, Alt-measure and gap/padding drag handles.
**Why it matters:** M4 (Auto Layout, 1–2 days) and M5 tokens (part of 2 days) largely rebuild shipped features. What is truly left is git line diffs, offline use, snapping and measure. That may or may not justify 10–12 days. The kill switch only fires if the gap list is empty, and it will not be empty, so the project will go ahead on a thinner case than the Goals section claims.
**Best-practice options:**
- **(a) Re-baseline the gap list now from the type docs, and set a numeric kill bar.** *Plain words: write down what the built-in editor is documented to do, and decide in advance what is left that is worth building.* Move flex/grid panel editing and Wrap-in-flex to "exists". Keep M4 only for on-canvas gap/padding handles and Hug/Fill/Fixed if M0 shows they are missing. State that the project goes ahead only if snapping + measure are absent and git diffs/offline matter to you. Cheap and honest. This is a local fix; the source is the Design type's `format.md` and SKILL.md (https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd, release 1795227355-bde3). I would pick this.
- (b) Shrink v1 to a "git-sync + precision" tool: pull/push with line diffs, snapping, measure, nudge, on top of the read-only canvas. Drop M4/M5 tokens to Next. Roughly halves the effort, but changes the product.
- (c) Keep scope and accept the overlap as "works offline too". Weakest: offline alone rarely justifies rebuilding panels.

### [major] Push never pulls remote-only changes into the working tree, so a later push can silently overwrite them  — §Pull / push, /design-push steps 3–5
**In plain words:** If someone changes artboard A in Claude Design while you edit artboard B, push merges B and records the new remote version as the base. Your local copy of A is still the old one. The next time you touch A and push, the plan sees "remote unchanged since base" and uploads your old A over their edit.
**What:** Step 4 merges only "changed files" (files changed locally). Step 5 "updates `base.json`" to the new remote version. Nothing writes the remote's version of files that changed only remotely (or new/removed artboards) into `projects/<slug>/`, or into the git baseline used as `base` by `git merge-file`. After such a push, base.json says remote = V2 while local A still holds V1 bytes. A later local edit to A plus push hits step 3 ("remote unchanged since base → upload") and replaces the remote A. The Artifact publish guard will not catch it, because the plan says it refuses only relative to what the session last read, and step 2 just read it. The baseline is also always called "pulled git baseline", not "last synced commit", so after one push the 3-way base is stale.
**Why it matters:** This breaks Goal 3 ("without silently overwriting anything changed there") in an ordinary two-person or two-surface workflow, and nothing in the M6 exit tests would catch it.
**Best-practice options:**
- **(a) Treat it as a two-replica sync with an archive of the last synced state.** *Plain words: remember exactly what both sides looked like when they last agreed, and move every one-sided change across in both directions.* On each push, for every file (including added/removed artboards), compare local and remote against the last synced commit. Local-only change: upload. Remote-only change: write it into the working tree (an outside edit, so reconcile and reload). Both changed: `git merge-file`. Then commit that state as the new baseline and record per-file hashes of it in base.json. This is Unison's model: the archive "records the state of each path in the replica when it was last synchronized", and a one-sided change is propagated "from the updated replica to the other". Source: Unison File Synchronizer manual, https://raw.githubusercontent.com/bcpierce00/unison/documentation/unison-manual.html; git-merge-file docs, https://git-scm.com/docs/git-merge-file. I would pick this: it is the standard model, and the plan already has every piece except the one-sided direction.
- (b) Make push refuse unless local == remote for every file the editor did not change. That is "pull first, then push". Simpler, but it adds a manual step and still needs base.json to advance correctly.

### [major] Canvas tokens are not `:root --*` variables  — §M5 (Token picker), §Goals (Tokens)
**In plain words:** The token picker looks for CSS variables on `:root`. Claude Design canvases keep their tokens in a design-system file and author literal colours inline, so the picker would usually find nothing to offer.
**What:** On the primary branch, SKILL.md puts tokens in `project/ds/<folder>/tokens.json` with a `designSystems` record in `canvas.json`, consumed by the editor's Theme menu. `format.md` says "static theme tokens … belong inline so they paint while streaming", meaning literal values in `style="…"`. `<helmet><style>` is for "page basics and the `a`/`a:hover` colors". Neither puts `--x` on `:root`. The plan does not say how the Theme menu applies tokens (CSS variables? literal rewrite?) or whether a `var(--x)` in an inline style survives the runtime and the built-in panel.
**Why it matters:** M5's token picker could ship working on fixtures and empty on real canvases. Writing `var(--x)` may also fight with whatever the Theme menu does.
**Best-practice options:**
- **(a) Add an M0 question: "how does the Theme menu apply a token, and what lands in the file?"** *Plain words: look at what Claude Design writes when you pick a theme colour, and copy that.* Then source the picker from `project/ds/*/tokens.json` and write the same form the built-in editor writes. If there is no design system, fall back to `:root --*` only when present. This is a local fix; no external pattern applies. I would pick this.
- (b) Drop tokens from v1 (concern 1 already shows the Theme menu covers part of it).

### [major] The canvas runtime is React, so "mutate the live DOM in place" is unsafe  — §Architecture (Same-origin iframe, Scripts and trust), §Undo, §M0 fallbacks
**In plain words:** Claude Design draws each artboard with React. React expects to own the page. If the editor moves or copies elements behind its back, React gets confused and can crash or undo the change on its next update.
**What:** `format.md` states the `DCLogic` class gets "React class lifecycle", events are "JSX camelCase", and `class` maps to `className`. So every element inside `<x-dc>` is React-rendered. The plan already reloads on structural ops "when scripts are on". But on the canvas branch scripts are always on, so the id-carrying "no reload, selection and scroll survive" design (§Same-origin iframe) and "the UI re-syncs the live iframe DOM in place, with no reload" (§Undo) never apply to the primary branch. Optimistic `setDecl` on a React-owned node survives only until React re-applies that style prop: any `{{hole}}` in the same `style` triggers it on the next `setState`. `contenteditable` text edits inside React text nodes are a known crash source. The static-preview fallback ("`{{hole}}` filled from `data-props` defaults") cannot render `<sc-for>` lists or `renderVals()` results. `format.md` says `default` "seeds the editor only", so defaults are not what renders.
**Why it matters:** The selection-preserving claims and the M1/M2 estimates rest on the plain-HTML DOM model. On canvases, expect a reload per structural op and per undo, and flaky optimistic edits on interactive artboards.
**Best-practice options:**
- **(a) For canvases, state "the runtime owns the DOM": optimistic edits only touch inline style props not bound to a hole. Every structural op, undo and text commit writes the file and re-renders.** *Plain words: let React redraw from the file instead of fighting it, and keep selection by id across the redraw.* React's own guidance: "avoid changing DOM nodes that React manages", since manual changes "can conflict with React's updates" and removing a managed node can crash. Source: React docs, Manipulating the DOM with Refs, https://react.dev/learn/manipulating-the-dom-with-refs. Re-render from the file through the runtime (hot reload of the artboard) rather than a full iframe reload if M0 finds the runtime supports it. I would pick this: it matches how the runtime works and keeps selection by id.
- (b) Rewrite the static-preview fallback as "render with the pinned runtime offline, or stop", since a no-runtime preview cannot show repeats or computed values.

### [major] The trust model keys on who owns the canvas, but the type calls all canvas content untrusted input  — §Scripts and trust, §Non-goals (decided: deep-critic r3)
**In plain words:** The plan runs a canvas's scripts with full access to the editor if the canvas is yours. Claude Design canvases are shared and edited by other people, and the type's docs say that content must only ever run in a sandboxed frame. "Mine" does not mean "only I wrote it".
**What:** `format.md`: "The design content a viewer edits is **untrusted cross-user input** … It runs ONLY inside the editor's sandboxed preview iframe … never lift published design source into … an unsandboxed surface". SKILL.md: "A person may have edited an artboard by hand since you last saw it", and the type grants `room` and `comments`. Under the plan, a `DCLogic` class written by a collaborator runs same-origin with the editor, reads the per-session token and can send any edit op or API call. The r3 rationale rejected a second origin because a postMessage bridge "loses the direct DOM and `getBoundingClientRect` access the overlay needs". It missed that a probe script injected into the frame keeps full DOM access and only makes the API async. MDN also says `allow-scripts` + `allow-same-origin` on a same-origin frame is "no more secure than not using the `sandbox` attribute at all".
**Why it matters:** Damage stays inside the localhost editor and the project folder, but that folder is what you push, and the token also drives any future pull/push button. The plan deliberately goes against the platform's own stated rule.
**Best-practice options:**
- **(a) Serve `/project/*` from a second origin (another port, or `127.0.0.2`) with `sandbox="allow-scripts"`. Have the serving layer inject a small editor probe script that answers rect, `matches()` and computed-style queries and applies optimistic edits over postMessage, with origin and source checks.** *Plain words: put the canvas in its own locked room, and leave a small helper inside it that measures things and reports back.* This is how Onlook works: a preload script "injected into the Template app, enabling direct communication with the application's DOM via an iframe" across origins with postMessage (Penpal as RPC). Sources: MDN `<iframe>` sandbox note, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe; Penpal, https://npmjs.com/package/penpal; Onlook architecture, https://docsearch.algolia.com/mcp/docs/repo/onlook-dev/onlook. Cost: about a day, and the overlay reads become async. I would pick this, because the serving layer already rewrites every page, so the probe is nearly free.
- (b) Keep same-origin, but run scripts only when every artboard's last remote author is you (if the Artifact read exposes authorship). Cheaper, but it depends on metadata M0 has not confirmed.

### [major] The plan body is still built around the plain-HTML fallback  — §Architecture (cascade resolution, write target policy), §M2, §Testing, §Open questions 1
**In plain words:** The plan says canvases are what v1 edits, and that the CSS-cascade machinery is fallback only. But the milestones, tests and test-project choice are still written as if that machinery is core, so it is unclear what M2 builds and how long it takes.
**What:** M0 says the cascade resolver, `RuleLocator`, `SharedCounter` and the three-step write-target policy are "plain-HTML fallback only". M2 lists "the browser-side cascade resolver and the server's RuleLocator" and the "Write target policy" as deliverables, and its 2-day estimate covers them. The Testing corpus centres on `<style>` blocks, `@media` and shared CSS. Open question 1 says the project has "a shared CSS file", but in a canvas any `.css` file is an uploaded `/_blob/<id>` asset ("A changed file is a new upload: repoint its artboards"). The plan caches that asset read-only and never pushes it, so a shared-CSS rule can never be a write target on the canvas branch.
**Why it matters:** Effort and critical path are mis-stated whichever branch M0 picks. An implementer reading M2 will build the fallback first.
**Best-practice options:**
- **(a) Split the plan: the canvas path in the main milestones, with the cascade machinery moved to a "Plain-HTML branch" appendix that M0 activates. Re-estimate M2 for canvases (inline `style` + `<helmet><style>` only), and state that `/_blob` CSS is read-only.** *Plain words: write the plan for the case you expect, and park the other case where it can't confuse anyone.* This is a local fix; no external pattern applies. I would pick this.

### [minor] `<sc-for>` repeats break the one-id-one-node assumption  — §M0 fallbacks, §Testing (canvas fixtures)
**In plain words:** A repeated list item is one element in the file but many on screen. The editor's hover, selection and instant preview all assume one on-screen element per id.
**What:** If `data-ed-id` survives expansion, every repeat carries the same id. The hit-test, the overlay outline, "Shift-click multi-select", and the optimistic edit (which must apply to all N repeats) are not specified for that.
**Why it matters:** It produces confusing selection and preview glitches on the most common canvas pattern (lists, cards).
**Best-practice options:**
- **(a) Define it: hovering a repeat outlines all repeats, an edit applies to every node with that id, and the panel shows "template · N repeats".** *Plain words: treat the repeats as one thing, the way Figma treats a component's instances.* This is a local fix; no external pattern applies. I would pick this.

### [minor] Edits made while a push is running are not specified  — §/design-push step 1
**In plain words:** While push runs, and especially while you resolve a conflict, the editor is paused. The plan does not say whether you can keep editing and what happens to those edits.
**What:** The Writer pauses at `push.ready` and resumes after the lock is deleted. Conflict resolution can take minutes. The plan does not say whether the UI blocks, queues ops in memory, or keeps applying them to the live DOM unsaved.
**Why it matters:** If the UI keeps showing edits that are not on disk, that breaks the plan's own "preview = disk" rule. Lost edits are possible if the editor closes mid-push.
**Best-practice options:**
- **(a) Show a "pushing…" banner and make the canvas read-only until the lock clears.** *Plain words: freeze editing for the few seconds or minutes a push takes.* This is a local fix; no external pattern applies. I would pick this.

### [nit] Canvas e2e tests need the runtime, which lives only in a git-ignored cache  — §Testing, §/design-pull step 3
**In plain words:** The tests need the Claude Design runtime script to draw a canvas, but the plan keeps it only in an ignored cache folder, so a fresh checkout cannot run the canvas tests.
**What:** `.editor/cache/` is git-ignored. Fixtures are copied in without it.
**Why it matters:** Playwright canvas tests fail on a clean clone, or silently use whatever release happens to be cached.
**Best-practice options:**
- **(a) Vendor one pinned runtime release into `test/fixtures/runtime/<release>/`.** This is a local fix; no external pattern applies.

### [nit] `support.js` is likely not a published file of the canvas  — §/design-pull step 3, §M0
**In plain words:** The plan plans to download `support.js` from the canvas, but it is probably provided by the Design type, not stored in your project.
**What:** The type's fixed files include `artifact-type/dc-runtime.js`, and SKILL.md says the canvas is served "read-only plus ITS OWN files under `project/`". An Artifact `read` of `support.js` on the canvas may fail. Reading the runtime from the type URL at its release id may be the working path.
**Why it matters:** Pull step 3 could fail on its first run.
**Best-practice options:**
- **(a) Add this to M0's checklist: fetch the runtime via the canvas, and if that fails, via the type URL + release id. Record which works.** This is a local fix; no external pattern applies.

---

## Decisions Ron needs to make

1. **Kill bar for M0, given the documented built-in features** — options: (a) go ahead only if snapping + Alt-measure are missing and git diffs/offline matter to you; (b) shrink v1 to "git-sync + precision tools" and move Auto Layout panels and tokens to Next; (c) keep full scope. Recommendation: (a), with (b) as the fallback if M0 shows snapping exists.
2. **Trust model for canvas scripts** — options: (a) second origin + injected probe script over postMessage (about +1 day, async overlay reads); (b) keep same-origin for your own canvases (the r3 decision). Recommendation: (a), because the type itself says canvas content is untrusted cross-user input.
3. **Push sync model** — options: (a) a full two-way sync against the last synced commit (one-sided changes move both ways, new/removed artboards handled, baseline advances on every push); (b) refuse to push until remote-only changes are pulled. Recommendation: (a).
4. **Token source on canvases** — options: (a) read `project/ds/*/tokens.json` and write whatever the Theme menu writes (M0 checks); (b) `:root --*` only; (c) drop tokens from v1. Recommendation: (a).
5. **Where the plain-HTML cascade machinery lives** — options: (a) move it to an appendix activated by M0 and re-estimate M2 for canvases; (b) keep it in M2. Recommendation: (a).
6. **Editing during push** — options: (a) read-only canvas with a banner; (b) queue ops in memory. Recommendation: (a).
7. **Hidden decision: what an edit to a `<sc-for>` repeat does on screen** — options: (a) apply to all repeats and outline them together; (b) make repeats read-only. Recommendation: (a).

---

## Verdict

**Revise & re-review** — the write-back core is ready, but the premise (concern 1), the silent-overwrite gap in push (concern 2) and the React/trust facts from the Design type's own docs need to be folded in before M1.
