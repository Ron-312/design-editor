// @vitest-environment jsdom
/// <reference types="vite/client" />
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult, Rect } from '../../../src/shared/protocol'
import type { AuthoredDeclaration, EdId, EditOp, ProjectPath, StyleSource, TemplateNode } from '../../../src/shared/types'
import { tool as paddingTool } from '../../../src/ui/canvas/tools/padding.tool'
import { PropertiesPanel } from '../../../src/ui/panels/PropertiesPanel'
import { sections as layoutSections } from '../../../src/ui/panels/sections/layout.section'
import type { AckMessage, CanvasPointer, EditorContext } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const edId = (id: string) => id as EdId
const board = 'project/home.dc.html' as ProjectPath

function node(id: string, tag: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children, ...extra }
}

// root > stack (a block) > title, lede; row (flex row) > a, b > badge; column (flex column) > c
const tree = node(
  'root',
  'x-dc',
  [
    node('stack', 'div', [node('title', 'h1'), node('lede', 'p')]),
    node('row', 'section', [node('a', 'div'), node('b', 'div', [node('badge', 'span')])]),
    node('column', 'div', [node('c', 'div')]),
  ],
  { readOnly: 'artboard-root' },
)

function decl(prop: string, value: string): AuthoredDeclaration {
  return { prop, value, important: false, hasHole: false }
}

function inline(...declarations: Array<readonly [string, string]>): StyleSource[] {
  return [{ target: 'inline', file: board, line: 10, range: { start: 0, end: 0 }, declarations: declarations.map(([prop, value]) => decl(prop, value)) }]
}

type Styles = Record<string, readonly StyleSource[]>
type Computed = Record<string, Readonly<Record<string, string>>>

const ROW_PADDING = { 'padding-top': '24px', 'padding-right': '32px', 'padding-bottom': '24px', 'padding-left': '32px' }

const defaultStyles: Styles = {
  row: inline(['display', 'flex'], ['gap', '16px'], ...Object.entries(ROW_PADDING)),
  column: inline(['display', 'flex'], ['flex-direction', 'column']),
  a: inline(['width', '240px']),
  badge: inline(['position', 'absolute']),
}

const FLEX_ITEM = {
  display: 'block',
  position: 'static',
  'box-sizing': 'border-box',
  'flex-grow': '0',
  'flex-shrink': '1',
  'flex-basis': 'auto',
  'align-self': 'auto',
}

const defaultComputed: Computed = {
  root: { display: 'block', position: 'relative' },
  stack: { display: 'block', position: 'static', 'box-sizing': 'border-box', width: '600px', height: '120px' },
  title: { display: 'block', position: 'static' },
  lede: { display: 'block', position: 'static' },
  row: {
    display: 'flex',
    'flex-direction': 'row',
    'justify-content': 'normal',
    'align-items': 'normal',
    position: 'static',
    'box-sizing': 'border-box',
    ...ROW_PADDING,
  },
  column: { display: 'flex', 'flex-direction': 'column', 'justify-content': 'normal', 'align-items': 'normal', position: 'static' },
  a: { ...FLEX_ITEM, width: '240px', height: '40px' },
  b: { ...FLEX_ITEM, width: '180px', height: '40px' },
  badge: { display: 'block', position: 'absolute' },
  c: { ...FLEX_ITEM, width: '600px', height: '40px' },
}

const defaultRects: Record<string, Rect> = {
  root: { x: 0, y: 0, width: 1280, height: 900 },
  stack: { x: 100, y: 20, width: 600, height: 120 },
  row: { x: 100, y: 200, width: 600, height: 200 },
  a: { x: 132, y: 224, width: 240, height: 40 },
  b: { x: 388, y: 224, width: 180, height: 40 },
  badge: { x: 400, y: 230, width: 20, height: 20 },
  column: { x: 100, y: 500, width: 600, height: 200 },
  c: { x: 100, y: 500, width: 600, height: 40 },
}

