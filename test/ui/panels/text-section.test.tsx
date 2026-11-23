// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult, Rect } from '../../../src/shared/protocol'
import type { AuthoredDeclaration, EdId, EditOp, ProjectPath, StyleSource, TemplateNode } from '../../../src/shared/types'
import { PropertiesPanel } from '../../../src/ui/panels/PropertiesPanel'
import { sections as textSections } from '../../../src/ui/panels/sections/text.section'
import type { AckMessage, EditorContext } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const edId = (id: string) => id as EdId
const board = 'project/card.dc.html' as ProjectPath

function node(id: string, tag: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children, ...extra }
}

// root > title (h2), lede (p)
const tree = node('root', 'x-dc', [node('title', 'h2'), node('lede', 'p')], { readOnly: 'artboard-root' })

function inline(...declarations: Array<readonly [string, string]>): StyleSource[] {
  const authored = declarations.map(([prop, value]): AuthoredDeclaration => ({ prop, value, important: false, hasHole: false }))
  return [{ target: 'inline', file: board, line: 10, range: { start: 0, end: 0 }, declarations: authored }]
}

type Styles = Record<string, readonly StyleSource[]>

const TITLE_BOX: Rect = { x: 0, y: 0, width: 312, height: 48 }

function answer(computed: Readonly<Record<string, string>>, read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'rects':
      return { kind: 'rects', rects: [TITLE_BOX] }
    case 'computed':
      return { kind: 'computed', values: Object.fromEntries(read.props.map((prop) => [prop, computed[prop] ?? ''])) }
    case 'hitTest':
      return { kind: 'hitTest', edId: null }
    case 'snapRects':
      return { kind: 'snapRects', self: TITLE_BOX, parent: null, siblings: [] }
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

async function settle() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
}

let mounted: { root: Root; container: HTMLElement } | null = null

interface MountOptions {
  readonly styles?: Styles
  readonly computed?: Readonly<Record<string, string>>
}

interface Mounted {
  readonly ctx: ReturnType<typeof contextFor>
  readonly container: HTMLElement
}

async function mountText(options: MountOptions = {}): Promise<Mounted> {
  const store = createEditorStore()
  store.setBoard(board)
  const index: BoardIndex = {
    board,
    frameSrc: `/project/secret/${board}`,
    tree,
    text: '',
    rules: [],
    locations: {},
    styles: (options.styles ?? {}) as BoardIndex['styles'],
  }
  store.setIndex(index)
  store.select([edId('title')])
  const computed = { display: 'block', width: '312px', height: '48px', ...options.computed }
  const ctx = contextFor(store, async (read) => answer(computed, read))
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  act(() => root.render(<PropertiesPanel ctx={ctx} tokens={[]} sections={textSections} />))
  await settle()
  return { ctx, container }
}

const CHOOSABLE = 'button, [role="radio"], [role="switch"], [role="checkbox"]'

function accessibleName(element: Element): string {
  return element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent ?? ''
}

