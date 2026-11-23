import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { copyDir } from '../../copy-dir'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { startProjectServer, type ProjectServer, type ProjectServerOptions } from '../../../src/server/serve/project-server'
import { SourceIndex, type IndexedFile } from '../../../src/server/source/source-index'
import { HTTP_ROUTES, TOKEN_HEADER, WS_PATH } from '../../../src/shared/protocol'
import type { EdId, ProjectPath } from '../../../src/shared/types'
import { cacheFixtureAssets, FIXTURE_RELEASE } from '../../pulled-fixture'

interface Reply {
  readonly status: number
  readonly headers: http.IncomingHttpHeaders
  readonly body: Buffer
}

interface RequestOptions {
  readonly method?: string
  readonly host?: string
  readonly headers?: http.OutgoingHttpHeaders
}

const CANVAS = fileURLToPath(new URL('../../fixtures/canvas/', import.meta.url))
const CSS_BLOB = 'b1a2c3d4e5f60718293a4b5c6d7e8f90'
const SVG_BLOB = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'
const UNKNOWN_BLOB = 'ffffffffffffffffffffffffffffffff'
const HOME = 'project/home.dc.html' as ProjectPath
const CARD = 'project/card.dc.html' as ProjectPath
const TRAP_EDITOR = 'TRAP-INSIDE-EDITOR-DIR'
const TRAP_GIT = 'TRAP-INSIDE-GIT-DIR'
const EDITOR_TOKEN = `tok-${randomBytes(16).toString('hex')}`

const openServers: ProjectServer[] = []
const roots: string[] = []

/** A pulled project as `/design-pull` leaves it: the git root holds project/, .editor/ and .git/. */
async function makeProjectRoot(): Promise<string> {
  const parent = mkdtempSync(path.join(tmpdir(), 'ed serve '))
  const root = path.join(parent, 'Café board ü')
  roots.push(parent)
  copyDir(path.join(CANVAS, 'project'), path.join(root, 'project'))
  await cacheFixtureAssets(root)
  writeFileSync(path.join(root, '.editor', 'server.json'), JSON.stringify({ port: 5300, token: EDITOR_TOKEN, pid: 1, startedAt: 0 }))
  writeFileSync(path.join(root, '.editor', 'state.json'), JSON.stringify({ hidden: [], locked: [], collapsed: [], boards: {} }))
  mkdirSync(path.join(root, '.git'))
  writeFileSync(path.join(root, '.git', 'HEAD'), `ref: refs/heads/main ${EDITOR_TOKEN}\n`)
  mkdirSync(path.join(root, 'project', '.editor'))
  writeFileSync(path.join(root, 'project', '.editor', 'state.json'), TRAP_EDITOR)
  mkdirSync(path.join(root, 'project', '.git'))
  writeFileSync(path.join(root, 'project', '.git', 'config'), TRAP_GIT)
  return root
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(entry.parentPath, entry.name)
    return entry.isDirectory() ? filesUnder(full) : [full]
  })
}

function snapshotOf(root: string): Map<string, string> {
  return new Map(filesUnder(root).map((file) => [file, readFileSync(file).toString('base64')]))
}

async function freeProjectPort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as net.AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

interface Started {
  readonly server: ProjectServer
  readonly root: string
  readonly editorPort: number
  readonly projectPort: number
  readonly secret: string
  readonly indexed: Map<ProjectPath, { text: string; file: IndexedFile }>
}

async function start(overrides: Partial<ProjectServerOptions> = {}): Promise<Started> {
  const root = await makeProjectRoot()
  const projectPort = await freeProjectPort()
  const editorPort = projectPort - 1
  const sourceIndex = new SourceIndex()
  const indexed = new Map<ProjectPath, { text: string; file: IndexedFile }>()
  const server = await startProjectServer({
    root,
    editorPort,
    probeScript: '/* probe */',
    indexFor: (file, text) => {
      const indexedFile = sourceIndex.indexFile(file, text)
      indexed.set(file, { text, file: indexedFile })
      return indexedFile
    },
    editorState: () => ({ hidden: [], locked: [] }),
    ...overrides,
  })
  openServers.push(server)
  const secret = /^\/project\/([^/]+)\/$/.exec(server.prefix)?.[1] ?? ''
  return { server, root, editorPort, projectPort, secret, indexed }
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
        headers: { host: options.host ?? `127.0.0.1:${port}`, ...options.headers },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }))
      },
    )
    outgoing.on('error', () => resolve({ status: 0, headers: {}, body: Buffer.alloc(0) }))
    outgoing.end()
  })
}

