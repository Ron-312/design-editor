# 06 — Project format (M0 stand-in)

Status: written 2026-11-23 from the Design type's documented format (SKILL.md, `reference/format.md`, as quoted in critic v2, v4 and v5), not from a live pull. The fixtures under `test/fixtures/canvas/` and `test/fixtures/endings/` are hand-made to match it, and `test/m0/` pins them.

## What was not run, and why

Per Ron's adjustment (2), M0 runs as a stand-in: no live check has been run against Claude Design or the Artifact tool, and Test Site was neither pulled nor copied. Each live check below is not run and stays open until a live M0 session does it:

- Pull of one real canvas (file layout, `/_blob/` ids, the `support.js` release).
- Publish → read round-trip, byte-exact or wrapped.
- Partial publish: whether one refused file rejects the whole call.
- Save footprint of the built-in editor (lines touched by a one-property Save).
- Theme menu write: what picking a token writes into the artboard.
- Version history: what Artifact versions show, and whether one can be diffed or restored.
- Design system location after 2026-12-14 and its API.
- Whether `support.js` waits for a host-page postMessage, and whether it runs under the sandboxed serving layer.
- Whether `data-ed-id` survives the real runtime's template expansion.
- What the built-in canvas editor already does (snapping, Alt-measure, gap/padding handles, Hug / Fill / Fixed, token binding).

## Format as fixtured

Branch: **Design canvas**. A project is `project/canvas.json` plus one `*.dc.html` per artboard, with design-system tokens in `project/ds/core/tokens.json`.

- `canvas.json` holds `boards` keyed by artboard path relative to `canvas.json`, each `{x, y, w, h}`, an `order` that names every board once, `pages` (board keys), and a `designSystems` record pointing at `ds/core/tokens.json`. The editor never writes it.
- Each `.dc.html` loads the runtime with `<script src="./support.js">` in `<head>` and has one `<x-dc>` root in `<body>`. Inside it: a `<helmet>` with `<style>` (page basics, `@media` allowed), the Google Fonts `css2` `<link>` and any `/_blob/<id>` stylesheet; the markup, with inline `style` as the main authoring surface; and one `<script data-dc-script>` holding `class Component extends DCLogic` with `renderVals()`.
- `{{ hole }}` lookups read `renderVals()` output, in text, plain attributes and inline `style` values, and are read-only in the editor.
- Assets are root-absolute `/_blob/<32-hex id>` urls. Blob CSS may reference further blobs through `url(/_blob/<id>)`. The cache saves each as `<id>.<ext>` next to `support.js` (`test/fixtures/canvas/fetched/`); push never sends it.
- CSS lives inline and in `<helmet><style>`; blob stylesheets are read-only. Scripts: the runtime plus one `DCLogic` class per artboard.

Assumed, not documented in what was read, and to be confirmed by the live pull:
- `<sc-for list="{{ items }}" as="item">`: the `list` attribute takes a whole-value hole and `as` names the per-item variable; the element children are the template, rendered once per item.
- `<sc-if when="{{ flag }}">`: the condition attribute is named `when`; a falsy value leaves the branch out.
- `<dc-import src="./card.dc.html">`: `src` is relative to the importing artboard; the imported file's `<x-dc>` children mount inside the element.
- `data-props` is a single-quoted JSON attribute on `<x-dc>` itself, carrying `$preview: {w, h}` equal to the board size in `canvas.json`.
- `tokens.json` is nested groups of `{ "value": … }` leaves.

## Runtime stand-in

`test/fixtures/canvas/fetched/support.js` is a small stand-in for the type's runtime, not a copy of it. It defines `DCLogic`, runs the artboard's `Component.renderVals()`, fills holes, repeats `<sc-for>` templates, drops false `<sc-if>` branches, fetches and mounts `<dc-import>` files, keeps every source attribute (so `data-ed-id` survives expansion, and the id fallback is not exercised) and never touches storage, cookies or `postMessage`. Its release is "stand-in"; the real cache key is recorded on the first live pull.

## Offsets on LF, CRLF and BOM inputs

Confirmed in code (`test/m0/fixtures.test.ts` on `test/fixtures/endings/edge.*.dc.html`): on LF, CRLF, mixed, UTF-8-BOM and no-trailing-newline inputs, decoded with the BOM kept, every parse5 `startOffset` slices to the element's own start tag, every attribute location slices to `name="value"`, and PostCSS `source.start.offset` / `source.end.offset` slice to the declaration text in both `<helmet><style>` and inline `style` values.

## Branches taken at exit

Kill bar: snapping and Alt-measure were not found in the built-in editor, because the check was not run, so the kill bar applies as go ahead as planned. Every differentiator is kept: snapping, Alt-measure, Auto Layout handles, Hug / Fill / Fixed and token binding, plus git line diffs and offline editing. M1–M6 keep their scope. Ron confirms or reverses this on return.

Merge: with no Save footprint measured, push keeps the line-level merge (`git merge-file`) and its conflict UI; the token-level node-diff3 retry stays in Next.

Token write form: with no Theme menu observation, picking a token from `tokens.json` writes the token's literal value into the inline `style`, as the Theme menu is assumed to do.

The `:root --*` fallback, used only when a canvas has no `tokens.json`, writes `var(--x)`.

Publish round-trip: assumed byte-exact, so no normalisation step; Goal 2 holds against the pulled baseline either way.

Throwaway copy: the copy recipe (create from the Design `type_url`, publish the pulled files, check whether the original `/_blob/` ids render, else copy assets server-side and rewrite ids) is left for the live run, which records the steps and the id map here. M6 reuses it.

Effort: M1–M5 are not re-estimated; the Effort table stands until the live M0 run.
