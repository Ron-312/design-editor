// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult } from '../../../src/shared/protocol'
import type { AuthoredDeclaration, EdId, EditOp, ProjectPath, StyleSource, TemplateNode } from '../../../src/shared/types'
import { PropertiesPanel } from '../../../src/ui/panels/PropertiesPanel'
import { parseShadows } from '../../../src/ui/panels/shadows'
import type { AckMessage, EditorContext } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const edId = (id: string) => id as EdId
const card = edId('card')
const board = 'project/card.dc.html' as ProjectPath

const tree: TemplateNode = {
  edId: edId('root'),
  kind: 'element',
  tag: 'x-dc',
  name: 'root',
  readOnly: 'artboard-root',
  children: [{ edId: card, kind: 'element', tag: 'div', name: 'card', children: [] }],
}

const AUTHORED_SHADOWS = '0 4px 12px rgba(0, 0, 0, 0.04), inset 0 0 0 1px #e6ddcf'

function decl(prop: string, value: string): AuthoredDeclaration {
  return { prop, value, important: false, hasHole: false }
}

function cardStyles(declarations: Record<string, string>): BoardIndex['styles'] {
  const inline: StyleSource = {
    target: 'inline',
    file: board,
    line: 12,
    range: { start: 0, end: 0 },
    declarations: Object.entries(declarations).map(([prop, value]) => decl(prop, value)),
  }
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
    case 'rootFontSize':
      return { kind: 'rootFontSize', fontSize: 16 }
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

let mounted: { root: Root; container: HTMLElement; store: EditorStore } | null = null

async function mountPanel(declarations: Record<string, string> = {}): Promise<Context> {
  const store = createEditorStore()
  store.setBoard(board)
  store.setIndex({ board, frameSrc: `/project/secret/${board}`, tree, text: '', rules: [], locations: {}, styles: cardStyles(declarations) })
  store.select([card])
  const ctx = contextFor(store)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container, store }
  act(() => root.render(<PropertiesPanel ctx={ctx} tokens={[]} />))
  await settle()
  return ctx
}

/** The index update the server sends once a write lands. */
async function reindex(declarations: Record<string, string>) {
  const { store } = mounted!
  act(() => store.setIndex({ ...store.getState().index!, styles: cardStyles(declarations) }))
  await settle()
}

