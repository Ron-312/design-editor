// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, ClientMessage, EditorState, ProbeRead, ProbeReadResult, ProbeToEditor, ServerMessage } from '../../../src/shared/protocol'
import type { CanvasLayout, EdId, ProjectPath, TemplateNode } from '../../../src/shared/types'
import { App } from '../../../src/ui/App'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'
import { connectWsClient } from '../../../src/ui/ws-client'

vi.mock('../../../src/ui/probe-client', () => ({
  createProbeClient: () => {
    const answer = (read: ProbeRead): ProbeReadResult => {
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
        case 'matches':
          return { kind: 'matches', matched: [] }
        case 'documentHeight':
          return { kind: 'documentHeight', scrollHeight: 0 }
      }
    }
    return {
      read: async (read: ProbeRead) => answer(read),
      onMessage: (_listener: (message: ProbeToEditor) => void) => () => {},
      previewDecl: () => {},
      scrollTo: () => {},
      beginTextEdit: () => 'text-1',
      endTextEdit: () => {},
      dispose: () => {},
    }
  },
}))

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

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

const edId = (id: string) => id as EdId
const home = 'project/home.dc.html' as ProjectPath
const layout: CanvasLayout = { boards: [{ path: home, w: 1280, h: 900, page: true }], order: [home], pages: [home] }
const node = (id: string, tag: string, children: TemplateNode[] = []): TemplateNode => ({ edId: edId(id), kind: 'element', tag, name: id, children })
const homeIndex: BoardIndex = {
  board: home,
  frameSrc: '/project/secret/home.dc.html',
  tree: { ...node('root', 'x-dc', [node('header', 'header'), node('footer', 'footer')]), readOnly: 'artboard-root' },
  locations: {},
  styles: {},
  text: '',
  rules: [],
}

interface Shell {
  readonly store: EditorStore
  readonly socket: FakeSocket
  readonly container: HTMLElement
}

let mounted: { root: Root; container: HTMLElement } | null = null

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
})

afterEach(() => {
  unmount()
  FakeSocket.latest = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function unmount() {
  if (!mounted) return
  const { root, container } = mounted
  act(() => root.unmount())
  container.remove()
  mounted = null
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)))
}

function mountShell(): Shell {
  const container = document.createElement('div')
  document.body.append(container)
  const store = createEditorStore()
  const ws = connectWsClient({ host: '127.0.0.1:5300', token: 'launch-token', store, reloadFrame: () => {} })
  const socket = FakeSocket.latest!
  const root = createRoot(container)
  mounted = { root, container }
  act(() => root.render(<App store={store} ws={ws} platform="windows" projectName="Notices" />))
  return { store, socket, container }
}

async function openHome(editorState: EditorState): Promise<Shell> {
  const shell = mountShell()
  await settle()
  await receive(shell.socket, { type: 'hello', layout, editorState, readOnly: false })
  await receive(shell.socket, { type: 'index', index: homeIndex })
  return shell
}

async function receive(socket: FakeSocket, message: ServerMessage) {
  act(() => socket.receive(message))
  await settle()
}

function text(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function toastSaying(container: HTMLElement, words: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('.toasts [role="status"]')].find((toast) => text(toast).includes(words))
}

