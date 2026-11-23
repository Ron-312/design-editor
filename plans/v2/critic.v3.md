# Critic v3 — Design Editor v2 — the Figma features people reach for next

**Plan reviewed:** plans/v2/plan.md
**Date:** 2026-11-23
**Score:** 6/10 — the feature choice and most decisions are right, but several load-bearing contract changes run into code the plan has not read: the PatchEngine cannot batch multi-declaration edits, superseded acks raise false "different value" reloads, and `insertHtml` as specified is silently dropped by the validator.

---

## TL;DR for Ron

The plan picks the right features, keeps them honest to HTML/CSS, and the contract-first order is the right shape. Many of the hard edge cases are already decided well: keyboard layouts, paste safety, Electron select-all, and the preview-width scope. The biggest risk is that the plan assumes the edit pipeline can take what v2 sends it, and it cannot. I ran the real PatchEngine. When one flush removes the last two declarations of a style list, it throws "overlapping patches". When it removes the only declaration and appends another, it writes `style="; …"`. Radius join/split, Alt-Shift-A, text resizing and line-clamp removal all hit this. Separately, the drag model in contract #6 (call `apply` repeatedly) makes every superseded op's ack fail the UI's preview check. Each one then shows a warning toast and reloads the frame. Fix these, and the `insertHtml` routing and held-arrow undo gaps, in the contract stage before any feature work. After that it is ready to build, so **revise and re-review**, without rethinking the approach.

---

## Strengths

