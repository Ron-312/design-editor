# Critic v5 — Design Editor — v1 plan

**Plan reviewed:** plan.md
**Date:** 2026-11-23
**Score:** 7/10 — the architecture is right and most hard calls are made, but the second-origin sandbox will not start on Ron's Mac as written, the runtime fallback cannot work for Design canvases, and the schedule is too small for the scope.

---

## TL;DR for Ron

The plan is solid. The core idea holds up: the files are the document, edits are tiny splices, undo uses file snapshots, and push runs a three-way merge. Its biggest strength is that nearly every risky choice is already decided and tested: the canvas branch, the write targets, push locking, conflict handling and the kill bar. Its biggest risk is two wrong assumptions that M0/M1 would hit on day one. First, the project frame is served from `127.0.0.2`, and macOS does not have that address unless you add it with sudo. Second, the "static preview" fallback for when the canvas runtime will not run cannot fill `{{hole}}` values or `<sc-for>` repeats, because those come from the canvas's own script. Both are small text fixes. Separately, 10–12 days is optimistic for this much work, and the plan should say now what gets cut. Revise those three points, then execute.

---

## Strengths

- **Source-first mapping with server-owned ids** (§Architecture, Sandboxed iframe). Ids are allocated once, carried through every patch and never re-derived from position. This avoids the most common way write-back editors drift.
- **Snapshot undo instead of inverse ops** (§Undo). A byte-identical undo comes from how it is built, and no op kind needs its own inverse. That is much safer than the inverse-patch idea in R00.
- **Canvas branch chosen from the type's real format** (§M0). I checked the plan's claims against the Design type's `SKILL.md` and `reference/format.md`, and they hold: inline `style` is what the properties panel edits, `<helmet><style>` holds page basics, the format has `{{hole}}` / `<sc-for>` / `<dc-import>`, `canvas.json` boards, the `./support.js` head line, and canvas content is "untrusted cross-user input" that runs only in a sandboxed frame. The plan builds the cascade resolver and `SharedCounter` only on the fallback branch. That is good scoping.
- **Push model** (§Pull / push, steps 3–5). A one-sided change moves across and only a change on both sides is a conflict (the Unison model). The baseline moves on every push, and `git merge-file` stops on conflict. Together these are a correct, simple sync design.
- **Clear kill bar** (§Goals), fixed before M0 runs, with a defined re-scope.
- **Writer shape check** (§Writer) catches parser fix-ups (`p` auto-close, foster-parenting) before a structural write lands.

## Concerns

### [major] The second origin `127.0.0.2` does not exist on macOS by default  — §Architecture (Scripts and trust), §Stack
**In plain words:** The plan isolates the project in a second web "address" so its scripts can't touch the editor. It picks `127.0.0.2` as that address. On a Mac, only `127.0.0.1` works out of the box, so the server can't listen on `127.0.0.2` and the canvas never loads.
**What:** §Scripts and trust says `/project/*` is served from `127.0.0.2:<port>`, "the same server". On Darwin, loopback addresses other than 127.0.0.1 are disabled until `sudo ifconfig lo0 alias 127.0.0.2` is run, and the alias is lost on reboot. Binding fails with `EADDRNOTAVAIL` ("Can't assign requested address"). Ron is on macOS (the environment is darwin), and the plan nowhere mentions the alias. The CSP `sandbox` header and the iframe `sandbox` attribute already give the frame an opaque origin. The second origin is defence in depth for direct navigation, so the fix is cheap, but as written M1 fails on start.
**Why it matters:** M1 (the first build milestone) cannot open a canvas. If the fix is a sudo alias, the tool needs a system network change on every reboot, which counts as modifying system settings and is fragile.
**Best-practice options:**
- **Option A — second port on 127.0.0.1 (e.g. `127.0.0.1:5301`)**: the same Node process opens a second listener. Origin = scheme + host + port, so a different port is a different origin. It works in every browser with no DNS and no sudo. Tradeoff: the Host/Origin allowlist gets a second exact entry, and the "one port" Vite note applies only to the editor port. **Pick this**: it is the smallest change and works everywhere, including Playwright WebKit/Firefox.
- Option B — a `project.localhost:5300` subdomain. Chrome and Edge resolve `*.localhost` to loopback and treat it as a secure context, but Firefox and Safari support it less reliably. Tradeoff: tied to the browser. Source: web.dev, "When to use HTTPS for local development" — https://web.dev/articles/when-to-use-local-https
- Option C — keep `127.0.0.2` and add the `lo0` alias (sudo, plus a LaunchDaemon to make it survive reboots). Tradeoff: a system change for a localhost tool; HashiCorp recommends it for testing only. Sources: Hashrocket TIL, "Loopback to different 127 IPs on Mac OS X" — https://til.hashrocket.com/posts/94a6225fad-loopback-to-different-127-ips-mac-osx ; HashiCorp, "Run multiple Vault instances from your MacOS … loopback alias" — https://support.hashicorp.com/hc/en-us/articles/5976755662739

