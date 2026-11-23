// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Rect } from '../../../src/shared/protocol'
import type { StyleSource } from '../../../src/shared/types'
import type { CanvasTool } from '../../../src/ui/plugin-api'
import type { ResizeHandle } from '../../../src/ui/canvas/tools/resize.tool'
import { helmetRule, withRules } from './matched-rules'
import { ackFor, boxOf, edId, fakeContext, inline, layer, mountViewport, node, pointerAt, rect, settle, type FakeContext, type Modifiers } from './tool-context'

const VIEW = { zoom: 2, panX: 10, panY: 20 }
const FLEX_OVERRIDES = 'Flex sizing overrides this size; set flex-shrink or flex-grow to 0 to keep it'
const ROOT_RESIZE = 'Resize the frame in Claude Design'

// root > box (border-box), padded (content-box), row (flex) > item, col (flex column) > citem,
// remmed / emmed / calced / viewported (authored in rem, em, calc(), vw), frame (block) > pct (authored in %),
// abs (absolute, left/top), pinned (absolute, right/top)
const tree = node('root', [
  node('box'),
  node('padded'),
  node('row', [node('item')]),
  node('col', [node('citem')]),
  node('remmed'),
  node('emmed'),
  node('frame', [node('pct')]),
  node('calced'),
  node('viewported'),
  node('abs'),
  node('pinned'),
])

function sceneRects(): Record<string, Rect[]> {
  return {
    root: [rect(0, 0, 1280, 900)],
    box: [rect(100, 100, 200, 100)],
    padded: [rect(100, 300, 200, 100)],
    row: [rect(0, 500, 800, 100)],
    item: [rect(0, 500, 200, 100)],
    col: [rect(900, 0, 200, 800)],
    citem: [rect(900, 0, 200, 100)],
    remmed: [rect(100, 600, 240, 120)],
    emmed: [rect(400, 600, 200, 100)],
    frame: [rect(0, 1000, 800, 400)],
    pct: [rect(0, 1000, 200, 200)],
    calced: [rect(100, 1500, 200, 100)],
    viewported: [rect(400, 1500, 200, 100)],
    abs: [rect(400, 100, 200, 100)],
    pinned: [rect(900, 100, 200, 100)],
  }
}

const BORDER_BOX = { 'box-sizing': 'border-box' }

/** <html>'s 12 px, the artboard root's 30 px and an element's 20 px differ, so rem reads <html> and em the element. */
const ROOT_FONT_SIZE = 12
const computed = {
  root: { 'font-size': '30px' },
  row: { display: 'flex', 'flex-direction': 'row' },
  col: { display: 'flex', 'flex-direction': 'column' },
  box: { 'box-sizing': 'border-box' },
  item: { 'box-sizing': 'border-box' },
  citem: { 'box-sizing': 'border-box' },
  padded: {
    'box-sizing': 'content-box',
    'padding-left': '10px',
    'padding-right': '10px',
    'padding-top': '5px',
    'padding-bottom': '5px',
    'border-left-width': '2px',
    'border-right-width': '2px',
    'border-top-width': '1px',
    'border-bottom-width': '1px',
  },
  remmed: { ...BORDER_BOX, 'font-size': '20px' },
  emmed: { ...BORDER_BOX, 'font-size': '20px' },
  frame: { display: 'block', 'box-sizing': 'content-box', width: '800px', height: '400px' },
  pct: { ...BORDER_BOX, 'font-size': '20px' },
  calced: BORDER_BOX,
  viewported: BORDER_BOX,
  abs: { ...BORDER_BOX, position: 'absolute', left: '400px', top: '100px', right: '680px', bottom: '700px' },
  pinned: { ...BORDER_BOX, position: 'absolute', left: '900px', top: '100px', right: '180px', bottom: '700px' },
}

