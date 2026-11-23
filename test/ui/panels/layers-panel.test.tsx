// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult, Rect } from '../../../src/shared/protocol'
import type { EdId, EditOp, ProjectPath, TemplateNode } from '../../../src/shared/types'
import { createDefaultRegistry } from '../../../src/ui/actions/registry'
import { FrameGeneration } from '../../../src/ui/frame-generation'
import { LayersPanel } from '../../../src/ui/panels/LayersPanel'
import type { AckMessage, EditorContext } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const edId = (id: string) => id as EdId
const home = 'project/home.dc.html' as ProjectPath
const ROW_HEIGHT = 28

function node(id: string, name: string, tag: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name, children, ...extra }
}

// The template tree inside <x-dc>: an <sc-for> repeats Card three times, the <sc-if> branch is false,
// so Banner is not rendered, and Footer is a <dc-import>.
const tree = node(
  'root',
  'Desktop',
  'x-dc',
  [
    node('header', 'Top nav', 'header'),
    node('hero', 'Hero', 'section', [node('title', 'Title', 'h2'), node('lede', 'Lede', 'p'), node('photo', 'Photo', 'img')]),
    node('cards', 'Cards', 'sc-for', [node('card', 'Card', 'div', [node('cardTitle', 'Card title', 'h3')])], { kind: 'sc-for' }),
    node('promo', 'Promo', 'sc-if', [node('banner', 'Banner', 'aside')], { kind: 'sc-if' }),
    node('footer', 'Footer', 'dc-import', [], { kind: 'dc-import', readOnly: 'dc-import' }),
  ],
  { readOnly: 'artboard-root' },
)

const renderedCount: Readonly<Record<string, number>> = {
  root: 1,
  header: 1,
  hero: 1,
  title: 1,
  lede: 1,
  photo: 1,
  card: 3,
  cardTitle: 3,
  footer: 1,
}

/** What the live page computes where it is not the browser default: a flex row, a flex column and a grid. */
const computedStyles: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  header: { display: 'flex', 'flex-direction': 'row' },
  hero: { display: 'flex', 'flex-direction': 'column' },
  card: { display: 'grid' },
}

const DEFAULT_COMPUTED: Readonly<Record<string, string>> = { display: 'block', 'flex-direction': 'row' }

function computedValues(id: EdId, props: readonly string[]): Record<string, string> {
  return Object.fromEntries(props.map((prop) => [prop, computedStyles[id]?.[prop] ?? DEFAULT_COMPUTED[prop] ?? '']))
}

const box: Rect = { x: 0, y: 0, width: 100, height: 20 }

function answer(read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'rects':
      return { kind: 'rects', rects: Array.from({ length: renderedCount[read.edId] ?? 0 }, () => box) }
    case 'computed':
      return { kind: 'computed', values: computedValues(read.edId, read.props) }
    case 'hitTest':
      return { kind: 'hitTest', edId: null }
    case 'snapRects':
      return { kind: 'snapRects', self: box, parent: null, siblings: [] }
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
    record: { target: op.target, kind: op.kind, prop: null, before: null, after: null, scope: { kind: 'element' }, files: [home] },
    mintedIds: [],
    locations: {},
    resolved: {},
    reload: true,
    warnings: [],
  }
}

function editorStateWith(patch: Partial<EditorState> = {}): EditorState {
  return { hidden: [], locked: [], collapsed: [], boards: {}, ...patch }
}

