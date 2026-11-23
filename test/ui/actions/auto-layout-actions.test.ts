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

const leaves = (...ids: string[]) => ids.map((id) => node(id, 'div'))

// root > row > r1..r4; stack > s1..s4; solo > only; flexed > f1, f2
const tree = node(
  'root',
  'x-dc',
  [
    node('row', 'div', leaves('r1', 'r2', 'r3', 'r4')),
    node('stack', 'div', leaves('s1', 's2', 's3', 's4')),
    node('solo', 'div', leaves('only')),
    node('flexed', 'div', leaves('f1', 'f2')),
  ],
  { readOnly: 'artboard-root' },
)

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height }
}

/**
 * row: four boxes side by side with spaces 12, 12 and 40 (median 12, mean 21.33), inset 30 top,
 * 16 right, 30 bottom and 20 left. stack: four boxes stacked with spaces 16, 16 and 60, inset 24, 76,
 * 84, 24. solo: one box inset 20, 60, 40, 40.
 */
const RECTS: Readonly<Record<string, Rect>> = {
  root: rect(0, 0, 1280, 900),
  row: rect(0, 0, 500, 100),
  r1: rect(20, 30, 100, 40),
  r2: rect(132, 30, 100, 40),
  r3: rect(244, 30, 100, 40),
  r4: rect(384, 30, 100, 40),
  stack: rect(0, 200, 300, 400),
  s1: rect(24, 224, 200, 50),
  s2: rect(24, 290, 200, 50),
  s3: rect(24, 356, 200, 50),
  s4: rect(24, 466, 200, 50),
  solo: rect(0, 700, 400, 120),
  only: rect(40, 720, 300, 60),
  flexed: rect(600, 0, 300, 200),
  f1: rect(600, 0, 100, 40),
  f2: rect(600, 48, 100, 40),
}

/** What getComputedStyle reports for an in-flow block with no margin, border or padding. */
const BLOCK: Readonly<Record<string, string>> = {
  display: 'block',
  position: 'static',
  margin: '0px',
  'margin-top': '0px',
  'margin-right': '0px',
  'margin-bottom': '0px',
  'margin-left': '0px',
  'border-top-width': '0px',
  'border-right-width': '0px',
  'border-bottom-width': '0px',
  'border-left-width': '0px',
  'padding-top': '0px',
  'padding-right': '0px',
  'padding-bottom': '0px',
  'padding-left': '0px',
  'box-sizing': 'content-box',
}

const FLEXED_DECLARATIONS = [
  ['display', 'flex'],
  ['flex-direction', 'column'],
  ['gap', '8px'],
  ['justify-content', 'center'],
  ['align-items', 'flex-end'],
  ['width', '300px'],
  ['background-color', '#fde68a'],
] as const

const FLEX_PROPS = ['display', 'flex-direction', 'gap', 'justify-content', 'align-items']

function decl(prop: string, value: string): AuthoredDeclaration {
  return { prop, value, important: false, hasHole: false }
}

const styles: Record<string, readonly StyleSource[]> = {
  flexed: [{ target: 'inline', file: board, line: 12, range: { start: 0, end: 0 }, declarations: FLEXED_DECLARATIONS.map(([prop, value]) => decl(prop, value)) }],
}

const COMPUTED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  flexed: { display: 'flex', 'flex-direction': 'column', 'justify-content': 'center', 'align-items': 'flex-end', gap: '8px' },
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

