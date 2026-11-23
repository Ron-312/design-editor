import { randomBytes } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { toProjectPath } from '../../shared/paths'
import {
  BLOB_PATH_PREFIX,
  EDITOR_FILES,
  LOOPBACK_HOST,
  PROJECT_PATH_PREFIX,
  projectPortFor,
  SUPPORT_JS,
  type EditorState,
} from '../../shared/protocol'
import type { ProjectPath } from '../../shared/types'
import { decodeSource } from '../source/bytes'
import type { IndexedFile } from '../source/source-index'
import { BlobCache, contentTypeOf, type CachedFile } from './blob-cache'
import { transformServedDocument } from './serve-transform'

export interface ProjectServerOptions {
  /** The pulled project's git root, holding `project/` and `.editor/`. */
  readonly root: string
  readonly editorPort: number
  readonly probeScript: string
  readonly indexFor: (file: ProjectPath, text: string) => IndexedFile
  readonly editorState: () => Pick<EditorState, 'hidden' | 'locked'>
}

export interface ProjectServer {
  /** `/project/<secret>/`; only the editor's iframe `src` may carry it, never a log or `.editor/`. */
  readonly prefix: string
  address(): AddressInfo
  close(): Promise<void>
}

const PROJECT_FOLDER = 'project'
const DOCUMENT_SUFFIX = '.dc.html'
const DOCUMENT_TYPE = 'text/html; charset=utf-8'
const READ_METHODS = new Set(['GET', 'HEAD'])
const NOT_FOUND: CachedFile = { bytes: Buffer.from('Not found\n'), contentType: 'text/plain; charset=utf-8' }

interface Served {
  readonly status: number
  readonly file: CachedFile
}

const notFound: Served = { status: 404, file: NOT_FOUND }

function plain(status: number, message: string): Served {
  return { status, file: { bytes: Buffer.from(`${message}\n`), contentType: NOT_FOUND.contentType } }
}

function found(file: CachedFile | null): Served {
  return file ? { status: 200, file } : notFound
}

function loopbackHosts(port: number): string[] {
  return [`${LOOPBACK_HOST}:${port}`, `localhost:${port}`]
}

function origins(port: number): string {
  return loopbackHosts(port)
    .map((host) => `http://${host}`)
    .join(' ')
}

/** No script-src: the canvas runtime and its DCLogic must run unchanged inside the opaque-origin sandbox. */
function securityHeaders(editorPort: number, projectPort: number): http.OutgoingHttpHeaders {
  return {
    'content-security-policy': `sandbox allow-scripts; frame-ancestors ${origins(editorPort)}; connect-src ${origins(projectPort)}`,
    'access-control-allow-origin': '*',
    'referrer-policy': 'no-referrer',
  }
}

/** Decoded segments of a prefix-relative path, or null when one could step outside or into a dot folder. */
function safeSegments(rawPath: string): string[] | null {
  try {
    const segments = rawPath.split('/').map(decodeURIComponent)
    const unsafe = segments.some((segment) => segment === '' || segment.startsWith('.') || /[\\/\0]/.test(segment))
    return unsafe ? null : segments
  } catch {
    return null
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

async function existingFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile()
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return false
    throw error
  }
}

/** A symlink or a Windows 8.3 short name could still reach `.editor/` or `.git/`; the real path settles it. */
async function staysInside(projectDir: string, file: string): Promise<boolean> {
  const relative = path.relative(await realpath(projectDir), await realpath(file))
  return !relative.startsWith('..') && !path.isAbsolute(relative) && relative.split(path.sep).every((segment) => !segment.startsWith('.'))
}

class ProjectFiles {
  private readonly projectDir: string
  private readonly cache: BlobCache

  constructor(private readonly options: ProjectServerOptions) {
    this.projectDir = path.join(options.root, PROJECT_FOLDER)
    this.cache = new BlobCache(path.join(options.root, ...EDITOR_FILES.cache.split('/')))
  }

  blob(id: string): Promise<CachedFile | null> {
    return this.cache.blob(id)
  }

  async underPrefix(rawPath: string): Promise<CachedFile | null> {
    const segments = safeSegments(rawPath)
    if (!segments) return null
    if (segments.length === 1 && segments[0] === SUPPORT_JS) return this.cache.supportJs()
    const file = path.join(this.projectDir, ...segments)
    if (!(await existingFile(file)) || !(await staysInside(this.projectDir, file))) return null
    const bytes = await readFile(file)
    return file.toLowerCase().endsWith(DOCUMENT_SUFFIX) ? this.document(file, bytes) : { bytes, contentType: contentTypeOf(file) }
  }

  private document(file: string, bytes: Buffer): CachedFile {
    const indexed = this.options.indexFor(toProjectPath(this.options.root, file), decodeSource(bytes))
    const { html } = transformServedDocument(indexed, { probeScript: this.options.probeScript, ...this.options.editorState() })
    return { bytes: Buffer.from(html, 'utf8'), contentType: DOCUMENT_TYPE }
  }
}

/** Origin absent or `null` is never an allow on its own here: the capability prefix is the gate (Scripts and trust). */
function isAllowedOrigin(origin: string | undefined): boolean {
  return origin === undefined || origin === 'null'
}

async function route(files: ProjectFiles, prefix: string, request: http.IncomingMessage, allowedHosts: readonly string[]): Promise<Served> {
  if (!allowedHosts.includes(request.headers.host ?? '')) return plain(421, 'Misdirected request')
  if (!READ_METHODS.has(request.method ?? '')) return plain(405, 'Method not allowed')
  if (!isAllowedOrigin(request.headers.origin)) return plain(403, 'Forbidden')
  const requestPath = (request.url ?? '').split('?')[0]!
  if (requestPath.startsWith(BLOB_PATH_PREFIX)) return found(await files.blob(requestPath.slice(BLOB_PATH_PREFIX.length)))
  if (requestPath.startsWith(prefix)) return found(await files.underPrefix(requestPath.slice(prefix.length)))
  return notFound
}

function send(response: http.ServerResponse, served: Served, method: string | undefined, headers: http.OutgoingHttpHeaders): void {
  response.writeHead(served.status, {
    ...headers,
    'content-type': served.file.contentType,
    'content-length': served.file.bytes.length,
    ...(served.status === 405 ? { allow: 'GET, HEAD' } : {}),
  })
  response.end(method === 'HEAD' ? undefined : served.file.bytes)
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

/** The read-only project origin on editor port + 1: static GET/HEAD only, with no API, ws or token. */
export async function startProjectServer(options: ProjectServerOptions): Promise<ProjectServer> {
  const prefix = `${PROJECT_PATH_PREFIX}${randomBytes(16).toString('hex')}/`
  const files = new ProjectFiles(options)
  const projectPort = projectPortFor(options.editorPort)
  const allowedHosts = loopbackHosts(projectPort)
  const headers = securityHeaders(options.editorPort, projectPort)
  const server = http.createServer((request, response) => {
    route(files, prefix, request, allowedHosts).then(
      (served) => send(response, served, request.method, headers),
      () => send(response, plain(500, 'Internal error'), request.method, headers),
    )
  })
  await listen(server, projectPort)
  return {
    prefix,
    address: () => server.address() as AddressInfo,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
