// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, ClientMessage, EditorState, ProbeRead, ProbeReadResult, ProbeToEditor, Rect } from '../../../src/shared/protocol'
import type { Board, CanvasLayout, EdId, ProjectPath, TemplateNode } from '../../../src/shared/types'
import { createDefaultRegistry } from '../../../src/ui/actions/registry'
import { CanvasView, defaultCanvasTools } from '../../../src/ui/canvas/CanvasView'
import type { CanvasTool, EditorContext, PointerHandler } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'
import type { WsClient } from '../../../src/ui/ws-client'

/** Stands in for the probe inside the frame: answers reads from the rendered scene below. */
const probes = vi.hoisted(() => {
  type Listener = (message: ProbeToEditor) => void
  const scene = {
    rendered: [] as Array<readonly [string, Rect]>,
    computed: {} as Record<string, Readonly<Record<string, string>>>,
  }
  const contains = (rect: Rect, x: number, y: number) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height

  function answer(read: ProbeRead): ProbeReadResult {
    switch (read.kind) {
      case 'hitTest': {
        const deepest = scene.rendered.filter(([, rect]) => contains(rect, read.x, read.y)).at(-1)
        return { kind: 'hitTest', edId: (deepest?.[0] ?? null) as EdId | null }
      }
      case 'rects':
        return { kind: 'rects', rects: scene.rendered.filter(([id]) => id === read.edId).map(([, rect]) => rect) }
      case 'snapRects': {
        const self = scene.rendered.find(([id]) => id === read.edId)?.[1] ?? { x: 0, y: 0, width: 0, height: 0 }
        return { kind: 'snapRects', self, parent: null, siblings: [] }
      }
      case 'computed': {
        const values = scene.computed[read.edId] ?? {}
        return { kind: 'computed', values: Object.fromEntries(read.props.flatMap((prop) => (prop in values ? [[prop, values[prop]!]] : []))) }
      }
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

  function createFakeProbe() {
    const listeners = new Set<Listener>()
    let sessions = 0
    return {
      read: vi.fn(async (read: ProbeRead) => answer(read)),
      onMessage(listener: Listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      previewDecl: vi.fn(),
      scrollTo: vi.fn(),
      beginTextEdit: vi.fn<(edId: EdId) => string>(() => `text-${++sessions}`),
      endTextEdit: vi.fn(),
      dispose: vi.fn(),
      emit(message: ProbeToEditor) {
        for (const listener of listeners) listener(message)
      },
    }
  }

  const created: Array<ReturnType<typeof createFakeProbe>> = []
  return {
    scene,
    created,
    create() {
      const probe = createFakeProbe()
      created.push(probe)
      return probe
    },
  }
})

vi.mock('../../../src/ui/probe-client', () => ({ createProbeClient: () => probes.create() }))

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const edId = (id: string) => id as EdId
const ids = (...names: string[]) => names.map(edId)
const home = 'project/home.dc.html' as ProjectPath
const boards: Board[] = [{ path: home, w: 1280, h: 900, page: true }]
const layout: CanvasLayout = { boards, order: [home], pages: [home] }
const VIEWPORT_SIZE = { width: 800, height: 600 }
const VIEW = { zoom: 1, panX: 100, panY: 100 }

function node(id: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag: 'div', name: id, children, ...extra }
}

// root > hero (<h1>), row (flex) > col1 > title1, col2, col3; lede (<p>) > strong, em; badge (absolute)
const homeTree = node(
  'root',
  [
    node('hero', [], { tag: 'h1' }),
    node('row', [node('col1', [node('title1', [], { tag: 'h2' })]), node('col2'), node('col3')], { tag: 'section' }),
    node('lede', [node('strong', [], { tag: 'strong' }), node('em', [], { tag: 'em' })], { tag: 'p' }),
    node('badge'),
  ],
  { readOnly: 'artboard-root' },
)

/** Outermost first, so the last entry containing a point is the deepest hit. */
const homeScene: Array<readonly [string, Rect]> = [
  ['root', { x: 0, y: 0, width: 1280, height: 900 }],
  ['hero', { x: 40, y: 40, width: 600, height: 80 }],
  ['row', { x: 40, y: 160, width: 1000, height: 300 }],
  ['col1', { x: 60, y: 180, width: 300, height: 260 }],
  ['title1', { x: 80, y: 200, width: 200, height: 40 }],
  ['col2', { x: 380, y: 180, width: 300, height: 260 }],
  ['col3', { x: 700, y: 180, width: 300, height: 260 }],
  ['lede', { x: 40, y: 500, width: 600, height: 60 }],
  ['strong', { x: 140, y: 510, width: 60, height: 40 }],
  ['em', { x: 240, y: 510, width: 60, height: 40 }],
  ['badge', { x: 900, y: 40, width: 100, height: 60 }],
]

const IN_FLOW = { display: 'block', position: 'static', transform: 'none' }

const homeComputed: Record<string, Readonly<Record<string, string>>> = {
  root: IN_FLOW,
  hero: IN_FLOW,
  row: { ...IN_FLOW, display: 'flex', 'flex-direction': 'row' },
  col1: IN_FLOW,
  title1: IN_FLOW,
  col2: IN_FLOW,
  col3: IN_FLOW,
  lede: IN_FLOW,
  strong: { ...IN_FLOW, display: 'inline' },
  em: { ...IN_FLOW, display: 'inline' },
  badge: { display: 'block', position: 'absolute', transform: 'none', left: '900px', top: '40px', right: '280px', bottom: '800px' },
}

const at = {
  hero: { x: 100, y: 80 },
  title1: { x: 120, y: 220 },
  rowPadding: { x: 50, y: 170 },
  rowPaddingAboveCol2: { x: 370, y: 170 },
  rowFarCorner: { x: 1020, y: 300 },
  ledeText: { x: 50, y: 530 },
  pastEm: { x: 320, y: 555 },
  badge: { x: 950, y: 70 },
  emptyCanvas: { x: -50, y: -50 },
}

function fakeWs() {
  return {
    sendOp: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    send: vi.fn<(message: ClientMessage) => void>(),
    onMessage: vi.fn(() => () => {}),
    close: vi.fn(),
  }
}

function sizedRect(element: Element): DOMRect {
  const sized = element.matches('[data-canvas-viewport], [data-canvas-shield]')
  return new DOMRect(0, 0, sized ? VIEWPORT_SIZE.width : 0, sized ? VIEWPORT_SIZE.height : 0)
}

class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, contentRect: sizedRect(target) } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
}

