# Critic v2 — Design Editor — v1 plan

**Plan reviewed:** plan.md
**Date:** 2026-11-23
**Score:** 4/10 — careful engineering, but aimed at a file format that the only v1 remote kind almost certainly does not use

---

## TL;DR for Ron

The write-back engineering is thoughtful. Source-first ids, byte-range splices, snapshot undo, a stop-on-conflict push and a real go/no-go spike are all the right instincts. The biggest problem is the target. The plan assumes "a design / prototype made in Claude" is plain HTML with shared stylesheets. Today's tools say otherwise. The DesignSync tool's own description says designs and prototypes "are made from a Slides or Design Artifact type". I read that Design type's instructions: a canvas is `project/canvas.json` plus `.dc.html` artboards. Those artboards use `<x-dc>` templates, `{{holes}}`, `<sc-for>` repeats, a `DCLogic` script and a `support.js` runtime, and inline `style` is the authoring surface. That is exactly the plan's own "stop; re-plan before M1" branch. Most of M1–M6 is tuned for the other branch: shared-rule cascade targeting, `script-src 'none'`, a corpus "with a shared CSS file". There are also smaller gaps: a false premise about `!important`, HTML re-parse traps on structural moves, and undefined id restoration on undo. Don't start M1. Run the M0 check now (it is mostly answered already), retarget the plan to `.dc.html` canvases or narrow the goal explicitly, then re-review.

---

## Strengths

- **Source-first mapping with serve-time ids** (Architecture, "Same-origin iframe", "Source-first mapping"): ids never touch disk, and implicit or script-made nodes are read-only. This is the right lesson from R05 and the DevTools "DOM Tree != HTML" limitation.
- **Snapshot undo instead of inverse ops** (Undo): byte-identical undo holds by construction, and outside-change invalidation is spelled out. It is simpler and safer than R00's inverse-patch idea.
- **The M0 go/no-go has its branches fixed before the spike** (M0 Exit). The plan refuses to start M1 on a guess, which is exactly what saves it here.
- **Push never overwrites silently** (Pull / push, step 3): `git merge-file` with stop-on-conflict, no auto-resolution, honest about false conflicts on adjacent lines.
- **The threat model is real** (Stack, Scripts and trust): exact `Origin`/`Host` allowlist, a per-launch token kept out of `/project/*`, and an explicit admission that a same-origin iframe is not a boundary.
- **Testing is aimed at the risky part**: no-op and one-op golden round-trips, plus "Preview = disk" computed-style parity in e2e.
- **Cutting DesignSync is correct.** I checked the tool description: it is scoped to `/design-sync`, it serves design-system projects only, it works through plan-locked writes, and it has no per-file CAS.

## Concerns

### [blocker] The v1 remote kind is a typed Design canvas, which is the plan's own stop branch  — §Pull / push, §M0
**In plain words:** The plan is built for web pages styled by shared CSS files. Designs made in Claude today are a different format: a canvas of artboard files written in a small template language that only renders with Anthropic's runtime script. Building M1–M6 as written would produce a good editor for files Ron probably doesn't have.
**What:** The plan defines v1's only remote as "a design / prototype made in Claude (an Artifact)" and treats "Typed Design artifact with data files" as a stop branch. Three pieces of evidence say that branch is the one that applies:
- The DesignSync tool description says to never use it for a design, deck or prototype, because "those are made from a Slides or Design Artifact type with the Artifact tool."
- The Design type's SKILL.md (read today via `Artifact read type_url`) defines the format. A canvas is `project/canvas.json`, an index of `boards` with x/y/w/h, `order`, `pages` and `notes`. Each artboard is a `project/*.dc.html` file with `<script src="./support.js">`, an `<x-dc>` root and `<helmet><style>`. It contains `{{hole}}` lookups (also inside `style` values, e.g. `color: {{accent}}`), `<sc-for>`/`<sc-if>`/`<dc-import>`, a `class Component extends DCLogic` script with `data-props`, and `/_blob/<id>` asset URLs. It says "inline `style=\"…\"` is what the properties panel edits", and that all UI is markup rather than script-built.
- Anthropic's migration article says moved projects become artifacts.

Consequences for the plan as written:
- The cascade and target-policy machinery (rule 2, RuleLocator, cross-file match counts) targets shared stylesheets that this format mostly does not use.
- `script-src 'none'` renders nothing, because `<x-dc>` needs the runtime.
- Rendered nodes come from template expansion, so whether `data-ed-id` survives into the live DOM is unknown.
- `<sc-for>` maps one source node to N rendered nodes.
- Artboards on a canvas need the `canvas.json` frame layout.
- The Design type already ships its own canvas editor with a properties panel, so the problem the local editor solves needs restating.

