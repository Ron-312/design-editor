# 09 - Validation of research 04 + 05, and newer tools (2025-2026)

Date of check: 2026-11-23. Every row cites a URL fetched with WebFetch this session (a few are WebSearch-only and marked so). Verdicts: CONFIRMED / WRONG / STILL UNVERIFIED. plan.md and files 04/05 were not edited.

## A. Validation table: 04 (layers, components, history)

| # | Claim in 04 | Verdict | Evidence / correction |
|---|---|---|---|
| 1 | Figma file is "a tree of objects, similar to the HTML DOM"; property-level last-writer-wins; parent link + fractional index in one atomic property; server rejects cycles | CONFIRMED | [F1] |
| 2 | Undo design: undo/copy/redo back leaves doc unchanged; undo edits redo history and vice versa; deleted objects live in the deleting client's undo buffer | CONFIRMED | [F1] |
| 3 | "Skipped OT, CRDT-inspired" | CONFIRMED with nuance | Post says Figma "isn't using true CRDTs" [F1]. Reword to "CRDT-inspired, not true CRDT". |
| 4 | Offline: fresh copy downloaded, offline edits reapplied on top | CONFIRMED | [F1] |
| 5 | Autosave: edits in IndexedDB as per-node property changes; checkpoint before and after reapply; "similar to a Git commit"; no merge-conflict UI | CONFIRMED | [F2]. Nuance: the post says a diff UI for 2D design is "still an unsolved problem" and was deliberately split out from autosave; it is not that Figma could not build it. |
| 6 | Version history: checkpoint every 30 min; named version Cmd+Opt+S; restore non-destructive; free = 30 days; checkpoints cannot be removed | CONFIRMED | [F3]. Paid-plan length is not stated on the page (04 only says "full history", which matches). |
| 7 | Layers: Enter = child, Tab/Shift+Tab = sibling, Shift+Enter = parent; top-level frame cannot nest; Opt+Cmd+G frame selection | CONFIRMED | [F4] |
| 8 | Collapse layers collapses all except the current selection; Find searches whole file for text/images/frames/components; no documented layer-name search | CONFIRMED | [F5]. Page does not state "unlimited" pages, only "as many as you need" (04 said "unlimited"; harmless, soften). |
| 9 | Hide shortcut Cmd+Shift+H (was search-only) | CONFIRMED now | [F6] help article lists Cmd/Ctrl+Shift+H for hide/show. |
| 10 | Reorder by dragging in panel (was search-only) | STILL UNVERIFIED | Neither [F4], [F5] nor [F6] mentions drag-reorder. Treat as a UI convention, not a sourced Figma claim. |
| 11 | Lock: Cmd+Shift+L; selectable in panel, properties editable; parent lock locks children; persistence not stated | CONFIRMED | [F7]. Persistence remains unknown on the page. |
| 12 | Overrides: overridable list; not overridable = layer order, position, constraints, text bounds; reset one/all; push-to-main only same file; swap keeps overrides only when layer names match | CONFIRMED | [F8]. Extra: cannot push from a component nested inside another component. |
| 13 | Layer search/filter exists in Figma UI (not documented) | STILL UNVERIFIED | Left-sidebar article describes no filter [F5]. |
| 14 | Paste-to-replace (Shift+Cmd+R), "copy properties" forum reports | STILL UNVERIFIED | Not re-fetched; search-only in 04. Low impact. |
| 15 | Variants article [3] fetched but was about naming/swap | STILL UNVERIFIED | Not re-checked; plan treats variants as LATER anyway. |

Conclusion on 04: no WRONG claims. The Figma mapping advice (inference) stands.

## B. Validation table: 05 (prior art and write-back)

