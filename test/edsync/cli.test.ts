import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquirePushLock } from '../../src/core/push-lock'
import { HTTP_ROUTES } from '../../src/shared/protocol'
import { EDSYNC_VERBS, LEASE, type CacheOutput, type IngestOutput } from '../../src/shared/sync'
import {
  CSS_BLOB,
  expectOk,
  FIXTURE_FETCHED,
  HOME,
  parsedOk,
  RELEASE,
  SLUG,
  SVG_BLOB,
  useIsolatedGitConfig,
  Workspace,
} from './fake-remote'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const EDSYNC_MJS = path.join(REPO, 'tools', 'edsync.mjs')
const OLD_GIT = '2.39.5'
const ON_WINDOWS = process.platform === 'win32'
const SPAWN_MS = 60_000

useIsolatedGitConfig()

let space: Workspace

beforeEach(() => {
  space = Workspace.create()
})

afterEach(() => {
  space.dispose()
})

function writeServerJson(port: number): void {
  mkdirSync(path.dirname(space.serverJsonFile()), { recursive: true })
  writeFileSync(
    space.serverJsonFile(),
    JSON.stringify({ port, projectPort: port + 1, token: 'a'.repeat(43), pid: 999_999, startedAt: Date.now() }),
  )
}

async function portNobodyListensOn(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/** A `git` ahead of the real one on PATH that answers `--version` like an old Apple Git. */
function withOldGitOnPath(): () => void {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'edsync-old-git-'))
  const fake = path.join(dir, 'git')
  writeFileSync(fake, `#!/bin/sh\necho "git version ${OLD_GIT} (Apple Git-154)"\n`)
  chmodSync(fake, 0o755)
  const savedPath = process.env.PATH
  process.env.PATH = `${dir}${path.delimiter}${savedPath ?? ''}`
  return () => {
    process.env.PATH = savedPath
    rmSync(dir, { recursive: true, force: true })
  }
}

function spawnEdsync(...argv: string[]) {
  return spawnSync(process.execPath, [EDSYNC_MJS, ...argv], { cwd: space.cwd, encoding: 'utf8', timeout: SPAWN_MS, windowsHide: true })
}

// A fake git that Node can spawn without a shell would have to be a Windows executable.
describe.skipIf(ON_WINDOWS)('the Git version check', () => {
  it.each([...EDSYNC_VERBS])('refuses %s under a Git older than 2.44, naming its version and an upgrade', async (verb) => {
    const restore = withOldGitOnPath()
    try {
      const run = await space.edsync(verb, '--slug', SLUG)

      expect(run.exitCode).not.toBe(0)
      expect(run.stderr).toContain(OLD_GIT)
      expect(run.stderr).toContain('2.44')
      if (process.platform === 'darwin') expect(run.stderr).toContain('brew install git')
    } finally {
      restore()
    }
  })

  it('checks the version before ingest places any file', async () => {
    const restore = withOldGitOnPath()
    try {
      const run = await space.edsync('ingest', '--remote-dir', space.remote.snapshot(), '--slug', SLUG)

      expect(run.exitCode).not.toBe(0)
      expect(existsSync(space.projectDir)).toBe(false)
    } finally {
      restore()
    }
  })
})

describe('edsync ingest, cache and rewrite-blobs', () => {
  it('ingests the snapshot into projects/<slug>/ under the working directory and prints what to fetch', async () => {
    const output = parsedOk<IngestOutput>(await space.edsync('ingest', '--remote-dir', space.remote.snapshot(), '--slug', SLUG))

    expect(output.slug).toBe(SLUG)
    expect([...output.blobIds].sort()).toEqual([CSS_BLOB, SVG_BLOB].sort())
    expect(output.supportJs).toBe(true)
    expect(space.local(HOME).equals(space.remote.read(HOME))).toBe(true)
    expect(space.base().commit).toBe(space.head())
  })

  it('caches fetched blobs by id and support.js by type release', async () => {
    await space.ingest()

    const output = parsedOk<CacheOutput>(await space.edsync('cache', '--slug', SLUG, '--from', FIXTURE_FETCHED, '--release', RELEASE))

    expect([...output.copied].sort()).toEqual([CSS_BLOB, SVG_BLOB, 'support.js'].sort())
    expect(output.missing).toEqual([])
    expect(readFileSync(path.join(space.cacheDir(), RELEASE, 'support.js')).equals(readFileSync(path.join(FIXTURE_FETCHED, 'support.js')))).toBe(true)
  })

  it('rewrites /_blob ids in the project files from a map file', async () => {
    await space.ingest()
    const copyBlob = '1234567890abcdef1234567890abcdef'
    const mapFile = path.join(space.cwd, 'blob map.json')
    writeFileSync(mapFile, JSON.stringify({ [CSS_BLOB]: copyBlob }))

    expectOk(await space.edsync('rewrite-blobs', '--slug', SLUG, '--map', mapFile))

    const home = space.local(HOME).toString('utf8')
    expect(home).toContain(`/_blob/${copyBlob}`)
    expect(home).not.toContain(`/_blob/${CSS_BLOB}`)
  })
})