function tryWebSocketUpgrade(port: number, requestPath: string): Promise<'upgraded' | 'refused'> {
  return new Promise((resolve) => {
    const outgoing = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      agent: false,
      headers: {
        host: `127.0.0.1:${port}`,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'sec-websocket-version': '13',
      },
    })
    outgoing.on('upgrade', (_response, socket) => {
      socket.destroy()
      resolve('upgraded')
    })
    outgoing.on('response', (response) => {
      response.resume()
      resolve('refused')
    })
    outgoing.on('error', () => resolve('refused'))
    outgoing.end()
  })
}

function cspDirectives(reply: Reply): Map<string, string[]> {
  const header = String(reply.headers['content-security-policy'] ?? '')
  return new Map(
    header
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...values]) => [name!.toLowerCase(), values]),
  )
}

function entropyBits(secret: string): number {
  const bitsPerChar = /^[0-9a-f]+$/i.test(secret) ? 4 : /^[A-Za-z0-9_-]+$/.test(secret) ? 6 : 0
  return secret.length * bitsPerChar
}

function readDisk(root: string, projectPath: string): Buffer {
  return readFileSync(path.join(root, ...projectPath.split('/')))
}

function sameNotFound(reply: Reply, missing: Reply): void {
  expect(reply.status).toBe(404)
  expect(reply.body.equals(missing.body)).toBe(true)
  expect(reply.headers['content-type']).toBe(missing.headers['content-type'])
}

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await Promise.all(openServers.map((server) => server.close()))
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('project listener: binding and Host', () => {
  let started: Started

  beforeAll(async () => {
    started = await start()
  })

  it('binds 127.0.0.1 on the editor port + 1', () => {
    const address = started.server.address()
    expect(address.address).toBe('127.0.0.1')
    expect(address.port).toBe(started.editorPort + 1)
  })

  it.each(['127.0.0.1', 'localhost'])('serves a document when Host is exactly %s:<project port>', async (hostname) => {
    const reply = await request(started.projectPort, `${started.server.prefix}home.dc.html`, { host: `${hostname}:${started.projectPort}` })
    expect(reply.status).toBe(200)
    expect(reply.body.toString('utf8')).toContain('Studio Weekly')
  })

  it('rejects any other Host', async () => {
    const pp = started.projectPort
    const hosts = [`127.0.0.1:${started.editorPort}`, 'localhost', '127.0.0.1', `evil.test:${pp}`, `127.0.0.1.evil.test:${pp}`, `[::1]:${pp}`, `0.0.0.0:${pp}`]
    for (const host of hosts) {
      const reply = await request(pp, `${started.server.prefix}home.dc.html`, { host })
      expect(reply.status === 0 || reply.status >= 400, `${host} → ${reply.status}`).toBe(true)
      expect(reply.body.toString('utf8'), host).not.toContain('Studio Weekly')
    }
  })

  it('rejects a Host check on root-absolute blobs too', async () => {
    const reply = await request(started.projectPort, `/_blob/${CSS_BLOB}`, { host: `evil.test:${started.projectPort}` })
    expect(reply.status === 0 || reply.status >= 400).toBe(true)
    expect(reply.body.toString('utf8')).not.toContain('background-image')
  })

  it('refuses to start, without falling back, when the project port is taken', async () => {
    const holder = net.createServer()
    await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve))
    const { port } = holder.address() as net.AddressInfo
    try {
      await expect(start({ editorPort: port - 1 })).rejects.toThrow(/EADDRINUSE|in use/i)
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()))
    }
  })
})

