// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult } from '../../../src/shared/protocol'
import type { EdId, EditOp, ProjectPath, TemplateNode } from '../../../src/shared/types'
import { actions } from '../../../src/ui/actions/layers-panel.actions'
import { createActionRegistry, type ActionRegistry, type Platform } from '../../../src/ui/actions/registry'
import type { AckMessage, EditorContext } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'

const edId = (id: string) => id as EdId
const board = 'project/home.dc.html' as ProjectPath

function node(id: string, tag: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children, ...extra }
}

// root > header; hero > title, lede, photo; cards (sc-for) > card > cardTitle; promo (sc-if) > banner; footer (dc-import)
const tree = node(
  'root',
  'x-dc',
  [
    node('header', 'header'),
    node('hero', 'section', [node('title', 'h2'), node('lede', 'p'), node('photo', 'img')]),
    node('cards', 'sc-for', [node('card', 'div', [node('cardTitle', 'h3')])], { kind: 'sc-for' }),
    node('promo', 'sc-if', [node('banner', 'aside')], { kind: 'sc-if' }),
    node('footer', 'dc-import', [], { kind: 'dc-import', readOnly: 'dc-import' }),
  ],
  { readOnly: 'artboard-root' },
)

/** Every layer below the artboard that has a disclosure arrow in the panel. */
const EXPANDABLE_BELOW_ROOT = ['card', 'cards', 'hero', 'promo']

function answer(read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'computed':
      return { kind: 'computed', values: {} }
    case 'rects':
      return { kind: 'rects', rects: [{ x: 0, y: 0, width: 240, height: 40 }] }
    case 'hitTest':
      return { kind: 'hitTest', edId: null }
    case 'snapRects':
      return { kind: 'snapRects', self: { x: 0, y: 0, width: 240, height: 40 }, parent: null, siblings: [] }
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
    reload: true,
    warnings: [],
  }
}

function contextFor(store: EditorStore, editorState: EditorState) {
  let actionIds = 0
  return {
    index: () => store.getState().index,
    selection: () => {
      const { board: current, view } = store.getState()
      return current ? { board: current, edIds: view.selection } : null
    },
    viewport: () => store.getState().view.viewport,
    editorState: () => editorState,
    readOnly: () => store.getState().readOnly,
    select: vi.fn((edIds: readonly EdId[]) => store.select(edIds)),
    setViewport: (viewport) => store.setViewport(viewport),
    apply: vi.fn(async (op: EditOp) => ackFor(op)),
    beginAction: vi.fn(() => `action-${++actionIds}`),
    preview: vi.fn(),
    setMode: (mode: 'select' | 'hand') => store.setMode(mode),
    fit: vi.fn(),
    cancelGesture: vi.fn(() => false),
    setEditorState: vi.fn<(patch: Partial<EditorState>) => void>(),
    undo: vi.fn(),
    redo: vi.fn(),
    read: <R extends ProbeRead>(read: R) => Promise.resolve(answer(read)) as Promise<Extract<ProbeReadResult, { kind: R['kind'] }>>,
    records: () => store.getState().records,
    toast: vi.fn(),
    onChange: (listener) => store.subscribe(listener),
  } satisfies EditorContext
}

type Context = ReturnType<typeof contextFor>

/** The editor's shell as the shortcuts see it: the layers panel with its search box and one row, and the canvas. */
function mountShell() {
  document.body.innerHTML = `
    <aside class="left">
      <nav class="layers" aria-label="Layers">
        <label class="search"><input type="search" aria-label="Find layer" placeholder="Find layer" /></label>
        <div role="tree" aria-label="Layers">
          <div role="treeitem" tabindex="0" data-layer-id="hero"><span>hero</span></div>
        </div>
      </nav>
    </aside>
    <main class="center">
      <div data-canvas-viewport="" tabindex="0" aria-label="Canvas"></div>
    </main>
  `
  const find = (selector: string) => document.querySelector<HTMLElement>(selector)!
  return {
    search: find('input[aria-label="Find layer"]'),
    layerRow: find('[role="treeitem"]'),
    canvas: find('[data-canvas-viewport]'),
  }
}

interface Editor {
  readonly ctx: Context
  readonly registry: ActionRegistry
  readonly shell: ReturnType<typeof mountShell>
}

