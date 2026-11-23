import { chmodSync, linkSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWrite, retryWhileLocked } from '../../src/core/atomic-write'

const ENDINGS = fileURLToPath(new URL('../fixtures/endings/', import.meta.url))
const VARIANTS = ['lf', 'crlf', 'mixed', 'bom', 'nonl'] as const
const NOT_UTF8 = Buffer.from([0xef, 0xbb, 0xbf, 0x3c, 0x00, 0xff, 0xfe, 0x0d, 0x0a, 0x0d, 0x80])
const LOCKED_MESSAGE = /file locked by another program/
const ON_WINDOWS = process.platform === 'win32'

let dir: string
let target: string

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'))
  target = path.join(dir, 'board.dc.html')
})

afterEach(() => {
  chmodSync(dir, 0o755)
  rmSync(dir, { recursive: true, force: true })
})

function errorWithCode(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: operation not permitted`), { code })
}

function failingThen<T>(failures: string[], result: T) {
  const queue = [...failures]
  let calls = 0
  const operation = async () => {
    calls += 1
    const code = queue.shift()
    if (code) throw errorWithCode(code)
    return result
  }
  return { operation, calls: () => calls }
}

function withTempDirsPointingAt<T>(missingDir: string, run: () => Promise<T>): Promise<T> {
  const names = ['TMPDIR', 'TMP', 'TEMP'] as const
  const previous = names.map((name) => process.env[name])
  for (const name of names) process.env[name] = missingDir
  return run().finally(() => {
    names.forEach((name, index) => {
      const value = previous[index]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    })
  })
}

describe('atomicWrite', () => {
  it.each(VARIANTS)('writes the %s fixture byte for byte', async (variant) => {
    const bytes = readFileSync(path.join(ENDINGS, `edge.${variant}.dc.html`))
    await atomicWrite(target, bytes)
    expect(readFileSync(target).equals(bytes)).toBe(true)
  })

  it('writes bytes that are not valid UTF-8 unchanged over an existing file', async () => {
    writeFileSync(target, 'previous content\n')
    await atomicWrite(target, NOT_UTF8)
    expect(readFileSync(target).equals(NOT_UTF8)).toBe(true)
  })

  it('replaces the file by rename, so another link to the old file keeps the old bytes', async () => {
    const alias = path.join(dir, 'alias.dc.html')
    writeFileSync(target, 'old bytes\n')
    linkSync(target, alias)
    await atomicWrite(target, Buffer.from('new bytes\n'))
    expect(readFileSync(target, 'utf8')).toBe('new bytes\n')
    expect(readFileSync(alias, 'utf8')).toBe('old bytes\n')
  })

  it("keeps its temporary file in the target's directory and leaves none behind", async () => {
    const missingTmp = path.join(dir, 'no-such-tmp-dir')
    await withTempDirsPointingAt(missingTmp, () => atomicWrite(target, Buffer.from('x')))
    expect(readdirSync(dir)).toEqual(['board.dc.html'])
  })

  it.skipIf(ON_WINDOWS)('retries while the directory refuses writes, then succeeds', async () => {
    writeFileSync(target, 'old\n')
    chmodSync(dir, 0o555)
    setTimeout(() => chmodSync(dir, 0o755), 400)
    await atomicWrite(target, Buffer.from('new\n'))
    expect(readFileSync(target, 'utf8')).toBe('new\n')
  })

  it.skipIf(ON_WINDOWS)(
    'gives up after about 3 s with a file-locked error and leaves the old bytes',
    async () => {
      writeFileSync(target, 'old\n')
      chmodSync(dir, 0o555)
      const startedAt = Date.now()
      await expect(atomicWrite(target, Buffer.from('new\n'))).rejects.toThrow(LOCKED_MESSAGE)
      const elapsed = Date.now() - startedAt
      expect(elapsed).toBeGreaterThanOrEqual(2_000)
      expect(elapsed).toBeLessThan(6_000)
      chmodSync(dir, 0o755)
      expect(readFileSync(target, 'utf8')).toBe('old\n')
    },
    10_000,
  )
})

describe('retryWhileLocked', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])('backs off on %s and returns once the operation succeeds', async (code) => {
    const { operation, calls } = failingThen([code, code], 'renamed')
    await expect(retryWhileLocked(operation)).resolves.toBe('renamed')
    expect(calls()).toBe(3)
  })

  it('does not retry an error that is not a lock', async () => {
    const { operation, calls } = failingThen(['ENOENT'], 'renamed')
    await expect(retryWhileLocked(operation)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(calls()).toBe(1)
  })

  it(
    'backs off for about 3 s, then reports the file as locked by another program',
    async () => {
      const { operation, calls } = failingThen(Array<string>(10_000).fill('EBUSY'), 'renamed')
      const startedAt = Date.now()
      await expect(retryWhileLocked(operation)).rejects.toThrow(LOCKED_MESSAGE)
      const elapsed = Date.now() - startedAt
      expect(elapsed).toBeGreaterThanOrEqual(2_000)
      expect(elapsed).toBeLessThan(6_000)
      expect(calls()).toBeGreaterThan(3)
      expect(calls()).toBeLessThan(200)
    },
    10_000,
  )

  it('waits between attempts instead of spinning', async () => {
    const { operation } = failingThen(['EPERM', 'EPERM', 'EPERM'], 'renamed')
    const startedAt = Date.now()
    await retryWhileLocked(operation)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15)
  })
})
