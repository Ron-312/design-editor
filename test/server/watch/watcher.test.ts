import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FSWatcher } from 'chokidar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UndoLog } from '../../../src/server/edit/undo-log'
import { contentHash, Writer } from '../../../src/server/edit/writer'
import { SourceIndex, type IndexedFile } from '../../../src/server/source/source-index'
import { reconcile } from '../../../src/server/watch/reconcile'
import { watchProject } from '../../../src/server/watch/watcher'
import { toNativePath } from '../../../src/shared/paths'
import type { ServerMessage } from '../../../src/shared/protocol'
import type { EdId, EditOp, ProjectPath, SourceRange } from '../../../src/shared/types'

const recorded = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  instances: [] as unknown[],
  added: [] as unknown[],
}))

vi.mock('chokidar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('chokidar')>()
  type Options = ConstructorParameters<typeof actual.FSWatcher>[0]
  type AddArgs = Parameters<InstanceType<typeof actual.FSWatcher>['add']>
  class RecordingWatcher extends actual.FSWatcher {
    constructor(options: Options = {}) {
      super(options)
      recorded.options.push({ ...options })
      recorded.instances.push(this)
    }

    override add(...args: AddArgs) {
      recorded.added.push(args[0])
      return super.add(...args)
    }
  }
  const watch = (paths: AddArgs[0], options: Options = {}) => new RecordingWatcher(options).add(paths)
  return { ...actual, FSWatcher: RecordingWatcher, watch, default: { ...actual.default, FSWatcher: RecordingWatcher, watch } }
})

type ProjectWatcher = Awaited<ReturnType<typeof watchProject>>

const CANVAS = fileURLToPath(new URL('../../fixtures/canvas/project/', import.meta.url))
const HOME_TEXT = readFileSync(path.join(CANVAS, 'home.dc.html'), 'utf8')
const CARD_TEXT = readFileSync(path.join(CANVAS, 'card.dc.html'), 'utf8')

const HOME = 'project/home.dc.html' as ProjectPath
const CARD = 'project/card.dc.html' as ProjectPath
const GLOB_CHARACTERS = /[*?[\]{}!]/
const QUIET_MS = 400

const roots: string[] = []
const watchers: ProjectWatcher[] = []
const pollingBefore = process.env.CHOKIDAR_USEPOLLING

beforeEach(() => {
  recorded.options.length = 0
  recorded.instances.length = 0
  recorded.added.length = 0
  delete process.env.CHOKIDAR_USEPOLLING
})

afterEach(async () => {
  for (const watcher of watchers.splice(0)) await watcher.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (pollingBefore === undefined) delete process.env.CHOKIDAR_USEPOLLING
  else process.env.CHOKIDAR_USEPOLLING = pollingBefore
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from)
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`"${from}" must occur exactly once`)
  return text.slice(0, at) + to + text.slice(at + from.length)
}

/** A pulled project as `/design-pull` leaves it: the git root holds project/, .editor/ and .git/. */
function makeProject(parentFolder?: string): string {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'watcher-'))
  roots.push(parent)
  const root = parentFolder ? path.join(parent, parentFolder, 'board') : path.join(parent, 'board')
  mkdirSync(path.join(root, 'project'), { recursive: true })
  mkdirSync(path.join(root, '.editor'))
  mkdirSync(path.join(root, '.git'))
  writeFileSync(path.join(root, 'project', 'home.dc.html'), HOME_TEXT)
  writeFileSync(path.join(root, 'project', 'card.dc.html'), CARD_TEXT)
  writeFileSync(path.join(root, '.editor', 'state.json'), '{}')
  writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  return root
}

async function startWatching(root: string, knownHash: (file: ProjectPath) => string | undefined = () => undefined) {
  const reports: ProjectPath[] = []
  const warnings: string[] = []
  const watcher = await watchProject({
    root,
    knownHash,
    onOutsideChange: (file) => reports.push(file),
    onWarning: (message) => warnings.push(message),
  })
  watchers.push(watcher)
  return { reports, warnings }
}

