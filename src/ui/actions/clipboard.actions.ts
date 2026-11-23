import type { EdId } from '../../shared/types'
import { sourceHtmlOf, writeClipboardText } from '../clipboard'
import type { EditorAction, EditorContext } from '../plugin-api'

function selected(ctx: EditorContext): readonly EdId[] {
  return ctx.selection()?.edIds ?? []
}

/** The inline declarations as authored; a `{{hole}}` value is live data, not style, so it stays behind. */
function authoredCssOf(ctx: EditorContext, edId: EdId): string {
  const inline = ctx.index()?.styles[edId]?.find((source) => source.target === 'inline')
  return (inline?.declarations ?? [])
    .filter((entry) => !entry.hasHole)
    .map(({ prop, value, important }) => `${prop}: ${value}${important ? ' !important' : ''};`)
    .join('\n')
}

/** Menus, the palette and Mod-Alt-Shift-C fire no `copy` event, so these write through the async Clipboard API. */
function copyText(ctx: EditorContext, text: string): void {
  writeClipboardText(text).catch(() => ctx.toast({ message: 'The clipboard refused the copy', tone: 'error' }))
}

const hasSelection = (ctx: EditorContext) => selected(ctx).length > 0

export const actions: EditorAction[] = [
  {
    id: 'clipboard.copyCss',
    label: 'Copy as CSS',
    kbd: 'Mod+Alt+Shift+C',
    run: (ctx) => copyText(ctx, authoredCssOf(ctx, selected(ctx)[0]!)),
    when: hasSelection,
  },
  {
    id: 'clipboard.copyHtml',
    label: 'Copy as HTML',
    run: (ctx) => copyText(ctx, sourceHtmlOf(ctx.index()!, selected(ctx))),
    when: (ctx) => hasSelection(ctx) && ctx.index() !== null,
  },
]
