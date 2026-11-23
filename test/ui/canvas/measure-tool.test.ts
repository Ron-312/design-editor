// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasTool } from '../../../src/ui/plugin-api'
import { boxOf, fakeContext, layer, mountViewport, node, pointerAt, rect, settle, type FakeContext } from './tool-context'

const VIEW = { zoom: 2, panX: 10, panY: 20 }

// root > card > title; row (flex) > a, b; stack (block) > p1, p2; ghost (not rendered)
const tree = node('root', [
  node('card', [node('title')]),
  node('row', [node('a'), node('b')]),
  node('stack', [node('p1'), node('p2')]),
  node('ghost'),
])

const rects = {
  root: [rect(0, 0, 1280, 900)],
  card: [rect(40, 40, 600, 300)],
  title: [rect(60, 60, 400, 60)],
  row: [rect(0, 400, 300, 50)],
  a: [rect(0, 400, 100, 50)],
  b: [rect(150, 400, 100, 50)],
  stack: [rect(0, 600, 200, 140)],
  p1: [rect(0, 600, 200, 40)],
  p2: [rect(0, 700, 200, 40)],
}

const computed = {
  row: { display: 'flex' },
  stack: { display: 'block' },
}

let measure: CanvasTool
let viewport: HTMLElement
let hovered: string | null

beforeEach(async () => {
  vi.resetModules()
  measure = (await import('../../../src/ui/canvas/tools/measure.tool')).tool
  viewport = mountViewport()
  hovered = null
})

afterEach(() => {
  viewport.remove()
})

function context(selection: string[]): FakeContext {
  return fakeContext({ tree, rects, computed, hit: () => hovered }, { selection, viewport: VIEW })
}

async function altHover(fake: FakeContext, over: string | null): Promise<boolean> {
  hovered = over
  const claimed = measure.onHover!(fake.ctx, pointerAt(VIEW, 0, 0, { altKey: true }))
  await settle()
  return claimed
}

function labels(): string[] {
  return layer(viewport, 'measure')
    .filter((mark) => mark.hasAttribute('data-measure-label'))
    .map((mark) => mark.textContent ?? '')
}

function lines(): Element[] {
  return layer(viewport, 'measure').filter((mark) => mark.hasAttribute('data-measure-line'))
}

describe('Alt-hover distances', () => {
  it('labels the padding from each edge of the selection out to the container under the pointer', async () => {
    await altHover(context(['title']), 'card')

    expect(labels()).toEqual(['padding 20', 'padding 220', 'padding 20', 'padding 180'])
  })

  it('labels the padding from a hovered child out to the selected container', async () => {
    await altHover(context(['card']), 'title')

    expect(labels()).toEqual(['padding 20', 'padding 220', 'padding 20', 'padding 180'])
  })

  it('labels the space between two children of a flex container as gap', async () => {
    await altHover(context(['a']), 'b')

    expect(labels()).toEqual(['gap 50'])
  })

  it('labels the space between two children of a block as margin, with the line between them', async () => {
    await altHover(context(['p1']), 'p2')

    expect(labels()).toEqual(['margin 60'])
    expect(lines().map(boxOf)).toEqual([{ left: 210, top: 1300, width: 1, height: 120 }])
    const label = layer(viewport, 'measure').find((mark) => mark.hasAttribute('data-measure-label'))!
    expect(boxOf(label)).toMatchObject({ left: 214.5, top: 1352 })
  })

  it('labels the space between elements in different parents as margin without reading a parent', async () => {
    const fake = context(['a'])

    await altHover(fake, 'p1')

    expect(labels()).toEqual(['margin 150'])
    expect(fake.reads('computed')).toEqual([])
  })

  it('never claims the hover, so outlines still follow the pointer', async () => {
    const fake = context(['a'])

    expect(await altHover(fake, 'b')).toBe(false)
    expect(measure.onHover!(fake.ctx, pointerAt(VIEW, 0, 0))).toBe(false)
  })
})

describe('when Alt-hover measures nothing', () => {
  it('clears the lines once Alt is released, without reading', async () => {
    const fake = context(['a'])
    await altHover(fake, 'b')
    fake.ctx.read.mockClear()

    measure.onHover!(fake.ctx, pointerAt(VIEW, 0, 0))
    await settle()

    expect(layer(viewport, 'measure')).toEqual([])
    expect(fake.ctx.read).not.toHaveBeenCalled()
  })

  it('drops a measurement that lands after Alt was released', async () => {
    const fake = context(['a'])
    hovered = 'b'

    measure.onHover!(fake.ctx, pointerAt(VIEW, 0, 0, { altKey: true }))
    measure.onHover!(fake.ctx, pointerAt(VIEW, 0, 0))
    await settle()

    expect(layer(viewport, 'measure')).toEqual([])
  })

  it.each([
    ['over the selection itself', ['a'], 'a'],
    ['over nothing', ['a'], null],
    ['over an element that is not rendered', ['a'], 'ghost'],
    ['with nothing selected', [], 'b'],
  ])('draws nothing %s', async (_name, selection, over) => {
    await altHover(context(selection), over)

    expect(layer(viewport, 'measure')).toEqual([])
  })

  it('skips the hit-test with nothing selected', async () => {
    const fake = context([])

    await altHover(fake, 'b')

    expect(fake.reads('hitTest')).toEqual([])
  })

  it('draws nothing when a reload rejects the reads', async () => {
    const fake = context(['a'])
    fake.failReads('rects')

    await altHover(fake, 'b')

    expect(layer(viewport, 'measure')).toEqual([])
  })
})
