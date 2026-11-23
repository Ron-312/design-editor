// @vitest-environment jsdom
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult, Rect } from '../../../src/shared/protocol'
import type { AuthoredDeclaration, EdId, EditOp, ProjectPath, StyleSource, TemplateNode } from '../../../src/shared/types'
import { createDefaultRegistry, type Platform } from '../../../src/ui/actions/registry'
import type { AckMessage, EditorContext, Viewport } from '../../../src/ui/plugin-api'
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

function decl(prop: string, value: string): AuthoredDeclaration {
  return { prop, value, important: false, hasHole: false }
}

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height }
}

const CARD_DECLARATIONS = [
  decl('background-color', '#1a73e8'),
  decl('color', '#fff7ed'),
  decl('border-radius', '12px'),
  decl('box-shadow', '0 4px 12px rgba(0, 0, 0, 0.04)'),
  decl('font-size', '14px'),
]

const styles: Record<string, readonly StyleSource[]> = {
  card: [{ target: 'inline', file: board, line: 12, range: { start: 0, end: 0 }, declarations: CARD_DECLARATIONS }],
  other: [{ target: 'inline', file: board, line: 13, range: { start: 0, end: 0 }, declarations: [decl('border-radius', '4px')] }],
}

/** What getComputedStyle reports for every element: far more than anything authored. */
const COMPUTED: Readonly<Record<string, string>> = {
  display: 'block',
  position: 'static',
  'z-index': 'auto',
  'background-color': 'rgb(26, 115, 232)',
  color: 'rgb(255, 247, 237)',
  'border-top-left-radius': '12px',
  'font-size': '14px',
  'font-family': 'Inter, sans-serif',
  'line-height': 'normal',
  margin: '0px',
  'margin-top': '0px',
  'margin-right': '0px',
  'margin-bottom': '0px',
  'margin-left': '0px',
  width: '240px',
}

/**
 * A row of four neighbours, b with a 4px left margin. Between margin boxes the spaces are 16, 10 and 40
 * (median 16); between border boxes they would be 20, 10 and 40 (median 20).
 */
const ROW_RECTS: Readonly<Record<string, Rect>> = {
  a: rect(0, 0, 100, 40),
  b: rect(120, 0, 100, 40),
  wrapper: rect(230, 0, 100, 40),
  c: rect(370, 0, 100, 40),
}

/** card and other stacked: 40px apart as border boxes, 20px apart once their 8px and 12px margins are counted. */
const STACK_RECTS: Readonly<Record<string, Rect>> = {
  card: rect(0, 0, 200, 50),
  other: rect(0, 90, 200, 50),
  third: rect(0, 300, 200, 50),
}

interface Scene {
  readonly computed?: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly rects?: Readonly<Record<string, Rect>>
}

const LAYOUT_SCENE: Scene = {
  rects: { ...ROW_RECTS, ...STACK_RECTS },
  computed: {
    row: { display: 'flex' },
    b: { 'margin-left': '4px', margin: '0px 0px 0px 4px' },
    card: { 'margin-bottom': '8px', margin: '0px 0px 8px' },
    other: { 'margin-top': '12px', margin: '12px 0px 0px' },
  },
}

function ackFor(op: EditOp, extra: Partial<AckMessage> = {}): AckMessage {
  return {
    type: 'ack',
    opId: 'op-1',
    record: { target: op.target, kind: op.kind, prop: null, before: null, after: null, scope: { kind: 'element' }, files: [board] },
    mintedIds: [],
    locations: {},
    resolved: {},
    reload: op.kind !== 'setDecl' && op.kind !== 'removeDecl',
    warnings: [],
    ...extra,
  }
}

const EMPTY_STATE: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function answer(scene: Scene, read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'computed':
      return { kind: 'computed', values: { ...COMPUTED, ...scene.computed?.[read.edId] } }
    case 'rects':
      return { kind: 'rects', rects: [scene.rects?.[read.edId] ?? rect(0, 0, 240, 40)] }
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
  }
}

