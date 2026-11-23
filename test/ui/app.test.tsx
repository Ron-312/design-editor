// @vitest-environment jsdom
/// <reference types="vite/client" />
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import postcss, { type Rule } from 'postcss'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, ClientMessage, EditorState, ProbeRead, ProbeReadResult, ProbeToEditor, ServerMessage } from '../../src/shared/protocol'
import type { CanvasLayout, EdId, EditOp, EditRecord, ProjectPath, StyleSource, TemplateNode } from '../../src/shared/types'
import * as history from '../../src/ui/actions/history.actions'
import { createActionRegistry, createDefaultRegistry, type Platform } from '../../src/ui/actions/registry'
import { App } from '../../src/ui/App'
import type { EditorContext } from '../../src/ui/plugin-api'
import { createEditorStore, type EditorStore } from '../../src/ui/store'
import { connectWsClient, type WsClient } from '../../src/ui/ws-client'

/** Stands in for the probe inside the artboard frame. */
const probes = vi.hoisted(() => {
  type Listener = (message: ProbeToEditor) => void

  function answer(read: ProbeRead): ProbeReadResult {
    switch (read.kind) {
      case 'hitTest':
        return { kind: 'hitTest', edId: null }
      case 'rects':
        return { kind: 'rects', rects: [{ x: 0, y: 0, width: 10, height: 10 }] }
      case 'snapRects':
        return { kind: 'snapRects', self: { x: 0, y: 0, width: 10, height: 10 }, parent: null, siblings: [] }
      case 'computed':
        return { kind: 'computed', values: {} }
      case 'supports':
        return { kind: 'supports', supported: true }
    }
  }

  function createFakeProbe() {
    const listeners = new Set<Listener>()
    return {
      read: async (read: ProbeRead) => answer(read),
      onMessage(listener: Listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      previewDecl: () => {},
      scrollTo: () => {},
      beginTextEdit: () => 'text-1',
      endTextEdit: () => {},
      dispose: () => {},
      emit(message: ProbeToEditor) {
        for (const listener of listeners) listener(message)
      },
    }
  }

  const created: Array<ReturnType<typeof createFakeProbe>> = []
  return {
    created,
    create() {
      const probe = createFakeProbe()
      created.push(probe)
      return probe
    },
  }
})

vi.mock('../../src/ui/probe-client', () => ({ createProbeClient: () => probes.create() }))

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

/** The browser WebSocket the real ws client opens, with the server's side driven by the test. */
class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static latest: FakeSocket | null = null
  readyState = FakeSocket.OPEN
  readonly sent: ClientMessage[] = []

  constructor(readonly url: string | URL) {
    super()
    FakeSocket.latest = this
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage)
  }

  close() {
    this.readyState = FakeSocket.CLOSED
  }

  receive(message: ServerMessage) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
  }
}

const PROJECT_NAME = 'Studio weekly site'
const edId = (id: string) => id as EdId
const home = 'project/home.dc.html' as ProjectPath
const card = 'project/card.dc.html' as ProjectPath
const layout: CanvasLayout = {
  boards: [
    { path: home, w: 1280, h: 900, page: true },
    { path: card, w: 360, h: 220, page: false },
  ],
  order: [home, card],
  pages: [home],
}
const emptyEditorState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function node(id: string, tag: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children, ...extra }
}

const homeTree = node('root', 'x-dc', [node('main', 'main', [node('header', 'header', [node('title', 'h1')])])], {
  readOnly: 'artboard-root',
})

function inlineAt(file: ProjectPath, line: number, prop: string, value: string): StyleSource {
  return { target: 'inline', file, line, declarations: [{ prop, value, important: false, hasHole: false }] }
}

const homeIndex: BoardIndex = {
  board: home,
  frameSrc: '/project/secret/home.dc.html',
  tree: homeTree,
  locations: {},
  styles: {
    [edId('header')]: [inlineAt(home, 47, 'border-radius', '12px')],
    [edId('title')]: [inlineAt(home, 48, 'font-size', '48px')],
  },
}