describe('project listener: capability prefix', () => {
  let started: Started

  beforeAll(async () => {
    started = await start()
  })

  const missing = () => request(started.projectPort, `${started.server.prefix}no-such-board.dc.html`)

  it('serves under /project/<secret>/ with at least 128 bits of secret', () => {
    expect(started.server.prefix).toMatch(/^\/project\/[^/]+\/$/)
    expect(entropyBits(started.secret)).toBeGreaterThanOrEqual(128)
  })

  it('uses a secret distinct from the editor token and from another launch', async () => {
    const other = await start()
    expect(other.secret).not.toBe(started.secret)
    expect(started.secret).not.toContain(EDITOR_TOKEN)
    expect(EDITOR_TOKEN).not.toContain(started.secret)
  })

  it('answers a missing file under the prefix with 404', async () => {
    expect((await missing()).status).toBe(404)
  })

  it('answers every path outside the prefix with the same 404 as a missing file', async () => {
    const secret = started.secret
    const oneCharOff = `${secret.slice(0, -1)}${secret.endsWith('0') ? '1' : '0'}`
    const outside = [
      `/project/${oneCharOff}/home.dc.html`,
      '/project/home.dc.html',
      '/home.dc.html',
      '/canvas.json',
      '/support.js',
      '/project/',
      '/',
      `/project/${secret}`,
      `/project/${secret}home.dc.html`,
    ]
    const notFound = await missing()
    for (const requestPath of outside) sameNotFound(await request(started.projectPort, requestPath), notFound)
  })

  it('serves root-absolute /_blob/<id> outside the prefix', async () => {
    const reply = await request(started.projectPort, `/_blob/${CSS_BLOB}`)
    expect(reply.status).toBe(200)
  })

  it('never logs the prefix and never writes it into .editor/', async () => {
    const logged: string[] = []
    const record = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '))
    }
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(record)
    const stdout = vi.spyOn(process.stdout, 'write')
    const stderr = vi.spyOn(process.stderr, 'write')
    const fresh = await start()
    for (const requestPath of [`${fresh.server.prefix}home.dc.html`, `${fresh.server.prefix}nope`, `/_blob/${UNKNOWN_BLOB}`, '/x']) {
      await request(fresh.projectPort, requestPath)
      await request(fresh.projectPort, requestPath, { host: `evil.test:${fresh.projectPort}` })
      await request(fresh.projectPort, requestPath, { method: 'POST' })
    }
    const written = [...stdout.mock.calls, ...stderr.mock.calls].map(([chunk]) => String(chunk))
    for (const line of [...logged, ...written]) expect(line).not.toContain(fresh.secret)
    for (const file of filesUnder(path.join(fresh.root, '.editor'))) expect(readFileSync(file, 'utf8')).not.toContain(fresh.secret)
  })
})

