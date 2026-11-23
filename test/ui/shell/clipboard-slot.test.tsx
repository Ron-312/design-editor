// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, HelmetRuleSource, ProbeRead, ProbeReadResult } from '../../../src/shared/protocol'
import type { EdId, EditOp, ElementLocation, ProjectPath, RuleId, TemplateNode } from '../../../src/shared/types'
import { createDefaultRegistry } from '../../../src/ui/actions/registry'
import type { AckMessage, EditorContext, ShellSlot } from '../../../src/ui/plugin-api'
import { slots } from '../../../src/ui/shell/clipboard.slot'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const PRIVATE_TYPE = 'application/x-design-editor+html'
const edId = (id: string) => id as EdId
const board = 'project/home.dc.html' as ProjectPath

const LEDE = '<p class="lede">Made with <strong>care</strong></p>'
const BRIEF = '<div class="col" style="width: 240px; padding: 16px">Brief</div>'
const SKETCHES = '<div class="col" style="width: 360px; padding: 16px">Sketches</div>'
const EMPTY = '<div class="empty"></div>'
const MARK = '<img src="mark.png" alt="">'
const SOURCE = [
  '<x-dc>',
  '  <main class="page">',
  `    ${LEDE}`,
  '    <section class="row" style="display: flex; gap: 16px">',
  `      ${BRIEF}`,
  `      ${SKETCHES}`,
  '    </section>',
  `    ${EMPTY}`,
  `    ${MARK}`,
  '  </main>',
  '</x-dc>',
  '',
].join('\n')

function node(id: string, tag: string, children: TemplateNode[] = []): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children }
}

// root > main > lede > strong; row > brief, sketches; empty; mark
const MAIN_CHILDREN = [
  node('lede', 'p', [node('strong', 'strong')]),
  node('row', 'section', [node('brief', 'div'), node('sketches', 'div')]),
  node('empty', 'div'),
  node('mark', 'img'),
]
const tree = node('root', 'x-dc', [node('main', 'main', MAIN_CHILDREN)])

/** The range from `opening` to the end of the first `closing` after it. */
function locationIn(text: string, opening: string, closing: string): ElementLocation {
  const start = text.indexOf(opening)
  if (start < 0) throw new Error(`the source holds no ${opening}`)
  const end = text.indexOf(closing, start) + closing.length
  return { file: board, element: { start, end }, startTag: { start, end: text.indexOf('>', start) + 1 }, attrs: {} }
}

function locationsIn(text: string): Record<string, ElementLocation> {
  return {
    root: locationIn(text, '<x-dc>', '</x-dc>'),
    main: locationIn(text, '<main', '</main>'),
    lede: locationIn(text, LEDE, LEDE),
    strong: locationIn(text, '<strong>', '</strong>'),
    row: locationIn(text, '<section', '</section>'),
    brief: locationIn(text, BRIEF, BRIEF),
    sketches: locationIn(text, SKETCHES, SKETCHES),
    empty: locationIn(text, EMPTY, EMPTY),
    mark: locationIn(text, MARK, MARK),
  }
}

function rule(selector: string): HelmetRuleSource {
  return { target: `rule-${selector}` as RuleId, selector, media: null, file: board, line: 1, range: { start: 0, end: 0 }, declarations: [] }
}

function boardIndex(rules: readonly HelmetRuleSource[] = []): BoardIndex {
  return { board, frameSrc: `/project/secret/${board}`, tree, text: SOURCE, locations: locationsIn(SOURCE), styles: {}, rules }
}

const editorState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function answer(read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'computed':
      return { kind: 'computed', values: {} }
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
    case 'rootFontSize':
      return { kind: 'rootFontSize', fontSize: 16 }
  }
}

function ackFor(op: EditOp, extra: Partial<AckMessage> = {}): AckMessage {
  return {
    type: 'ack',
    opId: 'op-1',
    record: { target: op.target, kind: op.kind, prop: null, before: null, after: null, scope: { kind: 'element' }, files: [board] },
    mintedIds: [],
    locations: {},
    resolved: {},
    reload: true,
    warnings: [],
    ...extra,
  }
}