function radiusRecord(before: string, after: string): EditRecord {
  return { target: [edId('header')], kind: 'setDecl', prop: 'border-radius', before, after, scope: { kind: 'element' }, files: [home] }
}

const setRadius: EditOp = { target: [edId('header')], kind: 'setDecl', payload: { prop: 'border-radius', value: '16px' } }

interface Shell {
  readonly store: EditorStore
  readonly ws: WsClient
  readonly socket: FakeSocket
  readonly container: HTMLElement
}

let mounted: { root: Root; container: HTMLElement } | null = null

async function settle() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
}

async function receive(socket: FakeSocket, message: ServerMessage) {
  act(() => socket.receive(message))
  await settle()
}

async function mountShell(platform: Platform = 'mac'): Promise<Shell> {
  const container = document.createElement('div')
  document.body.append(container)
  const store = createEditorStore()
  const ws = connectWsClient({ host: '127.0.0.1:5300', token: 'launch-token', store, reloadFrame: () => {} })
  const socket = FakeSocket.latest!
  const root = createRoot(container)
  mounted = { root, container }
  act(() => root.render(<App store={store} ws={ws} platform={platform} projectName={PROJECT_NAME} />))
  await settle()
  return { store, ws, socket, container }
}

async function openHome(options: { readOnly?: boolean; platform?: Platform } = {}): Promise<Shell> {
  const shell = await mountShell(options.platform)
  await receive(shell.socket, { type: 'hello', layout, editorState: emptyEditorState, readOnly: options.readOnly ?? false })
  await receive(shell.socket, { type: 'index', index: homeIndex })
  return shell
}

/** Sends an op the way a panel does and answers it with the server's ack. */
async function editAndAck(shell: Shell, record: EditRecord) {
  const acked = shell.ws.sendOp(setRadius, {})
  const sent = shell.socket.sent.filter((message) => message.type === 'op').at(-1)
  if (sent?.type !== 'op') throw new Error('the ws client sent no op')
  await receive(shell.socket, { type: 'ack', opId: sent.opId, record, mintedIds: [], locations: {}, resolved: {}, reload: false })
  await acked
}

function accessibleName(element: Element): string {
  return (element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent ?? '').trim()
}

function buttonsNamed(scope: ParentNode, name: RegExp): HTMLButtonElement[] {
  return [...scope.querySelectorAll('button')].filter((button) => name.test(accessibleName(button)))
}

function buttonNamed(scope: ParentNode, name: RegExp): HTMLButtonElement {
  const [button] = buttonsNamed(scope, name)
  if (!button) throw new Error(`no button named ${name}`)
  return button
}

async function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await settle()
}

