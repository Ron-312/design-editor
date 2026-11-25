import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startEditorServer, TOKEN_META, type EditorEndpoints, type EditorServer } from '../../../src/server/serve/editor-server'
import { HTTP_ROUTES, TOKEN_HEADER } from '../../../src/shared/protocol'

const TOKEN = 'editor-server-test-token'
const APP_JS = 'console.log("design editor ui")\n'

interface Reply {
  readonly status: number
  readonly type: string
  readonly body: string
}

interface Started {
  readonly server: EditorServer
  readonly port: number
  readonly uiDir: string
  readonly onShutdown: ReturnType<typeof vi.fn<() => void>>
}

const servers: EditorServer[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const endpoints: EditorEndpoints = {
  accept: () => {},
  beginPush: async () => 'nonce-1',
  endPush: async () => true,
  decidePushCall: () => null,
}

async function freePort(): Promise<number> {
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as net.AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

function makeUiDir(withIndex = true): string {
  const uiDir = mkdtempSync(path.join(tmpdir(), 'ed ui é '))
  dirs.push(uiDir)
  if (withIndex) writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><html><head><title>ui</title></head><body></body></html>\n')
  mkdirSync(path.join(uiDir, 'assets'))
  writeFileSync(path.join(uiDir, 'assets', 'app.js'), APP_JS)
  mkdirSync(path.join(uiDir, '.hidden'))
  writeFileSync(path.join(uiDir, '.hidden', 'secret.txt'), 'hidden')
  return uiDir
}

async function start(options: { serve?: boolean; dev?: boolean; uiDir?: string } = {}): Promise<Started> {
  const uiDir = options.uiDir ?? makeUiDir()
  const onShutdown = vi.fn<() => void>()
  const port = await freePort()
  const server = await startEditorServer({ port, token: TOKEN, dev: options.dev ?? false, uiDir, onShutdown })
  servers.push(server)
  if (options.serve ?? true) await server.serve(endpoints)
  return { server, port, uiDir, onShutdown }
}

function request(port: number, requestPath: string, options: { method?: string; token?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method: options.method ?? 'GET',
        agent: false,
        headers: { host: `127.0.0.1:${port}`, ...(options.token === undefined ? {} : { [TOKEN_HEADER]: options.token }) },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, type: String(response.headers['content-type']), body: Buffer.concat(chunks).toString('utf8') }),
        )
      },
    )
    outgoing.on('error', reject)
    outgoing.end()
  })
}

describe('the built UI in production', () => {
  it('serves a file under the UI folder with its content type', async () => {
    const { port } = await start()

    const reply = await request(port, '/assets/app.js')

    expect(reply.status).toBe(200)
    expect(reply.type).toMatch(/javascript/)
    expect(reply.body).toBe(APP_JS)
  })

  it('decodes percent-encoded path segments', async () => {
    const { port, uiDir } = await start()
    writeFileSync(path.join(uiDir, 'assets', 'café map.js'), APP_JS)

    expect((await request(port, `/assets/${encodeURIComponent('café map.js')}`)).body).toBe(APP_JS)
  })

  it.each([
    ['a missing file', '/assets/missing.js'],
    ['a folder', '/assets'],
    ['a dot folder', '/.hidden/secret.txt'],
    ['an encoded dot-dot', '/assets/%2E%2E/%2E%2E/package.json'],
    ['an encoded slash', '/assets%2Fapp.js'],
    ['an encoded backslash', '/assets%5Capp.js'],
    ['an empty segment', '/assets//app.js'],
    ['broken percent-encoding', '/assets/%E0%A4%A.js'],
  ])('answers 404 for %s', async (_label, requestPath) => {
    const { port } = await start()

    const reply = await request(port, requestPath)

    expect(reply.status).toBe(404)
    expect(reply.body).toBe('Not found\n')
  })
})

describe('the editor page', () => {
  it('carries the launch token in its head', async () => {
    const { port } = await start()

    const reply = await request(port, '/index.html')

    expect(reply.status).toBe(200)
    expect(reply.body).toContain(`<head><meta name="${TOKEN_META}" content="${TOKEN}">`)
  })

  it('answers 500 without leaking the error when the UI has no index.html', async () => {
    const { port } = await start({ uiDir: makeUiDir(false) })

    const reply = await request(port, '/')

    expect(reply.status).toBe(500)
    expect(reply.body).toBe('Internal error\n')
  })
})

describe('before the session is handed over', () => {
  it('answers 503 to every request, the page and the API alike', async () => {
    const { port } = await start({ serve: false })

    for (const requestPath of ['/', '/assets/app.js', HTTP_ROUTES.health]) {
      expect((await request(port, requestPath, { token: TOKEN })).status, requestPath).toBe(503)
    }
  })
})

describe('POST /shutdown', () => {
  it('answers ok and asks the editor to shut down once the reply is on its way', async () => {
    const { port, onShutdown } = await start()

    const reply = await request(port, HTTP_ROUTES.shutdown, { method: 'POST', token: TOKEN })

    expect(reply.status).toBe(200)
    expect(JSON.parse(reply.body)).toEqual({ ok: true })
    await vi.waitFor(() => expect(onShutdown).toHaveBeenCalledTimes(1))
  })

  it('refuses GET and a missing token without shutting down', async () => {
    const { port, onShutdown } = await start()

    expect((await request(port, HTTP_ROUTES.shutdown, { token: TOKEN })).status).toBe(405)
    expect((await request(port, HTTP_ROUTES.shutdown, { method: 'POST' })).status).toBe(403)
    await new Promise((resolve) => setImmediate(resolve))

    expect(onShutdown).not.toHaveBeenCalled()
  })
})

describe('dev mode', () => {
  it('answers 404 for a path neither the editor nor Vite serves', async () => {
    const { port } = await start({ dev: true })

    const reply = await request(port, '/no-such-file.txt')

    expect(reply.status).toBe(404)
    expect(reply.body).toBe('Not found\n')
  }, 30_000)
})
