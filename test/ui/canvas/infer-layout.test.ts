import { describe, expect, it } from 'vitest'
import { inferAutoLayout } from '../../../src/ui/canvas/infer-layout'
import { rect } from './tool-context'

describe('inferAutoLayout', () => {
  it('lays out a row when the centres spread more horizontally than vertically', () => {
    const boxes = [rect(0, 0, 80, 40), rect(100, 10, 80, 40), rect(200, 30, 80, 40)]

    expect(inferAutoLayout(boxes).direction).toBe('row')
  })

  it('lays out a column when the centres spread more vertically than horizontally', () => {
    const boxes = [rect(0, 0, 200, 40), rect(30, 60, 200, 40), rect(10, 120, 200, 40)]

    expect(inferAutoLayout(boxes).direction).toBe('column')
  })

  it('compares the spread of the centres, not of the boxes: tall narrow boxes side by side are a row', () => {
    const boxes = [rect(0, 0, 20, 300), rect(30, 0, 20, 300), rect(60, 0, 20, 300)]

    expect(inferAutoLayout(boxes).direction).toBe('row')
  })

  it('takes the median space between neighbouring boxes along a row', () => {
    const boxes = [rect(0, 0, 100, 40), rect(116, 0, 100, 40), rect(226, 0, 100, 40), rect(366, 0, 100, 40)]

    expect(inferAutoLayout(boxes)).toEqual({ direction: 'row', gap: 16 })
  })

  it('takes the median space between neighbouring boxes down a column', () => {
    const boxes = [rect(0, 0, 200, 50), rect(0, 58, 200, 50), rect(0, 132, 200, 50), rect(0, 190, 200, 50)]

    expect(inferAutoLayout(boxes)).toEqual({ direction: 'column', gap: 8 })
  })

  it('measures each space from the end of one box to the start of the next, whatever their sizes', () => {
    const boxes = [rect(0, 0, 40, 40), rect(52, 0, 200, 40), rect(264, 0, 10, 40)]

    expect(inferAutoLayout(boxes).gap).toBe(12)
  })

  it('floors the gap at 0 when neighbours overlap', () => {
    const boxes = [rect(0, 0, 100, 40), rect(80, 0, 100, 40), rect(150, 0, 100, 40)]

    expect(inferAutoLayout(boxes)).toEqual({ direction: 'row', gap: 0 })
  })

  it('gives a single box no gap', () => {
    expect(inferAutoLayout([rect(10, 10, 100, 40)]).gap).toBe(0)
  })
})
