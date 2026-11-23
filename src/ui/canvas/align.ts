/** Figma's align and distribute, as board px deltas that move each box onto the selection's bounds. */
import type { Rect } from '../../shared/protocol'
import type { Axis } from './snap'
import type { Point } from './viewport'

export type AlignEdge = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'

/** Where along its axis each edge sits: 0 at the start, 0.5 in the middle, 1 at the end. */
const EDGE_PLACES: Readonly<Record<AlignEdge, { readonly axis: Axis; readonly at: number }>> = {
  left: { axis: 'x', at: 0 },
  centre: { axis: 'x', at: 0.5 },
  right: { axis: 'x', at: 1 },
  top: { axis: 'y', at: 0 },
  middle: { axis: 'y', at: 0.5 },
  bottom: { axis: 'y', at: 1 },
}

export function axisOf(edge: AlignEdge): Axis {
  return EDGE_PLACES[edge].axis
}

function startOf(rect: Rect, axis: Axis): number {
  return axis === 'x' ? rect.x : rect.y
}

function sizeOf(rect: Rect, axis: Axis): number {
  return axis === 'x' ? rect.width : rect.height
}

function along(axis: Axis, delta: number): Point {
  return axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta }
}

export function alignDeltas(rects: readonly Rect[], edge: AlignEdge): Point[] {
  const { axis, at } = EDGE_PLACES[edge]
  const start = Math.min(...rects.map((rect) => startOf(rect, axis)))
  const end = Math.max(...rects.map((rect) => startOf(rect, axis) + sizeOf(rect, axis)))
  const target = start + (end - start) * at
  return rects.map((rect) => along(axis, target - (startOf(rect, axis) + sizeOf(rect, axis) * at)))
}

/** Keeps the first and last box by start edge and spaces the others so every gap between neighbours is equal. */
export function distributeDeltas(rects: readonly Rect[], axis: Axis): Point[] {
  const order = rects.map((_, i) => i).sort((a, b) => startOf(rects[a]!, axis) - startOf(rects[b]!, axis))
  const first = rects[order[0]!]!
  const last = rects[order.at(-1)!]!
  const span = startOf(last, axis) + sizeOf(last, axis) - startOf(first, axis)
  const sizes = rects.reduce((total, rect) => total + sizeOf(rect, axis), 0)
  const gap = (span - sizes) / (rects.length - 1)
  const deltas = rects.map(() => along(axis, 0))
  let cursor = startOf(first, axis)
  order.forEach((i, place) => {
    if (place > 0 && place < order.length - 1) deltas[i] = along(axis, cursor - startOf(rects[i]!, axis))
    cursor += sizeOf(rects[i]!, axis) + gap
  })
  return deltas
}