const EMPTY_STATE: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function answer(read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'computed':
      return { kind: 'computed', values: { ...BLOCK, ...COMPUTED[read.edId] } }
    case 'rects':
      return { kind: 'rects', rects: [RECTS[read.edId] ?? rect(0, 0, 240, 40)] }
    case 'hitTest':
      return { kind: 'hitTest', edId: null }
    case 'snapRects':
      return { kind: 'snapRects', self: RECTS[read.edId] ?? rect(0, 0, 240, 40), parent: null, siblings: [] }
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

function contextFor(store: EditorStore) {
  let actions = 0
  const ctx = {
    index: () => store.getState().index,
    selection: () => {
      const { board: current, view } = store.getState()
      return current ? { board: current, edIds: view.selection } : null
    },
    viewport: () => store.getState().view.viewport,
    editorState: () => EMPTY_STATE,
    readOnly: () => store.getState().readOnly,
    select: vi.fn((edIds: readonly EdId[]) => store.select(edIds)),
    setViewport: (viewport: Viewport) => store.setViewport(viewport),
    apply: vi.fn(async (op: EditOp, _actionId?: string) => ackFor(op)),
    beginAction: vi.fn(() => `action-${++actions}`),
    preview: vi.fn(),
    setMode: (mode: 'select' | 'hand') => store.setMode(mode),
    fit: vi.fn(),
    cancelGesture: vi.fn(() => false),
    setEditorState: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    read: vi.fn(async (read: ProbeRead) => answer(read)),
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

function editor(selection: readonly string[], platform: Platform = 'windows'): Editor {
  const store = createEditorStore()
  store.setBoard(board)
  const index: BoardIndex = { board, frameSrc: `/project/secret/${board}`, tree, text: '', locations: {}, styles: styles as BoardIndex['styles'], rules: [] }
  store.setIndex(index)
  store.select(selection.map(edId))
  const ctx = contextFor(store)
  const registry = createDefaultRegistry(platform)
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

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const pressAddAutoLayout = (target: Editor, options?: PressOptions) => target.press('A', { shiftKey: true }, { code: 'KeyA', ...options })
const pressRemoveAutoLayout = (target: Editor) => target.press('A', { altKey: true, shiftKey: true }, { code: 'KeyA' })

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

/** The declarations set, last write winning. */
function setDeclarations(ctx: Context): Record<string, string> {
  return Object.fromEntries(writes(ctx).flatMap((write) => (write.value === null ? [] : [[write.prop, write.value.trim()] as const])))
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const
type Padding = Record<(typeof SIDES)[number], string>

/** Padding written as four longhands or as the `padding` shorthand, as top/right/bottom/left. */
function paddingOf(declarations: Readonly<Record<string, string>>): Padding {
  const values = declarations['padding']?.split(/\s+/) ?? []
  const [top, right = top, bottom = top, left = right] = values
  const shorthand: Record<string, string | undefined> = { top, right, bottom, left }
  return Object.fromEntries(SIDES.map((side) => [side, declarations[`padding-${side}`] ?? shorthand[side] ?? '0px'])) as Padding
}

/** `flex-direction` may be left out for a row, since row is its initial value. */
function directionOf(declarations: Readonly<Record<string, string>>): string {
  return declarations['flex-direction'] ?? 'row'
}

function actionIds(ctx: Context): Array<string | undefined> {
  return ctx.apply.mock.calls.map(([, actionId]) => actionId)
}

function mountShell() {
  document.body.innerHTML = `
    <aside class="left">
      <nav class="layers" aria-label="Layers">
        <input id="layer-search" aria-label="Find layer" />
        <div role="tree" aria-label="Layers">
          <div role="treeitem" tabindex="0" id="layer-row" data-layer-id="row"><span>row</span></div>
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
  return { search: byId('layer-search'), layerRow: byId('layer-row'), shield: byId('shield'), panelButton: byId('panel-button'), widthField: byId('width-field') }
}

let shell = mountShell()

beforeEach(() => {
  shell = mountShell()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Shift-A adds auto layout', () => {
  it('lays a side-by-side container out as a row with the median space as its gap and the children inset as its padding', async () => {
    const target = editor(['row'])

    expect(pressAddAutoLayout(target)).toBe(true)
    await settle()

    const declarations = setDeclarations(target.ctx)
    expect(declarations['display']).toBe('flex')
    expect(directionOf(declarations)).toBe('row')
    expect(declarations['gap']).toBe('12px')
    expect(paddingOf(declarations)).toEqual({ top: '30px', right: '16px', bottom: '30px', left: '20px' })
    expect(writes(target.ctx).every((write) => write.target === 'row')).toBe(true)
  })

  it('lays a stacked container out as a column', async () => {
    const target = editor(['stack'])

    pressAddAutoLayout(target)
    await settle()

    const declarations = setDeclarations(target.ctx)
    expect(declarations['display']).toBe('flex')
    expect(declarations['flex-direction']).toBe('column')
    expect(declarations['gap']).toBe('16px')
    expect(paddingOf(declarations)).toEqual({ top: '24px', right: '76px', bottom: '84px', left: '24px' })
  })

  it('lays a single child out as a row with no gap, padded by its inset', async () => {
    const target = editor(['solo'])

    pressAddAutoLayout(target)
    await settle()

    const declarations = setDeclarations(target.ctx)
    expect(declarations['display']).toBe('flex')
    expect(directionOf(declarations)).toBe('row')
    expect([undefined, '0', '0px']).toContain(declarations['gap'])
    expect(paddingOf(declarations)).toEqual({ top: '20px', right: '60px', bottom: '40px', left: '40px' })
  })

  it('reads every child rect before it writes', async () => {
    const target = editor(['row'])
    const readsAtApply: number[] = []
    target.ctx.apply.mockImplementation(async (op: EditOp) => {
      readsAtApply.push(target.ctx.read.mock.calls.length)
      return ackFor(op)
    })

    pressAddAutoLayout(target)
    await settle()

    const rectReads = target.ctx.read.mock.calls.flatMap(([read]) => (read.kind === 'rects' ? [read.edId] : []))
    expect(rectReads).toEqual(expect.arrayContaining(['r1', 'r2', 'r3', 'r4'].map(edId)))
    expect(readsAtApply.length).toBeGreaterThan(0)
    expect(new Set(readsAtApply)).toEqual(new Set([target.ctx.read.mock.calls.length]))
  })

  it('sends every write under one action id without waiting for an ack', async () => {
    const target = editor(['row'])
    target.ctx.apply.mockImplementation(() => new Promise(() => {}))

    pressAddAutoLayout(target)
    await settle()

    expect(setDeclarations(target.ctx)['display']).toBe('flex')
    expect(paddingOf(setDeclarations(target.ctx))).toEqual({ top: '30px', right: '16px', bottom: '30px', left: '20px' })
    const ids = actionIds(target.ctx)
    expect(ids[0]).toEqual(expect.any(String))
    expect(new Set(ids).size).toBe(1)
  })

  it.each([
    ['the canvas', () => shell.shield],
    ['a layer row', () => shell.layerRow],
  ])('runs from %s', async (_, focused) => {
    const target = editor(['row'])

    expect(pressAddAutoLayout(target, { target: focused() })).toBe(true)
    await settle()

    expect(setDeclarations(target.ctx)['display']).toBe('flex')
  })

  it.each([
    ['a properties-panel button', () => shell.panelButton],
    ['a text field', () => shell.widthField],
    ['the layer search', () => shell.search],
  ])('does nothing from %s', async (_, focused) => {
    const target = editor(['row'])

    expect(pressAddAutoLayout(target, { target: focused() })).toBe(false)
    await settle()

    expect(target.ctx.apply).not.toHaveBeenCalled()
  })

  it('does nothing with an empty selection or while a push holds the lock', async () => {
    const empty = editor([])
    pressAddAutoLayout(empty)
    const locked = editor(['row'])
    locked.store.setReadOnly(true)
    pressAddAutoLayout(locked)
    await settle()

    expect(empty.ctx.apply).not.toHaveBeenCalled()
    expect(locked.ctx.apply).not.toHaveBeenCalled()
  })
})

describe('Alt-Shift-A removes auto layout', () => {
  it.each([
    ['windows', 'A'],
    ['mac', 'Å'],
  ] as const)('removes the flex properties on %s and keeps the rest', async (platform, key) => {
    const target = editor(['flexed'], platform)

    expect(target.press(key, { altKey: true, shiftKey: true }, { code: 'KeyA' })).toBe(true)
    await settle()

    const written = writes(target.ctx)
    expect(written.every((write) => write.value === null && write.target === 'flexed')).toBe(true)
    expect(written.map((write) => write.prop)).toEqual(expect.arrayContaining(FLEX_PROPS))
    expect(written.map((write) => write.prop)).not.toContain('width')
    expect(written.map((write) => write.prop)).not.toContain('background-color')
  })

  it('sends every removal under one action id without waiting for an ack', async () => {
    const target = editor(['flexed'])
    target.ctx.apply.mockImplementation(() => new Promise(() => {}))

    pressRemoveAutoLayout(target)
    await settle()

    expect(writes(target.ctx).map((write) => write.prop)).toEqual(expect.arrayContaining(FLEX_PROPS))
    const ids = actionIds(target.ctx)
    expect(ids[0]).toEqual(expect.any(String))
    expect(new Set(ids).size).toBe(1)
  })

  it('gives Shift-A and Alt-Shift-A their own action ids', async () => {
    const target = editor(['flexed'])

    pressRemoveAutoLayout(target)
    await settle()
    const removal = new Set(actionIds(target.ctx))
    target.ctx.apply.mockClear()
    target.store.select([edId('row')])
    pressAddAutoLayout(target)
    await settle()
    const addition = new Set(actionIds(target.ctx))

    expect(removal.size).toBe(1)
    expect(addition.size).toBe(1)
    expect([...removal][0]).toEqual(expect.any(String))
    expect([...removal][0]).not.toBe([...addition][0])
  })

  it('does nothing while a push holds the lock', async () => {
    const target = editor(['flexed'])
    target.store.setReadOnly(true)

    pressRemoveAutoLayout(target)
    await settle()

    expect(target.ctx.apply).not.toHaveBeenCalled()
  })
})
