import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ingest } from '../../src/edsync/ingest'
import { EDITOR_FILES } from '../../src/shared/protocol'
import type { BaseJson } from '../../src/shared/sync'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const FIXTURE_PROJECT = path.join(FIXTURES, 'canvas', 'project')
const ENDINGS = path.join(FIXTURES, 'endings')
const SLUG = 'test-site'
const CSS_BLOB = 'b1a2c3d4e5f60718293a4b5c6d7e8f90'
const SVG_BLOB = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'
const FIXTURE_FILES = ['project/canvas.json', 'project/card.dc.html', 'project/ds/core/tokens.json', 'project/home.dc.html']
const ENDING_FILES = {
  'project/edge-crlf.dc.html': 'edge.crlf.dc.html',
  'project/edge-bom.dc.html': 'edge.bom.dc.html',
  'project/edge-mixed.dc.html': 'edge.mixed.dc.html',
}
const DIRTY_MESSAGE = /run \/design-push first/
const ON_WINDOWS = process.platform === 'win32'

let gitHome: string
let sandbox: string
let remoteDir: string
let projectsDir: string
let projectDir: string
const savedEnv: Record<string, string | undefined> = {}

function setEnv(name: string, value: string): void {
  savedEnv[name] = process.env[name]
  process.env[name] = value
}

beforeAll(() => {
  gitHome = mkdtempSync(path.join(os.tmpdir(), 'ingest-gitconfig-'))
  const globalConfig = path.join(gitHome, 'gitconfig')
  writeFileSync(
    globalConfig,
    '[user]\n\tname = Edsync Test\n\temail = edsync@example.test\n[core]\n\tautocrlf = true\n\tsafecrlf = true\n',
  )
  setEnv('GIT_CONFIG_GLOBAL', globalConfig)
  setEnv('GIT_CONFIG_NOSYSTEM', '1')
})

afterAll(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  rmSync(gitHome, { recursive: true, force: true })
})

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), 'ingest-'))
  remoteDir = path.join(sandbox, 'remote')
  projectsDir = path.join(sandbox, 'projects')
  projectDir = path.join(projectsDir, SLUG)
  cpSync(FIXTURE_PROJECT, path.join(remoteDir, 'project'), { recursive: true })
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function gitBytes(cwd: string, ...args: string[]): Buffer {
  return execFileSync('git', args, { cwd })
}

function remoteFile(projectPath: string): string {
  return path.join(remoteDir, ...projectPath.split('/'))
}

function localFile(projectPath: string): string {
  return path.join(projectDir, ...projectPath.split('/'))
}

function addRemoteFile(projectPath: string, bytes: Buffer): void {
  mkdirSync(path.dirname(remoteFile(projectPath)), { recursive: true })
  writeFileSync(remoteFile(projectPath), bytes)
}

function addEndingFixtures(): void {
  for (const [projectPath, fixture] of Object.entries(ENDING_FILES)) {
    addRemoteFile(projectPath, readFileSync(path.join(ENDINGS, fixture)))
  }
}

function readBaseJson(): BaseJson {
  return JSON.parse(readFileSync(path.join(projectDir, ...EDITOR_FILES.base.split('/')), 'utf8')) as BaseJson
}

function committedBlobHashes(): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const line of git(projectDir, 'ls-tree', '-r', 'HEAD').trim().split('\n')) {
    const [meta, file] = line.split('\t')
    const hash = meta?.split(' ')[2]
    if (file && hash) hashes[file] = hash
  }
  return hashes
}

function statusLines(): string[] {
  return git(projectDir, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean)
}

const ingestTestSite = () => ingest({ remoteDir, slug: SLUG, projectsDir })

