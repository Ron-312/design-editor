# 05 - Prior art: visual editors that write back to real source

Scope: how existing tools map a clicked DOM element to a source location, what they write (inline / class / rule), how they preserve formatting, and how they refresh. Every claim below cites a URL that was fetched in this session. Where a fetch did not answer a question, that is stated as a gap, and anything not backed by a fetch is marked UNVERIFIED.

## 1. Findings per tool

### Onlook (React/Next.js + Tailwind)
- **Mapping**: injects a `data-oid` attribute (e.g. `<TodoContainer data-oid="zshvwmp"/>`) into elements in dev so it can link visual elements to code [S3]. The AST README: parse source, build a map `data-oid -> {file, start/end position, component name}`; walk the DOM, compare each node's component name to its parent's to detect component instances; verify against the parent's source by child index + name [S2].
- **Write**: Babel AST manipulation (`@onlook/parser`, per third-party summary in search results, not confirmed from primary source) [S1-search]. The style editor modifies Tailwind classes [S2]. Edits are non-persistent until written to code (search-result summary of docs) [S1-search].
- **Newer direction**: the current desktop app delegates edits to Claude Code/Codex in a git worktree copy and returns changes via git/PR [S4, S5]. So Onlook itself moved away from deterministic AST writes toward agent edits.
- **Gap**: I could not retrieve the DeepWiki page (HTTP 429) or the primary AST README; how formatting/comments survive was not found. Non-Tailwind support is an unchecked roadmap item [S6].
- **Verdict**: ADAPT the id-injection idea. For plain HTML we do not need component-instance disambiguation, which is the hardest part of Onlook's algorithm.

### Lovable Visual Edits
- A Vite plugin gives each JSX element a stable compile-time ID that persists across edits; the project is synced into the browser as an AST; class edits are applied to the AST and previewed optimistically by a client-side Tailwind generator; on save clean JSX is generated and only changed lines are diffed, then HMR refreshes [S7].
- **Takeaway**: optimistic live preview first, write-back second.

### 10Web (agent-generated React point-click editor) - best engineering write-up found
- Build step injects a source-location-encoded identity into every element so the click-to-source bridge exists before interaction. Nested/attribute-less nodes are harder to resolve [S8].
- Structural AST edits, not string replacement (string replace can corrupt adjacent nodes). Preview DOM updates in <100 ms; AST modify + rebundle happen in the background because a naive full round trip takes seconds [S8].
- Three state layers must stay coherent: in-memory preview, edit store with undo history, backend source written on explicit save. Unsaved visual edits are invisible to anything else reading source [S8].
- Pitfalls: arbitrary values outside the known token vocabulary cannot map to controls; inline styles sit outside the theme system [S8].

### Minimal-diff AST patching (dev.to article)
- Patch only the AST node tied to the visual change; "only the characters that changed" are written; Prettier runs only on deliberate saves, not every visual edit; comments are tracked by attached ranges. Serialize-whole-file approaches drop comments and reformat [S9]. (Vendor-style article for a specific product; treat as a design principle, not a verified benchmark.)

### Chrome DevTools: Workspaces, Changes, Local Overrides
- Workspaces map network resources to a local folder (green dot), connected manually or via a `.well-known/appspecific/com.chrome.devtools.json` UUID file. CSS edits in Styles apply live and are written to the file on Ctrl/Cmd+S; source maps map transpiled code back [S10].
- Explicit limitation: Elements-panel DOM edits are NOT saved because "DOM Tree != HTML" (JS/CSS can alter the DOM, so DevTools cannot tell where a change belongs) [S10]. Same for overrides: DOM edits unsaved; CSS from an inline `<style>` in an HTML file isn't saved from Styles; source-mapped files can't be overridden [S11].
- Changes tab: a per-file pretty-printed diff of session edits, copy/revert, cleared on reload [S12].
- **Takeaway**: DevTools shows why DOM-only mapping fails; the fix is to own the mapping from the source side. Its per-file diff view is a good UX model.
- CDP CSS domain (`CSS.setStyleTexts`, rule `SourceRange`): I tried to fetch the protocol docs; the pages were redirect stubs / truncated, so this is UNVERIFIED here. It likely gives stylesheet source ranges, but we should not need it because we control the DOM.

### VisBug (Google)
- In-page extension for point/click/tinker editing of live pages; the page does not claim write-back to source and the repo is archived/read-only [S13]. Prior art for the in-page UX only; not for write-back. AVOID as architecture reference.

### GrapesJS
- Component model (JSON) is the source of truth; HTML/CSS are exports; docs warn that using HTML/CSS as persistence may lose information [S14, S15]. HTML is parsed into component definitions via a type stack; unmatched elements fall back to `default`. Styling a component by default edits its existing classes, affecting every element sharing them unless `componentFirst` is set [S15].
- **Verdict**: AVOID the separate-model approach (we are explicitly "DOM/CSS is the document"). ADAPT the class-vs-element-scope toggle UX.

