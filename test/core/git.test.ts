import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertSupportedGit, ensureSupportedGit, runGit } from '../../src/core/git'

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'git-runner-'))
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function withEnv<T>(name: string, value: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env[name]
  process.env[name] = value
  return run().finally(() => {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  })
}

describe('runGit', () => {
  it('passes every argument to git literally, with no shell in between', async () => {
    const hostile = `$(echo injected) & echo "x" | 'y' %PATH% *;`
    const result = await runGit(['-c', `user.name=${hostile}`, 'config', 'user.name'], { cwd: workDir })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(`${hostile}\n`)
  })

  it('runs git with GIT_TERMINAL_PROMPT=0 whatever the caller environment says', async () => {
    const result = await withEnv('GIT_TERMINAL_PROMPT', '1', () =>
      runGit(['-c', 'alias.prompt-env=!echo "$GIT_TERMINAL_PROMPT"', 'prompt-env'], { cwd: workDir }),
    )
    expect(result.stdout.trim()).toBe('0')
  })

  it('reports a failing git call through its exit code and stderr', async () => {
    const result = await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: workDir })
    expect(result.exitCode).toBeGreaterThan(0)
    expect(result.stderr).not.toBe('')
  })
})

describe('assertSupportedGit', () => {
  it.each([
    'git version 2.44.0',
    'git version 2.54.0 (Apple Git-157)',
    'git version 2.47.1.windows.2',
    'git version 2.100.0',
    'git version 3.0.0',
  ])('accepts %s', (versionOutput) => {
    expect(() => assertSupportedGit(versionOutput, 'darwin')).not.toThrow()
  })

  it.each([
    ['git version 2.43.0', '2.43.0'],
    ['git version 2.39.5 (Apple Git-154)', '2.39.5'],
    ['git version 2.5.0', '2.5.0'],
    ['git version 1.99.9', '1.99.9'],
  ])('refuses %s on macOS with the found version and a brew hint', (versionOutput, found) => {
    expect(() => assertSupportedGit(versionOutput, 'darwin')).toThrow(found)
    expect(() => assertSupportedGit(versionOutput, 'darwin')).toThrow(/2\.44/)
    expect(() => assertSupportedGit(versionOutput, 'darwin')).toThrow(/brew install git/)
  })

  it('refuses an old Git on Windows with a Git for Windows hint and no brew hint', () => {
    const refuse = () => assertSupportedGit('git version 2.43.0.windows.1', 'win32')
    expect(refuse).toThrow(/2\.43\.0/)
    expect(refuse).toThrow(/Git for Windows/)
    expect(refuse).not.toThrow(/brew/)
  })
})

describe('ensureSupportedGit', () => {
  it('accepts the Git on this machine', async () => {
    await ensureSupportedGit()
  })

  it.skipIf(process.platform === 'win32')('refuses an old git found on PATH', async () => {
    const fakeGit = path.join(workDir, 'git')
    writeFileSync(fakeGit, '#!/bin/sh\necho "git version 2.40.1"\n')
    chmodSync(fakeGit, 0o755)
    const pathWithFakeGit = `${workDir}${path.delimiter}${process.env.PATH ?? ''}`
    await expect(withEnv('PATH', pathWithFakeGit, () => ensureSupportedGit())).rejects.toThrow(/2\.40\.1/)
  })
})
