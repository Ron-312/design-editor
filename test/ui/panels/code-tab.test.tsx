// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, HelmetRuleSource, ProbeRead, ProbeReadResult, Rect } from '../../../src/shared/protocol'
import type { EdId, EditOp, ProjectPath, RuleId, SourceRange, StyleSource, TemplateNode } from '../../../src/shared/types'
import { FrameGeneration } from '../../../src/ui/frame-generation'
import { PropertiesPanel } from '../../../src/ui/panels/PropertiesPanel'
import type { AckMessage, EditorContext, PanelSection } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const edId = (id: string) => id as EdId
const board = 'project/card.dc.html' as ProjectPath

const cardStyle = 'style="background: red;  padding:4px"'
const cardRule = '.card {\n  border-radius:8px ;\n}'
const hoverRule = '.card:hover{color : red}'
const beforeRule = '.card::before { content: "" }'
const otherRule = '.other { margin: 0 }'
const narrowRule = '.card { padding: 2px }'

const text = [
  '<x-dc>',
  '<helmet><style>',
  cardRule,
  hoverRule,
  beforeRule,
  otherRule,
  '@media (max-width: 600px) {',
  `  ${narrowRule}`,
  '}',
  '</style></helmet>',
  `<div ${cardStyle}>Card</div>`,
  '<div class="other">Other</div>',
  '</x-dc>',
].join('\n')

function rangeOf(snippet: string): SourceRange {
  const start = text.indexOf(snippet)
  if (start < 0) throw new Error(`the fixture has no ${snippet}`)
  return { start, end: start + snippet.length }
}

function rule(id: string, source: string, line: number, selector: string, media: string | null = null): HelmetRuleSource {
  return { target: id as RuleId, file: board, line, range: rangeOf(source), declarations: [], selector, media }
}

const rules: HelmetRuleSource[] = [
  rule('card', cardRule, 3, '.card'),
  rule('hover', hoverRule, 6, '.card:hover'),
  rule('before', beforeRule, 7, '.card::before'),
  rule('other', otherRule, 8, '.other'),
  rule('narrow', narrowRule, 10, '.card', '(max-width: 600px)'),
]

const cardInline: StyleSource = {
  target: 'inline',
  file: board,
  line: 13,
  range: rangeOf(cardStyle),
  declarations: [
    { prop: 'background', value: 'red', important: false, hasHole: false },
    { prop: 'padding', value: '4px', important: false, hasHole: false },
  ],
}

function node(id: string, tag: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children, ...extra }
}

const tree = node('root', 'x-dc', [node('card', 'div'), node('other', 'div')], { readOnly: 'artboard-root' })

/** What the probe's own matcher answers per element once states and pseudo-elements are stripped. */
const matchingSelectors: Readonly<Record<string, ReadonlySet<string>>> = {
  card: new Set(['.card', '.card:hover', '.card::before']),
  other: new Set(['.other']),
}

const box: Rect = { x: 0, y: 0, width: 100, height: 20 }

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
      return { kind: 'matches', matched: read.selectors.map((selector) => matchingSelectors[read.edId]?.has(selector) ?? false) }
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

function contextFor(store: EditorStore, reads: (read: ProbeRead) => Promise<ProbeReadResult>) {
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
    read: <R extends ProbeRead>(read: R) => reads(read) as Promise<Extract<ProbeReadResult, { kind: R['kind'] }>>,
    records: () => store.getState().records,
    toast: vi.fn(),
    onChange: (listener) => store.subscribe(listener),
  } satisfies EditorContext
}

const designSection: PanelSection = {
  id: 'fill',
  title: 'Fill',
  order: 1,
  appliesTo: () => true,
  component: () => <p data-test-section="fill">fill fields</p>,
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
}

let mounted: { root: Root; container: HTMLElement } | null = null

interface Mounted {
  readonly store: EditorStore
  readonly ctx: ReturnType<typeof contextFor>
  readonly reads: ReturnType<typeof vi.fn<(read: ProbeRead) => Promise<ProbeReadResult>>>
  readonly writeText: ReturnType<typeof vi.fn<(copied: string) => Promise<void>>>
  readonly container: HTMLElement
  /** Renders the panel again as the probe's `ready` of a reloaded frame does. */
  readonly frameReady: (generation: number) => Promise<void>
}

