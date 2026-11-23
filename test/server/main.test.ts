import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import dns from 'node:dns'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { copyDir } from '../copy-dir'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ensureUiBuilt, parseArgs, startEditor } from '../../src/server/main'
import { DEFAULT_EDITOR_PORT, HTTP_ROUTES, TOKEN_HEADER } from '../../src/shared/protocol'
import { cacheFixtureAssets } from '../pulled-fixture'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const START_SCRIPT = path.join(REPO, 'scripts', 'start.mjs')
const CANVAS = fileURLToPath(new URL('../fixtures/canvas/', import.meta.url))
const ON_WINDOWS = process.platform === 'win32'
const LAUNCH_MS = 45_000
const CLI_TEST_MS = 60_000

interface Closable {
  close(): Promise<void>
}

interface Reply {
  readonly status: number
  readonly body: string
}

interface ServerJson {
  readonly port: number
  readonly projectPort: number
  readonly token: string
  readonly pid: number
}

interface Cli {
  readonly child: ChildProcessWithoutNullStreams
  readonly exited: Promise<number | null>
  stderr(): string
}

const parents: string[] = []
const editors: Closable[] = []
const children: ChildProcessWithoutNullStreams[] = []
const blockers: net.Server[] = []
let uiDir = ''

beforeAll(() => {
  uiDir = mkdtempSync(path.join(tmpdir(), 'ed ui '))
  writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><html><head><title>Design Editor</title></head><body></body></html>\n')
})

afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.close()
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  for (const blocker of blockers.splice(0)) await new Promise<void>((resolve) => blocker.close(() => resolve()))
  for (const parent of parents.splice(0)) rmSync(parent, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(uiDir, { recursive: true, force: true })
})

async function makeProject(): Promise<string> {
  const parent = mkdtempSync(path.join(tmpdir(), 'ed main '))
  parents.push(parent)
  const root = path.join(parent, 'Café board ü')
  copyDir(path.join(CANVAS, 'project'), path.join(root, 'project'))
  await cacheFixtureAssets(root)
  return root
}

function serverJsonOf(root: string): string {
  return path.join(root, '.editor', 'server.json')
}

