# Critic v10 — Design Editor — v1 plan

**Plan reviewed:** plans/v1/plan.md
**Date:** 2026-11-23
**Score:** 7/10 — the core is well designed: byte-exact write-back, snapshot undo, the sandbox and the sync merge are all careful. But interactive artboards are not handled, one stated offline claim is wrong against the Design type's own rules, and the pull/push loop, the part that makes the tool usable, is built last.

---

## TL;DR for Ron

The plan is solid. Its write-back core, its security model and its push guards are some of the most carefully argued parts of any plan here, and nothing in it is built on a misreading of the system. I checked it against the Design type's real `SKILL.md`, `format.md` and `view-state.md` and against the Artifact tool's contract, and they back the load-bearing claims: inline `style` is what the properties panel edits, all UI is `<x-dc>` markup, the `tid:path` addressing exists, and the publish refuses stale files.

The biggest risk is interactive artboards. The editor puts an event shield over the canvas, and every structural op, text commit and undo reloads the iframe. So any element that only shows after a click (a tab, an open menu, an `<sc-if>` branch) can never be reached, and reaching it some other way would reset it on the next reload. Two smaller problems: offline editing silently loses Google Fonts, which the type explicitly allows, and the pull/push loop only arrives at M6, so a slip in M3–M5 squeezes the one milestone without which nothing ships.

Ship with changes: fold in the three majors (each is a paragraph-sized edit) before M1 starts.

---

## Strengths

- **Write-back is designed for byte-exactness end to end** (Architecture › Writer, Cross-platform › Bytes): it uses `Buffer` I/O, keeps the BOM, uses the file's dominant line ending, applies all patches in one `magic-string` pass, and runs a re-parse shape check before any write. The golden corpus has LF/CRLF/mixed/BOM variants of every fixture. "Zero-byte diff" is tested, not just hoped for.
- **Snapshot undo with stored id maps** (Architecture › Undo) avoids the usual inverse-op bugs. Byte-identical undo holds by construction, and an outside change drops only that file's history.
- **The security model holds up** (Scripts and trust). An opaque-origin sandbox runs on a second port. A capability-URL prefix protects the read-only listener, because `Origin: null` is forgeable. The API keeps a strict Host/Origin allowlist plus a token, and the token never reaches `/project/*`. This matches the Design type's own rule that canvas content "runs ONLY inside the editor's sandboxed preview iframe" (`format.md`).
- **Push is guarded in depth** (Pull / push steps 1–5): a lease-based lock with the editor as heartbeat, three-way classification against a real synced commit, `git merge-file` that stops on conflict, a parse check after merging, one publish call, and a commit built from the bytes actually sent. The `edsync` CLI keeps all of this deterministic and testable.
- **The canvas branch matches the real format.** I checked against the type's docs: inline `style` is "what the properties panel edits", "all UI is `<x-dc>` markup, never script-built", and the `tid`/`path` addressing the ids fallback relies on is documented in `view-state.md`. Treating `{{hole}}`, `<dc-import>` and `canvas.json` as read-only follows those rules.
- **The M0 branches are fixed before the spike runs**, and the two-hour go/no-go gate stops the team from spending a day on a dead format.

## Concerns

