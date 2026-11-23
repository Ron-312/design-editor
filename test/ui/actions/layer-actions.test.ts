/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult } from '../../../src/shared/protocol'
import type { AuthoredDeclaration, EdId, EditOp, ProjectPath, StyleSource, TemplateNode } from '../../../src/shared/types'
import { createDefaultRegistry, type Platform } from '../../../src/ui/actions/registry'
import type { AckMessage, EditorContext } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'

const edId = (id: string) => id as EdId
const board = 'project/home.dc.html' as ProjectPath

function node(id: string, tag: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children, ...extra }
}

// root > row > a, b, wrapper > inner; card; other; third
const tree = node(
  'root',
  'x-dc',
  [
    node('row', 'section', [node('a', 'div'), node('b', 'div'), node('wrapper', 'div', [node('inner', 'span')])]),
    node('card', 'div'),
    node('other', 'div'),
    node('third', 'div'),
  ],
  { readOnly: 'artboard-root' },
)

function decl(prop: string, value: string): AuthoredDeclaration {
  return { prop, value, important: false, hasHole: false }
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
const COMPUTED = {
  display: 'block',
  position: 'static',
  'background-color': 'rgb(26, 115, 232)',
  color: 'rgb(255, 247, 237)',
  'border-top-left-radius': '12px',
  'font-size': '14px',
  'font-family': 'Inter, sans-serif',
  'line-height': 'normal',
  margin: '0px',
  width: '240px',
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

const editorState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function answer(read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'computed':
      return { kind: 'computed', values: { ...COMPUTED } }
    case 'rects':
      return { kind: 'rects', rects: [{ x: 0, y: 0, width: 240, height: 40 }] }
    case 'hitTest':
      return { kind: 'hitTest', edId: null }
    case 'snapRects':
      return { kind: 'snapRects', self: { x: 0, y: 0, width: 240, height: 40 }, parent: null, siblings: [] }
    case 'supports':
      return { kind: 'supports', supported: true }
  }
}

function contextFor(store: EditorStore) {
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
    undo: vi.fn(),
    redo: vi.fn(),
    read: <R extends ProbeRead>(read: R) => Promise.resolve(answer(read)) as Promise<Extract<ProbeReadResult, { kind: R['kind'] }>>,
    records: () => store.getState().records,
    toast: vi.fn(),
    onChange: (listener) => store.subscribe(listener),
  } satisfies EditorContext
}

type Context = ReturnType<typeof contextFor>

interface Editor {
  readonly store: EditorStore
  readonly ctx: Context
  readonly press: (key: string, modifiers?: Modifiers) => boolean
}

type Modifiers = Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>>

function editor(selection: readonly string[], platform: Platform = 'windows'): Editor {
  const store = createEditorStore()
  store.setBoard(board)
  const index: BoardIndex = { board, frameSrc: `/project/secret/${board}`, tree, locations: {}, styles: styles as BoardIndex['styles'] }
  store.setIndex(index)
  store.select(selection.map(edId))
  const ctx = contextFor(store)
  const registry = createDefaultRegistry(platform)
  const press = (key: string, modifiers: Modifiers = {}) => {
    const event = { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers, preventDefault: vi.fn() }
    return registry.handleKeyDown(event as unknown as KeyboardEvent, ctx)
  }
  return { store, ctx, press }
}

/** Mod is Ctrl on Windows, the platform these tests press keys on unless they say otherwise. */
const MOD = { ctrlKey: true }

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function ops(ctx: Context): EditOp[] {
  return ctx.apply.mock.calls.map(([op]) => op)
}

function toastMessages(ctx: Context): string[] {
  return ctx.toast.mock.calls.map(([toast]) => toast.message)
}

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
    const { ctx, press } = editor(['a'], 'mac')

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

describe('hide and lock', () => {
  it.each([
    ['windows', { ctrlKey: true }],
    ['mac', { metaKey: true }],
  ] as const)('Mod+Shift+H and Mod+Shift+L are bound on %s and never write the source', async (platform, mod) => {
    const { ctx, press } = editor(['a'], platform)

    expect(press('h', { ...mod, shiftKey: true })).toBe(true)
    expect(press('l', { ...mod, shiftKey: true })).toBe(true)
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
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