function answer(computed: Computed, read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'rects': {
      const rect = defaultRects[read.edId]
      return { kind: 'rects', rects: rect ? [rect] : [] }
    }
    case 'computed':
      return { kind: 'computed', values: Object.fromEntries(read.props.map((prop) => [prop, computed[read.edId]?.[prop] ?? ''])) }
    case 'hitTest':
      return { kind: 'hitTest', edId: null }
    case 'snapRects':
      return { kind: 'snapRects', self: defaultRects[read.edId] ?? defaultRects.root!, parent: null, siblings: [] }
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

function contextFor(store: EditorStore, computed: Computed) {
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
    read: <R extends ProbeRead>(read: R) =>
      Promise.resolve(answer(computed, read)) as Promise<Extract<ProbeReadResult, { kind: R['kind'] }>>,
    records: () => store.getState().records,
    toast: vi.fn(),
    onChange: (listener) => store.subscribe(listener),
  } satisfies EditorContext
}

type Context = ReturnType<typeof contextFor>

interface Setup {
  readonly selection?: readonly string[]
  readonly styles?: Styles
  readonly computed?: Computed
}

function mergedComputed(overrides: Computed = {}): Computed {
  const merged: Computed = { ...defaultComputed }
  for (const [id, values] of Object.entries(overrides)) merged[id] = { ...defaultComputed[id], ...values }
  return merged
}

function editorWith(setup: Setup): { store: EditorStore; ctx: Context } {
  const store = createEditorStore()
  store.setBoard(board)
  const index: BoardIndex = {
    board,
    frameSrc: `/project/secret/${board}`,
    tree,
    text: '',
    rules: [],
    locations: {},
    styles: { ...defaultStyles, ...setup.styles } as BoardIndex['styles'],
  }
  store.setIndex(index)
  store.select((setup.selection ?? ['row']).map(edId))
  return { store, ctx: contextFor(store, mergedComputed(setup.computed)) }
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
}

let mounted: Root | null = null

interface Mounted {
  readonly ctx: Context
  readonly panel: HTMLElement
}

async function mountPanel(setup: Setup = {}): Promise<Mounted> {
  const { ctx } = editorWith(setup)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = root
  act(() => root.render(createElement(PropertiesPanel, { ctx, tokens: [], sections: layoutSections })))
  await settle()
  return { ctx, panel: container }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  if (mounted) act(() => mounted!.unmount())
  mounted = null
  document.body.innerHTML = ''
})

/** The name a screen reader announces: aria-label, then the text inside, then the title. */
function accessibleName(element: Element): string {
  return element.getAttribute('aria-label') ?? (element.textContent?.trim() || element.getAttribute('title') || '')
}

function control(root: ParentNode, name: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('button, [role]')].find((element) => accessibleName(element) === name) ?? null
}

function requireControl(root: ParentNode, name: string): HTMLElement {
  const found = control(root, name)
  if (!found) throw new Error(`no control named ${name}`)
  return found
}

function isOn(element: Element): boolean {
  return element.getAttribute('aria-checked') === 'true' || element.getAttribute('aria-pressed') === 'true'
}

