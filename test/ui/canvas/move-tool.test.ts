// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StyleSource } from '../../../src/shared/types'
import type { CanvasTool } from '../../../src/ui/plugin-api'
import {
  ackFor,
  boxOf,
  edId,
  fakeContext,
  inline,
  layer,
  mountViewport,
  node,
  pointerAt,
  rect,
  settle,
  type FakeContext,
  type Modifiers,
} from './tool-context'
import { helmetRule, withRules } from './matched-rules'

const VIEW = { zoom: 2, panX: 10, panY: 20 }

// root > card (> pip, absolute) and card2 (absolute, left/top), badge (absolute, right/top %), rotated and bare (transformed),
// row (flex) > a, b, cond (<sc-if>), unrendered, c; col (flex column) > d, e; plain (static, no transform)
const tree = node('root', [
  node('card', [node('pip')]),
  node('card2'),
  node('badge'),
  node('rotated'),
  node('bare'),
  node('row', [node('a'), node('b'), node('cond', [], { kind: 'sc-if' }), node('unrendered'), node('c')]),
  node('col', [node('d'), node('e')]),
  node('plain'),
])

const rects = {
  root: [rect(0, 0, 1280, 900)],
  card: [rect(100, 50, 200, 100)],
  pip: [rect(110, 60, 20, 20)],
  card2: [rect(350, 200, 100, 50)],
  badge: [rect(1000, 90, 100, 60)],
  rotated: [rect(400, 600, 100, 100)],
  bare: [rect(600, 600, 100, 100)],
  row: [rect(0, 290, 400, 70)],
  a: [rect(0, 300, 100, 50)],
  b: [rect(116, 300, 100, 50)],
  c: [rect(232, 300, 100, 50)],
  col: [rect(600, 290, 200, 120)],
  d: [rect(600, 300, 200, 40)],
  e: [rect(600, 360, 200, 40)],
  plain: [rect(900, 600, 100, 100)],
}

const IN_FLOW = { position: 'static', transform: 'none' }
const MATRIX = 'matrix(0.999391, -0.0348995, 0.0348995, 0.999391, 0, 0)'

const computed = {
  root: { display: 'block' },
  row: { display: 'flex', 'flex-direction': 'row' },
  col: { display: 'flex', 'flex-direction': 'column' },
  card: { position: 'absolute', transform: 'none', left: '100px', top: '50px', right: '980px', bottom: '750px' },
  card2: { position: 'absolute', transform: 'none', left: '350px', top: '200px', right: '830px', bottom: '650px' },
  pip: { position: 'absolute', transform: 'none', left: '10px', top: '10px', right: '170px', bottom: '70px' },
  badge: { position: 'absolute', transform: 'none', left: '1000px', top: '90px', right: '180px', bottom: '750px' },
  rotated: { position: 'static', transform: MATRIX },
  bare: { position: 'static', transform: MATRIX },
  a: IN_FLOW,
  b: IN_FLOW,
  c: IN_FLOW,
  d: IN_FLOW,
  e: IN_FLOW,
  plain: IN_FLOW,
}

const defaultStyles: Record<string, readonly StyleSource[]> = {
  card: inline({ left: '100px', top: '50px' }),
  card2: inline({ left: '350px', top: '200px' }),
  pip: inline({ left: '10px', top: '10px' }),
  badge: inline({ right: '20px', top: '10%' }),
  rotated: inline({ transform: 'translate(4px, 6px) rotate(-2deg)' }),
}

const snap = {
  card: { parent: rects.root[0]!, siblings: [rect(400, 300, 100, 100)] },
  card2: { parent: rects.root[0]!, siblings: [] },
}

let move: CanvasTool
let viewport: HTMLElement

beforeEach(async () => {
  vi.resetModules()
  move = (await import('../../../src/ui/canvas/tools/move.tool')).tool
  viewport = mountViewport()
})

afterEach(() => {
  viewport.remove()
})

async function selected(id: string, options: { styles?: Record<string, readonly StyleSource[]>; readOnly?: boolean } = {}): Promise<FakeContext> {
  return selectedAll([id], options)
}

