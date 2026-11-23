import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { copyDir } from '../copy-dir'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { gitOutput } from '../../src/core/git'
import { diffAgainstSynced, loadTokens, readEditorState, writeEditorState } from '../../src/server/editor-services'
import type { EditorState } from '../../src/shared/protocol'
import type { EdId, ProjectPath } from '../../src/shared/types'

const CANVAS = fileURLToPath(new URL('../fixtures/canvas/', import.meta.url))
const HOME = 'project/home.dc.html' as ProjectPath
const CARD = 'project/card.dc.html' as ProjectPath
const HOME_TEXT = readFileSync(path.join(CANVAS, 'project', 'home.dc.html'), 'utf8')
const ROOT_VARIABLES = '    <style>\n      :root { --brand: #0f766e; --gap-lg: 24px; }\n    </style>\n'
const EMPTY_STATE: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

const parents: string[] = []

afterEach(() => {
  for (const parent of parents.splice(0)) rmSync(parent, { recursive: true, force: true })
})

function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from)
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`"${from}" must occur exactly once`)
  return text.slice(0, at) + to + text.slice(at + from.length)
}

function makeProject(): string {
  const parent = mkdtempSync(path.join(tmpdir(), 'ed services '))
  parents.push(parent)
  const root = path.join(parent, 'Café board ü')
  copyDir(path.join(CANVAS, 'project'), path.join(root, 'project'))
  return root
}

async function committed(root: string): Promise<string> {
  const git = (...args: string[]) => gitOutput(args, { cwd: root })
  await git('init', '-q')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'Test')
  await git('config', 'core.autocrlf', 'false')
  await git('config', 'commit.gpgsign', 'false')
  mkdirSync(path.join(root, '.git', 'info'), { recursive: true })
  writeFileSync(path.join(root, '.git', 'info', 'exclude'), '.editor/\n')
  await git('add', '-A')
  await git('commit', '-q', '-m', 'Pulled test from Claude Design')
  return root
}

function nativeOf(root: string, file: ProjectPath): string {
  return path.join(root, ...file.split('/'))
}

function withRootVariables(root: string): void {
  writeFileSync(nativeOf(root, HOME), replaceOnce(HOME_TEXT, '    <style>\n', `${ROOT_VARIABLES}    <style>\n`))
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(entry.parentPath, entry.name)
    return entry.isDirectory() ? filesUnder(full) : [full]
  })
}

function snapshotOf(dir: string): Map<string, string> {
  return new Map(filesUnder(dir).map((file) => [file, readFileSync(file).toString('base64')]))
}

describe('loadTokens', () => {
  it('reads the design-system tokens from project/ds/*/tokens.json', async () => {
    const root = makeProject()

    const tokens = await loadTokens(root)

    expect(tokens).toHaveLength(9)
    expect(tokens).toContainEqual({ name: expect.stringContaining('accent'), value: '#c2410c', source: 'tokens.json' })
    expect(tokens).toContainEqual({ name: expect.stringContaining('card'), value: '12px', source: 'tokens.json' })
    expect(tokens.every((token) => token.source === 'tokens.json')).toBe(true)
  })

  it('ignores :root variables while a tokens.json exists', async () => {
    const root = makeProject()
    withRootVariables(root)

    const tokens = await loadTokens(root)

    expect(tokens.some((token) => token.name === '--brand')).toBe(false)
  })

  it('falls back to the canvas’s :root --* variables when there is no tokens.json', async () => {
    const root = makeProject()
    rmSync(path.join(root, 'project', 'ds'), { recursive: true })
    withRootVariables(root)

    const tokens = await loadTokens(root)

    expect(tokens).toEqual([
      { name: '--brand', value: '#0f766e', source: ':root' },
      { name: '--gap-lg', value: '24px', source: ':root' },
    ])
  })

  it('offers no tokens when the canvas has neither, so the picker is hidden', async () => {
    const root = makeProject()
    rmSync(path.join(root, 'project', 'ds'), { recursive: true })

    expect(await loadTokens(root)).toEqual([])
  })
})

describe('.editor/state.json', () => {
  const state: EditorState = {
    hidden: ['e4' as EdId],
    locked: ['e7' as EdId],
    collapsed: ['e2' as EdId, 'e9' as EdId],
    boards: { [HOME]: { zoom: 2, panX: -120, panY: 48, selection: ['e4' as EdId] } },
  }

  it('reads as empty before anything is saved', async () => {
    expect(await readEditorState(makeProject())).toEqual(EMPTY_STATE)
  })

  it('persists hide, lock, layer collapse and zoom across a read', async () => {
    const root = makeProject()

    await writeEditorState(root, state)

    expect(await readEditorState(root)).toEqual(state)
    expect(JSON.parse(readFileSync(path.join(root, '.editor', 'state.json'), 'utf8'))).toEqual(state)
  })

  it('never touches the source files', async () => {
    const root = await committed(makeProject())
    const before = snapshotOf(path.join(root, 'project'))

    await writeEditorState(root, state)

    expect(snapshotOf(path.join(root, 'project'))).toEqual(before)
    expect(await gitOutput(['status', '--porcelain'], { cwd: root })).toBe('')
  })
})

describe('diffAgainstSynced', () => {
  it('is empty for a file that matches the synced commit', async () => {
    const root = await committed(makeProject())

    expect(await diffAgainstSynced(root, HOME)).toBe('')
  })

  it('shows the lines a file changed since the synced commit, and only that file', async () => {
    const root = await committed(makeProject())
    writeFileSync(nativeOf(root, HOME), replaceOnce(HOME_TEXT, 'font-size: 48px', 'font-size: 56px'))
    const before = readFileSync(nativeOf(root, HOME))

    const diff = await diffAgainstSynced(root, HOME)

    expect(diff).toMatch(/^-\s*<h1 style="margin: 0; font-size: 48px">Studio Weekly<\/h1>$/m)
    expect(diff).toMatch(/^\+\s*<h1 style="margin: 0; font-size: 56px">Studio Weekly<\/h1>$/m)
    expect(diff.split('\n').filter((line) => /^[-+](?![-+])/.test(line))).toHaveLength(2)
    expect(await diffAgainstSynced(root, CARD)).toBe('')
    expect(readFileSync(nativeOf(root, HOME)).equals(before)).toBe(true)
  })

  it('compares against git HEAD, the synced commit, not the first pull', async () => {
    const root = await committed(makeProject())
    writeFileSync(nativeOf(root, HOME), replaceOnce(HOME_TEXT, 'font-size: 48px', 'font-size: 56px'))
    await gitOutput(['commit', '-q', '-am', 'Synced with Claude Design'], { cwd: root })

    expect(await diffAgainstSynced(root, HOME)).toBe('')
  })
})