function contextFor(store: EditorStore, editorState: EditorState) {
  let actions = 0
  return {
    index: () => store.getState().index,
    selection: () => {
      const { board, view } = store.getState()
      return board ? { board, edIds: view.selection } : null
    },
    viewport: () => store.getState().view.viewport,
    editorState: () => editorState,
    readOnly: () => store.getState().readOnly,
    select: vi.fn((edIds: readonly EdId[]) => store.select(edIds)),
    setViewport: (viewport) => store.setViewport(viewport),
    apply: vi.fn(async (op: EditOp) => ackFor(op)),
    beginAction: vi.fn(() => `action-${++actions}`),
    preview: vi.fn(),
    setMode: (mode: 'select' | 'hand') => store.setMode(mode),
    fit: vi.fn(),
    cancelGesture: vi.fn(),
    setEditorState: vi.fn<(patch: Partial<EditorState>) => void>(),
    undo: vi.fn(),
    redo: vi.fn(),
    read: async <R extends ProbeRead>(read: R) => answer(read) as Extract<ProbeReadResult, { kind: R['kind'] }>,
    records: () => store.getState().records,
    toast: vi.fn(),
    onChange: (listener) => store.subscribe(listener),
  } satisfies EditorContext
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
}

let mounted: { root: Root; container: HTMLElement } | null = null

interface Mounted {
  readonly store: EditorStore
  readonly ctx: ReturnType<typeof contextFor>
  readonly onEditorStateChange: ReturnType<typeof vi.fn<(state: EditorState) => void>>
  readonly container: HTMLElement
  /** Renders the panel again as the probe's `ready` of a reloaded frame does. */
  readonly frameReady: (generation: number) => Promise<void>
}

async function mountPanel(editorState: EditorState = editorStateWith(), readError: Error | null = null): Promise<Mounted> {
  const store = createEditorStore()
  store.setBoard(home)
  const index: BoardIndex = { board: home, frameSrc: `/project/secret/${home}`, tree, text: '', locations: {}, styles: {}, rules: [] }
  store.setIndex(index)
  const ctx = contextFor(store, editorState)
  if (readError) ctx.read = () => Promise.reject(readError)
  const onEditorStateChange = vi.fn<(state: EditorState) => void>()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  const render = (generation: number) =>
    act(() =>
      root.render(
        <FrameGeneration.Provider value={generation}>
          <LayersPanel ctx={ctx} platform="mac" onEditorStateChange={onEditorStateChange} />
        </FrameGeneration.Provider>,
      ),
    )
  render(0)
  await settle()
  const frameReady = async (generation: number) => {
    render(generation)
    await settle()
  }
  return { store, ctx, onEditorStateChange, container, frameReady }
}

function rowElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')]
}