### Pinegrow
- Edits ordinary HTML/CSS files with no abstraction layer; live refresh; watches files for external edits and reloads them (asks first if unsaved changes) [S16, S17]. On external save it "compares both versions of the page and only updates the modified elements" [S18]. Disables live refresh on syntax errors [S17-search]. Docs do not say how formatting is preserved or how style edits are targeted (class/rule/inline) [S18].
- **Verdict**: closest product analogue to our scope. ADOPT the file-watch + diff-refresh + external-edit reconcile behaviour.

### Webflow Designer
- Class-based styling; base classes plus combo classes; exports static HTML/CSS/JS zip [S19]. Complaint: users inadvertently style a combo class when they meant the base class; naming conventions (BEM, prefixes) recommended [S19]. Webflow does not write back to your own files (it is a closed model that exports), so it is a UX reference only.
- **Takeaway**: make "which selector am I editing" always visible. This is the same trap GrapesJS has.

### Builder.io
- Stores content as JSON blocks, delivered via API/SDK; the editor loads the site in an iframe, SDK receives JSON and patches [S20]. Not source write-back. AVOID.

### Penpot
- Flex and Grid layouts are built over the real CSS specs; the Inspect/Code tab emits CSS/HTML [S21]. It is design-first with one-way code export; no write-back. ADAPT the CSS-native layout controls (flex/grid panels) mirroring real property names.

### Framer, Polypane
- Framer: could not verify source-level behaviour; results only show canvas/React code components and third-party export plugins [S22]. No claims made.
- Polypane: docs list Workspaces, Live reloading, Reload CSS but give no detail; no write-back claim can be made [S23].

## 2. Idea table

| Idea | Who | Verdict | Priority | Pitfalls |
|---|---|---|---|---|
| Inject stable id (`data-oid`-style) into every element at load time to map DOM -> source node | Onlook, Lovable, 10Web [S2,S3,S7,S8] | ADOPT (simpler for static HTML: no component instances) | MUST v1 | Ids must not be written to the user's files (strip on save) or must be derived; scripts that create DOM at runtime have no id -> mark non-editable |
| Parse source with a position-preserving parser (parse5 `sourceCodeLocationInfo` for HTML; PostCSS `source` + `raws` for CSS) | parse5 / PostCSS docs [S24,S25] | ADOPT | MUST | parse5 gives location only for explicitly-written elements; implicitly created ones (tbody, html/head/body) have undefined location [S24]. PostCSS positions are line/column, not offsets [S25]; convert to offsets |
| Minimal-diff splice edits: patch only changed byte ranges (magic-string style, edits referenced against the original text) | dev.to engine [S9], magic-string [S26] | ADOPT | MUST | Apply multiple edits in one pass against original offsets, or re-parse after each write; never reprint the whole file |
| CSS edits via PostCSS node mutation with `raws` retained, so untouched rules stay byte-identical, comments stay | PostCSS [S25] | ADOPT | MUST | Hand-built nodes have no raws; clone neighbouring node's raws for matching indentation. Comments inside values live only in raws |
| Optimistic live preview via direct DOM/CSSOM mutation, async write-back | Lovable, 10Web [S7,S8] | ADOPT | MUST | Keep three layers coherent (preview, edit log/undo, disk); round trip must not block UI |
| Per-edit target-scope choice: element-only (id/inline) vs class vs existing rule; always show selected selector | Webflow, GrapesJS complaints [S15,S19] | ADAPT | MUST | Silent edits to a shared class are the number one surprise |
| File watcher + reconcile external edits (user or Claude Design pull) | Pinegrow [S16,S17,S18] | ADOPT | MUST | Ask/merge if dirty; avoid write-loops with our own writes (ignore events for hashes we just wrote) |
| Per-file diff panel with revert | DevTools Changes [S12] | ADOPT | SHOULD | |
| Preserve unknown markup/comments by never serializing whole document | GrapesJS round-trip warning [S14,S15] | ADOPT as constraint | MUST | |
| Optional agent fallback for edits we cannot map deterministically | Onlook v2 [S4,S5] | ADAPT | LATER | Non-deterministic; keep deterministic path primary |
| CSS-native layout panels (flex/grid) with real property names | Penpot [S21] | ADAPT | SHOULD | |
| Format-on-save of whole file | (avoided by [S9]) | AVOID | - | Causes huge diffs when pushed back to Claude Design |

## 3. User complaints found (limited)
- Combo/base class confusion in Webflow [S19]; style leakage via shared classes in GrapesJS default [S15].
- DevTools: DOM-panel edits silently not persisted; inline-`<style>` CSS not saved [S10,S11].
- Whole-file serializers drop comments and reformat [S9].
- Onlook: tied to Next.js/Tailwind; only pre-release caveats found; I could not retrieve the GitHub issues themselves, so a complaint list for Onlook is a GAP [S6].

## 4. Recommended write-back architecture

