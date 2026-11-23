// @vitest-environment jsdom
/// <reference types="vite/client" />
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult, Rect } from '../../../src/shared/protocol'
import type { AuthoredDeclaration, EdId, EditOp, ProjectPath, RuleId, StyleSource, TemplateNode } from '../../../src/shared/types'
import {
  PropertiesPanel,
  defaultPanelSections,
  loadPanelSections,
  type SectionModule,
  type Token,
} from '../../../src/ui/panels/PropertiesPanel'
import type { AckMessage, EditorContext, PanelSection } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const edId = (id: string) => id as EdId
const board = 'project/card.dc.html' as ProjectPath
const cardRule = 'rule-card' as RuleId

function node(id: string, tag: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children, ...extra }
}

// root > card, other, list (<sc-for>) > item
const tree = node(
  'root',
  'x-dc',
  [node('card', 'div'), node('other', 'div'), node('list', 'sc-for', [node('item', 'li')], { kind: 'sc-for' })],
  { readOnly: 'artboard-root' },
)

function decl(prop: string, value: string, extra: Partial<AuthoredDeclaration> = {}): AuthoredDeclaration {
  return { prop, value, important: false, hasHole: false, ...extra }
}

function inline(line: number, declarations: AuthoredDeclaration[]): StyleSource {
  return { target: 'inline', file: board, line, range: { start: 0, end: 0 }, declarations }
}

/** The server sends `<helmet><style>` rules with their selector. */
function rule(id: RuleId, selector: string, line: number, declarations: AuthoredDeclaration[]): StyleSource {
  return { target: id, file: board, line, range: { start: 0, end: 0 }, declarations, selector }
}

const cardInline = inline(12, [
  decl('background-color', '#1a73e8'),
  decl('border-radius', '12px'),
  decl('font-size', '14px'),
  decl('line-height', '1.5'),
  decl('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.04), inset 0 0 0 1px #e6ddcf'),
])

const defaultStyles: Record<string, readonly StyleSource[]> = {
  card: [cardInline, rule(cardRule, '.card', 4, [decl('border-radius', '8px')])],
  other: [inline(20, [decl('background-color', 'var(--brand)'), decl('border-radius', '8px'), decl('font-size', '14px')])],
  item: [inline(30, [decl('font-size', '{{ size }}px', { hasHole: true })])],
}

const tokens: Token[] = [
  { name: 'color.paper', value: '#fff7ed', source: 'tokens.json' },
  { name: '--brand', value: '#c2410c', source: ':root' },
]

interface Probe {
  /** Rendered copies per node; an `<sc-for>` child renders once per repeat. */
  readonly rendered: Readonly<Record<string, number>>
  readonly computed: Readonly<Record<string, string>>
  readonly textBoxSupported: boolean
}

const defaultProbe: Probe = { rendered: { root: 1, card: 1, other: 1, item: 3 }, computed: {}, textBoxSupported: true }

const box: Rect = { x: 0, y: 0, width: 100, height: 20 }

function answer(probe: Probe, read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'rects':
      return { kind: 'rects', rects: Array.from({ length: probe.rendered[read.edId] ?? 0 }, () => box) }
    case 'computed':
      return { kind: 'computed', values: Object.fromEntries(read.props.map((prop) => [prop, probe.computed[prop] ?? ''])) }
    case 'hitTest':
      return { kind: 'hitTest', edId: null }
    case 'snapRects':
      return { kind: 'snapRects', self: box, parent: null, siblings: [] }
    case 'supports':
      return { kind: 'supports', supported: read.condition.includes('text-box') ? probe.textBoxSupported : true }
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

function contextFor(store: EditorStore, reads: (read: ProbeRead) => Promise<ProbeReadResult>) {
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
    apply: vi.fn(async (op: EditOp) => ackFor(op)),
    beginAction: vi.fn(() => `action-${++actions}`),
    preview: vi.fn(),
    setMode: (mode: 'select' | 'hand') => store.setMode(mode),
    fit: vi.fn(),
    cancelGesture: vi.fn(),
    setEditorState: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    read: <R extends ProbeRead>(read: R) => reads(read) as Promise<Extract<ProbeReadResult, { kind: R['kind'] }>>,
    records: () => store.getState().records,
    toast: vi.fn(),
    onChange: (listener) => store.subscribe(listener),
  } satisfies EditorContext
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
}

