import type { Rect } from '../../../shared/protocol'
import type { EdId } from '../../../shared/types'
import type { CanvasPointer, CanvasTool, EditorContext } from '../../plugin-api'
import { findNode } from '../selection'

type Side = 'top' | 'right' | 'bottom' | 'left'

const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left']
const OPPOSITE: Readonly<Record<Side, Side>> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }
const PADDING_PROPS = SIDES.map((side) => `padding-${side}`)

/** The selected element's border box and computed padding, in board px. */
interface PaddedBox {
  readonly edId: EdId
  readonly rect: Rect
  readonly padding: Readonly<Record<Side, number>>
}

interface PaddingDrag {
  readonly box: PaddedBox
  readonly side: Side
  readonly sides: readonly Side[]
  readonly from: { readonly x: number; readonly y: number }
}

let measured: PaddedBox | null = null
let drag: PaddingDrag | null = null

function editableSelection(ctx: EditorContext): EdId | null {
  const edIds = ctx.selection()?.edIds ?? []
  const tree = ctx.index()?.tree
  if (edIds.length !== 1 || !tree || ctx.readOnly()) return null
  return findNode(tree, edIds[0]!)?.readOnly ? null : edIds[0]!
}

async function measure(ctx: EditorContext, edId: EdId): Promise<PaddedBox | null> {
  const [{ rects }, { values }] = await Promise.all([
    ctx.read({ kind: 'rects', edId }),
    ctx.read({ kind: 'computed', edId, props: PADDING_PROPS }),
  ])
  const [rect] = rects
  if (!rect) return null
  const padding = Object.fromEntries(SIDES.map((side) => [side, parseFloat(values[`padding-${side}`] ?? '') || 0]))
  return { edId, rect, padding: padding as Record<Side, number> }
}

function isInside({ x, y, width, height }: Rect, pointer: CanvasPointer): boolean {
  return pointer.boardX >= x && pointer.boardX <= x + width && pointer.boardY >= y && pointer.boardY <= y + height
}

/** The padding band under the pointer; a press in the content box belongs to the other tools. */
function sideAt({ rect, padding }: PaddedBox, pointer: CanvasPointer): Side | null {
  if (!isInside(rect, pointer)) return null
  const bands: Readonly<Record<Side, boolean>> = {
    top: pointer.boardY < rect.y + padding.top,
    bottom: pointer.boardY > rect.y + rect.height - padding.bottom,
    left: pointer.boardX < rect.x + padding.left,
    right: pointer.boardX > rect.x + rect.width - padding.right,
  }
  return SIDES.find((side) => bands[side]) ?? null
}

/** Alt moves the opposite side with the dragged one; Alt-Shift moves all four. */
function sidesMoved(side: Side, pointer: CanvasPointer): readonly Side[] {
  if (pointer.altKey && pointer.shiftKey) return SIDES
  return pointer.altKey ? [side, OPPOSITE[side]] : [side]
}

function paddingAt({ box, side, from }: PaddingDrag, pointer: CanvasPointer): number {
  const dx = pointer.boardX - from.x
  const dy = pointer.boardY - from.y
  const moved = { top: dy, bottom: -dy, left: dx, right: -dx }[side]
  return Math.max(0, Math.round(box.padding[side] + moved))
}

async function writePadding(ctx: EditorContext, { box, sides }: PaddingDrag, value: number): Promise<void> {
  for (const side of sides) {
    if (box.padding[side] === value) continue
    // The ws client already toasted a rejection.
    await ctx.apply({ target: [box.edId], kind: 'setDecl', payload: { prop: `padding-${side}`, value: `${value}px` } }).catch(() => {})
  }
}

export const tool: CanvasTool = {
  id: 'padding',
  priority: 50,
  onHover(ctx) {
    const edId = editableSelection(ctx)
    if (!edId) {
      measured = null
      return false
    }
    measure(ctx, edId)
      .then((box) => {
        measured = box
      })
      // A reload rejects the rects read; the next hover measures again.
      .catch(() => {})
    return false
  },
  onPointerDown(ctx, pointer) {
    const box = measured
    if (!box || box.edId !== editableSelection(ctx)) return false
    const side = sideAt(box, pointer)
    if (!side) return false
    drag = { box, side, sides: sidesMoved(side, pointer), from: { x: pointer.boardX, y: pointer.boardY } }
    return true
  },
  onPointerMove() {
    return drag !== null
  },
  onPointerUp(ctx, pointer) {
    const finished = drag
    if (!finished) return false
    drag = null
    measured = null
    void writePadding(ctx, finished, paddingAt(finished, pointer))
    return true
  },
  onCancel() {
    drag = null
  },
}