function contextFor(store: EditorStore, scene: Scene, initialState: EditorState) {
  let actions = 0
  let editorState = initialState
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
    apply: vi.fn(async (op: EditOp, _actionId?: string) => ackFor(op)),
    beginAction: vi.fn(() => `action-${++actions}`),
    preview: vi.fn(),
    setMode: (mode: 'select' | 'hand') => store.setMode(mode),
    fit: vi.fn(),
    cancelGesture: vi.fn(() => false),
    setEditorState: vi.fn((patch: Partial<EditorState>) => {
      editorState = { ...editorState, ...patch }
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    read: vi.fn(async (read: ProbeRead) => answer(scene, read)),
    records: () => store.getState().records,
    toast: vi.fn(),
    onChange: (listener: () => void) => store.subscribe(listener),
  }
  return ctx as typeof ctx & EditorContext
}

type Context = ReturnType<typeof contextFor>

type Modifiers = Partial<Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>>

interface PressOptions {
  readonly code?: string
  /** Where focus is; the body, as when nothing has focus, unless given. */
  readonly target?: Element
}

interface Editor {
  readonly store: EditorStore
  readonly ctx: Context
  readonly press: (key: string, modifiers?: Modifiers, options?: PressOptions) => boolean
}

interface EditorOptions {
  readonly platform?: Platform
  readonly scene?: Scene
  readonly editorState?: EditorState
}

function editor(selection: readonly string[], options: EditorOptions = {}): Editor {
  const store = createEditorStore()
  store.setBoard(board)
  const index: BoardIndex = { board, frameSrc: `/project/secret/${board}`, tree, text: '', locations: {}, styles: styles as BoardIndex['styles'], rules: [] }
  store.setIndex(index)
  store.select(selection.map(edId))
  const ctx = contextFor(store, options.scene ?? {}, options.editorState ?? EMPTY_STATE)
  const registry = createDefaultRegistry(options.platform ?? 'windows')
  const press = (key: string, modifiers: Modifiers = {}, { code = '', target = document.body }: PressOptions = {}) => {
    const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...modifiers })
    let handled = false
    const listen = (dispatched: Event) => {
      handled = registry.handleKeyDown(dispatched as KeyboardEvent, ctx)
    }
    document.addEventListener('keydown', listen)
    target.dispatchEvent(event)
    document.removeEventListener('keydown', listen)
    return handled
  }
  return { store, ctx, press }
}

/** Mod is Ctrl on Windows, the platform these tests press keys on unless they say otherwise. */
const MOD = { ctrlKey: true }

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Each op sent, without the action id the registry handed the run. */
function ops(ctx: Context): EditOp[] {
  return ctx.apply.mock.calls.map(([op]) => ({ target: op.target, kind: op.kind, payload: op.payload }) as EditOp)
}

function toastMessages(ctx: Context): string[] {
  return ctx.toast.mock.calls.map(([toast]) => toast.message)
}

/** The editor's shell as the registry sees it: a properties panel, the layers panel and the canvas. */
function mountShell() {
  document.body.innerHTML = `
    <aside class="left">
      <nav class="layers" aria-label="Layers">
        <input id="layer-search" aria-label="Find layer" />
        <div role="tree" aria-label="Layers">
          <div role="treeitem" tabindex="0" id="layer-row" data-layer-id="b">
            <span>b</span>
            <button type="button" aria-label="Lock" id="lock-button">lock</button>
            <button type="button" aria-label="Hide" id="hide-button">hide</button>
          </div>
        </div>
      </nav>
    </aside>
    <main class="center">
      <div data-canvas-viewport="" tabindex="0" id="canvas"><div data-canvas-shield="" id="shield"></div></div>
    </main>
    <aside class="props" aria-label="Properties">
      <button type="button" id="panel-button">Fill</button>
      <input id="width-field" value="240px" />
    </aside>
  `
  const byId = (id: string) => document.getElementById(id)!
  return {
    search: byId('layer-search'),
    layerRow: byId('layer-row'),
    lockButton: byId('lock-button'),
    hideButton: byId('hide-button'),
    canvas: byId('canvas'),
    shield: byId('shield'),
    panelButton: byId('panel-button'),
    widthField: byId('width-field'),
  }
}