async function selectedAll(ids: readonly string[], options: { styles?: Record<string, readonly StyleSource[]>; readOnly?: boolean } = {}): Promise<FakeContext> {
  const fake = fakeContext(
    { tree, rects, computed, styles: options.styles ?? defaultStyles, snap },
    { selection: ids, viewport: VIEW, readOnly: options.readOnly ?? false },
  )
  move.onHover!(fake.ctx, at(0, 0))
  await settle()
  return fake
}

function at(x: number, y: number, modifiers: Modifiers = {}) {
  return pointerAt(VIEW, x, y, modifiers)
}

async function drag(fake: FakeContext, from: [number, number], to: [number, number], modifiers: Modifiers = {}): Promise<boolean> {
  expect(move.onPointerDown!(fake.ctx, at(...from, modifiers))).toBe(true)
  await settle()
  move.onPointerMove!(fake.ctx, at(...to, modifiers))
  return move.onPointerUp!(fake.ctx, at(...to, modifiers))
}

function marks(name: string): Element[] {
  return layer(viewport, 'move').filter((mark) => mark.hasAttribute(name))
}

function keydown(key: string, init: KeyboardEventInit = {}, target: Element = viewport): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('dragging an absolute element', () => {
  it('writes left and top by the board distance the pointer travelled', async () => {
    const fake = await selected('card')

    expect(await drag(fake, [150, 100], [180, 115])).toBe(true)

    expect(fake.ops()).toEqual([
      { target: [edId('card')], kind: 'setDecl', payload: { prop: 'left', value: '130px' } },
      { target: [edId('card')], kind: 'setDecl', payload: { prop: 'top', value: '65px' } },
    ])
  })

  it('draws a dashed ghost at the moved position while dragging, and clears it on release', async () => {
    const fake = await selected('card')

    move.onPointerDown!(fake.ctx, at(150, 100))
    await settle()
    move.onPointerMove!(fake.ctx, at(180, 115))

    expect(marks('data-move-ghost').map(boxOf)).toEqual([{ left: 270, top: 150, width: 400, height: 200 }])

    move.onPointerUp!(fake.ctx, at(180, 115))

    expect(layer(viewport, 'move')).toEqual([])
  })

  it('moves a right-anchored element by its right offset and keeps a % top in %', async () => {
    const fake = await selected('badge')

    await drag(fake, [1050, 120], [1080, 138])

    expect(fake.writes()).toEqual(['right: -10px', 'top: 12%'])
  })

  it('starts from the computed offset when the authored one is not a plain length', async () => {
    const fake = await selected('card', { styles: { card: inline({ left: 'var(--x)', top: '50px' }) } })

    await drag(fake, [150, 100], [180, 100])

    expect(fake.writes()).toEqual(['left: 130px'])
  })

  it('writes the edge it moves only, so a horizontal drag leaves top alone', async () => {
    const fake = await selected('card')

    await drag(fake, [150, 100], [190, 100])

    expect(fake.writes()).toEqual(['left: 140px'])
  })

  it('builds on a write still in flight when a second drag follows before the index catches up', async () => {
    const fake = await selected('card')

    await drag(fake, [150, 100], [180, 100])
    await settle()
    await drag(fake, [150, 100], [160, 100])

    expect(fake.writes()).toEqual(['left: 130px', 'left: 140px'])
  })

  it('still sends every write when the server refuses one', async () => {
    const fake = await selected('card')
    fake.ctx.apply.mockRejectedValue(new Error('refused'))

    await drag(fake, [150, 100], [180, 115])
    await settle()

    expect(fake.writes()).toEqual(['left: 130px', 'top: 65px'])
  })
})

describe('the click threshold', () => {
  it.each([2, 3])('treats a press that travels %i screen px as a click and writes nothing', async (screenPx) => {
    const fake = await selected('card')

    expect(await drag(fake, [150, 100], [150 + screenPx / VIEW.zoom, 100])).toBe(false)

    expect(fake.ctx.apply).not.toHaveBeenCalled()
    expect(layer(viewport, 'move')).toEqual([])
  })

  it('drags once the press travels 4 screen px', async () => {
    const fake = await selected('card')

    expect(await drag(fake, [150, 100], [152, 100])).toBe(true)

    expect(fake.writes()).toEqual(['left: 102px'])
  })

  it('claims a press that has not yet travelled past the threshold, without drawing', async () => {
    const fake = await selected('card')
    move.onPointerDown!(fake.ctx, at(150, 100))
    await settle()

    expect(move.onPointerMove!(fake.ctx, at(150.5, 100))).toBe(true)
    expect(layer(viewport, 'move')).toEqual([])
    move.onPointerUp!(fake.ctx, at(150.5, 100))
  })
})