const styles: Record<string, readonly StyleSource[]> = {
  remmed: inline({ width: '20rem', height: '120px' }),
  emmed: inline({ width: '10em', height: '5em' }),
  pct: inline({ width: '25%', height: '50%' }),
  calced: inline({ width: 'calc(100% - 40px)', height: '100px' }),
  viewported: inline({ width: '20vw', height: '100px' }),
  abs: inline({ position: 'absolute', left: '400px', top: '100px', width: '200px', height: '100px' }),
  pinned: inline({ position: 'absolute', right: '180px', top: '100px', width: '200px', height: '100px' }),
}

/** Box's snap targets: a sibling with left 400, centre 450, right 500 and top 300, centre 350, bottom 400. */
const snap = {
  box: { parent: rect(0, 0, 1280, 900), siblings: [rect(400, 300, 100, 100)] },
  pct: { parent: rect(0, 1000, 800, 400), siblings: [] },
}

/** Each handle of `box` (100, 100, 200 x 100) in board px. */
const BOX_HANDLES: Record<ResizeHandle, [number, number]> = {
  nw: [100, 100],
  n: [200, 100],
  ne: [300, 100],
  e: [300, 150],
  se: [300, 200],
  s: [200, 200],
  sw: [100, 200],
  w: [100, 150],
}

let resize: CanvasTool
let viewport: HTMLElement
let rects: Record<string, Rect[]>

beforeEach(async () => {
  vi.resetModules()
  resize = (await import('../../../src/ui/canvas/tools/resize.tool')).tool
  viewport = mountViewport()
  rects = sceneRects()
})

afterEach(() => {
  viewport.remove()
})

function at(x: number, y: number, modifiers: Modifiers = {}) {
  return pointerAt(VIEW, x, y, modifiers)
}

async function selected(id: string, options: { readOnly?: boolean } = {}): Promise<FakeContext> {
  const fake = fakeContext({ tree, rects, computed, styles, snap, rootFontSize: ROOT_FONT_SIZE }, { selection: [id], viewport: VIEW, readOnly: options.readOnly ?? false })
  resize.onHover!(fake.ctx, at(0, 0))
  await settle()
  return fake
}

/** Replaces the inline styles the index holds for `id`. */
function restyled(fake: FakeContext, id: string, sources: readonly StyleSource[]): void {
  const index = fake.ctx.index()
  fake.ctx.index.mockReturnValue({ ...index, styles: { ...index.styles, [id]: sources } })
}

async function drag(fake: FakeContext, from: [number, number], by: [number, number], modifiers: Modifiers = {}): Promise<boolean> {
  expect(resize.onPointerDown!(fake.ctx, at(...from, modifiers))).toBe(true)
  await settle()
  resize.onPointerMove!(fake.ctx, at(from[0] + by[0], from[1] + by[1], modifiers))
  return resize.onPointerUp!(fake.ctx, at(from[0] + by[0], from[1] + by[1], modifiers))
}

function sortedWrites(fake: FakeContext): string[] {
  return fake.writes().sort()
}

function handles() {
  return layer(viewport, 'resize-handles')
}