function editor(platform: Platform, editorState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }): Editor {
  const store = createEditorStore()
  store.setBoard(board)
  const index: BoardIndex = { board, frameSrc: `/project/secret/${board}`, tree, text: '', locations: {}, styles: {}, rules: [] }
  store.setIndex(index)
  return {
    ctx: contextFor(store, editorState),
    registry: createActionRegistry({ './layers-panel.actions.ts': { actions } }, platform),
    shell: mountShell(),
  }
}

/** Dispatches a real keydown at `target` and hands it to the registry the way the app's document listener does. */
function fire(view: Editor, init: KeyboardEventInit, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  let handled: boolean | undefined
  const listen = (dispatched: Event) => {
    handled = view.registry.handleKeyDown(dispatched as KeyboardEvent, view.ctx)
  }
  document.addEventListener('keydown', listen)
  target.dispatchEvent(event)
  document.removeEventListener('keydown', listen)
  return { event, handled }
}

function savedCollapsed(ctx: Context): readonly EdId[] | undefined {
  return ctx.setEditorState.mock.calls.at(-1)?.[0].collapsed
}

function withoutRoot(edIds: readonly EdId[] | undefined): string[] {
  return (edIds ?? []).filter((id) => id !== edId('root')).sort()
}

/** Option-L types "¬" on a Mac, so the chord arrives with the character and the key's position. */
const ALT_L: Readonly<Record<Platform, KeyboardEventInit>> = {
  mac: { key: '¬', code: 'KeyL', altKey: true },
  windows: { key: 'l', code: 'KeyL', altKey: true },
}

const MOD_F: Readonly<Record<Platform, KeyboardEventInit>> = {
  mac: { key: 'f', code: 'KeyF', metaKey: true },
  windows: { key: 'f', code: 'KeyF', ctrlKey: true },
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Alt-L collapses every layer', () => {
  it.each<Platform>(['mac', 'windows'])('collapses every layer that has children, as editor-only state (%s)', (platform) => {
    const view = editor(platform)

    const { event, handled } = fire(view, ALT_L[platform])

    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(view.ctx.setEditorState).toHaveBeenCalledTimes(1)
    expect(withoutRoot(savedCollapsed(view.ctx))).toEqual(EXPANDABLE_BELOW_ROOT)
    expect(view.ctx.apply).not.toHaveBeenCalled()
  })

  it('collapses the layers that were still open alongside the ones already collapsed', () => {
    const view = editor('mac', { hidden: [], locked: [], collapsed: [edId('cards')], boards: {} })

    fire(view, ALT_L.mac)

    expect(withoutRoot(savedCollapsed(view.ctx))).toEqual(EXPANDABLE_BELOW_ROOT)
  })

  it('works from a focused layer row and from the canvas', () => {
    const view = editor('mac')

    view.shell.layerRow.focus()
    expect(fire(view, ALT_L.mac, view.shell.layerRow).handled).toBe(true)
    view.shell.canvas.focus()
    expect(fire(view, ALT_L.mac, view.shell.canvas).handled).toBe(true)

    expect(view.ctx.setEditorState).toHaveBeenCalledTimes(2)
  })

  it('leaves Option-L to a text field, where it types a character', () => {
    const view = editor('mac')
    view.shell.search.focus()

    const { event, handled } = fire(view, ALT_L.mac, view.shell.search)

    expect(handled).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(view.ctx.setEditorState).not.toHaveBeenCalled()
  })
})

describe('Mod-F is a registry action', () => {
  it.each<Platform>(['mac', 'windows'])('fires from the canvas and keeps the browser Find bar shut (%s)', (platform) => {
    const view = editor(platform)
    view.shell.canvas.focus()

    const { event, handled } = fire(view, MOD_F[platform], view.shell.canvas)

    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
  })

  it('fires from inside a text field, the layer search box included', () => {
    const view = editor('mac')
    view.shell.search.focus()

    const { event, handled } = fire(view, MOD_F.mac, view.shell.search)

    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
  })

  it('fires with nothing focused', () => {
    const view = editor('windows')

    expect(fire(view, MOD_F.windows).handled).toBe(true)
  })

  it('is the only layers-panel shortcut that fires from a text field', () => {
    const view = editor('mac')

    const fromTextEntry = view.registry.all().filter((action) => action.inTextEntry)

    expect(fromTextEntry).toHaveLength(1)
    expect([fromTextEntry[0]!.kbd].flat()).toContain('Mod+F')
  })
})
