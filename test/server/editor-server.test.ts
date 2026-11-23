import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { startEditor } from '../../src/server/main'
import { HTTP_ROUTES, TOKEN_HEADER, WS_PATH, WS_TOKEN_PARAM, type BoardIndex, type ServerMessage } from '../../src/shared/protocol'
import type { ProjectPath } from '../../src/shared/types'

const CANVAS = fileURLToPath(new URL('../fixtures/canvas/', import.meta.url))
const HOME = 'project/home.dc.html' as ProjectPath
const UI_MARKER = 'design-editor-ui-shell'
const WS_KEY = 'dGhlIHNhbXBsZSBub25jZQ=='
const UPGRADE_WAIT_MS = 2_000

interface Running {
  readonly root: string
  readonly port: number
  readonly projectPort: number
  readonly token: string
  readonly close: () => Promise<void>
}

interface Reply {
  readonly status: number
  readonly body: string
}

interface RequestOptions {
  readonly method?: string
  readonly host?: string
  readonly origin?: string
  readonly token?: string
}

const parents: string[] = []
const editors: Running[] = []
const sockets: WebSocket[] = []
let uiDir = ''

beforeAll(() => {
  uiDir = mkdtempSync(path.join(tmpdir(), 'ed ui '))
  writeFileSync(path.join(uiDir, 'index.html'), `<!doctype html><html><head><title>${UI_MARKER}</title></head><body><div id="root"></div></body></html>\n`)
})

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate()
  for (const editor of editors.splice(0)) await editor.close()
  for (const parent of parents.splice(0)) rmSync(parent, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(uiDir, { recursive: true, force: true })
})

function makeProject(): string {
  const parent = mkdtempSync(path.join(tmpdir(), 'ed listener '))
  parents.push(parent)
  const root = path.join(parent, 'Café board ü')
  cpSync(path.join(CANVAS, 'project'), path.join(root, 'project'), { recursive: true })
  cpSync(path.join(CANVAS, 'fetched'), path.join(root, '.editor', 'cache'), { recursive: true })
  return root
}

async function isFree(port: number): Promise<boolean> {
  const server = net.createServer()
  const bound = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => resolve(true))
  })
  if (bound) await new Promise<void>((resolve) => server.close(() => resolve()))
  return bound
}

async function freePortPair(): Promise<number> {
  const worker = Number(process.env.VITEST_POOL_ID ?? 0)
  for (;;) {
    const port = 20_000 + worker * 2_000 + 2 * Math.floor(Math.random() * 1_000)
    if ((await isFree(port)) && (await isFree(port + 1))) return port
  }
}

async function launch(dev = false): Promise<Running> {
  const root = makeProject()
  const port = await freePortPair()
  const editor = await startEditor({ projectDir: root, port, dev, uiDir })
  const info = JSON.parse(readFileSync(path.join(root, '.editor', 'server.json'), 'utf8')) as { token: string }
  const running = { root, port, projectPort: port + 1, token: info.token, close: () => editor.close() }
  editors.push(running)
  return running
}

function request(port: number, requestPath: string, options: RequestOptions = {}): Promise<Reply> {
  return new Promise((resolve) => {
    const outgoing = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method: options.method ?? 'GET',
        agent: false,
        headers: {
          host: options.host ?? `127.0.0.1:${port}`,
          ...(options.origin === undefined ? {} : { origin: options.origin }),
          ...(options.token === undefined ? {} : { [TOKEN_HEADER]: options.token }),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    outgoing.on('error', () => resolve({ status: 0, body: '' }))
    outgoing.end()
  })
}

/** The status the server answers a WebSocket upgrade with: 101 when it upgrades. */
function upgradeStatus(port: number, requestPath: string, headers: http.OutgoingHttpHeaders): Promise<number | 'no answer'> {
  return new Promise((resolve) => {
    const outgoing = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      agent: false,
      headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': WS_KEY, 'sec-websocket-version': '13', ...headers },
    })
    outgoing.on('upgrade', (_response, socket) => {
      socket.destroy()
      resolve(101)
    })
    outgoing.on('response', (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    outgoing.on('error', () => resolve('no answer'))
    void delay(UPGRADE_WAIT_MS).then(() => {
      outgoing.destroy()
      resolve('no answer')
    })
    outgoing.end()
  })
}

function wsUrl(editor: Running, token = editor.token): string {
  return `${WS_PATH}?${WS_TOKEN_PARAM}=${token}`
}

function editorHeaders(editor: Running): http.OutgoingHttpHeaders {
  return { host: `127.0.0.1:${editor.port}`, origin: `http://127.0.0.1:${editor.port}` }
}

function firstMessage(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString()) as ServerMessage))
    socket.once('error', reject)
  })
}