function waitForReport(reports: readonly ProjectPath[], file: ProjectPath): Promise<void> {
  return vi.waitFor(() => expect(reports).toContain(file), { timeout: 6_000, interval: 25 })
}

function latestChokidar(): FSWatcher {
  const instance = recorded.instances.at(-1)
  if (!instance) throw new Error('chokidar was never started')
  return instance as FSWatcher
}

function ignoredMatchers(): Array<(file: string) => boolean> {
  expect(recorded.options).not.toHaveLength(0)
  return [recorded.options[0]!.ignored].flat() as Array<(file: string) => boolean>
}

describe('watchProject: chokidar setup', () => {
  it('watches plain existing paths, never globs', async () => {
    const root = makeProject()
    await startWatching(root)
    const added = recorded.added.flat()
    expect(added).not.toHaveLength(0)
    for (const watched of added) {
      expect(typeof watched).toBe('string')
      expect(watched).not.toMatch(GLOB_CHARACTERS)
      expect(existsSync(watched as string)).toBe(true)
    }
  })

  it('passes ignored as functions that skip .editor/ and .git/ but not the project files', async () => {
    const root = makeProject()
    await startWatching(root)
    const matchers = ignoredMatchers()
    expect(matchers).not.toHaveLength(0)
    for (const matcher of matchers) expect(typeof matcher).toBe('function')

    const isIgnored = (file: string) => matchers.some((matcher) => matcher(file))
    expect(isIgnored(path.join(root, '.editor'))).toBe(true)
    expect(isIgnored(path.join(root, '.editor', 'state.json'))).toBe(true)
    expect(isIgnored(path.join(root, '.git', 'HEAD'))).toBe(true)
    expect(isIgnored(root)).toBe(false)
    expect(isIgnored(path.join(root, 'project'))).toBe(false)
    expect(isIgnored(toNativePath(root, HOME))).toBe(false)
  })

  it('turns atomic on', async () => {
    await startWatching(makeProject())
    expect(recorded.options[0]!.atomic).toBeTruthy()
    expect(latestChokidar().options.atomic).toBeTruthy()
  })

  it('leaves polling off when CHOKIDAR_USEPOLLING is not set', async () => {
    await startWatching(makeProject())
    expect(latestChokidar().options.usePolling).toBe(false)
  })

  it('polls when CHOKIDAR_USEPOLLING is set, keeps atomic on, and still reports outside changes', async () => {
    process.env.CHOKIDAR_USEPOLLING = '1'
    const root = makeProject()
    const { reports } = await startWatching(root)
    expect(latestChokidar().options.usePolling).toBe(true)
    expect(latestChokidar().options.atomic).toBeTruthy()

    writeFileSync(toNativePath(root, HOME), replaceOnce(HOME_TEXT, 'Studio Weekly', 'Studio Daily'))
    await waitForReport(reports, HOME)
  })

  it.each(['OneDrive', 'Dropbox'])('warns when the project lives in a %s folder', async (folder) => {
    const { warnings } = await startWatching(makeProject(folder))
    expect(warnings.some((warning) => warning.includes(folder))).toBe(true)
  })

  it('does not warn for a project outside a synced folder', async () => {
    const { warnings } = await startWatching(makeProject())
    expect(warnings).toEqual([])
  })

  it('handles an EPERM error by re-adding the watcher, and keeps reporting outside changes', async () => {
    const root = makeProject()
    const { reports } = await startWatching(root)
    const addsBefore = recorded.added.length
    const eperm = Object.assign(new Error('EPERM: operation not permitted, watch'), { code: 'EPERM' })

    expect(() => latestChokidar().emit('error', eperm)).not.toThrow()
    await vi.waitFor(() => expect(recorded.added.length).toBeGreaterThan(addsBefore), { timeout: 3_000, interval: 25 })

    let round = 0
    await vi.waitFor(
      () => {
        writeFileSync(toNativePath(root, HOME), replaceOnce(HOME_TEXT, 'Studio Weekly', `Studio Weekly ${++round}`))
        expect(reports).toContain(HOME)
      },
      { timeout: 6_000, interval: 200 },
    )
  })
})