/** Picks the one button, radio or dropdown option of the panel named like `name`. */
async function choose(view: Mounted, name: RegExp) {
  const buttons = [...view.container.querySelectorAll(CHOOSABLE)].filter((element) => name.test(accessibleName(element)))
  if (buttons.length > 1) throw new Error(`${buttons.length} controls are named like ${name}`)
  if (buttons[0]) return press(buttons[0])
  const option = [...view.container.querySelectorAll('select option')].find(
    (candidate): candidate is HTMLOptionElement => candidate instanceof HTMLOptionElement && name.test(`${candidate.value} ${candidate.textContent}`),
  )
  if (!option) throw new Error(`no control named like ${name}`)
  const select = option.closest('select')!
  act(() => {
    select.value = option.value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

async function press(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  })
  await settle()
}

function control(view: Mounted, name: RegExp): Element {
  const found = [...view.container.querySelectorAll(CHOOSABLE)].find((element) => name.test(accessibleName(element)))
  if (!found) throw new Error(`no control named like ${name}`)
  return found
}

const isOn = (element: Element) => (element.getAttribute('aria-checked') ?? element.getAttribute('aria-pressed')) === 'true'

function maxLinesInput(view: Mounted): HTMLInputElement {
  const found = [...view.container.querySelectorAll<HTMLInputElement>('input')].find((input) => /max lines/i.test(input.getAttribute('aria-label') ?? ''))
  if (!found) throw new Error('no Max lines field')
  return found
}

function setNativeValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function commit(input: HTMLInputElement, value: string) {
  act(() => {
    input.focus()
    setNativeValue(input, value)
  })
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  await settle()
}

function appliedOps(view: Mounted): EditOp[] {
  return view.ctx.apply.mock.calls.map(([op]) => op)
}

function lastOp(view: Mounted): EditOp {
  const op = appliedOps(view).at(-1)
  if (!op) throw new Error('no op was applied')
  return op
}

/** Each applied op as `prop` → value, with null for a removal. */
function writtenProps(view: Mounted): Record<string, string | null> {
  return Object.fromEntries(
    appliedOps(view).map((op) => {
      if (op.kind === 'setDecl') return [op.payload.prop, op.payload.value]
      if (op.kind === 'removeDecl') return [op.payload.prop, null]
      throw new Error(`unexpected ${op.kind} op`)
    }),
  )
}

function expectOneAction(view: Mounted) {
  const ids = view.ctx.apply.mock.calls.map(([, actionId]) => actionId)
  expect(ids.length).toBeGreaterThan(1)
  expect(typeof ids[0]).toBe('string')
  expect(new Set(ids).size).toBe(1)
}

/** Warnings the panel shows inline or as a toast. */
function warnings(view: Mounted): string {
  const inline = [...view.container.querySelectorAll('[role="status"]')].map((element) => element.textContent ?? '')
  const toasts = view.ctx.toast.mock.calls.map(([toast]) => toast.message)
  return [...inline, ...toasts].join(' | ')
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

describe('Text section: alignment', () => {
  it.each([
    [/left/i, 'left'],
    [/cent(er|re)/i, 'center'],
    [/right/i, 'right'],
    [/justif/i, 'justify'],
  ])('%s writes text-align: %s', async (name, value) => {
    const view = await mountText()

    await choose(view, name)

    expect(lastOp(view)).toEqual({ target: [edId('title')], kind: 'setDecl', payload: { prop: 'text-align', value } })
  })

  it('shows the authored alignment as chosen', async () => {
    const view = await mountText({ styles: { title: inline(['text-align', 'right']) } })

    expect(isOn(control(view, /right/i))).toBe(true)
    expect(isOn(control(view, /left/i))).toBe(false)
  })
})

describe('Text section: case, decoration and italic', () => {
  it.each([
    [/upper/i, 'uppercase'],
    [/lower/i, 'lowercase'],
    [/capitali|title/i, 'capitalize'],
  ])('%s writes text-transform: %s', async (name, value) => {
    const view = await mountText()

    await choose(view, name)

    expect(lastOp(view)).toMatchObject({ kind: 'setDecl', payload: { prop: 'text-transform', value } })
  })

  it.each([
    [/underline/i, 'underline'],
    [/strike|line-through/i, 'line-through'],
  ])('%s writes text-decoration-line: %s', async (name, value) => {
    const view = await mountText()

    await choose(view, name)

    expect(lastOp(view)).toMatchObject({ kind: 'setDecl', payload: { prop: 'text-decoration-line', value } })
  })

  it('italic writes font-style: italic', async () => {
    const view = await mountText()

    await choose(view, /italic/i)

    expect(lastOp(view)).toMatchObject({ kind: 'setDecl', payload: { prop: 'font-style', value: 'italic' } })
  })
})

describe('Text section: wrap style', () => {
  it.each([
    [/balance/i, 'balance'],
    [/pretty/i, 'pretty'],
  ])('%s writes text-wrap-style: %s', async (name, value) => {
    const view = await mountText()

    await choose(view, name)

    expect(lastOp(view)).toMatchObject({ kind: 'setDecl', payload: { prop: 'text-wrap-style', value } })
  })
})

describe('Text section: resizing mode', () => {
  it('shows white-space: nowrap as auto width', async () => {
    const view = await mountText({ styles: { title: inline(['white-space', 'nowrap']) } })

    expect(isOn(control(view, /auto width/i))).toBe(true)
    expect(isOn(control(view, /auto height/i))).toBe(false)
  })

  it('auto width writes white-space: nowrap and removes the width, as one action', async () => {
    const view = await mountText({ styles: { title: inline(['width', '240px'], ['height', '48px']) } })

    await choose(view, /auto width/i)

    expect(writtenProps(view)).toMatchObject({ 'white-space': 'nowrap', width: null })
    expectOneAction(view)
  })

  it('auto height fixes the measured width and removes the height, as one action', async () => {
    const view = await mountText({ styles: { title: inline(['white-space', 'nowrap'], ['height', '48px']) } })

    await choose(view, /auto height/i)

    expect(writtenProps(view)).toEqual({ width: '312px', height: null, 'white-space': null })
    expectOneAction(view)
  })

  it('fixed writes both the width and the height, as one action', async () => {
    const view = await mountText({ styles: { title: inline(['white-space', 'nowrap']) } })

    await choose(view, /fixed/i)

    expect(writtenProps(view)).toEqual({ width: '312px', height: '48px', 'white-space': null })
    expectOneAction(view)
  })
})

describe('Text section: max lines', () => {
  it('writes the line-clamp block as one action', async () => {
    const view = await mountText()

    await commit(maxLinesInput(view), '3')

    expect(writtenProps(view)).toEqual({
      display: '-webkit-box',
      '-webkit-line-clamp': '3',
      '-webkit-box-orient': 'vertical',
      overflow: 'hidden',
    })
    expectOneAction(view)
  })

  it('shows the authored number of lines', async () => {
    const block: Array<readonly [string, string]> = [
      ['display', '-webkit-box'],
      ['-webkit-line-clamp', '2'],
      ['-webkit-box-orient', 'vertical'],
      ['overflow', 'hidden'],
    ]
    const view = await mountText({ styles: { title: inline(...block) }, computed: { display: '-webkit-box' } })

    expect(maxLinesInput(view).value).toBe('2')
  })

  it('warns when the block would replace a flex display', async () => {
    const view = await mountText({ styles: { title: inline(['display', 'flex']) }, computed: { display: 'flex' } })

    await commit(maxLinesInput(view), '2')

    expect(warnings(view)).toMatch(/flex/)
  })

  it('warns when the block would replace a grid display', async () => {
    const view = await mountText({ styles: { title: inline(['display', 'grid']) }, computed: { display: 'grid' } })

    await commit(maxLinesInput(view), '2')

    expect(warnings(view)).toMatch(/grid/)
  })

  it('does not warn over a block display', async () => {
    const view = await mountText()

    await commit(maxLinesInput(view), '2')

    expect(warnings(view)).toBe('')
  })

  it('clearing the field removes the whole block as one action', async () => {
    const block: Array<readonly [string, string]> = [
      ['display', '-webkit-box'],
      ['-webkit-line-clamp', '2'],
      ['-webkit-box-orient', 'vertical'],
      ['overflow', 'hidden'],
    ]
    const view = await mountText({ styles: { title: inline(...block) }, computed: { display: '-webkit-box' } })

    await commit(maxLinesInput(view), '')

    expect(writtenProps(view)).toEqual({ display: null, '-webkit-line-clamp': null, '-webkit-box-orient': null, overflow: null })
    expectOneAction(view)
  })
})