function field(prop: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-prop="${prop}"]`)
  if (!found) throw new Error(`no field for ${prop}`)
  return found
}

function within<E extends Element = HTMLElement>(scope: Element, selector: string): E {
  const found = scope.querySelector<E>(selector)
  if (!found) throw new Error(`nothing matches ${selector}`)
  return found
}

function button(label: string, scope: Element = document.body): HTMLButtonElement {
  return within<HTMLButtonElement>(scope, `button[aria-label="${label}"]`)
}

function inputIn(scope: Element, label: string): HTMLInputElement {
  return within<HTMLInputElement>(scope, `input[aria-label="${label}"]`)
}

function selectIn(prop: string, label: string): HTMLSelectElement {
  return within<HTMLSelectElement>(field(prop), `select[aria-label="${label}"]`)
}

function shadowRows(): HTMLElement[] {
  return [...field('box-shadow').querySelectorAll<HTMLElement>('[data-shadow]')]
}

function shadowRow(at: number): HTMLElement {
  const row = shadowRows()[at]
  if (!row) throw new Error(`no shadow row ${at}`)
  return row
}

function setNativeValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function commit(input: HTMLInputElement, value: string) {
  act(() => {
    input.focus()
    setNativeValue(input, value)
  })
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  await settle()
}

async function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

async function press(element: HTMLElement) {
  act(() => element.click())
  await settle()
}

function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', target: Element, clientX: number, clientY: number) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, clientX, clientY }),
  )
}

const applied = (ctx: Context) => ctx.apply.mock.calls.map(([op]) => op)
const actionIds = (ctx: Context) => ctx.apply.mock.calls.map(([, actionId]) => actionId)
const setDecl = (prop: string, value: string): EditOp => ({ target: [card], kind: 'setDecl', payload: { prop, value } })
const removeDecl = (prop: string): EditOp => ({ target: [card], kind: 'removeDecl', payload: { prop } })

function lastWritten(ctx: Context): string | null {
  const op = applied(ctx).at(-1)
  return op?.kind === 'setDecl' ? op.payload.value : null
}

/** Acks never arrive, so only ops sent without awaiting an earlier ack are seen. */
function withholdAcks(ctx: Context) {
  ctx.apply.mockImplementation(() => new Promise<AckMessage>(() => {}))
}

const CORNERS = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']
const SIDES = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']

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
  vi.restoreAllMocks()
})

describe('per-corner radius', () => {
  it('splits border-radius into the four corners as one action, sent without awaiting acks', async () => {
    const ctx = await mountPanel({ 'border-radius': '12px' })
    withholdAcks(ctx)

    await press(button('Independent corners'))

    expect(ctx.beginAction).toHaveBeenCalledTimes(1)
    expect(actionIds(ctx)).toEqual(['action-1', 'action-1', 'action-1', 'action-1', 'action-1'])
    expect(applied(ctx)).toHaveLength(5)
    expect(applied(ctx)).toEqual(expect.arrayContaining([removeDecl('border-radius'), ...CORNERS.map((prop) => setDecl(prop, '12px'))]))
  })

  it('keeps each authored value and unit on its corner', async () => {
    const ctx = await mountPanel({ 'border-radius': '4px 0.5rem' })

    await press(button('Independent corners'))

    expect(applied(ctx)).toEqual(
      expect.arrayContaining([
        setDecl('border-top-left-radius', '4px'),
        setDecl('border-top-right-radius', '0.5rem'),
        setDecl('border-bottom-right-radius', '4px'),
        setDecl('border-bottom-left-radius', '0.5rem'),
      ]),
    )
  })

  it('shows a pressed toggle and one field per corner once the corners are authored', async () => {
    await mountPanel({
      'border-top-left-radius': '1px',
      'border-top-right-radius': '2px',
      'border-bottom-right-radius': '3px',
      'border-bottom-left-radius': '4px',
    })

    expect(button('Independent corners').getAttribute('aria-pressed')).toBe('true')
    expect(CORNERS.map((prop) => within<HTMLInputElement>(field(prop), 'input').value)).toEqual(['1px', '2px', '3px', '4px'])
  })

  it('shows an unpressed toggle for a single border-radius', async () => {
    await mountPanel({ 'border-radius': '12px' })

    expect(button('Independent corners').getAttribute('aria-pressed')).toBe('false')
  })

  it('writes one corner in its authored unit', async () => {
    const ctx = await mountPanel({
      'border-top-left-radius': '1rem',
      'border-top-right-radius': '1rem',
      'border-bottom-right-radius': '1rem',
      'border-bottom-left-radius': '1rem',
    })

    await commit(within<HTMLInputElement>(field('border-top-left-radius'), 'input'), '2')

    expect(applied(ctx)).toEqual([setDecl('border-top-left-radius', '2rem')])
  })

  it('joins four matching corners back into border-radius as one action, sent without awaiting acks', async () => {
    const ctx = await mountPanel(Object.fromEntries(CORNERS.map((prop) => [prop, '8px'])))
    withholdAcks(ctx)

    await press(button('Independent corners'))

    expect(ctx.beginAction).toHaveBeenCalledTimes(1)
    expect(actionIds(ctx)).toEqual(['action-1', 'action-1', 'action-1', 'action-1', 'action-1'])
    expect(applied(ctx)).toHaveLength(5)
    expect(applied(ctx)).toEqual(expect.arrayContaining([...CORNERS.map(removeDecl), setDecl('border-radius', '8px')]))
  })

  it('writes nothing when the corners differ', async () => {
    const ctx = await mountPanel({
      'border-top-left-radius': '8px',
      'border-top-right-radius': '8px',
      'border-bottom-right-radius': '8px',
      'border-bottom-left-radius': '4px',
    })

    await press(button('Independent corners'))

    expect(ctx.apply).not.toHaveBeenCalled()
  })
})

describe('the shadow list', () => {
  it('shows x, y, blur and spread of each layer as authored', async () => {
    await mountPanel({ 'box-shadow': AUTHORED_SHADOWS })

    const shown = shadowRows().map((row) => ['X', 'Y', 'Blur', 'Spread'].map((label) => inputIn(row, label).value))
    expect(shown).toEqual([
      ['0', '4px', '12px', ''],
      ['0', '0', '0', '1px'],
    ])
  })

  it.each([
    [0, 'X', '2', '2px 4px 12px rgba(0, 0, 0, 0.04), inset 0 0 0 1px #e6ddcf'],
    [0, 'Y', '8', '0 8px 12px rgba(0, 0, 0, 0.04), inset 0 0 0 1px #e6ddcf'],
    [0, 'Blur', '20', '0 4px 20px rgba(0, 0, 0, 0.04), inset 0 0 0 1px #e6ddcf'],
    [1, 'Spread', '3', '0 4px 12px rgba(0, 0, 0, 0.04), inset 0 0 0 3px #e6ddcf'],
  ])('writes layer %i %s typed as %s into the whole list', async (at, label, typed, written) => {
    const ctx = await mountPanel({ 'box-shadow': AUTHORED_SHADOWS })

    await commit(inputIn(shadowRow(at), label), typed)

    expect(applied(ctx)).toEqual([setDecl('box-shadow', written)])
  })

  it('keeps focus and the text typed in a row when the index update for its last commit arrives', async () => {
    const ctx = await mountPanel({ 'box-shadow': '0 4px 12px #000' })
    const x = inputIn(shadowRow(0), 'X')
    act(() => {
      x.focus()
      setNativeValue(x, '2')
    })
    const y = inputIn(shadowRow(0), 'Y')
    act(() => {
      y.focus()
      setNativeValue(y, '9')
    })
    expect(lastWritten(ctx)).toBe('2px 4px 12px #000')

    await reindex({ 'box-shadow': '2px 4px 12px #000' })

    expect(inputIn(shadowRow(0), 'Y')).toBe(y)
    expect(y.value).toBe('9')
    expect(document.activeElement).toBe(y)
    expect(inputIn(shadowRow(0), 'X').value).toBe('2px')
  })

  it('shows the new values when the shadows change from outside', async () => {
    await mountPanel({ 'box-shadow': AUTHORED_SHADOWS })

    await reindex({ 'box-shadow': '1px 2px 3px 4px #111, 5px 6px #222' })

    const shown = shadowRows().map((row) => ['X', 'Y', 'Blur', 'Spread'].map((label) => inputIn(row, label).value))
    expect(shown).toEqual([
      ['1px', '2px', '3px', '4px'],
      ['5px', '6px', '', ''],
    ])
  })

  it('keeps the authored unit of a typed length', async () => {
    const ctx = await mountPanel({ 'box-shadow': '0 .25rem .5rem #000' })

    await commit(inputIn(shadowRow(0), 'Blur'), '1')

    expect(lastWritten(ctx)).toBe('0 .25rem 1rem #000')
  })

  it('writes a zero blur before a spread set on a layer that has no blur', async () => {
    const ctx = await mountPanel({ 'box-shadow': '2px 3px red' })

    await commit(inputIn(shadowRow(0), 'Spread'), '1')

    expect(lastWritten(ctx)).toBe('2px 3px 0 1px red')
  })

  it.each([
    [0, 'false', 'inset 0 4px 12px rgba(0, 0, 0, 0.04), inset 0 0 0 1px #e6ddcf'],
    [1, 'true', '0 4px 12px rgba(0, 0, 0, 0.04), 0 0 0 1px #e6ddcf'],
  ])('toggles inset on layer %i (checked: %s)', async (at, checked, written) => {
    const ctx = await mountPanel({ 'box-shadow': AUTHORED_SHADOWS })
    const inset = within(shadowRow(at), '[role="switch"][aria-label="Inset"]')
    expect(inset.getAttribute('aria-checked')).toBe(checked)

    await press(inset)

    expect(applied(ctx)).toEqual([setDecl('box-shadow', written)])
  })

  it('moves a layer down the list', async () => {
    const ctx = await mountPanel({ 'box-shadow': AUTHORED_SHADOWS })

    await press(button('Move shadow down', shadowRow(0)))

    expect(applied(ctx)).toEqual([setDecl('box-shadow', 'inset 0 0 0 1px #e6ddcf, 0 4px 12px rgba(0, 0, 0, 0.04)')])
  })

  it('moves a layer up the list', async () => {
    const ctx = await mountPanel({ 'box-shadow': `${AUTHORED_SHADOWS}, 0 0 2px #111` })

    await press(button('Move shadow up', shadowRow(2)))

    expect(lastWritten(ctx)).toBe('0 4px 12px rgba(0, 0, 0, 0.04), 0 0 2px #111, inset 0 0 0 1px #e6ddcf')
  })

  it('cannot move the first layer up or the last layer down', async () => {
    await mountPanel({ 'box-shadow': AUTHORED_SHADOWS })

    expect(button('Move shadow up', shadowRow(0)).disabled).toBe(true)
    expect(button('Move shadow down', shadowRow(1)).disabled).toBe(true)
    expect(button('Move shadow down', shadowRow(0)).disabled).toBe(false)
  })

  it('adds a layer and keeps the authored ones as they were', async () => {
    const ctx = await mountPanel({ 'box-shadow': AUTHORED_SHADOWS })

    await press(button('Add shadow', field('box-shadow')))

    const written = lastWritten(ctx)!
    expect(applied(ctx)).toHaveLength(1)
    expect(parseShadows(written)).toHaveLength(3)
    expect(written).toContain(AUTHORED_SHADOWS)
  })

  it('adds the first layer to an element with no shadow', async () => {
    const ctx = await mountPanel()

    await press(button('Add shadow', field('box-shadow')))

    expect(applied(ctx)).toHaveLength(1)
    expect(applied(ctx)[0]).toMatchObject({ target: [card], kind: 'setDecl', payload: { prop: 'box-shadow' } })
    expect(parseShadows(lastWritten(ctx)!)).toHaveLength(1)
  })

  it('picks a layer colour with the picker: previews the whole list while dragging and writes it once on release', async () => {
    const ctx = await mountPanel({ 'box-shadow': AUTHORED_SHADOWS })
    act(() => within<HTMLButtonElement>(shadowRow(1), 'button[aria-haspopup="dialog"]').click())
    await settle()
    const square = within(within(document.body, '[role="dialog"][aria-label="Colour picker"]'), '[aria-label="Saturation and value"]')

    act(() => pointer('pointerdown', square, 100, 50))
    act(() => pointer('pointermove', square, 0, 100))
    expect(ctx.apply).not.toHaveBeenCalled()
    expect(ctx.preview.mock.calls.at(-1)?.[0]).toEqual(setDecl('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.04), inset 0 0 0 1px #000000'))

    act(() => pointer('pointerup', square, 0, 100))
    await settle()

    expect(applied(ctx)).toEqual([setDecl('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.04), inset 0 0 0 1px #000000')])
  })

  it('shows a shadow it cannot read as its text, with no layer fields', async () => {
    await mountPanel({ 'box-shadow': 'var(--elevation)' })

    expect(field('box-shadow').textContent).toContain('var(--elevation)')
    expect(field('box-shadow').querySelector('input[aria-label="X"]')).toBeNull()
  })
})