let mounted: { root: Root; container: HTMLElement } | null = null

interface MountOptions {
  readonly selection?: readonly string[]
  readonly styles?: Record<string, readonly StyleSource[]>
  readonly tokens?: readonly Token[]
  readonly probe?: Partial<Probe>
  readonly sections?: readonly PanelSection[]
  /** Probe reads wait for this before they answer. */
  readonly readsAfter?: Promise<unknown>
  /** Probe reads reject with this instead of answering. */
  readonly readError?: Error
}

interface Mounted {
  readonly store: EditorStore
  readonly ctx: ReturnType<typeof contextFor>
  readonly reads: ReturnType<typeof vi.fn<(read: ProbeRead) => Promise<ProbeReadResult>>>
  readonly container: HTMLElement
}

async function mountPanel(options: MountOptions = {}): Promise<Mounted> {
  const store = createEditorStore()
  store.setBoard(board)
  const index: BoardIndex = {
    board,
    frameSrc: `/project/secret/${board}`,
    tree,
    text: '',
    rules: [],
    locations: {},
    styles: (options.styles ?? defaultStyles) as BoardIndex['styles'],
  }
  store.setIndex(index)
  store.select((options.selection ?? ['card']).map(edId))
  const probe = { ...defaultProbe, ...options.probe }
  const reads = vi.fn(async (read: ProbeRead) => {
    await options.readsAfter
    if (options.readError) throw options.readError
    return answer(probe, read)
  })
  const ctx = contextFor(store, reads)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  act(() =>
    root.render(
      <PropertiesPanel ctx={ctx} tokens={options.tokens ?? []} {...(options.sections ? { sections: options.sections } : {})} />,
    ),
  )
  await settle()
  return { store, ctx, reads, container }
}

