import { randomBytes } from 'node:crypto'
import dns from 'node:dns'
import { mkdir, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs as parseCliArgs } from 'node:util'
import { atomicWrite } from '../core/atomic-write'
import { ensureSupportedGit } from '../core/git'
import { DEFAULT_EDITOR_PORT, EDITOR_FILES, LOOPBACK_HOST, projectPortFor, type ServerInfo } from '../shared/protocol'
import { startEditorServer, type EditorServer } from './serve/editor-server'
import { startProjectServer, type ProjectServer } from './serve/project-server'
import { EditSession } from './session'
import { watchProject, type ProjectWatcher } from './watch/watcher'

export interface EditorArgs {
  readonly projectDir: string
  readonly port: number
  readonly dev: boolean
}

export interface StartOptions extends EditorArgs {
  /** Defaults to the UI source in dev and the built bundle otherwise. */
  readonly uiDir?: string
}

export interface Editor {
  address(): AddressInfo
  projectAddress(): AddressInfo
  close(): Promise<void>
  /** Settles once the editor has closed, whether by close(), `POST /shutdown` or a signal. */
  readonly closed: Promise<void>
}

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const UI_SOURCE = path.join(REPO, 'src', 'ui')
const UI_BUILD = path.join(REPO, 'dist', 'ui')

let probeBundle: Promise<string> | undefined

/** Imported lazily: loading vite takes long enough for another process to take the port pair first. */
function loadProbeBundle(): Promise<string> {
  return (probeBundle ??= import('../probe/bundle').then(({ buildProbeBundle }) => buildProbeBundle()))
}

export function parseArgs(argv: readonly string[]): EditorArgs {
  const { values } = parseCliArgs({
    args: [...argv],
    options: { project: { type: 'string' }, port: { type: 'string' }, dev: { type: 'boolean', default: false } },
  })
  if (!values.project) throw new Error('pass the pulled project with `--project <dir>`')
  const port = values.port === undefined ? DEFAULT_EDITOR_PORT : Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port >= 65_535) throw new Error(`--port must be a port number below 65535, not ${values.port}`)
  return { projectDir: values.project, port, dev: values.dev }
}

/** One editor at a time and no fallback port: the pair is a security boundary and server.json names exactly one editor. */
async function onPort<T>(port: number, start: () => Promise<T>): Promise<T> {
  try {
    return await start()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    throw new Error(`port ${port} is in use by another editor or program; close it or pass \`--port\``, { cause: error })
  }
}

function serverJsonOf(root: string): string {
  return path.join(root, ...EDITOR_FILES.server.split('/'))
}

async function writeServerJson(root: string, info: ServerInfo & { readonly projectPort: number }): Promise<void> {
  const file = serverJsonOf(root)
  await mkdir(path.dirname(file), { recursive: true })
  await atomicWrite(file, Buffer.from(`${JSON.stringify(info, null, 2)}\n`))
}

async function prepare(root: string): Promise<{ probeScript: string; session: EditSession }> {
  const [, probeScript] = await Promise.all([ensureSupportedGit(), loadProbeBundle()])
  return { probeScript, session: await EditSession.open(root) }
}

function fulfilled<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === 'fulfilled' ? result.value : undefined
}

function firstFailure(results: readonly PromiseSettledResult<unknown>[]): unknown {
  return results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason
}

export async function startEditor(options: StartOptions): Promise<Editor> {
  dns.setDefaultResultOrder('ipv4first')
  const root = path.resolve(options.projectDir)
  const projectPort = projectPortFor(options.port)
  const token = randomBytes(32).toString('base64url')

  let probeScript = ''
  let session: EditSession | undefined
  let projectServer: ProjectServer | undefined
  let editorServer: EditorServer | undefined
  let watcher: ProjectWatcher | undefined
  let closing: Promise<void> | undefined
  let markClosed!: () => void
  const closed = new Promise<void>((resolve) => (markClosed = resolve))

  const close = () =>
    (closing ??= (async () => {
      await watcher?.close()
      await session?.close()
      await editorServer?.close()
      await projectServer?.close()
      await rm(serverJsonOf(root), { force: true })
      markClosed()
    })())

  try {
    const results = await Promise.allSettled([
      onPort(options.port, () =>
        startEditorServer({
          port: options.port,
          token,
          dev: options.dev,
          uiDir: options.uiDir ?? (options.dev ? UI_SOURCE : UI_BUILD),
          onShutdown: () => void close(),
        }),
      ),
      onPort(projectPort, () =>
        startProjectServer({
          root,
          editorPort: options.port,
          // Read per document request, and none can arrive before serveFramesAt hands out the secret prefix.
          get probeScript() {
            return probeScript
          },
          indexFor: (file, text) => session!.indexFor(file, text),
          editorState: () => session!.editorState,
        }),
      ),
      prepare(root),
    ] as const)
    editorServer = fulfilled(results[0])
    projectServer = fulfilled(results[1])
    const prepared = fulfilled(results[2])
    session = prepared?.session
    if (!editorServer || !projectServer || !prepared) throw firstFailure(results)

    const opened = prepared.session
    probeScript = prepared.probeScript
    opened.serveFramesAt(`http://${LOOPBACK_HOST}:${projectPort}${projectServer.prefix}`)
    await editorServer.serve(opened)
    watcher = await watchProject({
      root,
      knownHash: (file) => opened.knownHash(file),
      onOutsideChange: (file) => opened.outsideChange(file),
      onWarning: (message) => console.warn(message),
    })
    await writeServerJson(root, { port: options.port, projectPort, token, pid: process.pid, startedAt: Date.now() })
  } catch (error) {
    await close()
    throw error
  }

  return {
    address: () => editorServer!.address(),
    projectAddress: () => projectServer!.address(),
    close,
    closed,
  }
}