describe('effects', () => {
  const layerBlur = () => inputIn(field('filter'), 'Layer blur')
  const backgroundBlur = () => inputIn(field('backdrop-filter'), 'Background blur')

  it('writes a layer blur as filter: blur()', async () => {
    const ctx = await mountPanel()

    await commit(layerBlur(), '4')

    expect(applied(ctx)).toEqual([setDecl('filter', 'blur(4px)')])
  })

  it('shows the authored blur radius and keeps the other filter functions when it changes', async () => {
    const ctx = await mountPanel({ filter: 'saturate(1.2) blur(2px)' })
    expect(layerBlur().value).toBe('2px')

    await commit(layerBlur(), '6')

    expect(applied(ctx)).toEqual([setDecl('filter', 'saturate(1.2) blur(6px)')])
  })

  it('keeps the authored blur unit', async () => {
    const ctx = await mountPanel({ filter: 'blur(0.5rem)' })

    await commit(layerBlur(), '1')

    expect(lastWritten(ctx)).toBe('blur(1rem)')
  })

  it('takes out only the blur when the field is emptied', async () => {
    const ctx = await mountPanel({ filter: 'saturate(1.2) blur(2px)' })

    await commit(layerBlur(), '')

    expect(applied(ctx)).toEqual([setDecl('filter', 'saturate(1.2)')])
  })

  it('removes the filter when its only function, the blur, is emptied', async () => {
    const ctx = await mountPanel({ filter: 'blur(2px)' })

    await commit(layerBlur(), '')

    expect(applied(ctx)).toEqual([removeDecl('filter')])
  })

  it('writes a background blur as backdrop-filter: blur()', async () => {
    const ctx = await mountPanel({ filter: 'blur(2px)' })

    await commit(backgroundBlur(), '10')

    expect(applied(ctx)).toEqual([setDecl('backdrop-filter', 'blur(10px)')])
  })

  it('offers the blend modes and shows the authored one', async () => {
    await mountPanel({ 'mix-blend-mode': 'screen' })

    const select = selectIn('mix-blend-mode', 'Blend mode')
    expect([...select.options].map((entry) => entry.value)).toEqual(
      expect.arrayContaining(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'luminosity']),
    )
    expect(select.value).toBe('screen')
  })

  it('writes the chosen blend mode', async () => {
    const ctx = await mountPanel()

    await choose(selectIn('mix-blend-mode', 'Blend mode'), 'multiply')

    expect(applied(ctx)).toEqual([setDecl('mix-blend-mode', 'multiply')])
  })
})

