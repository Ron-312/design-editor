/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult } from '../../src/shared/protocol'
import type { AuthoredDeclaration, EdId, EditOp, ElementLocation, ProjectPath, StyleSource, TemplateNode } from '../../src/shared/types'
import { createDefaultRegistry, type Platform } from '../../src/ui/actions/registry'
import { writeClipboardText } from '../../src/ui/clipboard'
import type { AckMessage, EditorContext } from '../../src/ui/plugin-api'

const edId = (id: string) => id as EdId
const board = 'project/home.dc.html' as ProjectPath

const BRIEF = '<div class="col" style="width: 240px; padding: 16px; color: red !important">Brief</div>'
const SKETCHES = '<div class="col" style="width: 360px; padding: 16px">Sketches</div>'
const SOURCE = [
  '<x-dc>',
  '  <main class="page">',
  '    <section class="row">',
  `      ${BRIEF}`,
  `      ${SKETCHES}`,
  '    </section>',
  '  </main>',
  '</x-dc>',
  '',
].join('\n')

function node(id: string, tag: string, children: TemplateNode[] = []): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children }
}

const tree = node('root', 'x-dc', [node('main', 'main', [node('row', 'section', [node('brief', 'div'), node('sketches', 'div')])])])

function locationOf(element: string): ElementLocation {
  const start = SOURCE.indexOf(element)
  if (start < 0) throw new Error(`the source holds no ${element}`)
  return { file: board, element: { start, end: start + element.length }, startTag: { start, end: SOURCE.indexOf('>', start) + 1 }, attrs: {} }
}

function decl(prop: string, value: string, important = false): AuthoredDeclaration {
  return { prop, value, important, hasHole: false }
}

function inline(declarations: readonly AuthoredDeclaration[]): StyleSource[] {
  return [{ target: 'inline', file: board, line: 4, range: { start: 0, end: 0 }, declarations }]
}

const index: BoardIndex = {
  board,
  frameSrc: `/project/secret/${board}`,
  tree,
  text: SOURCE,
  locations: { brief: locationOf(BRIEF), sketches: locationOf(SKETCHES) } as BoardIndex['locations'],
  styles: {
    brief: inline([decl('width', '240px'), decl('padding', '16px'), decl('color', 'red', true)]),
    sketches: inline([decl('width', '360px'), decl('padding', '16px')]),
  } as BoardIndex['styles'],
  rules: [],
}

const editorState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function answer(read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'computed':
      return { kind: 'computed', values: { display: 'block', 'font-family': 'Inter, sans-serif', margin: '0px' } }
    case 'rects':
      return { kind: 'rects', rects: [] }
    case 'hitTest':
      return { kind: 'hitTest', edId: null }
    case 'snapRects':
      return { kind: 'snapRects', self: { x: 0, y: 0, width: 0, height: 0 }, parent: null, siblings: [] }
    case 'supports':
      return { kind: 'supports', supported: true }
    case 'matches':
      return { kind: 'matches', matched: read.selectors.map(() => false) }
    case 'documentHeight':
      return { kind: 'documentHeight', scrollHeight: 0 }
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

function contextFor(selection: readonly string[]) {
  let actions = 0
  return {
    index: () => index,
    selection: () => ({ board, edIds: selection.map(edId) }),
    viewport: () => ({ zoom: 1, panX: 0, panY: 0 }),
    editorState: () => editorState,
    readOnly: () => false,
    select: vi.fn(),
    setViewport: vi.fn(),
    apply: vi.fn(async (op: EditOp) => ackFor(op)),
    beginAction: vi.fn(() => `action-${++actions}`),
    preview: vi.fn(),
    setMode: vi.fn(),
    fit: vi.fn(),
    cancelGesture: vi.fn(() => false),
    setEditorState: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    read: <R extends ProbeRead>(read: R) => Promise.resolve(answer(read)) as Promise<Extract<ProbeReadResult, { kind: R['kind'] }>>,
    records: () => [],
    toast: vi.fn(),
    onChange: () => () => {},
  } satisfies EditorContext
}

type Modifiers = Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'code'>>

function press(platform: Platform, ctx: EditorContext, key: string, modifiers: Modifiers): boolean {
  const event = { key, code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers, preventDefault: vi.fn() }
  return createDefaultRegistry(platform).handleKeyDown(event as unknown as KeyboardEvent, ctx)
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>

beforeEach(() => {
  writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function written(): string[] {
  return writeText.mock.calls.map(([text]) => text)
}

/** Elements joined by any whitespace read the same as elements written back to back. */
function withoutWhitespaceBetweenTags(html: string): string {
  return html.trim().replace(/>\s+</g, '><')
}

describe('the clipboard text writer', () => {
  it('writes the text with the async Clipboard API', async () => {
    await writeClipboardText('.page { padding: 48px; }')

    expect(written()).toEqual(['.page { padding: 48px; }'])
  })
})

describe('Copy as CSS', () => {
  it.each([
    ['windows', 'C', { ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyC' }],
    ['mac', 'Ç', { metaKey: true, altKey: true, shiftKey: true, code: 'KeyC' }],
  ] as const)('Mod+Alt+Shift+C on %s writes the authored declarations as a CSS block', async (platform, key, modifiers) => {
    const ctx = contextFor(['brief'])

    expect(press(platform, ctx, key, modifiers)).toBe(true)
    await settle()

    expect(written()).toHaveLength(1)
    expect(written()[0]).toMatch(/width:\s*240px;[\s\S]*padding:\s*16px;[\s\S]*color:\s*red\s*!important;/)
  })

  it('writes only what is authored, never computed values or another layer', async () => {
    const ctx = contextFor(['brief'])

    press('windows', ctx, 'C', { ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyC' })
    await settle()

    expect(written()[0]).not.toMatch(/display|font-family|margin|360px/)
  })

  it('writes nothing with nothing selected', async () => {
    const ctx = contextFor([])

    press('windows', ctx, 'C', { ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyC' })
    await settle()

    expect(writeText).not.toHaveBeenCalled()
  })

  it('is listed for the command palette', () => {
    const labels = createDefaultRegistry('windows').all().map((action) => action.label)

    expect(labels).toContain('Copy as CSS')
  })

  it('never edits the source', async () => {
    const ctx = contextFor(['brief'])

    press('windows', ctx, 'C', { ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyC' })
    await settle()

    expect(ctx.apply).not.toHaveBeenCalled()
  })
})

describe('Copy as HTML', () => {
  function copyAsHtml() {
    const registry = createDefaultRegistry('windows')
    const action = registry.all().find((entry) => entry.label === 'Copy as HTML')
    if (!action) throw new Error('no Copy as HTML action is registered')
    return { action, registry }
  }

  it('is a palette action with no shortcut', () => {
    const { action, registry } = copyAsHtml()

    expect(registry.shortcutOf(action.id)).toBeUndefined()
  })

  it("writes the selected elements' source text in document order with the async Clipboard API", async () => {
    const { action } = copyAsHtml()
    const ctx = contextFor(['sketches', 'brief'])

    action.run(ctx, 'action-1')
    await settle()

    expect(written()).toHaveLength(1)
    expect(withoutWhitespaceBetweenTags(written()[0]!)).toBe(`${BRIEF}${SKETCHES}`)
    expect(written()[0]).not.toContain('data-ed-id')
    expect(ctx.apply).not.toHaveBeenCalled()
  })

  it('is disabled with nothing selected', () => {
    const { action } = copyAsHtml()

    expect(action.when?.(contextFor([])) ?? true).toBe(false)
  })
})
