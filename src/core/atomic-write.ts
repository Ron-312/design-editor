import writeFileAtomic from 'write-file-atomic'

const LOCK_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const GIVE_UP_AFTER_MS = 3_000
const FIRST_DELAY_MS = 10
const MAX_DELAY_MS = 400

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isLockError(error: unknown): boolean {
  return LOCK_ERROR_CODES.has((error as NodeJS.ErrnoException).code ?? '')
}

/** Windows refuses rename and delete while an antivirus, indexer or editor holds the file (R11 #9). */
export async function retryWhileLocked<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + GIVE_UP_AFTER_MS
  for (let delay = FIRST_DELAY_MS; ; delay = Math.min(delay * 2, MAX_DELAY_MS)) {
    try {
      return await operation()
    } catch (error) {
      if (!isLockError(error)) throw error
      if (Date.now() + delay > deadline) throw new Error('file locked by another program', { cause: error })
      await sleep(delay)
    }
  }
}

/** Temp file in the target's directory, fsync, rename: a reader sees the old bytes or the new, never a mix. */
export function atomicWrite(file: string, bytes: Buffer, options: { readonly mode?: number } = {}): Promise<void> {
  return retryWhileLocked(() => writeFileAtomic(file, bytes, options))
}