describe('which presses the move tool claims', () => {
  it('leaves a press outside the selected element to selection', async () => {
    const fake = await selected('card')

    expect(move.onPointerDown!(fake.ctx, at(500, 500))).toBe(false)
  })

  it.each([
    ['Shift', { shiftKey: true }],
    ['Cmd/Ctrl', { modKey: true }],
  ])('leaves a %s-press to selection', async (_name, modifiers) => {
    const fake = await selected('card')

    expect(move.onPointerDown!(fake.ctx, at(150, 100, modifiers))).toBe(false)
  })

  it('claims nothing while the canvas is read-only', async () => {
    const fake = await selected('card', { readOnly: true })

    expect(move.onPointerDown!(fake.ctx, at(150, 100))).toBe(false)
  })

  it('follows the selection as it changes', async () => {
    const fake = await selected('card')
    fake.select('badge')
    await settle()

    expect(move.onPointerDown!(fake.ctx, at(150, 100))).toBe(false)
    expect(move.onPointerDown!(fake.ctx, at(1050, 120))).toBe(true)
    move.onPointerUp!(fake.ctx, at(1050, 120))
  })

  it('claims nothing while the selected element cannot be measured', async () => {
    const fake = fakeContext({ tree, rects, computed, styles: defaultStyles }, { selection: ['card'], viewport: VIEW })
    fake.failReads('rects')
    move.onHover!(fake.ctx, at(0, 0))
    await settle()

    expect(move.onPointerDown!(fake.ctx, at(150, 100))).toBe(false)
  })

  it('ignores moves and releases with no press', async () => {
    const fake = await selected('card')

    expect(move.onPointerMove!(fake.ctx, at(150, 100))).toBe(false)
    expect(move.onPointerUp!(fake.ctx, at(150, 100))).toBe(false)
  })

  it('never claims a hover', async () => {
    const fake = await selected('card')

    expect(move.onHover!(fake.ctx, at(150, 100))).toBe(false)
  })
})

