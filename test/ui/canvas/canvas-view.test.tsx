// @vitest-environment jsdom
/// <reference types="vite/client" />
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, ClientMessage, EditorState, ProbeRead, ProbeReadResult, ProbeToEditor, Rect } from '../../../src/shared/protocol'
import type { Board, CanvasLayout, EdId, ProjectPath, TemplateNode } from '../../../src/shared/types'
import type { Platform } from '../../../src/ui/actions/registry'
import { CanvasView, defaultCanvasTools, loadCanvasTools, type ToolModule } from '../../../src/ui/canvas/CanvasView'
import type { CanvasPointer, CanvasTool, EditorContext, PointerHandler } from '../../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'
import type { WsClient } from '../../../src/ui/ws-client'

/** Stands in for the probe inside the frame: answers reads from the rendered scene below. */
const probes = vi.hoisted(() => {
  type Listener = (message: ProbeToEditor) => void
  const scene = { rendered: [] as Array<readonly [string, Rect]> }
  const contains = (rect: Rect, x: number, y: number) =>
    x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height

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
      case 'computed':
        return { kind: 'computed', values: {} }
      case 'supports':
        return { kind: 'supports', supported: true }
    }
  }

  function createFakeProbe(frame: HTMLIFrameElement) {
    const listeners = new Set<Listener>()
    let sessions = 0
    return {
      frame,
      read: vi.fn(async (read: ProbeRead) => answer(read)),
      onMessage(listener: Listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      previewDecl: vi.fn(),
      scrollTo: vi.fn<(x: number, y: number) => void>(),
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
    create(frame: HTMLIFrameElement) {
      const probe = createFakeProbe(frame)
      created.push(probe)
      return probe
    },
  }
})

vi.mock('../../../src/ui/probe-client', () => ({ createProbeClient: (frame: HTMLIFrameElement) => probes.create(frame) }))

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const edId = (id: string) => id as EdId
const ids = (...names: string[]) => names.map(edId)
const home = 'project/home.dc.html' as ProjectPath
const card = 'project/card.dc.html' as ProjectPath

const boards: Board[] = [
  { path: home, w: 1280, h: 900, page: true },
  { path: card, w: 360, h: 220, page: false },
]
const layout: CanvasLayout = { boards, order: [home, card], pages: [home] }
const VIEWPORT_SIZE = { width: 800, height: 600 }

function node(id: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag: 'div', name: id, children, ...extra }
}

// root > card > (title, button > label); list > item (<sc-for>, text is {{ item.label }});
// lede is <p> with <strong> and <em> inside; aside.
const homeTree = node(
  'root',
  [
    node('card', [node('title', [], { tag: 'h1' }), node('button', [node('label', [], { tag: 'span' })], { tag: 'button' })]),
    node('list', [node('item', [], { tag: 'li', readOnly: 'hole' })], { tag: 'ul' }),
    node('lede', [node('strong', [], { tag: 'strong' }), node('em', [], { tag: 'em' })], { tag: 'p' }),
    node('aside'),
  ],
  { readOnly: 'artboard-root' },
)

const cardTree = node('cardRoot', [node('cardTitle', [], { tag: 'h2' })], { readOnly: 'artboard-root' })

/** Outermost first, so the last entry containing a point is the deepest hit. */
const homeScene: Array<readonly [string, Rect]> = [
  ['root', { x: 0, y: 0, width: 1280, height: 900 }],
  ['card', { x: 40, y: 40, width: 600, height: 300 }],
  ['title', { x: 60, y: 60, width: 400, height: 60 }],
  ['button', { x: 60, y: 200, width: 200, height: 60 }],
  ['label', { x: 80, y: 210, width: 100, height: 40 }],
  ['list', { x: 40, y: 400, width: 600, height: 180 }],
  ['item', { x: 40, y: 400, width: 600, height: 60 }],
  ['item', { x: 40, y: 460, width: 600, height: 60 }],
  ['item', { x: 40, y: 520, width: 600, height: 60 }],
  ['lede', { x: 700, y: 40, width: 400, height: 40 }],
  ['strong', { x: 800, y: 40, width: 60, height: 40 }],
  ['em', { x: 900, y: 40, width: 60, height: 40 }],
  ['aside', { x: 700, y: 200, width: 300, height: 400 }],
]