async function mountPanel(selection = 'card'): Promise<Mounted> {
  const store = createEditorStore()
  store.setBoard(board)
  const index: BoardIndex = {
    board,
    frameSrc: `/project/secret/${board}`,
    tree,
    text,
    rules,
    locations: {},
    styles: { [edId('card')]: [cardInline] },
  }
  store.setIndex(index)
  store.select([edId(selection)])
  const reads = vi.fn(async (read: ProbeRead) => answer(read))
  const writeText = vi.fn(async (_copied: string) => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const ctx = contextFor(store, reads)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  const render = (generation: number) =>
    act(() =>
      root.render(
        <FrameGeneration.Provider value={generation}>
          <PropertiesPanel ctx={ctx} tokens={[]} sections={[designSection]} />
        </FrameGeneration.Provider>,
      ),
    )
  render(0)
  await settle()
  const frameReady = async (generation: number) => {
    render(generation)
    await settle()
  }
  return { store, ctx, reads, writeText, container, frameReady }
}

async function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  })
  await settle()
}

function tab(name: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((element) => element.textContent?.trim() === name)
  if (!found) throw new Error(`no ${name} tab`)
  return found
}

function tabPanel(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="tabpanel"]')
  if (!found) throw new Error('no tab panel')
  return found
}

async function openCode(): Promise<HTMLElement> {
  await click(tab('Code'))
  return tabPanel()
}

const allRuleTexts = [cardStyle, cardRule, hoverRule, beforeRule, otherRule, narrowRule]

/** The smallest element holding `source` that holds no other block's source: that block's own box. */
function blockOf(panel: HTMLElement, source: string): HTMLElement {
  const holders = [...panel.querySelectorAll<HTMLElement>('*')].filter((element) => element.textContent?.includes(source))
  const own = holders.filter((element) => allRuleTexts.every((other) => other === source || !element.textContent?.includes(other)))
  const outermost = own.find((element) => !own.includes(element.parentElement!))
  if (!outermost) throw new Error(`no block shows ${source}`)
  return outermost
}

function buttonIn(block: HTMLElement, name: RegExp): HTMLElement {
  const found = [...block.querySelectorAll<HTMLElement>('button')].find(
    (button) => name.test(button.getAttribute('aria-label') ?? '') || name.test(button.textContent ?? '') || name.test(button.title),
  )
  if (!found) throw new Error(`no ${name} button in the block`)
  return found
}