function fakeEditor(selection: readonly string[], rules: readonly HelmetRuleSource[] = []) {
  const listeners = new Set<() => void>()
  let selected = selection.map(edId)
  let index = boardIndex(rules)
  let actions = 0
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const ctx = {
    index: () => index,
    selection: () => ({ board, edIds: selected }),
    viewport: () => ({ zoom: 1, panX: 0, panY: 0 }),
    editorState: () => editorState,
    readOnly: () => false,
    select: vi.fn((edIds: readonly EdId[]) => {
      selected = [...edIds]
      notify()
    }),
    setViewport: vi.fn(),
    apply: vi.fn(async (op: EditOp, _actionId?: string) => ackFor(op)),
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
    onChange: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } satisfies EditorContext
  return {
    ctx,
    selectOnly(...ids: string[]) {
      selected = ids.map(edId)
      notify()
    },
    /** The server re-sends the index after the ack, as its own message. */
    reindex(next: BoardIndex) {
      setTimeout(() => {
        index = next
        notify()
      }, 0)
    },
    ops(): EditOp[] {
      return ctx.apply.mock.calls.map(([op]) => op)
    },
    toasts(): string[] {
      return ctx.toast.mock.calls.map(([toast]) => toast.message)
    },
  }
}

type FakeEditor = ReturnType<typeof fakeEditor>

/** jsdom has no DataTransfer, so the events carry this stand-in. */
class FakeClipboardData {
  private readonly entries = new Map<string, string>()

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [type, value] of Object.entries(initial)) this.entries.set(type, value)
  }

  get types(): string[] {
    return [...this.entries.keys()]
  }

  readonly setData = vi.fn((type: string, value: string) => {
    this.entries.set(type, value)
  })

  readonly getData = (type: string): string => this.entries.get(type) ?? ''

  readonly clearData = () => this.entries.clear()
}

interface Page {
  readonly viewport: HTMLElement
  readonly layerRow: HTMLElement
  readonly field: HTMLInputElement
}

let mounted: { root: Root; container: HTMLElement; page: HTMLElement } | null = null

const asyncClipboard = { writeText: vi.fn(), write: vi.fn(), readText: vi.fn(), read: vi.fn() }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  for (const method of Object.values(asyncClipboard)) method.mockReset()
  Object.defineProperty(navigator, 'clipboard', { value: asyncClipboard, configurable: true })
})

afterEach(() => {
  if (mounted) {
    const { root, container, page } = mounted
    act(() => root.unmount())
    container.remove()
    page.remove()
    mounted = null
  }
})

function mount(editor: FakeEditor): Page {
  const page = document.createElement('div')
  page.innerHTML = `
    <div data-canvas-viewport="" class="canvas" tabindex="0" aria-label="Canvas"></div>
    <nav class="layers" aria-label="Layers"><div role="treeitem" tabindex="0" data-layer-id="brief">Brief</div></nav>
    <aside class="props"><input aria-label="width"></aside>`
  document.body.append(page)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const registry = createDefaultRegistry('windows')
  act(() =>
    root.render(
      <>
        {slots.map(({ id, component: Slot }: ShellSlot) => (
          <Slot key={id} ctx={editor.ctx} registry={registry} platform="windows" probe={null} />
        ))}
      </>,
    ),
  )
  mounted = { root, container, page }
  return {
    viewport: page.querySelector<HTMLElement>('[data-canvas-viewport]')!,
    layerRow: page.querySelector<HTMLElement>('[role="treeitem"]')!,
    field: page.querySelector<HTMLInputElement>('input')!,
  }
}

function fire(kind: 'copy' | 'cut' | 'paste', focused: HTMLElement, data = new FakeClipboardData()) {
  focused.focus()
  const event = new Event(kind, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: data })
  act(() => {
    focused.dispatchEvent(event)
  })
  return { event, data }
}

/** Copies one layer, so the editor's last copy is known whatever earlier tests copied. */
function copyLayer(editor: FakeEditor, focused: HTMLElement, id: string) {
  editor.selectOnly(id)
  return fire('copy', focused)
}

