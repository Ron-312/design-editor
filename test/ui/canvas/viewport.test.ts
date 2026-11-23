import { describe, expect, it } from 'vitest'
import type { Rect } from '../../../src/shared/protocol'
import type { Viewport } from '../../../src/ui/plugin-api'
import { boardToScreen, fitRect, panBy, screenToBoard, stepZoom, zoomAt, zoomTo } from '../../../src/ui/canvas/viewport'

const container = { width: 800, height: 600 }

function screenBoundsOf(viewport: Viewport, rect: Rect) {
  const topLeft = boardToScreen(viewport, { x: rect.x, y: rect.y })
  const bottomRight = boardToScreen(viewport, { x: rect.x + rect.width, y: rect.y + rect.height })
  return { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y }
}

describe('screen and board coordinates', () => {
  it('maps a board point to the screen through zoom and pan, and back', () => {
    const viewport = { zoom: 2, panX: 10, panY: 20 }

    expect(boardToScreen(viewport, { x: 50, y: 100 })).toEqual({ x: 110, y: 220 })
    expect(screenToBoard(viewport, { x: 110, y: 220 })).toEqual({ x: 50, y: 100 })
  })
})

describe('zoom anchored at the cursor', () => {
  it('scales the zoom and moves the pan so the cursor stays on the same board point', () => {
    expect(zoomAt({ zoom: 1, panX: 0, panY: 0 }, 2, { x: 100, y: 50 })).toEqual({ zoom: 2, panX: -100, panY: -50 })
  })

  it('keeps the board point under the cursor when zooming out from an offset view', () => {
    const before = { zoom: 1.5, panX: 30, panY: -20 }
    const cursor = { x: 200, y: 150 }
    const pointUnderCursor = screenToBoard(before, cursor)

    const after = zoomAt(before, 0.5, cursor)

    expect(after.zoom).toBeCloseTo(0.75)
    const pointAfter = screenToBoard(after, cursor)
    expect(pointAfter.x).toBeCloseTo(pointUnderCursor.x)
    expect(pointAfter.y).toBeCloseTo(pointUnderCursor.y)
  })
})

describe('pan', () => {
  it('moves the view by a screen delta without changing the zoom', () => {
    expect(panBy({ zoom: 2, panX: 10, panY: 20 }, 50, -30)).toEqual({ zoom: 2, panX: 60, panY: -10 })
  })
})

describe('fit', () => {
  it('fits the whole artboard in the container, centred', () => {
    const board = { x: 0, y: 0, width: 1280, height: 900 }

    const viewport = fitRect(board, container)
    const bounds = screenBoundsOf(viewport, board)

    expect(viewport.zoom).toBeLessThanOrEqual(600 / 900)
    expect(viewport.zoom).toBeGreaterThan(0.5)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(container.width)
    expect(bounds.bottom).toBeLessThanOrEqual(container.height)
    expect((bounds.left + bounds.right) / 2).toBeCloseTo(container.width / 2)
    expect((bounds.top + bounds.bottom) / 2).toBeCloseTo(container.height / 2)
  })

  it('zooms in on a small rect away from the origin, centred', () => {
    const selection = { x: 100, y: 200, width: 400, height: 100 }

    const viewport = fitRect(selection, container)
    const bounds = screenBoundsOf(viewport, selection)

    expect(viewport.zoom).toBeLessThanOrEqual(2)
    expect(viewport.zoom).toBeGreaterThan(1.6)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(container.width)
    expect((bounds.left + bounds.right) / 2).toBeCloseTo(container.width / 2)
    expect((bounds.top + bounds.bottom) / 2).toBeCloseTo(container.height / 2)
  })
})

describe('zoom around the centre of the view', () => {
  const centre = { x: container.width / 2, y: container.height / 2 }
  const offset = { zoom: 1.5, panX: 30, panY: -20 }

  function expectCentreKept(before: Viewport, after: Viewport) {
    const pointBefore = screenToBoard(before, centre)
    const pointAfter = screenToBoard(after, centre)
    expect(pointAfter.x).toBeCloseTo(pointBefore.x)
    expect(pointAfter.y).toBeCloseTo(pointBefore.y)
  }

  it('zooms to a level and keeps the board point at the centre where it is', () => {
    const after = zoomTo(offset, 1, container)

    expect(after.zoom).toBe(1)
    expectCentreKept(offset, after)
  })

  it('doubles the zoom on a step in, keeping the board point at the centre', () => {
    const after = stepZoom(offset, 'in', container)

    expect(after.zoom).toBeCloseTo(3)
    expectCentreKept(offset, after)
  })

  it('halves the zoom on a step out, keeping the board point at the centre', () => {
    const after = stepZoom(offset, 'out', container)

    expect(after.zoom).toBeCloseTo(0.75)
    expectCentreKept(offset, after)
  })

  it('takes a step in and a step out back to the same view', () => {
    const back = stepZoom(stepZoom(offset, 'in', container), 'out', container)

    expect(back.zoom).toBeCloseTo(offset.zoom)
    expect(back.panX).toBeCloseTo(offset.panX)
    expect(back.panY).toBeCloseTo(offset.panY)
  })

  it.each(['in', 'out'] as const)('stops at the zoom limit when stepping %s, and the view stays put there', (direction) => {
    let viewport: Viewport = { zoom: 1, panX: 0, panY: 0 }
    for (let i = 0; i < 40; i++) viewport = stepZoom(viewport, direction, container)

    const atLimit = stepZoom(viewport, direction, container)

    expect(Number.isFinite(viewport.zoom)).toBe(true)
    expect(viewport.zoom).toBeGreaterThan(0)
    expect(atLimit).toEqual(viewport)
  })
})