interface Mounted {
  readonly store: EditorStore
  readonly ws: ReturnType<typeof fakeWs>
  readonly container: HTMLElement
}

let mounted: { root: Root; container: HTMLElement; stopShortcuts: () => void } | null = null

/** The app's document keydown listener, reduced to the registry call. */
function listenForShortcuts(context: () => EditorContext | null): () => void {
  const registry = createDefaultRegistry('mac')
  const onKeyDown = (event: KeyboardEvent) => {
    const ctx = context()
    if (ctx) registry.handleKeyDown(event, ctx)
  }
  document.addEventListener('keydown', onKeyDown)
  return () => document.removeEventListener('keydown', onKeyDown)
}

async function openHome(tools?: readonly CanvasTool[]): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.append(container)
  const store = createEditorStore()
  const ws = fakeWs()
  ws.sendOp.mockResolvedValue({ warnings: [] })
  const root = createRoot(container)
  let latest: EditorContext | null = null
  mounted = { root, container, stopShortcuts: listenForShortcuts(() => latest) }
  const editorState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }
  act(() =>
    root.render(
      <CanvasView
        store={store}
        ws={ws as unknown as WsClient}
        layout={layout}
        editorState={editorState}
        platform="mac"
        onContext={(ctx: EditorContext) => {
          latest = ctx
        }}
        {...(tools ? { tools } : {})}
      />,
    ),
  )
  const index: BoardIndex = { board: home, frameSrc: `/project/secret/${home}`, tree: homeTree, text: '', locations: {}, styles: {}, rules: [] }
  act(() => store.setIndex(index))
  await settle()
  await act(async () => {
    container.querySelector('iframe')!.dispatchEvent(new Event('load'))
    latestProbe().emit({ type: 'ready', scrollX: 0, scrollY: 0 })
  })
  await settle()
  act(() => store.setViewport(VIEW))
  await settle()
  return { store, ws, container }
}

