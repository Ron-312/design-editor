import { describe, expect, it } from 'vitest'
import type { Rect } from '../../../src/shared/protocol'
import type { EdId } from '../../../src/shared/types'
import { defaultCanvasTools } from '../../../src/ui/canvas/CanvasView'
import { moveModeOf, pastDragThreshold, reorderOp, shiftedOffset, translatedTransform } from '../../../src/ui/canvas/tools/move.tool'
import { RESIZE_HANDLES, cssSizeFor, resizedBox } from '../../../src/ui/canvas/tools/resize.tool'

const id = (value: string) => value as EdId

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height }
}

describe('canvas tool modules', () => {
  it('loads move, resize and measure from ./tools/*.tool.ts', () => {
    const ids = defaultCanvasTools().map((tool) => tool.id)

    expect(ids).toEqual(expect.arrayContaining(['move', 'resize', 'measure']))
  })
})

describe('drag threshold', () => {
  it('treats a press that travels 2 px or less as a click', () => {
    expect(pastDragThreshold({ x: 10, y: 10 }, { x: 12, y: 10 })).toBe(false)
    expect(pastDragThreshold({ x: 10, y: 10 }, { x: 11, y: 11 })).toBe(false)
  })

  it('starts a drag once the pointer has travelled 5 px, in any direction', () => {
    expect(pastDragThreshold({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true)
    expect(pastDragThreshold({ x: 0, y: 0 }, { x: 0, y: -5 })).toBe(true)
    expect(pastDragThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true)
  })
})

describe('what a drag does, by layout context', () => {
  it('moves an absolute or fixed element by its offsets, even inside a flex parent', () => {
    expect(moveModeOf({ position: 'absolute', transform: 'none', parentDisplay: 'block' })).toBe('offset')
    expect(moveModeOf({ position: 'fixed', transform: 'none', parentDisplay: 'block' })).toBe('offset')
    expect(moveModeOf({ position: 'absolute', transform: 'none', parentDisplay: 'flex' })).toBe('offset')
  })

  it('reorders an in-flow child of a flex or grid container', () => {
    expect(moveModeOf({ position: 'static', transform: 'none', parentDisplay: 'flex' })).toBe('reorder')
    expect(moveModeOf({ position: 'static', transform: 'none', parentDisplay: 'inline-flex' })).toBe('reorder')
    expect(moveModeOf({ position: 'static', transform: 'none', parentDisplay: 'grid' })).toBe('reorder')
  })

  it('moves a transformed element in normal flow through its translate term', () => {
    expect(moveModeOf({ position: 'static', transform: 'matrix(0.999391, -0.0348995, 0.0348995, 0.999391, 0, 0)', parentDisplay: 'block' })).toBe('translate')
  })
})

describe('an absolute element keeps the unit its offset was written in', () => {
  it('adds a px delta to a px offset', () => {
    expect(shiftedOffset('24px', 300, 1000)).toBe('324px')
    expect(shiftedOffset('24px', -20, 1000)).toBe('4px')
  })

  it('converts the delta to a percentage of the containing block for a % offset', () => {
    expect(shiftedOffset('10%', 50, 500)).toBe('20%')
  })

  it('writes px for an offset authored as a bare 0', () => {
    expect(shiftedOffset('0', 12, 1000)).toBe('12px')
  })
})

describe('a transformed element changes only its translate term', () => {
  it('adds the delta to an existing translate and keeps the rotate', () => {
    expect(translatedTransform('translate(4px, 6px) rotate(-2deg)', { x: 10, y: 5 })).toBe('translate(14px, 11px) rotate(-2deg)')
  })

  it('puts a translate in front of a transform that has none, so the move is in the parent space', () => {
    expect(translatedTransform('rotate(-2deg)', { x: 10, y: -5 })).toBe('translate(10px, -5px) rotate(-2deg)')
  })
})

describe('reordering a flex child', () => {
  const parent = id('row')
  const [a, b, c] = [id('a'), id('b'), id('c')]
  const row = [
    { edId: a, rect: rect(0, 0, 100, 50) },
    { edId: b, rect: rect(116, 0, 100, 50) },
    { edId: c, rect: rect(232, 0, 100, 50) },
  ]

  it('moves the dragged child before the first sibling whose midpoint is past the pointer', () => {
    expect(reorderOp(a, parent, row, { x: 250, y: 25 }, 'x')).toEqual({
      target: [a],
      kind: 'moveNode',
      payload: { parent, before: c },
    })
  })

  it('appends the dragged child when the pointer is past the last midpoint', () => {
    expect(reorderOp(a, parent, row, { x: 300, y: 25 }, 'x')?.payload).toEqual({ parent, before: null })
  })

  it('moves a later child to the front', () => {
    expect(reorderOp(c, parent, row, { x: 40, y: 25 }, 'x')?.payload).toEqual({ parent, before: a })
  })

  it('gives no op when the drop lands where the child already is', () => {
    expect(reorderOp(b, parent, row, { x: 150, y: 25 }, 'x')).toBeNull()
    expect(reorderOp(b, parent, row, { x: 200, y: 25 }, 'x')).toBeNull()
  })

  it('follows the y axis in a column', () => {
    const column = row.map((slot, i) => ({ edId: slot.edId, rect: rect(0, i * 60, 200, 50) }))

    expect(reorderOp(a, parent, column, { x: 500, y: 100 }, 'y')?.payload).toEqual({ parent, before: c })
  })
})

describe('resize handles', () => {
  const box = rect(10, 20, 100, 50)

  it('has eight: four edges and four corners', () => {
    expect([...RESIZE_HANDLES].sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'])
  })

  it('keeps the opposite edge fixed', () => {
    expect(resizedBox(box, 'e', { x: 40, y: 7 })).toEqual(rect(10, 20, 140, 50))
    expect(resizedBox(box, 'w', { x: 40, y: 7 })).toEqual(rect(50, 20, 60, 50))
    expect(resizedBox(box, 'n', { x: 5, y: 10 })).toEqual(rect(10, 30, 100, 40))
  })

  it('keeps the opposite corner fixed', () => {
    expect(resizedBox(box, 'se', { x: 10, y: 20 })).toEqual(rect(10, 20, 110, 70))
    expect(resizedBox(box, 'nw', { x: -10, y: -20 })).toEqual(rect(0, 0, 110, 70))
  })
})

describe('the size a resize writes', () => {
  it('subtracts padding and border from the border box for a content-box element', () => {
    expect(cssSizeFor(322, 'content-box', 34)).toBe(288)
  })

  it('writes the border box as is for a border-box element', () => {
    expect(cssSizeFor(322, 'border-box', 34)).toBe(322)
  })
})
