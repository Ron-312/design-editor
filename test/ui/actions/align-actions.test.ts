/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest'
import type { EditOp, StyleSource } from '../../../src/shared/types'
import { createDefaultRegistry, type ActionRegistry, type Platform } from '../../../src/ui/actions/registry'
import type { EditorAction } from '../../../src/ui/plugin-api'
import { edId, fakeContext, inline, node, rect, settle, type FakeContext } from '../canvas/tool-context'

// root > stage (relative, 400 × 300 at the board origin) > a, b, c, d (absolute); p, q (static);
// row (flex row) > f1, f2; col (flex column) > g1, g2
const tree = node('root', [
  node('stage', [node('a'), node('b'), node('c'), node('d'), node('p'), node('q')]),
  node('row', [node('f1'), node('f2')]),
  node('col', [node('g1'), node('g2')]),
])

/** The stage sits at the board origin, so each absolute box's board rect is also its offset from the stage. */
const rects = {
  root: [rect(0, 0, 1280, 900)],
  stage: [rect(0, 0, 400, 300)],
  a: [rect(40, 30, 100, 50)],
  b: [rect(200, 90, 60, 40)],
  c: [rect(300, 260, 80, 30)],
  d: [rect(340, 200, 40, 40)],
  p: [rect(0, 400, 400, 20)],
  q: [rect(0, 420, 400, 20)],
  row: [rect(0, 500, 400, 100)],
  f1: [rect(0, 500, 100, 40)],
  f2: [rect(116, 500, 100, 60)],
  col: [rect(500, 500, 300, 200)],
  g1: [rect(500, 500, 120, 40)],
  g2: [rect(500, 556, 160, 40)],
}

const NO_MARGINS = { 'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px' }

function absolute(left: number, top: number, width: number, height: number) {
  const insets = { left: `${left}px`, top: `${top}px`, right: `${400 - left - width}px`, bottom: `${300 - top - height}px` }
  return { position: 'absolute', display: 'block', transform: 'none', 'align-self': 'auto', ...insets, ...NO_MARGINS }
}

const IN_FLOW = { position: 'static', display: 'block', transform: 'none', 'align-self': 'auto', ...NO_MARGINS }

const computed = {
  root: { position: 'static', display: 'block' },
  stage: { position: 'relative', display: 'block' },
  a: absolute(40, 30, 100, 50),
  b: absolute(200, 90, 60, 40),
  c: absolute(300, 260, 80, 30),
  d: absolute(340, 200, 40, 40),
  p: IN_FLOW,
  q: IN_FLOW,
  row: { position: 'static', display: 'flex', 'flex-direction': 'row', 'align-items': 'normal' },
  f1: IN_FLOW,
  f2: IN_FLOW,
  col: { position: 'static', display: 'flex', 'flex-direction': 'column', 'align-items': 'normal' },
  g1: IN_FLOW,
  g2: IN_FLOW,
}

/** `c` is anchored by its authored right and bottom, the others by left and top. */
const authored: Record<string, Record<string, string>> = {
  a: { position: 'absolute', left: '40px', top: '30px' },
  b: { position: 'absolute', left: '200px', top: '90px' },
  c: { position: 'absolute', right: '20px', bottom: '10px' },
  d: { position: 'absolute', left: '340px', top: '200px' },
  row: { display: 'flex' },
  col: { display: 'flex', 'flex-direction': 'column' },
}

const styles: Record<string, readonly StyleSource[]> = Object.fromEntries(Object.entries(authored).map(([id, declarations]) => [id, inline(declarations)]))

type Modifiers = Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>>

const ALT = { altKey: true }
const ALT_SHIFT = { altKey: true, shiftKey: true }

interface Editor {
  readonly fake: FakeContext
  readonly registry: ActionRegistry
  /** Presses a key on the canvas; `key` is what the layout types, `code` the physical key. */
  readonly press: (key: string, code: string, modifiers?: Modifiers) => boolean
}

