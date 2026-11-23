// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult, Rect } from '../../../src/shared/protocol'
import type { EdId, EditOp, ProjectPath, TemplateNode } from '../../../src/shared/types'
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

const box: Rect = { x: 0, y: 0, width: 100, height: 20 }

function answer(read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'rects':
      return { kind: 'rects', rects: Array.from({ length: renderedCount[read.edId] ?? 0 }, () => box) }
    case 'computed':
      return { kind: 'computed', values: {} }
    case 'hitTest':
      return { kind: 'hitTest', edId: null }
    case 'snapRects':
      return { kind: 'snapRects', self: box, parent: null, siblings: [] }
    case 'supports':
      return { kind: 'supports', supported: true }
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
}

async function mountPanel(editorState: EditorState = editorStateWith()): Promise<Mounted> {
  const store = createEditorStore()
  store.setBoard(home)
  const index: BoardIndex = { board: home, frameSrc: `/project/secret/${home}`, tree, locations: {}, styles: {} }
  store.setIndex(index)
  const ctx = contextFor(store, editorState)
  const onEditorStateChange = vi.fn<(state: EditorState) => void>()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  act(() => root.render(<LayersPanel ctx={ctx} platform="mac" onEditorStateChange={onEditorStateChange} />))
  await settle()
  return { store, ctx, onEditorStateChange, container }
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

  it('Cmd-F focuses the search box', async () => {
    await mountPanel()

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true }))
    })

    expect(document.activeElement).toBe(findInput())
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