describe('watchProject: outside changes and the own-write filter', () => {
  it('reports nothing at startup', async () => {
    const { reports } = await startWatching(makeProject())
    await sleep(QUIET_MS)
    expect(reports).toEqual([])
  })

  it('reports an outside edit to a project file by its project path', async () => {
    const root = makeProject()
    const { reports } = await startWatching(root)
    writeFileSync(toNativePath(root, CARD), replaceOnce(CARD_TEXT, 'Harbor Pavilion', 'Harbour Pavilion'))
    await waitForReport(reports, CARD)
  })

  it('reports an editor that saves by writing a temp file and renaming it over the original', async () => {
    const root = makeProject()
    const { reports } = await startWatching(root)
    const temp = path.join(root, 'project', 'home.dc.html.tmp-save')
    writeFileSync(temp, replaceOnce(HOME_TEXT, 'Studio Weekly', 'Studio Daily'))
    renameSync(temp, toNativePath(root, HOME))
    await waitForReport(reports, HOME)
  })

  it('ignores a change whose content hash is the known hash, however late it arrives', async () => {
    const root = makeProject()
    const ownBytes = Buffer.from(replaceOnce(HOME_TEXT, 'Studio Weekly', 'Studio Daily'))
    const known = new Map<ProjectPath, string>([[HOME, contentHash(ownBytes)]])
    const { reports } = await startWatching(root, (file) => known.get(file))
    await sleep(QUIET_MS)

    writeFileSync(toNativePath(root, HOME), ownBytes)
    await sleep(QUIET_MS)
    writeFileSync(toNativePath(root, CARD), replaceOnce(CARD_TEXT, 'Harbor Pavilion', 'Harbour Pavilion'))
    await waitForReport(reports, CARD)
    await sleep(QUIET_MS)
    expect(reports).not.toContain(HOME)
  })

  it('reports an outside edit that lands right after an own write', async () => {
    const root = makeProject()
    const ownBytes = Buffer.from(replaceOnce(HOME_TEXT, 'Studio Weekly', 'Studio Daily'))
    const known = new Map<ProjectPath, string>([[HOME, contentHash(ownBytes)]])
    const { reports } = await startWatching(root, (file) => known.get(file))

    writeFileSync(toNativePath(root, HOME), ownBytes)
    writeFileSync(toNativePath(root, HOME), replaceOnce(HOME_TEXT, 'Studio Weekly', 'Studio Hourly'))
    await waitForReport(reports, HOME)
  })

  it('ignores writes under .editor/ and .git/', async () => {
    const root = makeProject()
    const { reports } = await startWatching(root)
    writeFileSync(path.join(root, '.editor', 'state.json'), '{"hidden":[]}')
    writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/other\n')
    await sleep(QUIET_MS)
    writeFileSync(toNativePath(root, CARD), replaceOnce(CARD_TEXT, 'Harbor Pavilion', 'Harbour Pavilion'))
    await waitForReport(reports, CARD)
    await sleep(QUIET_MS)
    expect(reports.every((file) => file === CARD)).toBe(true)
  })

  it("does not report the Writer's own write, and reports an outside write after it", async () => {
    const root = makeProject()
    const messages: ServerMessage[] = []
    const writer = new Writer({ root, index: new SourceIndex(), undo: new UndoLog(), send: (message) => messages.push(message) })
    const home = await writer.open(HOME)
    await writer.open(CARD)
    const { reports } = await startWatching(root, (file) => writer.knownHash(file))

    const main = findId(home, /^<main/)
    writer.submit('own', { target: [main], kind: 'setDecl', payload: { prop: 'color', value: '#000000' } } as EditOp)
    await writer.flush()
    await vi.waitFor(() => expect(messages.some((message) => message.type === 'ack')).toBe(true), { timeout: 6_000, interval: 20 })
    await sleep(QUIET_MS)
    writeFileSync(toNativePath(root, CARD), replaceOnce(CARD_TEXT, 'Harbor Pavilion', 'Harbour Pavilion'))
    await waitForReport(reports, CARD)
    await sleep(QUIET_MS)
    expect(reports).not.toContain(HOME)

    writeFileSync(toNativePath(root, HOME), HOME_TEXT)
    await waitForReport(reports, HOME)
  })
})