Decided Open question 1 ("a multi-file design artifact … with a shared CSS file and at least one script") picks a corpus shape that this format does not produce.
**Why it matters:** About 10 days of M1–M6 work would be optimised for the less likely format, and the M0 stop branch has no re-plan behind it. The good news is that much of the core carries over: parse5 offsets, magic-string splices, Writer, Watcher and snapshot undo. Inline-style-first targeting actually removes most of the hardest part, cascade resolution.
**Best-practice options:**
1. **Retarget v1 to Design canvases now (pick this).** *Plain words: aim the editor at the files Claude actually makes.* Do the M0 read on one real canvas today. Then rewrite Architecture for the `.dc.html` format:
   - inline `style` is the primary write target, and `<helmet><style>` the secondary;
   - `{{hole}}` values are shown read-only, with an "edit tweak default" action on `data-props`;
   - `<sc-for>` children edit the template node with an "affects N repeats" notice;
   - `<dc-import>` children are read-only;
   - the canvas layout comes from `canvas.json` boards;
   - the runtime (`support.js`, served from the type's fixed files) must run, so the trust section changes;
   - push publishes `root`+`files` per artboard, and the Artifact tool already refuses a publish over a newer hand edit and names the file.

   Tradeoff: a re-plan of Architecture, M1 and M2 (about a day of planning), but the riskiest code (cascade) gets much smaller. Sources: Design Artifact type SKILL.md, https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd (read 2026-11-23); "Migrate from standalone Claude Design to Claude", https://support.claude.com/en/articles/17440474-migrate-from-standalone-claude-design-to-claude.
2. **Keep plain-HTML artifacts as v1 and say so.** *Plain words: build for hand-written HTML pages only, and stop calling it a Claude Design editor.* Change Goal 1 and the corpus to untyped HTML artifacts published with the Artifact tool. Tradeoff: the current plan survives almost unchanged, but it may not edit any project Ron actually has.
3. **Pause and justify the gap first.** *Plain words: check that the built-in canvas editor doesn't already do enough.* List the 2–3 things the Design canvas editor cannot do that this tool must (snapping and Alt-measure, Auto Layout handles, token picker, git diffs, offline). Tradeoff: cheap, and it may kill or shrink the project. Source: the same SKILL.md ("inline style … is what the properties panel edits").

### [major] Rendered DOM is not the source DOM once scripts run  — §Scripts and trust, §Same-origin iframe
**In plain words:** The editor assumes that what it sees in the preview is the file. When a page's scripts run, they change elements the editor thinks it owns, so edits get checked against the wrong thing.
**What:** The plan treats only script-*created* elements as read-only. Scripts also mutate id-carrying source elements: they toggle classes, set `element.style`, re-render subtrees and drive state. Under the Design format, the runtime renders everything. The Writer ack ("value the re-indexed source now resolves") and the M2 `getComputedStyle` gate will then disagree with disk for reasons that have nothing to do with the edit. That causes spurious reload toasts, or a script-set inline style silently beating the edit. `duplicateNode` applied to the live DOM via cloning also drops listeners, so the preview behaves differently from a fresh load.
**Why it matters:** "Preview = disk" is a headline guarantee. With trusted scripts, which Open question 1 deliberately requires, it is not true by default.
**Best-practice options:**
1. **Track script drift per node (pick this).** *Plain words: watch for scripts changing an element, and stop trusting that element's live attributes.* Attach a `MutationObserver` in the iframe after load. Any attribute or child mutation not caused by an editor op marks that node (or attribute) "drifted": its live style or class is not used for target choice or verification, and the panel shows a badge. Tradeoff: modest code, keeps the trust model. Source: Chrome DevTools Workspaces, on why Elements edits are not saved (DOM tree != HTML), https://developer.chrome.com/docs/devtools/workspaces.
2. **Verify against a script-free render.** *Plain words: check edits against a second, script-free copy of the page.* Keep a hidden second iframe with `script-src 'none'` for mapping and verification. Tradeoff: double rendering, and useless for runtime-rendered formats like `.dc.html`.
3. **After a structural op, reload the iframe for trusted projects** instead of patching the live DOM. Tradeoff: loses script state and scroll, but it is honest.

### [major] The `!important` exception rests on a false premise  — §Write target policy rule 2, §Risks
**In plain words:** The plan says that if a shared rule wins with `!important`, the tool must edit that shared rule because an element-only style would lose. That is wrong: an element's own `!important` style beats every stylesheet `!important`. So the plan is about to change many elements when it only needed to change one.
**What:** Rule 2 says: "If the winner is `!important`, it is the target even when shared, because inline would lose to it." The Risks row repeats it. Per the CSS cascade, inline `style` declarations marked `!important` rank above all author `!important` declarations, layered or not, regardless of specificity. Only user or UA important styles and transitions beat them.
**Why it matters:** This is the one path where the default policy edits a shared rule. Shared-class leakage is the #1 complaint the research found (Webflow, GrapesJS in R05).
**Best-practice options:**
1. **Write inline with `!important` for that element only (pick this).** *Plain words: give the element its own stronger style instead of touching the shared one.* Show a chip saying "overrides `!important` in `.x` (file:line)", and keep "Edit shared class" as the explicit path. Tradeoff: adds an `!important` to source, but it is scoped and visible. Source: MDN, "Introduction to the CSS cascade", https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascade/Introduction ("Inline importance does take precedence over all other author declared `!important` declarations").
2. **Ask each time.** *Plain words: let the user choose between changing all the elements or just this one.* A modal offering "this element (inline !important)" or "all N elements (edit rule)". Tradeoff: friction on every such edit.
3. Keep the current rule but block the edit until confirmed. Tradeoff: still defaults toward leakage.

### [major] Structural moves can produce HTML that re-parses into a different tree  — §Edit op, §Writer, §M5
**In plain words:** Browsers let a script put any element inside any other, but the HTML text parser "fixes" some combinations. A `<div>` inside a `<p>` gets pushed out, and links can't nest. The preview would show one structure while the saved file means another.
**What:** `moveNode`/`wrapNode`/`duplicateNode` are applied to the live DOM through DOM APIs, which allow any nesting. The source splice is then re-parsed by parse5, the spec parser. Several cases re-parse differently:
- a `p` is implicitly closed by `div`, `section`, `ul`, `table`, `h1`–`h6` and similar elements;
- nested `a`, `button` inside `button`, and nested `form` are split or dropped;
- table content is foster-parented out of the table.

The M5 guards cover only void elements and cycles. "Sanity re-parse" is not defined to compare tree shape, and id carry-over after such a re-parse lands on the wrong nodes.
**Why it matters:** Silent structural corruption, plus preview ≠ disk, on exactly the "layer actions" path.
**Best-practice options:**
1. **Make the re-parse the judge (pick this).** *Plain words: after writing, read the file back and check it builds the tree we intended; if not, refuse the move.* After the splice, re-parse and compare the edited subtree's shape (tag and child sequence) with the intended post-op tree. On mismatch, reject the op, revert the live DOM and explain why ("a `<div>` can't go inside a `<p>`"). Tradeoff: small, generic, and correct because parse5 implements the spec. Source: WHATWG HTML, "The p element" (end-tag omission rules), https://html.spec.whatwg.org/multipage/grouping-content.html#the-p-element.
2. **Pre-check against a content-model table** to grey out invalid drop targets during drag. Tradeoff: better UX, but the table is incomplete, so use it with option 1, never instead of it.

### [major] How ids survive a re-parse and a snapshot undo is undefined  — §Same-origin iframe, §Undo
**In plain words:** The plan promises element ids never change, but every save re-reads the file into brand-new nodes, and undo pastes back an old copy of the whole file. Nothing says how the old ids find their elements again.
**What:** "Re-index that file (ids carried over in place)" and "never re-deriving it from position" conflict, because a re-parse creates new parse5 nodes, and mapping old ids onto them needs some correspondence, in practice post-edit offsets. Undo writes a full pre-image back and "re-indexes and remaps ids", with no mapping defined. Undoing `deleteNode` must bring back a retired id, and undoing `duplicateNode` must retire minted ones. The M5 golden sequence (move, duplicate, undo ×2, then edit) is exactly where this breaks.
**Why it matters:** Wrong id mapping means the next edit lands on the wrong element. That is the failure the whole id design exists to prevent.
**Best-practice options:**
1. **Snapshot the id map with the text (pick this).** *Plain words: when saving the old file for undo, also save which id belonged to which element, and restore both together.* Each `UndoLog` entry stores, per file, the pre-image text plus the `edId → start offset` map for that text. Undo restores both and re-binds by exact offset on the re-parse, which is deterministic because the text is byte-identical. Tradeoff: small memory cost, no heuristics. No external pattern needed; it follows from the plan's own pre-image design.
2. **Forward patches: shift offsets by the splice delta list** (which the PatchEngine knows) and bind re-parsed nodes by start offset. magic-string's `generateDecodedMap({hires:true})` can supply the mapping, though the README documents no direct offset-lookup API. Source: magic-string README, https://github.com/Rich-Harris/magic-string. Tradeoff: needed for forward patches anyway; state it explicitly.
3. Fall back to the watcher's tree-diff reconcile plus an iframe reload on undo. Tradeoff: loses the "no reload" promise.

### [major] Rule 2's cross-file match count needs a matcher the architecture doesn't have  — §Write target policy, §Cascade resolution
**In plain words:** To know whether a rule styles only this one element, the tool must also look at other pages that use the same stylesheet. The plan says matching happens only in the browser, and the browser has only the open page loaded.
**What:** Rule 2 counts matches "across every indexed HTML file that loads that stylesheet". Cascade resolution is browser-only, and "the server only maps to source". There is no component that matches selectors against unopened pages. Static matching also can't see script state or `:hover`-style pseudo-classes.
**Why it matters:** Without it, the uniqueness test is wrong on multi-page projects, which Open question 1 chose deliberately, so shared rules get edited as if they were unique.
**Best-practice options:**
1. **Match server-side over parse5 trees (pick this).** *Plain words: let the server check the selector against every page file directly.* Use `css-select` with `css-select-parse5-adapter` on each indexed HTML file. Count conservatively: any dynamic pseudo-class or a script-bearing page counts as "shared, warn". Tradeoff: one dependency, fast, and static by design. Sources: css-select-parse5-adapter, https://npmjs.com/package/css-select-parse5-adapter; css-select, https://github.com/FB55/CSSselect.
2. Load each other page in a hidden iframe and run `querySelectorAll`. Tradeoff: accurate including scripts, but slow and runs untrusted scripts.

(This shrinks a lot if the blocker's option 1 makes inline style the primary target.)

### [minor] An explicitly picked rule can be silently overridden to inline  — §M2, §Write target policy rule 1
**In plain words:** If the user picks a rule that doesn't currently win, the M2 check sends the edit to the element's own style instead, quietly ignoring the user's choice.
**What:** Rule 1 is "the rule the user picked", but M2 says that if `getComputedStyle` doesn't show the new value, "the edit goes inline". Those two collide.
**Why it matters:** It breaks the trust promise of the selector chip.
**Best-practice options:** No external pattern applies; local fix. **For rule-1 targets, write where the user said and show "this rule is overridden by `.y` (file:line)"; apply the inline fallback only to automatic targets (rule 2).** *Plain words: obey explicit choices, warn instead of redirecting.*

### [minor] In-place text editing will mangle entities and mixed content  — §M2 "Double-click text editing"
**In plain words:** Editing text in the browser loses the difference between `&nbsp;` and a real space, and the browser may add `<br>` or `<div>` tags of its own.
**What:** "Patches only the text node" doesn't define elements with several text nodes or inline children (`<b>`, `<br>`), entity spellings in source (`&amp;`, `&nbsp;`, `&#8217;`), or `contenteditable` inserting markup on Enter or paste. The golden corpus has no entity fixture.
**Why it matters:** One-line text edits produce multi-line or wrong diffs, which breaks Goal 2.
**Best-practice options:**
1. **Use `contenteditable="plaintext-only"`, enabled only on elements whose children are a single text node, and diff old against new text.** Splice only the changed span, re-encoding just `<`, `&` and non-breaking spaces, so untouched entity spellings stay byte-identical. Add an entity fixture. *Plain words: only allow typing where it's plain text, and change only the characters that changed.* Source: MDN `contenteditable`, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/contenteditable (plaintext-only strips formatting). (Pick this.)

### [minor] The Vite dev server breaks the single-origin and ws-origin assumptions  — §Stack
**In plain words:** Running Vite's own dev server puts the editor on a different port from the project, so the "same origin" trick fails, and Vite's live-reload socket trips the plan's "reject any other socket" rule.
**What:** The Stack table pairs a Node server on `127.0.0.1:5300` with "Vite + React". A separate Vite port gives a different origin from `/project/*`. Vite's HMR WebSocket also collides with "rejects any … ws upgrade whose Origin is not the editor's own" unless the two are deliberately combined.
**Why it matters:** The overlay's DOM access, which the whole architecture rests on, fails in development.
**Best-practice options:** **Run Vite in `server.middlewareMode` with `appType: 'custom'` inside the Node server, bind HMR to the same server via `server.ws.server`, and set an explicit `allowedHosts`. Production serves the built bundle.** *Plain words: run everything through one server and one port.* Source: Vite server options, https://vite.dev/config/server-options. (Pick this.)

### [minor] Push edge cases: concurrent writes, added/deleted files, merged result locally  — §Pull / push
**In plain words:** The push flow covers files changed on both sides, but not files that were added or removed, or the editor saving while a push is running.
**What:**
- `git merge-file` only handles files modified on both sides; added, deleted and renamed files (and new assets) are unspecified.
- The editor's Writer can flush during `/design-push`.
- After a clean merge, the merged text must also be written locally (the watcher then reconciles) and become the next base commit.
- `--diff-algorithm` needs git ≥ 2.44. This machine has 2.54, so it's fine, but state it.

**Why it matters:** The first real push with a new image or a removed artboard has no defined behaviour.
**Best-practice options:** No external pattern beyond git's own docs; local fix. **Make push take a lock that pauses the Writer, treat the file set as a 3-way set diff (an add or delete on one side goes through; an add or delete on both sides that differs is a conflict), write merged results locally before publishing, and commit the merged tree as the new base.** *Plain words: freeze the editor during push and handle new and removed files explicitly.*

### [minor] M2 bundles the full properties UI into the riskiest milestone  — §M2, §Effort
**In plain words:** The plan says to build the risky core before the fancy UI, then puts the colour picker, shadow list and typography controls in the same 2-day milestone.
**What:** M2 holds the PatchEngine, browser cascade resolver, RuleLocator, Writer, Watcher, UndoLog, the full editable panel and text editing, all in 2 days.
**Why it matters:** The critical path is overloaded, and the slip rule ("cut M5's layer actions") protects the wrong milestone.
**Best-practice options:** No external pattern; local fix. **Move the colour picker, shadow list and typography into M4/M5. M2 exits with a raw value text field per property plus the golden tests.** *Plain words: prove saving works with a plain text box first, then add the nice controls.*

### [nit] The computed-style check has false negatives  — §M2
**In plain words:** The browser reports styles in normalised units and mid-animation values, so a correct edit can look as if it failed.
**What:** `getComputedStyle` returns resolved values (`1em` becomes `16px`, colours become `rgb()`) and in-progress transition values. A naive comparison sends correct edits inline.
**Best-practice options:** Local fix. **Compare against a probe element given the same declaration, and suppress transitions (`transition: none` on the target) during the check.** *Plain words: compare like with like, and freeze animations while checking.*

---

## Decisions Ron needs to make

1. **What v1 actually edits.** The options are Design canvases (`.dc.html`, what Claude makes today), plain untyped HTML artifacts (what the plan assumes), or pausing to confirm the gap over the built-in canvas editor. Recommendation: Design canvases; check one real project of yours first (minutes).
2. **What the local editor must do that the Design canvas editor can't.** This was a hidden decision; the plan never compares against the built-in editor. Name 2–3 concrete gaps (snapping and measure, Auto Layout handles, token picker, git diff, offline) so the scope follows them. Recommendation: write these into Goals before M1.
3. **Shared `!important` winner.** The options are inline `!important` on the element, editing the shared rule (current plan, based on a false premise), or asking each time. Recommendation: inline `!important` with a visible chip.
4. **Structural ops that break HTML parsing rules.** The options are reject with an explanation, or auto-adjust (for example converting the `<p>` to a `<div>`). Recommendation: reject, with drop targets greyed out where known.
5. **How ids are restored on undo.** The options are snapshotting the id map with the pre-image, or reconcile plus reload. Recommendation: the snapshot id map.
6. **Script trust once the runtime must run.** If v1 targets Design canvases, every artboard needs `support.js` and its `DCLogic` script, so "scripts off by default" no longer works. The options are to trust all of Ron's own canvases (the token stays reachable by project scripts), or to serve the iframe from a second origin with a postMessage bridge (losing direct DOM access). Recommendation: trust own canvases for v1 and keep the exact Origin/Host checks.
7. **Cross-file uniqueness check** (only if shared stylesheets stay in scope). The options are server-side css-select over parse5, or hidden iframes. Recommendation: server-side css-select, conservative on dynamic pseudo-classes.

---

## Verdict

**Revise & re-review.** The core mechanics are sound, but the plan is aimed at the M0 branch that the evidence already rules out for Claude-made designs. Retarget it, or narrow the goal explicitly, before M1.