let shell = mountShell()

beforeEach(() => {
  shell = mountShell()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('layer actions', () => {
  it('Mod+G wraps the selected neighbours in a container', async () => {
    const { ctx, press } = editor(['a', 'b'])

    expect(press('g', MOD)).toBe(true)
    await settle()

    expect(ops(ctx)).toEqual([{ target: [edId('a'), edId('b')], kind: 'wrapNode', payload: { tag: 'div' } }])
  })

  it('Mod+Shift+G ungroups the selected container', async () => {
    const { ctx, press } = editor(['wrapper'])

    expect(press('g', { ...MOD, shiftKey: true })).toBe(true)
    await settle()

    expect(ops(ctx)).toEqual([{ target: [edId('wrapper')], kind: 'unwrapNode', payload: {} }])
  })

  it('Mod+D duplicates every selected layer in one op', async () => {
    const { ctx, press } = editor(['a', 'card'])

    expect(press('d', MOD)).toBe(true)
    await settle()

    expect(ops(ctx)).toEqual([{ target: [edId('a'), edId('card')], kind: 'duplicateNode', payload: {} }])
  })

  it('Delete deletes the selected layer', async () => {
    const { ctx, press } = editor(['b'])

    expect(press('Delete')).toBe(true)
    await settle()

    expect(ops(ctx)).toEqual([{ target: [edId('b')], kind: 'deleteNode', payload: {} }])
  })

  it('reads Mod as Cmd on macOS', async () => {
    const { ctx, press } = editor(['a'], { platform: 'mac' })

    expect(press('d', { ctrlKey: true })).toBe(false)
    expect(press('d', { metaKey: true })).toBe(true)
    await settle()

    expect(ops(ctx).map((op) => op.kind)).toEqual(['duplicateNode'])
  })

  it('does nothing with an empty selection', async () => {
    const { ctx, press } = editor([])

    press('d', MOD)
    press('Delete')
    press('g', MOD)
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
  })

  it('does nothing while a push holds the lock', async () => {
    const { store, ctx, press } = editor(['a'])
    store.setReadOnly(true)

    press('d', MOD)
    press('Delete')
    press('Backspace')
    press('g', MOD)
    press('g', { ...MOD, shiftKey: true })
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
  })

  it('sends an invalid nesting once and never retries it with another tag', async () => {
    const { ctx, press } = editor(['a'])
    ctx.apply.mockRejectedValueOnce(new Error("a <div> can't go inside a <p>"))

    press('g', MOD)
    await settle()

    expect(ops(ctx)).toEqual([{ target: [edId('a')], kind: 'wrapNode', payload: { tag: 'div' } }])
  })

  it("shows the server's selector-match warning as a toast", async () => {
    const warning = 'this move can change which selectors match: .row > div:first-child'
    const { ctx, press } = editor(['a', 'b'])
    ctx.apply.mockImplementationOnce(async (op: EditOp) => ackFor(op, { warnings: [warning] }))

    press('g', MOD)
    await settle()

    expect(ctx.toast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(warning), tone: 'warning' }))
  })

  it('shows no warning toast when the server sends none', async () => {
    const { ctx, press } = editor(['a', 'b'])

    press('g', MOD)
    await settle()

    expect(ctx.apply).toHaveBeenCalledTimes(1)
    expect(ctx.toast.mock.calls.filter(([toast]) => toast.tone === 'warning')).toEqual([])
  })
})