- **Contract changes first** (§Contract changes): registry aliases and scopes, the `insertHtml`/`removeAttr` ops, action ids and editor-state setters all land before the features that use them. This matches v1's plugin-registry design.
- **Keyboard matching rule** (§Contract #1, §Testing): key first for ASCII letters and digits, code fallback otherwise, named keys on `key`. It is argued correctly against AZERTY, QWERTZ and Hebrew, with concrete `KeyboardEvent` fixtures, and it fixes v1's Option-composed Mod-Alt-C/V bug.
- **Paste safety** (§Contract #2): the parse5 allow-list runs on the server, the private MIME type is not trusted as proof of origin, ids are stripped the way `copyWithoutIds` strips them, and data-bound copies are refused, with Duplicate offered instead. All of this is sound.
- **Undo by action, not by timer** (§Contract #3): tying entries to an `actionId` and folding same-id flushes in `UndoLog.record` is the right model (tldraw's marks/squash), and the merge rules (earliest pre-image, latest `postWriteHash`) fit the snapshot-based `UndoLog`.
- **Electron select-all** (§M8 #2): the cancelable-event round trip correctly handles the fact that `role: 'selectAll'` ignores `click` (`src/desktop/main.ts:108`) without adding a preload.
- **Preview width** (§M11 #8): it is view-only, saved with zoom and pan, labelled "375 preview", and shows a persistent "Edits apply to all widths" bar. That handles the main way it could mislead.
- **Verified claims:** `tokenValue` at `fields.tsx:331`, `data-layer-name` first in `template-tree.ts:62`, Shift-1/2 at `CanvasView.tsx:426-427`, `isOnCanvas` in `move.tool.ts:449` and the root refusal in `planStructural` all match the code.

## Concerns

### [major] The PatchEngine cannot apply multi-declaration edits in one flush  — §Contract #3, §M10 #2/#6/#8
**In plain words:** v2 adds many buttons that change several CSS properties at once, such as joining four corner radii into one or removing auto layout. The engine that writes the file breaks when those changes arrive together. It either refuses the whole edit or leaves a stray `;` in the file.
**What:** `Flush` plans every op against the original text and refuses overlapping splices (`patch-engine.ts` `orderedSplices`). `removeDeclarationSplice` takes `[decl.start, next.start)` for a non-last declaration and `[previous.end, decl.end)` for the last one, so removing the last **two** declarations of a list in one flush produces overlapping ranges. I ran the real engine:
- `color: red; display: flex; gap: 8px`, removing `display` and `gap` → `THROW overlapping patches` (a plain `Error`, so the Writer rejects the whole batch)
- `display: flex; gap: 8px`, removing both → same throw
- `border-radius: 4px`, removing it and setting two longhands → `style="; border-top-left-radius: 4px; border-top-right-radius: 4px"`

v1 avoids this only because `layout.section.tsx:applyWrites` awaits each op's ack, so each op is its own 300 ms flush (and its own undo entry). v2 makes batching the norm: one `actionId` per command, M9 #2 sends many ops synchronously, and the radius join, Alt-Shift-A, text resizing mode and line-clamp removal are all multi-declaration. The plan's "every new write has a byte-exact test" will find this, but only after the features are built on top of it.
**Why it matters:** Common commands fail with an internal error, or they break goal 4 (byte-exact write-back). The workaround (serial awaits) costs 300 ms per property and writes intermediate states to disk, which edsync and the watcher see.
**Best-practice options:**
1. **Coalesce per declaration list:** in `Flush`, group every declaration op that targets the same list (one inline `style` attribute or one rule), compute the final list, and emit **one** splice from the first changed declaration to the last, reusing the existing separators (`separatorsOf`). *Plain words: work out the finished style first, then write it once, instead of making several small cuts that collide.* This is the same idea as magic-string's guidance that edits must not overlap within one pass (magic-string README, https://unpkg.com/magic-string@1.4.2/README.md). It is local to `patch-engine.ts`/`text-splice.ts` and fixes every v2 caller at once. **Pick this:** it is the only option that keeps one write per action and byte-exact output.
2. **Make removals merge-aware:** keep per-op splices but have `removeDeclarationSplice` absorb a neighbour already being removed, and make `appendDeclarationSplice` aware that the list will be empty. *Plain words: teach each cut about the others.* Smaller change, but each pairing is its own edge case.
3. **Serialize in the UI (v1's approach):** every multi-property action awaits each op. *Plain words: send them one at a time.* No engine change, but 300 ms per property, intermediate files on disk, and it relies on contract #3 folding to keep one undo entry.

No external pattern fits more closely than this: the fix is local to the engine.

### [major] Superseded ops make the UI report a false "different value" and reload the frame  — §Contract #6, §M10 #1, §Contract #3
**In plain words:** The plan wants a colour drag or a typing burst to send many edits and let the server keep only the last. But the browser side checks each edit's reply against what that edit showed. Every earlier edit will "disagree", so the user sees a warning and the canvas flickers.
**What:** `Writer.acks` sends one ack per superseded `opId`, each carrying the **final** `resolved` value (`writer.ts`, `withOp` + `acks`). `ws-client.ts:settleAck` compares each op's own `previewed` value with `ack.resolved`, and on mismatch toasts "The saved file shows a different value than the preview; reloaded from disk" and calls `reloadFrame()`. It also calls `store.addRecord(ack.record)` once per superseded opId, so the diff panel gets duplicate records. Contract #6 says "a drag calls `apply` repeatedly under one id and the Writer merges the superseded values". M10 #1 says the same drag "commits once on release", which contradicts that: repeated `apply` writes the file whenever the pointer pauses for more than 300 ms. A held-arrow nudge already takes this path in v1, and no test covers superseded acks.
**Why it matters:** The flagship v2 interactions (colour square, scrubbing, held nudges) would toast and reload on every pause or release. Escape during a colour drag also cannot cancel writes that have already landed.
**Best-practice options:**
1. **Preview-only API for continuous gestures:** expose the probe's existing `previewDecl` as `ctx.preview(op)` and call `apply` once on release (cancel = re-preview the original). *Plain words: show changes live but save only when the user lets go.* This is tldraw's split between an interaction and its history mark, where Escape uses `bailToMark` (tldraw History, https://tldraw.dev/sdk-features/history). **Pick this for drags:** one write, one ack, a clean cancel, and it matches M10 #1's "commits once on release".
2. **Only the newest op per supersede key is checked:** the client compares `previewed` only for the most recent pending op with that target+prop, and treats acks of older superseded ops as confirmations. *Plain words: ignore replies to edits that were already replaced.* This is Replicache's model, where confirmed mutations are dropped and only pending ones are replayed (Replicache "How it works", https://doc.replicache.dev/concepts/how-it-works). **Do this as well**, because typing and held arrows still send several ops.
3. Server acks a superseded opId with a `superseded: true` flag and no `record`. *Plain words: the server says "replaced" instead of reporting a value.* Clean, but a protocol change.

### [major] `insertHtml` with `target: []` is dropped by the validator and cannot be routed by the Writer  — §Contract #2, §Contract #6
**In plain words:** The paste operation is designed with an empty target list, but the server throws away any edit with an empty target without replying. Paste would silently do nothing and the UI would wait forever.
**What:** `client-message.ts:isEditOp` returns false when `value.target.length === 0`, so `parseClientMessage` returns `null` and the message is dropped with no `rejected` reply. The `ack` promise in `ws-client` then never settles. Even past the validator, `Writer.submit` finds the file with `this.ownerOf(op.target[0])`, so it would answer "that layer is gone". `Flush.record`, `elementScope` and `announceRestored` also key off `op.target`/`record.target`. Contract #6 lists only "`PAYLOAD_CHECKS` gains `insertHtml`".
**Why it matters:** M8 #4 (paste, and cut-then-undo) is a Goal 1 feature, and it fails silently with no error to debug from.
**Best-practice options:**
1. **Route by an op-level "owner id":** add a helper `ownerIdOf(op)` (`payload.parent` for `insertHtml`, else `target[0]`), use it in `isEditOp` (allow an empty target only for `insertHtml`), in `Writer.submit`, and in the record's `target` (use `[parent]` for labels and locations). *Plain words: tell the server which layer a paste belongs to.* Local fix, no external pattern needed. **Pick this.**
2. Set `target: [parent]` and exempt `insertHtml` from the artboard-root refusal in `planStructural`. *Plain words: treat the paste parent as the target.* Fewer touch points, but it weakens a guard that exists for every other structural op.

### [major] "One held arrow = one undo entry" contradicts "the registry mints one id per run"  — §Contract #1, #3, #6
**In plain words:** The plan moves arrow nudges into the shortcut registry and says each registry command gets a fresh action id. A held arrow key fires dozens of separate key presses, so it would get dozens of ids and dozens of undo steps. The Writer also has a timing hole when switching from one action to the next.
**What:** Contract #3 promises a held arrow is one entry "from keydown to keyup". Contract #1 moves the nudges into the registry, and contract #6 says "a registry action … omits [the id], and the context mints one per `run`". Each auto-repeat `keydown` is a separate `run`, and nothing in the registry tracks `event.repeat` or `keyup`. Contract #6 also does not say how an async `run` (e.g. `pasteStyle`, which awaits several `apply`s) keeps its id across `await`s on a shared `EditorContext`. On the server, "flushes the pending ops as their own undo entry first" is asynchronous (`serialized` queue), while `submit` pushes into `open.pending` synchronously. Unless the pending batch is sealed at that moment, the new action's op joins the old flush.
**Why it matters:** The exit test "nudge two absolute elements and undo once" fails, and action boundaries are not reliable under load, which is the guarantee contract #3 exists to give.
**Best-practice options:**
1. **Registry-held actions + per-run context:** the registry keeps one `actionId` while `event.repeat` is true for the same chord and ends it on that key's `keyup` (or blur). Each `run` receives a context wrapper with the id bound, so async continuations keep it. *Plain words: a held key counts as one command, and the command carries its id with it.* This mirrors tldraw creating a mark at the start of an interaction (tldraw History, https://tldraw.dev/sdk-features/history). **Pick this.**
2. **Seal the batch synchronously in `Writer.submit`:** on an `actionId` change, move `open.pending` into a sealed list (per file) before appending, and have `flushAll` drain sealed batches first. *Plain words: close the old box before opening a new one.* This is required whichever option above is chosen.

### [major] "Matching `<helmet><style>` rules join `styles`" needs a selector matcher the server does not have  — §Contract #8, §M11 #6
**In plain words:** The Code tab is meant to list every CSS rule that applies to the selected element. Today the server only knows each element's inline style. Working out which rules match is a real piece of engineering, and it would also change what v1's selector chip offers.
**What:** `session.ts:stylesOf` returns only `indexed.inlineStyle(id)`. Nothing on the server matches selectors against elements (`positionalSelectorWarnings` has only a crude tag/id/class `canMatch`). v1's `SelectorChip`/`targetsOf` (`PropertiesPanel.tsx`) already reads rule sources from `index.styles`, so filling them in turns on rule choices in the chip that v1 never showed or tested end to end. Matching against the source tree also differs from the live DOM for `<sc-for>`/`<sc-if>`, `:hover`, `@media` rules (`RuleLocation.media`) and runtime-made nodes.
**Why it matters:** Contract #8 is sized as one sentence. Done naively, it shows the wrong rules in the Code tab and the write-target chip, and a write to a wrong rule changes other elements.
**Best-practice options:**
1. **Match in the probe on the live DOM:** a new `matchedRules` probe read returns, for the selected element, the rule ids whose selector `element.matches()`, and the Code tab (which does not need synchronous data) asks for it. *Plain words: let the real browser say which rules apply.* This uses the browser's own matcher and handles templates and pseudo-classes correctly. **Pick this for the Code tab, and keep `styles` inline-only** so the chip does not change in v2.
2. **Server-side css-select over parse5:** css-select compiles selectors to matchers via a small adapter interface (css-select, https://github.com/fb55/CSSselect). The parse5 adapter package is archived (css-select-parse5-adapter, https://github.com/polymer/css-select-parse5-adapter), so you would write the six-function adapter yourself. *Plain words: run a CSS matching library on the source tree.* Synchronous, but it matches the template, not what renders.
3. Defer rule listing: the v2 Code tab shows the inline style only. *Plain words: ship less.* Smallest change, but it loses half of M11 #6.

### [major] A disabled shortcut falls through to the browser: Cmd-[ / Cmd-] navigate Back/Forward  — §Contract #1, §M8 #7, §M9 #3
**In plain words:** When a shortcut's command is greyed out, the editor ignores the key, and the browser then does its own thing with it. On a Mac in Chrome or Edge, Cmd-[ means "go back a page", so pressing bring-backward with nothing suitable selected can navigate away from the editor.
**What:** `registry.handleKeyDown` matches only when `entry.when?.(ctx)` is true, and calls `preventDefault()` only then. M8 #7 makes z-order disabled for anything that is not positioned or a flex/grid item, and Mod-[ / Mod-] are Back/Forward in Chrome and Edge on macOS. A page *can* suppress them with `preventDefault()` (Stack Overflow, "override cmd shift in chrome", https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/56647135/override-cmd-shift-in-chrome), so the fault is in the registry. Likewise Alt-D (align right, disabled with nothing selected) focuses the address bar in Windows Chrome. The UI has no `beforeunload` guard.
**Why it matters:** Pressing a documented shortcut can take the user out of the editor in the main browser target. The conflict test (registry vs registry) cannot catch this.
**Best-practice options:**
1. **Swallow bound chords in scope even when disabled:** if a chord matches a binding whose scope applies, call `preventDefault()` whether or not `when` passes, and show the disabled reason as a toast. *Plain words: a key the editor owns never leaks to the browser.* Local fix in `registry.ts`, plus a registry test for "disabled chord still prevented". **Pick this.**
2. Add a `beforeunload` prompt while the editor is open. *Plain words: ask before leaving.* A safety net only, and it nags on intentional reloads.

### [minor] Scope rules regress v1: Mod-F becomes layers-only, Delete's scope is ambiguous  — §Contract #1
**In plain words:** Today Mod-F jumps to layer search from anywhere. The plan limits it to when the layers panel has focus, so from the canvas it would open the browser's Find bar. It is also unclear whether Delete still works while a layer row has focus.
**What:** `LayersPanel.tsx:177-186` binds Mod-F on `document` with no focus check (it even works inside the search input). Contract #1 makes it `'layers'`, so it matches only inside the panel, and App's `isTextEntry` filter would skip it in the search box. The rule "every action bound to a bare key with no Mod or Alt is `'canvas'`" also covers Delete/Backspace (v1's `layer.delete`, global today), Shift-H/V flip, Shift-A and Shift-0, but the parenthetical list names only V, H, Enter, Tab, Escape, Shift-1/2 and arrows.
**Why it matters:** Goal 4 says nothing in v1 gets worse. Figma users expect Delete to work from the layers panel.
**Best-practice options:** No external pattern is needed. **List the scope of every existing and new binding explicitly in a table: Mod-F `'global'` (including from the search input), Delete/Backspace `'canvas' | 'layers'`, and Shift-letter commands `'canvas' | 'layers'`.** Then add regression tests for v1's Mod-F and Delete from a layer row.

### [minor] Marquee changes v1's select-on-press and needs tool hand-off and cancel APIs the contract does not list  — §M9 #1, §Contract #7
**In plain words:** Today a click selects the moment the mouse goes down. With the marquee tool claiming every press, selection happens only on release. Dragging an unselected element also needs the marquee tool to pass the drag to the move tool, and there is no defined way to do that.
**What:** `CanvasView.onPointerDown` calls `selectAt` immediately when no tool claims the press. The plan says "a press released without crossing the threshold falls through to `selectAt` exactly as today", but under the plan that happens at release, not press. `onDoubleClick` reads `view.selection`, which must then be set by an async `selectAt` that starts milliseconds earlier. "A drag that starts on an unselected leaf selects it … then moves it" needs the marquee tool to start the move tool's module-private `press`, and the move tool only works from `selectedBox()`. Moving Escape into the registry needs a `cancelGesture` on `EditorContext`, and contract #7 lists only `setMode`, `fit` and `setEditorState`.
**Why it matters:** These are subtle feel regressions and a likely double-click race. The work is real but unplanned.
**Best-practice options:** Local design, no external pattern needed. **Select as soon as the `hitTest` resolves (not at release), add `ctx.cancelGesture()` and a `beginToolDrag(toolId, pointer)` hand-off to contract #7, and add a double-click test after a claimed press.**

### [minor] `EditorAction.when` is synchronous, but v2's enable rules need async probe reads  — §M8 #6/#7, §M9 #3/#6
**In plain words:** Many new commands are greyed out based on layout facts (is it absolutely positioned, a flex child, overlapping?). Those facts come from the canvas asynchronously, but the "is this enabled" check has to answer instantly.
**What:** `plugin-api.ts` has `when?: (ctx) => boolean`. Frame selection (positioned?), align (flex child? absolute?), z-order (layout kind, overlap) and flip need `computed` or `rects` probe reads. The plan does not say where those facts come from when the palette renders or a key is pressed.
**Why it matters:** Without a decision, each action will improvise, and the palette and the shortcut disagree about what is enabled.
**Best-practice options:** No external pattern is needed. **Add a per-selection "facts" snapshot to the context (position, display, parent display, rects), refreshed when the selection or index changes. `when` reads it, and `run` re-checks with fresh reads.**

### [minor] Mod-Shift-A (invert selection) collides with Chrome's tab search  — §M8 #2, §Risks
**In plain words:** Chrome uses Ctrl/Cmd-Shift-A to open tab search, so the new invert-selection shortcut may never reach the editor in the browser.
**What:** Chrome binds Ctrl+Shift+A / Cmd+Shift+A to tab search (Chrome tab search shortcut guide, https://www.superchargebrowser.com/library/chrome-tab-search-shortcut-guide/). Other web apps report they cannot get this chord (Gamma feedback, https://ideas.gamma.app/ideas/p/shift-a-on-macos-in-chrome-is-shortcut-for-search-tabs-and-doesnt-work-in-gamma). §Risks lists Mod-K and the Alt-letters but not this one.
**Why it matters:** A Goal 1 shortcut may silently not work in the main browser target.
**Best-practice options:** **Test it in Chrome and Edge on both OSes. If the browser keeps it, say so in §Risks and rely on the palette entry (as for outline mode).** The alternative is a second alias. No better external pattern was found.

### [minor] The Windows AltGraph guard may disable every Ctrl+Alt chord  — §Contract #1
**In plain words:** On Windows the AltGr key is secretly Ctrl+Alt. Depending on the Chrome version, the browser may report "AltGr is down" whenever you press Ctrl+Alt yourself. The planned guard would then block Frame selection and the copy/paste-style shortcuts for every Windows user.
**What:** Chrome historically set the AltGraph flag whenever both Ctrl and Alt were set. The FixAltGraph change only sets it for printable results and clears Ctrl/Alt when it does (blink-dev "Intent to ship: Fix AltGraph on Windows", https://groups.google.com/a/chromium.org/g/blink-dev/c/f3psGfxbbZc; MDN getModifierState, https://developer.mozilla.org/docs/Web/API/KeyboardEvent/getModifierState). Under the old behaviour, "skip a Ctrl+Alt chord while `getModifierState('AltGraph')`" skips Ctrl+Alt+G, Ctrl+Alt+C/V and Ctrl+Alt+Shift+C entirely. Under the new one the guard is redundant, because AltGr chords arrive without Ctrl/Alt. Synthetic unit events cannot tell which applies.
**Why it matters:** These are v1 features (style copy) and v2 features that might be dead on Windows. Only a real-machine test shows it.
**Best-practice options:** **Add a manual or Playwright-on-Windows check of Ctrl+Alt+G and Ctrl+Alt+C on US and German layouts in Chrome, Edge and Electron, and keep the guard only if that check shows it is needed.** Otherwise rely on the existing rule that a non-ASCII `key` (an AltGr character) already falls to `code` matching.

### [minor] The contract stage is underestimated and bundles too much into one task  — §Effort, §Contract changes
**In plain words:** Eight protocol and pipeline changes, including the riskiest work in the plan, are scheduled as "one task, one day".
**What:** The contract stage changes `registry.ts`, `CanvasView.tsx`, `move.tool.ts`, `LayersPanel.tsx` (#1), a new `insert-html.ts` allow-list (#2), `writer.ts` + `undo-log.ts` (#3), a new op (#4), the probe protocol (#5), `EditorContext` (#6, #7) and `session.ts` + rule matching (#8). Add the engine fix above. With one owner per file, these cannot all run in parallel.
**Why it matters:** If the contract slips, the feature milestones slip too, and the pressure lands on the least visible but most important part (undo and write-back correctness).
**Best-practice options:** No external pattern is needed. **Split it into C1 (undo/actionId + PatchEngine coalescing + ack fix, with tests), C2 (registry scopes and aliases), and C3 (`insertHtml`/`removeAttr`/probe/context), and re-baseline the effort at about 3 days for contracts.**

### [nit] Alt-letter glyphs and keys differ on AZERTY Mac vs Windows  — §Testing
**In plain words:** On a French Mac, "Alt-A" will fire on the key labelled Q, but the palette will still show "A".
**What:** Option-letters arrive as non-ASCII `key` on macOS, so they fall to `code` (`KeyA` = the Q key on AZERTY). On Windows, Alt+A arrives as `a` and matches the key labelled A. The palette shows "the bound letter".
**Why it matters:** The shortcut and the glyph disagree for AZERTY Mac users only.
**Best-practice options:** No external pattern is needed. **Use `navigator.keyboard.getLayoutMap()` for code-matched letters too (as the plan already does for punctuation).**

---

## Decisions Ron needs to make

1. **How multi-property edits are written** — fix the PatchEngine to write each declaration list once per flush, or keep v1's one-op-at-a-time awaits (300 ms per property, intermediate files). Recommend: fix the engine in the contract stage.
2. **Continuous drags (colour square, scrubbing): preview-only until release, or repeated `apply`** — preview-only gives one write and a clean Escape, while repeated `apply` writes mid-drag and needs the ack fix. Recommend: preview-only for drags, plus "check only the newest op" for typing and held keys.
3. **Where rule matching for the Code tab happens** — probe (`element.matches` on the live DOM), server (css-select over the template), or defer rules to v3. Recommend: probe, and keep `index.styles` inline-only so v1's selector chip does not change.
4. **Disabled shortcuts: swallow or pass through** — swallowing keeps Cmd-[ from navigating away, while passing through lets browser shortcuts work when the editor has nothing to do. Recommend: swallow every bound chord in scope and toast the reason.
5. **Scope of Mod-F and Delete/Backspace** (hidden decision) — keep v1's global Mod-F and allow Delete from the layers panel, or scope them as written. Recommend: Mod-F global, Delete in `'canvas' | 'layers'`.
6. **When a click selects under the marquee tool** (hidden decision) — on press (v1), when the hit returns, or on release. Recommend: when the hit returns.
7. **Mod-Shift-A in browsers** — accept that Chrome may keep it (palette fallback), or add an alias. Recommend: test first, then document it in §Risks with the palette fallback.
8. **Effort re-baseline** — accept about 12 days with a three-part contract stage, or cut scope (e.g. defer the Code tab's rule list). Recommend: split the contract stage and keep the scope.

---

## Verdict

**Revise & re-review** — the approach is right, but four contract changes (multi-declaration flushes, superseded acks, `insertHtml` routing, held-key action ids) conflict with the code as it is and must be designed before any feature wave starts.
