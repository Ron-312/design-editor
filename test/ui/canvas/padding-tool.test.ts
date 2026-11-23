import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasTool } from '../../../src/ui/plugin-api'
import { fakeContext, node, pointerAt, rect, settle, type FakeContext, type Modifiers } from './tool-context'

const VIEW = { zoom: 1, panX: 0, panY: 0 }

// row sits at (100, 200), 600 x 200, so with 24 / 32 px padding its top band spans y 200..224.
const tree = node('root', [node('row'), node('frozen', [], { readOnly: 'artboard-root' }), node('ghost')])
const rects = { row: [rect(100, 200, 600, 200)], frozen: [rect(0, 600, 100, 100)] }

const ON_TOP_BAND = [400, 210] as const
const ON_BOTTOM_BAND = [400, 390] as const
const ON_LEFT_BAND = [110, 300] as const
const ON_RIGHT_BAND = [690, 300] as const
const IN_CONTENT = [400, 300] as const

let padding: CanvasTool

beforeEach(async () => {
  vi.resetModules()
  padding = (await import('../../../src/ui/canvas/tools/padding.tool')).tool
})

function at(point: readonly [number, number], modifiers: Modifiers = {}) {
  return pointerAt(VIEW, point[0], point[1], modifiers)
}

function context(selection: string[], options: { readOnly?: boolean; uniform?: boolean } = {}): FakeContext {
  const values = options.uniform
    ? { 'padding-top': '24px', 'padding-right': '24px', 'padding-bottom': '24px', 'padding-left': '24px' }
    : { 'padding-top': '24px', 'padding-right': '32px', 'padding-bottom': '24px', 'padding-left': '32px' }
  return fakeContext({ tree, rects, computed: { row: values, frozen: values } }, { selection, viewport: VIEW, readOnly: options.readOnly ?? false })
}

async function hovered(fake: FakeContext): Promise<void> {
  expect(padding.onHover!(fake.ctx, at([0, 0]))).toBe(false)
  await settle()
}

async function drag(fake: FakeContext, from: readonly [number, number], by: readonly [number, number], modifiers: Modifiers = {}) {
  await hovered(fake)
  expect(padding.onPointerDown!(fake.ctx, at(from, modifiers))).toBe(true)
  const to = [from[0] + by[0], from[1] + by[1]] as const
  expect(padding.onPointerMove!(fake.ctx, at(to, modifiers))).toBe(true)
  expect(padding.onPointerUp!(fake.ctx, at(to, modifiers))).toBe(true)
  await settle()
}

describe('dragging a padding band', () => {
  it.each([
    ['top', ON_TOP_BAND, [0, 8], 'padding-top: 32px'],
    ['bottom', ON_BOTTOM_BAND, [0, -8], 'padding-bottom: 32px'],
    ['left', ON_LEFT_BAND, [5, 0], 'padding-left: 37px'],
    ['right', ON_RIGHT_BAND, [-5, 0], 'padding-right: 37px'],
  ] as const)('drags the %s padding inward', async (_side, from, by, write) => {
    const fake = context(['row'])

    await drag(fake, from, by)

    expect(fake.writes()).toEqual([write])
  })

  it('moves the opposite side too with Alt', async () => {
    const fake = context(['row'])

    await drag(fake, ON_TOP_BAND, [0, 8], { altKey: true })

    expect(fake.writes()).toEqual(['padding-top: 32px', 'padding-bottom: 32px'])
  })

  it('moves all four sides with Alt-Shift', async () => {
    const fake = context(['row'], { uniform: true })

    await drag(fake, ON_TOP_BAND, [0, 8], { altKey: true, shiftKey: true })

    expect(fake.writes()).toEqual(['padding-top: 32px', 'padding-right: 32px', 'padding-bottom: 32px', 'padding-left: 32px'])
  })

  it('skips a side that already has the value', async () => {
    const fake = context(['row'])

    await drag(fake, ON_TOP_BAND, [0, 8], { altKey: true, shiftKey: true })

    expect(fake.writes()).toEqual(['padding-top: 32px', 'padding-bottom: 32px'])
  })

  it('stops at zero', async () => {
    const fake = context(['row'])

    await drag(fake, ON_TOP_BAND, [0, -50])

    expect(fake.writes()).toEqual(['padding-top: 0px'])
  })

  it('still writes the other side when the server refuses the first', async () => {
    const fake = context(['row'])
    fake.ctx.apply.mockRejectedValue(new Error('refused'))

    await drag(fake, ON_TOP_BAND, [0, 8], { altKey: true })

    expect(fake.writes()).toEqual(['padding-top: 32px', 'padding-bottom: 32px'])
  })
})

describe('which presses the padding tool claims', () => {
  it('leaves a press in the content box or outside the element to the other tools', async () => {
    const fake = context(['row'])
    await hovered(fake)

    expect(padding.onPointerDown!(fake.ctx, at(IN_CONTENT))).toBe(false)
    expect(padding.onPointerDown!(fake.ctx, at([50, 50]))).toBe(false)
  })

  it('claims nothing before a hover has measured the selection', () => {
    const fake = context(['row'])

    expect(padding.onPointerDown!(fake.ctx, at(ON_TOP_BAND))).toBe(false)
  })

  it('claims nothing once the selection changed after the measurement', async () => {
    const fake = context(['row'])
    await hovered(fake)
    fake.select('frozen')

    expect(padding.onPointerDown!(fake.ctx, at(ON_TOP_BAND))).toBe(false)
  })

  it.each([
    ['while the canvas is read-only', ['row'], { readOnly: true }],
    ['on a read-only element', ['frozen'], {}],
    ['with two elements selected', ['row', 'frozen'], {}],
    ['on an element that is not rendered', ['ghost'], {}],
  ] as const)('claims nothing %s', async (_name, selection, options) => {
    const fake = context([...selection], options)
    await hovered(fake)

    expect(padding.onPointerDown!(fake.ctx, at(ON_TOP_BAND))).toBe(false)
    expect(padding.onPointerDown!(fake.ctx, at([10, 610]))).toBe(false)
  })

  it('ignores moves and releases with no drag', () => {
    const fake = context(['row'])

    expect(padding.onPointerMove!(fake.ctx, at(ON_TOP_BAND))).toBe(false)
    expect(padding.onPointerUp!(fake.ctx, at(ON_TOP_BAND))).toBe(false)
    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })
})

describe('a reload during a hover', () => {
  /** Rejections nothing handled while `run` and the turns after it ran. */
  async function unhandledRejections(run: () => void): Promise<unknown[]> {
    const rejected: unknown[] = []
    const record = (reason: unknown) => rejected.push(reason)
    const others = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', record)
    try {
      run()
      await settle()
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      process.off('unhandledRejection', record)
      for (const listener of others) process.on('unhandledRejection', listener)
    }
    return rejected
  }

  it('handles the rejected measurement', async () => {
    const fake = context(['row'])
    fake.failReads('rects')

    expect(await unhandledRejections(() => padding.onHover!(fake.ctx, at([0, 0])))).toEqual([])
  })
})
