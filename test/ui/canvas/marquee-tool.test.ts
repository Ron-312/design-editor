// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Rect } from '../../../src/shared/protocol'
import type { EdId } from '../../../src/shared/types'
import type { CanvasTool } from '../../../src/ui/plugin-api'
import { boxOf, edId, fakeContext, inline, mountViewport, node, pointerAt, rect, settle, type FakeContext, type Modifiers } from './tool-context'

const VIEW = { zoom: 2, panX: 10, panY: 20 }

// root > card, card2 (absolute leaves), plain (static leaf), row (flex) > a, b, c; lede (<p>) > strong, em (inline)
const tree = node('root', [
  node('card'),
  node('card2'),
  node('plain'),
  node('row', [node('a'), node('b'), node('c')]),
  node('lede', [node('strong', [], { tag: 'strong' }), node('em', [], { tag: 'em' })], { tag: 'p' }),
])

/** Outermost first, so the last entry containing a point is the deepest hit; outside the root nothing is hit. */
const rendered: ReadonlyArray<readonly [string, Rect]> = [
  ['root', rect(0, 0, 1280, 900)],
  ['card', rect(100, 50, 200, 100)],
  ['card2', rect(350, 200, 100, 50)],
  ['plain', rect(900, 600, 100, 100)],
  ['row', rect(0, 290, 700, 100)],
  ['a', rect(20, 300, 100, 50)],
  ['b', rect(200, 300, 100, 50)],
  ['c', rect(400, 300, 100, 50)],
  ['lede', rect(900, 40, 300, 60)],
  ['strong', rect(950, 50, 60, 40)],
  ['em', rect(1050, 50, 60, 40)],
]

const rects = Object.fromEntries(rendered.map(([id, box]) => [id, [box]]))

function deepestAt(x: number, y: number): string | null {
  const inside = ([, box]: readonly [string, Rect]) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height
  return rendered.filter(inside).at(-1)?.[0] ?? null
}

const IN_FLOW = { display: 'block', position: 'static', transform: 'none' }

const computed = {
  root: { display: 'block' },
  card: { display: 'block', position: 'absolute', transform: 'none', left: '100px', top: '50px', right: '980px', bottom: '750px' },
  card2: { display: 'block', position: 'absolute', transform: 'none', left: '350px', top: '200px', right: '830px', bottom: '650px' },
  plain: IN_FLOW,
  row: { ...IN_FLOW, display: 'flex', 'flex-direction': 'row' },
  a: IN_FLOW,
  b: IN_FLOW,
  c: IN_FLOW,
  lede: IN_FLOW,
  strong: { ...IN_FLOW, display: 'inline' },
  em: { ...IN_FLOW, display: 'inline' },
}

const styles = {
  card: inline({ left: '100px', top: '50px' }),
  card2: inline({ left: '350px', top: '200px' }),
}

const point = {
  emptyCanvas: [-20, -20],
  rowBackground: [10, 295],
  card: [150, 100],
  ledeText: [910, 45],
} as const

let marquee: CanvasTool
let move: CanvasTool
let viewport: HTMLElement
let pressed: FakeContext | null = null

beforeEach(async () => {
  vi.resetModules()
  marquee = (await import('../../../src/ui/canvas/tools/marquee.tool')).tool
  move = (await import('../../../src/ui/canvas/tools/move.tool')).tool
  viewport = mountViewport()
})

afterEach(() => {
  if (pressed) {
    marquee.onCancel?.(pressed.ctx)
    move.onCancel?.(pressed.ctx)
  }
  pressed = null
  viewport.remove()
})

/** A context whose `select` changes the selection it reports, as the store does. */
function canvas(selection: readonly string[] = []): FakeContext {
  const fake = fakeContext({ tree, rects, computed, styles, hit: deepestAt }, { selection, viewport: VIEW })
  fake.ctx.select.mockImplementation((edIds: readonly EdId[]) => fake.select(...edIds))
  pressed = fake
  return fake
}

function at([x, y]: readonly [number, number], modifiers: Modifiers = {}) {
  return pointerAt(VIEW, x, y, modifiers)
}

function selection(fake: FakeContext): EdId[] {
  return [...(fake.ctx.selection()?.edIds ?? [])]
}

