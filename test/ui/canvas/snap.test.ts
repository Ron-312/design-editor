import { describe, expect, it } from 'vitest'
import type { Rect } from '../../../src/shared/protocol'
import { snapEdges, snapMove, snapThreshold } from '../../../src/ui/canvas/snap'

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height }
}

/** Left 100, centre 200, right 300; top 0, centre 20, bottom 40. */
const sibling = rect(100, 0, 200, 40)
const far = { parent: null, siblings: [sibling] }

describe('snap threshold', () => {
  it('is 8 screen px expressed in board px, so it shrinks as the zoom grows', () => {
    expect(snapThreshold(1)).toBe(8)
    expect(snapThreshold(2)).toBe(4)
    expect(snapThreshold(0.5)).toBe(16)
  })
})

describe('snapping a moved rect to its siblings', () => {
  it('pulls the left edge onto a sibling left edge 5 px away', () => {
    const snap = snapMove(rect(105, 300, 40, 40), far, 1)

    expect(snap.dx).toBe(-5)
    expect(snap.dy).toBe(0)
  })

  it('leaves the rect where it is when the nearest line is 9 px away at zoom 1', () => {
    const snap = snapMove(rect(109, 300, 40, 40), far, 1)

    expect(snap.dx).toBe(0)
    expect(snap.dy).toBe(0)
    expect(snap.guides).toEqual([])
  })

  it('measures the threshold in screen px: 9 board px snaps at zoom 0.5, 5 board px does not at zoom 2', () => {
    expect(snapMove(rect(109, 300, 40, 40), far, 0.5).dx).toBe(-9)
    expect(snapMove(rect(105, 300, 40, 40), far, 2).dx).toBe(0)
  })

  it('aligns centres', () => {
    expect(snapMove(rect(178, 300, 40, 40), far, 1).dx).toBe(2)
  })

  it("puts the moved rect's left edge against a sibling's right edge", () => {
    expect(snapMove(rect(306, 300, 40, 40), far, 1).dx).toBe(-6)
  })

  it('snaps each axis on its own', () => {
    const snap = snapMove(rect(105, 43, 40, 40), far, 1)

    expect(snap.dx).toBe(-5)
    expect(snap.dy).toBe(-3)
    expect(snap.guides.map((guide) => guide.axis).sort()).toEqual(['x', 'y'])
  })

  it('picks the closest line when several are within the threshold', () => {
    const nearer = rect(106, 600, 400, 40)
    const snap = snapMove(rect(104, 300, 40, 40), { parent: null, siblings: [sibling, nearer] }, 1)

    expect(snap.dx).toBe(2)
  })
})

describe('snapping a moved rect to its parent', () => {
  const parent = rect(0, 0, 1000, 800)

  it('pulls the left edge onto the parent left edge', () => {
    expect(snapMove(rect(4, 300, 40, 40), { parent, siblings: [] }, 1).dx).toBe(-4)
  })

  it("aligns the moved rect's centre with the parent centre", () => {
    expect(snapMove(rect(476, 300, 40, 40), { parent, siblings: [] }, 1).dx).toBe(4)
  })
})

describe('snap guides', () => {
  it('draws a vertical guide on the snapped line, spanning the moved rect and the sibling it snapped to', () => {
    const snap = snapMove(rect(105, 300, 40, 40), far, 1)

    expect(snap.guides).toHaveLength(1)
    const [guide] = snap.guides
    expect(guide!.axis).toBe('x')
    expect(guide!.at).toBe(100)
    expect(guide!.from).toBeLessThanOrEqual(0)
    expect(guide!.to).toBeGreaterThanOrEqual(340)
  })

  it('draws a horizontal guide when the y axis snaps', () => {
    const snap = snapMove(rect(400, 43, 40, 40), far, 1)

    expect(snap.dy).toBe(-3)
    expect(snap.guides).toEqual([expect.objectContaining({ axis: 'y', at: 40 })])
  })
})

describe('snapping the moving edges of a resized rect', () => {
  it('pulls a moving right edge onto a sibling left edge 3 px away', () => {
    const snap = snapEdges(rect(0, 300, 97, 40), ['right'], far, 1)

    expect(snap.dx).toBe(3)
    expect(snap.dy).toBe(0)
  })

  it('pulls a moving left edge onto a sibling right edge', () => {
    expect(snapEdges(rect(304, 300, 50, 40), ['left'], far, 1).dx).toBe(-4)
  })

  it('pulls a moving bottom edge onto a sibling bottom edge', () => {
    const snap = snapEdges(rect(400, 0, 40, 37), ['bottom'], far, 1)

    expect(snap.dx).toBe(0)
    expect(snap.dy).toBe(3)
  })

  it('snaps both moving edges of a corner, each on its own axis', () => {
    const snap = snapEdges(rect(0, -50, 97, 87), ['right', 'bottom'], far, 1)

    expect(snap.dx).toBe(3)
    expect(snap.dy).toBe(3)
    expect(snap.guides.map((guide) => guide.axis).sort()).toEqual(['x', 'y'])
  })

  it('ignores an edge that is not moving, though it lies within the threshold', () => {
    const snap = snapEdges(rect(104, 300, 50, 40), ['right'], far, 1)

    expect(snap.dx).toBe(0)
    expect(snap.guides).toEqual([])
  })

  it("does not snap the resized rect's centre", () => {
    expect(snapEdges(rect(150, 300, 98, 40), ['right'], far, 1).dx).toBe(0)
  })

  it('measures the threshold in screen px: 9 board px snaps at zoom 0.5 but not at zoom 1', () => {
    expect(snapEdges(rect(0, 300, 91, 40), ['right'], far, 1).dx).toBe(0)
    expect(snapEdges(rect(0, 300, 91, 40), ['right'], far, 0.5).dx).toBe(9)
  })

  it('snaps to the parent edges too', () => {
    const parent = rect(0, 0, 1000, 800)

    expect(snapEdges(rect(900, 300, 96, 40), ['right'], { parent, siblings: [] }, 1).dx).toBe(4)
  })

  it('picks the closest line when several are within the threshold', () => {
    const nearer = rect(98, 600, 400, 40)

    expect(snapEdges(rect(0, 300, 97, 40), ['right'], { parent: null, siblings: [sibling, nearer] }, 1).dx).toBe(1)
  })

  it('draws a vertical guide on the snapped line, spanning the resized rect and the sibling it snapped to', () => {
    const snap = snapEdges(rect(0, 300, 97, 40), ['right'], far, 1)

    expect(snap.guides).toHaveLength(1)
    const [guide] = snap.guides
    expect(guide!.axis).toBe('x')
    expect(guide!.at).toBe(100)
    expect(guide!.from).toBeLessThanOrEqual(0)
    expect(guide!.to).toBeGreaterThanOrEqual(340)
  })
})
