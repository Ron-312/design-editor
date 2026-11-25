import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeArgs, claudeEnv, findClaude } from '../../src/push/claude'

const HOME = path.join(path.sep, 'home', 'ron')
const only = (...files: string[]) => (file: string) => files.includes(file)

describe('findClaude', () => {
  it('takes the override before anything else', () => {
    expect(findClaude({ DESIGN_EDITOR_CLAUDE: '/x/claude', PATH: '/bin' }, 'linux', HOME, () => true)).toBe('/x/claude')
  })

  it('finds it on the PATH', () => {
    const file = path.join('/opt/tools', 'claude')

    expect(findClaude({ PATH: ['/bin', '/opt/tools'].join(path.delimiter) }, 'darwin', HOME, only(file))).toBe(file)
  })

  it('looks in the home install when an app from the Dock has a bare PATH', () => {
    const file = path.join(HOME, '.local', 'bin', 'claude')

    expect(findClaude({ PATH: '/usr/bin' }, 'darwin', HOME, only(file))).toBe(file)
  })

  it.each([
    ['the native install', path.join(HOME, '.local', 'bin', 'claude.exe')],
    ['the npm install', path.join('C:\\Roaming', 'npm', 'claude.cmd')],
  ])('finds %s on Windows', (_label, file) => {
    expect(findClaude({ Path: 'C:\\Windows', APPDATA: 'C:\\Roaming' }, 'win32', HOME, only(file))).toBe(file)
  })

  it('is null when it is nowhere', () => {
    expect(findClaude({ PATH: '/bin' }, 'darwin', HOME, () => false)).toBeNull()
  })
})

describe('claudeEnv', () => {
  it('drops API keys and the marks of an outer Claude session, and keeps the rest', () => {
    const env = claudeEnv({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'http://localhost:1', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', PATH: '/bin', HOME: '/h' })

    expect(env).toEqual({ PATH: '/bin', HOME: '/h', NO_PROXY: '127.0.0.1' })
  })

  it('never sends the guard through a proxy, keeping the user’s own exceptions', () => {
    expect(claudeEnv({ NO_PROXY: 'corp.example' }).NO_PROXY).toBe('corp.example,127.0.0.1')
  })
})

describe('claudeArgs', () => {
  const args = claudeArgs('/x/settings.json')
  const valueOf = (flag: string) => args[args.indexOf(flag) + 1]

  it('gives Claude only the Artifact tool, denies whatever the hook does not allow, and loads no user settings', () => {
    expect(valueOf('--tools')).toBe('Artifact')
    expect(valueOf('--permission-mode')).toBe('dontAsk')
    expect(valueOf('--setting-sources')).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(args).not.toContain('--allowedTools')
    expect(args).not.toContain('--dangerously-skip-permissions')
  })
})