function sorted(edIds: readonly EdId[]): string[] {
  return [...edIds].sort()
}

function selectCalls(fake: FakeContext): string[][] {
  return fake.ctx.select.mock.calls.map(([edIds]) => [...(edIds as readonly EdId[])])
}

function marqueeBox() {
  const mark = viewport.querySelector('[data-marquee]')
  return mark ? boxOf(mark) : null
}

/** Press, drag through `path` and release at its last point, letting the hit land after the press. */
async function marqueeDrag(fake: FakeContext, from: readonly [number, number], path: ReadonlyArray<readonly [number, number]>, modifiers: Modifiers = {}) {
  expect(marquee.onPointerDown!(fake.ctx, at(from, modifiers))).toBe(true)
  for (const to of path) marquee.onPointerMove!(fake.ctx, at(to, modifiers))
  await settle()
  marquee.onPointerUp!(fake.ctx, at(path.at(-1)!, modifiers))
  await settle()
}

describe('claiming the press', () => {
  it('claims a press on empty canvas synchronously and starts the deepest hit-test at the press point', () => {
    const fake = canvas()

    expect(marquee.onPointerDown!(fake.ctx, at(point.rowBackground))).toBe(true)

    expect(fake.reads('hitTest')).toEqual([{ kind: 'hitTest', x: 10, y: 295, depth: 'deepest', within: null }])
  })

  it('ranks below the move tool, so a press on a selected element stays a move', () => {
    expect(marquee.priority).toBeLessThan(move.priority)
  })

  it('reads the hit once per press, however far the pointer travels', async () => {
    const fake = canvas()

    await marqueeDrag(fake, point.rowBackground, [[250, 330], [450, 340], [260, 335]])

    expect(fake.reads('hitTest')).toHaveLength(1)
  })
})

describe('marquee on a container background', () => {
  it('draws the rectangle from the press point to the latest pointer, recorded before the hit landed', async () => {
    const fake = canvas()

    marquee.onPointerDown!(fake.ctx, at(point.rowBackground))
    marquee.onPointerMove!(fake.ctx, at([450, 340]))
    marquee.onPointerMove!(fake.ctx, at([250, 330]))
    await settle()

    expect(marqueeBox()).toEqual({ left: 30, top: 610, width: 480, height: 70 })
  })

  it('draws the rectangle the same way when dragged up and to the left', async () => {
    const fake = canvas()

    marquee.onPointerDown!(fake.ctx, at([550, 370]))
    await settle()
    marquee.onPointerMove!(fake.ctx, at(point.rowBackground))

    expect(marqueeBox()).toEqual({ left: 30, top: 610, width: 1080, height: 150 })
  })

  it("selects the container's children the rectangle intersects on release, and clears the rectangle", async () => {
    const fake = canvas()

    await marqueeDrag(fake, point.rowBackground, [[450, 340], [250, 330]])

    expect(selection(fake)).toEqual([edId('a'), edId('b')])
    expect(marqueeBox()).toBeNull()
  })

  it("reads the candidates' rects once each at drag start, not on every move", async () => {
    const fake = canvas()

    marquee.onPointerDown!(fake.ctx, at(point.rowBackground))
    marquee.onPointerMove!(fake.ctx, at([250, 330]))
    await settle()
    for (const x of [300, 350, 400, 450]) marquee.onPointerMove!(fake.ctx, at([x, 340]))
    await settle()

    expect(sorted(fake.reads('rects').map((read) => (read as { edId: EdId }).edId))).toEqual(['a', 'b', 'c'])
  })

  it('never selects the container itself on the way to a marquee', async () => {
    const fake = canvas()

    await marqueeDrag(fake, point.rowBackground, [[250, 330]])

    expect(selectCalls(fake)).not.toContainEqual(['row'])
    expect(selection(fake)).toEqual([edId('a'), edId('b')])
  })

  it('selects the container when the press is released without crossing the drag threshold', async () => {
    const fake = canvas()

    await marqueeDrag(fake, point.rowBackground, [[10.5, 295]])

    expect(selection(fake)).toEqual([edId('row')])
  })
})