function pasteOf(html: string, focused: HTMLElement) {
  return fire('paste', focused, new FakeClipboardData({ 'text/html': html, 'text/plain': html }))
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Elements joined by any whitespace read the same as elements written back to back. */
function withoutWhitespaceBetweenTags(html: string): string {
  return html.trim().replace(/>\s+</g, '><')
}

function inserts(editor: FakeEditor) {
  return editor.ops().filter((op) => op.kind === 'insertHtml')
}

function expectOneInsert(editor: FakeEditor, target: string, before: string | null, html: string) {
  const sent = inserts(editor)
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({ target: [edId(target)], kind: 'insertHtml', payload: { before: before === null ? null : edId(before), html } })
}

describe('copy', () => {
  it.each(['viewport', 'layerRow'] as const)(
    "puts the selected elements' source text on the clipboard as HTML, plain text and the private type when focus is on the %s",
    (where) => {
      const editor = fakeEditor(['sketches', 'brief'])
      const page = mount(editor)

      const { event, data } = fire('copy', page[where])

      expect(event.defaultPrevented).toBe(true)
      const html = data.getData('text/html')
      expect(withoutWhitespaceBetweenTags(html)).toBe(`${BRIEF}${SKETCHES}`)
      expect(data.getData('text/plain')).toBe(html)
      expect(data.getData(PRIVATE_TYPE)).toBe(html)
      expect(html).not.toContain('data-ed-id')
    },
  )

  it('keeps a nested element exactly as the source writes it', () => {
    const editor = fakeEditor(['lede'])
    const page = mount(editor)

    const { data } = fire('copy', page.viewport)

    expect(data.getData('text/html').trim()).toBe(LEDE)
  })

  it('leaves a copy in a text field to the browser', () => {
    const editor = fakeEditor(['brief'])
    const page = mount(editor)

    const { event, data } = fire('copy', page.field)

    expect(event.defaultPrevented).toBe(false)
    expect(data.setData).not.toHaveBeenCalled()
  })

  it('puts nothing on the clipboard with nothing selected', () => {
    const editor = fakeEditor([])
    const page = mount(editor)

    const { data } = fire('copy', page.viewport)

    expect(data.setData).not.toHaveBeenCalled()
  })

  it('never uses the async Clipboard API', async () => {
    const editor = fakeEditor(['brief'])
    const page = mount(editor)

    fire('copy', page.viewport)
    fire('cut', page.viewport)
    pasteOf(BRIEF, page.viewport)
    await settle()

    for (const method of Object.values(asyncClipboard)) expect(method).not.toHaveBeenCalled()
  })
})

describe('cut', () => {
  it('copies the selection, then deletes it in one op', async () => {
    const editor = fakeEditor(['brief', 'sketches'])
    const page = mount(editor)

    const { event, data } = fire('cut', page.layerRow)
    await settle()

    expect(event.defaultPrevented).toBe(true)
    expect(withoutWhitespaceBetweenTags(data.getData(PRIVATE_TYPE))).toBe(`${BRIEF}${SKETCHES}`)
    expect(editor.ops()).toHaveLength(1)
    expect(editor.ops()[0]).toMatchObject({ target: [edId('brief'), edId('sketches')], kind: 'deleteNode', payload: {} })
  })

  it('deletes nothing when the cut comes from a text field', async () => {
    const editor = fakeEditor(['brief'])
    const page = mount(editor)

    fire('cut', page.field)
    await settle()

    expect(editor.ctx.apply).not.toHaveBeenCalled()
  })
})

describe('paste', () => {
  it('prefers the private type over the HTML other apps write', async () => {
    const editor = fakeEditor([])
    const page = mount(editor)

    const { event } = fire('paste', page.viewport, new FakeClipboardData({ 'text/html': '<b>other app</b>', [PRIVATE_TYPE]: BRIEF }))
    await settle()

    expect(event.defaultPrevented).toBe(true)
    expectOneInsert(editor, 'root', null, BRIEF)
  })

  it('takes the HTML when the private type is absent', async () => {
    const editor = fakeEditor([])
    const page = mount(editor)

    pasteOf(SKETCHES, page.layerRow)
    await settle()

    expectOneInsert(editor, 'root', null, SKETCHES)
  })

  it('appends to the artboard root with nothing selected', async () => {
    const editor = fakeEditor([])
    const page = mount(editor)

    pasteOf(BRIEF, page.viewport)
    await settle()

    expectOneInsert(editor, 'root', null, BRIEF)
  })

  it('leaves a paste into a text field to the browser', async () => {
    const editor = fakeEditor(['empty'])
    const page = mount(editor)

    const { event } = pasteOf(BRIEF, page.field)
    await settle()

    expect(event.defaultPrevented).toBe(false)
    expect(editor.ctx.apply).not.toHaveBeenCalled()
  })

  it('inserts after the copied element when that element is selected', async () => {
    const editor = fakeEditor(['brief'])
    const page = mount(editor)

    const { data } = fire('copy', page.viewport)
    fire('paste', page.viewport, data)
    await settle()

    expectOneInsert(editor, 'row', 'sketches', data.getData(PRIVATE_TYPE))
  })

  it('inserts after a selected element that contains the copied one', async () => {
    const editor = fakeEditor([])
    const page = mount(editor)

    const { data } = copyLayer(editor, page.viewport, 'brief')
    editor.selectOnly('row')
    fire('paste', page.viewport, data)
    await settle()

    expectOneInsert(editor, 'main', 'empty', data.getData(PRIVATE_TYPE))
  })

  it('appends inside the one selected element when it can hold the fragment', async () => {
    const editor = fakeEditor([])
    const page = mount(editor)

    const { data } = copyLayer(editor, page.viewport, 'brief')
    editor.selectOnly('empty')
    fire('paste', page.viewport, data)
    await settle()

    expectOneInsert(editor, 'empty', null, data.getData(PRIVATE_TYPE))
  })

  it('appends inside the one selected element when the last copy came from elsewhere', async () => {
    const editor = fakeEditor([])
    const page = mount(editor)

    copyLayer(editor, page.viewport, 'mark')
    editor.selectOnly('row')
    pasteOf(BRIEF, page.viewport)
    await settle()

    expectOneInsert(editor, 'row', null, BRIEF)
  })

  it('inserts after a selected <p>, which cannot hold a <div>', async () => {
    const editor = fakeEditor(['lede'])
    const page = mount(editor)

    pasteOf(BRIEF, page.viewport)
    await settle()

    expectOneInsert(editor, 'main', 'row', BRIEF)
  })

  it('appends phrasing content inside a selected <p>', async () => {
    const editor = fakeEditor([])
    const page = mount(editor)

    copyLayer(editor, page.viewport, 'mark')
    editor.selectOnly('lede')
    pasteOf('<em>coffee</em>', page.viewport)
    await settle()

    expectOneInsert(editor, 'lede', null, '<em>coffee</em>')
  })

  it('inserts after a selected void element, as the last child when nothing follows it', async () => {
    const editor = fakeEditor(['mark'])
    const page = mount(editor)

    pasteOf(BRIEF, page.viewport)
    await settle()

    expectOneInsert(editor, 'main', null, BRIEF)
  })

  it('inserts a list item after a selected <div>, which cannot hold it', async () => {
    const editor = fakeEditor(['empty'])
    const page = mount(editor)

    pasteOf('<li>Moodboard review</li>', page.viewport)
    await settle()

    expectOneInsert(editor, 'main', 'mark', '<li>Moodboard review</li>')
  })

  it('inserts after the last selected element when several are selected', async () => {
    const editor = fakeEditor(['lede', 'empty'])
    const page = mount(editor)

    pasteOf(BRIEF, page.viewport)
    await settle()

    expectOneInsert(editor, 'main', 'mark', BRIEF)
  })

  it('appends to the selected artboard root when the root holds the last copy', async () => {
    const editor = fakeEditor([])
    const page = mount(editor)

    const { data } = copyLayer(editor, page.viewport, 'brief')
    editor.selectOnly('root')
    fire('paste', page.viewport, data)
    await settle()

    expectOneInsert(editor, 'root', null, data.getData(PRIVATE_TYPE))
  })

  it('appends to the selected artboard root even when it cannot hold the fragment, for the server to judge', async () => {
    const editor = fakeEditor(['root'])
    const page = mount(editor)

    pasteOf('<td>x</td>', page.viewport)
    await settle()

    expectOneInsert(editor, 'root', null, '<td>x</td>')
  })

  it.each(['style', 'script', 'textarea', 'title'])('inserts after a selected <%s>, whose content is not markup', async (tag) => {
    const element = `<${tag}>x</${tag}>`
    const text = SOURCE.replace('</x-dc>', `  ${element}\n  ${EMPTY.replace('empty', 'tail')}\n</x-dc>`)
    const editor = fakeEditor([])
    editor.reindex({
      ...boardIndex(),
      tree: node('root', 'x-dc', [node('main', 'main', MAIN_CHILDREN), node('raw', tag), node('tail', 'div')]),
      text,
      locations: { ...locationsIn(text), raw: locationIn(text, element, element), tail: locationIn(text, '<div class="tail">', '</div>') } as BoardIndex['locations'],
    })
    const page = mount(editor)
    await settle()

    editor.selectOnly('raw')
    pasteOf('fetch(1)', page.viewport)
    await settle()

    expectOneInsert(editor, 'root', 'tail', 'fetch(1)')
  })

  it('selects the pasted top-level elements, not their descendants', async () => {
    const editor = fakeEditor([])
    const page = mount(editor)
    const fragment = '<div class="col"><span class="tag">New</span></div><p class="note">Hi</p>'
    const pasted = SOURCE.replace('</x-dc>', `  ${fragment}\n</x-dc>`)
    const locations: Record<string, ElementLocation> = {
      ...locationsIn(pasted),
      n1: locationIn(pasted, '<div class="col"><span', '</span></div>'),
      n2: locationIn(pasted, '<span class="tag">', '</span>'),
      n3: locationIn(pasted, '<p class="note">', '</p>'),
    }
    const pastedTree = node('root', 'x-dc', [node('main', 'main', MAIN_CHILDREN), node('n1', 'div', [node('n2', 'span')]), node('n3', 'p')])
    editor.ctx.apply.mockImplementation(async (op: EditOp) => {
      editor.reindex({ ...boardIndex(), tree: pastedTree, text: pasted, locations })
      return ackFor(op, {
        mintedIds: [edId('n1'), edId('n2'), edId('n3')],
        locations: { root: locations.root!, n1: locations.n1!, n2: locations.n2!, n3: locations.n3! } as AckMessage['locations'],
      })
    })

    pasteOf(fragment, page.viewport)
    await settle()

    expect(editor.ctx.select).toHaveBeenLastCalledWith([edId('n1'), edId('n3')])
  })

  it('shows one toast naming the reason when the server refuses the paste', async () => {
    const reason = 'a <script> cannot be pasted'
    const editor = fakeEditor(['empty'])
    // As the ws client does: it toasts the server's refusal, then rejects the op.
    editor.ctx.apply.mockImplementation(async () => {
      editor.ctx.toast({ message: reason, tone: 'error' })
      throw new Error(reason)
    })
    const page = mount(editor)

    pasteOf('<script>alert(1)</script>', page.viewport)
    await settle()

    expect(inserts(editor)).toHaveLength(1)
    expect(editor.toasts().filter((message) => message.includes(reason))).toHaveLength(1)
    expect(editor.ctx.select).not.toHaveBeenCalled()
  })

  it('lists, in one toast, the pasted classes no rule of this board names, and still pastes', async () => {
    const rules = [rule('.col'), rule('section.row > .card-wide:hover'), rule('.page .badge')]
    const editor = fakeEditor([], rules)
    const page = mount(editor)
    const fragment = '<div class="col card"><span class="badge tag">New</span></div>'

    pasteOf(fragment, page.viewport)
    await settle()

    expectOneInsert(editor, 'root', null, fragment)
    const listing = editor.toasts().filter((message) => /\bcard\b/.test(message) || /\btag\b/.test(message))
    expect(listing).toHaveLength(1)
    expect(listing[0]).toMatch(/\bcard\b/)
    expect(listing[0]).toMatch(/\btag\b/)
    expect(listing[0]).not.toMatch(/\bcol\b|\bbadge\b/)
  })

  it('shows no class toast when every pasted class has a rule on this board', async () => {
    const editor = fakeEditor([], [rule('.col'), rule('.page .badge')])
    const page = mount(editor)

    pasteOf('<div class="col"><span class="badge">New</span></div>', page.viewport)
    await settle()

    expect(inserts(editor)).toHaveLength(1)
    expect(editor.ctx.toast).not.toHaveBeenCalled()
  })
})