function editor(selection: readonly string[], platform: Platform = 'windows'): Editor {
  const fake = fakeContext({ tree, rects, computed, styles }, { selection })
  const registry = createDefaultRegistry(platform)
  const press = (key: string, code: string, modifiers: Modifiers = {}) => {
    const event = { key, code, repeat: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers, preventDefault: vi.fn() }
    return registry.handleKeyDown(event as unknown as KeyboardEvent, fake.ctx)
  }
  return { fake, registry, press }
}

function actionBoundTo(registry: ActionRegistry, chord: string): EditorAction {
  const bound = registry.all().find((action) => [action.kbd ?? []].flat().some((kbd) => kbd.toLowerCase() === chord.toLowerCase()))
  if (!bound) throw new Error(`no action is bound to ${chord}`)
  return bound
}

/** The declarations an element ends with: its authored ones with every op sent for it applied in order. */
function finalStyle(fake: FakeContext, id: string): Record<string, string> {
  const style = { ...authored[id] }
  for (const op of fake.ops().filter((entry) => entry.target.includes(edId(id)))) {
    if (op.kind === 'setDecl') style[op.payload.prop] = op.payload.value
    if (op.kind === 'removeDecl') delete style[op.payload.prop]
  }
  return style
}

function writtenProps(fake: FakeContext, id: string): string[] {
  return fake.ops().flatMap((op) => (op.target.includes(edId(id)) && (op.kind === 'setDecl' || op.kind === 'removeDecl') ? [op.payload.prop] : []))
}

function toastMessages(fake: FakeContext): string[] {
  return fake.ctx.toast.mock.calls.map(([toast]) => toast.message)
}

/** The ops sent, without the fields the context adds. */
function declarationOps(fake: FakeContext): Array<Pick<EditOp, 'target' | 'kind' | 'payload'>> {
  return fake.ops().map(({ target, kind, payload }) => ({ target, kind, payload }))
}

describe('aligning absolutely positioned siblings to the selection bounds', () => {
  it('Alt-A moves each left edge onto the leftmost one', async () => {
    const { fake, press } = editor(['a', 'b'])

    expect(press('a', 'KeyA', ALT)).toBe(true)
    await settle()

    expect(finalStyle(fake, 'a')).toEqual(authored.a)
    expect(finalStyle(fake, 'b')).toEqual({ ...authored.b, left: '40px' })
  })

  it('Alt-H moves each horizontal centre onto the centre of the bounds', async () => {
    // Bounds 40–260, centre 150: a's centre 90 moves +60, b's centre 230 moves -80.
    const { fake, press } = editor(['a', 'b'])

    press('h', 'KeyH', ALT)
    await settle()

    expect(finalStyle(fake, 'a')).toEqual({ ...authored.a, left: '100px' })
    expect(finalStyle(fake, 'b')).toEqual({ ...authored.b, left: '120px' })
  })

  it('Alt-D moves each right edge onto the rightmost one', async () => {
    // Bounds right 380: a's right edge 140 moves +240, b's 260 moves +120, c is already there.
    const { fake, press } = editor(['a', 'b', 'c'])

    press('d', 'KeyD', ALT)
    await settle()

    expect(finalStyle(fake, 'a')).toEqual({ ...authored.a, left: '280px' })
    expect(finalStyle(fake, 'b')).toEqual({ ...authored.b, left: '320px' })
    expect(finalStyle(fake, 'c')).toEqual(authored.c)
  })

  it('Alt-W moves each top edge onto the topmost one', async () => {
    const { fake, press } = editor(['a', 'b'])

    press('w', 'KeyW', ALT)
    await settle()

    expect(finalStyle(fake, 'a')).toEqual(authored.a)
    expect(finalStyle(fake, 'b')).toEqual({ ...authored.b, top: '30px' })
  })

  it('Alt-V moves each vertical centre onto the middle of the bounds', async () => {
    // Bounds 30–130, middle 80: a's middle 55 moves +25, b's middle 110 moves -30.
    const { fake, press } = editor(['a', 'b'])

    press('v', 'KeyV', ALT)
    await settle()

    expect(finalStyle(fake, 'a')).toEqual({ ...authored.a, top: '55px' })
    expect(finalStyle(fake, 'b')).toEqual({ ...authored.b, top: '60px' })
  })

  it('Alt-S moves each bottom edge onto the lowest one', async () => {
    // Bounds bottom 290: a's bottom 80 moves +210.
    const { fake, press } = editor(['a', 'c'])

    press('s', 'KeyS', ALT)
    await settle()

    expect(finalStyle(fake, 'a')).toEqual({ ...authored.a, top: '240px' })
    expect(finalStyle(fake, 'c')).toEqual(authored.c)
  })

  it('writes the authored right offset of a right-anchored box, never a left one', async () => {
    // c moves from x 300 to 40, so its right offset grows by 260.
    const { fake, press } = editor(['a', 'c'])

    press('a', 'KeyA', ALT)
    await settle()

    expect(finalStyle(fake, 'c')).toEqual({ ...authored.c, right: '280px' })
    expect(writtenProps(fake, 'c')).not.toContain('left')
  })

  it('writes the authored bottom offset of a bottom-anchored box, never a top one', async () => {
    // c moves from y 260 to 30, so its bottom offset grows by 230.
    const { fake, press } = editor(['a', 'c'])

    press('w', 'KeyW', ALT)
    await settle()

    expect(finalStyle(fake, 'c')).toEqual({ ...authored.c, bottom: '240px' })
    expect(writtenProps(fake, 'c')).not.toContain('top')
  })

  it('touches only the axis it aligns on', async () => {
    const { fake, press } = editor(['a', 'b', 'd'])

    press('a', 'KeyA', ALT)
    await settle()

    expect(finalStyle(fake, 'd')).toEqual({ ...authored.d, left: '40px' })
    for (const id of ['a', 'b', 'd']) expect(writtenProps(fake, id).filter((prop) => prop !== 'left')).toEqual([])
  })

  it('reads Option-A on macOS, which types å, as align left', async () => {
    const { fake, press } = editor(['a', 'b'], 'mac')

    expect(press('å', 'KeyA', ALT)).toBe(true)
    await settle()

    expect(finalStyle(fake, 'b')).toEqual({ ...authored.b, left: '40px' })
  })
})

