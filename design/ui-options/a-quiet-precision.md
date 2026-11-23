# A · Quiet precision: rationale

1. **Idea:** the chrome stays quiet so the user's artboards carry all the colour; precision shows in alignment, numbers and overlays, not in decoration.
2. **Neutrals (light):** `--bg #F3F4F6`, `--panel #FFF`, `--canvas #E7E8EB`, `--field #F1F2F4`, `--line #E5E6EA`, `--line-2 #D3D6DB`; text `#16181B / #474C55 / #646973` (17.6, 8.6 and 5.4:1 on panel).
3. **Neutrals (dark, `html.dark`):** panel `#17181B`, canvas `#212226`, field `#222327`, line `#26282C`; text `#ECEDEF / #B5B9C0 / #8F949C` (all 5:1 or better on panel and field).
4. **One accent:** `--accent #2F55D4` (dark `#7B97FF`) is used only for the selection, focus, bound tokens, the "Edited" state and Push. Canvas overlays get their own meanings: measure `#D23746`, smart guide `#C0268A`, padding shown as hatching.
5. **Type:** Inter 12/16 for values and rows, 11/16 for labels, captions and rulers, 600 weight only for section titles. Tabular figures everywhere; JetBrains Mono 11 for selectors, file:line and CSS values.
6. **Spacing:** everything sits on a 4px grid: 24px controls and layer rows, 28px rhythm between property rows, 32px section headers and tabs, 44px top bar, 12px panel gutters, 12px indent per tree level.
7. **Structure:** a fixed 56px label column in the properties panel lines up every value field (two 96px fields per row). Hairline 1px dividers between sections, with no boxes or cards.
8. **Feels precise because:** rulers show the selection's exact range (624–1088, 144–584); the size chip says "464 × 440 Hug"; handles sit on half-pixel centres; measure, guide and padding cues use different colours and patterns; the dashed outline on Mobile marks the same source element.
9. **Source honesty:** the selector chip `style · hero.dc.html:42` and the "Inline style · only this element" line sit above every property. Tokens show as accent pills with `var(--ink-900) · #14213D` below, so you always know what gets written.
10. **Sync is calm but always visible:** a Pulled → Edited → Pushing stepper, a dot on the changed page, a "Changes 1" tab and a short toast with Undo ("1 change saved · hero.dc.html · padding 24 → 32").