describe('Backspace and Delete', () => {
  it('Backspace deletes the selected layer like Delete', async () => {
    const { ctx, press } = editor(['b'])

    expect(press('Backspace')).toBe(true)
    await settle()

    expect(ops(ctx)).toEqual([{ target: [edId('b')], kind: 'deleteNode', payload: {} }])
  })

  it.each(['Delete', 'Backspace'])('%s deletes from the focused canvas', async (key) => {
    const { ctx, press } = editor(['b'])

    expect(press(key, {}, { target: shell.shield })).toBe(true)
    await settle()

    expect(ops(ctx)).toEqual([{ target: [edId('b')], kind: 'deleteNode', payload: {} }])
  })

  it.each(['Delete', 'Backspace'])('%s deletes from a focused layer row', async (key) => {
    const { ctx, press } = editor(['b'])

    expect(press(key, {}, { target: shell.layerRow })).toBe(true)
    await settle()

    expect(ops(ctx)).toEqual([{ target: [edId('b')], kind: 'deleteNode', payload: {} }])
  })

  it.each(['Delete', 'Backspace'])('%s from a focused properties-panel button deletes nothing', async (key) => {
    const { ctx, press } = editor(['b'])

    expect(press(key, {}, { target: shell.panelButton })).toBe(false)
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
  })

  it.each(['Delete', 'Backspace'])('%s in a text field edits the text and deletes no layer', async (key) => {
    const { ctx, press } = editor(['b'])

    expect(press(key, {}, { target: shell.widthField })).toBe(false)
    expect(press(key, {}, { target: shell.search })).toBe(false)
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
  })

  it.each(['Delete', 'Backspace'])('%s with nothing selected does nothing and shows no toast', async (key) => {
    const { ctx, press } = editor([])

    expect(press(key)).toBe(false)
    expect(press(key, {}, { target: shell.layerRow })).toBe(false)
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
    expect(ctx.toast).not.toHaveBeenCalled()
  })

  it.each([
    ['windows', { ctrlKey: true }],
    ['mac', { metaKey: true }],
  ] as const)('Mod+Backspace ungroups the selected container on %s', async (platform, mod) => {
    const { ctx, press } = editor(['wrapper'], { platform })

    expect(press('Backspace', mod)).toBe(true)
    await settle()

    expect(ops(ctx)).toEqual([{ target: [edId('wrapper')], kind: 'unwrapNode', payload: {} }])
  })
})

describe('hide and lock', () => {
  it.each([
    ['windows', { ctrlKey: true }],
    ['mac', { metaKey: true }],
  ] as const)('Mod+Shift+H and Mod+Shift+L are bound on %s and never write the source', async (platform, mod) => {
    const { ctx, press } = editor(['a'], { platform })

    expect(press('h', { ...mod, shiftKey: true })).toBe(true)
    expect(press('l', { ...mod, shiftKey: true })).toBe(true)
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
  })

  it.each([
    ['h', 'hidden'],
    ['l', 'locked'],
  ] as const)('Mod+Shift+%s adds the selected layers to %s through setEditorState, keeping the others', async (key, toggle) => {
    const before: EditorState = { ...EMPTY_STATE, hidden: [edId('third')], locked: [edId('third')] }
    const { ctx, press } = editor(['a', 'card'], { editorState: before })

    press(key, { ...MOD, shiftKey: true })
    await settle()

    expect(ctx.setEditorState).toHaveBeenCalledTimes(1)
    const patch = ctx.setEditorState.mock.calls[0]![0]
    expect([...(patch[toggle] ?? [])].sort()).toEqual(['a', 'card', 'third'])
    expect(ctx.editorState()[toggle === 'hidden' ? 'locked' : 'hidden']).toEqual([edId('third')])
  })

  it.each([
    ['h', 'hidden'],
    ['l', 'locked'],
  ] as const)('Mod+Shift+%s takes a layer that is already %s out again', async (key, toggle) => {
    const before: EditorState = { ...EMPTY_STATE, [toggle]: [edId('a'), edId('third')] }
    const { ctx, press } = editor(['a'], { editorState: before })

    press(key, { ...MOD, shiftKey: true })
    await settle()

    expect(ctx.setEditorState).toHaveBeenCalledTimes(1)
    expect(ctx.editorState()[toggle]).toEqual([edId('third')])
  })

  it('never presses the layer row buttons', async () => {
    const clicks = vi.fn()
    shell.hideButton.addEventListener('click', clicks)
    shell.lockButton.addEventListener('click', clicks)
    const { ctx, press } = editor(['b'])

    press('h', { ...MOD, shiftKey: true })
    press('l', { ...MOD, shiftKey: true })
    await settle()

    expect(clicks).not.toHaveBeenCalled()
    expect(ctx.setEditorState).toHaveBeenCalledTimes(2)
  })
})

