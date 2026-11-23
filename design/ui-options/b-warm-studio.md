# B — Warm studio: rationale

1. **Warm charcoal, not blue-black.** Panels sit on #23201d / #2c2825 with brown-grey lines, so long sessions feel like a lit workbench, and the artboards (the user's real work) are the brightest thing on screen.
2. **One clay accent, used sparingly.** Kiln orange (#e07240 dark / #b4502a light) marks only selection, the active layer, the current tool and the Push button, so the eye always lands on "what I'm editing" and "what ships".
3. **Colours mean one thing each.** Clay = selection, red = Alt-measure distances, magenta = smart guides and padding, sage = design tokens, amber = unpushed edits. No colour is reused for a second meaning.
4. **The write target is first.** The selector chip `style · hero.dc.html:42` tops the properties panel with a "used by 3 layers · This one only" warning, because the research's #1 complaint is not knowing which rule an edit lands in.
5. **Sync is a three-step strip** (Pulled 10:42 → Edited · 3 → Pushing) beside the project name, and the save toast echoes the exact splice (`border-radius: 12px → 16px L47`), so the file-backed model is always visible.
6. **Tokens look different from raw values.** A bound fill is a sage pill with a link glyph (`--paper-50`); the raw stroke hex beside it is plain mono text, so detached values stand out at a glance.
7. **Dense but calm.** 28px rows and fields, 8px gaps, 12px section padding, all on a 4px grid; 6–8px radii (12px for floating surfaces) soften the tool without making it toy-like. The panel fits all eight sections at 900px tall.
8. **Type:** Instrument Sans with tabular numerals for every number field, JetBrains Mono only for code facts (selectors, file:line, hex), and sentence-case section titles instead of shouty caps.
9. **Contrast checked:** body and secondary text are 8–15:1, the dimmest label is 4.8:1 or better in both themes, and the white-on-red measure and white-on-clay light-theme labels are above 4.5:1.
10. **Light theme is a full peer** (`<html class="light">`, sun/moon button or `#light` in the URL): warm paper panels, the same hues darkened for AA, and a single icon set (16px, 1.5 stroke, round joins) shared by both themes.