describe('stroke', () => {
  it('offers solid, dashed, dotted and none and shows the authored style', async () => {
    await mountPanel({ 'border-style': 'dotted' })

    const select = selectIn('border-style', 'Stroke style')
    expect([...select.options].map((entry) => entry.value).filter(Boolean)).toEqual(['solid', 'dashed', 'dotted', 'none'])
    expect(select.value).toBe('dotted')
  })

  it('writes the chosen border-style', async () => {
    const ctx = await mountPanel({ 'border-style': 'solid' })

    await choose(selectIn('border-style', 'Stroke style'), 'dashed')

    expect(applied(ctx)).toEqual([setDecl('border-style', 'dashed')])
  })

  it('splits border-width into the four sides as one action, sent without awaiting acks', async () => {
    const ctx = await mountPanel({ 'border-width': '1px 2px' })
    withholdAcks(ctx)

    await press(button('Independent sides'))

    expect(ctx.beginAction).toHaveBeenCalledTimes(1)
    expect(actionIds(ctx)).toEqual(['action-1', 'action-1', 'action-1', 'action-1', 'action-1'])
    expect(applied(ctx)).toHaveLength(5)
    expect(applied(ctx)).toEqual(
      expect.arrayContaining([
        removeDecl('border-width'),
        setDecl('border-top-width', '1px'),
        setDecl('border-right-width', '2px'),
        setDecl('border-bottom-width', '1px'),
        setDecl('border-left-width', '2px'),
      ]),
    )
  })

  it('shows a pressed toggle and one width field per side once the sides are authored', async () => {
    await mountPanel({ 'border-top-width': '1px', 'border-right-width': '2px', 'border-bottom-width': '3px', 'border-left-width': '4px' })

    expect(button('Independent sides').getAttribute('aria-pressed')).toBe('true')
    expect(SIDES.map((prop) => within<HTMLInputElement>(field(prop), 'input').value)).toEqual(['1px', '2px', '3px', '4px'])
  })

  it('joins four matching sides back into border-width as one action', async () => {
    const ctx = await mountPanel(Object.fromEntries(SIDES.map((prop) => [prop, '2px'])))
    withholdAcks(ctx)

    await press(button('Independent sides'))

    expect(new Set(actionIds(ctx))).toEqual(new Set(['action-1']))
    expect(applied(ctx)).toHaveLength(5)
    expect(applied(ctx)).toEqual(expect.arrayContaining([...SIDES.map(removeDecl), setDecl('border-width', '2px')]))
  })
})