const at = {
  label: { x: 100, y: 230 },
  title: { x: 100, y: 80 },
  secondItem: { x: 100, y: 490 },
  ledeText: { x: 720, y: 60 },
  aside: { x: 800, y: 300 },
}

function indexFor(board: ProjectPath, tree: TemplateNode): BoardIndex {
  return { board, frameSrc: `/project/secret/${board}`, tree, locations: {}, styles: {} }
}

function editorStateWith(locked: readonly EdId[] = []): EditorState {
  return { hidden: [], locked, collapsed: [], boards: {} }
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
    const contentRect = sizedRect(target)
    this.callback([{ target, contentRect } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
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

let mounted: { root: Root; container: HTMLElement } | null = null

interface MountOptions {
  readonly layout?: CanvasLayout
  readonly locked?: readonly EdId[]
  readonly platform?: Platform
  readonly tools?: readonly CanvasTool[]
}

function mount(options: MountOptions = {}): Mounted {
  const container = document.createElement('div')
  document.body.append(container)
  const store = createEditorStore()
  const ws = fakeWs()
  const root = createRoot(container)
  mounted = { root, container }
  act(() => {
    root.render(
      <CanvasView
        store={store}
        ws={ws as unknown as WsClient}
        layout={options.layout ?? layout}
        editorState={editorStateWith(options.locked)}
        platform={options.platform ?? 'mac'}
        {...(options.tools ? { tools: options.tools } : {})}
      />,
    )
  })
  return { store, ws, container }
}

function latestProbe() {
  const probe = probes.created.at(-1)
  if (!probe) throw new Error('the canvas created no probe client')
  return probe
}

function frameOf(container: HTMLElement): HTMLIFrameElement {
  const frames = container.querySelectorAll('iframe')
  expect(frames).toHaveLength(1)
  return frames[0]!
}

async function loadFrame(container: HTMLElement, scroll = { x: 0, y: 0 }) {
  await act(async () => {
    frameOf(container).dispatchEvent(new Event('load'))
    latestProbe().emit({ type: 'ready', scrollX: scroll.x, scrollY: scroll.y })
  })
  await settle()
}

async function openHome(options: MountOptions = {}): Promise<Mounted> {
  const view = mount(options)
  act(() => view.store.setIndex(indexFor(home, homeTree)))
  await settle()
  await loadFrame(view.container)
  return view
}

async function setViewport(store: EditorStore, zoom: number, panX: number, panY: number) {
  act(() => store.setViewport({ zoom, panX, panY }))
  await settle()
}

function shieldOf(container: HTMLElement): HTMLElement {
  const shield = container.querySelector<HTMLElement>('[data-canvas-shield]')
  if (!shield) throw new Error('no event shield')
  return shield
}

function toScreen(store: EditorStore, point: { x: number; y: number }) {
  const { zoom, panX, panY } = store.getState().view.viewport
  return { x: panX + point.x * zoom, y: panY + point.y * zoom }
}

type Modifiers = Partial<Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>>

function dispatchPointer(target: Element, type: string, screen: { x: number; y: number }, init: PointerEventInit = {}) {
  target.dispatchEvent(
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

function dispatchMouse(target: Element, type: string, screen: { x: number; y: number }, init: MouseEventInit = {}) {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: screen.x, clientY: screen.y, button: 0, ...init }),
  )
}

async function clickAt(view: Mounted, board: { x: number; y: number }, modifiers: Modifiers = {}, detail = 1) {
  const shield = shieldOf(view.container)
  const screen = toScreen(view.store, board)
  act(() => {
    dispatchPointer(shield, 'pointerdown', screen, modifiers)
    dispatchMouse(shield, 'mousedown', screen, { ...modifiers, detail })
    dispatchPointer(shield, 'pointerup', screen, modifiers)
    dispatchMouse(shield, 'mouseup', screen, { ...modifiers, detail })
    dispatchMouse(shield, 'click', screen, { ...modifiers, detail })
  })
  await settle()
}

async function doubleClickAt(view: Mounted, board: { x: number; y: number }) {
  await clickAt(view, board, {}, 1)
  await clickAt(view, board, {}, 2)
  act(() => dispatchMouse(shieldOf(view.container), 'dblclick', toScreen(view.store, board), { detail: 2 }))
  await settle()
}

async function hoverAt(view: Mounted, board: { x: number; y: number }) {
  act(() => dispatchPointer(shieldOf(view.container), 'pointermove', toScreen(view.store, board), { buttons: 0 }))
  await settle()
}

function keyTarget(container: HTMLElement): Element {
  const focusable = [container.querySelector<HTMLElement>('[data-canvas-viewport]'), shieldOf(container)]
  focusable.find((element) => element && element.tabIndex >= 0)?.focus()
  const active = document.activeElement
  return active && container.contains(active) ? active : shieldOf(container)
}

function press(container: HTMLElement, type: 'keydown' | 'keyup', key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...init })
  act(() => {
    keyTarget(container).dispatchEvent(event)
  })
  return event
}

