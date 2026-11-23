// @vitest-environment jsdom
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState } from '../../../src/shared/protocol'
import type { EdId, EditOp, ProjectPath, TemplateNode } from '../../../src/shared/types'
import { createDefaultRegistry, type ActionRegistry, type Platform } from '../../../src/ui/actions/registry'
import { filterPalette, paletteItems } from '../../../src/ui/palette'
import type { EditorContext, Viewport } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'

const edId = (id: string) => id as EdId
const board = 'project/home.dc.html' as ProjectPath

function node(id: string, tag: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children, ...extra }
}

// root > row > a, b, wrapper > inner, c; card; other; third
const tree = node(
  'root',
  'x-dc',
  [
    node('row', 'section', [node('a', 'div'), node('b', 'div'), node('wrapper', 'div', [node('inner', 'span')]), node('c', 'div')]),
    node('card', 'div'),
    node('other', 'div'),
    node('third', 'div'),
  ],
  { readOnly: 'artboard-root' },
)

const ROOT_CHILDREN = ['card', 'other', 'row', 'third']
const ROW_CHILDREN = ['a', 'b', 'c', 'wrapper']

const EMPTY_STATE: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function contextFor(store: EditorStore, editorState: EditorState) {
  const ctx = {
    index: () => store.getState().index,
    selection: () => {
      const { board: current, view } = store.getState()
      return current ? { board: current, edIds: view.selection } : null
    },
    viewport: () => store.getState().view.viewport,
    editorState: () => editorState,
    readOnly: () => store.getState().readOnly,
    select: vi.fn((edIds: readonly EdId[]) => store.select(edIds)),
    setViewport: (viewport: Viewport) => store.setViewport(viewport),
    apply: vi.fn(async (_op: EditOp, _actionId?: string) => {
      throw new Error('selecting writes nothing')
    }),
    beginAction: vi.fn(() => 'action-1'),
    preview: vi.fn(),
    setMode: (mode: 'select' | 'hand') => store.setMode(mode),
    fit: vi.fn(),
    cancelGesture: vi.fn(() => false),
    setEditorState: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    read: vi.fn(),
    records: () => store.getState().records,
    toast: vi.fn(),
    onChange: (listener: () => void) => store.subscribe(listener),
  }
  return ctx as typeof ctx & EditorContext
}

type Modifiers = Partial<Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>>

interface Pressed {
  readonly handled: boolean
  readonly prevented: boolean
}

interface Editor {
  readonly store: EditorStore
  readonly ctx: ReturnType<typeof contextFor>
  readonly registry: ActionRegistry
  readonly press: (key: string, modifiers: Modifiers, target?: Element) => Pressed
  /** The selection after the presses, in any order. */
  readonly selected: () => string[]
}

interface EditorOptions {
  readonly platform?: Platform
  readonly editorState?: EditorState
}

function editor(selection: readonly string[], options: EditorOptions = {}): Editor {
  const store = createEditorStore()
  store.setBoard(board)
  const index: BoardIndex = { board, frameSrc: `/project/secret/${board}`, tree, text: '', locations: {}, styles: {}, rules: [] }
  store.setIndex(index)
  store.select(selection.map(edId))
  const ctx = contextFor(store, options.editorState ?? EMPTY_STATE)
  const registry = createDefaultRegistry(options.platform ?? 'windows')
  const press = (key: string, modifiers: Modifiers, target: Element = document.body): Pressed => {
    const event = new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, ...modifiers })
    let handled = false
    const listen = (dispatched: Event) => {
      handled = registry.handleKeyDown(dispatched as KeyboardEvent, ctx)
    }
    document.addEventListener('keydown', listen)
    target.dispatchEvent(event)
    document.removeEventListener('keydown', listen)
    return { handled, prevented: event.defaultPrevented }
  }
  const selected = () => [...store.getState().view.selection].sort()
  return { store, ctx, registry, press, selected }
}

/** Mod is Ctrl on Windows, the platform these tests press keys on unless they say otherwise. */
const SELECT_ALL = { ctrlKey: true }
const INVERT = { ctrlKey: true, shiftKey: true }

function mountShell() {
  document.body.innerHTML = `
    <aside class="left">
      <nav class="layers" aria-label="Layers"><input id="layer-search" aria-label="Find layer" /></nav>
    </aside>
    <main class="center">
      <div data-canvas-viewport="" tabindex="0" id="canvas"><div data-canvas-shield="" id="shield"></div></div>
    </main>
    <aside class="props" aria-label="Properties">
      <input id="width-field" value="240px" />
      <textarea id="notes"></textarea>
      <div contenteditable="true" id="rich"></div>
    </aside>
  `
  const byId = (id: string) => document.getElementById(id)!
  return { search: byId('layer-search'), canvas: byId('canvas'), shield: byId('shield'), widthField: byId('width-field'), notes: byId('notes'), rich: byId('rich') }
}

let shell = mountShell()