function radioGroup(root: ParentNode, name: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="${name}"]`)
  if (!found) throw new Error(`no ${name} group`)
  return found
}

function alignmentCells(root: ParentNode): HTMLElement[] {
  const cells = [...radioGroup(root, 'Alignment').querySelectorAll<HTMLElement>('[role="radio"]')]
  if (cells.length !== 9) throw new Error(`the alignment box has ${cells.length} cells, not 9`)
  return cells
}

function checkedCells(root: ParentNode): number[] {
  return alignmentCells(root).flatMap((cell, at) => (isOn(cell) ? [at] : []))
}

function sizing(root: ParentNode, axis: 'Width' | 'Height', mode: 'Hug' | 'Fill' | 'Fixed'): HTMLElement {
  return requireControl(radioGroup(root, `${axis} sizing`), mode)
}

function inputOf(root: ParentNode, prop: string): HTMLInputElement {
  const found = root.querySelector<HTMLInputElement>(`[data-prop="${prop}"] input`)
  if (!found) throw new Error(`no ${prop} field`)
  return found
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

interface Write {
  readonly target: string
  readonly prop: string
  /** null for a removed declaration. */
  readonly value: string | null
}

function writes(ctx: Context): Write[] {
  return ctx.apply.mock.calls.flatMap(([op]): Write[] => {
    if (op.kind === 'setDecl') return [{ target: op.target.join(' '), prop: op.payload.prop, value: op.payload.value }]
    if (op.kind === 'removeDecl') return [{ target: op.target.join(' '), prop: op.payload.prop, value: null }]
    return []
  })
}

function writesOf(ctx: Context, prop: string): Write[] {
  return writes(ctx).filter((write) => write.prop === prop)
}

function warningsShown(view: Mounted): string[] {
  const toasts = view.ctx.toast.mock.calls.flatMap(([toast]) => (toast.tone === 'warning' ? [toast.message] : []))
  const inPanel = [...view.panel.querySelectorAll('[role="status"]')].map((element) => element.textContent ?? '')
  return [...toasts, ...inPanel]
}

describe('Layout section: direction, gap and padding', () => {
  it('offers auto layout on a block element and turning it on writes display: flex', async () => {
    const view = await mountPanel({ selection: ['stack'] })

    await press(requireControl(view.panel, 'Add auto layout'))

    expect(writes(view.ctx)).toContainEqual({ target: 'stack', prop: 'display', value: 'flex' })
  })

  it('shows the authored direction and switching it writes flex-direction', async () => {
    const view = await mountPanel({ selection: ['row'] })
    expect(isOn(requireControl(view.panel, 'Horizontal'))).toBe(true)
    expect(isOn(requireControl(view.panel, 'Vertical'))).toBe(false)

    await press(requireControl(view.panel, 'Vertical'))

    expect(writesOf(view.ctx, 'flex-direction')).toEqual([{ target: 'row', prop: 'flex-direction', value: 'column' }])
  })

  it('writes a column back to a row', async () => {
    const view = await mountPanel({ selection: ['column'] })
    expect(isOn(requireControl(view.panel, 'Vertical'))).toBe(true)

    await press(requireControl(view.panel, 'Horizontal'))

    expect(writesOf(view.ctx, 'flex-direction')).toEqual([{ target: 'column', prop: 'flex-direction', value: 'row' }])
  })

  it('edits the gap in its authored unit', async () => {
    const view = await mountPanel({ selection: ['row'] })
    expect(inputOf(view.panel, 'gap').value).toBe('16px')

    await commit(inputOf(view.panel, 'gap'), '24')

    expect(writesOf(view.ctx, 'gap')).toEqual([{ target: 'row', prop: 'gap', value: '24px' }])
  })

  it('edits each side of the padding', async () => {
    const view = await mountPanel({ selection: ['row'] })
    expect(inputOf(view.panel, 'padding-left').value).toBe('32px')

    await commit(inputOf(view.panel, 'padding-left'), '20')
    await commit(inputOf(view.panel, 'padding-top'), '1.5rem')

    expect(writes(view.ctx)).toEqual([
      { target: 'row', prop: 'padding-left', value: '20px' },
      { target: 'row', prop: 'padding-top', value: '1.5rem' },
    ])
  })
})

describe('Layout section: the 9-dot alignment box', () => {
  it('maps a cell in a row to justify-content on the x axis and align-items on the y axis', async () => {
    const view = await mountPanel({ selection: ['row'] })

    await press(alignmentCells(view.panel)[2]!)

    expect(writes(view.ctx)).toEqual(
      expect.arrayContaining([
        { target: 'row', prop: 'justify-content', value: 'flex-end' },
        { target: 'row', prop: 'align-items', value: 'flex-start' },
      ]),
    )
  })

  it('swaps the axes in a column', async () => {
    const view = await mountPanel({ selection: ['column'] })

    await press(alignmentCells(view.panel)[2]!)

    expect(writes(view.ctx)).toEqual(
      expect.arrayContaining([
        { target: 'column', prop: 'justify-content', value: 'flex-start' },
        { target: 'column', prop: 'align-items', value: 'flex-end' },
      ]),
    )
  })

  it('reads the authored alignment into the cell for each direction', async () => {
    const alignment = { 'justify-content': 'center', 'align-items': 'flex-end' }

    const inRow = await mountPanel({
      selection: ['row'],
      styles: { row: inline(['display', 'flex'], ...Object.entries(alignment)) },
      computed: { row: alignment },
    })
    expect(checkedCells(inRow.panel)).toEqual([7])
    act(() => mounted!.unmount())
    mounted = null

    const inColumn = await mountPanel({
      selection: ['column'],
      styles: { column: inline(['display', 'flex'], ['flex-direction', 'column'], ...Object.entries(alignment)) },
      computed: { column: alignment },
    })
    expect(checkedCells(inColumn.panel)).toEqual([5])
  })

  it.each([
    ['stretch', inline(['display', 'flex'], ['align-items', 'stretch']), 'stretch'],
    ['normal (nothing authored)', inline(['display', 'flex']), 'normal'],
  ])('shows align-items %s as its own stretch state outside the nine cells', async (_, styles, computedAlign) => {
    const view = await mountPanel({ selection: ['row'], styles: { row: styles }, computed: { row: { 'align-items': computedAlign } } })

    expect(checkedCells(view.panel)).toEqual([])
    const stretch = requireControl(view.panel, 'Stretch')
    expect(isOn(stretch)).toBe(true)
    expect(radioGroup(view.panel, 'Alignment').contains(stretch)).toBe(false)
  })

  it('does not show the stretch state when a cell is authored', async () => {
    const view = await mountPanel({
      selection: ['row'],
      styles: { row: inline(['display', 'flex'], ['justify-content', 'flex-start'], ['align-items', 'center']) },
      computed: { row: { 'justify-content': 'flex-start', 'align-items': 'center' } },
    })

    const stretch = control(view.panel, 'Stretch')
    expect(stretch === null || !isOn(stretch)).toBe(true)
    expect(checkedCells(view.panel)).toEqual([3])
  })

  it('never rewrites a stretch alignment while other layout fields change', async () => {
    const view = await mountPanel({
      selection: ['row'],
      styles: { row: inline(['display', 'flex'], ['gap', '16px'], ['align-items', 'stretch']) },
      computed: { row: { 'align-items': 'stretch' } },
    })

    await commit(inputOf(view.panel, 'gap'), '8')
    await press(requireControl(view.panel, 'Vertical'))

    expect(writesOf(view.ctx, 'gap')).toHaveLength(1)
    expect(writesOf(view.ctx, 'flex-direction')).toHaveLength(1)
    expect(writesOf(view.ctx, 'align-items')).toEqual([])
  })

  it('writes align-items once the user picks a cell from the stretch state', async () => {
    const view = await mountPanel({
      selection: ['row'],
      styles: { row: inline(['display', 'flex'], ['align-items', 'stretch']) },
      computed: { row: { 'align-items': 'stretch' } },
    })

    await press(alignmentCells(view.panel)[4]!)

    expect(writesOf(view.ctx, 'align-items')).toEqual([{ target: 'row', prop: 'align-items', value: 'center' }])
  })

  it('offers space-between on the main axis', async () => {
    const view = await mountPanel({ selection: ['row'] })

    await press(requireControl(view.panel, 'Space between'))

    expect(writesOf(view.ctx, 'justify-content')).toEqual([{ target: 'row', prop: 'justify-content', value: 'space-between' }])
  })
})

describe('Layout section: Hug, Fill and Fixed', () => {
  it('Fill on the main axis of a row writes flex: 1 1 0 and min-width: 0', async () => {
    const view = await mountPanel({ selection: ['a'] })

    await press(sizing(view.panel, 'Width', 'Fill'))

    expect(writes(view.ctx)).toEqual(
      expect.arrayContaining([
        { target: 'a', prop: 'flex', value: '1 1 0' },
        { target: 'a', prop: 'min-width', value: '0' },
      ]),
    )
    expect(writesOf(view.ctx, 'min-height')).toEqual([])
  })

  it('Fill on the main axis of a column writes min-height: 0 instead', async () => {
    const view = await mountPanel({ selection: ['c'] })

    await press(sizing(view.panel, 'Height', 'Fill'))

    expect(writes(view.ctx)).toEqual(
      expect.arrayContaining([
        { target: 'c', prop: 'flex', value: '1 1 0' },
        { target: 'c', prop: 'min-height', value: '0' },
      ]),
    )
    expect(writesOf(view.ctx, 'min-width')).toEqual([])
  })

  it('Fill on the cross axis writes align-self: stretch and no flex', async () => {
    const view = await mountPanel({ selection: ['a'] })

    await press(sizing(view.panel, 'Height', 'Fill'))

    expect(writesOf(view.ctx, 'align-self')).toEqual([{ target: 'a', prop: 'align-self', value: 'stretch' }])
    expect(writesOf(view.ctx, 'flex')).toEqual([])
  })

  it.each([
    ['flex: 1 0 0', inline(['flex', '1 0 0']), { 'flex-grow': '1', 'flex-shrink': '0', 'flex-basis': '0px' }],
    ['flex: 1 1 0', inline(['flex', '1 1 0']), { 'flex-grow': '1', 'flex-shrink': '1', 'flex-basis': '0px' }],
    ['flex-grow: 2 with flex-basis: 0', inline(['flex-grow', '2'], ['flex-basis', '0']), { 'flex-grow': '2', 'flex-basis': '0px' }],
  ])('reads %s as Fill whatever the shrink', async (_, styles, computed) => {
    const view = await mountPanel({ selection: ['a'], styles: { a: styles }, computed: { a: computed } })

    expect(isOn(sizing(view.panel, 'Width', 'Fill'))).toBe(true)
    expect(isOn(sizing(view.panel, 'Width', 'Hug'))).toBe(false)
  })

  it('does not read a grown item with an auto basis as Fill', async () => {
    const view = await mountPanel({
      selection: ['a'],
      styles: { a: inline(['flex', '1 1 auto'], ['width', '240px']) },
      computed: { a: { 'flex-grow': '1', 'flex-basis': 'auto' } },
    })

    expect(isOn(sizing(view.panel, 'Width', 'Fill'))).toBe(false)
  })

  it('reads an authored width as Fixed and no width as Hug', async () => {
    const fixed = await mountPanel({ selection: ['a'] })
    expect(isOn(sizing(fixed.panel, 'Width', 'Fixed'))).toBe(true)
    expect(isOn(sizing(fixed.panel, 'Width', 'Hug'))).toBe(false)
    act(() => mounted!.unmount())
    mounted = null

    const hug = await mountPanel({ selection: ['b'] })
    expect(isOn(sizing(hug.panel, 'Width', 'Hug'))).toBe(true)
    expect(isOn(sizing(hug.panel, 'Width', 'Fixed'))).toBe(false)
  })

  it('Fixed on the main axis writes the measured size and flex-shrink: 0', async () => {
    const view = await mountPanel({ selection: ['b'] })

    await press(sizing(view.panel, 'Width', 'Fixed'))

    expect(writes(view.ctx)).toEqual(
      expect.arrayContaining([
        { target: 'b', prop: 'width', value: '180px' },
        { target: 'b', prop: 'flex-shrink', value: '0' },
      ]),
    )
  })

  it('Hug removes a fixed size', async () => {
    const view = await mountPanel({ selection: ['a'], styles: { a: inline(['width', '240px'], ['flex-shrink', '0']) } })

    await press(sizing(view.panel, 'Width', 'Hug'))

    expect(writesOf(view.ctx, 'width')).toEqual([{ target: 'a', prop: 'width', value: null }])
  })

  it('Hug removes a fill', async () => {
    const view = await mountPanel({
      selection: ['a'],
      styles: { a: inline(['flex', '1 1 0'], ['min-width', '0']) },
      computed: { a: { 'flex-grow': '1', 'flex-basis': '0px' } },
    })

    await press(sizing(view.panel, 'Width', 'Hug'))

    expect(writesOf(view.ctx, 'flex')).toEqual([{ target: 'a', prop: 'flex', value: null }])
  })
})

describe('Layout section: min and max', () => {
  it.each([
    ['min-width', '12rem'],
    ['max-width', '50%'],
    ['min-height', '120px'],
    ['max-height', 'var(--panel-max)'],
  ])('writes %s as typed: %s', async (prop, value) => {
    const view = await mountPanel({ selection: ['a'] })

    await commit(inputOf(view.panel, prop), value)

    expect(writesOf(view.ctx, prop)).toEqual([{ target: 'a', prop, value }])
  })

  it('keeps the authored unit when a bare number is typed', async () => {
    const view = await mountPanel({ selection: ['a'], styles: { a: inline(['width', '240px'], ['max-width', '20rem']) } })
    expect(inputOf(view.panel, 'max-width').value).toBe('20rem')

    await commit(inputOf(view.panel, 'max-width'), '30')

    expect(writesOf(view.ctx, 'max-width')).toEqual([{ target: 'a', prop: 'max-width', value: '30rem' }])
  })

  it('warns that padding adds to a max size on a content-box element', async () => {
    const view = await mountPanel({ selection: ['a'], computed: { a: { 'box-sizing': 'content-box' } } })

    await commit(inputOf(view.panel, 'max-width'), '320px')

    expect(warningsShown(view).some((message) => /padding/i.test(message))).toBe(true)
  })

  it('gives no padding warning on a border-box element', async () => {
    const view = await mountPanel({ selection: ['a'] })

    await commit(inputOf(view.panel, 'max-width'), '320px')

    expect(writesOf(view.ctx, 'max-width')).toHaveLength(1)
    expect(warningsShown(view).filter((message) => /padding/i.test(message))).toEqual([])
  })
})

describe('Layout section: ignore auto layout', () => {
  it('writes position: absolute and makes a static parent relative, warning about other absolute descendants', async () => {
    const view = await mountPanel({ selection: ['a'] })

    await press(requireControl(view.panel, 'Ignore auto layout'))

    expect(writes(view.ctx)).toEqual(
      expect.arrayContaining([
        { target: 'a', prop: 'position', value: 'absolute' },
        { target: 'row', prop: 'position', value: 'relative' },
      ]),
    )
    expect(warningsShown(view).length).toBeGreaterThan(0)
  })

  it('gives no warning when no other absolute descendant changes its containing block', async () => {
    const view = await mountPanel({ selection: ['a'], styles: { badge: [] }, computed: { badge: { position: 'static' } } })

    await press(requireControl(view.panel, 'Ignore auto layout'))

    expect(writes(view.ctx)).toContainEqual({ target: 'row', prop: 'position', value: 'relative' })
    expect(warningsShown(view)).toEqual([])
  })

  it('leaves a parent that is already positioned alone', async () => {
    const view = await mountPanel({ selection: ['a'], computed: { row: { position: 'relative' } } })

    await press(requireControl(view.panel, 'Ignore auto layout'))

    expect(writes(view.ctx)).toContainEqual({ target: 'a', prop: 'position', value: 'absolute' })
    expect(writes(view.ctx).filter((write) => write.target === 'row')).toEqual([])
  })
})

describe('padding handles on the canvas', () => {
  // row sits at (100, 200) in board space, 600 x 200, so its top padding band spans y 200..224.
  const ON_TOP_BAND = { x: 400, y: 210 }
  const IN_CONTENT = { x: 400, y: 300 }
  const SIDES = ['top', 'right', 'bottom', 'left'] as const
  type Side = (typeof SIDES)[number]
  type Padding = Record<Side, string>

  interface Modifiers {
    readonly altKey?: boolean
    readonly shiftKey?: boolean
  }

  function pointer(at: { x: number; y: number }, modifiers: Modifiers = {}): CanvasPointer {
    return { x: at.x, y: at.y, boardX: at.x, boardY: at.y, altKey: false, shiftKey: false, modKey: false, ctrlKey: false, ...modifiers }
  }

  function paddingSetup(padding: Padding): Setup {
    const longhands = SIDES.map((side) => [`padding-${side}`, padding[side]] as const)
    return {
      selection: ['row'],
      styles: { row: inline(['display', 'flex'], ...longhands) },
      computed: { row: Object.fromEntries(longhands) },
    }
  }

  /** The padding the element ends up with once every write lands, longhand or one-value shorthand. */
  function paddingAfter(ctx: Context, start: Padding): Padding {
    const result = { ...start }
    for (const write of writes(ctx).filter((entry) => entry.target === 'row' && entry.value !== null)) {
      if (write.prop === 'padding' && !/\s/.test(write.value!.trim())) for (const side of SIDES) result[side] = write.value!.trim()
      const side = SIDES.find((name) => write.prop === `padding-${name}`)
      if (side) result[side] = write.value!
    }
    return result
  }

  async function dragTopBand(ctx: Context, modifiers: Modifiers = {}): Promise<boolean> {
    paddingTool.onHover?.(ctx, pointer(ON_TOP_BAND, modifiers))
    await settle()
    const claimed = paddingTool.onPointerDown?.(ctx, pointer(ON_TOP_BAND, modifiers)) ?? false
    const moved = { x: ON_TOP_BAND.x, y: ON_TOP_BAND.y + 8 }
    paddingTool.onPointerMove?.(ctx, pointer(moved, modifiers))
    paddingTool.onPointerUp?.(ctx, pointer(moved, modifiers))
    await settle()
    return claimed
  }

  it('drags one side', async () => {
    const start = { top: '24px', right: '32px', bottom: '24px', left: '32px' }
    const { ctx } = editorWith(paddingSetup(start))

    expect(await dragTopBand(ctx)).toBe(true)

    expect(paddingAfter(ctx, start)).toEqual({ ...start, top: '32px' })
  })

  it('moves the opposite sides together with Alt', async () => {
    const start = { top: '24px', right: '32px', bottom: '24px', left: '32px' }
    const { ctx } = editorWith(paddingSetup(start))

    expect(await dragTopBand(ctx, { altKey: true })).toBe(true)

    expect(paddingAfter(ctx, start)).toEqual({ top: '32px', right: '32px', bottom: '32px', left: '32px' })
    expect(writes(ctx).filter((write) => write.prop === 'padding-left' || write.prop === 'padding-right')).toEqual([])
  })

  it('moves all four sides with Alt-Shift', async () => {
    const start = { top: '24px', right: '24px', bottom: '24px', left: '24px' }
    const { ctx } = editorWith(paddingSetup(start))

    expect(await dragTopBand(ctx, { altKey: true, shiftKey: true })).toBe(true)

    expect(paddingAfter(ctx, start)).toEqual({ top: '32px', right: '32px', bottom: '32px', left: '32px' })
  })

  it('leaves a press inside the content box to the other tools', async () => {
    const { ctx } = editorWith(paddingSetup({ top: '24px', right: '32px', bottom: '24px', left: '32px' }))
    paddingTool.onHover?.(ctx, pointer(IN_CONTENT))
    await settle()

    expect(paddingTool.onPointerDown?.(ctx, pointer(IN_CONTENT)) ?? false).toBe(false)
    expect(ctx.apply).not.toHaveBeenCalled()
  })
})
