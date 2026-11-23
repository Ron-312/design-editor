# Critic v1 — Design Editor v2: the Figma features people reach for next

**Plan reviewed:** plans/v2/plan.md
**Date:** 2026-11-23
**Score:** 5/10 — the feature choice and milestone split are sound, but the shortcut layer cannot fire about a dozen of the new keys on macOS, undo grouping is assumed rather than guaranteed, and several claims about the current code are wrong.

---

## TL;DR for Ron

The plan picks the right Figma features and keeps the "write real CSS, never Figma-only state" rule, which is its biggest strength. The biggest risk is the keyboard layer: the registry matches `event.key`, so on a Mac every plain Alt-letter shortcut (all six align keys, Alt-L) produces `å`, `˙`, `¬` and never matches. Shift-0 and Mod-Shift-]/[ also produce `)` / `}` / `{` on every OS. The planned conflict test only looks at the registry, so it would pass while a third of M8–M11's keys are dead on your own machine. Undo is a 300 ms time window in the Writer, not a per-action boundary, so "Frame selection" becomes two undo steps, and two quick commands can merge into one. The paste path calls a deny-list an allow-list, would reject the platform wrappers Windows puts around clipboard HTML, and keeps `id`s that v1's Duplicate strips. Revise the contract section (key matching, an explicit undo boundary, the paste payload) and fix the code misreadings, then re-review. Most of M10 and M11 can go ahead as written.

---

## Strengths

- **The scope is honest about the medium.** Every v2 control maps to plain CSS or DOM. Anything that depends on unconfirmed canvas semantics (`<dc-import>`, `data-props`, themes) is pushed out with a reason (§Non-goals, research/00-summary.md).
- **Contract changes land first** and are named (§Contract changes), so features build on a fixed protocol instead of growing it piecemeal.
- **The paste allow-list runs on the server** (§Risks: "a crafted message cannot bypass the UI"). That is the right trust boundary for a local server.
- **The rename feature reuses the layer-name source v1 already reads first.** Verified: `src/server/source/template-tree.ts:62-65` reads `data-layer-name` before id, class and tag.
- **The collapsed set is already persisted.** Verified: `src/server/editor-state.ts:12` keeps `collapsed` by element path.
- **The multi-move undo claim holds for its own case.** Verified: `Writer.flushAll` (`src/server/edit/writer.ts:249-262`) writes every op pending at flush time as one undo entry, and a failing op rejects the whole batch. N same-tick `setDecl`s do land as one entry.
- **Byte-exact tests are required per write, with CRLF and BOM fixtures** (§Testing). That matches the v1 bar.

## Concerns

### [blocker] The key registry matches `event.key`, so many of the new chords can never fire — §Contract changes, M8–M11, Testing
**In plain words:** The editor decides which shortcut was pressed by looking at the character the key would type. On a Mac, holding Option turns letters into symbols (Option-A types "å"), and Shift turns 0 into ")". So the planned align, distribute, collapse-all, 100%-zoom and bring-to-front keys would look right in the code and the tests, then do nothing when you press them.
**What:** `createActionRegistry` compares `event.key.toLowerCase()` with the chord's key (`src/ui/actions/registry.ts:53-55`).
- On macOS, Option+letter yields the composed character in `event.key`. That breaks Alt-A/H/D/W/V/S (align), Alt-Shift-H/V (distribute), Alt-L (collapse all) and Alt-Shift-A (remove auto layout).
- On every OS, Shift changes digit and bracket keys: Shift-0 gives `)`, Mod-Shift-] gives `}` and Mod-Shift-[ gives `{`. Bring-to-front and send-to-back never match.
- Non-US layouts move `[`, `]`, `/` and `=` behind AltGr or Shift. Figma's own forum has long threads about exactly this.

There are also more key paths than the plan's conflict test (§Testing, "one unit test over the registry") would see. `CanvasView.keyCommand` handles v, h, i, Space, Enter, Tab, Escape, Shift-1 and Shift-2 (`src/ui/canvas/CanvasView.tsx:424-468`). `move.tool.ts:458` handles the arrows, and `LayersPanel.tsx:180` handles Mod-F. Shift-2 already exists in `CanvasView`, and the plan re-adds it (M11 #3), so it would be bound twice. Playwright's `keyboard.press` synthesises US-layout keys without Option composition, so the e2e exits would pass too.
**Why it matters:** Goal 1 ("muscle memory works") fails on macOS, Ron's main platform, for most of M9's arrange commands. Nothing in the planned test bar would catch it.
**Best-practice options:**
- **(A) Match letter, digit and punctuation chords on `event.code` (`KeyA`, `Digit0`, `BracketRight`) whenever a modifier other than Shift alone is held, and fall back to `event.key` for named keys (Delete, Backspace, Enter, arrows).** In plain words: look at which physical key was pressed, not what it would type. MDN: `code` "returns a value that isn't altered by keyboard layout or the state of the modifier keys" (MDN, KeyboardEvent.code — https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code). Tradeoff: on AZERTY the physical key labelled A reports `KeyQ`, so palette glyphs should be drawn from `navigator.keyboard.getLayoutMap()` where it exists. Libraries do the same, falling back to `code` for punctuation and for Key*/Digit* (TanStack Hotkeys PUNCTUATION_CODE_MAP — https://tanstack.com/hotkeys/v0/docs/reference/variables/PUNCTUATION_CODE_MAP).
- (B) Keep `event.key` but map composed characters back with a per-platform table. In plain words: translate "å" back to "a". This is brittle and differs for every keyboard layout.
- (C) Move every editor shortcut, including CanvasView's and the move tool's, into the registry, and make the conflict test plus a fixture test of real `KeyboardEvent` values (Option-composed and Shift-symbol keys, captured on macOS and Windows) part of the contract task. In plain words: one list of shortcuts, tested with the events real keyboards send. **Pick A + C.** A fixes the matching. C makes the plan's conflict and e2e checks actually cover what users press.

### [major] Undo grouping is a 300 ms time window, not a per-action boundary — §Goals 4, M8 #6, M9 #2–#3, M10 #8
**In plain words:** The server bundles everything that arrives within 300 ms into one undo step. One action whose second half arrives later becomes two undo steps, and two separate actions done quickly become one.
**What:** `Writer.submit` re-arms a 300 ms debounce (`writer.ts:17, 236-240`), and each flush is one undo entry (`writer.ts:249-262`). The plan relies on this ("all sent in the same tick so the Writer's 300 ms debounce makes them one undo entry") but promises "one undo entry per user action" (Goal 4) and "One undo entry per command" (M9 #3). Three cases break:
- **Frame selection (M8 #6)** is `wrapNode` followed by auto-layout `setDecl`s on the new wrapper. The wrapper's id comes back only in the ack, after the flush, so the `setDecl`s start a second flush. Undo removes the auto layout and leaves an empty-styled wrapper. The wrap also reloads the frame, so the inference must read rects before the wrap.
- **Two keyboard commands under 300 ms apart** (for example align left, then distribute) merge into one undo step.
- **Holding an arrow to nudge** produces one entry while the key repeats and separate entries after pauses. That is acceptable, but the plan should say so.
**Why it matters:** Goal 4 and the M9 exit ("nudge two absolute elements and undo once") would pass by timing luck, not by design. Frame-then-undo leaves a half-done result in the file.
**Best-practice options:**
- **(A) Add an explicit boundary to the protocol: an optional `group` id per op, or a `commit` message that flushes and closes the entry. A new action always starts a new group.** In plain words: the UI says "this action starts here and ends here", and the server stops guessing from timing. This is how Yjs exposes `stopCapturing()` on top of its `captureTimeout` merge window (Yjs UndoManager — https://docs.yjs.dev/api/undo-manager), and how tldraw marks a stopping point at the start of each user interaction (tldraw History — https://tldraw.dev/sdk-features/history). It is a small change to `Writer.submit` and `flushAll`.
- (B) For Frame selection specifically, give `wrapNode` an optional `style` payload so the wrap and the auto layout are one op, as research/08-shortcuts-clipboard.md:57 already suggests. In plain words: create the frame already styled. This fixes the worst case but not timing merges. **Do A, plus B for Frame.**

### [major] The paste pipeline is a deny-list, rejects normal clipboard HTML and diverges from Duplicate — §Contract changes #2, M8 #4
**In plain words:** The safety filter for pasted HTML lists a few forbidden things instead of allowing only known-good things. It would also reject what Windows and macOS normally wrap around copied HTML, and it keeps element ids that v1's Duplicate deliberately removes.
**What:**
1. "Rejects it unless every node passes the allow-list: no `<script>`, `<iframe>`…" is a deny-list. It says nothing about `<style>` (which restyles the whole board), `<form action>`, `formaction`, `srcset`, `<svg>`/`<math>` content, `xlink:href`, `<template>`, `url()` inside `style` attributes (a remote fetch), or the canvas's own `<helmet>`, `<sc-for>`, `<sc-if>`, `<dc-import>` and `{{holes}}` pasted outside their scope.
2. On Windows, `getData('text/html')` in a paste event still carries the CF_HTML `<html><body><!--StartFragment-->…<!--EndFragment-->` wrapper. Browsers and apps often add a `<meta charset>` too. A strict "no `<meta>`" rule would reject the editor's own copies.
3. `duplicateNode` strips every `id` attribute (`src/server/edit/structural-ops.ts:194-200`), but paste keeps them. Copy-paste within one board then creates duplicate ids, breaking `#id` rules, `label[for]` and layer names that fall back to the id.
4. Class rules live in the source board's `<helmet><style>`. Pasting into another board silently loses them. Research/08 line 32 flagged this, but the plan dropped it.
**Why it matters:** The first real paste test on Windows would fail. Same-board paste would corrupt id-based styling. The "allow-list" gives a false sense of safety for HTML that is committed and pushed.
**Best-practice options:**
- **(A) A true allow-list (tags, attributes per tag, URL schemes) applied after unwrapping: take the content between `StartFragment`/`EndFragment`, drop a leading `<meta>`, then validate. Strip `id`s exactly as `duplicateNode` does, and refuse template constructs unless the target scope allows them.** In plain words: unwrap the platform packaging, keep only known-safe pieces, and treat paste like Duplicate. OWASP recommends allow-list sanitisation with a maintained library and sanitising as the last step: "If you sanitize content and then modify it afterwards, you can easily void your security efforts" (OWASP XSS Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html). The CF_HTML markers are documented by Microsoft (HTML Clipboard Format — https://learn.microsoft.com/windows/win32/dataxchg/html-clipboard-format). On the server, use a parse5 walk with an explicit table rather than DOMPurify, which needs a DOM.
- (B) Write a private MIME type (for example `application/x-design-editor+html`) alongside `text/html` on copy, and prefer it on paste. In plain words: recognise your own copies exactly and treat everything else as foreign. Chromium keeps custom types within the browser, so intra-editor paste skips the wrapper problem. External HTML still needs A. **Do A, plus B as the fast path.**

### [major] Marquee start rule cannot be decided when the press happens, and rarely applies to HTML boards — §M9 #1
**In plain words:** The plan says a marquee starts when you drag on "empty canvas or the artboard background". On a real HTML page, the artboard is almost entirely covered by sections and containers, so there is rarely any background to start on. The editor also only learns what is under the pointer a moment after the press.
**What:** Canvas tools claim a press synchronously (`claimingTool` in `CanvasView.tsx:306-308` returns a boolean right away). Whether the press is on the artboard background needs an async `hitTest` probe read (`CanvasView.tsx:310-315`). The move tool avoids this by checking only its cached `selectedBox` (`move.tool.ts:396-400`).

More importantly, candidates are "children of the current scope". With three columns as candidates, the scope is their parent. A drag on that parent's background is neither "empty canvas" nor "artboard background", so the M9 exit test ("marquee-select three columns") contradicts the start rule. The rule also leaves open what a drag on an unselected element does. Today a press there just selects it.
**Why it matters:** As written, marquee works only when dragging from outside the board inward. In practice the feature is half-usable, and the e2e test cannot pass without breaking the rule.
**Best-practice options:**
- **(A) Figma's rule: a drag that starts on a container's own background (the hit is the container itself, not a child) marquees that container's children. A drag on an unselected leaf selects it and moves it. Claim the press synchronously, then resolve the mode once the hit test returns, before the drag threshold.** In plain words: dragging inside a box selects things in that box. This is local to the codebase; no external pattern was needed beyond Figma's documented behaviour in research/01-selection.md.
- (B) Keep the plan's rule but add a modifier (for example Mod-drag) that always starts a marquee. This is simpler but not muscle memory.

### [major] Several plan claims about the current code are wrong — §M10 #9, M11 #3, M11 #8
**In plain words:** Some "new" items are already built, and one depends on a control that does not exist.
**What:**
- **M10 #9 (token binding writes `var(--x)`) is already v1.** `tokenValue` returns `var(name)` for `:root` tokens and the literal for `tokens.json` (`src/ui/panels/fields.tsx:331-333`), and parity.md:100 marks it Built. The server also loads `:root` variables only when there is no `tokens.json` (`src/server/editor-services.ts:91-95`), so the two sources never coexist. The only new part, "shows the bound token name either way", needs a reverse lookup from a literal value to a token. That is ambiguous when two tokens share a value, and the plan does not mention it.
- **M11 #3:** Shift-2 zoom to selection already exists (`CanvasView.tsx:427`, `TopBar.tsx:135`).
- **M11 #8:** "the board width control gains presets" — there is no board width control. `TopBar.tsx` only shows `board.w`, and the iframe width is `board.w` from the layout (`CanvasView.tsx:530`). A view-only override needs new store state that the iframe size, `boardFit`, rulers and the hit-test coordinates all read.
**Why it matters:** Effort is misallocated (half of a 3-day milestone item is done), a duplicate Shift-2 binding is introduced, and M11 #8 is a new feature with its own state, not a tweak.
**Best-practice options:** No external pattern applies; this is a local fix. **Drop M10 #9 or reduce it to "show the token name for a literal match, first match wins, with a tooltip when several tokens share the value". Remove Shift-2 from M11 #3. Rewrite M11 #8 as a new `previewWidth` per board in editor-only state, read by `ArtboardFrame`, `boardFit` and the rulers.**

### [major] More protocol changes than the two the plan lists — §What stays the same, M8 #6, M9 #2, M11 #1, M11 #4
**In plain words:** The plan says only two contract changes are needed, but several features need new messages or ops that are not listed. They would get added mid-milestone by whoever hits them first.
**What:**
- **Outline mode** needs a new `EditorToProbe` message. Today there are only `read`, `previewDecl`, `beginTextEdit`, `endTextEdit` and `scrollTo` (`src/shared/protocol.ts:206-211`). The stylesheet must also be re-sent on every `ready`, because every structural op reloads the frame (`types.ts:120-121`).
- **"An empty name removes the attribute"** is impossible with today's `setAttr`. `setAttrSplice` only inserts or replaces (`src/server/edit/text-splice.ts:61-71`), so it writes `data-layer-name=""` and the zero-byte round trip is lost. That needs a `removeAttr` op.
- **Frame selection** needs a `style` payload on `wrapNode` (see the undo concern).
- **Multi-nudge** needs the move tool's single `selectedBox` (`move.tool.ts:176-178, 458-466`) generalised.
**Why it matters:** These changes touch shared types, server schema checks and the probe, which are exactly the files the "one owner per file" rule makes contentious mid-wave.
**Best-practice options:** No external pattern applies; this is local. **List all of them in §Contract changes (probe `setEditorStyles {css \| null}` re-applied on `ready`, `removeAttr`, `wrapNode.style`, the undo group boundary, code-based key matching), so they land in one first task.**

### [minor] Z-order keys and semantics need tightening — §M8 #7
**In plain words:** The "to front / back" keys differ from Figma's on Mac, and the Mac browser uses them to switch tabs. Moving an absolute element one step in the file sometimes has no visible effect.
**What:**
- Figma uses ⌥⌘] / ⌥⌘[ on macOS and Ctrl+Shift+] / [ on Windows. The plan uses Mod-Shift-] / [ on both, and Cmd-Shift-] / [ is Chrome's next/previous tab on macOS.
- Absolutely positioned elements paint above non-positioned siblings whatever their DOM order. "One step" past a static sibling changes nothing visible, and neither does a step past a sibling with its own `z-index`.
- For flex and grid items, the plan does not say what `z-index` value is written ("max sibling + 1"? one step?).
**Why it matters:** The command can appear dead, and the Mac shortcut may be taken by the browser.
**Best-practice options:** **Use per-platform chords (⌥⌘] on mac, Ctrl+Shift+] on Windows). Define "one step" as passing the next sibling whose stacking context overlaps the element's rect, and write `z-index` as max overlapping sibling + 1 for flex and grid items.** Figma's forum confirms both the mac chord and how often layouts break these keys (Figma forum, bring to front — https://forum.figma.com/ask-the-community-7/how-do-you-order-things-so-one-is-on-top-46008; German layout — https://forum.figma.com/archive-21/how-shortcut-bring-to-front-on-german-keyboard-32649).

### [minor] Copy as CSS / HTML from the palette or a context menu cannot use the `copy` event — §M8 #4–#5
**In plain words:** The plan avoids the browser's async clipboard API, but a menu click is not a copy keystroke, so those two commands have no way to write to the clipboard.
**What:** A `copy` event is only dispatched by a real copy gesture. Commands run from the palette or a context menu need `navigator.clipboard.writeText` (allowed on 127.0.0.1 with user activation) or a synthetic `document.execCommand('copy')`. Writing works in Chrome, Edge and Electron alike; only reading needs permission.
**Why it matters:** These commands would ship as non-functional or get reworked late.
**Best-practice options:** **Use the async API for these writes and keep the `copy`/`paste` events for Mod-C/X/V.** The spec confirms that `copy` and `paste` fire even in a non-editable context, so the event route stays valid for layers (W3C Clipboard API and events — https://w3c.github.io/clipboard-apis/).

### [minor] Electron menu roles and Windows Ctrl+Alt need an explicit check — §M8 #2, M8 #6
**In plain words:** The desktop app's Edit menu already owns Cmd/Ctrl-A, and on many European Windows keyboards Ctrl+Alt is the key that types extra characters.
**What:** `desktop/main.ts:108` installs `{ role: 'selectAll' }`, which binds Mod-A. Whether the renderer's `preventDefault` beats the menu accelerator on each OS is not documented. Electron documents only that `before-input-event` runs before renderer keydown (Electron Keyboard Shortcuts — https://electronjs.org/docs/latest/tutorial/keyboard-shortcuts). Mod-Alt-G on Windows is Ctrl+Alt+G, which is AltGr+G on Polish, German and similar layouts. Research/08 flags this as an unverified inference.
**Why it matters:** Mod-A could select the page's text instead of layers in the desktop app, and Frame selection could type a character.
**Best-practice options:** **Add an Electron e2e for Mod-A on macOS and Windows. If the menu wins, replace the `selectAll` role with a custom item that forwards to the editor (as v1 already did for undo). Keep every Ctrl+Alt command reachable from the palette, as the plan does for align.**

### [minor] Some property writes silently destroy authored values — §M9 #6, M10 #6
**In plain words:** A few controls remove what the author wrote when they switch modes, with no warning.
**What:**
- Text resizing "auto width = `white-space: nowrap` and no width" removes an authored `width`.
- "Fixed" vs "auto height" removes `height`.
- The line-clamp block replaces `display` and warns only for flex and grid.
- Flip toggles back by "removing the property", which deletes an authored `scale: 1.2`.
**Why it matters:** Round-trips are not reversible, apart from undo, and the zero-byte diff is lost after a toggle back.
**Best-practice options:** No external pattern applies; this is local. **Flip should multiply the existing `scale` and remove it only when the result is `1 1`. Mode switches should warn whenever they remove an authored declaration, not only `display: flex/grid`.**

### [nit] EyeDropper in Electron on Windows — §M10 #1
**In plain words:** In the desktop app on Windows, the colour dropper may be unable to pick colours outside the window.
**What:** Blockbench, an Electron app, ships a workaround for "an issue in Electron, where the color picker can't pick color outside of the window" on Windows (Chrome Developers, How Blockbench uses the EyeDropper API — https://developer.chrome.com/blog/how-blockbench-uses-the-eyedropper-api). The plan feature-detects, which is right.
**Why it matters:** It is a small surprise, not a break.
**Best-practice options:** **Keep feature detection and note the limitation, or test it in the Electron e2e.**

---

## Decisions Ron needs to make

1. **Key aliases as `string | string[]` (decided: Claude 2026-11-23)** — this is fine, but the bigger hidden decision is whether chords match on `event.code` or `event.key`. Recommend: `code` for letters, digits and punctuation with modifiers, and `key` for named keys. Also move CanvasView's and the move tool's keys into the registry.
2. **`insertHtml` with a server-side filter (decided: Claude 2026-11-23)** — keep it server-side, but choose between a true allow-list table and the current deny-list. Also decide whether paste strips ids like Duplicate does. Recommend: allow-list, unwrap CF_HTML/`<meta>` first, strip ids, and add a private MIME type for intra-editor copies.
3. **How undo steps are bounded** (hidden) — keep the 300 ms time merge or add an explicit group or commit boundary per user action. Recommend: an explicit boundary, plus a `wrapNode.style` payload for Frame selection.
4. **Z-order: DOM order for absolute, `z-index` for flex/grid (decided: Claude 2026-11-23)** — this is reasonable. Still to decide: which keys to use (Figma's per-platform chords vs Mod-Shift on both), and what "one step" means. Recommend: Figma's chords, and "next overlapping sibling" semantics.
5. **Align: offsets for absolute siblings, `align-self` for a single flex child (decided: Claude 2026-11-23)** — this is sound. Confirm that a multi-child flex selection stays disabled rather than writing `align-items` on the parent.
6. **Token binding (decided: Claude 2026-11-23)** — this is already v1 behaviour. Decide whether the "show name for a literal value" part is worth an ambiguous reverse lookup. Recommend: first match, with a tooltip listing the others, or drop it.
7. **Marquee start rule** (hidden) — choose between the plan's "empty canvas or artboard background" and Figma's "drag on a container's background marquees its children". Recommend: Figma's.
8. **Outline mode shortcut** (hidden) — Mod-Shift-O is the bookmarks manager in Chrome and Favorites in Edge. Decide whether to keep it, test that `preventDefault` wins, or use another chord. No strong recommendation; test it.
9. **Preview width storage** (hidden) — per board in `.editor/state.json`, or session-only. Recommend: per board in editor state, next to zoom and pan.

---

## Verdict

**Revise & re-review** — the feature set is right. The keyboard matching, the undo boundary and the paste contract all need fixing in the contract task before M8–M9 can deliver Goals 1 and 4, and the code misreadings need correcting.