function row(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[role="treeitem"][data-layer-id="${id}"]`)
  if (!found) throw new Error(`no layer row for ${id}`)
  return found
}

/** Rows stack top to bottom, ROW_HEIGHT each, in document order. */
function rowRect(element: Element): DOMRect {
  const at = rowElements().indexOf(element as HTMLElement)
  return at < 0 ? new DOMRect(0, 0, 0, 0) : new DOMRect(0, at * ROW_HEIGHT, 240, ROW_HEIGHT)
}

function rowAt(y: number): HTMLElement | null {
  return rowElements().find((element) => {
    const rect = rowRect(element)
    return y >= rect.top && y < rect.bottom
  }) ?? null
}

type Edge = 'top' | 'middle' | 'bottom'

function pointIn(element: HTMLElement, edge: Edge) {
  const rect = rowRect(element)
  const y = { top: rect.top + 2, middle: rect.top + rect.height / 2, bottom: rect.bottom - 2 }[edge]
  return { x: 120, y }
}

function dispatchPointer(target: Element, type: string, point: { x: number; y: number }) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
    }),
  )
}

async function clickRow(id: string) {
  const target = row(id)
  const point = pointIn(target, 'middle')
  act(() => {
    dispatchPointer(target, 'pointerdown', point)
    dispatchPointer(target, 'pointerup', point)
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y }))
  })
  await settle()
}

async function startDrag(id: string, overId: string, edge: Edge) {
  const source = row(id)
  const over = row(overId)
  act(() => dispatchPointer(source, 'pointerdown', pointIn(source, 'middle')))
  act(() => dispatchPointer(over, 'pointermove', pointIn(over, 'middle')))
  act(() => dispatchPointer(over, 'pointermove', pointIn(over, edge)))
  await settle()
}

async function drop(overId: string, edge: Edge) {
  const over = row(overId)
  act(() => dispatchPointer(over, 'pointerup', pointIn(over, edge)))
  await settle()
}

async function drag(id: string, overId: string, edge: Edge) {
  await startDrag(id, overId, edge)
  await drop(overId, edge)
}

function button(id: string, label: string): HTMLButtonElement {
  const found = row(id).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!found) throw new Error(`the ${id} row has no ${label} button`)
  return found
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rowRect(this)
  })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: (_x: number, y: number) => rowAt(y) })
  for (const method of ['setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(method in Element.prototype)) Object.defineProperty(Element.prototype, method, { configurable: true, value: () => {} })
  }
  if (!('hasPointerCapture' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'hasPointerCapture', { configurable: true, value: () => false })
  }
})

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted
    act(() => root.unmount())
    container.remove()
    mounted = null
  }
  for (const viewport of document.querySelectorAll('[data-canvas-viewport]')) viewport.remove()
  Reflect.deleteProperty(document, 'elementFromPoint')
  vi.restoreAllMocks()
})

describe('the tree is the template tree', () => {
  it('shows one row per template node, in source order, named by the node and nested by depth', async () => {
    await mountPanel()

    const shown = rowElements().map((element) => [element.dataset.layerId, element.getAttribute('aria-label'), element.getAttribute('aria-level')])

    expect(shown).toEqual([
      ['root', 'Desktop', '1'],
      ['header', 'Top nav', '2'],
      ['hero', 'Hero', '2'],
      ['title', 'Title', '3'],
      ['lede', 'Lede', '3'],
      ['photo', 'Photo', '3'],
      ['cards', 'Cards', '2'],
      ['card', 'Card', '3'],
      ['cardTitle', 'Card title', '4'],
      ['promo', 'Promo', '2'],
      ['banner', 'Banner', '3'],
      ['footer', 'Footer', '2'],
    ])
  })

  it('gives an element repeated by <sc-for> a single row', async () => {
    await mountPanel()

    expect(rowElements().filter((element) => element.dataset.layerId === 'card')).toHaveLength(1)
  })

  it('labels <sc-for> and <sc-if> rows as template control rows', async () => {
    await mountPanel()

    expect(row('cards').textContent).toContain('sc-for')
    expect(row('promo').textContent).toContain('sc-if')
    expect(row('hero').textContent).not.toMatch(/sc-(for|if)/)
  })

  it('shows a <dc-import> as a read-only leaf', async () => {
    await mountPanel()

    expect(row('footer').getAttribute('aria-readonly')).toBe('true')
    expect(row('footer').hasAttribute('aria-expanded')).toBe(false)
    expect(row('hero').getAttribute('aria-readonly')).not.toBe('true')
  })

  it('dims the nodes the runtime is not rendering now, and only those', async () => {
    await mountPanel()

    const dimmed = rowElements()
      .filter((element) => element.hasAttribute('data-dimmed'))
      .map((element) => element.dataset.layerId)

    expect(dimmed).toEqual(['banner'])
  })
  it('still shows the tree when a frame reload rejects the rendered-rect reads, leaving none unhandled', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      await mountPanel(editorStateWith(), new Error('the frame reloaded before the probe answered'))

      expect(row('hero')).toBeTruthy()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('reads after a frame reload', () => {
  type Reads = (read: ProbeRead) => ProbeReadResult

  function typeOf(id: string): string | null {
    return row(id).querySelector('[data-layer-type]')?.getAttribute('data-layer-type') ?? null
  }

  function dimmed(): (string | undefined)[] {
    return rowElements()
      .filter((element) => element.hasAttribute('data-dimmed'))
      .map((element) => element.dataset.layerId)
  }

  /** A document unlike the one `answer` stands for: header is no flex row and hero is not rendered. */
  function otherDocument(read: ProbeRead): ProbeReadResult {
    if (read.kind === 'computed' && read.edId === 'header') return { kind: 'computed', values: computedValues(edId('banner'), read.props) }
    if (read.kind === 'rects' && read.edId === 'hero') return { kind: 'rects', rects: [] }
    return answer(read)
  }

  function readsFrom(ctx: Mounted['ctx'], reads: Reads | Error) {
    ctx.read = <R extends ProbeRead>(read: R) =>
      reads instanceof Error ? Promise.reject(reads) : Promise.resolve(reads(read) as Extract<ProbeReadResult, { kind: R['kind'] }>)
  }

  /** The server sends the new index after the ack whose reload already started. */
  async function indexArrives(store: EditorStore) {
    const index = store.getState().index
    if (!index) throw new Error('no index')
    act(() => store.setIndex({ ...index, tree: structuredClone(index.tree) }))
    await settle()
  }

  it("reads the layouts and rendered layers again on the reloaded frame's ready, replacing what the old document answered", async () => {
    const { store, ctx, frameReady } = await mountPanel()
    readsFrom(ctx, otherDocument)
    await indexArrives(store)
    expect(typeOf('header')).not.toBe('flex-row')
    expect(dimmed()).toContain('hero')

    readsFrom(ctx, answer)
    await frameReady(1)

    expect(typeOf('header')).toBe('flex-row')
    expect(dimmed()).not.toContain('hero')
  })

  it("reads again on the reloaded frame's ready when the reload rejected the new index's reads", async () => {
    const { store, ctx, frameReady } = await mountPanel()
    readsFrom(ctx, new Error('the frame reloaded before the probe answered'))
    await indexArrives(store)

    readsFrom(ctx, otherDocument)
    await frameReady(1)

    expect(typeOf('header')).not.toBe('flex-row')
    expect(dimmed()).toContain('hero')
  })
})

describe('find layer', () => {
  function findInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Find layer"]')
    if (!input) throw new Error('no Find layer box')
    return input
  }

  async function find(query: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(findInput(), query)
      findInput().dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle()
  }

  it('shows the layers whose name or tag matches, under their ancestors, even inside collapsed layers', async () => {
    await mountPanel(editorStateWith({ collapsed: [edId('cards')] }))

    await find('title')

    expect(rowElements().map((element) => element.dataset.layerId)).toEqual(['root', 'hero', 'title', 'cards', 'card', 'cardTitle'])

    await find('h3')
    expect(rowElements().map((element) => element.dataset.layerId)).toEqual(['root', 'cards', 'card', 'cardTitle'])
  })

  it('says so when nothing matches, and Escape clears the search', async () => {
    const view = await mountPanel()

    await find('nothing here')
    expect(rowElements()).toEqual([])
    expect(view.container.textContent).toContain('No layers match')

    act(() => {
      findInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle()
    expect(findInput().value).toBe('')
    expect(rowElements().length).toBeGreaterThan(1)
  })
})

describe('selection is shared with the canvas', () => {
  it('selects a clicked row on the canvas', async () => {
    const view = await mountPanel()

    await clickRow('hero')

    expect(view.store.getState().view.selection).toEqual([edId('hero')])
  })

  it('marks the row of whatever the canvas selected', async () => {
    const view = await mountPanel()

    act(() => view.store.select([edId('card')]))
    await settle()

    const selected = rowElements()
      .filter((element) => element.getAttribute('aria-selected') === 'true')
      .map((element) => element.dataset.layerId)
    expect(selected).toEqual(['card'])
  })
})

describe('drag to reorder or reparent', () => {
  it('drops onto the middle of a row to move the node inside it, at the end', async () => {
    const view = await mountPanel()

    await drag('card', 'hero', 'middle')

    expect(view.ctx.apply).toHaveBeenCalledTimes(1)
    expect(view.ctx.apply).toHaveBeenCalledWith({
      target: [edId('card')],
      kind: 'moveNode',
      payload: { parent: edId('hero'), before: null },
    })
  })

  it('drops onto the top edge of a row to move the node in front of it', async () => {
    const view = await mountPanel()

    await drag('card', 'header', 'top')

    expect(view.ctx.apply).toHaveBeenCalledWith({
      target: [edId('card')],
      kind: 'moveNode',
      payload: { parent: edId('root'), before: edId('header') },
    })
  })

  it('drops onto the bottom edge of a row to move the node after it', async () => {
    const view = await mountPanel()

    await drag('card', 'header', 'bottom')

    expect(view.ctx.apply).toHaveBeenCalledWith({
      target: [edId('card')],
      kind: 'moveNode',
      payload: { parent: edId('root'), before: edId('hero') },
    })
  })

  it('greys out the rows the content model forbids as a new parent while dragging', async () => {
    await mountPanel()

    await startDrag('card', 'hero', 'middle')

    const greyed = (id: string) => row(id).hasAttribute('data-drop-invalid')
    expect(greyed('lede')).toBe(true)
    expect(greyed('title')).toBe(true)
    expect(greyed('photo')).toBe(true)
    expect(greyed('cardTitle')).toBe(true)
    expect(greyed('hero')).toBe(false)
    expect(greyed('header')).toBe(false)
  })

  it('clears the greyed rows once the drag ends', async () => {
    await mountPanel()

    await drag('card', 'hero', 'middle')

    expect(rowElements().filter((element) => element.hasAttribute('data-drop-invalid'))).toEqual([])
  })

  it('sends nothing for a drop on a forbidden parent and says why in one line', async () => {
    const view = await mountPanel()

    await drag('card', 'lede', 'middle')

    expect(view.ctx.apply).not.toHaveBeenCalled()
    expect(view.ctx.toast).toHaveBeenCalledWith(expect.objectContaining({ message: "a <div> can't go inside a <p>" }))
  })

  it('does not move a <dc-import>', async () => {
    const view = await mountPanel()

    await drag('footer', 'hero', 'middle')

    expect(view.ctx.apply).not.toHaveBeenCalled()
  })
})

describe('hide and lock are editor-only state', () => {
  it('hides a layer by adding it to the editor state, never by editing the source', async () => {
    const view = await mountPanel(editorStateWith({ hidden: [edId('hero')] }))

    act(() => button('header', 'Hide').click())
    await settle()

    expect(view.ctx.apply).not.toHaveBeenCalled()
    expect(view.onEditorStateChange).toHaveBeenCalledTimes(1)
    const saved = view.onEditorStateChange.mock.calls[0]![0]
    expect([...saved.hidden].sort()).toEqual([edId('header'), edId('hero')])
    expect(saved.locked).toEqual([])
  })

  it('shows a hidden layer again', async () => {
    const view = await mountPanel(editorStateWith({ hidden: [edId('hero')] }))

    act(() => button('hero', 'Show').click())
    await settle()

    expect(view.onEditorStateChange).toHaveBeenCalledWith(editorStateWith({ hidden: [] }))
  })

  it('locks and unlocks a layer in the editor state', async () => {
    const view = await mountPanel(editorStateWith({ locked: [edId('title')] }))

    act(() => button('header', 'Lock').click())
    act(() => button('title', 'Unlock').click())
    await settle()

    expect(view.ctx.apply).not.toHaveBeenCalled()
    expect(view.onEditorStateChange).toHaveBeenNthCalledWith(1, editorStateWith({ locked: [edId('title'), edId('header')] }))
    expect(view.onEditorStateChange).toHaveBeenNthCalledWith(2, editorStateWith({ locked: [] }))
  })
})

/** The element showing the layer's name; double-clicking it starts a rename. */
function nameOf(id: string, name: string): HTMLElement {
  const found = [...row(id).querySelectorAll<HTMLElement>('*')].find((element) => element.children.length === 0 && element.textContent === name)
  if (!found) throw new Error(`the ${id} row does not show the name ${name}`)
  return found
}

function nameField(id: string): HTMLInputElement | null {
  return row(id).querySelector<HTMLInputElement>('input')
}

async function startRename(id: string, name: string): Promise<HTMLInputElement> {
  act(() => {
    nameOf(id, name).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
  })
  await settle()
  const field = nameField(id)
  if (!field) throw new Error(`double-clicking the ${id} name opened no field`)
  return field
}

function typeInto(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function pressIn(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
  await settle()
}

function sentOps(ctx: Mounted['ctx']): EditOp[] {
  return ctx.apply.mock.calls.map(([op]) => op)
}

function isInLayersPanel(element: Element | null): boolean {
  return element?.closest('nav[aria-label="Layers"]') != null
}

describe('rename a layer', () => {
  it('double-clicking a name opens a focused field holding that name', async () => {
    await mountPanel()

    const field = await startRename('header', 'Top nav')

    expect(field.value).toBe('Top nav')
    expect(document.activeElement).toBe(field)
  })

  it('Enter writes the new name as data-layer-name and closes the field, keeping focus in the panel', async () => {
    const view = await mountPanel()
    const field = await startRename('header', 'Top nav')

    typeInto(field, 'Site nav')
    await pressIn(field, 'Enter')

    expect(sentOps(view.ctx)).toEqual([{ target: [edId('header')], kind: 'setAttr', payload: { name: 'data-layer-name', value: 'Site nav' } }])
    expect(nameField('header')).toBeNull()
    expect(isInLayersPanel(document.activeElement)).toBe(true)
  })

  it('Escape closes the field, writes nothing and keeps the old name', async () => {
    const view = await mountPanel()
    const field = await startRename('hero', 'Hero')

    typeInto(field, 'Something else')
    await pressIn(field, 'Escape')

    expect(view.ctx.apply).not.toHaveBeenCalled()
    expect(nameField('hero')).toBeNull()
    expect(nameOf('hero', 'Hero')).toBeTruthy()
  })

  it('Tab writes the name and moves on to renaming the next layer', async () => {
    const view = await mountPanel()
    const field = await startRename('header', 'Top nav')

    typeInto(field, 'Site nav')
    await pressIn(field, 'Tab')

    expect(sentOps(view.ctx)).toEqual([{ target: [edId('header')], kind: 'setAttr', payload: { name: 'data-layer-name', value: 'Site nav' } }])
    expect(nameField('header')).toBeNull()
    const next = nameField('hero')
    expect(next?.value).toBe('Hero')
    expect(document.activeElement).toBe(next)
  })

  it('an empty name removes data-layer-name, so the layer falls back to its id, class or tag', async () => {
    const view = await mountPanel()
    const field = await startRename('lede', 'Lede')

    typeInto(field, '')
    await pressIn(field, 'Enter')

    expect(sentOps(view.ctx)).toEqual([{ target: [edId('lede')], kind: 'removeAttr', payload: { name: 'data-layer-name' } }])
  })
})

describe('collapse a whole subtree', () => {
  function savedCollapsed(ctx: Mounted['ctx']): readonly EdId[] {
    const patch = ctx.setEditorState.mock.calls.at(-1)?.[0]
    if (!patch?.collapsed) throw new Error('the collapsed layers were not saved through setEditorState')
    return patch.collapsed
  }

  function altClick(target: HTMLElement) {
    act(() => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }))
    })
  }

  it('Alt-click on an open arrow collapses the layer and every layer inside it, and nothing outside', async () => {
    const view = await mountPanel(editorStateWith({ collapsed: [edId('promo')] }))

    altClick(button('cards', 'Collapse'))
    await settle()

    const collapsed = savedCollapsed(view.ctx)
    expect(collapsed).toEqual(expect.arrayContaining([edId('promo'), edId('cards'), edId('card')]))
    expect(collapsed).not.toContain(edId('hero'))
    expect(collapsed).not.toContain(edId('root'))
    expect(view.ctx.apply).not.toHaveBeenCalled()
  })

  it('Alt-click on a closed arrow expands the layer and every layer inside it, and nothing outside', async () => {
    const view = await mountPanel(editorStateWith({ collapsed: [edId('hero'), edId('cards'), edId('card')] }))

    altClick(button('cards', 'Expand'))
    await settle()

    const collapsed = savedCollapsed(view.ctx)
    expect(collapsed).toContain(edId('hero'))
    expect(collapsed).not.toContain(edId('cards'))
    expect(collapsed).not.toContain(edId('card'))
  })
})

describe('layer type icons', () => {
  function typeOf(id: string): string | null {
    return row(id).querySelector('[data-layer-type]')?.getAttribute('data-layer-type') ?? null
  }

  it('reads flex row, flex column and grid from the live computed display', async () => {
    await mountPanel()

    expect(typeOf('header')).toBe('flex-row')
    expect(typeOf('hero')).toBe('flex-column')
    expect(typeOf('card')).toBe('grid')
  })

  it('shows text and image layers by their element', async () => {
    await mountPanel()

    expect(typeOf('title')).toBe('text')
    expect(typeOf('lede')).toBe('text')
    expect(typeOf('cardTitle')).toBe('text')
    expect(typeOf('photo')).toBe('image')
  })

  it('shows <sc-for> as a repeat, <sc-if> as a condition and <dc-import> as an import', async () => {
    await mountPanel()

    expect(typeOf('cards')).toBe('repeat')
    expect(typeOf('promo')).toBe('condition')
    expect(typeOf('footer')).toBe('import')
  })

  it('gives a block container none of the layout or content types', async () => {
    await mountPanel()

    expect(['flex-row', 'flex-column', 'grid', 'text', 'image', 'repeat', 'condition', 'import']).not.toContain(typeOf('banner'))
  })
})

describe('layers-panel shortcuts go through the action registry', () => {
  function searchBox(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Find layer"]')
    if (!input) throw new Error('no Find layer box')
    return input
  }

  function canvasViewport(): HTMLElement {
    const viewport = document.createElement('div')
    viewport.setAttribute('data-canvas-viewport', '')
    viewport.tabIndex = 0
    document.body.append(viewport)
    return viewport
  }

  /** Dispatches a real keydown at `target` and hands it to the default registry the way the app's document listener does. */
  function fire(ctx: EditorContext, target: HTMLElement, init: KeyboardEventInit) {
    const registry = createDefaultRegistry('mac')
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    let handled = false
    const listen = (dispatched: Event) => {
      handled = registry.handleKeyDown(dispatched as KeyboardEvent, ctx)
    }
    document.addEventListener('keydown', listen)
    act(() => {
      target.dispatchEvent(event)
    })
    document.removeEventListener('keydown', listen)
    return { event, handled }
  }

  const CMD_F = { key: 'f', code: 'KeyF', metaKey: true }

  it('the panel no longer listens for Cmd-F on the document itself', async () => {
    await mountPanel()
    const event = new KeyboardEvent('keydown', { ...CMD_F, bubbles: true, cancelable: true })

    act(() => {
      document.body.dispatchEvent(event)
    })

    expect(document.activeElement).not.toBe(searchBox())
    expect(event.defaultPrevented).toBe(false)
  })

  it('Cmd-F focuses layer search from the canvas', async () => {
    const view = await mountPanel()
    const viewport = canvasViewport()
    viewport.focus()

    const { handled } = fire(view.ctx, viewport, CMD_F)

    expect(handled).toBe(true)
    expect(document.activeElement).toBe(searchBox())
  })

  it('Cmd-F from inside the search box keeps it focused and selects what it holds', async () => {
    const view = await mountPanel()
    typeInto(searchBox(), 'hero')
    searchBox().focus()
    searchBox().setSelectionRange(4, 4)

    const { handled } = fire(view.ctx, searchBox(), CMD_F)

    expect(handled).toBe(true)
    expect(document.activeElement).toBe(searchBox())
    expect([searchBox().selectionStart, searchBox().selectionEnd]).toEqual([0, 4])
  })

  it('Delete removes the selection from a focused layer row', async () => {
    const view = await mountPanel()
    act(() => view.store.select([edId('hero')]))
    await settle()
    row('hero').focus()

    const { handled } = fire(view.ctx, row('hero'), { key: 'Delete', code: 'Delete' })
    await settle()

    expect(handled).toBe(true)
    expect(sentOps(view.ctx)).toEqual([{ target: [edId('hero')], kind: 'deleteNode', payload: {} }])
  })
})