function readServerJson(root: string): ServerJson {
  return JSON.parse(readFileSync(serverJsonOf(root), 'utf8')) as ServerJson
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

async function occupy(port: number): Promise<void> {
  const blocker = net.createServer()
  await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', resolve))
  blockers.push(blocker)
}

async function launch(root: string, port: number) {
  const editor = await startEditor({ projectDir: root, port, dev: false, uiDir })
  editors.push(editor)
  return editor
}

function inUseMessage(port: number): string {
  return `port ${port} is in use by another editor or program; close it or pass \`--port\``
}

function request(port: number, route: string, options: { method?: string; token?: string } = {}): Promise<Reply> {
  return new Promise((resolve) => {
    const outgoing = http.request(
      {
        host: '127.0.0.1',
        port,
        path: route,
        method: options.method ?? 'GET',
        agent: false,
        headers: { host: `127.0.0.1:${port}`, ...(options.token === undefined ? {} : { [TOKEN_HEADER]: options.token }) },
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

async function until(condition: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${what} within ${ms} ms`)
    await delay(50)
  }
}

function runCli(args: readonly string[], env: NodeJS.ProcessEnv = process.env, nodeOptions: readonly string[] = []): Cli {
  const child = spawn(process.execPath, [...nodeOptions, START_SCRIPT, ...args], { cwd: REPO, env, stdio: 'pipe', windowsHide: true })
  children.push(child)
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
  child.stdout.resume()
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  return { child, exited, stderr: () => stderr }
}

async function startedCli(root: string, port: number, nodeOptions: readonly string[] = [], env: NodeJS.ProcessEnv = process.env): Promise<Cli> {
  const cli = runCli(['--project', root, '--port', String(port)], env, nodeOptions)
  await until(() => existsSync(serverJsonOf(root)) || cli.child.exitCode !== null, LAUNCH_MS, 'the editor did not write server.json')
  expect(existsSync(serverJsonOf(root)), cli.stderr()).toBe(true)
  return cli
}

async function healthyCli(root: string, port: number): Promise<Cli> {
  const cli = await startedCli(root, port)
  expect((await request(port, HTTP_ROUTES.health, { token: readServerJson(root).token })).status).toBe(200)
  // Signal and stdin handlers may be installed just after server.json is written.
  await delay(300)
  return cli
}

/** Emits a signal inside the editor process, the only way to deliver SIGBREAK portably. */
function signalPreload(dir: string): string {
  const file = path.join(dir, 'emit-signal.mjs')
  writeFileSync(
    file,
    [
      "import { existsSync } from 'node:fs'",
      'const { ED_TEST_SERVER_JSON: serverJson, ED_TEST_SIGNAL: signal } = process.env',
      'const poll = setInterval(() => {',
      '  if (!existsSync(serverJson) || process.listenerCount(signal) === 0) return',
      '  clearInterval(poll)',
      '  setTimeout(() => process.emit(signal), 300)',
      '}, 50)',
      '',
    ].join('\n'),
  )
  return file
}

describe('parseArgs', () => {
  it('defaults the editor port to 5300', () => {
    const args = parseArgs(['--project', 'projects/test-site'])

    expect(args.port).toBe(DEFAULT_EDITOR_PORT)
    expect(path.resolve(args.projectDir)).toBe(path.resolve('projects/test-site'))
  })

  it('takes the editor port from --port', () => {
    expect(parseArgs(['--project', 'projects/test-site', '--port', '6200']).port).toBe(6200)
  })
})

describe('ensureUiBuilt', () => {
  it('builds the UI when the build folder has no index.html, and leaves a built one alone', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'ed no ui '))
    parents.push(empty)
    let builds = 0
    const build = async () => {
      builds++
    }

    expect(await ensureUiBuilt(empty, build)).toBe(true)
    expect(await ensureUiBuilt(uiDir, build)).toBe(false)
    expect(builds).toBe(1)
  })
})

describe('startEditor', () => {
  it('binds both listeners to 127.0.0.1, the project origin on editor port + 1, with ipv4first DNS order', async () => {
    dns.setDefaultResultOrder('verbatim')
    const root = await makeProject()
    const port = await freePortPair()

    const editor = await launch(root, port)

    expect(editor.address()).toMatchObject({ address: '127.0.0.1', port })
    expect(editor.projectAddress()).toMatchObject({ address: '127.0.0.1', port: port + 1 })
    expect(dns.getDefaultResultOrder()).toBe('ipv4first')
  })

  it('writes .editor/server.json with both ports, a fresh token and its pid, and removes it on close', async () => {
    const root = await makeProject()
    const port = await freePortPair()
    const editor = await launch(root, port)

    const first = readServerJson(root)
    expect(first).toMatchObject({ port, projectPort: port + 1, pid: process.pid })
    expect(first.token.length).toBeGreaterThanOrEqual(32)
    const health = await request(port, HTTP_ROUTES.health, { token: first.token })
    expect(JSON.parse(health.body)).toEqual({ ok: true, pid: process.pid })

    await editor.close()
    expect(existsSync(serverJsonOf(root))).toBe(false)

    await launch(root, port)
    expect(readServerJson(root).token).not.toBe(first.token)
  })

  it('keeps the running editor\'s server.json when a second start on the same port fails', async () => {
    const root = await makeProject()
    const port = await freePortPair()
    await launch(root, port)
    const running = readServerJson(root)

    await expect(startEditor({ projectDir: root, port, dev: false, uiDir })).rejects.toThrow(inUseMessage(port))

    expect(readServerJson(root)).toEqual(running)
  })

  it.skipIf(ON_WINDOWS)('writes server.json readable by its owner only', async () => {
    const root = await makeProject()
    const port = await freePortPair()

    await launch(root, port)

    expect(statSync(serverJsonOf(root)).mode & 0o777).toBe(0o600)
  })

  it('opens a project whose path has spaces and non-ASCII characters', async () => {
    const root = await makeProject()
    expect(root).toMatch(/ .*[^\p{ASCII}]/u)
    const port = await freePortPair()

    await launch(root, port)

    expect((await request(port, '/')).status).toBe(200)
  })

  it('stops with the in-use message when the editor port is taken, and never falls back to another port', async () => {
    const root = await makeProject()
    const port = await freePortPair()
    await occupy(port)

    await expect(startEditor({ projectDir: root, port, dev: false, uiDir })).rejects.toThrow(inUseMessage(port))

    expect(existsSync(serverJsonOf(root))).toBe(false)
    expect(await isFree(port + 1)).toBe(true)
  })

  it('stops with the in-use message when the project port is taken, and releases the editor port', async () => {
    const root = await makeProject()
    const port = await freePortPair()
    await occupy(port + 1)

    await expect(startEditor({ projectDir: root, port, dev: false, uiDir })).rejects.toThrow(inUseMessage(port + 1))

    expect(existsSync(serverJsonOf(root))).toBe(false)
    expect(await isFree(port)).toBe(true)
  })
})

describe('scripts/start.mjs', () => {
  it('runs the editor with the given args and shuts down on a token-guarded POST /shutdown', async () => {
    const root = await makeProject()
    const port = await freePortPair()
    const cli = await healthyCli(root, port)
    const info = readServerJson(root)
    expect(info).toMatchObject({ port, projectPort: port + 1, pid: cli.child.pid })

    expect((await request(port, HTTP_ROUTES.shutdown, { method: 'POST' })).status).toBeGreaterThanOrEqual(400)
    expect((await request(port, HTTP_ROUTES.shutdown, { method: 'POST', token: `${info.token}x` })).status).toBeGreaterThanOrEqual(400)
    await delay(300)
    expect(cli.child.exitCode).toBeNull()

    expect((await request(port, HTTP_ROUTES.shutdown, { method: 'POST', token: info.token })).status).toBe(200)

    expect(await cli.exited).toBe(0)
    expect(existsSync(serverJsonOf(root))).toBe(false)
  }, CLI_TEST_MS)

  it('shuts down cleanly when stdin closes', async () => {
    const root = await makeProject()
    const port = await freePortPair()
    const cli = await healthyCli(root, port)

    cli.child.stdin.end()

    expect(await cli.exited).toBe(0)
    expect(existsSync(serverJsonOf(root))).toBe(false)
  }, CLI_TEST_MS)

  it.skipIf(ON_WINDOWS)('shuts down cleanly on a real SIGINT', async () => {
    const root = await makeProject()
    const port = await freePortPair()
    const cli = await healthyCli(root, port)

    cli.child.kill('SIGINT')

    expect(await cli.exited).toBe(0)
    expect(existsSync(serverJsonOf(root))).toBe(false)
  }, CLI_TEST_MS)

  it.each(['SIGINT', 'SIGBREAK'])('shuts down cleanly on %s', async (signal) => {
    const root = await makeProject()
    const port = await freePortPair()
    const preload = signalPreload(path.dirname(root))
    const env = { ...process.env, ED_TEST_SERVER_JSON: serverJsonOf(root), ED_TEST_SIGNAL: signal }
    const cli = await startedCli(root, port, ['--import', pathToFileURL(preload).href], env)

    expect(await cli.exited).toBe(0)
    expect(existsSync(serverJsonOf(root))).toBe(false)
  }, CLI_TEST_MS)

  it('exits with the in-use message when the port is taken', async () => {
    const root = await makeProject()
    const port = await freePortPair()
    await occupy(port)

    const cli = runCli(['--project', root, '--port', String(port)])

    expect(await cli.exited).not.toBe(0)
    expect(cli.stderr()).toContain(inUseMessage(port))
    expect(existsSync(serverJsonOf(root))).toBe(false)
  }, CLI_TEST_MS)

  it.skipIf(ON_WINDOWS)('stops at startup with the found version and an upgrade hint when Git is older than 2.44', async () => {
    const root = await makeProject()
    const fakeBin = path.join(path.dirname(root), 'old git bin')
    mkdirSync(fakeBin)
    writeFileSync(path.join(fakeBin, 'git'), '#!/bin/sh\necho "git version 2.39.5"\n')
    chmodSync(path.join(fakeBin, 'git'), 0o755)
    const port = await freePortPair()

    const cli = runCli(['--project', root, '--port', String(port)], { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}` })

    expect(await cli.exited).not.toBe(0)
    expect(cli.stderr()).toContain('2.39.5')
    expect(cli.stderr()).toMatch(process.platform === 'darwin' ? /brew install git/ : /Git/)
    expect(existsSync(serverJsonOf(root))).toBe(false)
    expect(await isFree(port)).toBe(true)
  }, CLI_TEST_MS)
})
