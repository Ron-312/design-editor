// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorState } from '../../../src/shared/protocol'
import { createDefaultRegistry, type ActionRegistry, type Platform } from '../../../src/ui/actions/registry'
import { screenToBoard } from '../../../src/ui/canvas/viewport'
import type { EditorAction, EditorContext, Viewport } from '../../../src/ui/plugin-api'

const VIEW_SIZE = { width: 800, height: 600 }
const CENTRE = { x: VIEW_SIZE.width / 2, y: VIEW_SIZE.height / 2 }
const START: Viewport = { zoom: 1, panX: 40, panY: -20 }

const editorState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function fakeContext(viewport: Viewport = START) {
  const spies = {
    viewport: vi.fn(() => viewport),
    setViewport: vi.fn<(next: Viewport) => void>(),
    fit: vi.fn(),
    setMode: vi.fn(),
    setEditorState: vi.fn(),
    editorState: vi.fn(() => editorState),
    apply: vi.fn(),
    select: vi.fn(),
    selection: vi.fn(() => null),
    index: vi.fn(() => null),
    readOnly: vi.fn(() => false),
    toast: vi.fn(),
    cancelGesture: vi.fn(() => false),
    beginAction: vi.fn(() => 'action-1'),
  }
  return spies as typeof spies & EditorContext
}

let ctx = fakeContext()

/** The shell as the registry sees it, with a canvas viewport of a known size. */
function mountShell() {
  document.body.innerHTML = `
    <header class="top"><button type="button" id="undo-button">Undo</button></header>
    <nav class="layers" aria-label="Layers">
      <div role="tree" aria-label="Layers">
        <div role="treeitem" tabindex="0" id="layer-row" data-layer-id="card"><span>card</span></div>
      </div>
    </nav>
    <div data-canvas-viewport="" tabindex="0" id="canvas"><div data-canvas-shield="" id="shield"></div></div>
  `
  const canvas = document.getElementById('canvas')!
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: VIEW_SIZE.width })
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: VIEW_SIZE.height })
  canvas.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, ...VIEW_SIZE })
  return { button: document.getElementById('undo-button')!, layerRow: document.getElementById('layer-row')!, canvas }
}

let shell = mountShell()

beforeEach(() => {
  ctx = fakeContext()
  shell = mountShell()
})

afterEach(() => {
  document.body.innerHTML = ''
})

/** Dispatches a real keydown at `target` and hands it to the registry the way the app's document listener does. */
function fire(registry: ActionRegistry, init: KeyboardEventInit, target: EventTarget = shell.canvas) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  let handled: boolean | undefined
  const listen = (dispatched: Event) => {
    handled = registry.handleKeyDown(dispatched as KeyboardEvent, ctx)
  }
  document.addEventListener('keydown', listen)
  target.dispatchEvent(event)
  document.removeEventListener('keydown', listen)
  return { event, handled }
}

function aliasesOf(action: EditorAction): readonly string[] {
  if (action.kbd === undefined) return []
  return typeof action.kbd === 'string' ? [action.kbd] : action.kbd
}

function actionBoundTo(registry: ActionRegistry, kbd: string): EditorAction {
  const found = registry.all().find((action) => aliasesOf(action).includes(kbd))
  if (!found) throw new Error(`no action is bound to ${kbd}`)
  return found
}

function onlyViewport(): Viewport {
  expect(ctx.setViewport).toHaveBeenCalledTimes(1)
  return ctx.setViewport.mock.calls[0]![0]
}

function expectCentreKept(after: Viewport) {
  const before = screenToBoard(START, CENTRE)
  const now = screenToBoard(after, CENTRE)
  expect(now.x).toBeCloseTo(before.x)
  expect(now.y).toBeCloseTo(before.y)
}

const PLATFORM_MOD: ReadonlyArray<readonly [Platform, KeyboardEventInit]> = [
  ['windows', { ctrlKey: true }],
  ['mac', { metaKey: true }],
]