describe('Frame selection', () => {
  const FRAME = { ...MOD, altKey: true }

  function wrapOps(ctx: Context) {
    return ops(ctx).flatMap((op) => (op.kind === 'wrapNode' ? [op] : []))
  }

  function styleOf(ctx: Context): Record<string, string> {
    const [wrap] = wrapOps(ctx)
    return Object.fromEntries((wrap?.payload.style ?? []).map(({ prop, value }) => [prop, value]))
  }

  /** `flex-direction` may be left out for a row, since row is its initial value. */
  function directionOf(style: Readonly<Record<string, string>>): string {
    return style['flex-direction'] ?? 'row'
  }

  it('Mod+Alt+G wraps a row of neighbours in one styled div: flex, row, and the median margin-box gap', async () => {
    const { ctx, press } = editor(['a', 'b', 'wrapper', 'c'], { scene: LAYOUT_SCENE })

    expect(press('g', FRAME)).toBe(true)
    await settle()

    expect(ctx.apply).toHaveBeenCalledTimes(1)
    const [wrap] = wrapOps(ctx)
    expect(wrap?.target).toEqual([edId('a'), edId('b'), edId('wrapper'), edId('c')])
    expect(wrap?.payload.tag).toBe('div')
    const style = styleOf(ctx)
    expect(style.display).toBe('flex')
    expect(directionOf(style)).toBe('row')
    expect(style.gap).toBe('16px')
  })

  it('infers a column when the centres spread more vertically, measuring between margin boxes', async () => {
    const { ctx, press } = editor(['card', 'other'], { scene: LAYOUT_SCENE })

    press('g', FRAME)
    await settle()

    const style = styleOf(ctx)
    expect(style.display).toBe('flex')
    expect(style['flex-direction']).toBe('column')
    expect(style.gap).toBe('20px')
  })

  it('writes no padding, since the wrapper hugs its children', async () => {
    const { ctx, press } = editor(['a', 'b', 'wrapper', 'c'], { scene: LAYOUT_SCENE })

    press('g', FRAME)
    await settle()

    const style = styleOf(ctx)
    expect(style.display).toBe('flex')
    expect(Object.keys(style).filter((prop) => !['display', 'flex-direction', 'gap'].includes(prop))).toEqual([])
  })

  it('reads every rect before it sends the op, and sends nothing after it', async () => {
    const { ctx, press } = editor(['a', 'b', 'wrapper', 'c'], { scene: LAYOUT_SCENE })
    const readsAtApply: number[] = []
    ctx.apply.mockImplementation(async (op: EditOp) => {
      readsAtApply.push(ctx.read.mock.calls.length)
      return ackFor(op)
    })

    press('g', FRAME)
    await settle()

    const rectReads = ctx.read.mock.calls.filter(([read]) => read.kind === 'rects').map(([read]) => read.kind === 'rects' && read.edId)
    expect(rectReads).toEqual(expect.arrayContaining([edId('a'), edId('b'), edId('wrapper'), edId('c')]))
    expect(readsAtApply).toEqual([ctx.read.mock.calls.length])
  })

  it('is reached on macOS, where Option turns the G into ©', async () => {
    const { ctx, press } = editor(['a', 'b', 'wrapper', 'c'], { platform: 'mac', scene: LAYOUT_SCENE })

    expect(press('©', { metaKey: true, altKey: true }, { code: 'KeyG' })).toBe(true)
    await settle()

    expect(wrapOps(ctx)).toHaveLength(1)
    expect(styleOf(ctx).display).toBe('flex')
  })

  it.each(['absolute', 'fixed'])('refuses with a toast when a selected layer is %s, and sends nothing', async (position) => {
    const scene: Scene = { ...LAYOUT_SCENE, computed: { ...LAYOUT_SCENE.computed, b: { position } } }
    const { ctx, press } = editor(['a', 'b'], { scene })

    press('g', FRAME)
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
    expect(toastMessages(ctx)).toContain('Frame selection needs in-flow layers — use Wrap in container (Mod-G)')
  })

  it('refuses layers that are not neighbouring siblings with the wrap wording', async () => {
    const { ctx, press } = editor(['a', 'wrapper'], { scene: LAYOUT_SCENE })

    press('g', FRAME)
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
    expect(toastMessages(ctx)).toContain('only neighbouring layers can be wrapped together')
  })

  it('does nothing with an empty selection or while a push holds the lock', async () => {
    const empty = editor([], { scene: LAYOUT_SCENE })
    empty.press('g', FRAME)
    const locked = editor(['a', 'b'], { scene: LAYOUT_SCENE })
    locked.store.setReadOnly(true)
    locked.press('g', FRAME)
    await settle()

    expect(empty.ctx.apply).not.toHaveBeenCalled()
    expect(locked.ctx.apply).not.toHaveBeenCalled()
  })

  it('Mod+G stays the plain wrap with no style', async () => {
    const { ctx, press } = editor(['a', 'b'], { scene: LAYOUT_SCENE })

    press('g', MOD)
    await settle()

    expect(ops(ctx)).toEqual([{ target: [edId('a'), edId('b')], kind: 'wrapNode', payload: { tag: 'div' } }])
  })
})

