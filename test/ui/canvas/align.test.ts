import { describe, expect, it } from 'vitest'
import type { Rect } from '../../../src/shared/protocol'
import { alignDeltas, distributeDeltas } from '../../../src/ui/canvas/align'

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height }
}

/** Selection bounds: left 10, right 240, centre 125; top 20, bottom 210, middle 115. */
const wide = rect(10, 20, 100, 50)
const small = rect(200, 80, 40, 30)
const tall = rect(60, 150, 80, 60)
const selection = [wide, small, tall]

const horizontal = (...dx: number[]) => dx.map((x) => ({ x, y: 0 }))
const vertical = (...dy: number[]) => dy.map((y) => ({ x: 0, y }))

describe('aligning to the selection bounds', () => {
  it('left moves every left edge onto 10', () => {
    expect(alignDeltas(selection, 'left')).toEqual(horizontal(0, -190, -50))
  })

  it('centre moves every horizontal centre onto 125', () => {
    expect(alignDeltas(selection, 'centre')).toEqual(horizontal(65, -95, 25))
  })

  it('right moves every right edge onto 240', () => {
    expect(alignDeltas(selection, 'right')).toEqual(horizontal(130, 0, 100))
  })

  it('top moves every top edge onto 20', () => {
    expect(alignDeltas(selection, 'top')).toEqual(vertical(0, -60, -130))
  })

  it('middle moves every vertical centre onto 115', () => {
    expect(alignDeltas(selection, 'middle')).toEqual(vertical(70, 20, -65))
  })

  it('bottom moves every bottom edge onto 210', () => {
    expect(alignDeltas(selection, 'bottom')).toEqual(vertical(140, 100, 0))
  })
})

describe('distributing spacing', () => {
  it('keeps the outermost boxes and makes every horizontal gap equal, answering in the order given', () => {
    // Sorted by left edge: 0–20, 50–90, 200–220. Span 220, widths 80, so two gaps of 70: the middle box goes to 90.
    const last = rect(200, 0, 20, 10)
    const first = rect(0, 0, 20, 10)
    const middle = rect(50, 0, 40, 10)

    expect(distributeDeltas([last, first, middle], 'x')).toEqual(horizontal(0, 0, 40))
  })

  it('makes every vertical gap equal across four boxes', () => {
    // 0–10, 30–60, 100–110, 200–220: span 220, heights 70, so three gaps of 50 put the inner boxes at 60 and 140.
    const boxes = [rect(0, 0, 10, 10), rect(0, 30, 10, 30), rect(0, 100, 10, 10), rect(0, 200, 10, 20)]

    expect(distributeDeltas(boxes, 'y')).toEqual(vertical(0, 30, 40, 0))
  })

  it('leaves boxes that are already evenly spaced where they are', () => {
    const boxes = [rect(0, 0, 20, 20), rect(40, 5, 20, 20), rect(80, 10, 20, 20)]

    expect(distributeDeltas(boxes, 'x')).toEqual(horizontal(0, 0, 0))
  })
})
