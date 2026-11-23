import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { EDITOR_FILES } from '../shared/protocol'
import type { PushLock } from '../shared/sync'
import { atomicWrite, retryWhileLocked } from './atomic-write'

export interface AcquireOptions {
  readonly holder: PushLock['holder']
  readonly leaseMs: number
}

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
  try {
    await retryWhileLocked(() => unlink(file))
    return true
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

/** Free means gone or removed here because its lease lapsed; the holder's PID is never consulted (R11 #13). */
async function freeIfStale(file: string): Promise<boolean> {
  const text = await readLockText(file)
  if (text === null) return true
  const held = parseLock(text)
  if (!held || held.expiresAt > Date.now()) return false
  return deleteIfNonce(file, held.nonce)
}

/** Returns the new lock, or null while another holder's lease is live. */
export async function acquirePushLock(projectDir: string, options: AcquireOptions): Promise<PushLock | null> {
  const file = lockFileOf(projectDir)
  await mkdir(path.dirname(file), { recursive: true })
  const startedAt = Date.now()
  const lock: PushLock = {
    nonce: randomUUID(),
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
export async function renewPushLock(projectDir: string, nonce: string, leaseMs: number): Promise<PushLock | null> {
  const held = await readPushLock(projectDir)
  if (held?.nonce !== nonce) return null
  const renewed: PushLock = { ...held, expiresAt: Date.now() + leaseMs }
  await atomicWrite(lockFileOf(projectDir), Buffer.from(JSON.stringify(renewed)))
  return renewed
}

/** Deletes the lock only while it still carries our nonce. */
export function releasePushLock(projectDir: string, nonce: string): Promise<boolean> {
  return deleteIfNonce(lockFileOf(projectDir), nonce)
}