describe('copy and paste style', () => {
  const COPY = { ...MOD, altKey: true }

  function pastedDeclarations(ctx: Context): Array<readonly [string, string]> {
    return ops(ctx).flatMap((op) => (op.kind === 'setDecl' ? [[op.payload.prop, op.payload.value] as const] : []))
  }

  it('pastes exactly the authored declarations of the copied layer, never computed ones', async () => {
    const { store, ctx, press } = editor(['card'])

    expect(press('c', COPY)).toBe(true)
    store.select([edId('other')])
    expect(press('v', COPY)).toBe(true)
    await settle()

    expect(new Map(pastedDeclarations(ctx))).toEqual(new Map(CARD_DECLARATIONS.map((entry) => [entry.prop, entry.value])))
    expect(ops(ctx).every((op) => op.kind === 'setDecl' && op.target.join(' ') === 'other' && op.payload.rule === undefined)).toBe(true)
  })

  it('lists every pasted property in the toast', async () => {
    const { store, ctx, press } = editor(['card'])

    press('c', COPY)
    store.select([edId('other')])
    press('v', COPY)
    await settle()

    const applied = toastMessages(ctx).find((message) => CARD_DECLARATIONS.every((entry) => message.includes(entry.prop)))
    expect(applied).toBeDefined()
  })

  it('pastes onto every selected layer', async () => {
    const { store, ctx, press } = editor(['card'])

    press('c', COPY)
    store.select([edId('other'), edId('third')])
    press('v', COPY)
    await settle()

    expect(ops(ctx).length).toBeGreaterThan(0)
    expect(ops(ctx).every((op) => op.target.join(' ') === 'other third')).toBe(true)
  })

  it('pastes nothing before anything is copied', async () => {
    const { ctx, press } = editor(['other'])

    press('v', COPY)
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
  })

  it('pastes nothing while a push holds the lock', async () => {
    const { store, ctx, press } = editor(['card'])

    press('c', COPY)
    store.select([edId('other')])
    store.setReadOnly(true)
    press('v', COPY)
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
  })
})
