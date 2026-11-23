// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult, Rect } from '../../../src/shared/protocol'
import type { AuthoredDeclaration, EdId, EditOp, ProjectPath, StyleSource, TemplateNode } from '../../../src/shared/types'
import { PropertiesPanel } from '../../../src/ui/panels/PropertiesPanel'
import { sections as imageSections } from '../../../src/ui/panels/sections/image.section'
import type { AckMessage, EditorContext } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const edId = (id: string) => id as EdId
const board = 'project/home.dc.html' as ProjectPath

function node(id: string, tag: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children, ...extra }
}

// root > photo (img), card (div)
const tree = node('root', 'x-dc', [node('photo', 'img'), node('card', 'div')], { readOnly: 'artboard-root' })

function inline(...declarations: Array<readonly [string, string]>): StyleSource[] {
  const authored = declarations.map(([prop, value]): AuthoredDeclaration => ({ prop, value, important: false, hasHole: false }))
  return [{ target: 'inline', file: board, line: 24, range: { start: 0, end: 0 }, declarations: authored }]
}

const box: Rect = { x: 0, y: 0, width: 64, height: 64 }

function answer(read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'rects':
      return { kind: 'rects', rects: [box] }
    case 'computed':
      return { kind: 'computed', values: Object.fromEntries(read.props.map((prop) => [prop, ''])) }
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
    preview: vi.fn(),
    setMode: (mode: 'select' | 'hand') => store.setMode(mode),
    fit: vi.fn(),
    cancelGesture: vi.fn(),
    setEditorState: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    read: <R extends ProbeRead>(read: R) => Promise.resolve(answer(read) as Extract<ProbeReadResult, { kind: R['kind'] }>),
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
  readonly ctx: ReturnType<typeof contextFor>
  readonly container: HTMLElement
}

async function mountImage(selected: string, styles: Record<string, readonly StyleSource[]> = {}): Promise<Mounted> {
  const store = createEditorStore()
  store.setBoard(board)
  const index: BoardIndex = {
    board,
    frameSrc: `/project/secret/${board}`,
    tree,
    text: '',
    rules: [],
    locations: {},
    styles: styles as BoardIndex['styles'],
  }
  store.setIndex(index)
  store.select([edId(selected)])
  const ctx = contextFor(store)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  act(() => root.render(<PropertiesPanel ctx={ctx} tokens={[]} sections={imageSections} />))
  await settle()
  return { ctx, container }
}

function fitSelect(view: Mounted): HTMLSelectElement | null {
  return view.container.querySelector<HTMLSelectElement>('[data-prop="object-fit"] select')
}

function positionInput(view: Mounted): HTMLInputElement | null {
  return view.container.querySelector<HTMLInputElement>('[data-prop="object-position"] input')
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

async function pick(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

function lastOp(view: Mounted): EditOp {
  const call = view.ctx.apply.mock.calls.at(-1)
  if (!call) throw new Error('no op was applied')
  return call[0]
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

describe('Image section', () => {
  it('offers the five object-fit values in a dropdown for an <img>', async () => {
    const view = await mountImage('photo')

    const options = [...(fitSelect(view)?.options ?? [])].map((option) => option.value).filter(Boolean)
    expect(options).toEqual(['fill', 'contain', 'cover', 'none', 'scale-down'])
  })

  it('writes the picked object-fit', async () => {
    const view = await mountImage('photo')

    await pick(fitSelect(view)!, 'cover')

    expect(lastOp(view)).toEqual({ target: [edId('photo')], kind: 'setDecl', payload: { prop: 'object-fit', value: 'cover' } })
  })

  it('shows the authored object-fit', async () => {
    const view = await mountImage('photo', { photo: inline(['object-fit', 'scale-down']) })

    expect(fitSelect(view)?.value).toBe('scale-down')
  })

  it('writes a typed object-position', async () => {
    const view = await mountImage('photo')

    await commit(positionInput(view)!, 'center top')

    expect(lastOp(view)).toEqual({ target: [edId('photo')], kind: 'setDecl', payload: { prop: 'object-position', value: 'center top' } })
  })

  it('shows the authored object-position', async () => {
    const view = await mountImage('photo', { photo: inline(['object-position', '25% 75%']) })

    expect(positionInput(view)?.value).toBe('25% 75%')
  })

  it('does not apply to an element that is not an <img>', async () => {
    const view = await mountImage('card')

    expect(view.container.querySelector('[data-section]')).toBeNull()
    expect(fitSelect(view)).toBeNull()
    expect(positionInput(view)).toBeNull()
  })
})
