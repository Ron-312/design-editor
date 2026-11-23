// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult } from '../../../src/shared/protocol'
import type { AuthoredDeclaration, EdId, EditOp, ProjectPath, StyleSource, TemplateNode } from '../../../src/shared/types'
import { isOutsideSrgb } from '../../../src/ui/panels/colour'
import { PropertiesPanel } from '../../../src/ui/panels/PropertiesPanel'
import type { AckMessage, EditorContext } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const edId = (id: string) => id as EdId
const board = 'project/card.dc.html' as ProjectPath

const tree: TemplateNode = {
  edId: edId('root'),
  kind: 'element',
  tag: 'x-dc',
  name: 'root',
  readOnly: 'artboard-root',
  children: [{ edId: edId('card'), kind: 'element', tag: 'div', name: 'card', children: [] }],
}

function decl(prop: string, value: string): AuthoredDeclaration {
  return { prop, value, important: false, hasHole: false }
}

function cardStyles(background: string): BoardIndex['styles'] {
  const inline: StyleSource = { target: 'inline', file: board, line: 12, range: { start: 0, end: 0 }, declarations: [decl('background-color', background)] }
  return { card: [inline] } as BoardIndex['styles']
}

function answer(read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'rects':
      return { kind: 'rects', rects: [{ x: 0, y: 0, width: 100, height: 20 }] }
    case 'computed':
      return { kind: 'computed', values: Object.fromEntries(read.props.map((prop) => [prop, ''])) }
    case 'hitTest':
      return { kind: 'hitTest', edId: null }
    case 'snapRects':
      return { kind: 'snapRects', self: { x: 0, y: 0, width: 100, height: 20 }, parent: null, siblings: [] }
    case 'supports':
      return { kind: 'supports', supported: true }
    case 'matches':
      return { kind: 'matches', matched: read.selectors.map(() => false) }
    case 'documentHeight':
      return { kind: 'documentHeight', scrollHeight: 0 }
  }
}

function ackFor(op: EditOp): AckMessage {
  return {
    type: 'ack',
    opId: 'op-1',
    record: { target: op.target, kind: op.kind, prop: null, before: null, after: null, scope: { kind: 'element' }, files: [board] },
    mintedIds: [],
    locations: {},
    resolved: {},
    reload: false,
    warnings: [],
  }
}

const editorState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function contextFor(store: EditorStore) {
  let actions = 0
  return {
    index: () => store.getState().index,
    selection: () => {
      const { board: current, view } = store.getState()
      return current ? { board: current, edIds: view.selection } : null
    },
    viewport: () => store.getState().view.viewport,
    editorState: () => editorState,
    readOnly: () => store.getState().readOnly,
    select: (edIds: readonly EdId[]) => store.select(edIds),
    setViewport: (viewport) => store.setViewport(viewport),
    apply: vi.fn(async (op: EditOp, _actionId?: string) => ackFor(op)),
    beginAction: vi.fn(() => `action-${++actions}`),
    preview: vi.fn((_op: EditOp) => {}),
    setMode: (mode: 'select' | 'hand') => store.setMode(mode),
    fit: vi.fn(),
    cancelGesture: vi.fn(() => false),
    setEditorState: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    read: <R extends ProbeRead>(read: R) => Promise.resolve(answer(read)) as Promise<Extract<ProbeReadResult, { kind: R['kind'] }>>,
    records: () => store.getState().records,
    toast: vi.fn(),
    onChange: (listener) => store.subscribe(listener),
  } satisfies EditorContext
}

type Context = ReturnType<typeof contextFor>

async function settle() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
}

let mounted: { root: Root; container: HTMLElement } | null = null

async function mountPanel(background = '#1a73e8'): Promise<Context> {
  const store = createEditorStore()
  store.setBoard(board)
  store.setIndex({ board, frameSrc: `/project/secret/${board}`, tree, text: '', rules: [], locations: {}, styles: cardStyles(background) })
  store.select([edId('card')])
  const ctx = contextFor(store)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  act(() => root.render(<PropertiesPanel ctx={ctx} tokens={[]} />))
  await settle()
  return ctx
}