### [major] The "static preview" runtime fallback cannot render a Design canvas  — §M0 (Design canvas fallbacks)
**In plain words:** If the canvas's own script won't run in the editor, the plan says to show a static copy with the blanks filled from their default values. But in this format the blanks are filled by the canvas's script, not by the defaults, and lists only appear when that script runs. So the fallback shows a broken page.
**What:** The fallback reads "render a static preview of the artboard with `{{hole}}` filled from its `data-props` defaults". The Design type's `format.md` says holes are "a dotted lookup into `renderVals()` only", that `default` "seeds the editor only — fall back with `this.props.x ?? …` in `renderVals()`", and that `<sc-for list="{{ items }}">` gets its list from `renderVals()`. The runtime is a React-style class component (`DCLogic`, `state`/`setState`, React lifecycle, `className` mapping). Without running it, holes computed in `renderVals()` have no value, `<sc-for>` has no list, `<sc-if>` has no condition, and `<dc-import>` children never mount. The "pass/fail" fallback is therefore not a working path. The most likely cause of failure is also the sandbox the plan itself imposes: an opaque origin makes `localStorage`/IndexedDB/cookies unavailable, so any runtime that touches storage or expects its host app as `parent` can throw.
**Why it matters:** M0's go/no-go treats this case as "covered". If it fires, M1 starts on a fallback that cannot render the project, and the problem only shows up after building.
**Best-practice options:**
- **Option A — test the runtime under the exact target sandbox first, shim what it needs, and otherwise stop.** In M0, serve one artboard under `sandbox allow-scripts` with an opaque origin, CSP and the probe, and watch the console. If it fails on storage or host messaging, inject a small shim before `support.js` (an in-memory `localStorage`, a no-op host bridge). If it still fails, use the existing "Anything else → stop; re-plan" branch. Drop the static preview. **Pick this**: it tests the real failure mode and never builds on a preview that misrepresents the page. Source: MDN, `<iframe>` `sandbox` — without `allow-same-origin` the frame "always fails the same-origin policy (potentially preventing access to data storage/cookies and some JavaScript APIs)" — https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- Option B — keep a static preview but evaluate only the `data-dc-script` class in a throwaway worker to get `renderVals()` output. Tradeoff: this re-implements part of the runtime (state, lifecycle, `<dc-import>` resolution), which is effort the plan cannot afford. No external pattern fits better; this is local to the Design format.

