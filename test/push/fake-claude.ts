import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAUDE_OVERRIDE } from '../../src/push/claude'
import { TERMINAL_OVERRIDE } from '../../src/push/terminal'

const SCRIPT = fileURLToPath(new URL('./fake-claude-cli.mjs', import.meta.url))

export interface FakeBehaviour {
  readonly signedOut?: boolean
  readonly partialRead?: boolean
  readonly refusePublish?: boolean
  readonly dropPublish?: boolean
  readonly crash?: boolean
  readonly hang?: boolean
  readonly talkOnly?: boolean
  readonly twice?: boolean
  /** Changed inputs tried before the one that was asked for. */
  readonly strays?: readonly Record<string, unknown>[]
}

/** A `claude` executable whose Claude Design is `<home>/remote`. */
export class FakeClaude {
  readonly command: string
  readonly remote: string

  constructor(readonly home: string) {
    this.remote = path.join(home, 'remote')
    mkdirSync(this.remote, { recursive: true })
    const isWindows = process.platform === 'win32'
    this.command = path.join(home, isWindows ? 'claude.cmd' : 'claude')
    const run = `"${process.execPath}" "${SCRIPT}"`
    writeFileSync(this.command, isWindows ? `@${run} %*\r\n` : `#!/bin/sh\nexec ${run} "$@"\n`)
    chmodSync(this.command, 0o755)
  }

  get env(): Record<string, string> {
    return { [CLAUDE_OVERRIDE]: this.command, [TERMINAL_OVERRIDE]: 'none', FAKE_CLAUDE_HOME: this.home }
  }

  behave(behaviour: FakeBehaviour): void {
    writeFileSync(path.join(this.home, 'behaviour.json'), JSON.stringify(behaviour))
  }

  calls(): { action: string; allowed: boolean }[] {
    return this.lines('calls.log') as { action: string; allowed: boolean }[]
  }

  reads(): { file: string; allowed: boolean }[] {
    return this.lines('reads.log') as { file: string; allowed: boolean }[]
  }

  publishes(): Record<string, unknown>[] {
    return this.lines('publishes.log') as Record<string, unknown>[]
  }

  started(): { args: string[]; cwd: string; env: string[] } {
    return JSON.parse(readFileSync(path.join(this.home, 'args.json'), 'utf8'))
  }

  wasStarted(): boolean {
    return existsSync(path.join(this.home, 'args.json'))
  }

  private lines(name: string): unknown[] {
    const file = path.join(this.home, name)
    return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []
  }
}
