import { timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ViteDevServer } from 'vite'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  HTTP_ROUTES,
  LOOPBACK_HOST,
  PROJECT_PATH_PREFIX,
  TOKEN_HEADER,
  WS_PATH,
  WS_TOKEN_PARAM,
  type PushEndRequest,
} from '../../shared/protocol'
import type { HookEvent, HookReply } from '../../push/conversation'
import { GUARD_HEADER } from '../../push/guard'
import { contentTypeOf } from './blob-cache'

/** The editor page reads the per-launch token from this meta tag; project documents never carry it. */
export const TOKEN_META = 'design-editor-token'

export interface EditorEndpoints {
  accept(socket: WebSocket): void
  /** `nonce` is the caller's own, so a caller that gave up waiting can still end the push it asked for. */
  beginPush(nonce?: string): Promise<string | null>
  endPush(nonce: string): Promise<boolean>
  knowsPushSecret(secret: string | undefined): boolean
  receivePushHook(event: HookEvent): Promise<HookReply>
}

export interface EditorServerOptions {
  readonly port: number
  readonly token: string
  readonly dev: boolean
  /** The built UI in production, the UI source that Vite serves in dev. */
  readonly uiDir: string
  readonly onShutdown: () => void
}

export interface EditorServer {
  address(): AddressInfo
  /** Every request answers 503 until the session is handed over, so the port can be held before startup's slow work. */
  serve(endpoints: EditorEndpoints): Promise<void>
  close(): Promise<void>
}

const VITE_CONFIG = fileURLToPath(new URL('../../../vite.config.ts', import.meta.url))
const INDEX_HTML = 'index.html'
const MAX_BODY_BYTES = 4096
/** After a read, a hook call carries the text of the files read. */
const MAX_HOOK_BODY_BYTES = 64 * 1024 * 1024

interface Reply {
  readonly status: number
  readonly type: string
  readonly body: string | Buffer
}

function plain(status: number, message: string): Reply {
  return { status, type: 'text/plain; charset=utf-8', body: `${message}\n` }
}

function json(value: unknown): Reply {
  return { status: 200, type: 'application/json; charset=utf-8', body: JSON.stringify(value) }
}

const notFound = plain(404, 'Not found')
const starting = plain(503, 'The editor is starting')

class RequestGuard {
  private readonly hosts: readonly string[]
  private readonly origins: readonly string[]
  private readonly token: Buffer

  constructor(port: number, token: string) {
    this.hosts = [`${LOOPBACK_HOST}:${port}`, `localhost:${port}`]
    this.origins = this.hosts.map((host) => `http://${host}`)
    this.token = Buffer.from(token)
  }

  /** Exact matches only: a substring or suffix match would let `localhost:5300.evil.example` through. */
  isOwnHost(host: string | undefined): boolean {
    return this.hosts.includes(host ?? '')
  }

  /** `null` is never an allow here; only the project origin lets it through, for static reads. */
  isOwnOrigin(origin: string | undefined): boolean {
    return this.origins.includes(origin ?? '')
  }

  hasToken(candidate: string | string[] | null | undefined): boolean {
    if (typeof candidate !== 'string') return false
    const given = Buffer.from(candidate)
    return given.length === this.token.length && timingSafeEqual(given, this.token)
  }
}

function readBody(request: http.IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) return request.destroy(new Error('request body too large'))
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function nonceOf(body: string): string | null {
  try {
    const { nonce } = JSON.parse(body) as Partial<PushEndRequest>
    return typeof nonce === 'string' ? nonce : null
  } catch {
    return null
  }
}

function hookEventOf(body: string): HookEvent {
  try {
    const call: unknown = JSON.parse(body)
    return typeof call === 'object' && call !== null ? call : {}
  } catch {
    return {}
  }
}

/** Decoded segments of a UI asset path, or null when one could step outside the UI folder. */
function safeSegments(rawPath: string): string[] | null {
  try {
    const segments = rawPath.split('/').map(decodeURIComponent)
    const unsafe = segments.some((segment) => segment === '' || segment.startsWith('.') || /[\\/\0]/.test(segment))
    return unsafe ? null : segments
  } catch {
    return null
  }
}

async function existingFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

function withToken(html: string, token: string): string {
  return html.replace(/<head[^>]*>/i, (head) => `${head}<meta name="${TOKEN_META}" content="${token}">`)
}

class EditorRoutes {
  constructor(
    private readonly options: EditorServerOptions,
    readonly endpoints: EditorEndpoints,
    private readonly guard: RequestGuard,
    readonly vite: ViteDevServer | null,
  ) {}

  /** Null hands the request on to Vite's middleware (dev only). */
  async route(request: http.IncomingMessage, requestPath: string): Promise<Reply | null> {
    if (!this.guard.isOwnHost(request.headers.host)) return plain(421, 'Misdirected request')
    if (request.headers.origin !== undefined && !this.guard.isOwnOrigin(request.headers.origin)) return plain(403, 'Forbidden')
    if (requestPath.startsWith(PROJECT_PATH_PREFIX)) return notFound
    if (requestPath === HTTP_ROUTES.pushGuard) return this.pushGuard(request)
    if ((Object.values(HTTP_ROUTES) as string[]).includes(requestPath)) return this.api(request, requestPath)
    if (requestPath === '/' || requestPath === `/${INDEX_HTML}`) return this.editorPage(requestPath)
    return this.vite ? null : this.uiAsset(requestPath)
  }