### [major] The 10–12 day estimate does not match the scope, and there is no cut line besides M5 layer actions  — §Effort, §M1, §M5
**In plain words:** The schedule is much shorter than the work it covers. Because the only planned cut comes late, an overrun would land on the riskiest parts.
**What:** M1 (1–2 days) covers the server, SourceIndex, a serving transform, a two-origin sandbox with an injected probe that batches async reads per frame over postMessage (the plan itself adds "+1 day" here), the Vite middleware setup, zoom/pan, a shared hit-test with eight selection gestures, a layers panel with two-way sync and a properties panel with a selector chip. M5 (2 days) covers the token picker, five layer actions with HTML content-model validation while dragging, copy/paste style, hide/lock and a per-file diff panel with revert. M6 (1 day) covers two skills with a lock handshake, a three-way merge, conflict UI and the multi-push test. Each of these is typically several days on its own. §Effort names one cut (M5 layer actions), and M5 comes after M2–M4 have already used up the time.
**Why it matters:** The plan says M2 quality must not be cut. With no early cut line, the likely result is M6 (the reason the tool exists: sync) arriving late or rushed.
**Best-practice options:** No external pattern beyond normal scope control applies. Local fix:
- **Option A — order the milestones by the kill bar's own value list and set the cut line now.** v1 = M0–M3 + M6 ("git-sync + precision tools", already defined as the fallback scope in §Goals); M4 and M5 are stretch goals. Re-estimate M1 at 3–4 days with the probe/sandbox split out as its own item. **Pick this**: the kill bar already defines this smaller product, so make it the plan and treat the rest as upside.
- Option B — keep the scope and re-estimate honestly (about 18–22 days), stating per-milestone budgets and a checkpoint after M2. Tradeoff: more honest but delays the first full loop.

### [minor] Push has no rule for a publish refused between its re-read and its send  — §Pull / push (steps 2–5)
**In plain words:** Someone can save in Claude Design in the seconds between push checking the remote and push sending. The tool will refuse the send, but the plan doesn't say what push does next.
**What:** The plan correctly says the Artifact publish refuses relative to what this session last read. Neither the push steps nor the M6 exit criteria say what happens on that refusal: whether to retry from step 2, and whether the baseline commit and `base.json` rewrite (step 5) are skipped. The Design type's `SKILL.md` describes the refusal ("names the file to re-read") and its own policy: redo, and after a third refusal "tell the user and stop".
**Why it matters:** A half-handled refusal could commit a "synced" baseline that the remote never accepted. The next push would then merge against the wrong base.
**Best-practice options:**
- **Option A — make step 5 conditional on a successful publish; on refusal, loop back to step 2 (re-read, re-classify, re-merge) up to 2 times, then stop with nothing committed.** Add one M6 test that edits remotely between step 2 and the publish. **Pick this**: it matches the platform's own documented retry policy. Source: Design artifact type `SKILL.md`, §Revising a canvas, step 4 (read via the Artifact tool, type https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd).

### [minor] `.editor/` is partly tracked in the project repo, so editor UI state pollutes the git diff  — §Editor-only state, §Pull step 2–4
**In plain words:** The editor saves things like zoom level and collapsed layers in a file inside the project folder. If git tracks that file, just looking around changes the diff, which breaks the promise that an untouched session gives an empty diff.
**What:** Only `.editor/cache/` is listed as git-ignored. `.editor/state.json` (hide, lock, collapse, zoom), `base.json`, `server.json`, `push.lock` and `push.ready` all live in `projects/<slug>/.editor/`. Goal 2's zero-byte diff and "git diff shows only what changed" are then false whenever the zoom changes, and step 5's "commit the synced state" may sweep in lock or ready files.
**Why it matters:** Noisy diffs and accidental commits of lock files. Small, but it directly undercuts a stated goal.
**Best-practice options:** Local fix, no external pattern needed:
- **Option A — git-ignore all of `.editor/` in each project repo, written at `git init` in pull step 2.** The synced commit itself is the baseline, and `base.json` only needs to be local. **Pick this**: it is one line and it makes Goal 2 true.
- Option B — keep `base.json` tracked and ignore the rest. Tradeoff: a `base.json` change on every push adds churn to the history.

