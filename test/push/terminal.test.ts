import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openTerminal, posixLauncher, windowsLauncher } from '../../src/push/terminal'

const isWindows = process.platform === 'win32'
let project: string
let dir: string

beforeEach(() => {
  project = path.join(mkdtempSync(path.join(tmpdir(), 'ed terminal ')), "Café o'board & ü")
  dir = path.join(project, '.editor', 'push')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'settings.json'), '{}')
  vi.stubEnv('DESIGN_EDITOR_TERMINAL', 'none')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(path.dirname(project), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** A command that writes the folder, arguments and environment it was run with. */
function recorder(): string {
  const script = path.join(project, 'record.mjs')
  writeFileSync(script, "import { writeFileSync } from 'node:fs'\nwriteFileSync('seen.json', JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), key: process.env.ANTHROPIC_API_KEY ?? null, proxy: process.env.NO_PROXY }))\n")
  const command = path.join(project, isWindows ? 'claude.cmd' : 'claude')
  writeFileSync(command, isWindows ? `@"${process.execPath}" "%~dp0record.mjs" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/record.mjs" "$@"\n`)
  chmodSync(command, 0o755)
  return command
}

const seen = () => JSON.parse(readFileSync(path.join(project, 'seen.json'), 'utf8')) as { cwd: string; args: string[]; key: string | null; proxy: string }

describe('openTerminal', () => {
  it('runs Claude in the project folder with its arguments whole, and reports the end', async () => {
    const window = await openTerminal({ dir, command: recorder(), args: ['--tools', 'Artifact,Read', '--setting-sources', '', 'Two words. And: a/b-c'] })
    await new Promise<void>((resolve) => window.onClosed(resolve))

    expect(seen().args).toEqual(['--tools', 'Artifact,Read', '--setting-sources', '', 'Two words. And: a/b-c'])
    expect(seen().cwd.normalize()).toContain("Café o'board & ü")
    expect(seen().proxy).toContain('127.0.0.1')
  })

  it('closes a Claude that is still running', async () => {
    const script = path.join(project, 'stay.mjs')
    writeFileSync(script, 'setInterval(() => {}, 1000)')
    const command = path.join(project, isWindows ? 'claude.cmd' : 'claude')
    writeFileSync(command, isWindows ? `@"${process.execPath}" "%~dp0stay.mjs"\r\n` : `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/stay.mjs"\n`)
    chmodSync(command, 0o755)
    const window = await openTerminal({ dir, command, args: [] })

    window.close()

    await new Promise<void>((resolve) => window.onClosed(resolve))
  })

  it('says it cannot where no terminal is known', async () => {
    vi.stubEnv('DESIGN_EDITOR_TERMINAL', '')

    await expect(openTerminal({ dir, command: '/x/claude', args: [] }, 'linux')).rejects.toThrow(/macOS and Windows/)
  })
})

describe.skipIf(isWindows)('the macOS launcher', () => {
  it('drops API keys the user’s shell exports, and runs nothing for a push that was already cancelled', () => {
    const launcher = path.join(dir, 'push.command')
    writeFileSync(launcher, posixLauncher(recorder(), ["it's"]))
    execFileSync('/bin/sh', [launcher], { env: { ...process.env, ANTHROPIC_API_KEY: 'key' } })
    expect(seen()).toMatchObject({ key: null, args: ["it's"] })

    rmSync(path.join(project, 'seen.json'))
    rmSync(path.join(dir, 'settings.json'))
    execFileSync('/bin/sh', [launcher])

    expect(() => seen()).toThrow()
  })

  it('leaves the pid Claude runs under, so closing the window can be noticed', () => {
    const launcher = path.join(dir, 'push.command')
    writeFileSync(launcher, posixLauncher(recorder(), []))
    execFileSync('/bin/sh', [launcher])

    expect(Number(readFileSync(path.join(dir, 'pid'), 'utf8'))).toBeGreaterThan(1)
  })
})

describe('the Windows launcher', () => {
  it('quotes every argument, doubles percent signs and clears API keys', () => {
    const text = windowsLauncher('C:\\Users\\Rön 100%\\claude.exe', ['--setting-sources', '', 'two words'])

    expect(text).toContain('call "C:\\Users\\Rön 100%%\\claude.exe" "--setting-sources" "" "two words"')
    expect(text).toContain('set "ANTHROPIC_API_KEY="')
    expect(text).toContain('cd /d "%~dp0..\\.."')
    expect(text.split('\r\n').length).toBeGreaterThan(5)
  })
})