describe('the layout read behind a drag', () => {
  it('reads the snap rects once at drag start, however many moves follow', async () => {
    const fake = await selected('card')

    move.onPointerDown!(fake.ctx, at(150, 100))
    await settle()
    for (const x of [160, 170, 180, 190]) move.onPointerMove!(fake.ctx, at(x, 100))
    move.onPointerUp!(fake.ctx, at(190, 100))

    expect(fake.reads('snapRects')).toEqual([{ kind: 'snapRects', edId: edId('card') }])
  })

  it('draws the drag as soon as the read lands when the pointer already moved', async () => {
    const fake = await selected('card')

    move.onPointerDown!(fake.ctx, at(150, 100))
    move.onPointerMove!(fake.ctx, at(180, 115))
    expect(layer(viewport, 'move')).toEqual([])

    await settle()

    expect(marks('data-move-ghost').map(boxOf)).toEqual([{ left: 270, top: 150, width: 400, height: 200 }])
    move.onPointerUp!(fake.ctx, at(180, 115))
  })

  it('writes nothing when released before the read lands, and draws nothing after', async () => {
    const fake = await selected('card')

    move.onPointerDown!(fake.ctx, at(150, 100))
    move.onPointerMove!(fake.ctx, at(180, 115))
    expect(move.onPointerUp!(fake.ctx, at(180, 115))).toBe(false)
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
    expect(layer(viewport, 'move')).toEqual([])
  })

  it('writes nothing when a reload rejects the read', async () => {
    const fake = await selected('card')
    fake.failReads('snapRects')

    expect(await drag(fake, [150, 100], [180, 115])).toBe(false)

    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('does not move an in-flow element whose parent neither flexes nor grids and that has no transform', async () => {
    const fake = await selected('plain')

    expect(await drag(fake, [950, 650], [980, 680])).toBe(false)

    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('re-measures the selection after a drop', async () => {
    const fake = await selected('card')
    fake.ctx.read.mockClear()

    await drag(fake, [150, 100], [180, 115])
    await settle()

    expect(fake.reads('rects').at(-1)).toEqual({ kind: 'rects', edId: edId('card') })
  })
})

describe('snapping', () => {
  it('snaps to a sibling edge within 8 screen px and draws the guide', async () => {
    const fake = await selected('card')

    move.onPointerDown!(fake.ctx, at(150, 100))
    await settle()
    move.onPointerMove!(fake.ctx, at(447, 100))

    expect(marks('data-move-ghost').map(boxOf)).toEqual([{ left: 810, top: 120, width: 400, height: 200 }])
    expect(marks('data-snap-guide').map((mark) => [mark.getAttribute('data-snap-guide'), boxOf(mark)])).toEqual([
      ['x', { left: 810, top: 120, width: 1, height: 700 }],
    ])

    move.onPointerUp!(fake.ctx, at(447, 100))

    expect(fake.writes()).toEqual(['left: 400px'])
  })

  it('does not snap past 8 screen px, which is 4 board px at zoom 2', async () => {
    const fake = await selected('card')

    move.onPointerDown!(fake.ctx, at(150, 100))
    await settle()
    move.onPointerMove!(fake.ctx, at(445, 100))

    expect(marks('data-snap-guide')).toEqual([])
    move.onPointerUp!(fake.ctx, at(445, 100))
    expect(fake.writes()).toEqual(['left: 395px'])
  })

  it('does not snap while Ctrl is held', async () => {
    const fake = await selected('card')

    move.onPointerDown!(fake.ctx, at(150, 100))
    await settle()
    move.onPointerMove!(fake.ctx, at(447, 100, { ctrlKey: true }))

    expect(marks('data-snap-guide')).toEqual([])
    move.onPointerUp!(fake.ctx, at(447, 100, { ctrlKey: true }))
    expect(fake.writes()).toEqual(['left: 397px'])
  })
})

describe('reordering a flex or grid child', () => {
  it('moves the child before the sibling past the pointer and draws the insertion line there', async () => {
    const fake = await selected('a')

    move.onPointerDown!(fake.ctx, at(50, 325))
    await settle()
    move.onPointerMove!(fake.ctx, at(250, 325))

    expect(marks('data-insertion-line').map(boxOf)).toEqual([{ left: 473, top: 620, width: 2, height: 100 }])

    expect(move.onPointerUp!(fake.ctx, at(250, 325))).toBe(true)

    expect(fake.ops()).toEqual([{ target: [edId('a')], kind: 'moveNode', payload: { parent: edId('row'), before: edId('c') } }])
  })

  it('appends the child past the last sibling, with the line after it', async () => {
    const fake = await selected('a')

    move.onPointerDown!(fake.ctx, at(50, 325))
    await settle()
    move.onPointerMove!(fake.ctx, at(320, 325))

    expect(marks('data-insertion-line').map(boxOf)).toEqual([{ left: 673, top: 620, width: 2, height: 100 }])
    move.onPointerUp!(fake.ctx, at(320, 325))
    expect(fake.ops()).toEqual([{ target: [edId('a')], kind: 'moveNode', payload: { parent: edId('row'), before: null } }])
  })

  it('reorders along y in a column, with a horizontal line', async () => {
    const fake = await selected('d')

    move.onPointerDown!(fake.ctx, at(700, 320))
    await settle()
    move.onPointerMove!(fake.ctx, at(700, 390))

    expect(marks('data-insertion-line').map(boxOf)).toEqual([{ left: 1210, top: 819, width: 400, height: 2 }])
    move.onPointerUp!(fake.ctx, at(700, 390))
    expect(fake.ops()).toEqual([{ target: [edId('d')], kind: 'moveNode', payload: { parent: edId('col'), before: null } }])
  })

  it('draws no line and sends nothing when the drop is where the child already is', async () => {
    const fake = await selected('a')

    move.onPointerDown!(fake.ctx, at(50, 325))
    await settle()
    move.onPointerMove!(fake.ctx, at(60, 325))

    expect(layer(viewport, 'move')).toEqual([])
    expect(move.onPointerUp!(fake.ctx, at(60, 325))).toBe(true)
    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('reads the rects of rendered element children only', async () => {
    const fake = await selected('a')

    await drag(fake, [50, 325], [250, 325])

    expect(fake.reads('rects').map((read) => read.kind === 'rects' && read.edId)).toEqual(
      expect.arrayContaining(['a', 'b', 'unrendered', 'c']),
    )
    expect(fake.reads('rects').map((read) => read.kind === 'rects' && read.edId)).not.toContain('cond')
  })

  it("shows the server's warnings for a reorder", async () => {
    const fake = await selected('a')
    fake.ctx.apply.mockImplementation(async (op) => ackFor(op, ['.row > :first-child no longer matches']))

    await drag(fake, [50, 325], [250, 325])
    await settle()

    expect(fake.ctx.toast).toHaveBeenCalledWith({ message: '.row > :first-child no longer matches', tone: 'warning' })
  })
})

describe('dragging a transformed element', () => {
  it('changes only the translate term', async () => {
    const fake = await selected('rotated')

    await drag(fake, [450, 650], [460, 655])

    expect(fake.writes()).toEqual(['transform: translate(14px, 11px) rotate(-2deg)'])
  })

  it('writes a translate when no transform is authored', async () => {
    const fake = await selected('bare')

    await drag(fake, [650, 650], [660, 655])

    expect(fake.writes()).toEqual(['transform: translate(10px, 5px)'])
  })
})

describe('the action behind a drag', () => {
  it('begins one action on press and sends every write of the drag under it', async () => {
    const fake = await selected('card')

    await drag(fake, [150, 100], [180, 115])

    expect(fake.ctx.beginAction).toHaveBeenCalledTimes(1)
    expect(fake.ctx.beginAction).toHaveBeenCalledWith({ held: true })
    expect(fake.actionIds()).toEqual(['action-1', 'action-1'])
  })

  it('begins a fresh action for each drag', async () => {
    const fake = await selected('card')

    await drag(fake, [150, 100], [180, 100])
    await settle()
    await drag(fake, [150, 100], [160, 100])

    expect(fake.actionIds()).toEqual(['action-1', 'action-2'])
  })
})

describe('tracking several selected elements', () => {
  it('claims a press between two selected elements, inside their union', async () => {
    const fake = await selectedAll(['card', 'card2'])

    expect(move.onPointerDown!(fake.ctx, at(325, 175))).toBe(true)
    move.onPointerUp!(fake.ctx, at(325, 175))
  })

  it('leaves a press outside the union to selection', async () => {
    const fake = await selectedAll(['card', 'card2'])

    expect(move.onPointerDown!(fake.ctx, at(500, 100))).toBe(false)
  })

  it('claims a press the canvas hands over right after selecting, and moves by the whole drag that outran the hit', async () => {
    const fake = await selectedAll([])

    fake.select('card')
    expect(move.onPointerDown!(fake.ctx, at(150, 100))).toBe(true)
    move.onPointerMove!(fake.ctx, at(180, 115))
    await settle()

    expect(move.onPointerUp!(fake.ctx, at(180, 115))).toBe(true)
    expect(fake.writes()).toEqual(['left: 130px', 'top: 65px'])
  })
})

describe('moving several absolute elements together', () => {
  it('writes each element’s left and top by the same delta', async () => {
    const fake = await selectedAll(['card', 'card2'])

    expect(await drag(fake, [150, 100], [180, 115])).toBe(true)

    expect(fake.ops()).toHaveLength(4)
    expect(fake.ops()).toEqual(
      expect.arrayContaining([
        { target: [edId('card')], kind: 'setDecl', payload: { prop: 'left', value: '130px' } },
        { target: [edId('card')], kind: 'setDecl', payload: { prop: 'top', value: '65px' } },
        { target: [edId('card2')], kind: 'setDecl', payload: { prop: 'left', value: '380px' } },
        { target: [edId('card2')], kind: 'setDecl', payload: { prop: 'top', value: '215px' } },
      ]),
    )
  })

  it('leaves a selected element inside another selected one to move with it, rather than moving it twice', async () => {
    const fake = await selectedAll(['card', 'pip'])

    await drag(fake, [150, 100], [160, 100])

    expect(fake.writes()).toEqual(['left: 110px'])
  })

  it('moves the right offset a stylesheet rule anchors, building on the rule value', async () => {
    const fake = await selected('card', { styles: {} })
    withRules(fake, [helmetRule('.card', { right: '20px' })], { '.card': ['card'] })

    await drag(fake, [150, 100], [160, 100])

    expect(fake.writes()).toEqual(['right: 10px'])
  })

  it('sends every element’s writes under the one action begun at press, so they are one undo entry', async () => {
    const fake = await selectedAll(['card', 'card2'])

    await drag(fake, [150, 100], [180, 115])

    expect(fake.ctx.beginAction).toHaveBeenCalledTimes(1)
    expect(fake.ctx.beginAction).toHaveBeenCalledWith({ held: true })
    expect(fake.actionIds()).toEqual(['action-1', 'action-1', 'action-1', 'action-1'])
    expect(fake.undoEntries()).toBe(1)
  })

  it('moves them all when the press lands on one of several selected elements', async () => {
    const fake = await selectedAll(['card', 'card2'])

    expect(await drag(fake, [400, 225], [410, 230])).toBe(true)

    expect([...fake.writes()].sort()).toEqual(['left: 110px', 'left: 360px', 'top: 205px', 'top: 55px'])
  })

  it('reads a drag plan for every selected element', async () => {
    const fake = await selectedAll(['card', 'card2'])

    await drag(fake, [150, 100], [180, 115])

    expect(fake.reads('snapRects')).toEqual(
      expect.arrayContaining([
        { kind: 'snapRects', edId: edId('card') },
        { kind: 'snapRects', edId: edId('card2') },
      ]),
    )
  })

  it('snaps the union rect, so its centre lands on the parent’s centre and the guide is drawn there', async () => {
    const fake = await selectedAll(['card', 'card2'])

    move.onPointerDown!(fake.ctx, at(150, 100))
    await settle()
    move.onPointerMove!(fake.ctx, at(512, 100))

    expect(marks('data-snap-guide').map((mark) => [mark.getAttribute('data-snap-guide'), boxOf(mark)])).toEqual([
      ['x', { left: 1290, top: 20, width: 1, height: 1800 }],
    ])

    move.onPointerUp!(fake.ctx, at(512, 100))

    expect([...fake.writes()].sort()).toEqual(['left: 465px', 'left: 715px'])
  })

  it('writes nothing when Escape cancels the drag', async () => {
    const fake = await selectedAll(['card', 'card2'])

    move.onPointerDown!(fake.ctx, at(150, 100))
    await settle()
    move.onPointerMove!(fake.ctx, at(180, 115))
    move.onCancel!(fake.ctx)

    expect(move.onPointerUp!(fake.ctx, at(180, 115))).toBe(false)
    expect(fake.ctx.apply).not.toHaveBeenCalled()
    expect(layer(viewport, 'move')).toEqual([])
  })
})

describe('a mixed selection', () => {
  it.each([
    ['a static element', 'plain', [950, 650]],
    ['a flex child', 'a', [50, 325]],
    ['a transformed element', 'rotated', [450, 650]],
  ] as const)('refuses to move absolute elements together with %s, with a toast', async (_name, other, [x, y]) => {
    const fake = await selectedAll(['card', other])

    move.onPointerDown!(fake.ctx, at(x, y))
    await settle()
    move.onPointerMove!(fake.ctx, at(x + 30, y + 15))
    move.onPointerUp!(fake.ctx, at(x + 30, y + 15))
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
    expect(fake.ctx.toast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }))
  })
})

describe('arrow keys', () => {
  it('leaves them to the action registry, so a keydown on the canvas writes nothing by itself', async () => {
    const fake = await selected('card')

    const event = keydown('ArrowRight')
    await settle()

    expect(event.defaultPrevented).toBe(false)
    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })
})