describe('zoom to 100%', () => {
  it('Shift-0 on the canvas zooms to 100% and prevents the key', () => {
    const registry = createDefaultRegistry('mac')

    const pressed = fire(registry, { key: ')', code: 'Digit0', shiftKey: true })

    expect(pressed.handled).toBe(true)
    expect(pressed.event.defaultPrevented).toBe(true)
    expect(ctx.fit).toHaveBeenCalledExactlyOnceWith('100')
  })

  it('Shift-0 works from the layers panel too', () => {
    const registry = createDefaultRegistry('windows')

    fire(registry, { key: ')', code: 'Digit0', shiftKey: true }, shell.layerRow)

    expect(ctx.fit).toHaveBeenCalledExactlyOnceWith('100')
  })

  it('Shift-0 from a top-bar button is left alone', () => {
    const registry = createDefaultRegistry('mac')

    const pressed = fire(registry, { key: ')', code: 'Digit0', shiftKey: true }, shell.button)

    expect(pressed.handled).toBe(false)
    expect(pressed.event.defaultPrevented).toBe(false)
    expect(ctx.fit).not.toHaveBeenCalled()
  })
})

describe('zoom in and out around the centre of the view', () => {
  it.each(PLATFORM_MOD)('Mod-= on %s doubles the zoom and keeps the board point at the centre', (platform, mod) => {
    const registry = createDefaultRegistry(platform)

    const pressed = fire(registry, { key: '=', code: 'Equal', ...mod })

    expect(pressed.handled).toBe(true)
    expect(pressed.event.defaultPrevented).toBe(true)
    const after = onlyViewport()
    expect(after.zoom).toBeCloseTo(2)
    expectCentreKept(after)
  })

  it('Mod-+ is an alias of Mod-=', () => {
    const registry = createDefaultRegistry('windows')

    fire(registry, { key: '+', code: 'Equal', ctrlKey: true, shiftKey: true })

    const after = onlyViewport()
    expect(after.zoom).toBeCloseTo(2)
    expectCentreKept(after)
  })

  it('menus show Mod-= for zoom in, ahead of its alias', () => {
    const registry = createDefaultRegistry('mac')

    const zoomIn = actionBoundTo(registry, 'Mod++')

    expect(registry.shortcutOf(zoomIn.id)).toBe('Mod+=')
  })

  it.each(PLATFORM_MOD)('Mod-- on %s halves the zoom and keeps the board point at the centre', (platform, mod) => {
    const registry = createDefaultRegistry(platform)

    const pressed = fire(registry, { key: '-', code: 'Minus', ...mod })

    expect(pressed.handled).toBe(true)
    const after = onlyViewport()
    expect(after.zoom).toBeCloseTo(0.5)
    expectCentreKept(after)
  })

  it('zooming never writes the source and never fits', () => {
    const registry = createDefaultRegistry('windows')

    fire(registry, { key: '=', code: 'Equal', ctrlKey: true })
    fire(registry, { key: '-', code: 'Minus', ctrlKey: true })

    expect(ctx.apply).not.toHaveBeenCalled()
    expect(ctx.fit).not.toHaveBeenCalled()
    expect(ctx.setEditorState).not.toHaveBeenCalled()
  })
})

describe('outline mode', () => {
  it('is a palette action named Toggle outline mode, bound to Mod-Shift-O', () => {
    const registry = createDefaultRegistry('mac')

    const toggle = registry.all().find((action) => action.label === 'Toggle outline mode')

    expect(toggle).toBeDefined()
    expect(registry.shortcutOf(toggle!.id)).toBe('Mod+Shift+O')
  })

  it.each(PLATFORM_MOD)('Mod-Shift-O on %s is handled and prevented, so the browser keeps none of it', (platform, mod) => {
    const registry = createDefaultRegistry(platform)

    const pressed = fire(registry, { key: 'O', code: 'KeyO', shiftKey: true, ...mod })

    expect(pressed.handled).toBe(true)
    expect(pressed.event.defaultPrevented).toBe(true)
  })

  it('toggling never writes the source, never saves editor state and leaves the view alone', () => {
    const registry = createDefaultRegistry('mac')

    fire(registry, { key: 'O', code: 'KeyO', shiftKey: true, metaKey: true })
    fire(registry, { key: 'O', code: 'KeyO', shiftKey: true, metaKey: true })

    expect(ctx.apply).not.toHaveBeenCalled()
    expect(ctx.setEditorState).not.toHaveBeenCalled()
    expect(ctx.setViewport).not.toHaveBeenCalled()
  })
})