describe('edsync lock', () => {
  beforeEach(async () => {
    await space.pull()
  })

  it('creates push.lock itself with a 15-minute lease when no editor is running, and prints its nonce', async () => {
    const printed = parsedOk<{ nonce: string; holder: string }>(await space.edsync('lock', '--slug', SLUG))

    const lock = space.pushLock()!
    expect(printed.nonce).toBe(lock.nonce)
    expect(lock.holder).toBe('edsync')
    expect(lock.expiresAt - lock.startedAt).toBe(LEASE.cliMs)
  })

  it('takes the lock itself when server.json names an editor that does not answer', async () => {
    writeServerJson(await portNobodyListensOn())

    const nonce = await space.lock()

    expect(space.pushLock()).toMatchObject({ nonce, holder: 'edsync' })
  })

  it('refuses while another holder’s lease is live and leaves that lock alone', async () => {
    const other = await acquirePushLock(space.projectDir, { holder: 'editor', leaseMs: LEASE.editorMs })

    const run = await space.edsync('lock', '--slug', SLUG)

    expect(run.exitCode).not.toBe(0)
    expect(space.pushLock()?.nonce).toBe(other!.nonce)
  })

  it('takes over a lock only once its expiresAt has passed', async () => {
    space.writePushLock({ nonce: 'expired-holder', holder: 'edsync', pid: process.pid, startedAt: Date.now() - 20 * 60_000, expiresAt: Date.now() - 1_000 })

    const nonce = await space.lock()

    expect(nonce).not.toBe('expired-holder')
    expect(space.pushLock()?.nonce).toBe(nonce)
  })
})

describe('edsync lock through a slow editor', () => {
  beforeEach(async () => {
    await space.pull()
  })

  it('asks /push/begin for its own nonce and ends the push under that nonce when the editor answers too late', async () => {
    const begun: string[] = []
    const ended: string[] = []
    const editor = http.createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (request.url === HTTP_ROUTES.health) return response.end(JSON.stringify({ ok: true, pid: 1 }))
        if (request.url === HTTP_ROUTES.pushEnd) {
          ended.push((JSON.parse(body) as { nonce: string }).nonce)
          return response.end(JSON.stringify({ ok: true }))
        }
        begun.push((JSON.parse(body) as { nonce: string }).nonce)
        setTimeout(() => response.end(JSON.stringify({ nonce: begun.at(-1) })), LEASE.pushBeginTimeoutMs + 1_000)
      })
    })
    await new Promise<void>((resolve) => editor.listen(0, '127.0.0.1', resolve))
    try {
      writeServerJson((editor.address() as net.AddressInfo).port)

      const run = await space.edsync('lock', '--slug', SLUG)

      expect(run.exitCode).not.toBe(0)
      expect(run.stderr).toMatch(/retry \/design-push/)
      expect(begun).toHaveLength(1)
      expect(begun[0]).toMatch(/^[0-9a-f-]{36}$/)
      expect(ended).toEqual(begun)
    } finally {
      editor.closeAllConnections()
      await new Promise<void>((resolve) => editor.close(() => resolve()))
    }
  }, 20_000)
})

describe('edsync unlock', () => {
  beforeEach(async () => {
    await space.pull()
  })

  it('deletes the CLI’s own lock', async () => {
    const nonce = await space.lock()

    expectOk(await space.unlockRun(nonce))

    expect(space.pushLock()).toBeNull()
  })

  it('never deletes a lock that carries someone else’s nonce', async () => {
    const nonce = await space.lock()
    expectOk(await space.unlockRun(nonce))
    const other = await acquirePushLock(space.projectDir, { holder: 'editor', leaseMs: LEASE.editorMs })

    await space.unlockRun(nonce)

    expect(space.pushLock()?.nonce).toBe(other!.nonce)
  })
})

describe('the other verbs', () => {
  it('says shots is not available in v1 (M7)', async () => {
    const run = await space.edsync('shots', '--slug', SLUG)

    expect(run.stdout + run.stderr).toMatch(/not available in v1/i)
    expect(run.stdout + run.stderr).toContain('M7')
  })

  it('refuses a verb it does not know', async () => {
    expect((await space.edsync('publish', '--slug', SLUG)).exitCode).not.toBe(0)
  })
})

describe('tools/edsync.mjs', () => {
  it('runs a verb from any working directory and exits 0 with its output', () => {
    const result = spawnEdsync('ingest', '--remote-dir', space.remote.snapshot(), '--slug', SLUG)

    expect(result.status, result.stderr).toBe(0)
    expect((JSON.parse(result.stdout) as IngestOutput).slug).toBe(SLUG)
    expect(space.local(HOME).equals(space.remote.read(HOME))).toBe(true)
  }, SPAWN_MS)

  it('exits with the code the verb returns, non-zero when it fails', async () => {
    const missingSnapshot = path.join(space.cwd, 'no such snapshot')
    const failed = await space.edsync('ingest', '--remote-dir', missingSnapshot, '--slug', SLUG)
    const shots = await space.edsync('shots', '--slug', SLUG)

    expect(failed.exitCode).not.toBe(0)
    expect(spawnEdsync('ingest', '--remote-dir', missingSnapshot, '--slug', SLUG).status).toBe(failed.exitCode)
    const spawnedShots = spawnEdsync('shots', '--slug', SLUG)
    expect(spawnedShots.status).toBe(shots.exitCode)
    expect(spawnedShots.stdout + spawnedShots.stderr).toContain('M7')
  }, SPAWN_MS)
})
