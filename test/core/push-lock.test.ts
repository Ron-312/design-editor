import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquirePushLock, isPushLockLive, readPushLock, releasePushLock, renewPushLock } from '../../src/core/push-lock'
import { EDITOR_FILES } from '../../src/shared/protocol'
import { LEASE, type PushLock } from '../../src/shared/sync'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PUSH_LOCK_MODULE = pathToFileURL(path.join(REPO_ROOT, 'src', 'core', 'push-lock.ts')).href
const ON_WINDOWS = process.platform === 'win32'

let projectDir: string
let lockFile: string
let holderProcess: ChildProcess | undefined

beforeEach(() => {
  projectDir = mkdtempSync(path.join(os.tmpdir(), 'push-lock-'))
  lockFile = path.join(projectDir, ...EDITOR_FILES.pushLock.split('/'))
})

afterEach(() => {
  holderProcess?.kill('SIGKILL')
  holderProcess = undefined
  const editorDir = path.dirname(lockFile)
  if (existsSync(editorDir)) chmodSync(editorDir, 0o755)
  rmSync(projectDir, { recursive: true, force: true })
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function sleepUntilPast(epochMs: number): Promise<void> {
  await sleep(Math.max(0, epochMs - Date.now()) + 50)
}

function lockOnDisk(): PushLock {
  return JSON.parse(readFileSync(lockFile, 'utf8')) as PushLock
}

function mustAcquire(lock: PushLock | null): PushLock {
  if (!lock) throw new Error('expected the push lock to be acquired')
  return lock
}

const HOLDER_SCRIPT = `
const [moduleUrl, projectDir, leaseMs] = process.argv.slice(2)
const { acquirePushLock } = await import(moduleUrl)
const lock = await acquirePushLock(projectDir, { holder: 'edsync', leaseMs: Number(leaseMs) })
process.stdout.write(JSON.stringify(lock) + '\\n')
setInterval(() => {}, 60_000)
`

function startLockHolder(leaseMs: number): Promise<{ child: ChildProcess; lock: PushLock }> {
  const script = path.join(projectDir, 'hold-lock.mjs')
  writeFileSync(script, HOLDER_SCRIPT)
  const child = spawn(process.execPath, ['--import', 'tsx', script, PUSH_LOCK_MODULE, projectDir, String(leaseMs)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.includes('\n')) resolve({ child, lock: JSON.parse(stdout) as PushLock })
    })
    child.on('exit', (code) => reject(new Error(`lock holder exited with ${code}: ${stderr}`)))
  })
}

function killAndWait(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.on('exit', () => resolve())
    child.kill('SIGKILL')
  })
}

describe('acquirePushLock', () => {
  it('creates .editor/push.lock as {nonce, holder, pid, startedAt, expiresAt}', async () => {
    const before = Date.now()
    const lock = mustAcquire(await acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 15 * 60_000 }))
    const after = Date.now()

    expect(Object.keys(lockOnDisk()).sort()).toEqual(['expiresAt', 'holder', 'nonce', 'pid', 'startedAt'])
    expect(lockOnDisk()).toEqual(lock)
    expect(lock.holder).toBe('edsync')
    expect(lock.pid).toBe(process.pid)
    expect(lock.nonce).not.toBe('')
    expect(lock.startedAt).toBeGreaterThanOrEqual(before)
    expect(lock.startedAt).toBeLessThanOrEqual(after)
    expect(lock.expiresAt - lock.startedAt).toBe(15 * 60_000)
  })

  it('gives each acquisition a fresh nonce', async () => {
    const first = mustAcquire(await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 60_000 }))
    await releasePushLock(projectDir, first.nonce)
    const second = mustAcquire(await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 60_000 }))
    expect(second.nonce).not.toBe(first.nonce)
  })

  it('lets exactly one of several concurrent callers take the lock', async () => {
    mkdirSync(path.dirname(lockFile), { recursive: true })
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 60_000 })),
    )
    const winners = attempts.filter((lock): lock is PushLock => lock !== null)
    expect(winners).toHaveLength(1)
    expect(lockOnDisk()).toEqual(winners[0])
  })

  it('refuses while an unexpired lock is held and leaves its bytes alone', async () => {
    await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 60_000 })
    const heldBytes = readFileSync(lockFile)
    await expect(acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 60_000 })).resolves.toBeNull()
    expect(readFileSync(lockFile).equals(heldBytes)).toBe(true)
  })

  it('treats a push.lock that never became valid JSON as held while it is younger than the lease', async () => {
    mkdirSync(path.dirname(lockFile), { recursive: true })
    writeFileSync(lockFile, '')
    await expect(acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 60_000 })).resolves.toBeNull()
    await expect(isPushLockLive(projectDir)).resolves.toBe(true)
    expect(readFileSync(lockFile, 'utf8')).toBe('')
  })

  it('takes over a push.lock that never became valid JSON once its mtime is older than the lease', async () => {
    mkdirSync(path.dirname(lockFile), { recursive: true })
    writeFileSync(lockFile, '{"nonce": "half')
    const longAgo = new Date(Date.now() - LEASE.editorMs - 1_000)
    utimesSync(lockFile, longAgo, longAgo)

    await expect(isPushLockLive(projectDir)).resolves.toBe(false)
    const taken = mustAcquire(await acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 60_000 }))
    expect(lockOnDisk()).toEqual(taken)
  })

  it('holds the lock under the nonce it is given', async () => {
    const taken = mustAcquire(await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 60_000, nonce: 'cli-chosen' }))
    expect(taken.nonce).toBe('cli-chosen')
    expect(lockOnDisk().nonce).toBe('cli-chosen')
  })

  it('takes over a lock once expiresAt has passed, even though its holder is alive', async () => {
    const stale = mustAcquire(await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 200 }))
    await sleepUntilPast(stale.expiresAt)
    const taken = mustAcquire(await acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 60_000 }))
    expect(taken.nonce).not.toBe(stale.nonce)
    expect(lockOnDisk()).toEqual(taken)
  })

  it(
    'takes over a lock whose holder was killed only after its expiresAt',
    async () => {
      const { child, lock: held } = await startLockHolder(3_000)
      holderProcess = child
      expect(lockOnDisk()).toEqual(held)
      await killAndWait(child)

      expect(Date.now()).toBeLessThan(held.expiresAt)
      await expect(acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 60_000 })).resolves.toBeNull()
      expect(lockOnDisk()).toEqual(held)

      await sleepUntilPast(held.expiresAt)
      const taken = mustAcquire(await acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 60_000 }))
      expect(taken.nonce).not.toBe(held.nonce)
      expect(taken.pid).toBe(process.pid)
    },
    20_000,
  )
})