beforeEach(() => {
  shell = mountShell()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Select all (Mod-A)', () => {
  it("selects the artboard root's children when nothing is selected", () => {
    const { press, selected } = editor([])

    expect(press('a', SELECT_ALL).handled).toBe(true)

    expect(selected()).toEqual(ROOT_CHILDREN)
  })

  it("selects every child of the selection's parent, and none of their children", () => {
    const { press, selected } = editor(['b'])

    expect(press('a', SELECT_ALL).handled).toBe(true)

    expect(selected()).toEqual(ROW_CHILDREN)
  })

  it('selects within the parent of the most recently selected element when the parents differ', () => {
    const rowLast = editor(['card', 'a'])
    rowLast.press('a', SELECT_ALL)
    const rootLast = editor(['a', 'card'])
    rootLast.press('a', SELECT_ALL)

    expect(rowLast.selected()).toEqual(ROW_CHILDREN)
    expect(rootLast.selected()).toEqual(ROOT_CHILDREN)
  })

  it('skips locked and hidden layers', () => {
    const editorState: EditorState = { ...EMPTY_STATE, locked: [edId('b'), edId('card')], hidden: [edId('c'), edId('other')] }
    const inRow = editor(['a'], { editorState })
    inRow.press('a', SELECT_ALL)
    const atRoot = editor([], { editorState })
    atRoot.press('a', SELECT_ALL)

    expect(inRow.selected()).toEqual(['a', 'wrapper'])
    expect(atRoot.selected()).toEqual(['row', 'third'])
  })

  it('runs from the focused canvas and writes nothing', () => {
    const { ctx, press, selected } = editor(['b'])

    expect(press('a', SELECT_ALL, shell.shield)).toEqual({ handled: true, prevented: true })

    expect(selected()).toEqual(ROW_CHILDREN)
    expect(ctx.apply).not.toHaveBeenCalled()
  })

  it('reads Mod as Cmd on macOS', () => {
    const { ctx, press, selected } = editor(['b'], { platform: 'mac' })

    expect(press('a', { ctrlKey: true }).handled).toBe(false)
    expect(ctx.select).not.toHaveBeenCalled()
    expect(press('a', { metaKey: true }).handled).toBe(true)

    expect(selected()).toEqual(ROW_CHILDREN)
  })

  it('stays native in a text field: the text is selected, not the layers', () => {
    const { ctx, press, selected } = editor(['b'])

    for (const field of [shell.widthField, shell.search, shell.notes, shell.rich]) {
      expect(press('a', SELECT_ALL, field)).toEqual({ handled: false, prevented: false })
    }

    expect(ctx.select).not.toHaveBeenCalled()
    expect(selected()).toEqual(['b'])
  })

  it('stays native while text editing in the canvas', () => {
    const { ctx, registry, press } = editor(['b'])
    registry.setTextEditing(true)

    expect(press('a', SELECT_ALL, shell.canvas)).toEqual({ handled: false, prevented: false })

    expect(ctx.select).not.toHaveBeenCalled()
  })
})

describe('Invert selection (Mod-Shift-A)', () => {
  it("selects the scope's children that are not selected", () => {
    const { press, selected } = editor(['a', 'c'])

    expect(press('a', INVERT).handled).toBe(true)

    expect(selected()).toEqual(['b', 'wrapper'])
  })

  it("selects all of the artboard root's children when nothing is selected", () => {
    const { press, selected } = editor([])

    press('a', INVERT)

    expect(selected()).toEqual(ROOT_CHILDREN)
  })

  it('leaves nothing selected when every child of the scope was selected', () => {
    const { ctx, press, selected } = editor(['a', 'b', 'wrapper', 'c'])

    expect(press('a', INVERT).handled).toBe(true)

    expect(ctx.select).toHaveBeenCalled()
    expect(selected()).toEqual([])
  })

  it('skips locked and hidden layers', () => {
    const editorState: EditorState = { ...EMPTY_STATE, locked: [edId('b')], hidden: [edId('third')] }
    const inRow = editor(['a'], { editorState })
    inRow.press('a', INVERT)
    const atRoot = editor(['card'], { editorState })
    atRoot.press('a', INVERT)

    expect(inRow.selected()).toEqual(['c', 'wrapper'])
    expect(atRoot.selected()).toEqual(['other', 'row'])
  })

  it('inverts within the parent of the most recently selected element when the parents differ', () => {
    const { press, selected } = editor(['card', 'a'])

    press('a', INVERT)

    expect(selected()).toEqual(['b', 'c', 'wrapper'])
  })

  it('reads Mod as Cmd on macOS', () => {
    const { press, selected } = editor(['a'], { platform: 'mac' })

    expect(press('a', { metaKey: true, shiftKey: true }).handled).toBe(true)

    expect(selected()).toEqual(['b', 'c', 'wrapper'])
  })

  it('stays native in a text field', () => {
    const { ctx, press, selected } = editor(['a'])

    for (const field of [shell.widthField, shell.search, shell.notes, shell.rich]) {
      expect(press('a', INVERT, field)).toEqual({ handled: false, prevented: false })
    }

    expect(ctx.select).not.toHaveBeenCalled()
    expect(selected()).toEqual(['a'])
  })

  it('is listed in the command palette, where it runs like the shortcut', () => {
    const { ctx, registry, selected } = editor(['a', 'c'])

    const [found] = filterPalette(paletteItems(registry, ctx.index()), 'invert selection')
    expect(found?.kind).toBe('action')
    if (found?.kind !== 'action') return
    expect(registry.shortcutOf(found.action.id)).toBe('Mod+Shift+A')
    found.action.run(ctx, ctx.beginAction())

    expect(selected()).toEqual(['b', 'wrapper'])
  })
})