async function boardIndex(editor: Running): Promise<BoardIndex> {
  const socket = new WebSocket(`ws://127.0.0.1:${editor.port}${wsUrl(editor)}`, { origin: `http://127.0.0.1:${editor.port}` })
  sockets.push(socket)
  await firstMessage(socket)
  const index = new Promise<BoardIndex>((resolve) => {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage
      if (message.type === 'index') resolve(message.index)
    })
  })
  socket.send(JSON.stringify({ type: 'open', board: HOME }))
  return index
}

function pushLockExists(editor: Running): boolean {
  return existsSync(path.join(editor.root, '.editor', 'push.lock'))
}

describe('the editor listener’s Host check', () => {
  it('serves the editor page to Host 127.0.0.1:<port> and localhost:<port>', async () => {
    const editor = await launch()

    for (const host of [`127.0.0.1:${editor.port}`, `localhost:${editor.port}`]) {
      const page = await request(editor.port, '/', { host })
      expect(page.status).toBe(200)
      expect(page.body).toContain(UI_MARKER)
    }
  })

  it('refuses any other Host, with no substring match, and never shows the token', async () => {
    const editor = await launch()
    const hosts = [
      `evil.example:${editor.port}`,
      `localhost:${editor.port}.evil.example`,
      `127.0.0.1:${editor.port}0`,
      `x127.0.0.1:${editor.port}`,
      `127.0.0.1:${editor.projectPort}`,
      '127.0.0.1',
    ]

    for (const host of hosts) {
      const reply = await request(editor.port, '/', { host })
      expect(reply.status, host).toBeGreaterThanOrEqual(400)
      expect(reply.body, host).not.toContain(editor.token)
    }
  })
})

describe('the editor listener’s Origin check', () => {
  it('accepts its own two origins and an absent Origin', async () => {
    const editor = await launch()

    for (const origin of [`http://127.0.0.1:${editor.port}`, `http://localhost:${editor.port}`, undefined]) {
      expect((await request(editor.port, '/', origin === undefined ? {} : { origin })).status, String(origin)).toBe(200)
    }
  })

  it('refuses Origin null, the project origin and look-alike origins', async () => {
    const editor = await launch()
    const origins = [
      'null',
      `http://127.0.0.1:${editor.projectPort}`,
      `http://localhost:${editor.port}.evil.example`,
      `https://127.0.0.1:${editor.port}`,
      `http://evil.example`,
      `http://127.0.0.1:${editor.port}/`,
    ]

    for (const origin of origins) {
      const reply = await request(editor.port, '/', { origin })
      expect(reply.status, origin).toBeGreaterThanOrEqual(400)
      expect(reply.body, origin).not.toContain(editor.token)
    }
  })
})

describe('the per-launch token', () => {
  it('is injected into the editor page and never into project documents', async () => {
    const editor = await launch()

    expect((await request(editor.port, '/')).body).toContain(editor.token)
    const index = await boardIndex(editor)
    const served = await request(editor.projectPort, new URL(index.frameSrc).pathname)
    expect(served.status).toBe(200)
    expect(served.body).toContain('Studio Weekly')
    expect(served.body).not.toContain(editor.token)
    expect(index.frameSrc).not.toContain(editor.token)
  })

  it('guards every API call: without it, or with a wrong one, nothing happens', async () => {
    const editor = await launch()

    for (const token of [undefined, `${editor.token}x`, '']) {
      const options = token === undefined ? { method: 'POST' } : { method: 'POST', token }
      expect((await request(editor.port, HTTP_ROUTES.pushBegin, options)).status, String(token)).toBeGreaterThanOrEqual(400)
      expect((await request(editor.port, HTTP_ROUTES.shutdown, options)).status, String(token)).toBeGreaterThanOrEqual(400)
    }

    expect(pushLockExists(editor)).toBe(false)
    expect((await request(editor.port, HTTP_ROUTES.health, { token: editor.token })).status).toBe(200)
  })

  it('does not let a right token through from a foreign or null Origin', async () => {
    const editor = await launch()

    for (const origin of ['null', 'http://evil.example']) {
      expect((await request(editor.port, HTTP_ROUTES.pushBegin, { method: 'POST', token: editor.token, origin })).status).toBeGreaterThanOrEqual(400)
    }

    expect(pushLockExists(editor)).toBe(false)
  })

  it('lets the token through from the editor origin', async () => {
    const editor = await launch()

    const reply = await request(editor.port, HTTP_ROUTES.pushBegin, { method: 'POST', token: editor.token, origin: `http://localhost:${editor.port}` })

    expect(reply.status).toBe(200)
    expect(pushLockExists(editor)).toBe(true)
  })
})

