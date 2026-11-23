import { execFile, type ExecFileException } from 'node:child_process'
import { MIN_GIT_VERSION } from '../shared/sync'

export interface GitResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024

/** No shell, so every argument reaches git literally (R11 #18); git never waits on a credential prompt. */
export function runGit(args: readonly string[], options: { cwd: string }): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: options.cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error: ExecFileException | null, stdout, stderr) => {
        if (error && typeof error.code !== 'number') reject(error)
        else resolve({ exitCode: error ? Number(error.code) : 0, stdout, stderr })
      },
    )
  })
}

/** Runs git and returns its stdout, or throws with its stderr when it exits non-zero. */
export async function gitOutput(args: readonly string[], options: { cwd: string }): Promise<string> {
  const result = await runGit(args, options)
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed (${result.exitCode}): ${result.stderr.trim()}`)
  return result.stdout
}

const VERSION_PATTERN = /git version (\d+)\.(\d+)(?:\.(\d+))?/

function upgradeHint(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'Upgrade with `brew install git`.'
  if (platform === 'win32') return 'Install the latest Git for Windows from https://gitforwindows.org.'
  return 'Install a newer Git from your package manager.'
}

function isAtLeastMinimum(major: number, minor: number): boolean {
  const [minMajor, minMinor] = MIN_GIT_VERSION
  return major > minMajor || (major === minMajor && minor >= minMinor)
}

export function assertSupportedGit(versionOutput: string, platform: NodeJS.Platform): void {
  const match = VERSION_PATTERN.exec(versionOutput)
  if (!match) throw new Error(`Could not read the Git version from "${versionOutput.trim()}". ${upgradeHint(platform)}`)
  const [found, major, minor] = [match[0].slice('git version '.length), Number(match[1]), Number(match[2])]
  if (isAtLeastMinimum(major, minor)) return
  throw new Error(
    `Git ${found} is too old: ${MIN_GIT_VERSION.join('.')} or newer is required for git merge-file --diff-algorithm. ${upgradeHint(platform)}`,
  )
}

export async function ensureSupportedGit(): Promise<void> {
  const result = await runGit(['--version'], { cwd: process.cwd() })
  assertSupportedGit(result.stdout, process.platform)
}