describe('marquee on empty canvas', () => {
  it("selects the artboard root's children the rectangle intersects", async () => {
    const fake = canvas(['plain'])

    await marqueeDrag(fake, point.emptyCanvas, [[400, 260]])

    expect(sorted(selection(fake))).toEqual(['card', 'card2'])
  })

  it('clears the selection on a click', async () => {
    const fake = canvas(['plain'])

    await marqueeDrag(fake, point.emptyCanvas, [point.emptyCanvas])

    expect(selection(fake)).toEqual([])
  })

  it('keeps the selection on a Shift-click', async () => {
    const fake = canvas(['plain'])

    await marqueeDrag(fake, point.emptyCanvas, [point.emptyCanvas], { shiftKey: true })

    expect(selection(fake)).toEqual([edId('plain')])
  })

  it('adds the hit set to the selection as it was at press when Shift is held', async () => {
    const fake = canvas(['plain'])

    await marqueeDrag(fake, point.emptyCanvas, [[400, 260]], { shiftKey: true })

    expect(sorted(selection(fake))).toEqual(['card', 'card2', 'plain'])
  })
})

describe('Escape mid-marquee', () => {
  it('drops the rectangle and leaves the selection unchanged', async () => {
    const fake = canvas(['plain'])
    marquee.onPointerDown!(fake.ctx, at(point.rowBackground))
    marquee.onPointerMove!(fake.ctx, at([450, 340]))
    await settle()
    expect(marqueeBox()).not.toBeNull()

    marquee.onCancel!(fake.ctx)
    await settle()

    expect(marqueeBox()).toBeNull()
    expect(fake.ctx.select).not.toHaveBeenCalled()
    expect(selection(fake)).toEqual([edId('plain')])
  })

  it('leaves the selection unchanged when the hit lands after the cancel', async () => {
    const fake = canvas(['plain'])
    marquee.onPointerDown!(fake.ctx, at(point.emptyCanvas))
    marquee.onPointerMove!(fake.ctx, at([400, 260]))

    marquee.onCancel!(fake.ctx)
    await settle()

    expect(marqueeBox()).toBeNull()
    expect(fake.ctx.select).not.toHaveBeenCalled()
  })
})

describe('a press on a leaf', () => {
  it('selects an unselected leaf when the hit lands, and the move tool moves it from the press point by the whole drag', async () => {
    const fake = canvas()
    marquee.onPointerDown!(fake.ctx, at(point.card))
    marquee.onPointerMove!(fake.ctx, at([170, 120]))
    marquee.onPointerMove!(fake.ctx, at([190, 130]))
    await settle()

    expect(selection(fake)).toEqual([edId('card')])
    expect(marqueeBox()).toBeNull()

    marquee.onPointerMove!(fake.ctx, at([190, 130]))
    await settle()
    marquee.onPointerUp!(fake.ctx, at([190, 130]))
    await settle()

    expect(fake.writes()).toEqual(['left: 140px', 'top: 80px'])
  })

  it('treats text with inline children as a leaf: the drag selects it and draws no rectangle', async () => {
    const fake = canvas()
    marquee.onPointerDown!(fake.ctx, at(point.ledeText))
    marquee.onPointerMove!(fake.ctx, at([1150, 95]))
    await settle()

    expect(marqueeBox()).toBeNull()
    expect(selection(fake)).toEqual([edId('lede')])

    marquee.onPointerUp!(fake.ctx, at([1150, 95]))
    await settle()

    expect(selection(fake)).toEqual([edId('lede')])
  })

  it('applies a release that comes before the hit as a click when the hit lands', async () => {
    const fake = canvas()

    marquee.onPointerDown!(fake.ctx, at(point.card))
    marquee.onPointerUp!(fake.ctx, at(point.card))
    expect(fake.ctx.select).not.toHaveBeenCalled()
    await settle()

    expect(selection(fake)).toEqual([edId('card')])
    expect(fake.writes()).toEqual([])
  })

  it('keeps a flick released before the hit a click, with nothing moved', async () => {
    const fake = canvas()

    marquee.onPointerDown!(fake.ctx, at(point.card))
    marquee.onPointerMove!(fake.ctx, at([250, 200]))
    marquee.onPointerUp!(fake.ctx, at([250, 200]))
    await settle()

    expect(selection(fake)).toEqual([edId('card')])
    expect(fake.writes()).toEqual([])
  })
})