describe('the editor WebSocket', () => {
  it('opens with the token, the editor Host and Origin, and greets with hello', async () => {
    const editor = await launch()
    const socket = new WebSocket(`ws://127.0.0.1:${editor.port}${wsUrl(editor)}`, { origin: `http://localhost:${editor.port}` })
    sockets.push(socket)

    expect((await firstMessage(socket)).type).toBe('hello')
  })

  it('refuses an upgrade without the token, with a wrong one, or from a foreign Host or Origin', async () => {
    const editor = await launch()
    const good = editorHeaders(editor)
    const attempts: [string, string, http.OutgoingHttpHeaders][] = [
      ['no token', WS_PATH, good],
      ['wrong token', wsUrl(editor, `${editor.token}x`), good],
      ['origin null', wsUrl(editor), { ...good, origin: 'null' }],
      ['no origin', wsUrl(editor), { host: good.host }],
      ['foreign origin', wsUrl(editor), { ...good, origin: 'http://evil.example' }],
      ['project origin', wsUrl(editor), { ...good, origin: `http://127.0.0.1:${editor.projectPort}` }],
      ['foreign host', wsUrl(editor), { ...good, host: `evil.example:${editor.port}` }],
    ]

    expect(await upgradeStatus(editor.port, wsUrl(editor), good)).toBe(101)
    for (const [label, requestPath, headers] of attempts) {
      expect(await upgradeStatus(editor.port, requestPath, headers), label).not.toBe(101)
    }
  })

  it('upgrades only on its own path', async () => {
    const editor = await launch()

    for (const requestPath of [`/elsewhere?${WS_TOKEN_PARAM}=${editor.token}`, `${WS_PATH}x?${WS_TOKEN_PARAM}=${editor.token}`]) {
      expect(await upgradeStatus(editor.port, requestPath, editorHeaders(editor)), requestPath).not.toBe(101)
    }
  })
})

describe('what the editor listener serves', () => {
  it('never serves /project/*, even under the capability prefix', async () => {
    const editor = await launch()
    const index = await boardIndex(editor)
    const underPrefix = new URL(index.frameSrc).pathname

    for (const requestPath of [underPrefix, '/project/home.dc.html']) {
      const reply = await request(editor.port, requestPath)
      expect(reply.status, requestPath).toBe(404)
      expect(reply.body, requestPath).not.toContain('Studio Weekly')
    }
  })

  it('answers /health with its pid', async () => {
    const editor = await launch()

    const reply = await request(editor.port, HTTP_ROUTES.health, { token: editor.token })

    expect(reply.status).toBe(200)
    expect(JSON.parse(reply.body)).toEqual({ ok: true, pid: process.pid })
  })
})

describe('dev mode', () => {
  it('runs Vite as middleware on the editor port, sharing it with Vite’s own HMR socket untouched by the token check', async () => {
    const editor = await launch(true)
    const client = await request(editor.port, '/@vite/client')
    expect(client.status).toBe(200)
    const viteToken = /wsToken\s*=\s*"([^"]+)"/.exec(client.body)?.[1]
    expect(viteToken).toBeTruthy()

    const hmr = new WebSocket(`ws://127.0.0.1:${editor.port}/?token=${viteToken}`, 'vite-hmr', { origin: `http://127.0.0.1:${editor.port}` })
    sockets.push(hmr)
    expect(await firstMessage(hmr)).toMatchObject({ type: 'connected' })

    expect(await upgradeStatus(editor.port, WS_PATH, editorHeaders(editor))).not.toBe(101)
    expect(await upgradeStatus(editor.port, wsUrl(editor), editorHeaders(editor))).toBe(101)
    expect((await request(editor.port, '/project/home.dc.html')).status).toBe(404)
  }, 30_000)
})