function hasLabel(block: HTMLElement, label: string): boolean {
  return [...block.querySelectorAll<HTMLElement>('*')].some((element) => element.textContent?.trim() === label)
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

describe('Design and Code tabs', () => {
  it('offers a Design tab and a Code tab, with Design open first', async () => {
    await mountPanel()

    expect(tab('Design').getAttribute('aria-selected')).toBe('true')
    expect(tab('Code').getAttribute('aria-selected')).toBe('false')
    expect(document.querySelector('[data-test-section="fill"]')).not.toBeNull()
  })

  it('swaps the design sections for the code when Code is picked', async () => {
    await mountPanel()

    const panel = await openCode()

    expect(tab('Code').getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('[data-test-section="fill"]')).toBeNull()
    expect(panel.textContent).toContain(hoverRule)
  })

  it('brings the design sections back when Design is picked again', async () => {
    await mountPanel()
    await openCode()

    await click(tab('Design'))

    expect(document.querySelector('[data-test-section="fill"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain(hoverRule)
  })
})

describe('Code tab', () => {
  it('asks the probe which of the board rules match the selection', async () => {
    const view = await mountPanel()

    await openCode()

    const matchReads = view.reads.mock.calls.map(([read]) => read).filter((read) => read.kind === 'matches')
    expect(matchReads).toContainEqual({
      kind: 'matches',
      edId: edId('card'),
      selectors: ['.card', '.card:hover', '.card::before', '.other', '.card'],
    })
  })

  it('shows the inline style and each matched rule exactly as the source writes them', async () => {
    await mountPanel()

    const panel = await openCode()

    for (const source of [cardStyle, cardRule, hoverRule, beforeRule, narrowRule]) expect(panel.textContent).toContain(source)
  })

  it('leaves out a rule the probe did not match', async () => {
    await mountPanel()

    const panel = await openCode()

    expect(panel.textContent).not.toContain(otherRule)
  })

  it('shows the file and line of each block', async () => {
    await mountPanel()

    const panel = await openCode()

    expect(blockOf(panel, cardStyle).textContent).toContain('card.dc.html:13')
    expect(blockOf(panel, cardRule).textContent).toContain('card.dc.html:3')
    expect(blockOf(panel, hoverRule).textContent).toContain('card.dc.html:6')
    expect(blockOf(panel, narrowRule).textContent).toContain('card.dc.html:10')
  })

  it('labels a rule matched through a state or a pseudo-element', async () => {
    await mountPanel()

    const panel = await openCode()

    expect(hasLabel(blockOf(panel, hoverRule), 'on :hover')).toBe(true)
    expect(hasLabel(blockOf(panel, beforeRule), '::before')).toBe(true)
    expect(hasLabel(blockOf(panel, cardRule), 'on :hover')).toBe(false)
  })

  it('lists a rule inside @media with its condition', async () => {
    await mountPanel()

    const panel = await openCode()

    expect(blockOf(panel, narrowRule).textContent).toContain('(max-width: 600px)')
    expect(blockOf(panel, cardRule).textContent).not.toContain('(max-width: 600px)')
  })

  it('copies a whole rule as the source writes it', async () => {
    const view = await mountPanel()
    const panel = await openCode()

    await click(buttonIn(blockOf(panel, hoverRule), /copy rule/i))

    expect(view.writeText).toHaveBeenCalledWith(hoverRule)
  })

  it('copies the inline declarations', async () => {
    const view = await mountPanel()
    const panel = await openCode()

    await click(buttonIn(blockOf(panel, cardStyle), /copy declaration/i))

    expect(view.writeText).toHaveBeenCalledTimes(1)
    expect(view.writeText.mock.calls[0]![0]).toContain('background: red')
  })

  it('is read-only: no field to type in, and nothing is written or previewed', async () => {
    const view = await mountPanel()
    const panel = await openCode()

    for (const button of panel.querySelectorAll('button')) await click(button)

    expect(panel.querySelector('input, textarea, select, [contenteditable="true"], [contenteditable=""]')).toBeNull()
    expect(view.ctx.apply).not.toHaveBeenCalled()
    expect(view.ctx.preview).not.toHaveBeenCalled()
  })

  it('shows only the matched rules for an element without an inline style', async () => {
    await mountPanel('other')

    const panel = await openCode()

    expect(panel.textContent).toContain(otherRule)
    expect(panel.textContent).not.toContain(cardStyle)
    expect(panel.textContent).not.toContain(cardRule)
  })

  describe('after a structural edit reloads the frame', () => {
    /** The reloaded document, where the edit made `.other` match the card too. */
    function reloaded(read: ProbeRead): ProbeReadResult {
      if (read.kind === 'matches' && read.edId === 'card') return { kind: 'matches', matched: read.selectors.map((selector) => selector === '.other' || matchingSelectors.card!.has(selector)) }
      return answer(read)
    }

    /** The server sends the new index after the ack whose reload already started. */
    async function indexArrives(store: EditorStore) {
      const index = store.getState().index
      if (!index) throw new Error('no index')
      act(() => store.setIndex({ ...index, tree: structuredClone(index.tree) }))
      await settle()
    }

    it("matches the rules again on the reloaded frame's ready, replacing what the old document answered", async () => {
      const view = await mountPanel()
      const panel = await openCode()
      await indexArrives(view.store)
      expect(panel.textContent).not.toContain(otherRule)

      view.reads.mockImplementation(async (read) => reloaded(read))
      await view.frameReady(1)

      expect(panel.textContent).toContain(otherRule)
    })

    it("matches the rules again on the reloaded frame's ready when the reload rejected the new index's read", async () => {
      const view = await mountPanel()
      const panel = await openCode()
      view.reads.mockImplementation(() => Promise.reject(new Error('the frame reloaded before the probe answered')))
      await indexArrives(view.store)

      view.reads.mockImplementation(async (read) => reloaded(read))
      await view.frameReady(1)

      expect(panel.textContent).toContain(otherRule)
    })
  })
})