function field(prop: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-prop="${prop}"]`)
  if (!found) throw new Error(`no field for ${prop}`)
  return found
}

function inputOf(prop: string, label?: string): HTMLInputElement {
  const found = field(prop).querySelector<HTMLInputElement>(label ? `input[aria-label="${label}"]` : 'input')
  if (!found) throw new Error(`the ${prop} field has no ${label ?? ''} input`)
  return found
}

const colourInput = (prop: string) => inputOf(prop, 'Colour')
const alphaInput = (prop: string) => inputOf(prop, 'Alpha')

function setNativeValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function key(target: Element, keyName: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init }))
}

async function commit(input: HTMLInputElement, value: string) {
  act(() => {
    input.focus()
    setNativeValue(input, value)
  })
  act(() => key(input, 'Enter'))
  await settle()
}

async function arrow(input: HTMLInputElement, keyName: 'ArrowUp' | 'ArrowDown', shiftKey = false) {
  act(() => {
    input.focus()
    key(input, keyName, { shiftKey })
  })
  await settle()
}

async function press(element: Element) {
  act(() => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true }))
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true }))
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  })
  await settle()
}

function option(text: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((element) => element.textContent?.includes(text))
  if (!found) throw new Error(`no option showing ${text}`)
  return found
}

function chip(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-selector-chip]')
  if (!found) throw new Error('no selector chip')
  return found
}

const squashed = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()

function lastOp(view: Mounted): EditOp {
  const call = view.ctx.apply.mock.calls.at(-1)
  if (!call) throw new Error('no op was applied')
  return call[0]
}

function panelText(view: Mounted): string {
  return squashed(view.container.textContent)
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
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

describe('selector chip', () => {
  it('tops the panel with the inline style target and where it lives', async () => {
    await mountPanel()

    expect(squashed(chip().textContent)).toBe('style · card.dc.html:12')
    const firstSection = document.querySelector('[data-section]')
    expect(firstSection).not.toBeNull()
    expect(chip().compareDocumentPosition(firstSection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('lets the user pick a <helmet><style> rule, and later edits go to that rule', async () => {
    const view = await mountPanel()

    await press(chip())
    await press(option('.card'))

    expect(squashed(chip().textContent)).toBe('.card · card.dc.html:4')
    await arrow(inputOf('border-radius'), 'ArrowUp')
    expect(lastOp(view)).toEqual({
      target: [edId('card')],
      kind: 'setDecl',
      payload: { prop: 'border-radius', value: '9px', rule: cardRule },
    })
  })

  it('says how many repeats an edit on an <sc-for> child affects', async () => {
    const view = await mountPanel({ selection: ['item'] })

    expect(panelText(view)).toContain('affects 3 repeats')
  })

  it('says nothing about repeats for an element outside an <sc-for>', async () => {
    const view = await mountPanel()

    expect(panelText(view)).not.toMatch(/repeats/)
  })
})

describe('the computed-style check after a write', () => {
  it('names the rule that overrides the written value', async () => {
    const styles = {
      ...defaultStyles,
      card: [cardInline, rule(cardRule, '.card', 4, [decl('border-radius', '8px', { important: true })])],
    }
    const view = await mountPanel({ styles, probe: { computed: { 'border-radius': '8px' } } })

    await commit(inputOf('border-radius'), '16')

    expect(lastOp(view)).toMatchObject({ kind: 'setDecl', payload: { prop: 'border-radius', value: '16px' } })
    expect(panelText(view)).toContain('overridden by .card')
  })

  it('blames a script when no authored rule explains the mismatch', async () => {
    const styles = { ...defaultStyles, card: [cardInline] }
    const view = await mountPanel({ styles, probe: { computed: { 'border-radius': '8px' } } })

    await commit(inputOf('border-radius'), '16')

    expect(panelText(view)).toContain('a script overrides this value')
  })

  it('warns about nothing when the live value matches the write', async () => {
    const view = await mountPanel({ probe: { computed: { 'border-radius': '16px' } } })

    await commit(inputOf('border-radius'), '16')

    expect(view.ctx.apply).toHaveBeenCalledTimes(1)
    expect(panelText(view)).not.toMatch(/overrid/)
  })
})

describe('holes', () => {
  it('shows a declaration holding a {{hole}} read-only and never writes it', async () => {
    const view = await mountPanel({ selection: ['item'] })

    const input = inputOf('font-size')
    expect(input.readOnly || input.disabled).toBe(true)
    expect(input.value).toContain('{{ size }}')

    await commit(input, '20')
    await arrow(input, 'ArrowUp')
    expect(view.ctx.apply).not.toHaveBeenCalled()
  })
})

describe('number fields', () => {
  it('steps by 1 with the arrow keys, in the authored unit', async () => {
    const view = await mountPanel()

    await arrow(inputOf('font-size'), 'ArrowUp')

    expect(lastOp(view)).toEqual({ target: [edId('card')], kind: 'setDecl', payload: { prop: 'font-size', value: '15px' } })
  })

  it('steps by 10 with Shift', async () => {
    const view = await mountPanel()

    await arrow(inputOf('border-radius'), 'ArrowUp', true)

    expect(lastOp(view)).toMatchObject({ payload: { prop: 'border-radius', value: '22px' } })
  })

  it('steps a unitless line-height without adding px', async () => {
    const view = await mountPanel()

    await arrow(inputOf('line-height'), 'ArrowDown')

    expect(lastOp(view)).toMatchObject({ payload: { prop: 'line-height', value: '0.5' } })
  })

  it('writes a typed bare number in the authored unit', async () => {
    const styles = { ...defaultStyles, card: [inline(12, [decl('font-size', '1.25rem')])] }
    const view = await mountPanel({ styles })

    await commit(inputOf('font-size'), '2')

    expect(lastOp(view)).toMatchObject({ payload: { prop: 'font-size', value: '2rem' } })
  })

  it('adds no px to a typed unitless value', async () => {
    const view = await mountPanel()

    await commit(inputOf('line-height'), '2')

    expect(lastOp(view)).toMatchObject({ payload: { prop: 'line-height', value: '2' } })
  })

  it('keeps typed text when the selection’s styles arrive while typing, and writes it on Enter', async () => {
    const view = await mountPanel()
    act(() => {
      inputOf('font-size').focus()
      setNativeValue(inputOf('font-size'), '20px')
    })

    const styles = { ...defaultStyles, card: [inline(12, [decl('font-size', '16px')])] } as BoardIndex['styles']
    act(() => view.store.setIndex({ ...view.store.getState().index!, styles }))
    await settle()
    expect(inputOf('font-size').value).toBe('20px')

    act(() => key(inputOf('font-size'), 'Enter'))
    await settle()
    expect(lastOp(view)).toMatchObject({ target: ['card'], payload: { prop: 'font-size', value: '20px' } })
  })

  it('drops typed text when the selection changes before Enter', async () => {
    const view = await mountPanel()
    act(() => {
      inputOf('font-size').focus()
      setNativeValue(inputOf('font-size'), '20px')
    })

    act(() => view.store.select([edId('other')]))
    await settle()
    expect(inputOf('font-size').value).toBe('14px')

    act(() => key(inputOf('font-size'), 'Enter'))
    await settle()
    expect(view.ctx.apply).not.toHaveBeenCalled()
  })
})

describe('typed text across late probe reads and reloads', () => {
  it('keeps typed width text when the reads that place the element in auto layout land while typing', async () => {
    let answerReads = () => {}
    const view = await mountPanel({
      probe: { computed: { display: 'flex' } },
      readsAfter: new Promise<void>((resolve) => (answerReads = resolve)),
    })
    const typedInto = inputOf('width')
    act(() => {
      typedInto.focus()
      setNativeValue(typedInto, '300px')
    })

    answerReads()
    await settle()
    expect(document.querySelector('[aria-label="Width sizing"]')).not.toBeNull()
    expect(inputOf('width')).toBe(typedInto)
    expect(typedInto.value).toBe('300px')

    act(() => key(typedInto, 'Enter'))
    await settle()
    expect(lastOp(view)).toMatchObject({ target: ['card'], payload: { prop: 'width', value: '300px' } })
  })

  it('leaves no read rejected by a frame reload unhandled, and still writes typed text', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const view = await mountPanel({ selection: ['item'], readError: new Error('the frame reloaded before the probe answered') })
      await commit(inputOf('width'), '120px')

      expect(lastOp(view)).toMatchObject({ target: ['item'], payload: { prop: 'width', value: '120px' } })
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('colour field', () => {
  it('shows the authored colour and writes a changed alpha in the same hex format', async () => {
    const view = await mountPanel()

    expect(colourInput('background-color').value.toLowerCase()).toContain('1a73e8')
    await commit(alphaInput('background-color'), '50%')

    expect(lastOp(view)).toEqual({
      target: [edId('card')],
      kind: 'setDecl',
      payload: { prop: 'background-color', value: '#1a73e880' },
    })
  })

  it('writes nothing when the alpha field is emptied', async () => {
    const view = await mountPanel()

    await commit(alphaInput('background-color'), '')
    await commit(alphaInput('background-color'), ' % ')

    expect(view.ctx.apply).not.toHaveBeenCalled()
  })

  it('keeps an oklch() colour in oklch when the alpha changes', async () => {
    const styles = { ...defaultStyles, card: [inline(12, [decl('background-color', 'oklch(0.7 0.15 30)')])] }
    const view = await mountPanel({ styles })

    expect(colourInput('background-color').value).toBe('oklch(0.7 0.15 30)')
    await commit(alphaInput('background-color'), '50%')

    expect(lastOp(view)).toMatchObject({ payload: { prop: 'background-color', value: 'oklch(0.7 0.15 30 / 0.5)' } })
  })

  it('never clamps a display-p3 colour to sRGB', async () => {
    const styles = { ...defaultStyles, card: [inline(12, [decl('background-color', 'color(display-p3 1 0 0)')])] }
    const view = await mountPanel({ styles })

    expect(colourInput('background-color').value).toBe('color(display-p3 1 0 0)')
    await commit(alphaInput('background-color'), '25%')

    expect(lastOp(view)).toMatchObject({ payload: { prop: 'background-color', value: 'color(display-p3 1 0 0 / 0.25)' } })
  })

  it('writes a typed hex in the authored HSL format', async () => {
    const styles = { ...defaultStyles, card: [inline(12, [decl('background-color', 'hsl(210 50% 40%)')])] }
    const view = await mountPanel({ styles })

    await commit(colourInput('background-color'), '#ff0000')

    expect(lastOp(view)).toMatchObject({ payload: { prop: 'background-color', value: 'hsl(0 100% 50%)' } })
  })
})

describe('style sections', () => {
  it.each([
    'background-color',
    'border-width',
    'border-color',
    'border-radius',
    'opacity',
    'box-shadow',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
    'text-box',
  ])('has a %s field', async (prop) => {
    await mountPanel()

    expect(field(prop)).toBeTruthy()
  })

  it('lists each shadow of the authored shadow list', async () => {
    await mountPanel()

    expect(field('box-shadow').querySelectorAll('[data-shadow]')).toHaveLength(2)
  })

  it('removes one shadow and writes the rest of the list', async () => {
    const view = await mountPanel()

    const first = field('box-shadow').querySelector('[data-shadow]')!
    await press(first.querySelector('button[aria-label="Remove shadow"]')!)

    expect(lastOp(view)).toEqual({
      target: [edId('card')],
      kind: 'setDecl',
      payload: { prop: 'box-shadow', value: 'inset 0 0 0 1px #e6ddcf' },
    })
  })

  it('removes the declaration when the last shadow goes', async () => {
    const styles = { ...defaultStyles, card: [inline(12, [decl('box-shadow', '0 4px 12px #000')])] }
    const view = await mountPanel({ styles })

    await press(field('box-shadow').querySelector('[data-shadow] button[aria-label="Remove shadow"]')!)

    expect(lastOp(view)).toEqual({ target: [edId('card')], kind: 'removeDecl', payload: { prop: 'box-shadow' } })
  })
})

describe('computed values', () => {
  it('shows the live value as a muted placeholder where nothing is authored', async () => {
    await mountPanel({ probe: { computed: { width: '336px', 'border-color': 'rgb(230, 221, 207)' } } })

    expect(inputOf('width').value).toBe('')
    expect(inputOf('width').placeholder).toBe('336')
    expect(colourInput('border-color').placeholder).toBe('#E6DDCF')
    expect(alphaInput('border-color').placeholder).toBe('100%')
  })

  it('shows the authored value, not the live one, where one is authored', async () => {
    await mountPanel({ probe: { computed: { 'font-size': '14px' } } })

    expect(inputOf('font-size').value).toBe('14px')
  })

  it('shows no live value for a multi-selection, whose elements may differ', async () => {
    await mountPanel({ selection: ['card', 'other'], probe: { computed: { width: '336px' } } })

    expect(inputOf('width').placeholder).toBe('')
  })
})

describe('position section', () => {
  const position = () => document.querySelector<HTMLElement>('[data-section="position"]')!

  it('shows where auto layout placed the element, read-only, with the "in auto layout" note', async () => {
    await mountPanel({ probe: { computed: { display: 'flex' } } })

    expect(squashed(position().querySelector('h3')?.textContent)).toBe('Positionin auto layout')
    expect(squashed(position().querySelector('[data-placed="X"]')?.textContent)).toBe('X0')
    expect(position().querySelector('[data-prop="left"]')).toBeNull()
  })

  it('edits left and top as X and Y for a positioned element', async () => {
    const view = await mountPanel({ probe: { computed: { position: 'absolute', left: '24px' } } })

    expect(squashed(position().querySelector('h3')?.textContent)).toBe('Positionabsolute')
    expect(inputOf('left').placeholder).toBe('24')
    await commit(inputOf('left'), '40')

    expect(lastOp(view)).toEqual({ target: [edId('card')], kind: 'setDecl', payload: { prop: 'left', value: '40px' } })
  })

  it('writes a typed rotation in degrees', async () => {
    const view = await mountPanel({ probe: { computed: { rotate: 'none' } } })

    expect(inputOf('rotate').placeholder).toBe('0°')
    await commit(inputOf('rotate'), '45')

    expect(lastOp(view)).toEqual({ target: [edId('card')], kind: 'setDecl', payload: { prop: 'rotate', value: '45deg' } })
  })
})

describe('text-box trim', () => {
  const toggle = () => {
    const found = field('text-box').querySelector<HTMLElement>('[role="switch"]')
    if (!found) throw new Error('no text-box trim switch')
    return found
  }

  it('asks the iframe whether it supports text-box trim', async () => {
    const view = await mountPanel()

    const conditions = view.reads.mock.calls.map(([read]) => (read.kind === 'supports' ? read.condition : ''))
    expect(conditions.some((condition) => condition.includes('text-box') && condition.includes('trim-both cap alphabetic'))).toBe(true)
  })

  it('writes text-box: trim-both cap alphabetic when switched on', async () => {
    const view = await mountPanel()

    expect(toggle().getAttribute('aria-checked')).toBe('false')
    await press(toggle())

    expect(lastOp(view)).toEqual({
      target: [edId('card')],
      kind: 'setDecl',
      payload: { prop: 'text-box', value: 'trim-both cap alphabetic' },
    })
  })

  it('removes the declaration when switched off', async () => {
    const styles = { ...defaultStyles, card: [inline(12, [decl('text-box', 'trim-both cap alphabetic')])] }
    const view = await mountPanel({ styles })

    expect(toggle().getAttribute('aria-checked')).toBe('true')
    await press(toggle())

    expect(lastOp(view)).toEqual({ target: [edId('card')], kind: 'removeDecl', payload: { prop: 'text-box' } })
  })

  it('shows no warning where the iframe supports it', async () => {
    await mountPanel()

    expect(field('text-box').textContent).not.toMatch(/not supported/i)
  })

  it('warns where the iframe does not support it', async () => {
    await mountPanel({ probe: { textBoxSupported: false } })

    expect(field('text-box').textContent).toMatch(/not supported/i)
  })
})

describe('multi-edit', () => {
  it('shows the shared value, or Mixed where the selection differs', async () => {
    await mountPanel({ selection: ['card', 'other'] })

    expect(inputOf('font-size').value).toMatch(/^14(px)?$/)
    expect(inputOf('border-radius').value).toBe('')
    expect(inputOf('border-radius').placeholder).toBe('Mixed')
    expect(colourInput('background-color').value).toBe('')
    expect(colourInput('background-color').placeholder).toBe('Mixed')
  })

  it('sends one op with every target for one edit', async () => {
    const view = await mountPanel({ selection: ['card', 'other'] })

    await commit(inputOf('border-radius'), '16')

    expect(view.ctx.apply).toHaveBeenCalledTimes(1)
    const op = lastOp(view)
    expect(op).toMatchObject({ kind: 'setDecl', payload: { prop: 'border-radius', value: '16px' } })
    expect([...op.target].sort()).toEqual([edId('card'), edId('other')])
  })
})

describe('token picker', () => {
  it('is hidden when the project has no tokens', async () => {
    await mountPanel({ tokens: [] })

    expect(document.querySelector('button[aria-label="Tokens"]')).toBeNull()
  })

  it('lists the tokens the server sent', async () => {
    await mountPanel({ tokens })

    await press(field('background-color').querySelector('button[aria-label="Tokens"]')!)

    expect(option('color.paper')).toBeTruthy()
    expect(option('--brand')).toBeTruthy()
  })

  it('writes the literal value of a tokens.json token', async () => {
    const view = await mountPanel({ tokens })

    await press(field('background-color').querySelector('button[aria-label="Tokens"]')!)
    await press(option('color.paper'))

    expect(lastOp(view)).toEqual({
      target: [edId('card')],
      kind: 'setDecl',
      payload: { prop: 'background-color', value: '#fff7ed' },
    })
  })

  it('writes var() for a :root token', async () => {
    const view = await mountPanel({ tokens })

    await press(field('background-color').querySelector('button[aria-label="Tokens"]')!)
    await press(option('--brand'))

    expect(lastOp(view)).toMatchObject({ payload: { prop: 'background-color', value: 'var(--brand)' } })
  })

  it('shows a bound value as a token pill with a link glyph', async () => {
    await mountPanel({ selection: ['other'], tokens })

    const pill = field('background-color').querySelector('[data-token]')
    expect(pill?.textContent).toContain('--brand')
    expect(pill?.querySelector('svg')).not.toBeNull()
  })

  it('shows a raw value without a token pill', async () => {
    await mountPanel({ tokens })

    expect(field('background-color').querySelector('[data-token]')).toBeNull()
  })

  it('detaches only the edited element when a raw value is typed over a token', async () => {
    const view = await mountPanel({ selection: ['other'], tokens })

    await commit(colourInput('background-color'), '#123456')

    expect(view.ctx.apply).toHaveBeenCalledTimes(1)
    expect(lastOp(view)).toEqual({
      target: [edId('other')],
      kind: 'setDecl',
      payload: { prop: 'background-color', value: '#123456' },
    })
  })
})

describe('section loading', () => {
  function section(id: string, order: number): PanelSection {
    return { id, title: id, order, appliesTo: () => true, component: () => null }
  }

  it('orders the sections of every module by their order', () => {
    const modules: Record<string, SectionModule> = {
      './sections/a.section.tsx': { sections: [section('late', 20)] },
      './sections/b.section.tsx': { sections: [section('early', 1), section('middle', 10)] },
    }

    expect(loadPanelSections(modules).map((entry: PanelSection) => entry.id)).toEqual(['early', 'middle', 'late'])
  })

  it('loads the sections from ./sections/*.section.tsx', () => {
    const files = import.meta.glob<SectionModule>('../../../src/ui/panels/sections/*.section.tsx', { eager: true })
    const exported = Object.values(files).flatMap((file) => file.sections.map((entry: PanelSection) => entry.id))

    expect(exported.length).toBeGreaterThan(0)
    expect(defaultPanelSections().map((entry: PanelSection) => entry.id).sort()).toEqual(exported.sort())
  })

  it('renders only the sections that apply to the selection, in the order given', async () => {
    const shown = (id: string, order: number): PanelSection => ({
      ...section(id, order),
      component: () => <p data-test-section={id} />,
    })
    const skipped: PanelSection = { ...shown('skipped', 2), appliesTo: () => false }

    await mountPanel({ sections: [shown('first', 1), skipped, shown('second', 3)] })

    const rendered = [...document.querySelectorAll<HTMLElement>('[data-test-section]')].map((element) => element.dataset.testSection)
    expect(rendered).toEqual(['first', 'second'])
  })
})