function text(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function topBar(container: HTMLElement): HTMLElement {
  const header = container.querySelector('header')
  if (!header) throw new Error('the shell has no top bar')
  return header
}

function syncStrip(container: HTMLElement): HTMLElement {
  const strip = container.querySelector<HTMLElement>('[role="status"][aria-label^="Sync status"]')
  if (!strip) throw new Error('the top bar has no sync strip')
  return strip
}

function saveToast(container: HTMLElement): HTMLElement {
  const toast = [...container.querySelectorAll<HTMLElement>('[role="status"]')].find((status) => text(status).includes('→'))
  if (!toast) throw new Error('no save toast is shown')
  return toast
}

function currentSyncStep(container: HTMLElement): string {
  return text(syncStrip(container).querySelector('[aria-current="step"]'))
}

async function pressInCanvas(container: HTMLElement, key: string, init: KeyboardEventInit) {
  const target = container.querySelector('[data-canvas-viewport]') ?? container
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  await settle()
  return event
}

function sentOfType<T extends ClientMessage['type']>(socket: FakeSocket, type: T) {
  return socket.sent.filter((message): message is Extract<ClientMessage, { type: T }> => message.type === type)
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  for (const method of ['setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(method in Element.prototype)) Object.defineProperty(Element.prototype, method, { configurable: true, value: () => {} })
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
  FakeSocket.latest = null
  document.documentElement.classList.remove('light')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('theme tokens', () => {
  type Tokens = Record<string, string>

  // The jsdom environment replaces the global URL, which node:fs does not accept.
  const repoFile = (relative: string) => fileURLToPath(new NodeURL(`../../${relative}`, import.meta.url))

  function customPropertiesOf(css: string, selector: string): Tokens {
    const tokens: Tokens = {}
    postcss.parse(css).each((child) => {
      if (child.type !== 'rule' || (child as Rule).selector !== selector) return
      ;(child as Rule).walkDecls(/^--/, (decl) => {
        tokens[decl.prop] = decl.value
      })
    })
    return tokens
  }

  function mockupCss(): string {
    const html = readFileSync(repoFile('design/ui-options/b-warm-studio.html'), 'utf8')
    return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n')
  }

  const themeCss = () => readFileSync(repoFile('src/ui/theme.css'), 'utf8')

  it.each([':root', 'html.light'])("defines exactly the mockup's %s token values", (selector) => {
    const mockup = customPropertiesOf(mockupCss(), selector)
    expect(Object.keys(mockup).length).toBeGreaterThan(20)

    expect(customPropertiesOf(themeCss(), selector)).toEqual(mockup)
  })
})

describe('editor shell', () => {
  it('lays out the layers, canvas and properties panels with the Interact switch', async () => {
    const { container } = await openHome()

    expect(container.querySelector('nav[aria-label="Layers"] [role="tree"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Canvas"]')).not.toBeNull()
    expect(container.querySelector('aside[aria-label="Properties"]')).not.toBeNull()
    expect(container.querySelector('[role="switch"][aria-label="Interact"]')).not.toBeNull()
  })

  it('shows the project name and the open board name in the top bar', async () => {
    const { container } = await openHome()

    const bar = text(topBar(container))
    expect(bar).toContain(PROJECT_NAME)
    expect(bar).toContain('home.dc.html')
  })

  it('names the board that is open after a board switch', async () => {
    const { container, store, socket } = await openHome()

    act(() => store.setBoard(card))
    await receive(socket, { type: 'index', index: { ...homeIndex, board: card, frameSrc: '/project/secret/card.dc.html' } })

    expect(text(topBar(container))).toContain('card.dc.html')
  })

  it('shares one selection between the canvas, the layers row and the selector chip', async () => {
    const { container, store } = await openHome()

    act(() => store.select([edId('header')]))
    await settle()

    const selectedRows = [...container.querySelectorAll('[role="treeitem"][aria-selected="true"]')]
    expect(selectedRows.map((row) => row.getAttribute('data-layer-id'))).toEqual(['header'])
    expect(text(container.querySelector('[data-selector-chip]'))).toBe('style · home.dc.html:47')
  })

  it('saves a layer hidden in the layers panel through saveEditorState', async () => {
    const { container, socket } = await openHome()
    const headerRow = container.querySelector('[role="treeitem"][data-layer-id="header"]')!

    await click(buttonNamed(headerRow, /^Hide$/))

    expect(sentOfType(socket, 'saveEditorState').at(-1)?.state.hidden).toEqual(['header'])
    expect(container.querySelector('[role="treeitem"][data-layer-id="header"]')?.hasAttribute('data-hidden')).toBe(true)
  })
})

describe('sync strip', () => {
  it('reads Pulled → Edited → Pushing, with Pulled current before any edit', async () => {
    const { container } = await openHome()

    expect(text(syncStrip(container))).toMatch(/Pulled.*Edited.*Pushing/)
    expect(currentSyncStep(container)).toMatch(/^Pulled/)
  })

  it('counts the edits of the session on the Edited step', async () => {
    const shell = await openHome()

    await editAndAck(shell, radiusRecord('12px', '16px'))
    await editAndAck(shell, radiusRecord('16px', '20px'))

    expect(currentSyncStep(shell.container)).toMatch(/^Edited · 2$/)
  })

  it('makes Pushing current while a push holds the lock', async () => {
    const { container, socket } = await openHome()

    await receive(socket, { type: 'pushLock', held: true })

    expect(currentSyncStep(container)).toMatch(/^Pushing/)
  })
})

describe('banners', () => {
  it("shows 'Push in progress' while a push holds the lock and clears it after", async () => {
    const { container, socket } = await openHome()

    await receive(socket, { type: 'pushLock', held: true })
    expect(text(container)).toContain('Push in progress')

    await receive(socket, { type: 'pushLock', held: false })
    expect(text(container)).not.toContain('Push in progress')
  })

  it("shows 'Push in progress' when the editor opens while a push holds the lock", async () => {
    const { container } = await openHome({ readOnly: true })

    expect(text(container)).toContain('Push in progress')
  })

  it('shows the synced-folder warning banner', async () => {
    const { container, store } = await openHome()
    const warning = 'This project is in a synced folder (OneDrive or Dropbox); file changes are polled and may lag'

    act(() => store.showBanner({ id: 'synced-folder', message: warning }))
    await settle()

    expect(text(container)).toContain(warning)
  })

  it('names the font family that failed to load in the offline banner', async () => {
    const { container } = await openHome()
    const probe = probes.created.at(-1)
    if (!probe) throw new Error('the canvas created no probe client')

    act(() => probe.emit({ type: 'fontsFailed', families: ['Fraunces'] }))
    await settle()

    expect(text(container)).toContain('offline: Fraunces not loaded, layout may differ; sizes tuned now may be off')
  })
})

describe('save toast', () => {
  it('echoes the splice with its line and offers Undo and Diff', async () => {
    const shell = await openHome()

    await editAndAck(shell, radiusRecord('12px', '16px'))

    const toast = saveToast(shell.container)
    expect(text(toast)).toContain('home.dc.html')
    expect(text(toast)).toMatch(/border-radius: 12px → 16px\s+L47/)
    expect(buttonsNamed(toast, /^Undo$/)).toHaveLength(1)
    expect(buttonsNamed(toast, /^Diff$/)).toHaveLength(1)
  })

  it('Undo on the toast asks the server to undo', async () => {
    const shell = await openHome()
    await editAndAck(shell, radiusRecord('12px', '16px'))

    await click(buttonNamed(saveToast(shell.container), /^Undo$/))

    expect(sentOfType(shell.socket, 'undo')).toHaveLength(1)
  })

  it("Diff on the toast opens the diff panel, whose 'Revert file' reverts that file", async () => {
    const shell = await openHome()
    await editAndAck(shell, radiusRecord('12px', '16px'))

    await click(buttonNamed(saveToast(shell.container), /^Diff$/))
    const group = shell.container.querySelector(`[data-diff-file="${home}"]`)
    expect(text(group)).toContain('border-radius: 12px → 16px')

    await click(buttonNamed(group!, /^Revert file$/))
    expect(sentOfType(shell.socket, 'revertFile')).toEqual([{ type: 'revertFile', file: home }])
  })
})

describe('theme toggle', () => {
  it('the sun/moon button switches html between the dark and light themes', async () => {
    const { container } = await openHome()
    const toggle = buttonNamed(container, /light \/ dark/i)

    await click(toggle)
    expect(document.documentElement.classList.contains('light')).toBe(true)

    await click(toggle)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })
})

describe('undo and redo', () => {
  it.each<[Platform, KeyboardEventInit, KeyboardEventInit]>([
    ['mac', { metaKey: true }, { metaKey: true, shiftKey: true }],
    ['windows', { ctrlKey: true }, { ctrlKey: true, shiftKey: true }],
  ])('on %s, Mod-Z undoes and Mod-Shift-Z redoes from anywhere in the shell', async (platform, undoKeys, redoKeys) => {
    const shell = await openHome({ platform })

    const undo = await pressInCanvas(shell.container, 'z', undoKeys)
    const redo = await pressInCanvas(shell.container, 'Z', redoKeys)

    expect(sentOfType(shell.socket, 'undo')).toHaveLength(1)
    expect(sentOfType(shell.socket, 'redo')).toHaveLength(1)
    expect(undo.defaultPrevented).toBe(true)
    expect(redo.defaultPrevented).toBe(true)
  })

  it('the top bar Undo and Redo buttons undo and redo', async () => {
    const shell = await openHome()
    await receive(shell.socket, {
      type: 'undoState',
      state: { canUndo: true, canRedo: true, undoLabel: 'border-radius', redoLabel: 'border-radius' },
    })

    await click(buttonNamed(topBar(shell.container), /^Undo\b/))
    await click(buttonNamed(topBar(shell.container), /^Redo\b/))

    expect(sentOfType(shell.socket, 'undo')).toHaveLength(1)
    expect(sentOfType(shell.socket, 'redo')).toHaveLength(1)
  })

  it('sends neither while a push holds the lock, and both again once it ends', async () => {
    const shell = await openHome()
    await receive(shell.socket, { type: 'pushLock', held: true })

    await pressInCanvas(shell.container, 'z', { metaKey: true })
    await pressInCanvas(shell.container, 'Z', { metaKey: true, shiftKey: true })
    expect(sentOfType(shell.socket, 'undo')).toHaveLength(0)
    expect(sentOfType(shell.socket, 'redo')).toHaveLength(0)

    await receive(shell.socket, { type: 'pushLock', held: false })
    await pressInCanvas(shell.container, 'z', { metaKey: true })
    await pressInCanvas(shell.container, 'Z', { metaKey: true, shiftKey: true })
    expect(sentOfType(shell.socket, 'undo')).toHaveLength(1)
    expect(sentOfType(shell.socket, 'redo')).toHaveLength(1)
  })
})

describe('history actions', () => {
  function contextWith(readOnly: boolean) {
    const undo = vi.fn()
    const redo = vi.fn()
    const ctx = { readOnly: () => readOnly, undo, redo } as unknown as EditorContext
    return { ctx, undo, redo }
  }

  function keydown(key: string, modifiers: KeyboardEventInit) {
    return new KeyboardEvent('keydown', { key, cancelable: true, ...modifiers })
  }

  const historyRegistry = (platform: Platform) => createActionRegistry({ './history.actions.ts': history }, platform)

  it('registers Undo and Redo in the default registry', () => {
    const labels = createDefaultRegistry('mac').all().map((entry) => entry.label)

    expect(labels).toEqual(expect.arrayContaining(['Undo', 'Redo']))
  })

  it.each<[Platform, KeyboardEventInit]>([
    ['mac', { metaKey: true }],
    ['windows', { ctrlKey: true }],
  ])('on %s, Mod-Z runs undo and Mod-Shift-Z runs redo', (platform, mod) => {
    const registry = historyRegistry(platform)
    const { ctx, undo, redo } = contextWith(false)

    expect(registry.handleKeyDown(keydown('z', mod), ctx)).toBe(true)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).not.toHaveBeenCalled()

    expect(registry.handleKeyDown(keydown('Z', { ...mod, shiftKey: true }), ctx)).toBe(true)
    expect(redo).toHaveBeenCalledTimes(1)
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('is blocked while push-locked', () => {
    const registry = historyRegistry('mac')
    const { ctx, undo, redo } = contextWith(true)

    expect(registry.handleKeyDown(keydown('z', { metaKey: true }), ctx)).toBe(false)
    expect(registry.handleKeyDown(keydown('Z', { metaKey: true, shiftKey: true }), ctx)).toBe(false)
    expect(undo).not.toHaveBeenCalled()
    expect(redo).not.toHaveBeenCalled()
  })
})