  private async api(request: http.IncomingMessage, route: string): Promise<Reply> {
    if (!this.guard.hasToken(request.headers[TOKEN_HEADER])) return plain(403, 'Forbidden')
    const method = route === HTTP_ROUTES.health ? 'GET' : 'POST'
    if (request.method !== method) return plain(405, 'Method not allowed')
    switch (route) {
      case HTTP_ROUTES.health:
        return json({ ok: true, pid: process.pid })
      case HTTP_ROUTES.pushBegin:
        return this.pushBegin(await readBody(request))
      case HTTP_ROUTES.pushEnd:
        return this.pushEnd(await readBody(request))
      default:
        return this.shutdown()
    }
  }

  private async pushBegin(body: string): Promise<Reply> {
    const nonce = await this.endpoints.beginPush(nonceOf(body) ?? undefined)
    return nonce === null ? plain(409, 'push.lock is held by another push') : json({ nonce })
  }

  private async pushEnd(body: string): Promise<Reply> {
    const nonce = nonceOf(body)
    if (nonce === null) return plain(400, 'expected {"nonce": "..."}')
    return (await this.endpoints.endPush(nonce)) ? json({ ok: true }) : plain(409, 'not the editor’s push lock')
  }

  /** Claude Code's own request, so it has the push's secret in place of the token a browser page could never read. */
  private async pushGuard(request: http.IncomingMessage): Promise<Reply> {
    if (request.method !== 'POST') return plain(405, 'Method not allowed')
    const secret = request.headers[GUARD_HEADER]
    if (!this.endpoints.knowsPushSecret(typeof secret === 'string' ? secret : undefined)) return plain(403, 'Forbidden')
    return json(await this.endpoints.receivePushHook(hookEventOf(await readBody(request, MAX_HOOK_BODY_BYTES))))
  }

  private shutdown(): Reply {
    setImmediate(this.options.onShutdown)
    return json({ ok: true })
  }

  private async editorPage(url: string): Promise<Reply> {
    const source = await readFile(path.join(this.options.uiDir, INDEX_HTML), 'utf8')
    const html = this.vite ? await this.vite.transformIndexHtml(url, source) : source
    return { status: 200, type: 'text/html; charset=utf-8', body: withToken(html, this.options.token) }
  }

  private async uiAsset(requestPath: string): Promise<Reply> {
    const segments = safeSegments(requestPath.slice(1))
    if (!segments) return notFound
    const file = path.join(this.options.uiDir, ...segments)
    if (!(await existingFile(file))) return notFound
    return { status: 200, type: contentTypeOf(file), body: await readFile(file) }
  }
}

function send(response: http.ServerResponse, reply: Reply): void {
  response.writeHead(reply.status, {
    'content-type': reply.type,
    'content-length': Buffer.byteLength(reply.body),
    'cache-control': 'no-store',
  })
  response.end(reply.body)
}

function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

/** Vite runs as middleware on the editor port, its HMR socket sharing the listener (Stack: Editor UI). */
async function startVite(server: http.Server, uiDir: string): Promise<ViteDevServer> {
  const { createServer: createViteServer } = await import('vite')
  return createViteServer({
    configFile: VITE_CONFIG,
    root: uiDir,
    appType: 'custom',
    logLevel: 'warn',
    server: { middlewareMode: true, hmr: { server } },
  })
}

/** The editor origin on 127.0.0.1: the UI, the token-guarded API and the path-scoped edit ws; never `/project/*`. */
export async function startEditorServer(options: EditorServerOptions): Promise<EditorServer> {
  const server = http.createServer()
  const guard = new RequestGuard(options.port, options.token)
  const sockets = new WebSocketServer({ noServer: true })
  let routes: EditorRoutes | null = null

  server.on('request', (request: http.IncomingMessage, response: http.ServerResponse) => {
    if (!routes) return send(response, starting)
    const { vite } = routes
    const requestPath = (request.url ?? '').split('?')[0]!
    routes.route(request, requestPath).then(
      (reply) => (reply ? send(response, reply) : vite!.middlewares(request, response, () => send(response, notFound))),
      () => send(response, plain(500, 'Internal error')),
    )
  })

  // Vite's own HMR upgrade is left alone in dev; the token check is scoped to the editor's ws path.
  server.on('upgrade', (request: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '', 'http://upgrade.invalid')
    if (url.pathname !== WS_PATH) return routes?.vite ? undefined : refuseUpgrade(socket, 404)
    if (!routes) return refuseUpgrade(socket, 503)
    const allowed = guard.isOwnHost(request.headers.host) && guard.isOwnOrigin(request.headers.origin) && guard.hasToken(url.searchParams.get(WS_TOKEN_PARAM))
    if (!allowed) return refuseUpgrade(socket, 403)
    const { endpoints } = routes
    sockets.handleUpgrade(request, socket, head, (ws) => endpoints.accept(ws))
  })

  await listen(server, options.port)
  return {
    address: () => server.address() as AddressInfo,
    serve: async (endpoints) => {
      const vite = options.dev ? await startVite(server, options.uiDir) : null
      routes = new EditorRoutes(options, endpoints, guard, vite)
    },
    close: async () => {
      for (const ws of sockets.clients) ws.terminate()
      await routes?.vite?.close()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
  }
}
