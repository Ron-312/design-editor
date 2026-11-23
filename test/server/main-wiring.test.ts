import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { chmod } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FSWatcher } from 'chokidar'
import { build } from 'vite'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ensureUiBuilt, startEditor, type Editor } from '../../src/server/main'
import { copyDir } from '../copy-dir'
import { cacheFixtureAssets } from '../pulled-fixture'

const chokidars = vi.hoisted(() => [] as unknown[])

vi.mock('vite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vite')>()
  return { ...actual, build: vi.fn(actual.build) }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, chmod: vi.fn(actual.chmod), default: { ...actual, chmod: vi.fn(actual.chmod) } }
})

vi.mock('chokidar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('chokidar')>()
  type Options = ConstructorParameters<typeof actual.FSWatcher>[0]
  const watch = (paths: string | string[], options: Options = {}) => {
    const watcher = new actual.FSWatcher(options).add(paths)
    chokidars.push(watcher)
    return watcher
  }
  return { ...actual, watch, default: { ...actual.default, watch } }
})

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const CANVAS = fileURLToPath(new URL('../fixtures/canvas/', import.meta.url))

const parents: string[] = []
const editors: Editor[] = []
let uiDir = ''

beforeAll(() => {
  uiDir = mkdtempSync(path.join(tmpdir(), 'ed ui '))
  writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><html><head><title>Design Editor</title></head><body></body></html>\n')
})

afterEach(async () => {
  for (const editor of editors.splice(0)) await editor.close()
  for (const parent of parents.splice(0)) rmSync(parent, { recursive: true, force: true })
  chokidars.length = 0
  vi.restoreAllMocks()
})

afterAll(() => {
  rmSync(uiDir, { recursive: true, force: true })
})

async function makeProject(): Promise<string> {
  const parent = mkdtempSync(path.join(tmpdir(), 'ed wiring '))
  parents.push(parent)
  const root = path.join(parent, 'Café board ü')
  copyDir(path.join(CANVAS, 'project'), path.join(root, 'project'))
  await cacheFixtureAssets(root)
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

async function launch(): Promise<{ root: string; editor: Editor }> {
  const root = await makeProject()
  const editor = await startEditor({ projectDir: root, port: await freePortPair(), dev: false, uiDir })
  editors.push(editor)
  return { root, editor }
}

function serverJsonOf(root: string): string {
  return path.join(root, '.editor', 'server.json')
}

describe('ensureUiBuilt with its default build', () => {
  it('builds the UI source into dist/ui with the repo’s Vite config, emptying the folder first', async () => {
    vi.mocked(build).mockResolvedValueOnce([])
    const empty = mkdtempSync(path.join(tmpdir(), 'ed no ui '))
    parents.push(empty)

    expect(await ensureUiBuilt(empty)).toBe(true)

    expect(build).toHaveBeenCalledTimes(1)
    expect(vi.mocked(build).mock.calls[0]![0]).toMatchObject({
      configFile: path.join(REPO, 'vite.config.ts'),
      root: path.join(REPO, 'src', 'ui'),
      build: { outDir: path.join(REPO, 'dist', 'ui'), emptyOutDir: true },
    })
  })
})

describe('startEditor on a file system without Unix modes', () => {
  it('still writes server.json when chmod fails on it', async () => {
    const realChmod = vi.mocked(chmod).getMockImplementation()!
    vi.mocked(chmod).mockImplementation(async (file, mode) => {
      if (String(file).endsWith('server.json')) throw Object.assign(new Error('EPERM: operation not permitted, chmod'), { code: 'EPERM' })
      return realChmod(file, mode)
    })

    try {
      const { root } = await launch()

      expect(vi.mocked(chmod)).toHaveBeenCalledWith(serverJsonOf(root), 0o600)
      expect(existsSync(serverJsonOf(root))).toBe(true)
      expect(JSON.parse(readFileSync(serverJsonOf(root), 'utf8'))).toMatchObject({ pid: process.pid })
    } finally {
      vi.mocked(chmod).mockImplementation(realChmod)
    }
  })
})

describe('startEditor watcher warnings', () => {
  it('prints a file watcher error as a warning and keeps running', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { editor } = await launch()
    const watcher = chokidars.at(-1) as FSWatcher | undefined
    expect(watcher).toBeDefined()

    watcher!.emit('error', Object.assign(new Error('watch limit reached'), { code: 'ENOSPC' }))

    expect(warn).toHaveBeenCalledWith('file watcher: watch limit reached')
    expect(editor.address().port).toBeGreaterThan(0)
  })
})
