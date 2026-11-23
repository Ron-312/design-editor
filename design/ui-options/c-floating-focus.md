# C — Floating focus: rationale
1. The canvas owns all 1440×900 px; every control floats on it as a rounded card, so the artboards are the visual hero and the chrome never boxes them in.
2. Cards are 90% (dark) / 84% (light) opaque with a 20px backdrop blur: translucent enough to feel light, opaque enough that tertiary text stays ≥4.9:1 even over a white artboard.
3. Each card collapses on its own (sidebar buttons, `⌘\` hides both panels), which leaves only the dock and the canvas when you want to look at the work.
4. The sync stepper (Pulled → Edited · 3 changes → Pushing) makes the pull/edit/push loop from plan.md readable at a glance; Pushing stays inert because push runs from `/design-push`.
5. The selector chip (`style · hero.dc.html:42`) sits at the top of the properties card, so the user always sees which rule and line an edit will write to, the top complaint from the research.
6. The properties follow the Figma-proven order (Position, Auto layout, Appearance, Fill, Stroke, Effects, Typography), and Hug/Fill/Fixed is a visible segmented control per axis rather than a hidden menu.
7. Tokens show as accent pills with a detach button, so a bound `var(--surface-raised)` is obviously different from a raw hex like the stroke's `E7E3DA`.
8. Canvas overlays use four distinct colours: blue selection plus hatched padding, magenta smart guide, red Alt-measure, and a red tick on the matching layer row, so they never get confused with one another.
9. The type is Manrope (geometric, with tabular numerals on every number) plus JetBrains Mono for files, selectors and CSS values; the glacier-blue accent stays clear of the page's own warm green palette.
10. Everything sits on a 4px grid (28px rows, 8px gaps, 12px card padding, 16px radii), with one 1.5-stroke icon set; the theme switches by toggling `theme-dark` / `theme-light` on `<html>`.