function latestProbe() {
  const probe = probes.created.at(-1)
  if (!probe) throw new Error('the canvas created no probe client')
  return probe
}

function shieldOf(view: Mounted): HTMLElement {
  const shield = view.container.querySelector<HTMLElement>('[data-canvas-shield]')
  if (!shield) throw new Error('no event shield')
  return shield
}

function toScreen(point: { x: number; y: number }) {
  return { x: VIEW.panX + point.x * VIEW.zoom, y: VIEW.panY + point.y * VIEW.zoom }
}

function pointer(view: Mounted, type: string, board: { x: number; y: number }, init: PointerEventInit = {}) {
  const screen = toScreen(board)
  shieldOf(view).dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: screen.x,
      clientY: screen.y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      ...init,
    }),
  )
}

function mouse(view: Mounted, type: string, board: { x: number; y: number }, init: MouseEventInit = {}) {
  const screen = toScreen(board)
  shieldOf(view).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: screen.x, clientY: screen.y, button: 0, ...init }))
}

function click(view: Mounted, board: { x: number; y: number }, detail: number, init: MouseEventInit = {}) {
  pointer(view, 'pointerdown', board, init)
  mouse(view, 'mousedown', board, { ...init, detail })
  pointer(view, 'pointerup', board, init)
  mouse(view, 'mouseup', board, { ...init, detail })
  mouse(view, 'click', board, { ...init, detail })
}

async function clickAt(view: Mounted, board: { x: number; y: number }, init: MouseEventInit = {}) {
  act(() => click(view, board, 1, init))
  await settle()
}

/** Presses, lets the hit land, drags through `path` and releases at its last point. */
async function dragAt(view: Mounted, from: { x: number; y: number }, path: ReadonlyArray<{ x: number; y: number }>, init: PointerEventInit = {}) {
  act(() => pointer(view, 'pointerdown', from, init))
  await settle()
  for (const to of path) act(() => pointer(view, 'pointermove', to, init))
  await settle()
  act(() => pointer(view, 'pointerup', path.at(-1)!, init))
  await settle()
}

function pressKey(view: Mounted, key: string): KeyboardEvent {
  view.container.querySelector<HTMLElement>('[data-canvas-viewport]')!.focus()
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => {
    document.activeElement!.dispatchEvent(event)
    document.activeElement!.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
  })
  return event
}

function selectionOf(view: Mounted): EdId[] {
  return [...view.store.getState().view.selection]
}

function sorted(edIds: readonly EdId[]): string[] {
  return [...edIds].sort()
}

function marqueeShown(view: Mounted): boolean {
  return view.container.querySelector('[data-marquee]') !== null
}

function setDecls(view: Mounted): string[] {
  return view.ws.sendOp.mock.calls.flatMap(([op]) => (op.kind === 'setDecl' ? [`${op.payload.prop}: ${op.payload.value}`] : []))
}

/** Every selection the store held, in order, from now on. */
function recordSelections(store: EditorStore): string[][] {
  const seen: string[][] = []
  store.subscribe(() => {
    const current = [...store.getState().view.selection]
    if (JSON.stringify(seen.at(-1)) !== JSON.stringify(current)) seen.push(current)
  })
  return seen
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  probes.scene.rendered = [...homeScene]
  probes.scene.computed = { ...homeComputed }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return sizedRect(this)
  })
  for (const [prop, dimension] of [
    ['clientWidth', 'width'],
    ['clientHeight', 'height'],
    ['offsetWidth', 'width'],
    ['offsetHeight', 'height'],
  ] as const) {
    vi.spyOn(HTMLElement.prototype, prop, 'get').mockImplementation(function (this: HTMLElement) {
      return sizedRect(this)[dimension]
    })
  }
  for (const method of ['setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(method in Element.prototype)) Object.defineProperty(Element.prototype, method, { configurable: true, value: () => {} })
  }
  if (!('hasPointerCapture' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'hasPointerCapture', { configurable: true, value: () => false })
  }
})

