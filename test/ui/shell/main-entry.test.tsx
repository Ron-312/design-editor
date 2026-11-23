// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WS_PATH, WS_TOKEN_PARAM, type ServerMessage } from '../../../src/shared/protocol'
import type { EdId, ProjectPath } from '../../../src/shared/types'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static latest: FakeSocket | null = null
  readyState = FakeSocket.OPEN

  constructor(readonly url: string | URL) {
    super()
    FakeSocket.latest = this
  }

  send() {}

  close() {
    this.readyState = FakeSocket.CLOSED
  }

  receive(message: ServerMessage) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
  }
}

const TOKEN = 'per-launch-token'
const home = 'project/home.dc.html' as ProjectPath
const reloadingUndo: ServerMessage = {
  type: 'restored',
  record: { target: ['e1' as EdId], kind: 'setText', prop: null, before: 'a', after: 'b', scope: { kind: 'element' }, files: [home] },
  locations: {},
  resolved: {},
  reload: true,
  declarations: [],
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.resetModules()
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="root"></div>'
  document.title = 'Studio weekly'
  document.documentElement.classList.remove('light')
  history.replaceState(null, '', '/')
})

afterEach(() => {
  act(() => {
    document.body.innerHTML = ''
  })
  FakeSocket.latest = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function withToken(token = TOKEN) {
  const meta = document.createElement('meta')
  meta.name = 'design-editor-token'
  meta.content = token
  document.head.append(meta)
}

async function boot(platform = 'MacIntel') {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
  await act(async () => {
    await import('../../../src/ui/main')
  })
}

function undoButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((button) => button.title.startsWith('Undo'))
}

describe('the editor page entry', () => {
  it('renders the shell into #root, named after the page title', async () => {
    withToken()

    await boot()

    expect(document.querySelector('#root header .proj')?.textContent).toContain('Studio weekly')
  })

  it('opens the edit socket on its own host with the launch token from the page', async () => {
    withToken()

    await boot()

    const url = new URL(String(FakeSocket.latest?.url))
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(`ws://${location.host}${WS_PATH}`)
    expect(url.searchParams.get(WS_TOKEN_PARAM)).toBe(TOKEN)
  })

  it.each([
    ['MacIntel', 'Undo  ⌘Z'],
    ['iPad', 'Undo  ⌘Z'],
    ['Win32', 'Undo  Ctrl+Z'],
    ['Linux x86_64', 'Undo  Ctrl+Z'],
  ])('on platform %s shows the shortcut %s', async (platform, title) => {
    withToken()

    await boot(platform)

    expect(undoButton()?.title).toBe(title)
  })

  it('starts in the light theme only with #light', async () => {
    withToken()
    history.replaceState(null, '', '/#light')

    await boot()

    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('starts in the dark theme without #light', async () => {
    withToken()

    await boot()

    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it.each([
    ['no token meta', () => {}],
    ['an empty token', () => withToken('')],
  ])('refuses to start with %s and opens no socket', async (_label, setUp) => {
    setUp()

    await expect(import('../../../src/ui/main')).rejects.toThrow('the editor page carries no launch token')
    expect(FakeSocket.latest).toBeNull()
  })
})

describe('reloading the artboard', () => {
  it('re-navigates the canvas frame to its own src when the server asks for a reload', async () => {
    withToken()
    await boot()
    const canvas = document.createElement('div')
    canvas.setAttribute('aria-label', 'Canvas')
    const frame = document.createElement('iframe')
    frame.src = 'http://127.0.0.1:5301/project/secret/home.dc.html'
    canvas.append(frame)
    document.body.append(canvas)
    const setAttribute = vi.spyOn(frame, 'setAttribute')

    act(() => FakeSocket.latest!.receive(reloadingUndo))

    expect(setAttribute).toHaveBeenCalledExactlyOnceWith('src', 'http://127.0.0.1:5301/project/secret/home.dc.html')
  })

  it('does nothing when no canvas frame is on the page', async () => {
    withToken()
    await boot()

    expect(() => act(() => FakeSocket.latest!.receive(reloadingUndo))).not.toThrow()
  })
})