function slice(text: string, range: SourceRange): string {
  return text.slice(range.start, range.end)
}

function startTagOf(indexed: IndexedFile, id: EdId): string {
  const location = indexed.locate(id)
  if (!location) throw new Error(`no location for ${id}`)
  return slice(indexed.text, location.startTag)
}

function findId(indexed: IndexedFile, startTag: RegExp): EdId {
  const id = indexed.ids.find((candidate) => startTag.test(startTagOf(indexed, candidate)))
  if (!id) throw new Error(`no element whose start tag matches ${startTag}`)
  return id
}

function tagNames(indexed: IndexedFile): Map<EdId, string> {
  return new Map(indexed.ids.map((id) => [id, /^<([\w-]+)/.exec(startTagOf(indexed, id))![1]!]))
}

function reconcileCard(edit: (text: string) => string) {
  const index = new SourceIndex()
  const previous = index.indexFile(CARD, CARD_TEXT)
  const text = edit(CARD_TEXT)
  return { previous, text, ...reconcile(index, previous, text) }
}

describe('reconcile', () => {
  it('keeps every id when an outside edit only changes text, even though later offsets moved', () => {
    const { previous, indexed, text } = reconcileCard((card) => replaceOnce(card, 'Harbor Pavilion', 'Harbor Pavilion, north wing'))
    expect(indexed.text).toBe(text)
    expect(indexed.ids).toEqual(previous.ids)
    expect(tagNames(indexed)).toEqual(tagNames(previous))
  })

  it("keeps the id of a node whose attributes changed outside", () => {
    const { previous, indexed } = reconcileCard((card) => replaceOnce(card, 'width: 328px', 'width: 340px'))
    const article = findId(previous, /^<article/)
    expect(indexed.ids).toEqual(previous.ids)
    expect(startTagOf(indexed, article)).toBe('<article class="card" style="background-color: #ffffff; width: 340px">')
  })

  it('gives an inserted node a fresh id and keeps the ids of the nodes around it', () => {
    const { previous, indexed } = reconcileCard((card) => replaceOnce(card, '    <h2', '    <span class="tag">New</span>\n    <h2'))
    const span = findId(indexed, /^<span/)
    expect(previous.ids).not.toContain(span)
    const before = tagNames(previous)
    const after = tagNames(indexed)
    for (const [id, tag] of before) expect(after.get(id)).toBe(tag)
    expect(indexed.ids).toHaveLength(previous.ids.length + 1)
  })

  it('gives a node that no longer matches a fresh id and returns where it was by element path', () => {
    const { previous, indexed, restoreByPath } = reconcileCard((card) =>
      replaceOnce(replaceOnce(card, '<h2 style="margin: 0 0 8px">', '<h3 style="margin: 0 0 8px">'), 'Pavilion</h2>', 'Pavilion</h3>'),
    )
    const oldH2 = findId(previous, /^<h2/)
    const h3 = findId(indexed, /^<h3/)
    expect(previous.ids).not.toContain(h3)
    expect(indexed.ids).not.toContain(oldH2)
    expect(tagNames(indexed).get(findId(previous, /^<article/))).toBe('article')
    expect(tagNames(indexed).get(findId(previous, /^<p/))).toBe('p')
    expect(restoreByPath.get(oldH2)).toBe(h3)
  })

  it('retires the id of a node removed outside and keeps its siblings', () => {
    const { previous, indexed } = reconcileCard((card) => replaceOnce(card, '    <h2 style="margin: 0 0 8px">Harbor Pavilion</h2>\n', ''))
    const oldH2 = findId(previous, /^<h2/)
    expect(indexed.ids).not.toContain(oldH2)
    expect(tagNames(indexed).get(findId(previous, /^<p/))).toBe('p')
    expect(indexed.ids).toHaveLength(previous.ids.length - 1)
  })
})