async function pressKey(container: HTMLElement, key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = press(container, 'keydown', key, init)
  press(container, 'keyup', key, init)
  await settle()
  return event
}

interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

function boxOf(element: HTMLElement): Box {
  const px = (value: string) => Number.parseFloat(value)
  return { left: px(element.style.left), top: px(element.style.top), width: px(element.style.width), height: px(element.style.height) }
}

function outlines(container: HTMLElement, kind: 'hover' | 'selection'): Box[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-outline="${kind}"]`)].map(boxOf)
}

function screenBox(store: EditorStore, rect: Rect): Box {
  const { zoom, panX, panY } = store.getState().view.viewport
  return { left: panX + rect.x * zoom, top: panY + rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom }
}

function sceneRects(id: string): Rect[] {
  return homeScene.filter(([sceneId]) => sceneId === id).map(([, rect]) => rect)
}

function expectBoxes(actual: Box[], expected: Box[]) {
  expect(actual).toHaveLength(expected.length)
  const byTop = (a: Box, b: Box) => a.top - b.top || a.left - b.left
  const sortedActual = [...actual].sort(byTop)
  ;[...expected].sort(byTop).forEach((box, i) => {
    const shown = sortedActual[i]!
    expect(shown.left).toBeCloseTo(box.left)
    expect(shown.top).toBeCloseTo(box.top)
    expect(shown.width).toBeCloseTo(box.width)
    expect(shown.height).toBeCloseTo(box.height)
  })
}

function frameSize(frame: HTMLIFrameElement) {
  const size = (style: string, attribute: string | null) => Number.parseFloat(style || attribute || 'NaN')
  return { width: size(frame.style.width, frame.getAttribute('width')), height: size(frame.style.height, frame.getAttribute('height')) }
}

function boardTransform(container: HTMLElement) {
  const board = container.querySelector<HTMLElement>('[data-canvas-board]')
  if (!board) throw new Error('no transformed board wrapper')
  const transform = board.style.transform
  const translate = /translate(?:3d)?\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(transform)
  const scale = /scale\(\s*([\d.]+)/.exec(transform)
  return { panX: Number(translate?.[1]), panY: Number(translate?.[2]), zoom: Number(scale?.[1]) }
}

function notices(store: EditorStore): string[] {
  const { toasts, banners } = store.getState()
  return [...toasts, ...banners].map((notice) => notice.message)
}

function switcherButtons(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-board-switcher] [data-board]')]
}

function interactSwitch(container: HTMLElement): HTMLElement {
  const toggle = [...container.querySelectorAll<HTMLElement>('[role="switch"]')].find((element) =>
    /interact/i.test(`${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`),
  )
  if (!toggle) throw new Error('no Interact switch')
  return toggle
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  probes.scene.rendered = [...homeScene]
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
    const { root, container } = mounted
    act(() => root.unmount())
    container.remove()
    mounted = null
  }
  probes.created.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('one artboard at a time', () => {
  it('opens the first board in order and mounts it in one sandboxed frame at its canvas.json size', async () => {
    const view = mount()

    expect(view.ws.send).toHaveBeenCalledWith({ type: 'open', board: home })
    expect(view.store.getState().board).toBe(home)

    act(() => view.store.setIndex(indexFor(home, homeTree)))
    await settle()

    const frame = frameOf(view.container)
    expect(frame.getAttribute('src')).toBe(`/project/secret/${home}`)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frameSize(frame)).toEqual({ width: 1280, height: 900 })
  })

  it('lists the boards in canvas.json order and marks the pages', async () => {
    const view = mount({ layout: { boards, order: [card, home], pages: [home] } })

    expect(view.ws.send).toHaveBeenCalledWith({ type: 'open', board: card })
    const buttons = switcherButtons(view.container)
    expect(buttons.map((button) => button.getAttribute('data-board'))).toEqual([card, home])
    expect(buttons.map((button) => button.hasAttribute('data-page'))).toEqual([false, true])
  })

  it('switches boards, swapping the one frame, and keeps selection and zoom per board', async () => {
    const view = await openHome()
    await clickAt(view, at.label)
    await setViewport(view.store, 2, 15, 25)

    act(() => switcherButtons(view.container).find((button) => button.getAttribute('data-board') === card)!.click())
    await settle()

    expect(view.ws.send).toHaveBeenCalledWith({ type: 'open', board: card })
    expect(view.store.getState().board).toBe(card)
    expect(view.store.getState().view.selection).toEqual([])

    act(() => view.store.setIndex(indexFor(card, cardTree)))
    await settle()

    const cardFrame = frameOf(view.container)
    expect(cardFrame.getAttribute('src')).toBe(`/project/secret/${card}`)
    expect(frameSize(cardFrame)).toEqual({ width: 360, height: 220 })

    act(() => switcherButtons(view.container).find((button) => button.getAttribute('data-board') === home)!.click())
    await settle()

    expect(view.store.getState().view.selection).toEqual(ids('card'))
    expect(view.store.getState().view.viewport).toEqual({ zoom: 2, panX: 15, panY: 25 })
    expect(boardTransform(view.container)).toEqual({ zoom: 2, panX: 15, panY: 25 })
    expect(frameOf(view.container).getAttribute('src')).toBe(`/project/secret/${home}`)
  })
})

describe('zoom and pan', () => {
  it('applies the viewport as a transform on the board', async () => {
    const view = await openHome()

    await setViewport(view.store, 0.5, 100, 40)

    expect(boardTransform(view.container)).toEqual({ zoom: 0.5, panX: 100, panY: 40 })
  })

  it.each([
    ['Cmd-wheel on macOS', 'mac', { metaKey: true }],
    ['a trackpad pinch on macOS', 'mac', { ctrlKey: true }],
    ['Ctrl-wheel on Windows', 'windows', { ctrlKey: true }],
  ] as const)('zooms in at the cursor on %s', async (_name, platform, modifiers) => {
    const view = await openHome({ platform })
    await setViewport(view.store, 1, 30, 20)
    const cursor = { x: 300, y: 200 }
    const before = view.store.getState().view.viewport
    const boardPoint = { x: (cursor.x - before.panX) / before.zoom, y: (cursor.y - before.panY) / before.zoom }

    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: cursor.x,
      clientY: cursor.y,
      deltaY: -100,
      ...modifiers,
    })
    act(() => {
      shieldOf(view.container).dispatchEvent(wheel)
    })
    await settle()

    const after = view.store.getState().view.viewport
    expect(wheel.defaultPrevented).toBe(true)
    expect(after.zoom).toBeGreaterThan(before.zoom)
    expect((cursor.x - after.panX) / after.zoom).toBeCloseTo(boardPoint.x)
    expect((cursor.y - after.panY) / after.zoom).toBeCloseTo(boardPoint.y)
  })

  it('pans with Space-drag and selects nothing', async () => {
    const view = await openHome()
    await setViewport(view.store, 1, 0, 0)
    const shield = shieldOf(view.container)

    press(view.container, 'keydown', ' ', { code: 'Space' })
    act(() => {
      dispatchPointer(shield, 'pointerdown', { x: 100, y: 100 })
      dispatchPointer(shield, 'pointermove', { x: 130, y: 120 })
      dispatchPointer(shield, 'pointermove', { x: 160, y: 130 })
      dispatchPointer(shield, 'pointerup', { x: 160, y: 130 })
      dispatchMouse(shield, 'click', { x: 160, y: 130 })
    })
    press(view.container, 'keyup', ' ', { code: 'Space' })
    await settle()

    expect(view.store.getState().view.viewport).toEqual({ zoom: 1, panX: 60, panY: 30 })
    expect(view.store.getState().view.selection).toEqual([])
  })

  it('fits the artboard with Shift-1', async () => {
    const view = await openHome()
    await setViewport(view.store, 3, -500, -500)

    await pressKey(view.container, '!', { code: 'Digit1', shiftKey: true })

    const { zoom, panX, panY } = view.store.getState().view.viewport
    expect(zoom).toBeLessThanOrEqual(600 / 900)
    expect(zoom).toBeGreaterThan(0.5)
    expect(panX + (1280 * zoom) / 2).toBeCloseTo(VIEWPORT_SIZE.width / 2)
    expect(panY + (900 * zoom) / 2).toBeCloseTo(VIEWPORT_SIZE.height / 2)
  })

  it('zooms to the selection with Shift-2', async () => {
    const view = await openHome()
    await setViewport(view.store, 1, 0, 0)
    await clickAt(view, at.title, { metaKey: true })

    await pressKey(view.container, '@', { code: 'Digit2', shiftKey: true })

    const { zoom, panX, panY } = view.store.getState().view.viewport
    expect(zoom).toBeLessThanOrEqual(800 / 400)
    expect(zoom).toBeGreaterThan(1.6)
    expect(panX + (60 + 400 / 2) * zoom).toBeCloseTo(VIEWPORT_SIZE.width / 2)
    expect(panY + (60 + 60 / 2) * zoom).toBeCloseTo(VIEWPORT_SIZE.height / 2)
  })
})

describe('event shield and Interact', () => {
  it('covers the design with a shield that takes pointer events', async () => {
    const view = await openHome()

    expect(shieldOf(view.container).style.pointerEvents).not.toBe('none')
    expect(view.store.getState().interact).toBe(false)
  })

  it('the Interact switch lets pointer events through to the design', async () => {
    const view = await openHome()
    const toggle = interactSwitch(view.container)
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    act(() => toggle.click())
    await settle()

    expect(view.store.getState().interact).toBe(true)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(shieldOf(view.container).style.pointerEvents).toBe('none')

    act(() => toggle.click())
    await settle()

    expect(view.store.getState().interact).toBe(false)
    expect(shieldOf(view.container).style.pointerEvents).not.toBe('none')
  })

  it('holding I passes pointer events through and pauses hover and selection until released', async () => {
    const view = await openHome()
    await hoverAt(view, at.aside)
    expect(outlines(view.container, 'hover')).toHaveLength(1)

    press(view.container, 'keydown', 'i', { code: 'KeyI' })
    await settle()

    expect(view.store.getState().interact).toBe(true)
    expect(shieldOf(view.container).style.pointerEvents).toBe('none')
    expect(outlines(view.container, 'hover')).toEqual([])
    await hoverAt(view, at.label)
    await clickAt(view, at.label)
    expect(view.store.getState().hover).toBeNull()
    expect(view.store.getState().view.selection).toEqual([])

    press(view.container, 'keyup', 'i', { code: 'KeyI' })
    await settle()
    await clickAt(view, at.label)

    expect(view.store.getState().interact).toBe(false)
    expect(view.store.getState().view.selection).toEqual(ids('card'))
  })
})

describe('restore after a reload', () => {
  it('restores selection, scroll and zoom by edId', async () => {
    const view = await openHome()
    await clickAt(view, at.title, { metaKey: true })
    await setViewport(view.store, 1.5, 30, 40)
    act(() => latestProbe().emit({ type: 'scrolled', scrollX: 0, scrollY: 300 }))
    await settle()
    expect(view.store.getState().view.scroll).toEqual({ x: 0, y: 300 })
    latestProbe().scrollTo.mockClear()

    await loadFrame(view.container)

    expect(latestProbe().scrollTo).toHaveBeenCalledWith(0, 300)
    expect(view.store.getState().view.selection).toEqual(ids('title'))
    expect(view.store.getState().view.viewport).toEqual({ zoom: 1.5, panX: 30, panY: 40 })
    expect(outlines(view.container, 'selection')).toHaveLength(1)
    expect(notices(view.store)).not.toContainEqual(expect.stringMatching(/page reset to its first state/i))
  })

  it("shows 'page reset to its first state' when a restored edId is no longer rendered", async () => {
    const view = await openHome()
    await clickAt(view, at.title, { metaKey: true })

    probes.scene.rendered = homeScene.filter(([id]) => id !== 'title')
    await loadFrame(view.container)

    expect(notices(view.store)).toContainEqual(expect.stringMatching(/page reset to its first state/i))
  })
})

describe('hover and selection outlines', () => {
  it('hovers the element a click would select, from the same hit-test', async () => {
    const view = await openHome()
    await setViewport(view.store, 0.5, 100, 50)

    await hoverAt(view, at.label)

    expect(view.store.getState().hover).toBe(edId('card'))
    expectBoxes(outlines(view.container, 'hover'), sceneRects('card').map((rect) => screenBox(view.store, rect)))

    await clickAt(view, at.label)

    expect(view.store.getState().view.selection).toEqual(ids('card'))
    expectBoxes(outlines(view.container, 'selection'), sceneRects('card').map((rect) => screenBox(view.store, rect)))
  })

  it('outlines every rendered repeat of an <sc-for> element', async () => {
    const view = await openHome()
    await setViewport(view.store, 0.5, 100, 50)
    const repeats = sceneRects('item').map((rect) => screenBox(view.store, rect))

    await clickAt(view, at.secondItem, { metaKey: true })

    expect(view.store.getState().view.selection).toEqual(ids('item'))
    expectBoxes(outlines(view.container, 'selection'), repeats)

    await hoverAt(view, { x: 100, y: 420 })

    expect(view.store.getState().hover).toBe(edId('item'))
    expectBoxes(outlines(view.container, 'hover'), repeats)
  })

  it('skips locked layers in the hit-test', async () => {
    const view = await openHome({ locked: ids('aside', 'title') })

    await hoverAt(view, at.aside)
    expect(outlines(view.container, 'hover')).toEqual([])

    await clickAt(view, at.aside)
    expect(view.store.getState().view.selection).toEqual([])

    await clickAt(view, at.title, { metaKey: true })
    expect(view.store.getState().view.selection).toEqual(ids('card'))
  })
})

describe('selection rules on the canvas', () => {
  it('click selects the top-level element, double-click goes one level deeper', async () => {
    const view = await openHome()

    await clickAt(view, at.label)
    expect(view.store.getState().view.selection).toEqual(ids('card'))

    await doubleClickAt(view, at.label)
    expect(view.store.getState().view.selection).toEqual(ids('button'))
  })

  it('Cmd-click selects the deepest element on macOS', async () => {
    const view = await openHome({ platform: 'mac' })

    await clickAt(view, at.label, { metaKey: true })

    expect(view.store.getState().view.selection).toEqual(ids('label'))
  })

  it('Ctrl-click selects the deepest element on Windows', async () => {
    const view = await openHome({ platform: 'windows' })

    await clickAt(view, at.label, { ctrlKey: true })

    expect(view.store.getState().view.selection).toEqual(ids('label'))
  })

  it('Shift-click adds and removes', async () => {
    const view = await openHome()

    await clickAt(view, at.label)
    await clickAt(view, at.aside, { shiftKey: true })
    expect(view.store.getState().view.selection).toEqual(ids('card', 'aside'))

    await clickAt(view, at.title, { shiftKey: true })
    expect(view.store.getState().view.selection).toEqual(ids('aside'))
  })

  it('Enter goes one level deeper and Shift-Enter selects the parent', async () => {
    const view = await openHome()
    await clickAt(view, at.label)

    await pressKey(view.container, 'Enter')
    expect(view.store.getState().view.selection).toEqual(ids('title'))

    await pressKey(view.container, 'Enter', { shiftKey: true })
    expect(view.store.getState().view.selection).toEqual(ids('card'))
  })

  it('Tab and Shift-Tab move between siblings and never leave the canvas', async () => {
    const view = await openHome()
    await clickAt(view, at.title, { metaKey: true })

    const tab = await pressKey(view.container, 'Tab', { code: 'Tab' })
    expect(view.store.getState().view.selection).toEqual(ids('button'))
    expect(tab.defaultPrevented).toBe(true)

    const wrapping = await pressKey(view.container, 'Tab', { code: 'Tab' })
    expect(view.store.getState().view.selection).toEqual(ids('title'))
    expect(wrapping.defaultPrevented).toBe(true)

    const back = await pressKey(view.container, 'Tab', { code: 'Tab', shiftKey: true })
    expect(view.store.getState().view.selection).toEqual(ids('button'))
    expect(back.defaultPrevented).toBe(true)
  })

  it('Tab with nothing selected selects the first top-level element and stays on the canvas', async () => {
    const view = await openHome()

    const tab = await pressKey(view.container, 'Tab', { code: 'Tab' })

    expect(view.store.getState().view.selection).toEqual(ids('card'))
    expect(tab.defaultPrevented).toBe(true)
  })
})

describe('text editing entry', () => {
  it('starts the in-place text edit through the probe on a double-click on a text element', async () => {
    const view = await openHome()
    await clickAt(view, at.title, { metaKey: true })

    await doubleClickAt(view, at.title)

    expect(latestProbe().beginTextEdit).toHaveBeenCalledWith(edId('title'))
  })

  it("shows 'edit in source' for an element with inline children", async () => {
    const view = await openHome()
    await clickAt(view, at.ledeText)
    expect(view.store.getState().view.selection).toEqual(ids('lede'))

    await doubleClickAt(view, at.ledeText)

    expect(latestProbe().beginTextEdit).not.toHaveBeenCalled()
    const shown = notices(view.store)
    expect(shown).toContainEqual(expect.stringMatching(/edit in source/i))
    expect(shown).not.toContainEqual(expect.stringMatching(/live value/i))
  })

  it("shows 'contains a live value; edit in source or Tweaks' for text with a {{hole}}", async () => {
    const view = await openHome()
    await clickAt(view, at.secondItem, { metaKey: true })

    await doubleClickAt(view, at.secondItem)

    expect(latestProbe().beginTextEdit).not.toHaveBeenCalled()
    expect(notices(view.store)).toContainEqual(expect.stringMatching(/contains a live value; edit in source or Tweaks/i))
  })
})

describe('rulers', () => {
  it("highlight the selection's range on both rulers", async () => {
    const view = await openHome()
    await setViewport(view.store, 0.5, 100, 50)

    await clickAt(view, at.secondItem, { metaKey: true })

    const xRange = view.container.querySelector<HTMLElement>('[data-ruler="x"] [data-ruler-range]')
    const yRange = view.container.querySelector<HTMLElement>('[data-ruler="y"] [data-ruler-range]')
    if (!xRange || !yRange) throw new Error('the rulers show no selection range')
    expect(boxOf(xRange).left).toBeCloseTo(100 + 40 * 0.5)
    expect(boxOf(xRange).width).toBeCloseTo(600 * 0.5)
    expect(boxOf(yRange).top).toBeCloseTo(50 + 400 * 0.5)
    expect(boxOf(yRange).height).toBeCloseTo(180 * 0.5)
  })

  it('show no range while nothing is selected', async () => {
    const view = await openHome()

    expect(view.container.querySelector('[data-ruler="x"]')).not.toBeNull()
    expect(view.container.querySelector('[data-ruler="y"]')).not.toBeNull()
    expect(view.container.querySelector('[data-ruler-range]')).toBeNull()
  })
})

describe('canvas tools', () => {
  function tool(id: string, priority: number, claims: boolean) {
    const onPointerDown = vi.fn<PointerHandler>(() => claims)
    const entry: CanvasTool = { id, priority, onPointerDown }
    return { entry, onPointerDown }
  }

  it('orders the tools from every module by descending priority', () => {
    const low = tool('low', 1, false)
    const high = tool('high', 10, false)
    const modules: Record<string, ToolModule> = { './low.tool.ts': { tool: low.entry }, './high.tool.ts': { tool: high.entry } }

    expect(loadCanvasTools(modules).map((entry: CanvasTool) => entry.id)).toEqual(['high', 'low'])
  })

  it('loads the tools from ./tools/*.tool.ts, and there may be none', () => {
    const files = import.meta.glob<ToolModule>('../../../src/ui/canvas/tools/*.tool.ts', { eager: true })
    const exportedIds = Object.values(files).map((file) => file.tool.id)

    expect(defaultCanvasTools().map((entry: CanvasTool) => entry.id).sort()).toEqual(exportedIds.sort())
  })

  it('works with no tools: a click still selects', async () => {
    const view = await openHome({ tools: [] })

    await clickAt(view, at.aside)

    expect(view.store.getState().view.selection).toEqual(ids('aside'))
  })

  it('lets a tool claim a gesture before selection runs, highest priority first', async () => {
    const claiming = tool('claiming', 10, true)
    const lower = tool('lower', 1, false)
    const view = await openHome({ tools: [lower.entry, claiming.entry] })
    await setViewport(view.store, 2, 10, 20)

    await clickAt(view, at.label)

    expect(claiming.onPointerDown).toHaveBeenCalled()
    expect(lower.onPointerDown).not.toHaveBeenCalled()
    expect(view.store.getState().view.selection).toEqual([])
    const [ctx, pointer] = claiming.onPointerDown.mock.calls[0]! as [EditorContext, CanvasPointer]
    expect(pointer).toMatchObject({ x: 10 + at.label.x * 2, y: 20 + at.label.y * 2, boardX: at.label.x, boardY: at.label.y })
    expect(ctx.viewport()).toEqual({ zoom: 2, panX: 10, panY: 20 })
  })

  it('falls through to selection when no tool claims the gesture', async () => {
    const declining = tool('declining', 5, false)
    const view = await openHome({ tools: [declining.entry] })

    await clickAt(view, at.label)

    expect(declining.onPointerDown).toHaveBeenCalled()
    expect(view.store.getState().view.selection).toEqual(ids('card'))
  })
})
