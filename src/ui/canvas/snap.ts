import type { Rect } from '../../shared/protocol'

/** The snap distance is fixed on screen, so it covers fewer board px as the zoom grows. */
export const SNAP_SCREEN_PX = 8

export type Axis = 'x' | 'y'

export type Edge = 'left' | 'right' | 'top' | 'bottom'

export interface SnapTargets {
  readonly parent: Rect | null
  readonly siblings: readonly Rect[]
}

/** A guide line in board coordinates: vertical at x = `at` for axis x, horizontal at y = `at` for axis y. */
export interface SnapGuide {
  readonly axis: Axis
  readonly at: number
  readonly from: number
  readonly to: number
}

export interface Snap {
  readonly dx: number
  readonly dy: number
  readonly guides: readonly SnapGuide[]
}

interface AxisSnap {
  readonly offset: number
  readonly at: number
  readonly target: Rect
}

export function snapThreshold(zoom: number): number {
  return SNAP_SCREEN_PX / zoom
}

/** Start edge, centre and end edge of a rect along one axis. */
function linesOf(rect: Rect, axis: Axis): number[] {
  const start = axis === 'x' ? rect.x : rect.y
  const size = axis === 'x' ? rect.width : rect.height
  return [start, start + size / 2, start + size]
}

function nearestSnap(lines: readonly number[], targets: readonly Rect[], axis: Axis, threshold: number): AxisSnap | null {
  let best: AxisSnap | null = null
  for (const target of targets) {
    for (const at of linesOf(target, axis)) {
      for (const line of lines) {
        const offset = at - line
        if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { offset, at, target }
      }
    }
  }
  return best
}

function guideFor(axis: Axis, snap: AxisSnap, moved: Rect): SnapGuide {
  const [movedStart, , movedEnd] = linesOf(moved, axis === 'x' ? 'y' : 'x')
  const [targetStart, , targetEnd] = linesOf(snap.target, axis === 'x' ? 'y' : 'x')
  return { axis, at: snap.at, from: Math.min(movedStart!, targetStart!), to: Math.max(movedEnd!, targetEnd!) }
}

/** The lines of `rect` that edges name along one axis. */
function edgeLines(rect: Rect, edges: readonly Edge[], axis: Axis): number[] {
  const [start, , end] = linesOf(rect, axis)
  const [startEdge, endEdge]: Edge[] = axis === 'x' ? ['left', 'right'] : ['top', 'bottom']
  return [...(edges.includes(startEdge!) ? [start!] : []), ...(edges.includes(endEdge!) ? [end!] : [])]
}

function snapLines(rect: Rect, linesAlong: (axis: Axis) => number[], { parent, siblings }: SnapTargets, zoom: number): Snap {
  const targets = parent ? [parent, ...siblings] : siblings
  const threshold = snapThreshold(zoom)
  const x = nearestSnap(linesAlong('x'), targets, 'x', threshold)
  const y = nearestSnap(linesAlong('y'), targets, 'y', threshold)
  const dx = x?.offset ?? 0
  const dy = y?.offset ?? 0
  const snapped = { ...rect, x: rect.x + dx, y: rect.y + dy }
  const guides = [...(x ? [guideFor('x', x, snapped)] : []), ...(y ? [guideFor('y', y, snapped)] : [])]
  return { dx, dy, guides }
}

/** Snaps each axis of `rect` on its own to the closest edge or centre of its parent and siblings. */
export function snapMove(rect: Rect, targets: SnapTargets, zoom: number): Snap {
  return snapLines(rect, (axis) => linesOf(rect, axis), targets, zoom)
}

/** Snaps only the moving `edges` of a resized rect, each axis on its own, to the same lines as a move. */
export function snapEdges(rect: Rect, edges: readonly Edge[], targets: SnapTargets, zoom: number): Snap {
  return snapLines(rect, (axis) => edgeLines(rect, edges, axis), targets, zoom)
}
