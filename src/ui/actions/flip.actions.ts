import type { EdId, EditOp } from '../../shared/types'
import type { EditorAction, EditorContext } from '../plugin-api'
import { authoredValue } from './align.actions'

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

/** Removes `scale` at `1 1`, so flipping twice restores an element that had none. */
function scaleOp(edId: EdId, scale: string): EditOp {
  if (scale === IDENTITY) return { target: [edId], kind: 'removeDecl', payload: { prop: 'scale' } }
  return { target: [edId], kind: 'setDecl', payload: { prop: 'scale', value: scale } }
}

function flip(axis: FlipAxis) {
  return (ctx: EditorContext, actionId: string) => {
    for (const edId of selected(ctx)) {
      const op = scaleOp(edId, flippedScale(authoredValue(ctx, edId, 'scale'), axis))
      // The ws client reports a refused op with its own toast.
      ctx.apply(op, actionId).catch(() => {})
    }
  }
}

export const actions: EditorAction[] = [
  { id: 'flip.horizontal', label: 'Flip horizontal', kbd: 'Shift+H', scope: ['canvas', 'layers'], run: flip('x'), when: whileEditable },
  { id: 'flip.vertical', label: 'Flip vertical', kbd: 'Shift+V', scope: ['canvas', 'layers'], run: flip('y'), when: whileEditable },
]
