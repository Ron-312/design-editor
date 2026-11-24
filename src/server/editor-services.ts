import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from '../core/atomic-write'
import { gitOutput } from '../core/git'
import { toNativePath } from '../shared/paths'
import { EDITOR_FILES, type DesignToken } from '../shared/protocol'
import { CANVAS_JSON } from '../shared/sync'
import type { Board, CanvasLayout, ProjectPath } from '../shared/types'
import { EMPTY_STORED_STATE, type StoredEditorState } from './editor-state'
import { readSource } from './source/bytes'
import { SourceIndex } from './source/source-index'

interface CanvasJson {
  readonly boards: Readonly<Record<string, { readonly w: number; readonly h: number; readonly expand?: string }>>
  readonly order: readonly string[]
  readonly pages: readonly string[]
}

const PROJECT_FOLDER = 'project'
const DESIGN_SYSTEMS_FOLDER = 'ds'
const TOKENS_FILE = 'tokens.json'
const DOCUMENT_SUFFIX = '.dc.html'
const ROOT_SELECTOR = ':root'

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

async function entriesOf(dir: string): Promise<{ name: string; isDirectory(): boolean }[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

function projectPathOf(name: string): ProjectPath {
  return `${PROJECT_FOLDER}/${name}` as ProjectPath
}

export async function readCanvasLayout(root: string): Promise<CanvasLayout> {
  const canvas = JSON.parse(await readFile(toNativePath(root, CANVAS_JSON), 'utf8')) as CanvasJson
  const boards: Board[] = Object.entries(canvas.boards).map(([name, { w, h, expand }]) => ({
    path: projectPathOf(name),
    w,
    h,
    page: canvas.pages.includes(name),
    fill: expand === 'fill',
  }))
  return { boards, order: canvas.order.map(projectPathOf), pages: canvas.pages.map(projectPathOf) }
}

/** Leaves of a tokens.json tree are `{ "value": ... }` objects, named by their dotted path. */
function flattenTokens(tree: unknown, prefix: string[] = []): DesignToken[] {
  if (!tree || typeof tree !== 'object') return []
  const { value } = tree as { value?: unknown }
  if (typeof value === 'string' || typeof value === 'number') return [{ name: prefix.join('.'), value: String(value), source: 'tokens.json' }]
  return Object.entries(tree).flatMap(([key, child]) => flattenTokens(child, [...prefix, key]))
}

async function designSystemTokens(projectDir: string): Promise<DesignToken[]> {
  const systems = (await entriesOf(path.join(projectDir, DESIGN_SYSTEMS_FOLDER))).filter((entry) => entry.isDirectory())
  const files = await Promise.all(systems.map((system) => readIfPresent(path.join(projectDir, DESIGN_SYSTEMS_FOLDER, system.name, TOKENS_FILE))))
  return files.flatMap((text) => (text === null ? [] : flattenTokens(JSON.parse(text))))
}

async function rootVariables(projectDir: string): Promise<DesignToken[]> {
  const index = new SourceIndex()
  const documents = (await entriesOf(projectDir)).filter((entry) => !entry.isDirectory() && entry.name.endsWith(DOCUMENT_SUFFIX))
  const variables = new Map<string, DesignToken>()
  for (const document of documents) {
    const indexed = index.indexFile(projectPathOf(document.name), await readSource(path.join(projectDir, document.name)))
    for (let order = 0, rule = indexed.findRule(ROOT_SELECTOR, 0); rule; rule = indexed.findRule(ROOT_SELECTOR, ++order)) {
      for (const { prop, value } of rule.declarations) {
        if (prop.startsWith('--') && !variables.has(prop)) variables.set(prop, { name: prop, value, source: ':root' })
      }
    }
  }
  return [...variables.values()]
}

/** The design-system tokens, or the canvas's `:root --*` variables when it has none; empty hides the picker. */
export async function loadTokens(root: string): Promise<DesignToken[]> {
  const projectDir = path.join(root, PROJECT_FOLDER)
  const tokens = await designSystemTokens(projectDir)
  return tokens.length > 0 ? tokens : rootVariables(projectDir)
}

function stateFileOf(root: string): string {
  return path.join(root, ...EDITOR_FILES.state.split('/'))
}

/** A state.json that does not parse is editor-only convenience lost, never a reason to refuse to open. */
export async function readEditorState(root: string): Promise<StoredEditorState> {
  const text = await readIfPresent(stateFileOf(root))
  if (text === null) return EMPTY_STORED_STATE
  try {
    return { ...EMPTY_STORED_STATE, ...(JSON.parse(text) as Partial<StoredEditorState>) }
  } catch {
    return EMPTY_STORED_STATE
  }
}

/** Hide, lock, layer collapse and zoom live in `.editor/`, which `.git/info/exclude` keeps out of git. */
export async function writeEditorState(root: string, state: StoredEditorState): Promise<void> {
  const file = stateFileOf(root)
  await mkdir(path.dirname(file), { recursive: true })
  await atomicWrite(file, Buffer.from(`${JSON.stringify(state, null, 2)}\n`))
}

/** The synced commit is git HEAD: every push and refresh advances it. */
export function diffAgainstSynced(root: string, file: ProjectPath): Promise<string> {
  return gitOutput(['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', file], { cwd: root })
}

/** The file as the synced commit holds it, BOM and line endings included. */
export function syncedText(root: string, file: ProjectPath): Promise<string> {
  return gitOutput(['show', `HEAD:${file}`], { cwd: root })
}