describe('readPushLock', () => {
  it('returns null when no lock exists', async () => {
    await expect(readPushLock(projectDir)).resolves.toBeNull()
  })

  it('returns the lock on disk', async () => {
    const lock = await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 60_000 })
    await expect(readPushLock(projectDir)).resolves.toEqual(lock)
  })
})

describe('renewPushLock', () => {
  it('moves expiresAt forward and keeps nonce, holder and startedAt', async () => {
    const lock = mustAcquire(await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 60_000 }))
    await sleep(20)
    const renewed = mustAcquire(await renewPushLock(projectDir, lock.nonce, 60_000))
    expect(renewed.expiresAt).toBeGreaterThan(lock.expiresAt)
    expect(renewed).toMatchObject({ nonce: lock.nonce, holder: 'editor', startedAt: lock.startedAt, pid: lock.pid })
    expect(lockOnDisk()).toEqual(renewed)
  })

  it('keeps the lock held past its first lease', async () => {
    const lock = mustAcquire(await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 400 }))
    await sleep(200)
    await renewPushLock(projectDir, lock.nonce, 1_000)
    await sleepUntilPast(lock.expiresAt)
    await expect(acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 60_000 })).resolves.toBeNull()
  })

  it('does not touch a lock whose nonce is not ours', async () => {
    await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 60_000 })
    const heldBytes = readFileSync(lockFile)
    await expect(renewPushLock(projectDir, 'someone-else', 60_000)).resolves.toBeNull()
    expect(readFileSync(lockFile).equals(heldBytes)).toBe(true)
  })

  it('reports a lock that is gone', async () => {
    const lock = mustAcquire(await acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 60_000 }))
    rmSync(lockFile)
    await expect(renewPushLock(projectDir, lock.nonce, 60_000)).resolves.toBeNull()
    expect(existsSync(lockFile)).toBe(false)
  })

  it('never brings back a lock released while the renewal was in flight', async () => {
    for (let round = 0; round < 20; round++) {
      const lock = mustAcquire(await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 60_000 }))
      const renewing = renewPushLock(projectDir, lock.nonce, 60_000)
      await releasePushLock(projectDir, lock.nonce)
      await renewing

      expect(existsSync(lockFile), `round ${round}`).toBe(false)
    }
  })
})

describe('releasePushLock', () => {
  it('deletes the lock when the nonce is ours', async () => {
    const lock = mustAcquire(await acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 60_000 }))
    await expect(releasePushLock(projectDir, lock.nonce)).resolves.toBe(true)
    expect(existsSync(lockFile)).toBe(false)
  })

  it('never deletes a lock whose nonce is not ours', async () => {
    await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 60_000 })
    const heldBytes = readFileSync(lockFile)
    await expect(releasePushLock(projectDir, 'someone-else')).resolves.toBe(false)
    expect(readFileSync(lockFile).equals(heldBytes)).toBe(true)
  })

  it('leaves a lock that took over ours after our lease lapsed', async () => {
    const ours = mustAcquire(await acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 200 }))
    await sleepUntilPast(ours.expiresAt)
    const theirs = mustAcquire(await acquirePushLock(projectDir, { holder: 'editor', leaseMs: 60_000 }))
    await expect(releasePushLock(projectDir, ours.nonce)).resolves.toBe(false)
    expect(lockOnDisk()).toEqual(theirs)
  })

  it('returns false when there is no lock', async () => {
    await expect(releasePushLock(projectDir, 'any-nonce')).resolves.toBe(false)
  })

  it.skipIf(ON_WINDOWS)('retries the delete while the directory refuses it', async () => {
    const lock = mustAcquire(await acquirePushLock(projectDir, { holder: 'edsync', leaseMs: 60_000 }))
    const editorDir = path.dirname(lockFile)
    chmodSync(editorDir, 0o555)
    setTimeout(() => chmodSync(editorDir, 0o755), 400)
    await expect(releasePushLock(projectDir, lock.nonce)).resolves.toBe(true)
    expect(existsSync(lockFile)).toBe(false)
  })
})
