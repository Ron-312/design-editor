// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Rect } from '../../../src/shared/protocol'
import type { CanvasTool } from '../../../src/ui/plugin-api'
import type { ResizeHandle } from '../../../src/ui/canvas/tools/resize.tool'
import { ackFor, boxOf, edId, fakeContext, layer, mountViewport, node, pointerAt, rect, settle, type FakeContext, type Modifiers } from './tool-context'

const VIEW = { zoom: 2, panX: 10, panY: 20 }
const FLEX_OVERRIDES = 'Flex sizing overrides this size; set flex-shrink or flex-grow to 0 to keep it'
const ROOT_RESIZE = 'Resize the frame in Claude Design'

// root > box (border-box), padded (content-box), row (flex) > item, col (flex column) > citem
const tree = node('root', [node('box'), node('padded'), node('row', [node('item')]), node('col', [node('citem')])])

function sceneRects(): Record<string, Rect[]> {
  return {
    root: [rect(0, 0, 1280, 900)],
    box: [rect(100, 100, 200, 100)],
    padded: [rect(100, 300, 200, 100)],
    row: [rect(0, 500, 800, 100)],
    item: [rect(0, 500, 200, 100)],
    col: [rect(900, 0, 200, 800)],
    citem: [rect(900, 0, 200, 100)],
  }
}

const computed = {
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
  const fake = fakeContext({ tree, rects, computed }, { selection: [id], viewport: VIEW, readOnly: options.readOnly ?? false })
  resize.onHover!(fake.ctx, at(0, 0))
  await settle()
  return fake
}

async function drag(fake: FakeContext, from: [number, number], by: [number, number]): Promise<boolean> {
  expect(resize.onPointerDown!(fake.ctx, at(...from))).toBe(true)
  await settle()
  resize.onPointerMove!(fake.ctx, at(from[0] + by[0], from[1] + by[1]))
  return resize.onPointerUp!(fake.ctx, at(from[0] + by[0], from[1] + by[1]))
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
