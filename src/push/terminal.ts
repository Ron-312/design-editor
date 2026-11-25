import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { claudeEnv, CREDENTIAL_VARIABLES } from './claude'
import { PushError } from './errors'

/** `none` runs the launcher without a window; only the tests set it. */
export const TERMINAL_OVERRIDE = 'DESIGN_EDITOR_TERMINAL'

export interface TerminalWindow {
  onClosed(listener: () => void): void
  close(): void
}

const PID_FILE = 'pid'
const POLL_MS = 500
/** `open` returns before Terminal has run anything, so the launcher's pid takes a moment to appear. */
const START_LIMIT_MS = 30_000

function posixQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** `exec` keeps the launcher's pid, so ending that process ends Claude. */
export function posixLauncher(command: string, args: readonly string[]): string {
  return [
    '#!/bin/sh',
    'cd "$(dirname "$0")/../.." || exit 1',
    '[ -f .editor/push/settings.json ] || exit 0',
    `unset ${CREDENTIAL_VARIABLES.join(' ')}`,
    'export NO_PROXY="${NO_PROXY:+$NO_PROXY,}127.0.0.1"',
    `echo $$ > .editor/push/${PID_FILE}`,
    `exec ${[command, ...args].map(posixQuote).join(' ')}`,
    '',
  ].join('\n')
}

function windowsQuote(text: string): string {
  return `"${text.replace(/%/g, '%%').replace(/"/g, '""')}"`
}

export function windowsLauncher(command: string, args: readonly string[]): string {
  return [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0..\\.."',
    'if not exist .editor\\push\\settings.json exit /b 0',
    ...CREDENTIAL_VARIABLES.map((name) => `set "${name}="`),
    'set "NO_PROXY=%NO_PROXY%,127.0.0.1"',
    `call ${[command, ...args].map(windowsQuote).join(' ')}`,
    '',
  ].join('\r\n')
}

/** The window is another program's child: its launcher's pid says whether Claude is still there. */
class WatchedWindow implements TerminalWindow {
  private readonly listeners: (() => void)[] = []
  private readonly poll: ReturnType<typeof setInterval>
  private readonly openedAt = Date.now()
  private pid: number | null = null
  private closing = false

  constructor(private readonly pidFile: string) {
    this.poll = setInterval(() => void this.check(), POLL_MS)
  }

  onClosed(listener: () => void): void {
    this.listeners.push(listener)
  }

  close(): void {
    this.closing = true
    void this.check()
  }

  private async check(): Promise<void> {
    this.pid ??= await readPid(this.pidFile)
    if (this.pid === null) {
      if (this.closing || Date.now() - this.openedAt > START_LIMIT_MS) this.ended()
      return
    }
    if (this.closing) signal(this.pid, 'SIGTERM')
    if (!signal(this.pid, 0)) this.ended()
  }

  private ended(): void {
    clearInterval(this.poll)
    for (const listener of this.listeners.splice(0)) listener()
  }
}

async function readPid(file: string): Promise<number | null> {
  try {
    const pid = Number((await readFile(file, 'utf8')).trim())
    return Number.isInteger(pid) && pid > 1 ? pid : null
  } catch {
    return null
  }
}

function signal(pid: number, name: NodeJS.Signals | 0): boolean {
  try {
    return process.kill(pid, name)
  } catch {
    return false
  }
}

/** The window lives as long as this child does. */
class ChildWindow implements TerminalWindow {
  private isClosed = false
  private readonly listeners: (() => void)[] = []
  /** On Windows the window's own process can outlive `cmd`; the end waits for `taskkill` to finish. */
  private killed: Promise<void> = Promise.resolve()

  constructor(
    private readonly child: ChildProcess,
    private readonly platform: NodeJS.Platform,
  ) {
    const closed = () => {
      if (this.isClosed) return
      this.isClosed = true
      void this.killed.then(() => {
        for (const listener of this.listeners.splice(0)) listener()
      })
    }
    child.once('error', closed)
    child.once('close', closed)
  }

  onClosed(listener: () => void): void {
    if (this.isClosed) void this.killed.then(listener)
    else this.listeners.push(listener)
  }

  close(): void {
    if (this.isClosed || this.child.pid === undefined) return
    if (this.platform !== 'win32') {
      this.child.kill()
      return
    }
    // `/T` because the window's own process is a grandchild.
    const taskkill = spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    this.killed = new Promise((resolve) => {
      taskkill.once('error', () => resolve())
      taskkill.once('close', () => resolve())
    })
  }
}

const SYSTEM_TERMINAL_PROBLEM = 'Push can open a terminal window only on macOS and Windows.'

/** Writes the launcher into `dir`, two folders below the project, and opens it in a terminal window. */
export async function openTerminal(options: { dir: string; command: string; args: readonly string[] }, platform = process.platform): Promise<TerminalWindow> {
  const { dir, command, args } = options
  const isWindows = platform === 'win32'
  const launcher = path.join(dir, isWindows ? 'push.cmd' : 'push.command')
  await writeFile(launcher, isWindows ? windowsLauncher(command, args) : posixLauncher(command, args))
  await chmod(launcher, 0o700)
  if (process.env[TERMINAL_OVERRIDE] === 'none') return openHidden(launcher, isWindows, platform)
  if (isWindows) return new ChildWindow(spawn('cmd.exe', ['/d', '/c', 'start', '"Design Editor push"', '/wait', 'cmd.exe', '/d', '/c', 'push.cmd'], { cwd: dir, env: claudeEnv(), windowsVerbatimArguments: true, windowsHide: true, stdio: 'ignore' }), platform)
  if (platform !== 'darwin') throw new PushError('error', SYSTEM_TERMINAL_PROBLEM)
  const opener = spawn('open', [launcher], { env: claudeEnv(), stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => {
    opener.once('error', reject)
    opener.once('close', (code) => (code === 0 ? resolve() : reject(new PushError('error', 'The terminal window could not be opened.'))))
  })
  return new WatchedWindow(path.join(dir, PID_FILE))
}

function openHidden(launcher: string, isWindows: boolean, platform: NodeJS.Platform): TerminalWindow {
  const options = { cwd: path.dirname(launcher), env: claudeEnv(), windowsHide: true, stdio: 'ignore' as const }
  const child = isWindows ? spawn('cmd.exe', ['/d', '/c', path.basename(launcher)], options) : spawn(launcher, [], options)
  return new ChildWindow(child, platform)
}