describe('distributing three or more absolutely positioned siblings', () => {
  it('Alt-Shift-H makes the horizontal gaps equal and keeps the outermost boxes', async () => {
    // Sorted by left: a 40–140, b 200–260, d 340–380. Span 340, widths 200, so gaps of 70 put b at 210.
    const { fake, press } = editor(['a', 'b', 'd'])

    expect(press('H', 'KeyH', ALT_SHIFT)).toBe(true)
    await settle()

    expect(finalStyle(fake, 'a')).toEqual(authored.a)
    expect(finalStyle(fake, 'b')).toEqual({ ...authored.b, left: '210px' })
    expect(finalStyle(fake, 'd')).toEqual(authored.d)
  })

  it('Alt-Shift-V makes the vertical gaps equal and keeps the outermost boxes', async () => {
    // Sorted by top: a 30–80, b 90–130, d 200–240. Span 210, heights 130, so gaps of 40 put b at 120.
    const { fake, press } = editor(['a', 'b', 'd'])

    expect(press('V', 'KeyV', ALT_SHIFT)).toBe(true)
    await settle()

    expect(finalStyle(fake, 'a')).toEqual(authored.a)
    expect(finalStyle(fake, 'b')).toEqual({ ...authored.b, top: '120px' })
    expect(finalStyle(fake, 'd')).toEqual(authored.d)
  })

  it('refuses two elements with its tooltip text', async () => {
    const { fake, registry, press } = editor(['a', 'b'])
    const distribute = actionBoundTo(registry, 'Alt+Shift+H')

    press('H', 'KeyH', ALT_SHIFT)
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
    expect(distribute.disabledReason).toBeTruthy()
    expect(toastMessages(fake)).toContain(distribute.disabledReason)
  })

  it('is listed with a label for the palette, and running it from there distributes under the id it is given', async () => {
    const { fake, registry } = editor(['a', 'b', 'd'])
    const horizontal = actionBoundTo(registry, 'Alt+Shift+H')
    const vertical = actionBoundTo(registry, 'Alt+Shift+V')

    expect(horizontal.label).toMatch(/distribute/i)
    expect(vertical.label).toMatch(/distribute/i)
    horizontal.run(fake.ctx, 'palette-action')
    await settle()

    expect(finalStyle(fake, 'b')).toEqual({ ...authored.b, left: '210px' })
    expect(new Set(fake.actionIds())).toEqual(new Set(['palette-action']))
  })
})

