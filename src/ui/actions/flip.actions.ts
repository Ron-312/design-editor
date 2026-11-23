import type { EdId } from '../../shared/types'
import { authoredDecl, readMatchedRules, removeDecl, ruleDecl, writeDecl } from '../canvas/authored'
import type { EditorAction, EditorContext } from '../plugin-api'

type FlipAxis = 'x' | 'y'

const IDENTITY = '1 1'

function selected(ctx: EditorContext): readonly EdId[] {
  return ctx.selection()?.edIds ?? []
}

const whileEditable = (ctx: EditorContext) => !ctx.readOnly() && selected(ctx).length > 0

/** Negates the authored text itself, so flipping back restores the same bytes. */
function negated(factor: string): string {
  return factor.startsWith('-') ? factor.slice(1) : `-${factor}`
}

/** A single `scale` value counts as both axes and no `scale` as `1 1`; a z factor is kept as it is. */
function flippedScale(authored: string | null, axis: FlipAxis): string {
  const factors = authored === null || authored.trim() === 'none' ? ['1', '1'] : authored.trim().split(/\s+/)
  const [x = '1', y = x, ...z] = factors
  const flipped = axis === 'x' ? [negated(x), y, ...z] : [x, negated(y), ...z]
  return flipped.join(' ')
}

/**
 * Removes `scale` at `1 1`, so flipping twice restores an element that had none. A rule's `scale` is
 * shared with every element the rule matches, so it is overridden inline rather than edited.
 */
async function flipElement(ctx: EditorContext, edId: EdId, axis: FlipAxis, actionId: string): Promise<void> {
  const rules = await readMatchedRules(ctx, edId)
  const authored = authoredDecl(ctx, edId, 'scale', rules)
  const scale = flippedScale(authored?.value ?? null, axis)
  if (scale === IDENTITY && authored?.source === 'inline' && ruleDecl(rules, 'scale') === null) return removeDecl(ctx, edId, 'scale', actionId)
  writeDecl(ctx, edId, 'scale', scale, actionId)
}

function flip(axis: FlipAxis) {
  return (ctx: EditorContext, actionId: string) => {
    // A reload rejects the reads; the flip is then dropped.
    for (const edId of selected(ctx)) void flipElement(ctx, edId, axis, actionId).catch(() => {})
  }
}

export const actions: EditorAction[] = [
  { id: 'flip.horizontal', label: 'Flip horizontal', kbd: 'Shift+H', scope: ['canvas', 'layers'], run: flip('x'), when: whileEditable },
  { id: 'flip.vertical', label: 'Flip vertical', kbd: 'Shift+V', scope: ['canvas', 'layers'], run: flip('y'), when: whileEditable },
]