| # | Claim in 05 | Verdict | Evidence / correction |
|---|---|---|---|
| 1 | Onlook injects `data-oid` into dev elements | CONFIRMED but DATED | LogRocket (27 Jan 2025) shows `data-oid="zshvwmp"` [O3]. This is the v1 web product. Current `main` is a different product (see 2). |
| 2 | "Onlook v2 / current app delegates edits to Claude Code or Codex in a git worktree, returns via git/PR" | CONFIRMED | README: edits made by connected agent in "safe worktree copy" [O1]; architecture doc: every project is a git worktree on a new branch, agent runs via Claude Agent SDK, changes reach repo via git/PR [O2]. |
| 3 | Onlook uses Babel AST (`@onlook/parser`), Tailwind class edits | CONFIRMED for v1 only / UNVERIFIED for current | Current README does not mention AST; stack lists Electron, React 19, React Flow, Zustand, CodeMirror, node-pty [O1][O4]. v1 web lives on the `v1` branch [O4]. LogRocket gives no mechanism [O3]. |
| 4 | Onlook complaint list was a GAP | PARTLY FILLED | 9 open issues as of 22 Nov 2026: untranslated JA/ZH strings, idle canvas ~70% GPU (#3165), email sign-on modal unresponsive (#3163), outdated Homebrew, swallowed bridge refusals (#3168), and #3154 arguing the "no server between you and your code" and "all web frameworks" claims overstate reality for the official download [O5]. Single issue page only; no deeper history read. |
| 5 | Onlook non-Tailwind support is an unchecked roadmap item | WRONG/OBSOLETE | README now claims "all web frameworks or languages your dev server already supports" [O1]; issue #3154 disputes it [O5]. Reason it can claim this: agent does the edit, not an AST. |
| 6 | Lovable: stable compile-time ID per JSX element via Vite plugin; code synced to browser as AST; optimistic preview with client-side Tailwind; "only precisely modified lines" diffed; HMR | CONFIRMED | [L1] |
| 7 | 10Web: build injects source-location identity; AST not text replace; preview <100 ms; three state layers (preview, Redux edits slice, backend written on Save); arbitrary values and inline styles pitfalls | CONFIRMED | [T1]. Note: "<100 ms" is a stated figure, not a benchmark; inline styles are a deliberate fidelity trade-off, not a defect. |
| 8 | dev.to engine: patch only the node, only changed characters, Prettier only on deliberate saves, comments via attached ranges | CONFIRMED (vendor claim) | [D1]. It is CrossUI Studio's own description; no benchmarks. |
| 9 | DevTools Workspaces: Ctrl/Cmd+S saves; DOM edits not saved ("DOM Tree != HTML"); `.well-known/appspecific/com.chrome.devtools.json` | CONFIRMED | [C1]. Extra: saving CSS applies without reload, HTML needs a reload. |
| 10 | parse5 `sourceCodeLocationInfo`: implicit nodes get undefined location | CONFIRMED | [P1]. The ParserOptions page does not describe `startTag`/`endTag`/attribute locations; the ElementLocation page 404'd [P2]. Attribute-level splice ranges therefore remain STILL UNVERIFIED from docs; test in a spike. |
| 11 | magic-string: edits reference the original string, splice-based | CONFIRMED | [M1]. Gotchas to add to plan: overlapping/nested edits throw ("cannot split a chunk that has already been edited"); `overwrite` also drops appended content in range while `update` keeps it; use `move` for reparenting; `magic-string-stack` for chained edits; out-of-range indices throw. |
| 12 | PostCSS positions are line/column only, must convert to offsets | WRONG | PostCSS 8.0 added `Node#source.offset` (a fix landed in 8.4.29) [PC1]. The API page itself only shows line/column in its example [PC2], which is probably where 05 got it. Use `source.start.offset` on >= 8.4.29 and verify in a spike. |
| 13 | PostCSS `raws` give byte-equal round-trip; hand-built nodes lack raws | CONFIRMED | [PC2] |
| 14 | Pinegrow: watches files, compares versions, updates only modified elements | CONFIRMED in 05 (fetched then); not re-fetched here | - |
| 15 | GrapesJS: HTML/CSS parse into component model, classes shared by default | not re-fetched | Treat as previously confirmed. |
| 16 | Framer write-back: no claim possible | STILL UNVERIFIED, partly clarified | Official route is Framer MCP (remote) or legacy local CLI for agents; Code Sync plugin is file transfer of .tsx, not live sync [FR1]. No evidence of canvas to local-source write-back. On-page editing syncs to the Framer project, not local files [FR1]. |
| 17 | Polypane write-back: no claim possible | STILL UNVERIFIED | Docs index lists Workspaces and Reload CSS with no detail [PO1]; searches returned nothing Polypane-specific. |
| 18 | Webflow is closed/export-only | CONFIRMED and sharpened | DevLink Export is one-way, exported components are overwritten on next export, no write-back [W1]. |
| 19 | git merge-file: three-way, `-p`, `--diff3`, `--ours/--theirs/--union` | CONFIRMED | [G1]. Additions: `--zdiff3`, `--diff-algorithm={patience,histogram,minimal,myers}` (histogram suggested to avoid false matches such as braces), exit status = number of conflicts (capped 127), negative = error, `--object-id` merges blobs from the repo without files, no whitespace options. |

## C. Newer tools and techniques (Part 2)

| Tool | What it does (fetched) | What it does better than our plan |
|---|---|---|
| Onlook desktop (Nov 2026) | Electron, local-first; agent edits in a worktree on a new branch; result returns as PR [O1][O2] | Worktree isolation: user's checkout never touched; branch per session. Same idea as our git three-way merge but safer by construction. |
| Figma Make local code (beta, 28 May 2026) | Select elements, change properties; agent locates and edits code; annotations for interactions; branches, revert, PRs [FM1] | Annotation-as-prompt for non-style changes (behaviour, animation). Git controls inside the editor. |
| Cursor Design Mode (Cursor 3) | Click element, Arrow Up/Down moves highlight to parent/child, Shift adds elements; agent gets tag, id, classes, selector path, text, size, position, 6 computed styles + cropped screenshot; Batch edits sends all notes in one message; Cmd+Z only undoes markup [CU1] | Rich "context packet" per element (good AI-fallback payload); batch queue of pending notes; keyboard parent/child traversal. Its undo gap is a negative lesson. |
| Replit Visual Editor | Simple edits (text, colour, spacing) written to source directly with no agent; complex ones send targeted metadata to the agent; loop-rendered elements update everywhere; label jumps to source; no documented undo, only Discard [R1] | Clear two-tier routing: deterministic first, AI only for complex. Matches our plan; confirms it. Undo is a gap in their docs. |
| CSS Studio | Edits in browser sent as structured JSON to the local agent, which applies to source [CS1] | Structured JSON edit description as the hand-off format. Useful for our AI fallback and for logging. |
| Layrr | Open-source CLI, proxy dev server on 9999 over a running server; edits real files; React/Vue/Svelte/HTML [LY1] | Proxy injection pattern, no framework plugin. Mechanism not documented. |
| GreenLight (VS Code ext.) | Two-way sync between canvas and HTML/Astro on disk; external/agent edits appear on canvas; local files only, one document at a time [GL1] | Closest to our scope. No mapping, parser, or undo detail published, so nothing to copy beyond confirming demand. |
| Webflow DevLink Export (Apr 2026) | Static React export, one-way, overwrite warning; prop name sanitising rules [W1] | Counter-example: one-way export cannot hold hand edits. Supports our git three-way approach. |
| Framer MCP / Sitewright | Agents edit Framer project via MCP; Sitewright journals each change locally for one-by-one undo or checkpoint [FR1] | Per-change journal with undo to any checkpoint (see idea 3). |
| Mergiraf | Syntax-aware git merge driver; supports HTML and XML; line merge first, tree merge only when needed; keeps conflict markers when unsure; `mergiraf review` [MG1][MG2] | Drop-in structural merge for the sync step instead of plain `git merge-file`. Candidate for the conflict path. |
| Jujutsu operation log | Each operation stores a snapshot "view"; `undo`, `op revert` of a non-latest op, `op restore`; `--at-op` time travel; lock-free concurrency [J1] | Undo model for the whole project, including external edits and merges (see idea 2). |

## D. New ideas, ranked

MUST
1. **Structured edit record as the single currency.** Every edit is JSON `{target key, kind, prop, before, after, scope}` (CSS Studio, Replit routing). Used for undo, for the diff panel, and as the AI-fallback payload. [CS1][R1]
2. **Operation log with whole-project snapshots (jj style) instead of only an in-memory inverse-patch stack.** Each op stores the resulting file hashes; undo, selective revert of an earlier op, and restore are all cheap, and external edits and merges become ordinary ops so the stack no longer "clears" when Claude Design pulls. [J1] This directly fixes the 04 pitfall "external edits invalidate the stack".
3. **Worktree or shadow-branch isolation for the sync step.** Editor writes to its own branch/worktree; merge back is an explicit step. Never touch the user's checkout. [O2]
4. **Two-tier edit routing: deterministic splice first; mark unmappable edits "needs AI" and hand over a context packet** (tag, id, classes, selector path, text, rect, a few computed styles, cropped screenshot). [R1][CU1]
5. **magic-string safeguards:** collect all edits of one user action against the original text, apply in a single pass, re-parse after; guard against overlapping edits (they throw); prefer `update` over `overwrite` when other edits attach content; use `move` for reparent. [M1]
6. **Spike for parse5 attribute ranges** (docs do not describe them) and for PostCSS `source.start.offset`; do not rely on line/column conversion. [P1][P2][PC1]

SHOULD
7. **Mergiraf as the conflict resolver** after a plain three-way fails, with `git merge-file --diff-algorithm=histogram --zdiff3` as the default engine; treat exit code > 0 as a conflict count, < 0 as error. [MG1][MG2][G1]
8. **Annotation pins that become prompts** for edits we cannot do deterministically (behaviour, animation), queued and sent as a batch. [FM1][CU1]
9. **Keyboard traversal on canvas:** arrows move selection to parent/child (Cursor) alongside Figma's Enter/Tab/Shift+Enter. [CU1][F4]
10. **Edit-all-instances routing for repeated markup** (loop-rendered elements update everywhere), which fits our `<sc-for>`. [R1]
11. **Show source jump label on selected element.** [R1]

LATER
12. Proxy-injection mode for arbitrary dev servers (Layrr style) if we ever leave the artboard-file format. [LY1]
13. Per-op journal export for "undo one change at a time" in an agent session (Sitewright idea). [FR1]
14. Whole-project time-travel view (`--at-op` analogue) rendering a past snapshot read-only. [J1]

AVOID
- One-way export models (DevLink): overwritten on re-export. [W1]
- Agent-only edits as the primary path: Onlook's current "all frameworks" claim is disputed in its own issues. [O5]
- Undo that covers only UI markup (Cursor) or has no documented revert after save (Replit). [CU1][R1]

## E. Residual gaps
- Onlook: only the first page of issues was read; AGENTS.md says nothing about element mapping; whether v1's `data-oid`/Babel code remains in `main` is unknown.
- Framer and Polypane write-back still cannot be asserted from sources.
- Figma drag-reorder, layer search and paste-to-replace not found on help pages.
- Claude Design's own `support.js` / `{{hole}}` / `<sc-for>` behaviour is not covered by any public source checked.

## Sources (all fetched via WebFetch unless noted)
Figma
- [F1] https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
- [F2] https://www.figma.com/blog/behind-the-feature-autosave/
- [F3] https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history
- [F4] https://help.figma.com/hc/en-us/articles/360041539473-Intro-to-layers
- [F5] https://help.figma.com/hc/en-us/articles/360039831974-View-layers-and-assets-in-the-left-sidebar
- [F6] https://help.figma.com/hc/en-us/articles/360041112614
- [F7] https://help.figma.com/hc/en-us/articles/360041596573-Lock-and-unlock-layers
- [F8] https://help.figma.com/hc/en-us/articles/360039150733
- [FM1] https://www.cmswire.com/digital-experience/figma-make-brings-visual-editing-to-live-codebases/ (plus WebSearch result lists, not fetched: alternativeto.net/news/2026/5/figma-make-enables-direct-codebase-editing-and-git-workflows-in-beta/)
Onlook and write-back tools
- [O1] https://raw.githubusercontent.com/onlook-dev/onlook/main/README.md
- [O2] https://docs.onlook.com/developers/architecture
- [O3] https://blog.logrocket.com/onlook-react-visual-editor
- [O4] https://github.com/onlook-dev/onlook
- [O5] https://github.com/onlook-dev/onlook/issues
- (AGENTS.md, fetched: https://github.com/onlook-dev/onlook/blob/main/AGENTS.md)
- [L1] https://lovable.dev/en/blog/visual-edits
- [T1] https://10web.io/blog/building-a-visual-point-click-editor-on-top-of-agent-generated-react-what-it-takes/
- [D1] https://dev.to/linb/why-we-rejected-the-export-and-fork-model-for-visual-ui-editing-d5g
- [C1] https://developer.chrome.com/docs/devtools/workspaces
Libraries
- [P1] https://parse5.js.org/interfaces/parse5.ParserOptions.html
- [P2] https://parse5.js.org/interfaces/parse5.ElementLocation.html (404)
- [M1] https://github.com/Rich-Harris/magic-string
- [PC1] https://github.com/postcss/postcss/blob/main/CHANGELOG.md
- [PC2] https://postcss.org/api/
- [G1] https://git-scm.com/docs/git-merge-file
- [MG1] https://mergiraf.org/
- [MG2] https://mergiraf.org/languages.html
- [J1] https://docs.jj-vcs.dev/latest/operation-log/
Newer tools
- [CU1] https://cursor.com/docs/agent/design-mode
- [R1] https://docs.replit.com/replitai/visual-editor
- [CS1] https://www.producthunt.com/products/css-studio
- [LY1] https://www.producthunt.com/products/layrr
- [GL1] https://tquinonero.github.io/posts/greenlight-visual-editor-future-in-code-visual-design
- [W1] https://developers.webflow.com/devlink/docs/component-export/whats-exported
- [PO1] https://polypane.app/docs/
- [FR1] WebSearch only (pages not fetched): https://www.framer.com/developers/mcp , https://www.framer.com/marketplace/plugins/sitewright/ , https://www.framer.com/marketplace/plugins/code-sync
- Also WebSearch only: https://www.onlook.com/workflows/claude-code (fetched; no integration detail), https://www.builder.io/blog/claude-code-visual-editor (fetched)