describe('aligning a single flex child along the cross axis', () => {
  it.each([
    { key: 'w', code: 'KeyW', value: 'flex-start' },
    { key: 'v', code: 'KeyV', value: 'center' },
    { key: 's', code: 'KeyS', value: 'flex-end' },
  ])('Alt-$key in a row sets align-self: $value', async ({ key, code, value }) => {
    const { fake, press } = editor(['f1'])

    press(key, code, ALT)
    await settle()

    expect(declarationOps(fake)).toEqual([
      {
        target: [edId('f1')],
        kind: 'setDecl',
        payload: { prop: 'align-self', value },
      },
    ])
  })

  it.each([
    { key: 'a', code: 'KeyA', value: 'flex-start' },
    { key: 'h', code: 'KeyH', value: 'center' },
    { key: 'd', code: 'KeyD', value: 'flex-end' },
  ])('Alt-$key in a column sets align-self: $value', async ({ key, code, value }) => {
    const { fake, press } = editor(['g1'])

    press(key, code, ALT)
    await settle()

    expect(declarationOps(fake)).toEqual([
      {
        target: [edId('g1')],
        kind: 'setDecl',
        payload: { prop: 'align-self', value },
      },
    ])
  })

  it('refuses a main-axis alignment with the tooltip text', async () => {
    const { fake, registry, press } = editor(['f1'])
    const alignLeft = actionBoundTo(registry, 'Alt+A')

    press('a', 'KeyA', ALT)
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
    expect(alignLeft.disabledReason).toBeTruthy()
    expect(toastMessages(fake)).toContain(alignLeft.disabledReason)
  })
})

describe('what align refuses', () => {
  it.each([
    ['two flex children', ['f1', 'f2']],
    ['two flex children of a column', ['g1', 'g2']],
    ['static siblings', ['p', 'q']],
    ['an absolute box with a flex child', ['a', 'f1']],
  ])('refuses %s with the tooltip text and writes nothing, not even align-items on the parent', async (_name, selection) => {
    const { fake, registry, press } = editor(selection)
    const alignTop = actionBoundTo(registry, 'Alt+W')

    press('w', 'KeyW', ALT)
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
    expect(alignTop.disabledReason).toBeTruthy()
    expect(toastMessages(fake)).toContain(alignTop.disabledReason)
  })

  it('writes nothing while a push holds the lock', async () => {
    const { fake, press } = editor(['a', 'b'])
    fake.setReadOnly(true)

    press('a', 'KeyA', ALT)
    press('w', 'KeyW', ALT)
    press('H', 'KeyH', ALT_SHIFT)
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('writes nothing with an empty selection', async () => {
    const { fake, press } = editor([])

    press('a', 'KeyA', ALT)
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })
})

describe('one undo entry per command', () => {
  it('sends every write of one command together under one action id, without waiting for each ack', async () => {
    const { fake, press } = editor(['a', 'b', 'c'])
    fake.ctx.apply.mockImplementation(() => new Promise<never>(() => {}))

    press('d', 'KeyD', ALT)
    await settle()

    expect(finalStyle(fake, 'a')).toEqual({ ...authored.a, left: '280px' })
    expect(finalStyle(fake, 'b')).toEqual({ ...authored.b, left: '320px' })
    const [first, ...rest] = fake.actionIds()
    expect(first).toEqual(expect.any(String))
    expect(rest).toEqual(rest.map(() => first))
  })

  it('gives two presses two action ids', async () => {
    const { fake, press } = editor(['a', 'b'])

    press('a', 'KeyA', ALT)
    await settle()
    const firstPress = fake.actionIds()
    press('s', 'KeyS', ALT)
    await settle()
    const secondPress = fake.actionIds().slice(firstPress.length)

    expect(new Set(firstPress).size).toBe(1)
    expect(new Set(secondPress).size).toBe(1)
    expect(secondPress[0]).toEqual(expect.any(String))
    expect(secondPress[0]).not.toBe(firstPress[0])
  })
})
