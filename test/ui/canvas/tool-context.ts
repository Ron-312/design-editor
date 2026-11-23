import { vi } from 'vitest'
import type { BoardIndex, ProbeRead, ProbeReadResult, Rect } from '../../../src/shared/protocol'
import type { AuthoredDeclaration, EdId, EditOp, ProjectPath, StyleSource, TemplateNode } from '../../../src/shared/types'
import type { AckMessage, CanvasPointer, EditorContext, Viewport } from '../../../src/ui/plugin-api'

export const board = 'project/home.dc.html' as ProjectPath

export const edId = (id: string) => id as EdId

export function node(id: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag: 'div', name: id, children, ...extra }
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height }
}

function decl(prop: string, value: string): AuthoredDeclaration {
  return { prop, value, important: false, hasHole: false }
}

export function inline(declarations: Readonly<Record<string, string>>): StyleSource[] {
  return [{ target: 'inline', file: board, line: 1, range: { start: 0, end: 0 }, declarations: Object.entries(declarations).map(([prop, value]) => decl(prop, value)) }]
}

export interface Scene {
  readonly tree: TemplateNode
  readonly rects: Record<string, Rect[]>
  readonly computed?: Record<string, Readonly<Record<string, string>>>
  readonly styles?: Record<string, readonly StyleSource[]>
  readonly snap?: Record<string, { readonly parent: Rect | null; readonly siblings: readonly Rect[] }>
  readonly hit?: (x: number, y: number) => string | null
}

export interface ContextOptions {
  readonly selection?: readonly string[]
  readonly viewport?: Viewport
  readonly readOnly?: boolean
}

type ReadKind = ProbeRead['kind']

/** What the fake probe answers, and which kinds of read reject as a reload would. */
function answer(scene: Scene, read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'rects':
      return { kind: 'rects', rects: scene.rects[read.edId] ?? [] }
    case 'computed': {
      const values = scene.computed?.[read.edId] ?? {}
      return { kind: 'computed', values: Object.fromEntries(read.props.flatMap((prop) => (prop in values ? [[prop, values[prop]!]] : []))) }
    }
    case 'hitTest':
      return { kind: 'hitTest', edId: (scene.hit?.(read.x, read.y) ?? null) as EdId | null }
    case 'snapRects': {
      const snap = scene.snap?.[read.edId] ?? { parent: null, siblings: [] }
      return { kind: 'snapRects', self: scene.rects[read.edId]?.[0] ?? rect(0, 0, 0, 0), ...snap }
    }
    case 'supports':
      return { kind: 'supports', supported: true }
    case 'matches':
      return { kind: 'matches', matched: read.selectors.map(() => false) }
    case 'documentHeight':
      return { kind: 'documentHeight', scrollHeight: 0 }
  }
}

export function ackFor(op: EditOp, warnings: readonly string[] = []): AckMessage {
  return {
    type: 'ack',
    opId: 'op-1',
    record: { target: op.target, kind: op.kind, prop: null, before: null, after: null, scope: { kind: 'element' }, files: [board] },
    mintedIds: [],
    locations: {},
    resolved: {},
    reload: false,
    warnings: [...warnings],
  }
}

export function fakeContext(scene: Scene, options: ContextOptions = {}) {
  const listeners = new Set<() => void>()
  const failing = new Set<ReadKind>()
  let selection = (options.selection ?? []).map(edId)
  let readOnly = options.readOnly ?? false
  const viewport = options.viewport ?? { zoom: 1, panX: 0, panY: 0 }
  const index: BoardIndex = { board, frameSrc: `/project/s/${board}`, tree: scene.tree, text: '', locations: {}, styles: scene.styles ?? {}, rules: [] }

  const ctx = {
    index: vi.fn(() => index),
    selection: vi.fn(() => ({ board, edIds: selection })),
    viewport: vi.fn(() => viewport),
    editorState: vi.fn(() => ({ hidden: [], locked: [], collapsed: [], boards: {} })),
    readOnly: vi.fn(() => readOnly),
    select: vi.fn(),
    setViewport: vi.fn(),
    apply: vi.fn(async (op: EditOp) => ackFor(op)),
    undo: vi.fn(),
    redo: vi.fn(),
    read: vi.fn(async (read: ProbeRead) => {
      if (failing.has(read.kind)) throw new Error('reloaded')
      return answer(scene, read)
    }),
    records: vi.fn(() => []),
    toast: vi.fn(),
    onChange: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }

  return {
    ctx: ctx as typeof ctx & EditorContext,
    /** Makes reads of these kinds reject, as reads in flight do when the frame reloads. */
    failReads(...kinds: ReadKind[]) {
      for (const kind of kinds) failing.add(kind)
    },
    select(...ids: string[]) {
      selection = ids.map(edId)
      for (const listener of listeners) listener()
    },
    setReadOnly(value: boolean) {
      readOnly = value
    },
    reads(kind: ReadKind): ProbeRead[] {
      return ctx.read.mock.calls.map(([read]) => read).filter((read) => read.kind === kind)
    },
    ops(): EditOp[] {
      return ctx.apply.mock.calls.map(([op]) => op)
    },
    /** Each `setDecl` written, as `prop: value`. */
    writes(): string[] {
      return ctx.apply.mock.calls.flatMap(([op]) => (op.kind === 'setDecl' ? [`${op.payload.prop}: ${op.payload.value}`] : []))
    },
  }
}

export type FakeContext = ReturnType<typeof fakeContext>

export interface Modifiers {
  readonly altKey?: boolean
  readonly shiftKey?: boolean
  readonly modKey?: boolean
  readonly ctrlKey?: boolean
}

/** A pointer at a board point, with its screen point under `viewport`. */
export function pointerAt(viewport: Viewport, boardX: number, boardY: number, modifiers: Modifiers = {}): CanvasPointer {
  return {
    x: viewport.panX + boardX * viewport.zoom,
    y: viewport.panY + boardY * viewport.zoom,
    boardX,
    boardY,
    altKey: false,
    shiftKey: false,
    modKey: false,
    ctrlKey: false,
    ...modifiers,
  }
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The canvas viewport the tools draw their overlay layers into. */
export function mountViewport(): HTMLElement {
  const viewport = document.createElement('div')
  viewport.setAttribute('data-canvas-viewport', '')
  document.body.append(viewport)
  return viewport
}

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export function boxOf(element: Element): Box {
  const style = (element as HTMLElement).style
  const px = (value: string) => Number.parseFloat(value)
  return { left: px(style.left), top: px(style.top), width: px(style.width), height: px(style.height) }
}

export function layer(viewport: HTMLElement, name: string): Element[] {
  return [...(viewport.querySelector(`[data-tool-layer="${name}"]`)?.children ?? [])]
}
