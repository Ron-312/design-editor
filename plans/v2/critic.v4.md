# Critic v4 — Design Editor v2: the Figma features people reach for next

**Plan reviewed:** plans/v2/plan.md
**Date:** 2026-11-23
**Score:** 6/10 — the approach and sequencing are right and most code claims hold, but three things would ship broken as written: the punctuation key rule sends zoom keys to z-order on German keyboards, paste would fail the existing shape check, and per-action sealing breaks undo for held field steps.

---

## TL;DR for Ron

The plan is careful and mostly grounded in the real code. The contract-first order is right, and the Writer, PatchEngine, registry and ack claims I checked match `src/`. The biggest strength is the undo model: one action id, sealing in `Writer.submit`, and folding in `UndoLog.record`. That fixes a real v1 weakness, where timing decided undo steps. There are three real risks. First, the new key rule matches all punctuation on the physical key position. On a German (QWERTZ) keyboard, Ctrl + the "+" key would then run **Bring forward** and write the file, and Ctrl + "-" would open the palette. Second, `insertHtml` as described would be rejected by the existing shape check (`shapeMismatch` refuses any element without an id), so paste would never work. Third, sealing on every new action id turns a held ArrowUp in a number field into dozens of undo steps and file writes, where v1 made one. Ship after fixing these three in the plan. Each is a contained fix, not a redesign.

---

## Strengths

