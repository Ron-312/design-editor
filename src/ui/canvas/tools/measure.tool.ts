import type { Rect } from '../../../shared/protocol'
import type { EdId, TemplateNode } from '../../../shared/types'
import type { CanvasPointer, CanvasTool, EditorContext } from '../../plugin-api'
import { screenBoxOf } from '../overlay'
import { findNode } from '../selection'
import { drawLayer, lineBox, overlayMark, parentNodeOf } from './move.tool'

type Spacing = 'margin' | 'padding' | 'gap'

/** A distance in board px, drawn from (x1, y1) to (x2, y2) along one axis. */
interface Distance {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly length: number
}

const LAYER = 'measure'
const GAP_DISPLAYS = ['flex', 'inline-flex', 'grid', 'inline-grid']

let measuring = 0

function contains(tree: TemplateNode, outer: EdId, inner: EdId): boolean {
  const node = findNode(tree, outer)
  return node !== null && node.edId !== inner && findNode(node, inner) !== null
}

function right(rect: Rect): number {
  return rect.x + rect.width
}

function bottom(rect: Rect): number {
  return rect.y + rect.height
}

function centreX(rect: Rect): number {
  return rect.x + rect.width / 2
}

function centreY(rect: Rect): number {
  return rect.y + rect.height / 2
}

/** From each edge of `inner` out to the matching edge of `outer`. */
function insetDistances(inner: Rect, outer: Rect): Distance[] {
  const x = centreX(inner)
  const y = centreY(inner)
  return [
    { x1: x, y1: outer.y, x2: x, y2: inner.y, length: inner.y - outer.y },
    { x1: x, y1: bottom(inner), x2: x, y2: bottom(outer), length: bottom(outer) - bottom(inner) },
    { x1: outer.x, y1: y, x2: inner.x, y2: y, length: inner.x - outer.x },
    { x1: right(inner), y1: y, x2: right(outer), y2: y, length: right(outer) - right(inner) },
  ]
}

/** The empty space between two rects that do not overlap, on each axis they are apart. */
function separationDistances(a: Rect, b: Rect): Distance[] {
  const [upper, lower] = a.y <= b.y ? [a, b] : [b, a]
  const [leftmost, rightmost] = a.x <= b.x ? [a, b] : [b, a]
  const x = (Math.max(a.x, b.x) + Math.min(right(a), right(b))) / 2
  const y = (Math.max(a.y, b.y) + Math.min(bottom(a), bottom(b))) / 2
  return [
    { x1: x, y1: bottom(upper), x2: x, y2: lower.y, length: lower.y - bottom(upper) },
    { x1: right(leftmost), y1: y, x2: rightmost.x, y2: y, length: rightmost.x - right(leftmost) },
  ]
}

function distanceMarks(ctx: EditorContext, distances: readonly Distance[], spacing: Spacing): HTMLElement[] {
  const viewport = ctx.viewport()
  return distances
    .filter((distance) => distance.length > 0)
    .flatMap((distance) => {
      const rect = { x: distance.x1, y: distance.y1, width: distance.x2 - distance.x1, height: distance.y2 - distance.y1 }
      const box = lineBox(screenBoxOf(viewport, rect))
      const line = overlayMark({ 'data-measure-line': '' }, box, { background: 'var(--measure)' })
      const label = overlayMark({ 'data-measure-label': '' }, { left: box.left + box.width / 2 + 4, top: box.top + box.height / 2 - 8, width: 0, height: 16 }, {
        width: 'auto',
        padding: '0 4px',
        borderRadius: '3px',
        background: 'var(--measure)',
        color: '#fff',
        font: '600 11px/16px system-ui, sans-serif',
        whiteSpace: 'nowrap',
      })
      label.textContent = `${spacing} ${Math.round(distance.length)}`
      return [line, label]
    })
}

async function siblingSpacing(ctx: EditorContext, tree: TemplateNode, a: EdId, b: EdId): Promise<Spacing> {
  const parent = parentNodeOf(tree, a)
  if (!parent || parent !== parentNodeOf(tree, b)) return 'margin'
  const { values } = await ctx.read({ kind: 'computed', edId: parent.edId, props: ['display'] })
  return GAP_DISPLAYS.includes(values.display ?? '') ? 'gap' : 'margin'
}

async function measure(ctx: EditorContext, pointer: CanvasPointer): Promise<HTMLElement[]> {
  const index = ctx.index()
  const [selected] = ctx.selection()?.edIds ?? []
  if (!index || !selected) return []
  const { edId: hovered } = await ctx.read({ kind: 'hitTest', x: pointer.boardX, y: pointer.boardY, depth: 'deepest', within: null })
  if (!hovered || hovered === selected) return []
  const [selectedRects, hoveredRects] = await Promise.all([ctx.read({ kind: 'rects', edId: selected }), ctx.read({ kind: 'rects', edId: hovered })])
  const from = selectedRects.rects[0]
  const to = hoveredRects.rects[0]
  if (!from || !to) return []
  if (contains(index.tree, hovered, selected)) return distanceMarks(ctx, insetDistances(from, to), 'padding')
  if (contains(index.tree, selected, hovered)) return distanceMarks(ctx, insetDistances(to, from), 'padding')
  return distanceMarks(ctx, separationDistances(from, to), await siblingSpacing(ctx, index.tree, selected, hovered))
}

function onHover(ctx: EditorContext, pointer: CanvasPointer): boolean {
  const run = ++measuring
  if (!pointer.altKey) {
    drawLayer(LAYER, [])
    return false
  }
  measure(ctx, pointer)
    .then((marks) => {
      if (run === measuring) drawLayer(LAYER, marks)
    })
    // A reload rejects reads in flight; the next hover measures again.
    .catch(() => {})
  return false
}

export const tool: CanvasTool = {
  id: 'measure',
  priority: 10,
  onHover,
}