describe('ingest into a fresh project', () => {
  it('places every project/* file, canvas.json included, byte for byte', async () => {
    await ingestTestSite()
    for (const projectPath of FIXTURE_FILES) {
      expect(readFileSync(localFile(projectPath)).equals(readFileSync(remoteFile(projectPath))), projectPath).toBe(true)
    }
  })

  it('reports the /_blob ids and support.js the skill must fetch', async () => {
    const output = await ingestTestSite()
    expect(output.slug).toBe(SLUG)
    expect([...output.blobIds].sort()).toEqual([SVG_BLOB, CSS_BLOB].sort())
    expect(output.supportJs).toBe(true)
  })

  it('creates a git repository with byte-preserving local config', async () => {
    await ingestTestSite()
    expect(existsSync(path.join(projectDir, '.git'))).toBe(true)
    expect(git(projectDir, 'config', '--local', 'core.autocrlf').trim()).toBe('false')
    expect(git(projectDir, 'config', '--local', 'core.safecrlf').trim()).toBe('false')
    expect(git(projectDir, 'config', '--local', 'core.longpaths').trim()).toBe('true')
  })

  it('writes * -text to .git/info/attributes and .editor/ to .git/info/exclude', async () => {
    await ingestTestSite()
    const attributes = readFileSync(path.join(projectDir, '.git', 'info', 'attributes'), 'utf8').split(/\r?\n/)
    const exclude = readFileSync(path.join(projectDir, '.git', 'info', 'exclude'), 'utf8').split(/\r?\n/)
    expect(attributes).toContain('* -text')
    expect(exclude).toContain('.editor/')
  })

  it('commits a pulled baseline holding exactly the project files', async () => {
    await ingestTestSite()
    expect(git(projectDir, 'log', '--format=%s').trim().split('\n')).toEqual([expect.stringMatching(/pulled/i)])
    expect(Object.keys(committedBlobHashes()).sort()).toEqual([...FIXTURE_FILES].sort())
  })

  it('writes .editor/base.json with the per-file hashes of the baseline commit', async () => {
    await ingestTestSite()
    const base = readBaseJson()
    expect(base.commit).toBe(git(projectDir, 'rev-parse', 'HEAD').trim())
    expect(base.files).toEqual(committedBlobHashes())
  })

  it('leaves git status clean, with .editor/ never listed', async () => {
    await ingestTestSite()
    expect(existsSync(path.join(projectDir, ...EDITOR_FILES.base.split('/')))).toBe(true)
    expect(statusLines()).toEqual([])
  })

  it('keeps CRLF, mixed and BOM bytes in the working tree and in the commit under a global autocrlf=true', async () => {
    addEndingFixtures()
    await ingestTestSite()
    for (const projectPath of Object.keys(ENDING_FILES)) {
      const remoteBytes = readFileSync(remoteFile(projectPath))
      expect(readFileSync(localFile(projectPath)).equals(remoteBytes), projectPath).toBe(true)
      expect(gitBytes(projectDir, 'cat-file', 'blob', `HEAD:${projectPath}`).equals(remoteBytes), projectPath).toBe(true)
    }
    expect(statusLines()).toEqual([])
  })

})

// These names cannot be created on Windows at all, so the snapshot folder there never holds one.
describe.skipIf(ON_WINDOWS)('ingest of a Windows-reserved file name', () => {
  it.each(['project/con.dc.html', 'project/NUL', 'project/draft?.dc.html', 'project/ds/aux.json'])(
    'rejects %s and places nothing',
    async (projectPath) => {
      addRemoteFile(projectPath, Buffer.from('<x-dc></x-dc>\n'))
      await expect(ingestTestSite()).rejects.toThrow(path.posix.basename(projectPath))
      expect(existsSync(projectDir)).toBe(false)
    },
  )
})

describe('ingest into an existing project', () => {
  it('never re-runs git init and keeps the baseline on a clean project', async () => {
    await ingestTestSite()
    const baseline = git(projectDir, 'rev-parse', 'HEAD').trim()
    rmSync(path.join(projectDir, '.git', 'description'))

    await ingestTestSite()

    expect(existsSync(path.join(projectDir, '.git', 'description'))).toBe(false)
    expect(git(projectDir, 'rev-list', '--max-parents=0', 'HEAD').trim()).toBe(baseline)
    expect(git(projectDir, 'rev-parse', 'HEAD').trim()).toBe(baseline)
  })

  it('refuses a working tree that differs from the synced commit and keeps the local bytes', async () => {
    await ingestTestSite()
    const edited = Buffer.from('<x-dc>local edit</x-dc>\n')
    writeFileSync(localFile('project/card.dc.html'), edited)

    await expect(ingestTestSite()).rejects.toThrow(DIRTY_MESSAGE)
    expect(readFileSync(localFile('project/card.dc.html')).equals(edited)).toBe(true)
  })

  it('refuses a project with an untracked project file', async () => {
    await ingestTestSite()
    writeFileSync(localFile('project/new-board.dc.html'), '<x-dc></x-dc>\n')
    await expect(ingestTestSite()).rejects.toThrow(DIRTY_MESSAGE)
  })

  it('refuses a project whose HEAD is past the synced commit', async () => {
    await ingestTestSite()
    writeFileSync(localFile('project/card.dc.html'), '<x-dc>committed locally</x-dc>\n')
    git(projectDir, 'commit', '-q', '-am', 'local edit')
    expect(statusLines()).toEqual([])

    await expect(ingestTestSite()).rejects.toThrow(DIRTY_MESSAGE)
  })
})