- **Code claims are accurate where it matters.** `Flush` does plan every op against the original text (`patch-engine.ts`, `class Flush`). `removeDeclarationSplice` does overlap for "remove the last two" (§Contract #9). `applyWrites` does await each op (`layout.section.tsx:103-113`). `copyWithoutIds` and the `siblingRun` wording exist. `tokenValue` is at `fields.tsx:331` and `data-layer-name` at `template-tree.ts:62`. LayersPanel's Mod-F listener really has no text-entry guard.
- **The undo model is right (§Contract #3, #6).** Sealing synchronously in `submit`, so a late flush can never merge two actions, plus `UndoLog.record` folding same-id flushes, covers both failure directions. Preview-then-commit-once for continuous drags (`ctx.preview`) avoids write storms, matching how v1's resize tool commits.
- **The superseded-ack fix is real (§Contract #6).** Today `settleAck` compares every ack's stale `previewed` against the final `resolved` and adds one record per opId (`ws-client.ts:51-63`). The plan names exactly this.
- **Disabled-but-in-scope chords are always prevented (§Contract #1).** This copies CodeMirror's `preventDefault` semantics and stops Mod-[ from navigating Back.
- **Paste safety is server-side, allow-list based, and treats the private MIME type as untrusted (§Contract #2, M8 #4).**
- **The Electron select-all design works whether the menu or the page sees the key first (§M8 #2).**

## Concerns

### [major] Matching all punctuation on `event.code` sends zoom keys to z-order and the palette on non-US layouts — §Contract #1, §M8 #7, §M11 #3, §Testing
**In plain words:** The plan reads letters by what is printed on the key, but punctuation by where the key sits on a US keyboard. On a German keyboard the "+" key sits where US has "]", and "-" sits where US has "/". So pressing Ctrl and "+" to zoom in would instead move the layer forward and save that to the file. Pressing Ctrl and "-" to zoom out would open the command palette.
**What:** Contract #1 says only "a single ASCII letter or digit" matches on `event.key`, and "any other key … punctuation" matches on `event.code`. M8 #7 also pins Mod-]/Mod-[ to `BracketRight`/`BracketLeft`. On QWERTZ, the "+" key is `code: BracketRight` and the "-" key is `code: Slash`. So Ctrl+"+" matches `Mod+]` (Bring forward, a file write) and Ctrl+"-" matches `Mod+/` (palette). On AZERTY, "-" is `code: Digit6`, so Mod-- matches nothing and the browser zooms the whole editor UI. The plan says "ProseMirror and CodeMirror keymaps use the same rule", but they do not. Both look up `event.key` first for every character, and fall back to the base key only when that lookup failed and a modifier is held. CodeMirror also skips the fallback for Ctrl+Alt on Windows and for Alt-only on macOS. The Testing section exercises only letters (`z`, `ז`) and Option/Shift cases, so this would pass CI.
**Why it matters:** A zoom keystroke would silently change paint order and write the file on a common European layout. This breaks Goal 1 (muscle memory) and Goal 4 (Windows).
**Best-practice options:**
- **Option A: key first, code as fallback (ProseMirror/CodeMirror model).** *In plain words: trust the printed label; only when no binding matches a label that a modifier changed, try the physical key.* Look up `event.key` (lower-cased) for every printable key. Only if nothing matched, and Alt/Meta/Ctrl is held (not AltGr), retry with the US character for `event.code`. Option-composed `å` and Shift-composed `}` still reach their bindings through the fallback. On QWERTZ, "+" and "-" match the zoom bindings on their labels. Add QWERTZ zoom tests (`{key:'+', code:'BracketRight', ctrlKey}` is zoom in, `{key:'-', code:'Slash', ctrlKey}` is zoom out). Tradeoff: on QWERTZ, z-order moves to whatever key prints "]" (AltGr+9), which matches the label-based UX elsewhere. Sources: prosemirror-keymap `keydownHandler` (https://github.com/ProseMirror/prosemirror-keymap/blob/master/src/keymap.ts); CodeMirror view keymap `runHandlers` (https://github.com/codemirror/view/blob/main/src/keymap.ts).
- **Option B: keep the code rule, but mark zoom keys `matchOn: 'key'`.** *In plain words: special-case the zoom keys.* Less change, but every future punctuation binding needs the same audit, and the palette's Mod-/ still hijacks QWERTZ "-".
- **Option C: build bindings from `navigator.keyboard.getLayoutMap()`.** *In plain words: ask the browser which character each physical key prints.* Chromium-only, async, and does not reflect Shift/Option layers. Useful for glyphs (as the plan already does), not for matching.
I'd pick **A**: it is the rule the plan already cites, it fixes the conflict generically, and the current tests still pass.

### [major] `insertHtml` would fail the existing shape check: every pasted element needs a minted, carried id and a Shape entry — §Contract #2, §M8 #4
**In plain words:** After any structural edit, the server re-reads the file and checks that every element in it is one it knows about. Pasted elements are new and unknown, so as written the check would reject every paste with "the browser would add an extra <div>".
**What:** `Flush.finish()` runs `shapeMismatch(this.shape, ParsedSource.parse(text, offsets))` whenever `restructured` is set. `shapeMismatch` returns an error for any re-parsed element that has a start offset but no bound id (`reparsed.unbound`). `duplicateNode` passes this only because it mints an id for **every** element in the copied subtree, carries each one's offset in the splice (`carried`), and inserts the copy into `shape` with `cloneInto`. The plan instead says the op "must pass the existing content-model check for the parent (`shape-check.ts`)". That is not what `shape-check.ts` does: it is a whole-tree re-parse comparison, and the content-model rule is `nestingViolation` in `shared/content-model.ts`. The plan also says `mintedIds` "lists the new top-level elements", but `Writer.acks` sends the flush's whole `minted` list, so for `duplicateNode` it is the whole subtree.
**Why it matters:** As written, the M8 paste tests fail at the first fragment. The implementer then has to reverse-engineer the binding rules. The parser fix-up protection (`<p>` inside `<p>`, a `<tr>` gaining an implicit `<tbody>`) only works once the fragment's intended tree is in `shape`.
**Best-practice options:** No external pattern applies; this is local to the engine. Concrete fix:
- **Plan `insertHtml` like `duplicateNode`.** *In plain words: give every pasted element a new id and tell the checker where it should land.* Parse the cleaned fragment with parse5 `parseFragment` in the parent's context, with `sourceCodeLocationInfo`. Mint one id per element, carry each at `indent.length + offset` in the single splice, and attach the subtree to `shape` under the parent before `before`. `shapeMismatch` then catches parser fix-ups for free. Say that the ack's `mintedIds` holds every new id, and that the UI selects only the top-level ones, which it can find from the next `index`. Add a test that pastes `<p><div></div></p>` and expects the shape refusal, not a write.

### [major] Sealing on every new `actionId` splits a held ArrowUp in a field (and other rapid single-shot edits) into one undo entry and one file write per step — §Contract #3, §Contract #6
**In plain words:** Today, holding the up-arrow in a width field for a second makes one undo step and one save. Under v2, each tick counts as its own action, so the same gesture makes about 30 undo steps and 30 separate file writes. That is worse than v1, which the plan promises never to be.
**What:** `NumberField.step` (`fields.tsx:386-392`) calls `declaration.write` on every ArrowUp/ArrowDown keydown, including auto-repeats. The registry never sees these keys: focus is in an input, and App filters `isTextEntry` (`App.tsx:180`). So the registry's `hold` mechanism does not apply. Contract #6 says "a single-shot caller omits it and the context mints one", so each step gets a fresh id. Contract #3 then seals the previous step's batch, and `flushAll` drains each sealed batch "as its own undo entry", each with its own `atomicWrite`, re-index and `index` broadcast. In v1 the 300 ms debounce merged these steps through `withOp`'s supersede key into one write. The same applies to rapid clicks on segmented toggles, and to keyboard stepping of any M10 slider (hue, alpha, blur) that is not a pointer drag.
**Why it matters:** This breaks Goal 4 ("one undo entry per user action"). It also adds write churn that edsync and the watcher see. The plan's tests only cover registry-level holds, so this would pass.
**Best-practice options:**
- **Option A: give field stepping the same "hold" id.** *In plain words: holding a key in a field counts as one action, just as it does on the canvas.* Mint the id on a non-repeat ArrowUp/ArrowDown keydown in the field, and reuse it while `event.repeat` is true. Release it on keyup or blur. Wrap this in one helper used by `TextInput` and the M10 slider and scrub controls. Add a test: three repeated steps make one undo entry and one write. This follows Yjs `stopCapturing()`, which ends a capture group explicitly. Source: Yjs UndoManager docs (https://docs.yjs.dev/api/undo-manager).
- **Option B: let single-shot ops with no explicit id join the open batch within the debounce window (Yjs `captureTimeout`).** *In plain words: edits with no declared action merge by time, as v1 did.* Closer to v1, but it reintroduces timing-dependent grouping for menu commands, which is what Contract #3 set out to remove. Source: same Yjs docs (`captureTimeout`, default 500 ms).
I'd pick **A**: it keeps the action-bounded model and covers the one input path the plan missed.

### [minor] Mod-F is declared `'global'` but must fire from a text field, which `'global'` and App's guard both exclude — §Contract #1
**In plain words:** The plan says "global" means "anywhere except while typing in a field", then says Mod-F is global and also works while typing in a field. Both cannot be true, and App's current keyboard hook never even asks the registry while a field has focus.
**What:** `App.tsx:180` calls `registry.handleKeyDown` only `if (!isTextEntry(event.target))`. Contract #1 defines `'global'` as "anywhere except text entry". Moving LayersPanel's Mod-F into the registry therefore needs a new flag (for example `inTextEntry: true`, or a scope value such as `'anywhere'`), and App's filter must move into the registry. The palette's "never opens while an input has focus", and Mod-Z staying native in inputs, depend on the same rule.
**Why it matters:** The plan's own v1-regression test (Mod-F from the search input) would fail. Without the flag, the implementer may weaken text-entry protection for every global chord to make it pass.
**Best-practice options:**
- **Add an explicit text-entry opt-in on `EditorAction`, and move the `isTextEntry` check into the registry.** *In plain words: each shortcut says whether it may fire while you type.* This mirrors VS Code's `inputFocus` / `textInputFocus` when-clause contexts. Source: VS Code when-clause contexts (https://code.visualstudio.com/api/references/when-clause-contexts).

### [minor] Contracts #3 and #9 describe declaration coalescing two different ways, and #9's version can still overlap — §Contract #3, §Contract #9
**In plain words:** Two paragraphs promise two different ways of writing several style changes at once. One of them can still produce the "overlapping patches" crash it is meant to fix.
**What:** #3 says every `setDecl`/`removeDecl` on one list "is folded into the final list, which is written as one splice from the first changed declaration to the last". #9 says removals become "one splice over the removed declarations' span", while "`setDecl` on an existing declaration keeps its per-declaration value splice". With `a:1; b:2; c:3`, removing `a` and `c` while setting `b` puts `b`'s value splice inside the removal span `[a.start, c.end)`. `orderedSplices` then throws. The #9 test "remove one while setting another" does not pin this interleaving.
**Why it matters:** The implementer has to choose, and the #9 reading is the one that fails.
**Best-practice options:** Local fix, no external pattern needed:
- **Adopt #3's version in both places.** *In plain words: when one list gets several changes, rewrite that list once.* Rewrite the span from the first to the last touched declaration as a single splice, built from the final list with `separatorsOf`. Add the remove-a/set-b/remove-c byte test. magic-string and LSP text edits both require non-overlapping ranges, as the plan already notes.

### [minor] Sealed batches are unspecified on the pause, discard and write-failure paths, and drain per file rather than in time order — §Contract #3
**In plain words:** The plan adds a new "sealed" queue but does not say what happens to it in the three cases where today's code saves pending edits for later or throws them away.
**What:** `resolvePending(file, false)` rejects only `open.pending`. `outsideChange` sets `paused` from `open.pending.length`. A failed `atomicWrite` re-queues with `open.pending.reduce(withOp, batch)`, which would merge a sealed batch back into the open one through the supersede key. Sealed lists are per file, and `flushAll` iterates `this.files` in Map order. If a session ever has sealed actions in two files, the undo stack order differs from the order the actions happened.
**Why it matters:** Ops could be lost silently (never acked or rejected) after "discard", or two actions could merge after a locked-file retry, which breaks the very guarantee Contract #3 adds.
**Best-practice options:** Local fix:
- **Keep one global, time-ordered queue of sealed `{file, actionId, ops}` batches.** *In plain words: one queue in the order things happened, not one per file.* Make `paused`, discard and the write-failure retry operate on whole batches, and add a test for each of the three paths.

### [minor] Preview-width auto height can loop with `vh` content — §M11 #8
**In plain words:** If the board's content is sized relative to the frame's height, growing the frame to fit the content makes the content bigger, which grows the frame again, without end.
**What:** The frame height becomes `max(board.h, scrollHeight)` from a ResizeObserver in the probe. Inside an iframe, `vh` resolves against that iframe's height, so any `min-height: 110vh` or vh-sized absolutely positioned child produces unbounded growth.
**Why it matters:** At a preview width the canvas can grow forever and the rulers become useless. Hero sections sized in `vh` are common in generated designs.
**Best-practice options:**
- **Measure once per preview-width change, and cap growth.** *In plain words: measure at the authored height, then stop.* Measure `scrollHeight` with the iframe at `board.h`, and ignore later growth that only tracks the frame's own height (for example, re-measure only on DOM mutations or a width change). Cap at a multiple of `board.h`. Source: Drupal Canvas issue "vh-height sections … cause unbounded iframe growth via feedback loop" (https://git.drupalcode.org/project/canvas/-/work_items/3591832).
- **Throttle, and skip unchanged heights, as iframe-resizer does.** *In plain words: slow the loop down.* This reduces the problem but does not stop vh growth. Source: iframe-resizer (https://github.com/davidjbradshaw/iframe-resizer/issues/163).

### [minor] The Code tab will hide `:hover`, `:focus` and `::before` rules — §M11 #6
**In plain words:** The Code tab asks the browser "does this rule apply right now?", so a hover style or a decorative `::before` rule never shows up, even though it is part of the element's styling.
**What:** `element.matches()` on a selector with a pseudo-element never matches an element, and a state pseudo-class matches only while that state is live. Rules such as `.btn:hover` and `.card::before` therefore never appear.
**Why it matters:** The tab's promise ("each matching rule as exact source text") quietly omits rules a designer expects to see next to the element.
**Best-practice options:**
- **Strip state pseudo-classes and pseudo-elements before matching, and label the rule with them.** *In plain words: show the rule as "applies on hover".* This is DevTools' model: a forced-state toggle and separate pseudo-element sections. Source: Chrome DevTools CSS features reference, "Toggle a pseudo-class" (https://developer.chrome.com/docs/devtools/css/reference).

### [nit] Two probe protocol additions are missing from the contract list — §Contract changes, §M11 #6, §M11 #8
**In plain words:** The plan says all shared message changes land first, but two new probe messages appear only inside later features.
**What:** The `matches` read (M11 #6) and the probe's `scrollHeight` report (M11 #8) change `shared/protocol.ts`, which has a single owner, but they are not in Contracts #1–#9.
**Why it matters:** With one owner per file, a late protocol change forces an extra wave or an ownership exception.
**Best-practice options:** Local fix, no external pattern: add both to Contract #5 (probe messages) so C3 owns them.

---

## Decisions Ron needs to make

1. **Key-matching rule for punctuation** — the plan's rule (code for all punctuation) or the ProseMirror/CodeMirror rule (key first, code fallback only when a modifier is held and nothing matched). The tradeoff is physical-position z-order keys against zoom keys that work on QWERTZ/AZERTY. Recommendation: key first with code fallback.
2. **Undo grouping for held field steps and rapid single-shot edits** — a hold-style action id for field stepping, or a time window for ops without an id. Recommendation: hold-style id (mint on first keydown, keep while `event.repeat`, release on keyup or blur).
3. **Nested-container drag behaviour (decided: deep-critic r1/r2, pending your trial in the M9 build)** — dragging an unselected nested container marquees its children (plan) instead of moving it (Figma). This is the right call for block-flow HTML, where most containers have no move mode. Recommendation: keep it, and confirm in the M9 build as planned.
4. **Confirm the Claude-made decisions tagged `(decided: Claude 2026-11-23)`** — `removeAttr`, `setEditorStyles`, validators, the view setters, and align semantics (single flex child only). All are sound and small. Recommendation: confirm them as a batch.
5. **Cross-board paste drops `<helmet><style>` class rules (known limitation, M8 #4)** — accept for v2, or copy matching rules into the target board. Copying rules needs selector matching and conflict handling the server does not have. Recommendation: accept for v2, and show a one-line toast when the pasted fragment uses classes the target board does not define.
6. **Effort of about 12½ days with a 3-day contract stage** — accept it, or cut a feature. The plan argues that cutting a feature does not shrink the contracts. Recommendation: accept it, but add the three major fixes above to C1/C2/C3 before starting, since each touches a contract.

---

## Verdict

**Ship after addressing blockers** — there are no blockers, but the three majors (punctuation key rule, `insertHtml` shape binding, field-step undo splitting) are each a direct break of Goal 1 or Goal 4, and each is a contained edit to the plan.