### [minor] The id-mapping fallback should reuse the Design type's documented `tid:path` scheme  — §M0 fallbacks (ids stripped by template expansion)
**In plain words:** Claude Design already has a precise, written-down rule for numbering elements in a canvas. Using the same rule costs nothing and lets this editor and Claude Design agree on which element is meant.
**What:** The fallback says "map back by source-order path inside `<x-dc>`". The type's `reference/view-state.md` defines exactly that: `tid` = depth-first element index between `<x-dc>` and the last `</x-dc>`, counting `<helmet>` and its children, `<sc-for>`, `<sc-if>` and `<dc-import>`, plus a child-index `path`. It also says one entry per `<sc-for>` template node, and that a click inside a `<dc-import>` selects the import element. The plan's decisions match that behaviour but leave the numbering unspecified.
**Why it matters:** Two slightly different path schemes are a source of off-by-one bugs (for example, whether `<helmet>` counts). Matching the platform also makes a later "Ask Claude about this element" feature possible.
**Best-practice options:**
- **Option A — adopt `view-state.md`'s `tid:path` numbering verbatim as the fallback key, and add a golden test using its worked example.** In that example, `<helmet>` is `0:0` and the `<div>` inside `<sc-for>` is `5:1/1/0`. **Pick this**: zero design cost and the rule is already specified. Source: Design artifact type `reference/view-state.md` (type https://claude.ai/artifact/QKN21svewxgyPb6SYRqWnd).

### [nit] Probe messages can be forged by the canvas's own scripts  — §Scripts and trust
**In plain words:** The editor trusts messages that come "from the frame", but the canvas's scripts run in that same frame and can send look-alike messages.
**What:** `e.source === iframe.contentWindow && e.origin === 'null'` is true for any script in the frame, not only the probe. Schema validation limits the damage, but a text commit or an ack-vs-live value could be faked. Only Ron's own canvases run scripts, so the risk is low.
**Why it matters:** It is defence in depth for a frame the Design type itself calls untrusted.
**Best-practice options:**
- **Option A — the probe, injected as the first script in `<head>`, creates a `MessageChannel`, posts `port2` to the parent once, and keeps `port1` in a closure; the editor accepts only the first port and ignores window messages after that.** **Pick this**: a page script cannot reach a closure-held port. Source: MDN, "Using channel messaging" — https://developer.mozilla.org/en-US/docs/Web/API/Channel_Messaging_API/Using_channel_messaging

### [nit] Small internal contradictions  — §Goals, §M0, §Open questions
**In plain words:** A few sentences disagree with each other, which will confuse whoever builds from the plan.
**What:** (1) §Goals says "Claude Design's own Artifact version history covers whole-page rollback", but the next paragraph says the built-in editor is documented to have "no version history". (2) M0 is "½ day" in its heading but "takes minutes" in its exit. (3) Open question 1 justifies the project choice by "shared-rule targeting, cross-file indexing", which the canvas branch does not build.
**Why it matters:** These are minor, but the plan is long and each one invites a wrong reading.
**Best-practice options:** Local fix: keep "Artifact versions exist (whole snapshots); M0 records what they offer", call M0 ½ day, and trim open question 1 to the canvas rationale.

---

## Decisions Ron needs to make

1. **Second origin for the project frame** — a second port on 127.0.0.1 (works everywhere, no sudo), a `*.localhost` subdomain (Chrome/Edge only), or the `127.0.0.2` alias (sudo, lost on reboot). Recommendation: a second port, e.g. `127.0.0.1:5301`.
2. **What happens if the canvas runtime won't run sandboxed** — shim storage and host APIs and then stop/re-plan if it still fails, or build a partial `renderVals()` evaluator for a static preview. Recommendation: shim, then stop; drop the static preview.
3. **v1 cut line** — make v1 = M0–M3 + M6 with M4/M5 as stretch, or keep the full scope and re-estimate at about 18–22 days. Recommendation: M0–M3 + M6 now, M4/M5 as stretch.
4. **Push behaviour on a refused publish** — retry from step 2 up to 2 times then stop with nothing committed, or stop immediately. Recommendation: retry twice, then stop; commit the baseline only after a successful publish.
5. **What in `.editor/` git tracks** — ignore all of it, or track `base.json` only. Recommendation: ignore all of `.editor/`.

---

## Verdict

**Revise & re-review** — the approach is right, but the sandbox origin and the runtime fallback are both wrong for this platform and format, and the schedule needs a cut line; all three are short edits, so one more quick pass should clear it.