describe('project listener: read-only static files', () => {
  let started: Started

  beforeAll(async () => {
    started = await start()
  })

  const doc = (name: string) => `${started.server.prefix}${name}`
  const missing = () => request(started.projectPort, doc('no-such-board.dc.html'))

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('refuses %s', async (method) => {
    const reply = await request(started.projectPort, doc('home.dc.html'), { method })
    expect(reply.status).toBeGreaterThanOrEqual(400)
    expect(reply.body.toString('utf8')).not.toContain('Studio Weekly')
  })

  it('answers HEAD with the GET headers and no body', async () => {
    const get = await request(started.projectPort, doc('canvas.json'))
    const head = await request(started.projectPort, doc('canvas.json'), { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.body.length).toBe(0)
    expect(head.headers['content-type']).toBe(get.headers['content-type'])
    expect(head.headers['content-security-policy']).toBe(get.headers['content-security-policy'])
  })

  it.each([HTTP_ROUTES.health, HTTP_ROUTES.pushBegin, HTTP_ROUTES.pushEnd, HTTP_ROUTES.shutdown, WS_PATH])(
    'has no editor API at %s, even with the token',
    async (route) => {
      const reply = await request(started.projectPort, route, { headers: { [TOKEN_HEADER]: EDITOR_TOKEN } })
      sameNotFound(reply, await missing())
    },
  )

  it.each([() => WS_PATH, () => `${WS_PATH}?token=${EDITOR_TOKEN}`, (prefix: string) => `${prefix}home.dc.html`])(
    'never upgrades to a WebSocket (case %#)',
    async (pathFor) => {
      expect(await tryWebSocketUpgrade(started.projectPort, pathFor(started.server.prefix))).toBe('refused')
    },
  )

  it.each([
    '.editor/state.json',
    '.EDITOR/state.json',
    '.Editor/state.json',
    '.git/config',
    '.GIT/config',
    '.Git/config',
    'ds/../.git/config',
    'ds/%2e%2e/.editor/state.json',
    '%2Eeditor/state.json',
    '%2egit/config',
    '../.editor/server.json',
    '../.EDITOR/server.json',
    '../.git/HEAD',
    '%2e%2e/.editor/server.json',
    '%2E%2E%2F.editor%2Fserver.json',
    '..%2f.git%2fHEAD',
    '..%5c.editor%5cserver.json',
    `../../${encodeURIComponent('Café board ü')}/.editor/server.json`,
  ])('never serves .editor/ or .git/: %s', async (suffix) => {
    const reply = await request(started.projectPort, doc(suffix))
    sameNotFound(reply, await missing())
    const body = reply.body.toString('utf8')
    for (const secretText of [EDITOR_TOKEN, TRAP_EDITOR, TRAP_GIT]) expect(body).not.toContain(secretText)
  })

  it.each([
    `/_blob/..%2f.editor%2fserver.json`,
    `/_blob/../.editor/server.json`,
    `/_blob/%2e%2e/%2e%2e/.editor/server.json`,
    `/_blob/server.json`,
    `/_blob/support.js`,
    `/_blob/${UNKNOWN_BLOB}`,
  ])('answers an unknown or escaping blob with the missing-file 404: %s', async (blobPath) => {
    const reply = await request(started.projectPort, blobPath)
    sameNotFound(reply, await missing())
    expect(reply.body.toString('utf8')).not.toContain(EDITOR_TOKEN)
  })

  it('never puts the editor token in any project response', async () => {
    const paths = [
      doc('home.dc.html'),
      doc('card.dc.html'),
      doc('canvas.json'),
      doc('support.js'),
      doc('ds/core/tokens.json'),
      `/_blob/${CSS_BLOB}`,
      `/_blob/${SVG_BLOB}`,
    ]
    for (const requestPath of paths) {
      const reply = await request(started.projectPort, requestPath)
      expect(reply.status, requestPath).toBe(200)
      expect(reply.body.toString('utf8')).not.toContain(EDITOR_TOKEN)
      expect(JSON.stringify(reply.headers)).not.toContain(EDITOR_TOKEN)
    }
  })
})

describe('project listener: Origin', () => {
  let started: Started

  beforeAll(async () => {
    started = await start()
  })

  it.each([undefined, 'null'])('serves a static GET with Origin %s under the prefix', async (origin) => {
    const headers = origin === undefined ? {} : { origin }
    const reply = await request(started.projectPort, `${started.server.prefix}home.dc.html`, { headers })
    expect(reply.status).toBe(200)
  })

  it('serves a blob fetched with Origin: null', async () => {
    const reply = await request(started.projectPort, `/_blob/${SVG_BLOB}`, { headers: { origin: 'null' } })
    expect(reply.status).toBe(200)
  })

  it('serves a HEAD with Origin: null under the prefix', async () => {
    const reply = await request(started.projectPort, `${started.server.prefix}support.js`, { method: 'HEAD', headers: { origin: 'null' } })
    expect(reply.status).toBe(200)
  })

  it.each(['/home.dc.html', '/project/home.dc.html', '/support.js'])('does not let Origin: null past the prefix: %s', async (requestPath) => {
    const reply = await request(started.projectPort, requestPath, { headers: { origin: 'null' } })
    expect(reply.status).toBe(404)
    expect(reply.body.toString('utf8')).not.toContain('Studio Weekly')
  })
})

describe('project listener: response headers', () => {
  let started: Started

  beforeAll(async () => {
    started = await start()
  })

  const paths = () => [
    `${started.server.prefix}home.dc.html`,
    `${started.server.prefix}canvas.json`,
    `${started.server.prefix}support.js`,
    `/_blob/${CSS_BLOB}`,
  ]

  it('sends the sandbox CSP built from the bound ports, with no script-src', async () => {
    const editorHosts = [`http://127.0.0.1:${started.editorPort}`, `http://localhost:${started.editorPort}`]
    const projectHosts = [`http://127.0.0.1:${started.projectPort}`, `http://localhost:${started.projectPort}`]
    for (const requestPath of paths()) {
      const csp = cspDirectives(await request(started.projectPort, requestPath))
      expect([...csp.keys()].sort(), requestPath).toEqual(['connect-src', 'frame-ancestors', 'sandbox'])
      expect(csp.get('sandbox')).toEqual(['allow-scripts'])
      expect([...csp.get('frame-ancestors')!].sort()).toEqual([...editorHosts].sort())
      expect([...csp.get('connect-src')!].sort()).toEqual([...projectHosts].sort())
    }
  })

  it('allows any origin to read and sends no referrer', async () => {
    for (const requestPath of paths()) {
      const reply = await request(started.projectPort, requestPath)
      expect(reply.headers['access-control-allow-origin'], requestPath).toBe('*')
      expect(reply.headers['referrer-policy'], requestPath).toBe('no-referrer')
    }
  })

  it('declares documents as UTF-8 HTML, since the injected probe pushes <meta charset> down the page', async () => {
    const reply = await request(started.projectPort, `${started.server.prefix}home.dc.html`)
    expect(reply.headers['content-type']).toMatch(/^text\/html;\s*charset=utf-8$/i)
  })
})

describe('project listener: documents, blobs and support.js', () => {
  let started: Started
  const hidden: EdId[] = []
  const locked: EdId[] = []

  beforeAll(async () => {
    started = await start({ editorState: () => ({ hidden, locked }) })
  })

  const get = (requestPath: string) => request(started.projectPort, requestPath)

  it('indexes the document read from disk under its project path and stamps those ids', async () => {
    const reply = await get(`${started.server.prefix}home.dc.html`)
    const seen = started.indexed.get(HOME)
    expect(seen?.text).toBe(readDisk(started.root, HOME).toString('utf8'))
    const servedIds = [...reply.body.toString('utf8').matchAll(/data-ed-id="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(servedIds)).toEqual(new Set(seen!.file.ids))
  })

  it('stamps a relative sibling document the runtime imports', async () => {
    const reply = await get(`${started.server.prefix}card.dc.html`)
    expect(reply.status).toBe(200)
    const ids = started.indexed.get(CARD)!.file.ids
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(reply.body.toString('utf8')).toContain(`data-ed-id="${id}"`)
  })

  it('leaves every file on disk untouched, hide and lock included', async () => {
    const before = snapshotOf(started.root)
    await get(`${started.server.prefix}home.dc.html`)
    const homeIds = started.indexed.get(HOME)!.file.ids
    hidden.push(homeIds.at(-2)!)
    locked.push(homeIds.at(-3)!)
    for (const name of ['home.dc.html', 'card.dc.html', 'canvas.json', 'support.js']) await get(`${started.server.prefix}${name}`)
    await get(`/_blob/${CSS_BLOB}`)
    expect(snapshotOf(started.root)).toEqual(before)
  })

  it('serves non-document project files byte for byte', async () => {
    for (const name of ['canvas.json', 'ds/core/tokens.json']) {
      const reply = await get(`${started.server.prefix}${name}`)
      expect(reply.status).toBe(200)
      expect(reply.body.equals(readDisk(started.root, `project/${name}`)), name).toBe(true)
      expect(reply.headers['content-type']).toMatch(/^application\/json/)
    }
  })

  it('answers ./support.js from the current release in .editor/cache/', async () => {
    const reply = await get(`${started.server.prefix}support.js`)
    expect(reply.status).toBe(200)
    expect(reply.body.equals(readFileSync(path.join(started.root, '.editor', 'cache', FIXTURE_RELEASE, 'support.js')))).toBe(true)
    expect(reply.headers['content-type']).toMatch(/javascript/)
  })

  it.each([
    [CSS_BLOB, 'css', /^text\/css/],
    [SVG_BLOB, 'svg', /^image\/svg\+xml/],
  ])('answers /_blob/%s from .editor/cache/ by id with its type', async (id, extension, contentType) => {
    const reply = await get(`/_blob/${id}`)
    expect(reply.status).toBe(200)
    expect(reply.body.equals(readFileSync(path.join(started.root, '.editor', 'cache', `${id}.${extension}`)))).toBe(true)
    expect(reply.headers['content-type']).toMatch(contentType)
  })

  it('injects a different probe nonce into each response', async () => {
    const nonceOf = async () => /<script\b[^>]*\snonce="([^"]+)"/.exec((await get(`${started.server.prefix}home.dc.html`)).body.toString('utf8'))?.[1]
    const first = await nonceOf()
    const second = await nonceOf()
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(first).not.toBe(second)
  })
})