afterEach(() => {
  if (mounted) {
    const { root, container, stopShortcuts } = mounted
    stopShortcuts()
    act(() => root.unmount())
    container.remove()
    mounted = null
  }
  probes.created.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the canvas claims every press', () => {
  it('claims a press no higher tool takes, and starts the hit-test at the press point', async () => {
    const onPointerDown = vi.fn<PointerHandler>(() => false)
    const lowest: CanvasTool = { id: 'lowest', priority: -1_000_000, onPointerDown }
    const view = await openHome([...defaultCanvasTools(), lowest])
    latestProbe().read.mockClear()

    act(() => pointer(view, 'pointerdown', at.rowPadding))

    expect(onPointerDown).not.toHaveBeenCalled()
    expect(latestProbe().read).toHaveBeenCalledWith({ kind: 'hitTest', x: at.rowPadding.x, y: at.rowPadding.y, depth: 'deepest', within: null })
  })
})

describe('marquee select', () => {
  it("marquee-selects the three columns from the row's own background", async () => {
    const view = await openHome()

    act(() => pointer(view, 'pointerdown', at.rowPadding))
    await settle()
    act(() => pointer(view, 'pointermove', at.rowFarCorner))
    await settle()
    expect(marqueeShown(view)).toBe(true)
    act(() => pointer(view, 'pointerup', at.rowFarCorner))
    await settle()

    expect(selectionOf(view)).toEqual(ids('col1', 'col2', 'col3'))
    expect(marqueeShown(view)).toBe(false)
  })

  it('never shows the row selected on the way to the marquee', async () => {
    const view = await openHome()
    const seen = recordSelections(view.store)

    await dragAt(view, at.rowPadding, [at.rowFarCorner])

    expect(seen).not.toContainEqual(['row'])
    expect(selectionOf(view)).toEqual(ids('col1', 'col2', 'col3'))
  })

  it('selects the row on a click on its own background', async () => {
    const view = await openHome()

    await clickAt(view, at.rowPadding)

    expect(selectionOf(view)).toEqual(ids('row'))
  })

  it('selects the smallest element on a click, and the enclosing one with Cmd', async () => {
    const view = await openHome()

    await clickAt(view, at.title1, { metaKey: true })
    expect(selectionOf(view)).toEqual(ids('col1'))

    await clickAt(view, at.title1, { metaKey: true })
    expect(selectionOf(view)).toEqual(ids('row'))

    await clickAt(view, at.title1)
    expect(selectionOf(view)).toEqual(ids('title1'))

    await clickAt(view, at.rowPadding, { metaKey: true })
    expect(selectionOf(view)).toEqual(ids('row'))
  })

  it('adds to the selection as it was at press with Shift', async () => {
    const view = await openHome()
    await clickAt(view, at.hero)

    await dragAt(view, at.rowPaddingAboveCol2, [at.rowFarCorner], { shiftKey: true })

    expect(sorted(selectionOf(view))).toEqual(['col2', 'col3', 'hero'])
  })

  it('cancels on Escape mid-marquee and leaves the selection unchanged', async () => {
    const view = await openHome()
    await clickAt(view, at.hero)
    act(() => pointer(view, 'pointerdown', at.rowPadding))
    await settle()
    act(() => pointer(view, 'pointermove', at.rowFarCorner))
    await settle()
    expect(marqueeShown(view)).toBe(true)

    const escape = pressKey(view, 'Escape')
    await settle()
    act(() => pointer(view, 'pointerup', at.rowFarCorner))
    await settle()

    expect(escape.defaultPrevented).toBe(true)
    expect(marqueeShown(view)).toBe(false)
    expect(selectionOf(view)).toEqual(ids('hero'))
  })

  it('clears the selection on a click on empty canvas, and keeps it with Shift', async () => {
    const view = await openHome()
    await clickAt(view, at.hero)

    await clickAt(view, at.emptyCanvas, { shiftKey: true })
    expect(selectionOf(view)).toEqual(ids('hero'))

    await clickAt(view, at.emptyCanvas)
    expect(selectionOf(view)).toEqual([])
  })

  it("selects the artboard root's children from empty canvas", async () => {
    const view = await openHome()

    await dragAt(view, at.emptyCanvas, [{ x: 700, y: 200 }])

    expect(sorted(selectionOf(view))).toEqual(['hero', 'row'])
  })
})