describe('resize handles', () => {
  it('draws eight 8 px handles on the corners and edge midpoints of the selected element', async () => {
    await selected('box')

    expect(Object.fromEntries(handles().map((mark) => [mark.getAttribute('data-resize-handle'), boxOf(mark)]))).toEqual({
      nw: { left: 206, top: 216, width: 8, height: 8 },
      n: { left: 406, top: 216, width: 8, height: 8 },
      ne: { left: 606, top: 216, width: 8, height: 8 },
      e: { left: 606, top: 316, width: 8, height: 8 },
      se: { left: 606, top: 416, width: 8, height: 8 },
      s: { left: 406, top: 416, width: 8, height: 8 },
      sw: { left: 206, top: 416, width: 8, height: 8 },
      w: { left: 206, top: 316, width: 8, height: 8 },
    })
    expect(handles().some((mark) => mark.hasAttribute('aria-disabled'))).toBe(false)
  })

  it('removes the handles when the selection empties', async () => {
    const fake = await selected('box')

    fake.select()
    await settle()

    expect(handles()).toEqual([])
  })

  it("disables an artboard root's handles with a pointer to Claude Design", async () => {
    await selected('root')

    expect(handles()).toHaveLength(8)
    for (const mark of handles()) {
      expect(mark.getAttribute('aria-disabled')).toBe('true')
      expect(mark.getAttribute('title')).toBe(ROOT_RESIZE)
    }
  })

  it('claims a press on a root handle only to say so, and writes nothing', async () => {
    const fake = await selected('root')

    expect(resize.onPointerDown!(fake.ctx, at(1280, 900))).toBe(true)
    expect(fake.ctx.toast).toHaveBeenCalledWith({ message: ROOT_RESIZE, tone: 'info' })
    expect(resize.onPointerMove!(fake.ctx, at(1300, 950))).toBe(false)
    expect(resize.onPointerUp!(fake.ctx, at(1300, 950))).toBe(false)
    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('leaves a press away from every handle to the other tools', async () => {
    const fake = await selected('box')

    expect(resize.onPointerDown!(fake.ctx, at(200, 150))).toBe(false)
  })

  it('takes a press within 8 screen px of a handle', async () => {
    const fake = await selected('box')

    expect(resize.onPointerDown!(fake.ctx, at(303.5, 203.5))).toBe(true)
    resize.onPointerUp!(fake.ctx, at(303.5, 203.5))
  })

  it('claims nothing with no selection', async () => {
    const fake = await selected('box')
    fake.select()
    await settle()

    expect(resize.onPointerDown!(fake.ctx, at(300, 200))).toBe(false)
  })

  it('swallows a handle press while read-only and resizes nothing', async () => {
    const fake = await selected('box', { readOnly: true })

    expect(resize.onPointerDown!(fake.ctx, at(300, 200))).toBe(true)
    expect(resize.onPointerMove!(fake.ctx, at(320, 210))).toBe(false)
    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('never claims a hover', async () => {
    const fake = await selected('box')

    expect(resize.onHover!(fake.ctx, at(300, 200))).toBe(false)
  })
})

describe('resizing from each handle', () => {
  it.each([
    ['nw', ['width: 180px', 'height: 90px']],
    ['n', ['height: 90px']],
    ['ne', ['width: 220px', 'height: 90px']],
    ['e', ['width: 220px']],
    ['se', ['width: 220px', 'height: 110px']],
    ['s', ['height: 110px']],
    ['sw', ['width: 180px', 'height: 110px']],
    ['w', ['width: 180px']],
  ] as const)('dragging %s by (+20, +10) writes %j', async (handle, writes) => {
    const fake = await selected('box')

    expect(await drag(fake, BOX_HANDLES[handle], [20, 10])).toBe(true)

    expect(fake.writes()).toEqual(writes)
    expect(fake.ops().every((op) => op.target[0] === edId('box'))).toBe(true)
  })

  it('sends both sizes of a corner resize in the same release, so the Writer makes them one undo entry', async () => {
    const fake = await selected('box')
    resize.onPointerDown!(fake.ctx, at(300, 200))
    await settle()
    resize.onPointerMove!(fake.ctx, at(320, 210))

    resize.onPointerUp!(fake.ctx, at(320, 210))

    expect(fake.writes()).toEqual(['width: 220px', 'height: 110px'])
  })

  it('subtracts padding and border for a content-box element', async () => {
    const fake = await selected('padded')

    await drag(fake, [300, 400], [20, 10])

    expect(fake.writes()).toEqual(['width: 196px', 'height: 98px'])
  })

  it('rounds to whole px and never writes a negative size', async () => {
    const fake = await selected('box')

    await drag(fake, BOX_HANDLES.se, [-250.4, 10.6])

    expect(fake.writes()).toEqual(['width: 0px', 'height: 111px'])
  })

  it('shows a ghost and a live size label while dragging, and clears them on release', async () => {
    const fake = await selected('box')
    resize.onPointerDown!(fake.ctx, at(300, 150))
    await settle()

    resize.onPointerMove!(fake.ctx, at(320, 160))

    const [ghost, label] = layer(viewport, 'resize')
    expect(ghost?.hasAttribute('data-resize-ghost')).toBe(true)
    expect(boxOf(ghost!)).toEqual({ left: 210, top: 220, width: 440, height: 200 })
    expect(label?.textContent).toBe('220 × 100')
    expect(boxOf(label!)).toEqual({ left: 210, top: 426, width: 440, height: 18 })

    resize.onPointerUp!(fake.ctx, at(320, 160))

    expect(layer(viewport, 'resize')).toEqual([])
  })

  it('drops the ghost on cancel, and a later release writes nothing', async () => {
    const fake = await selected('box')
    resize.onPointerDown!(fake.ctx, at(300, 150))
    await settle()
    resize.onPointerMove!(fake.ctx, at(320, 160))

    resize.onCancel!(fake.ctx)

    expect(layer(viewport, 'resize')).toEqual([])
    expect(resize.onPointerUp!(fake.ctx, at(320, 160))).toBe(false)
    await settle()
    expect(fake.writes()).toEqual([])
  })

  it('treats a release without a move as a click', async () => {
    const fake = await selected('box')
    resize.onPointerDown!(fake.ctx, at(300, 200))
    await settle()

    expect(resize.onPointerUp!(fake.ctx, at(300, 200))).toBe(false)
    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('writes nothing when released before the box-sizing read lands', async () => {
    const fake = await selected('box')
    resize.onPointerDown!(fake.ctx, at(300, 200))
    resize.onPointerMove!(fake.ctx, at(320, 210))

    expect(resize.onPointerUp!(fake.ctx, at(320, 210))).toBe(false)
    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('writes nothing when a reload rejects the box-sizing read', async () => {
    const fake = await selected('box')
    fake.failReads('computed')

    expect(await drag(fake, BOX_HANDLES.se, [20, 10])).toBe(false)
    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('ignores moves and releases with no press', async () => {
    const fake = await selected('box')

    expect(resize.onPointerMove!(fake.ctx, at(320, 210))).toBe(false)
    expect(resize.onPointerUp!(fake.ctx, at(320, 210))).toBe(false)
  })

  it('still sends both sizes when the server refuses one', async () => {
    const fake = await selected('box')
    fake.ctx.apply.mockRejectedValue(new Error('refused'))

    await drag(fake, BOX_HANDLES.se, [20, 10])
    await settle()

    expect(fake.writes()).toEqual(['width: 220px', 'height: 110px'])
  })

  it('moves the handles to the new size once it renders', async () => {
    const fake = await selected('box')
    fake.ctx.apply.mockImplementation(async (op) => {
      rects.box = [rect(100, 100, 220, 100)]
      return ackFor(op)
    })

    await drag(fake, BOX_HANDLES.e, [20, 0])
    await settle()

    const east = handles().find((mark) => mark.getAttribute('data-resize-handle') === 'e')
    expect(boxOf(east!)).toEqual({ left: 646, top: 316, width: 8, height: 8 })
  })
})

describe('a flex child whose size flex sizing overrides', () => {
  it('warns when the rendered main-axis size differs from the one written', async () => {
    const fake = await selected('item')

    await drag(fake, [200, 550], [20, 0])
    await settle()

    expect(fake.writes()).toEqual(['width: 220px'])
    expect(fake.ctx.toast).toHaveBeenCalledWith({ message: FLEX_OVERRIDES, tone: 'warning' })
  })

  it('does not warn when the size renders as written', async () => {
    const fake = await selected('item')
    fake.ctx.apply.mockImplementation(async (op) => {
      rects.item = [rect(0, 500, 220, 100)]
      return ackFor(op)
    })

    await drag(fake, [200, 550], [20, 0])
    await settle()

    expect(fake.ctx.toast).not.toHaveBeenCalled()
  })

  it('does not check a cross-axis resize', async () => {
    const fake = await selected('item')

    await drag(fake, [100, 600], [0, 10])
    await settle()

    expect(fake.writes()).toEqual(['height: 110px'])
    expect(fake.ctx.toast).not.toHaveBeenCalled()
  })

  it('checks height in a column', async () => {
    const fake = await selected('citem')

    await drag(fake, [1000, 100], [0, 10])
    await settle()

    expect(fake.ctx.toast).toHaveBeenCalledWith({ message: FLEX_OVERRIDES, tone: 'warning' })
  })

  it('does not check width in a column', async () => {
    const fake = await selected('citem')

    await drag(fake, [1100, 50], [20, 0])
    await settle()

    expect(fake.writes()).toEqual(['width: 220px'])
    expect(fake.ctx.toast).not.toHaveBeenCalled()
  })

  it('does not warn for an element outside a flex container', async () => {
    const fake = await selected('box')

    await drag(fake, BOX_HANDLES.e, [20, 0])
    await settle()

    expect(fake.ctx.toast).not.toHaveBeenCalled()
  })

  it('stays quiet when the element is gone by the time it is checked', async () => {
    const fake = await selected('item')
    fake.ctx.apply.mockImplementation(async (op) => {
      rects.item = []
      return ackFor(op)
    })

    await drag(fake, [200, 550], [20, 0])
    await settle()

    expect(fake.ctx.toast).not.toHaveBeenCalled()
  })

  it('stays quiet when a reload rejects the check', async () => {
    const fake = await selected('item')
    resize.onPointerDown!(fake.ctx, at(200, 550))
    await settle()
    resize.onPointerMove!(fake.ctx, at(220, 550))
    fake.failReads('rects')

    resize.onPointerUp!(fake.ctx, at(220, 550))
    await settle()

    expect(fake.writes()).toEqual(['width: 220px'])
    expect(fake.ctx.toast).not.toHaveBeenCalled()
  })
})

describe('keeping the authored unit', () => {
  it('writes a rem width in rem, converted with the root font size, and a px height in px', async () => {
    const fake = await selected('remmed')

    await drag(fake, [340, 720], [5, 7])

    expect(fake.writes()).toEqual(['width: 20.42rem', 'height: 127px'])
  })

  it('keeps a rem width a stylesheet rule sets', async () => {
    const fake = await selected('remmed')
    restyled(fake, 'remmed', inline({ height: '120px' }))
    withRules(fake, [helmetRule('.card', { width: '20rem' })], { '.card': ['remmed'] })

    await drag(fake, [340, 720], [5, 7])
    await settle()

    expect(fake.writes()).toEqual(['width: 20.42rem', 'height: 127px'])
    expect(fake.ctx.toast).not.toHaveBeenCalled()
  })

  it('reads the unit from the last of two inline widths, the one that renders', async () => {
    const fake = await selected('remmed')
    const [px, rem] = [inline({ width: '100px' })[0]!, inline({ width: '20rem', height: '120px' })[0]!]
    restyled(fake, 'remmed', [{ ...rem, declarations: [...px.declarations, ...rem.declarations] }])

    await drag(fake, [340, 720], [5, 7])

    expect(fake.writes()).toEqual(['width: 20.42rem', 'height: 127px'])
  })

  it('writes em with the element font size', async () => {
    const fake = await selected('emmed')

    await drag(fake, [600, 700], [15, 7])

    expect(fake.writes()).toEqual(['width: 10.75em', 'height: 5.35em'])
  })

  it("writes % of the containing block's width for width and its height for height", async () => {
    const fake = await selected('pct')

    await drag(fake, [200, 1200], [10, 23])

    expect(fake.writes()).toEqual(['width: 26.25%', 'height: 55.75%'])
  })

  it('converts quietly', async () => {
    const fake = await selected('remmed')

    await drag(fake, [340, 720], [5, 7])
    await settle()

    expect(fake.ctx.toast).not.toHaveBeenCalled()
  })

  it.each([
    ['calced', [300, 1550]],
    ['viewported', [600, 1550]],
  ] as const)('falls back to px with a toast for %s, whose unit it cannot convert', async (id, from) => {
    const fake = await selected(id)

    await drag(fake, [...from], [20, 0])
    await settle()

    expect(fake.writes()).toEqual(['width: 220px'])
    expect(fake.ctx.toast).toHaveBeenCalledTimes(1)
    expect(fake.ctx.toast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('px') }))
  })
})

describe('Shift keeps the aspect ratio of the box at drag start', () => {
  it('follows the width when the pointer moved further across', async () => {
    const fake = await selected('box')

    await drag(fake, BOX_HANDLES.se, [40, 10], { shiftKey: true })

    expect(fake.writes()).toEqual(['width: 240px', 'height: 120px'])
  })

  it('follows the height when the pointer moved further down', async () => {
    const fake = await selected('box')

    await drag(fake, BOX_HANDLES.se, [4, 30], { shiftKey: true })

    expect(fake.writes()).toEqual(['width: 260px', 'height: 130px'])
  })

  it('keeps it from the north-west corner', async () => {
    const fake = await selected('box')

    await drag(fake, BOX_HANDLES.nw, [-40, -10], { shiftKey: true })

    expect(fake.writes()).toEqual(['width: 240px', 'height: 120px'])
  })

  it('scales the height with an edge handle', async () => {
    const fake = await selected('box')

    await drag(fake, BOX_HANDLES.e, [40, 0], { shiftKey: true })

    expect(fake.writes()).toEqual(['width: 240px', 'height: 120px'])
  })

  it('shows the kept ratio in the ghost and the size label', async () => {
    const fake = await selected('box')
    resize.onPointerDown!(fake.ctx, at(300, 200, { shiftKey: true }))
    await settle()

    resize.onPointerMove!(fake.ctx, at(340, 210, { shiftKey: true }))

    const [ghost, label] = layer(viewport, 'resize')
    expect(boxOf(ghost!)).toEqual({ left: 210, top: 220, width: 480, height: 240 })
    expect(label?.textContent).toBe('240 × 120')
    resize.onPointerUp!(fake.ctx, at(340, 210, { shiftKey: true }))
  })
})

describe('Alt resizes an absolutely positioned element from its centre', () => {
  it('grows both sides by the drag and writes the left offset too', async () => {
    const fake = await selected('abs')

    await drag(fake, [600, 150], [20, 0], { altKey: true })

    expect(sortedWrites(fake)).toEqual(['left: 380px', 'width: 240px'])
  })

  it('grows from a west handle the same way', async () => {
    const fake = await selected('abs')

    await drag(fake, [400, 150], [-10, 0], { altKey: true })

    expect(sortedWrites(fake)).toEqual(['left: 390px', 'width: 220px'])
  })

  it('writes both offsets for a corner', async () => {
    const fake = await selected('abs')

    await drag(fake, [600, 200], [20, 10], { altKey: true })

    expect(sortedWrites(fake)).toEqual(['height: 120px', 'left: 380px', 'top: 90px', 'width: 240px'])
  })

  it('writes the inset the element is anchored by', async () => {
    const fake = await selected('pinned')

    await drag(fake, [1100, 150], [20, 0], { altKey: true })

    expect(sortedWrites(fake)).toEqual(['right: 160px', 'width: 240px'])
  })

  it('writes the inset a stylesheet rule anchors the element by', async () => {
    const fake = await selected('pinned')
    restyled(fake, 'pinned', inline({ position: 'absolute', top: '100px', width: '200px', height: '100px' }))
    withRules(fake, [helmetRule('.pin', { right: '180px' })], { '.pin': ['pinned'] })

    await drag(fake, [1100, 150], [20, 0], { altKey: true })

    expect(sortedWrites(fake)).toEqual(['right: 160px', 'width: 240px'])
  })

  it('draws the ghost around the same centre', async () => {
    const fake = await selected('abs')
    resize.onPointerDown!(fake.ctx, at(600, 150, { altKey: true }))
    await settle()

    resize.onPointerMove!(fake.ctx, at(620, 150, { altKey: true }))

    const [ghost] = layer(viewport, 'resize')
    expect(boxOf(ghost!)).toEqual({ left: 770, top: 220, width: 480, height: 200 })
    resize.onPointerUp!(fake.ctx, at(620, 150, { altKey: true }))
  })

  it('resizes an element in flow from its handle as usual', async () => {
    const fake = await selected('box')

    await drag(fake, BOX_HANDLES.e, [20, 0], { altKey: true })

    expect(fake.writes()).toEqual(['width: 220px'])
  })
})

describe('snapping the moving edges', () => {
  function guides(): Element[] {
    return layer(viewport, 'resize').filter((mark) => mark.hasAttribute('data-snap-guide'))
  }

  it('snaps the right edge to a sibling edge within 8 screen px and draws the guide', async () => {
    const fake = await selected('box')
    resize.onPointerDown!(fake.ctx, at(...BOX_HANDLES.e))
    await settle()

    resize.onPointerMove!(fake.ctx, at(397, 150))

    expect(guides().map((mark) => mark.getAttribute('data-snap-guide'))).toEqual(['x'])
    expect(boxOf(guides()[0]!)).toEqual(expect.objectContaining({ left: 810, width: 1 }))
    const [ghost] = layer(viewport, 'resize')
    expect(boxOf(ghost!)).toEqual({ left: 210, top: 220, width: 600, height: 200 })

    resize.onPointerUp!(fake.ctx, at(397, 150))

    expect(fake.writes()).toEqual(['width: 300px'])
    expect(guides()).toEqual([])
  })

  it('snaps the bottom edge with a horizontal guide', async () => {
    const fake = await selected('box')
    resize.onPointerDown!(fake.ctx, at(...BOX_HANDLES.s))
    await settle()

    resize.onPointerMove!(fake.ctx, at(200, 297))

    expect(guides().map((mark) => mark.getAttribute('data-snap-guide'))).toEqual(['y'])
    expect(boxOf(guides()[0]!)).toEqual(expect.objectContaining({ top: 620, height: 1 }))
    resize.onPointerUp!(fake.ctx, at(200, 297))

    expect(fake.writes()).toEqual(['height: 200px'])
  })

  it('does not snap past 8 screen px, which is 4 board px at zoom 2', async () => {
    const fake = await selected('box')

    await drag(fake, BOX_HANDLES.e, [95, 0])

    expect(fake.writes()).toEqual(['width: 295px'])
  })

  it('does not snap while Ctrl is held', async () => {
    const fake = await selected('box')
    resize.onPointerDown!(fake.ctx, at(...BOX_HANDLES.e))
    await settle()

    resize.onPointerMove!(fake.ctx, at(397, 150, { ctrlKey: true }))

    expect(guides()).toEqual([])
    resize.onPointerUp!(fake.ctx, at(397, 150, { ctrlKey: true }))
    expect(fake.writes()).toEqual(['width: 297px'])
  })
})

describe('one gesture, one undo entry', () => {
  it('sends every write of a resize under one action id', async () => {
    const fake = await selected('box')

    await drag(fake, BOX_HANDLES.se, [20, 10])

    expect(fake.ctx.beginAction).toHaveBeenCalledTimes(1)
    expect(fake.actionIds()).toEqual(['action-1', 'action-1'])
    expect(fake.undoEntries()).toBe(1)
  })

  it('sends the offsets of a centre resize under the same id as the sizes', async () => {
    const fake = await selected('abs')

    await drag(fake, [600, 200], [20, 10], { altKey: true })

    expect(fake.actionIds()).toEqual(['action-1', 'action-1', 'action-1', 'action-1'])
    expect(fake.undoEntries()).toBe(1)
  })

  it('gives the next resize an id of its own', async () => {
    const fake = await selected('box')

    await drag(fake, BOX_HANDLES.se, [20, 10])
    await drag(fake, BOX_HANDLES.e, [40, 0])

    expect(fake.actionIds()).toEqual(['action-1', 'action-1', 'action-2'])
    expect(fake.undoEntries()).toBe(2)
  })
})