**Source-first mapping, not DOM-first.** On open, parse every HTML file with parse5 (`sourceCodeLocationInfo: true`) and every CSS file / `<style>` block with PostCSS. Build an index `nodeId -> {file, startOffset, endOffset, startTag range, attr ranges}` and `ruleId -> {file, selector, declaration ranges}`. Serve the project to the preview iframe with a serving-layer transform that adds a `data-ed-id` attribute to each element (the ids are never written back to disk). Clicking resolves `data-ed-id` -> source node directly; no AST/DOM heuristics like Onlook's component-instance verification are needed because plain HTML is 1:1. Elements without an id (created by scripts, implicit parse5 nodes) are shown read-only. Also resolve which CSS rules match an element (`matches()` over the PostCSS index, or `getMatchedCSSRules`-style logic) so the panel can show the cascade and let the user pick the target.

**Edits are tiny text patches, previewed instantly.** Every user action produces an edit operation (set declaration X on target T) that is (1) applied immediately to the live DOM/CSSOM for <100 ms feedback [S8], and (2) queued as a source patch. Patches are computed on the original text with offsets and applied through a magic-string-like splice for HTML and PostCSS node mutation (raws preserved) for CSS, so that the git diff of the pushed folder contains only the changed declarations [S9,S25,S26]. Target policy, default order: if the user is editing a specific rule/class (always labelled in the UI), edit that rule; else if the element has an id/unique class rule, edit it; else add or update an inline `style` attribute (smallest change, no cascade leakage); offer "extract to class" as an explicit action. Text/attribute/structure edits splice the HTML range. Never reformat; never run Prettier on whole files. After each write, re-parse that file and rebuild its index (cheap for design-sized files), keep an undo stack of inverse patches, and write files atomically (tmp + rename).

**Sync and safety.** Watch the folder (chokidar-style); record a hash of each file we write and ignore our own events; if a file changes externally (Claude Design pull, editor), re-parse, diff, and refresh only the changed part of the preview, as Pinegrow does [S18], prompting if there are unsaved edits [S17]. Auto-save to disk with debounce rather than a manual save, since the DOM is the document; keep a per-file diff view [S12] and a "revert file" action. Refuse the DevTools trap [S10]: only DOM changes that we can attribute to a source node are accepted; everything else is surfaced as "not mapped". Before push, strip nothing (ids were never written) and run a sanity parse of every touched file.

## Sources (all fetched)
- [S1-search] WebSearch results, Onlook architecture query (summary only): https://deepwiki.com/onlook-dev/onlook , https://onlook.nodejs.cn/developers/architecture (listed, not directly fetched)
- [S2] https://docsearch.algolia.com/mcp/docs/repo/onlook-dev/onlook
- [S3] https://blog.logrocket.com/onlook-react-visual-editor
- [S4] https://docs.onlook.com/developers/architecture
- [S5] https://raw.githubusercontent.com/onlook-dev/onlook/main/README.md
- [S6] WebSearch result pages for Onlook (https://github.com/onlook-dev/onlook); issues themselves not read
- [S7] https://lovable.dev/en/blog/visual-edits
- [S8] https://10web.io/blog/building-a-visual-point-click-editor-on-top-of-agent-generated-react-what-it-takes/
- [S9] https://dev.to/linb/why-we-rejected-the-export-and-fork-model-for-visual-ui-editing-d5g
- [S10] https://developer.chrome.com/docs/devtools/workspaces
- [S11] https://developer.chrome.com/docs/devtools/overrides
- [S12] https://developer.chrome.com/docs/devtools/changes
- [S13] https://github.com/GoogleChromeLabs/ProjectVisBug
- [S14] https://grapesjs.com/docs/modules/Storage.html
- [S15] https://grapesjs.com/docs/modules/Components.html
- [S16] https://docs.pinegrow.com/docs/master-pinegrow/code-editing/
- [S17] WebSearch Pinegrow results (live refresh/syntax-error behaviour, search summary)
- [S18] https://pinegrow.com/docs/editing/code.html
- [S19] WebSearch Webflow results (summarised from https://help.webflow.com/topic/code-export and https://www.viget.com/articles/building-magic-with-webflow-a-ui-developers-perspective/; pages themselves not fetched directly)
- [S20] https://www.builder.io/c/docs/how-builder-works-technical
- [S21] WebSearch Penpot results (https://help.penpot.app/user-guide/flexible-layouts/ etc.; summary only)
- [S22] WebSearch Framer results (no primary claims made)
- [S23] https://polypane.app/docs/
- [S24] https://parse5.js.org/interfaces/parse5.ParserOptions.html
- [S25] https://postcss.org/api/
- [S26] https://github.com/Rich-Harris/magic-string
- Failed/unusable fetches: https://deepwiki.com/onlook-dev/onlook (429), CDP CSS docs (redirect stub/truncated), https://penpot.app/blog/css-grid-layout-penpot/ (404).