### [major] Interactive artboards: state the editor cannot reach and reloads that reset it — §Architecture (Scripts and trust, Undo), §M1
**In plain words:** Many canvases are little apps: click a tab and a different panel shows. In this editor every click lands on the editor's own transparent layer and never reaches the design, so Ron can never open that tab to edit what is inside it. Even if he could, the next undo or text edit reloads the design and snaps it back to its starting state.
**What:** The canvas has a "transparent event shield" (M1), so pointer events never reach the artboard's handlers. Structural ops, text commits and *every* canvas undo/redo "write the file and reload the iframe", restoring "selection, scroll and zoom" by edId (Undo; Scripts and trust (b)). The runtime is a React class component with `state`/`setState` (`format.md`: "Interactive selected-states … keep the selection in `state`"; `<sc-if value="{{cond}}">` branches). Two consequences follow:
(1) Elements in any non-initial state (a false `<sc-if>` branch, a clicked tab, a multi-screen flow in one artboard, which `format.md` names as the house pattern) are not rendered, so they cannot be hit-tested, measured or edited, and the M2 "interactive artboard" check only covers text-edit cancellation.
(2) Any reload resets `state`, so the restore-by-edId the plan promises fails exactly when the edited element lived in a non-default state. Undo of a plain `setDecl` also reloads, so on a canvas every Cmd-Z is a full runtime reboot and a flash. The plan has no interact or preview mode, and it does not name "non-initial states are not editable" as a non-goal.
**Why it matters:** Ron's canvases include interactive ones (the plan's own M2 test assumes one), and `is_interactive` artboards and single-artboard flows are first-class in the type. Without a decision, M1 ships a canvas where part of the design is invisible to the editor, and M2–M5 build on it.
**Best-practice options:**
1. **An Interact toggle plus honest reload rules (pick this).** *Plain words: a switch, or a held key, that lets clicks go through to the design so Ron can open the tab he wants, then edit what shows.* While it is on, the shield passes pointer events through and selection is paused. After a reload the editor shows "page reset to its first state" when the restored edId is no longer rendered, instead of failing silently. Undo of an entry that only touched one inline `style` re-applies the pre-image declarations as an optimistic preview (the same path as `setDecl`) and skips the reload; the ack-vs-live check still guards it. Visual builders draw the same line: Webflow's Designer has a separate Preview mode where interactive elements work but elements cannot be selected or edited (Webflow Help, "Preview mode", https://help.webflow.com/hc/en-us/articles/40881969908627, and its canvas overview, https://help.webflow.com/hc/en-us/articles/33961319255059). Drupal Experience Builder's iframe preview issue settles on "some kind of toggle between 'interactive' and 'editing' mode" ("Implement a different approach to the iFrame preview interactions", https://git.drupalcode.org/project/experience_builder/-/work_items/3475759). About ½ day in M1, plus a little in M2 for style-only undo.
2. **Force branches open with the type's own hints.** *Plain words: render every hidden branch as if it were showing.* Serve the artboard with `<sc-if>` evaluated at its `hint-placeholder-val`. This is cheap, but it shows a state the design never really has, and it breaks "preview = disk".
3. **Declare it a non-goal.** *Plain words: say plainly that v1 edits only what an artboard shows when it first loads.* No cost, but part of every interactive canvas becomes source-only editing.

### [major] "Works without a network" is not true for canvases that use Google Fonts — §Pull / push step 3, §M0
**In plain words:** Claude's designs usually load their fonts from Google's servers, and the plan never saves those fonts locally. Offline, the editor quietly falls back to a different font, so text wraps differently and every size or spacing Ron tunes is measured against the wrong letters.
**What:** The Design type's rules allow exactly one outside network use: "no network except a Google Fonts `css2` `<link>` in `<helmet>` and step 3's urls" (`SKILL.md`, Rules that bite; `format.md` adds font `<link>` lines to `<dc-import>`ed artboards). Pull step 3 caches `/_blob/*` and `support.js` and says "This is what makes 'works without a network' true" (M0). Google Fonts stylesheets and their `woff2` files are not cached. The CSP leaves `style-src`/`font-src` open, so fonts load online and fail silently offline. The per-milestone screenshot check runs online, so it never sees the difference.
**Why it matters:** Offline editing is one of the three stated reasons this editor exists (Goals, "Source control and offline"). A silent font swap breaks the precision tools (snapping, measure, Hug sizing) exactly when the network is gone, and Ron would push sizes tuned against the fallback font.
**Best-practice options:**
1. **Narrow the claim and show an offline font banner in v1; caching goes to Next (pick this; Ron is away, so take the conservative, shippable route).** *Plain words: tell the truth in the UI.* The serving layer knows which `<link href="https://fonts.googleapis.com/css2…">` lines each artboard has. When a font fails to load (`document.fonts` status via the probe), show "offline: Inter not loaded, layout may differ" and keep editing. Change the M0/Goals wording to "works offline except Google Fonts". About an hour.
2. **Cache the fonts at pull and rewrite at serve time.** *Plain words: download the fonts once, the way blobs are downloaded.* At pull, `edsync` fetches each `css2` URL (with a modern-browser `User-Agent`, so it gets `woff2`) and each font file into `.editor/cache/fonts/`. The serving layer rewrites the `<link>` and the CSS `src:` URLs to the project origin, in served bytes only, never on disk. This is the standard self-hosting recipe ("Self host Google fonts for better Core Web Vitals", https://www.corewebvitals.io/pagespeed/self-host-google-fonts; the google-webfonts-helper tool it recommends is archived as of 2026-02, https://github.com/mutdmour/google-webfonts-helper). About ½ day, and the `connect-src`/`font-src` policy must allow the project origin.

### [major] The usable loop (pull → edit → push) arrives last, so a slip squeezes the milestone v1 cannot ship without — §Milestones, §Effort
**In plain words:** Ron cannot use anything until the very last milestone, because pull and push are built last. If the fancy canvas tools run long, there is no time left for the one part that connects the editor to Claude Design, and the cut list only trims canvas features.
**What:** The order is M0 spike → M1 read-only → M2 write-back → M3 drag/snap → M4 Auto Layout → M5 tokens/structure → M6 `edsync` + skills. "v1 ships at the end of M6", and the cut order (layer actions, multi-edit, text-box trim) only trims M5/M2. M0 tests single remote behaviours by hand, but the integrated loop is first exercised on day ~12–14: the lease lock with a live editor, classification, `ingest`, the cache fetch, the publish `files` map and the two-pushes-in-a-row case. That loop carries the most outside risk: Artifact tool behaviour, the type release, and Save footprints. The estimates are tight for the scope as well. M1's 2–3 days covers the server, both listeners, the probe, zoom/pan, the full selection model, the layers panel, CI on two OSes and a mockup check. M0's two-hour gate needs a working serving layer with a cached `support.js` on a sandboxed second origin. The estimates also never say whose days they are (Ron's, or agent waves).
**Why it matters:** The riskiest integration is discovered last, and the cut rules protect M2's quality bar but not the loop. If M3–M5 overrun, v1 has polished canvas tools and no way to send the work back.
**Best-practice options:**
1. **Move M6 straight after M2, so the first thing built is a walking skeleton (pick this).** *Plain words: get one property edit all the way from Claude Design to the editor and back before building any fancy tools.* Order: M0 → M1 → M2 → M6 → M3 → M4 → M5. `edsync` only needs M2's Writer and the lock endpoints, and its tests use a fake remote anyway. Cockburn's walking skeleton is "a tiny implementation of the system that performs a small end-to-end function", built first because it "forces us to face the difficult infrastructural problem first while we still have time" (summarised at https://llm-coding.github.io/Semantic-Anchors/anchor/walking-skeleton; Freeman & Pryce's version: https://henricodolfing.com/2018/04/start-your-project-with-walking-skeleton.html). After this change, every M3–M5 cut leaves a shippable v1. It costs nothing in total days.
2. **Keep the order but put M6 on the never-cut list next to cross-platform work**, and say whose days the estimates count. This is cheaper to write, but the integration risk still lands at the end.

### [minor] The multi-artboard canvas is an unmade decision, and M0 asks a question the type docs already answer — §Architecture diagram, §M0 fallbacks, §M1
**In plain words:** A canvas holds many artboards side by side, but the plan draws one embedded page and never says how many it runs at once or what happens with twenty.
**What:** The diagram shows a single iframe. Each artboard is its own `.dc.html` with its own runtime, so a canvas view means N sandboxed iframes, each with a probe, its own `e.source` routing, and a reload rule scoped to one board. The plan doesn't say whether all boards mount or only those near the viewport (Claude Design itself "draws the ones near the view", `view-state.md`), how `pages` filter boards, or what width an `expand: "fill"` PAGE artboard gets. M0's fallback is triggered by "layout from `canvas.json` unclear", but `SKILL.md` already documents `boards` `{x,y,w,h}`, `order`, `pages` and `expand` exactly.
**Why it matters:** Probe routing, hit-testing across boards, memory with many runtimes, and the M3 snap rects all depend on it, and M1 has to pick something.
**Best-practice options:** No external pattern is needed; this is a local fix. **For v1, open one artboard at a time at its `boards[path]` `w×h` (PAGE: `w` wide, scrolling), with a board switcher that follows `order` and `pages` (pick this; it is the plan's own documented fallback, it is conservative, and every precision tool works inside one artboard).** Move the multi-board canvas, mounted only near the viewport, to the top of Next. Delete the "layout unclear" M0 question, which the docs already answer.

### [minor] Which tree the Layers panel shows on a canvas is undefined — §M1
**In plain words:** The layers list could show the design as written in the file, or as it looks after the page runs. The two differ, and the plan doesn't pick.
**What:** M1 says "Layers panel = DOM tree" (from R04's plain-HTML research). On a canvas the live DOM repeats `<sc-for>` children N times, omits false `<sc-if>` branches, never contains `<helmet>` or `<dc-import>` internals in source form, and may add runtime wrappers. Selection is per template node ("the N repeats share one id"), and Claude Design's own addressing is per template node (`view-state.md`: "Selection is per template node").
**Why it matters:** Two-way selection sync, drag-reorder in the layers list (M5) and hide/lock all need one stable tree. A live-DOM tree changes shape whenever runtime state changes.
**Best-practice options:** No external pattern applies. **Build the layers tree from `SourceIndex`'s template tree inside `<x-dc>` (one row per template node; `<sc-for>`/`<sc-if>` as labelled rows; `<dc-import>` as one read-only leaf; nodes not currently rendered shown dimmed) (pick this: it matches the id model and Claude Design's addressing).**

### [minor] The asset and `support.js` fetch skips the scratchpad hand-off the plan designed for snapshots — §Pull / push (Hand-off contract, pull step 3, push step 3)
**In plain words:** The plan routes downloaded design files through a temporary folder so Claude Code never stops to ask permission, but it sends images, fonts and the runtime straight into the project, which does ask. An unattended pull would stall.
**What:** The hand-off contract rightly reads the snapshot into the Artifact tool's default scratchpad, because "an `out_dir` into the project would ask Ron on every save". But pull step 3 and push step 3 fetch every `/_blob/<id>` and `support.js` "through the Artifact tool into `.editor/cache/`". The Artifact tool's contract says saving an asset outside its default folder "is an ordinary file save the person may be asked to approve". No `edsync` verb moves fetched files from the scratchpad into the cache. Blobs can also be `.css`/`.js` (`SKILL.md` step 3) that reference other `/_blob` ids or fonts, so the fetch list must be transitive.
**Why it matters:** Pulls stall on approval prompts (one per blob), or the cache stays incomplete and offline rendering breaks.
**Best-practice options:** This is local to the Artifact tool, and no external pattern is relevant. **Fetch blobs and `support.js` into the scratchpad like the snapshot, then run a new `edsync cache --from <dir>` verb that copies them into `.editor/cache/`, scans fetched CSS/JS for further `/_blob/` and `url()` references, and prints the next round to fetch until nothing new appears (pick this).** Add it to the CLI test list.

### [minor] Canvas scripts can impersonate the probe — §Architecture (Scripts and trust)
**In plain words:** The design's own code runs in the same page as the editor's helper script, so it can send the editor messages that look like they came from the helper.
**What:** The editor accepts a message when `e.source === iframe.contentWindow && e.origin === 'null'`. Every project script in that frame passes both checks. Schema validation stops malformed payloads, not well-formed forged ones, such as a fake text commit or fake rects that steer a drag. The plan itself quotes the type calling canvas content "untrusted cross-user input".
**Why it matters:** The impact is limited (writes land only in the same project's spliceable ranges, and the non-goals exclude other people's canvases), but a forged commit would be written, and pushed if Ron didn't spot it.
**Best-practice options:**
1. **Use a private `MessageChannel` port captured at probe boot (pick this).** *Plain words: give the helper its own private line that the page's scripts never get.* The probe is injected as the first script in `<head>`, before `./support.js`. On iframe load the editor transfers one port of a `MessageChannel` to it, and from then on the editor accepts nothing on `window` `message` except that handshake. MDN: channel messaging "can provide a secure channel … between different browsing contexts", where the port acts as a capability ("Using channel messaging", https://developer.mozilla.org/en-US/docs/Web/API/Channel_Messaging_API/Using_channel_messaging). Also, accept a text commit only for an edit session the editor itself opened. About two hours.
2. **Leave it, and record it as an accepted risk under Non-goals ("own canvases only").**

### [minor] The kill-bar shrink rule is ambiguous and drops the likely differentiators — §Goals (Kill bar)
**In plain words:** The rule for cutting scope after M0 can be read as also dropping pull/push, and it cuts features based on whether one unrelated feature exists.
**What:** "If M0 finds snapping or measure already built in, shrink v1 to 'git-sync + precision tools' (M1-M3 plus whatever precision tools are still missing)". The parenthetical lists M1–M3 and leaves out M6, which *is* git-sync. It also drops M4/M5 because snapping exists, even when M0 finds Hug/Fill/Fixed or token binding missing, which are the gaps the plan itself calls this editor's reason to exist.
**Why it matters:** An agent applying the rule "mechanically … with no pause for an answer" could cut M6 or cut the wrong features while Ron is away.
**Best-practice options:** No external pattern applies; this is a local wording fix. **Make the rule subtract per feature: whatever M0 finds built in moves to Non-goals; M1, M2 and M6 are always kept; stop only if none of snapping, measure, Auto Layout handles, Hug/Fill/Fixed, token binding, git diffs or offline survives (pick this).**

### [nit] The probe's CSP nonce does nothing — §Architecture (Scripts and trust)
**In plain words:** The plan gives the helper script a one-time pass for a security rule that the plan never turns on.
**What:** The `/project/*` CSP is `sandbox allow-scripts; frame-ancestors …; connect-src …`, and the plan says it "sets no `script-src` restriction". Without `script-src` (or `default-src`), a nonce has no effect. Adding a nonce-source later would also block the un-nonced `data-dc-script` block and `support.js`.
**Why it matters:** It confuses implementers, who may add a `script-src` "to make the nonce work" and break every canvas.
**Best-practice options:** This is a local fix. **Drop the nonce and the nonce-stripping step, and keep the sentence that no `script-src` is set (pick this).**

### [nit] The M0 partial-publish question is already answered by the tool contract — §M0, §Pull / push (Two guards)
**In plain words:** The spike plans to test something the tool's own documentation already states.
**What:** The Artifact tool's publish contract says that, apart from `overwrite_unread`, every path a call touches must have been read and "must not have changed since — otherwise nothing is sent and the refusal names each path". The publish is all-or-nothing by contract.
**Why it matters:** It is a small waste of M0's tight day.
**Best-practice options:** This is a local fix. **Record the documented behaviour in `06` and keep only a one-line confirmation in M0 (pick this).**

---

## Decisions Ron needs to make

1. **Interactive artboards in v1** — (a) an Interact toggle (held key or switch) that passes clicks to the design, a "page reset" notice after reloads, and style-only undo without a reload; (b) render branches at their `hint-placeholder-val`; (c) declare non-initial states a non-goal. Recommendation: **(a)**, about ½ day in M1.
2. **Google Fonts when offline** — (a) narrow the offline claim and show a "font not loaded" banner; (b) cache `css2` and `woff2` at pull and rewrite at serve time. Recommendation: **(a) for v1, (b) in Next** (the conservative choice while Ron is away).
3. **Milestone order** — (a) M0 → M1 → M2 → M6 → M3 → M4 → M5 (walking skeleton); (b) keep the order and put M6 on the never-cut list. Recommendation: **(a)**; it adds no days.
4. **Canvas view in v1** — (a) one artboard at a time with a board/page switcher; (b) all boards as lazily mounted iframes. Recommendation: **(a)**, with (b) first in Next.
5. **Layers tree source on canvases** — (a) the source template tree from `SourceIndex`; (b) the live DOM tree. Recommendation: **(a)**.
6. **Kill-bar shrink rule** — (a) per-feature subtraction, M1/M2/M6 always kept; (b) the current wording. Recommendation: **(a)**.
7. **Probe channel hardening** — (a) a `MessageChannel` port captured at probe boot, with text commits accepted only for editor-opened sessions; (b) accepted risk. Recommendation: **(a)**, about two hours.
8. **Asset cache fetch path** — (a) fetch into the scratchpad, then a new `edsync cache --from <dir>` verb with transitive scanning; (b) fetch straight into `.editor/cache/` and accept approval prompts. Recommendation: **(a)**.

---

## Verdict

**Ship after addressing blockers** — there are no blockers. The three majors (interactive state, offline fonts, building M6 earlier) are paragraph-sized plan edits that should go in before M1 starts, and they do not need another full review round.