describe('a drag on a leaf', () => {
  it('selects an unselected leaf and moves it by the whole drag, from the press point to the latest pointer', async () => {
    const view = await openHome()

    act(() => {
      pointer(view, 'pointerdown', at.badge)
      pointer(view, 'pointermove', { x: 960, y: 80 })
      pointer(view, 'pointermove', { x: 990, y: 100 })
    })
    await settle()
    expect(selectionOf(view)).toEqual(ids('badge'))
    act(() => pointer(view, 'pointermove', { x: 990, y: 100 }))
    await settle()
    act(() => pointer(view, 'pointerup', { x: 990, y: 100 }))
    await settle()

    expect(setDecls(view)).toEqual(['left: 940px', 'top: 70px'])
    expect(selectionOf(view)).toEqual(ids('badge'))
  })

  it('selects the smallest element under the press, not the element around it', async () => {
    const view = await openHome()

    await dragAt(view, at.title1, [{ x: 160, y: 250 }])

    expect(selectionOf(view)).toEqual(ids('title1'))
    expect(marqueeShown(view)).toBe(false)
  })

  it('drags the selected element by what is inside it, where a click would select the inside', async () => {
    const view = await openHome()
    act(() => view.store.select(ids('col1')))
    await settle()

    await dragAt(view, at.title1, [{ x: 900, y: 250 }])

    expect(selectionOf(view)).toEqual(ids('col1'))
    expect(view.ws.sendOp.mock.calls.map(([op]) => op)).toEqual([
      expect.objectContaining({ kind: 'moveNode', target: ids('col1'), payload: { parent: edId('row'), before: null } }),
    ])

    await clickAt(view, at.title1)
    expect(selectionOf(view)).toEqual(ids('title1'))
  })

  it('moves a selected element, since the move tool keeps priority over the marquee', async () => {
    const view = await openHome()
    await clickAt(view, at.badge)

    await dragAt(view, at.badge, [{ x: 990, y: 100 }])

    expect(setDecls(view)).toEqual(['left: 940px', 'top: 70px'])
    expect(marqueeShown(view)).toBe(false)
  })

  it('treats text with inline children as a leaf, selecting it rather than marqueeing its inline children', async () => {
    const view = await openHome()

    act(() => pointer(view, 'pointerdown', at.ledeText))
    await settle()
    act(() => pointer(view, 'pointermove', at.pastEm))
    await settle()
    expect(marqueeShown(view)).toBe(false)
    act(() => pointer(view, 'pointerup', at.pastEm))
    await settle()

    expect(selectionOf(view)).toEqual(ids('lede'))
  })

  it('applies a flick released before the hit lands as a click, and moves nothing', async () => {
    const view = await openHome()

    act(() => {
      pointer(view, 'pointerdown', at.badge)
      pointer(view, 'pointermove', { x: 990, y: 100 })
      pointer(view, 'pointerup', { x: 990, y: 100 })
    })
    await settle()

    expect(selectionOf(view)).toEqual(ids('badge'))
    expect(setDecls(view)).toEqual([])
  })
})

describe('double-click after a claimed press', () => {
  it('selects with the press, then enters text edit', async () => {
    const view = await openHome()

    act(() => {
      click(view, at.hero, 1)
      click(view, at.hero, 2)
      mouse(view, 'dblclick', at.hero, { detail: 2 })
    })
    await settle()

    expect(selectionOf(view)).toEqual(ids('hero'))
    expect(latestProbe().beginTextEdit).toHaveBeenCalledWith(edId('hero'))
  })
})