function buttonNamed(scope: ParentNode, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((button) => text(button) === name)
  if (!found) throw new Error(`no button named ${name}`)
  return found
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function sentOfType<T extends ClientMessage['type']>(socket: FakeSocket, type: T) {
  return socket.sent.filter((message): message is Extract<ClientMessage, { type: T }> => message.type === type)
}

const OUTSIDE = 'home.dc.html changed outside the editor while edits were waiting to save'
const emptyState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

describe('an outside change while edits wait to save', () => {
  it.each([
    ['Keep mine', true],
    ['Use the file', false],
  ])('asks which version to keep, and %s resolves the pending edits that way', async (label, keep) => {
    const { socket, container } = await openHome(emptyState)

    await receive(socket, { type: 'outsideChange', file: home, pendingOps: true, replacedIds: {} })
    const question = toastSaying(container, OUTSIDE)
    expect(question?.className).toContain('warning')
    click(buttonNamed(question!, label))

    expect(sentOfType(socket, 'resolvePending')).toEqual([{ type: 'resolvePending', file: home, keep }])
    expect(toastSaying(container, OUTSIDE)).toBeUndefined()
  })

  it('asks nothing when no edits were waiting', async () => {
    const { socket, container } = await openHome(emptyState)

    await receive(socket, { type: 'outsideChange', file: home, pendingOps: false, replacedIds: {} })

    expect(toastSaying(container, 'changed outside the editor')).toBeUndefined()
  })

  it('moves the hidden and locked layers onto the ids the reload gave their nodes', async () => {
    const { socket, container } = await openHome({ ...emptyState, hidden: [edId('header')], locked: [edId('header')] })
    const row = (id: string) => container.querySelector(`[role="treeitem"][data-layer-id="${id}"]`)
    expect(row('header')?.hasAttribute('data-hidden')).toBe(true)

    await receive(socket, { type: 'outsideChange', file: home, pendingOps: false, replacedIds: { [edId('header')]: edId('footer') } })

    expect(row('footer')?.hasAttribute('data-hidden')).toBe(true)
    expect(row('header')?.hasAttribute('data-hidden')).toBe(false)
  })
})

describe('the stale push question', () => {
  it('Keep waiting closes the question and sends nothing', async () => {
    const { socket, container } = await openHome(emptyState)
    await receive(socket, { type: 'pushStale', heldForMs: 45 * 60_000 })
    const question = toastSaying(container, 'A push has held the canvas for 45 min')!
    const sentBefore = socket.sent.length

    click(buttonNamed(question, 'Keep waiting'))

    expect(toastSaying(container, 'A push has held the canvas')).toBeUndefined()
    expect(socket.sent).toHaveLength(sentBefore)
  })

  it('goes away by itself once the push releases the lock', async () => {
    const { socket, container } = await openHome(emptyState)
    await receive(socket, { type: 'pushStale', heldForMs: 31 * 60_000 })

    await receive(socket, { type: 'pushLock', held: false })

    expect(toastSaying(container, 'A push has held the canvas')).toBeUndefined()
  })
})

describe('notice toasts', () => {
  it('fade after six seconds when they ask nothing', () => {
    vi.useFakeTimers()
    const { store, container } = mountShell()

    act(() => {
      store.toast({ message: 'Saved elsewhere', tone: 'info' })
    })
    act(() => vi.advanceTimersByTime(5_999))
    expect(toastSaying(container, 'Saved elsewhere')).toBeDefined()

    act(() => vi.advanceTimersByTime(1))
    expect(toastSaying(container, 'Saved elsewhere')).toBeUndefined()
    expect(store.getState().toasts).toEqual([])
  })

  it('stay until answered when they ask a question', () => {
    vi.useFakeTimers()
    const { store, container } = mountShell()

    act(() => {
      store.toast({ message: 'Pick one', tone: 'warning', actions: [{ label: 'OK', run: () => {} }] })
    })
    act(() => vi.advanceTimersByTime(60_000))

    expect(toastSaying(container, 'Pick one')).toBeDefined()
  })

  it('cancel their fade timer when the shell goes away', () => {
    vi.useFakeTimers()
    const { store } = mountShell()
    act(() => {
      store.toast({ message: 'Short lived', tone: 'info' })
    })
    const dismiss = vi.spyOn(store, 'dismissToast')

    unmount()
    vi.advanceTimersByTime(10_000)

    expect(dismiss).not.toHaveBeenCalled()
  })

  it('names a locked file in a write failure', async () => {
    const { socket, container } = await openHome(emptyState)

    await receive(socket, { type: 'writeFailed', file: home, reason: 'locked', message: 'project/home.dc.html: EBUSY' })

    expect(toastSaying(container, 'File locked by another program: project/home.dc.html: EBUSY')?.className).toContain('error')
  })
})
