import type { AuthoredDeclaration, EdId } from '../../shared/types'
import type { EditorAction, EditorContext } from '../plugin-api'

// Keyed by context so each editor session starts with an empty clipboard.
const copied = new WeakMap<EditorContext, readonly AuthoredDeclaration[]>()

function selected(ctx: EditorContext): readonly EdId[] {
  return ctx.selection()?.edIds ?? []
}

/** The inline declarations as authored; a `{{hole}}` value is live data, not style, so it stays behind. */
function authoredStyleOf(ctx: EditorContext, edId: EdId): AuthoredDeclaration[] {
  const inline = ctx.index()?.styles[edId]?.find((source) => source.target === 'inline')
  return inline?.declarations.filter((entry) => !entry.hasHole) ?? []
}

function copyStyle(ctx: EditorContext): void {
  copied.set(ctx, authoredStyleOf(ctx, selected(ctx)[0]!))
}

async function pasteStyle(ctx: EditorContext, declarations: readonly AuthoredDeclaration[], actionId: string): Promise<void> {
  const target = selected(ctx)
  const results = await Promise.allSettled(
    declarations.map(({ prop, value, important }) =>
      ctx.apply({ target, kind: 'setDecl', payload: { prop, value, ...(important ? { important } : {}) } }, actionId),
    ),
  )
  // The ws client already toasted each rejection.
  const applied = declarations.filter((_, at) => results[at]!.status === 'fulfilled').map(({ prop }) => prop)
  if (applied.length > 0) ctx.toast({ message: `Pasted style: ${applied.join(', ')}`, tone: 'info' })
}

const hasSelection = (ctx: EditorContext) => selected(ctx).length > 0

export const actions: EditorAction[] = [
  { id: 'style.copy', label: 'Copy style', kbd: 'Mod+Alt+C', run: copyStyle, when: hasSelection },
  {
    id: 'style.paste',
    label: 'Paste style',
    kbd: 'Mod+Alt+V',
    run: (ctx, actionId) => void pasteStyle(ctx, copied.get(ctx) ?? [], actionId),
    when: (ctx) => !ctx.readOnly() && hasSelection(ctx) && copied.has(ctx),
  },
]
