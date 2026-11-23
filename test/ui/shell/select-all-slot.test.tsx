// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState } from '../../../src/shared/protocol'
import type { EdId, ProjectPath, TemplateNode } from '../../../src/shared/types'
import { createDefaultRegistry, type ActionRegistry } from '../../../src/ui/actions/registry'
import type { EditorContext, ShellSlot } from '../../../src/ui/plugin-api'
import { slots } from '../../../src/ui/shell/select-all.slot'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const SELECT_ALL_EVENT = 'editor:select-all'
const edId = (id: string) => id as EdId
const board = 'project/home.dc.html' as ProjectPath

function node(id: string, tag: string, children: TemplateNode[] = []): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children }
}

// root > row > a, b, c; card; other
const tree: TemplateNode = {
  ...node('root', 'x-dc', [node('row', 'section', [node('a', 'div'), node('b', 'div'), node('c', 'div')]), node('card', 'div'), node('other', 'div')]),
  readOnly: 'artboard-root',
}
const index: BoardIndex = { board, frameSrc: `/project/secret/${board}`, tree, text: '', locations: {}, styles: {}, rules: [] }
const editorState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function fakeEditor(selection: readonly string[]) {
  let selected = selection.map(edId)
  const ctx = {
    index: () => index,
    selection: () => ({ board, edIds: selected }),
    viewport: () => ({ zoom: 1, panX: 0, panY: 0 }),
    editorState: () => editorState,
    readOnly: () => false,
    select: vi.fn((edIds: readonly EdId[]) => {
      selected = [...edIds]
    }),
    setViewport: vi.fn(),
    apply: vi.fn(),
    beginAction: vi.fn(() => 'action-1'),
    preview: vi.fn(),
    setMode: vi.fn(),
    fit: vi.fn(),
    cancelGesture: vi.fn(() => false),
    setEditorState: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    read: vi.fn(),
    records: () => [],
    toast: vi.fn(),
    onChange: () => () => {},
  }
  return { ctx: ctx as typeof ctx & EditorContext, selected: () => [...selected].sort() }
}

function mountShell() {
  document.body.innerHTML = `
    <nav class="layers" aria-label="Layers"><input id="layer-search" aria-label="Find layer" /></nav>
    <div data-canvas-viewport="" tabindex="0" id="canvas"><iframe id="frame" title="Canvas"></iframe></div>
    <aside class="props" aria-label="Properties">
      <input id="width-field" value="240px" />
      <textarea id="notes"></textarea>
      <div contenteditable="true" id="rich" tabindex="0"></div>
    </aside>
  `
  const byId = (id: string) => document.getElementById(id)!
  return { search: byId('layer-search'), canvas: byId('canvas'), frame: byId('frame'), widthField: byId('width-field'), notes: byId('notes'), rich: byId('rich') }
}

let shell = mountShell()
let registry: ActionRegistry
let mounted: { root: Root; container: HTMLElement } | null = null

function mountSlots(ctx: EditorContext) {
  registry = createDefaultRegistry('mac')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <>
        {slots.map(({ id, component: Slot }: ShellSlot) => (
          <Slot key={id} ctx={ctx} registry={registry} platform="mac" probe={null} />
        ))}
      </>,
    )
  })
  mounted = { root, container }
}

function unmount() {
  if (!mounted) return
  const { root, container } = mounted
  act(() => root.unmount())
  container.remove()
  mounted = null
}

/** What the Electron menu item's fixed script does; true when nothing cancelled the event. */
function dispatchMenuSelectAll(): boolean {
  let notCancelled = true
  act(() => {
    notCancelled = window.dispatchEvent(new Event(SELECT_ALL_EVENT, { cancelable: true }))
  })
  return notCancelled
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  shell = mountShell()
})

afterEach(() => {
  unmount()
  document.body.innerHTML = ''
})

describe('the select-all slot', () => {
  it("cancels the menu's select-all and selects the artboard root's children when nothing has focus", () => {
    const { ctx, selected } = fakeEditor([])
    mountSlots(ctx)

    expect(dispatchMenuSelectAll()).toBe(false)

    expect(selected()).toEqual(['card', 'other', 'row'])
  })

  it("selects the selection's siblings when the canvas has focus", () => {
    const { ctx, selected } = fakeEditor(['b'])
    mountSlots(ctx)
    shell.canvas.focus()

    expect(dispatchMenuSelectAll()).toBe(false)

    expect(selected()).toEqual(['a', 'b', 'c'])
  })

  it.each(['widthField', 'search', 'notes', 'rich'] as const)('leaves the event to the native command while %s has focus', (field) => {
    const { ctx, selected } = fakeEditor(['b'])
    mountSlots(ctx)
    shell[field].focus()

    expect(dispatchMenuSelectAll()).toBe(true)

    expect(ctx.select).not.toHaveBeenCalled()
    expect(selected()).toEqual(['b'])
  })

  it('leaves the event to the native command while text editing in the canvas frame', () => {
    const { ctx } = fakeEditor(['b'])
    mountSlots(ctx)
    registry.setTextEditing(true)
    shell.frame.focus()

    expect(dispatchMenuSelectAll()).toBe(true)

    expect(ctx.select).not.toHaveBeenCalled()
  })

  it('takes the event again once text editing ends', () => {
    const { ctx, selected } = fakeEditor(['b'])
    mountSlots(ctx)
    registry.setTextEditing(true)
    dispatchMenuSelectAll()
    registry.setTextEditing(false)
    shell.canvas.focus()

    expect(dispatchMenuSelectAll()).toBe(false)

    expect(selected()).toEqual(['a', 'b', 'c'])
  })

  it('stops listening once unmounted', () => {
    const { ctx } = fakeEditor([])
    mountSlots(ctx)
    unmount()

    expect(dispatchMenuSelectAll()).toBe(true)

    expect(ctx.select).not.toHaveBeenCalled()
  })
})
