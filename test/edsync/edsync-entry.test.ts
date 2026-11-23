import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { register } from 'tsx/esm/api'
import { EDSYNC_VERBS } from '../../src/shared/sync'

vi.mock('tsx/esm/api', () => ({ register: vi.fn() }))

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const EDSYNC_MJS = path.join(REPO, 'tools', 'edsync.mjs')
const SPAWN_MS = 60_000

interface Captured {
  readonly events: string[]
  readonly stdout: string[]
  readonly stderr: string[]
  readonly exitCode: number | undefined
}

let dir = ''
const savedArgv = process.argv

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'edsync entry é '))
})

afterEach(() => {
  process.argv = savedArgv
  vi.restoreAllMocks()
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

function captureStream(stream: NodeJS.WriteStream, name: string, events: string[], into: string[]) {
  vi.spyOn(stream, 'write').mockImplementation(((chunk: string, done?: () => void) => {
    events.push(name)
    into.push(chunk)
    setImmediate(() => done?.())
    return true
  }) as typeof stream.write)
}

/** Runs tools/edsync.mjs in this process with the given verb and flags. */
async function runEntry(...argv: string[]): Promise<Captured> {
  const events: string[] = []
  const stdout: string[] = []
  const stderr: string[] = []
  let exitCode: number | undefined
  captureStream(process.stdout, 'stdout', events, stdout)
  captureStream(process.stderr, 'stderr', events, stderr)
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    events.push('exit')
    exitCode = code
  }) as typeof process.exit)
  process.argv = [process.execPath, EDSYNC_MJS, ...argv]
  const entry: string = EDSYNC_MJS
  await import(/* @vite-ignore */ entry)
  return { events, stdout, stderr, exitCode }
}

describe('tools/edsync.mjs in process', () => {
  it('registers tsx, then writes the verb’s output to stdout and exits with its code once written', async () => {
    const file = path.join(dir, 'whole.dc.html')
    writeFileSync(file, '<x-dc>\n<p>hi</p>\n</x-dc>\n')

    const run = await runEntry('check', '--file', file)

    expect(register).toHaveBeenCalledTimes(1)
    expect(JSON.parse(run.stdout.join(''))).toEqual({ file, intact: true })
    expect(run.stderr).toEqual([])
    expect(run.events).toEqual(['stdout', 'exit'])
    expect(run.exitCode).toBe(0)
  })

  it('writes an unknown verb’s message to stderr only and exits 1 after it', async () => {
    const run = await runEntry('publish')

    expect(run.stdout).toEqual([])
    expect(run.stderr.join('')).toBe(`Unknown verb "publish"; expected one of ${EDSYNC_VERBS.join(', ')}.\n`)
    expect(run.events).toEqual(['stderr', 'exit'])
    expect(run.exitCode).toBe(1)
  })
})

describe('tools/edsync.mjs as a process', () => {
  function spawnEdsync(...argv: string[]) {
    return spawnSync(process.execPath, [EDSYNC_MJS, ...argv], { cwd: dir, encoding: 'utf8', timeout: SPAWN_MS, windowsHide: true })
  }

  it.each([
    ['an unknown verb', ['publish'], 'Unknown verb "publish"'],
    ['no verb', [], 'Unknown verb ""'],
  ])('exits 1 for %s, naming the verbs it knows on stderr and printing nothing to stdout', (_label, argv, message) => {
    const result = spawnEdsync(...argv)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(message)
    expect(result.stderr).toContain(EDSYNC_VERBS.join(', '))
  }, SPAWN_MS)

  it('exits 2 with the report on stdout for a file whose blocks are not closed', () => {
    writeFileSync(path.join(dir, 'broken.dc.html'), '<x-dc>\n<p>hi</p>\n')

    const result = spawnEdsync('check', '--file', 'broken.dc.html')

    expect(result.status, result.stderr).toBe(2)
    expect(JSON.parse(result.stdout)).toEqual({ file: 'broken.dc.html', intact: false })
  }, SPAWN_MS)

  it('exits 1 with the parse error for a flag it does not know', () => {
    const result = spawnEdsync('check', '--nope', 'x')

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/--nope/)
  }, SPAWN_MS)
})
