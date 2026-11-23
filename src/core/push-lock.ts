import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { EDITOR_FILES } from '../shared/protocol'
import { LEASE, type PushLock } from '../shared/sync'
import { atomicWrite, retryWhileLocked } from './atomic-write'

export interface AcquireOptions {
  readonly holder: PushLock['holder']
  readonly leaseMs: number
  /** The nonce to hold the lock under; a fresh one by default. */
  readonly nonce?: string
}

/** A lock is written in the same call that creates it, so one still unparsable a lease later was never going to be. */
const UNWRITTEN_LOCK_LEASE_MS = LEASE.editorMs

function lockFileOf(projectDir: string): string {
  return path.join(projectDir, ...EDITOR_FILES.pushLock.split('/'))
}

function isErrorCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code
}

async function readLockText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return null
    throw error
  }
}

/** A lock seen between its exclusive create and its write is still empty, so it does not parse yet. */
function parseLock(text: string): PushLock | undefined {
  try {
    return JSON.parse(text) as PushLock
  } catch {
    return undefined
  }
}

export async function readPushLock(projectDir: string): Promise<PushLock | null> {
  const text = await readLockText(lockFileOf(projectDir))
  return text === null ? null : (JSON.parse(text) as PushLock)
}

async function createExclusively(file: string, lock: PushLock): Promise<boolean> {
  try {
    await writeFile(file, JSON.stringify(lock), { flag: 'wx' })
    return true
  } catch (error) {
    if (isErrorCode(error, 'EEXIST')) return false
    throw error
  }
}

async function deleteIfNonce(file: string, nonce: string): Promise<boolean> {
  const text = await readLockText(file)
  if (text === null || parseLock(text)?.nonce !== nonce) return false
  return deleteLockFile(file)
}

async function deleteIfStillReads(file: string, text: string): Promise<boolean> {
  if ((await readLockText(file)) !== text) return false
  return deleteLockFile(file)
}

async function deleteLockFile(file: string): Promise<boolean> {
  try {
    await retryWhileLocked(() => unlink(file))
    return true
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

async function ageOf(file: string): Promise<number> {
  try {
    return Date.now() - (await stat(file)).mtimeMs
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return Infinity
    throw error
  }
}

/** Live while its lease runs; one that never became valid JSON lapses a lease after it was last written. */
async function isLive(file: string, text: string): Promise<boolean> {
  const held = parseLock(text)
  if (held) return held.expiresAt > Date.now()
  return (await ageOf(file)) <= UNWRITTEN_LOCK_LEASE_MS
}

/** Free means gone or removed here because its lease lapsed; the holder's PID is never consulted (R11 #13). */
async function freeIfStale(file: string): Promise<boolean> {
  const text = await readLockText(file)
  if (text === null) return true
  if (await isLive(file, text)) return false
  const held = parseLock(text)
  return held ? deleteIfNonce(file, held.nonce) : deleteIfStillReads(file, text)
}

/** True while some holder's lease on push.lock is running. */
export async function isPushLockLive(projectDir: string): Promise<boolean> {
  const file = lockFileOf(projectDir)
  const text = await readLockText(file)
  return text !== null && (await isLive(file, text))
}

const lockQueues = new Map<string, Promise<unknown>>()

/** Runs lock operations on one file one at a time in this process, so a renewal can never rewrite a lock released meanwhile. */
function serialized<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const run = (lockQueues.get(file) ?? Promise.resolve()).then(operation, operation)
  const settled = run.catch(() => undefined)
  lockQueues.set(file, settled)
  void settled.then(() => {
    if (lockQueues.get(file) === settled) lockQueues.delete(file)
  })
  return run
}

/** Returns the new lock, or null while another holder's lease is live. */
export function acquirePushLock(projectDir: string, options: AcquireOptions): Promise<PushLock | null> {
  const file = lockFileOf(projectDir)
  return serialized(file, () => acquire(file, options))
}

async function acquire(file: string, options: AcquireOptions): Promise<PushLock | null> {
  await mkdir(path.dirname(file), { recursive: true })
  const startedAt = Date.now()
  const lock: PushLock = {
    nonce: options.nonce ?? randomUUID(),
    holder: options.holder,
    pid: process.pid,
    startedAt,
    expiresAt: startedAt + options.leaseMs,
  }
  if (await createExclusively(file, lock)) return lock
  if (!(await freeIfStale(file))) return null
  return (await createExclusively(file, lock)) ? lock : null
}

/** Moves `expiresAt` to `leaseMs` from now; null when the lock is gone or no longer ours. */
export function renewPushLock(projectDir: string, nonce: string, leaseMs: number): Promise<PushLock | null> {
  return serialized(lockFileOf(projectDir), async () => {
    const held = await readPushLock(projectDir)
    if (held?.nonce !== nonce) return null
    const renewed: PushLock = { ...held, expiresAt: Date.now() + leaseMs }
    await atomicWrite(lockFileOf(projectDir), Buffer.from(JSON.stringify(renewed)))
    return renewed
  })
}

/** Deletes the lock only while it still carries our nonce. */
export function releasePushLock(projectDir: string, nonce: string): Promise<boolean> {
  const file = lockFileOf(projectDir)
  return serialized(file, () => deleteIfNonce(file, nonce))
}