function field(prop: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-prop="${prop}"]`)
  if (!found) throw new Error(`no field for ${prop}`)
  return found
}

function picker(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Colour picker"]')
  if (!found) throw new Error('the colour picker is not open')
  return found
}

function inPicker<E extends Element = HTMLElement>(selector: string): E {
  const found = picker().querySelector<E>(selector)
  if (!found) throw new Error(`the colour picker has no ${selector}`)
  return found
}

const square = () => inPicker('[aria-label="Saturation and value"]')
const slider = (label: 'Hue' | 'Alpha') => inPicker(`[role="slider"][aria-label="${label}"]`)
const notation = () => inPicker<HTMLSelectElement>('select[aria-label="Notation"]')

async function openPicker(prop = 'background-color') {
  const swatch = field(prop).querySelector<HTMLElement>('button[aria-haspopup="dialog"]')
  if (!swatch) throw new Error(`the ${prop} field has no swatch button`)
  act(() => swatch.click())
  await settle()
}

function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', target: Element, clientX: number, clientY: number) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, clientX, clientY }),
  )
}

function key(target: Element, type: 'keydown' | 'keyup', keyName: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent(type, { key: keyName, bubbles: true, cancelable: true, ...init }))
}

function chooseNotation(value: string) {
  const select = notation()
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

const previewed = (ctx: Context) => ctx.preview.mock.calls.map(([op]) => op)
const applied = (ctx: Context) => ctx.apply.mock.calls.map(([op]) => op)
const valueOf = (op: EditOp) => (op.kind === 'setDecl' ? op.payload.value : null)

/** Presses the square's centre, passes through `via`, and leaves the pointer at `to`; every rect is 200 by 100 at the origin. */
function dragOnSquare(via: readonly (readonly [number, number])[], to: readonly [number, number]) {
  const target = square()
  act(() => pointer('pointerdown', target, 100, 50))
  for (const [x, y] of via) act(() => pointer('pointermove', target, x, y))
  act(() => pointer('pointermove', target, to[0], to[1]))
}

function release(at: readonly [number, number]) {
  act(() => pointer('pointerup', square(), at[0], at[1]))
}

const BOTTOM_LEFT = [0, 100] as const

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100))
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.hasPointerCapture ??= () => false
})

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted
    act(() => root.unmount())
    container.remove()
    mounted = null
  }
  Reflect.deleteProperty(window, 'EyeDropper')
  vi.restoreAllMocks()
})

describe('the colour picker popover', () => {
  it.each(['background-color', 'border-color'])('opens from the %s swatch with a square, hue and alpha sliders and a notation menu', async (prop) => {
    await mountPanel()

    await openPicker(prop)

    expect(square()).toBeTruthy()
    expect(slider('Hue')).toBeTruthy()
    expect(slider('Alpha')).toBeTruthy()
    expect([...notation().options].map((entry) => entry.value)).toEqual(['hex', 'rgb', 'hsl', 'oklch'])
  })

  it.each([
    ['#1a73e8', 'hex'],
    ['rgb(26 115 232)', 'rgb'],
    ['hsl(210 50% 40%)', 'hsl'],
    ['oklch(0.7 0.15 30)', 'oklch'],
  ])('defaults the notation of %s to %s', async (authored, expected) => {
    await mountPanel(authored)

    await openPicker()

    expect(notation().value).toBe(expected)
  })
})

describe('the eyedropper', () => {
  it('is hidden where the EyeDropper API is missing', async () => {
    await mountPanel()

    await openPicker()

    expect(picker().querySelector('button[aria-label="Eyedropper"]')).toBeNull()
  })

  it('writes the colour picked from the screen in the authored notation', async () => {
    const EyeDropper = class {
      open() {
        return Promise.resolve({ sRGBHex: '#00ff00' })
      }
    }
    Object.defineProperty(window, 'EyeDropper', { value: EyeDropper, configurable: true, writable: true })
    const ctx = await mountPanel('rgb(26 115 232)')
    await openPicker()

    act(() => inPicker<HTMLButtonElement>('button[aria-label="Eyedropper"]').click())
    await settle()

    expect(applied(ctx)).toEqual([{ target: [edId('card')], kind: 'setDecl', payload: { prop: 'background-color', value: 'rgb(0 255 0)' } }])
  })
})

describe('dragging on the square', () => {
  it('previews every move and writes nothing until release', async () => {
    const ctx = await mountPanel()
    await openPicker()

    dragOnSquare([[150, 30]], BOTTOM_LEFT)

    expect(ctx.apply).not.toHaveBeenCalled()
    expect(ctx.preview.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const op of previewed(ctx)) expect(op).toMatchObject({ target: [edId('card')], kind: 'setDecl', payload: { prop: 'background-color' } })
    expect(valueOf(previewed(ctx).at(-1)!)).toBe('#000000')
  })

  it('commits one apply on release', async () => {
    const ctx = await mountPanel()
    await openPicker()

    dragOnSquare([[150, 30], [40, 70]], BOTTOM_LEFT)
    release(BOTTOM_LEFT)
    await settle()

    expect(applied(ctx)).toEqual([{ target: [edId('card')], kind: 'setDecl', payload: { prop: 'background-color', value: '#000000' } }])
  })

  it('writes in the notation chosen in the menu', async () => {
    const ctx = await mountPanel()
    await openPicker()

    act(() => chooseNotation('rgb'))
    dragOnSquare([], BOTTOM_LEFT)
    release(BOTTOM_LEFT)
    await settle()

    expect(valueOf(applied(ctx).at(-1)!)).toBe('rgb(0 0 0)')
  })

  it('re-previews the original value on Escape and writes nothing', async () => {
    const ctx = await mountPanel()
    await openPicker()

    dragOnSquare([[150, 30]], BOTTOM_LEFT)
    const target = square()
    act(() => key(target, 'keydown', 'Escape'))
    act(() => pointer('pointerup', target, ...BOTTOM_LEFT))
    await settle()

    expect(valueOf(previewed(ctx).at(-1)!)).toBe('#1a73e8')
    expect(ctx.apply).not.toHaveBeenCalled()
  })
})

describe('slider keyboard steps', () => {
  function holdArrow(target: Element, keyName: 'ArrowUp' | 'ArrowDown', repeats: number) {
    act(() => key(target, 'keydown', keyName))
    for (let at = 0; at < repeats; at++) act(() => key(target, 'keydown', keyName, { repeat: true }))
    act(() => key(target, 'keyup', keyName))
  }

  it('writes a held hue step as one action', async () => {
    const ctx = await mountPanel()
    await openPicker()

    holdArrow(slider('Hue'), 'ArrowUp', 2)
    await settle()

    expect(ctx.beginAction).toHaveBeenCalledTimes(1)
    expect(ctx.apply.mock.calls.map(([, actionId]) => actionId)).toEqual(['action-1', 'action-1', 'action-1'])
    for (const op of applied(ctx)) expect(valueOf(op)).toMatch(/^#[0-9a-f]{6}$/)
    expect(valueOf(applied(ctx).at(-1)!)).not.toBe('#1a73e8')
  })

  it('gives separate presses separate actions', async () => {
    const ctx = await mountPanel()
    await openPicker()

    holdArrow(slider('Hue'), 'ArrowUp', 0)
    holdArrow(slider('Hue'), 'ArrowUp', 0)
    await settle()

    expect(ctx.apply.mock.calls.map(([, actionId]) => actionId)).toEqual(['action-1', 'action-2'])
  })

  it('lowers the alpha in the authored notation', async () => {
    const ctx = await mountPanel()
    await openPicker()

    holdArrow(slider('Alpha'), 'ArrowDown', 0)
    await settle()

    expect(valueOf(applied(ctx).at(-1)!)).toMatch(/^#1a73e8[0-9a-f]{2}$/)
  })
})

describe('an authored oklch outside sRGB', () => {
  const WIDE = 'oklch(0.7 0.3 150)'

  it('shows an "outside sRGB" badge and keeps its text while the picker is open', async () => {
    const ctx = await mountPanel(WIDE)

    await openPicker()

    expect(picker().textContent).toContain('outside sRGB')
    expect(field('background-color').querySelector<HTMLInputElement>('input[aria-label="Colour"]')!.value).toBe(WIDE)
    expect(ctx.apply).not.toHaveBeenCalled()
    expect(ctx.preview).not.toHaveBeenCalled()
  })

  it('shows no badge for an oklch inside sRGB', async () => {
    await mountPanel('oklch(0.7 0.1 150)')

    await openPicker()

    expect(picker().textContent).not.toContain('outside sRGB')
  })

  it('writes an oklch value inside sRGB once the user drags', async () => {
    const ctx = await mountPanel(WIDE)
    await openPicker()

    dragOnSquare([], [150, 20])
    release([150, 20])
    await settle()

    expect(ctx.apply).toHaveBeenCalledTimes(1)
    const written = valueOf(applied(ctx)[0]!)!
    expect(written).toMatch(/^oklch\(/)
    expect(written).not.toBe(WIDE)
    expect(isOutsideSrgb(written)).toBe(false)
  })
})
