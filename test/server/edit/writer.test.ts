import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { atomicWrite } from '../../../src/core/atomic-write'
import { UndoLog } from '../../../src/server/edit/undo-log'
import { contentHash, Writer } from '../../../src/server/edit/writer'
import { decodeSource } from '../../../src/server/source/bytes'
import { SourceIndex, type IndexedFile } from '../../../src/server/source/source-index'
import { toNativePath } from '../../../src/shared/paths'
import type { ServerMessage } from '../../../src/shared/protocol'
import type { EdId, EditOp, EditPayloads, ProjectPath, SourceRange } from '../../../src/shared/types'

vi.mock('../../../src/core/atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/atomic-write')>()
  return { ...actual, atomicWrite: vi.fn(actual.atomicWrite) }
})

type MessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>

const CANVAS = fileURLToPath(new URL('../../fixtures/canvas/project/', import.meta.url))
const HOME_TEXT = readFileSync(path.join(CANVAS, 'home.dc.html'), 'utf8')
const CARD_TEXT = readFileSync(path.join(CANVAS, 'card.dc.html'), 'utf8')
const SNIPPET_TEXT = `<!doctype html>\n<html>\n<body>\n<x-dc>\n<p class="target">t</p>\n<span class="s"><div>x</div></span>\n</x-dc>\n</body>\n</html>\n`

const HOME = 'project/home.dc.html' as ProjectPath
const CARD = 'project/card.dc.html' as ProjectPath
const SNIPPET = 'project/snippet.dc.html' as ProjectPath

const H1_STYLE = 'style="margin: 0; font-size: 48px"'
const MAIN_STYLE = 'style="color: #1c1917"'
const CARD_STYLE = 'style="background-color: #ffffff; width: 328px"'
const OUTSIDE_EDIT = { from: '  <main class="page"', to: '  <!-- edited outside -->\n  <main class="page"' }
const LOCKED_MESSAGE = /file locked by another program/
const ON_WINDOWS = process.platform === 'win32'

const roots: string[] = []
let nextOpId = 0

beforeEach(() => {
  vi.mocked(atomicWrite).mockClear()
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from)
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`"${from}" must occur exactly once`)
  return text.slice(0, at) + to + text.slice(at + from.length)
}

function makeProject(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'writer-'))
  roots.push(root)
  mkdirSync(path.join(root, 'project'))
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(root, 'project', name), text)
  return root
}

async function openSession(files: Readonly<Record<string, string>>) {
  const root = makeProject(files)
  const messages: ServerMessage[] = []
  const undo = new UndoLog()
  const writer = new Writer({ root, index: new SourceIndex(), undo, send: (message) => messages.push(message) })
  for (const name of Object.keys(files)) await writer.open(`project/${name}` as ProjectPath)
  const nativeOf = (file: ProjectPath) => toNativePath(root, file)
  const diskText = (file: ProjectPath) => decodeSource(readFileSync(nativeOf(file)))
  const current = (file: ProjectPath): IndexedFile => {
    const indexed = writer.indexed(file)
    if (!indexed) throw new Error(`${file} is not open`)
    return indexed
  }
  return { root, writer, undo, messages, nativeOf, diskText, current }
}

function op<K extends keyof EditPayloads>(kind: K, target: readonly EdId[], payload: EditPayloads[K]): EditOp {
  return { kind, target, payload } as EditOp
}

const setDecl = (target: EdId, prop: string, value: string) => op('setDecl', [target], { prop, value })

function submit(writer: Writer, edit: EditOp): string {
  const opId = `op-${++nextOpId}`
  writer.submit(opId, edit)
  return opId
}

function slice(text: string, range: SourceRange): string {
  return text.slice(range.start, range.end)
}

function startTagOf(indexed: IndexedFile, id: EdId): string {
  const location = indexed.locate(id)
  if (!location) throw new Error(`no location for ${id}`)
  return slice(indexed.text, location.startTag)
}

function findId(indexed: IndexedFile, startTag: RegExp, nth = 0): EdId {
  const id = indexed.ids.filter((candidate) => startTag.test(startTagOf(indexed, candidate)))[nth]
  if (!id) throw new Error(`no element whose start tag matches ${startTag} #${nth}`)
  return id
}

function startTags(indexed: IndexedFile): Map<EdId, string> {
  return new Map(indexed.ids.map((id) => [id, startTagOf(indexed, id)]))
}

function tagNames(indexed: IndexedFile): Map<EdId, string> {
  return new Map(indexed.ids.map((id) => [id, /^<([\w-]+)/.exec(startTagOf(indexed, id))![1]!]))
}

function waitForMessage<T extends ServerMessage['type']>(
  messages: readonly ServerMessage[],
  type: T,
  matches: (message: MessageOf<T>) => boolean = () => true,
): Promise<MessageOf<T>> {
  return vi.waitFor(
    () => {
      const found = messages.find((message): message is MessageOf<T> => message.type === type && matches(message as MessageOf<T>))
      if (!found) throw new Error(`no ${type} message yet`)
      return found
    },
    { timeout: 6_000, interval: 20 },
  )
}

const ackFor = (messages: readonly ServerMessage[], opId: string) => waitForMessage(messages, 'ack', (message) => message.opId === opId)

function messagesFor(messages: readonly ServerMessage[], opId: string): ServerMessage[] {
  return messages.filter((message) => 'opId' in message && message.opId === opId)
}

function writtenFiles(): string[] {
  return vi.mocked(atomicWrite).mock.calls.map(([file]) => file)
}

describe('debounced flush', () => {
  it('writes nothing for a session with no ops', async () => {
    const { writer, nativeOf } = await openSession({ 'home.dc.html': HOME_TEXT, 'card.dc.html': CARD_TEXT })
    await writer.flush()
    await sleep(400)
    expect(atomicWrite).not.toHaveBeenCalled()
    expect(readFileSync(nativeOf(HOME), 'utf8')).toBe(HOME_TEXT)
    expect(readFileSync(nativeOf(CARD), 'utf8')).toBe(CARD_TEXT)
  })

  it('waits 300 ms after an op before it writes', async () => {
    const { writer, messages, current, diskText } = await openSession({ 'home.dc.html': HOME_TEXT })
    const opId = submit(writer, setDecl(findId(current(HOME), /^<h1/), 'font-size', '56px'))
    await sleep(200)
    expect(atomicWrite).not.toHaveBeenCalled()
    expect(diskText(HOME)).toBe(HOME_TEXT)
    await ackFor(messages, opId)
    expect(diskText(HOME)).toBe(replaceOnce(HOME_TEXT, H1_STYLE, 'style="margin: 0; font-size: 56px"'))
  })

  it('flushes ops that arrive within 300 ms together, in one write per file', async () => {
    const { writer, messages, current, diskText, nativeOf } = await openSession({ 'home.dc.html': HOME_TEXT, 'card.dc.html': CARD_TEXT })
    const first = submit(writer, setDecl(findId(current(HOME), /^<h1/), 'font-size', '56px'))
    await sleep(100)
    const second = submit(writer, setDecl(findId(current(HOME), /^<main/), 'color', '#000000'))
    const third = submit(writer, setDecl(findId(current(CARD), /^<article/), 'width', '340px'))
    await Promise.all([first, second, third].map((opId) => ackFor(messages, opId)))

    expect(writtenFiles().sort()).toEqual([nativeOf(CARD), nativeOf(HOME)].sort())
    const bothEdits = replaceOnce(replaceOnce(HOME_TEXT, H1_STYLE, 'style="margin: 0; font-size: 56px"'), MAIN_STYLE, 'style="color: #000000"')
    expect(diskText(HOME)).toBe(bothEdits)
    expect(diskText(CARD)).toBe(replaceOnce(CARD_TEXT, CARD_STYLE, 'style="background-color: #ffffff; width: 340px"'))
  })

  it('writes the last value once when a drag sets one property many times inside the window', async () => {
    const { writer, messages, current, diskText } = await openSession({ 'home.dc.html': HOME_TEXT })
    const img = findId(current(HOME), /^<img/)
    const opIds = [25, 26, 27, 28, 29, 30, 31].map((top) => submit(writer, setDecl(img, 'top', `${top}px`)))
    const acks = await Promise.all(opIds.map((opId) => ackFor(messages, opId)))

    expect(atomicWrite).toHaveBeenCalledTimes(1)
    expect(diskText(HOME)).toBe(replaceOnce(HOME_TEXT, 'top: 24px; right', 'top: 31px; right'))
    expect(acks.at(-1)!.resolved[img]).toBe('31px')
  })
})

describe('shape check', () => {
  it('writes nothing and rejects the op with the reason when the re-parse would change the tree', async () => {
    const { writer, messages, current, diskText } = await openSession({ 'snippet.dc.html': SNIPPET_TEXT })
    const indexed = current(SNIPPET)
    const opId = submit(writer, op('moveNode', [findId(indexed, /^<span/)], { parent: findId(indexed, /^<p/), before: null }))
    await writer.flush()

    const rejected = await waitForMessage(messages, 'rejected', (message) => message.opId === opId)
    expect(rejected.reason).toMatch(/<p>/)
    expect(messagesFor(messages, opId).map((message) => message.type)).toEqual(['rejected'])
    expect(atomicWrite).not.toHaveBeenCalled()
    expect(diskText(SNIPPET)).toBe(SNIPPET_TEXT)
    expect(writer.hasPending(SNIPPET)).toBe(false)
  })
})

describe('selector-match warnings', () => {
  it('acks a move that can change which positional selectors match with the warning, and a style edit with none', async () => {
    const text = SNIPPET_TEXT.replace(
      '<x-dc>\n<p class="target">t</p>\n<span class="s"><div>x</div></span>\n</x-dc>',
      '<x-dc>\n<helmet><style>.a:first-child { color: red; }</style></helmet>\n<section class="one">\n  <div class="a">a</div>\n  <div class="b">b</div>\n</section>\n<section class="two">\n  <div class="c">c</div>\n</section>\n</x-dc>',
    )
    const { writer, messages, current } = await openSession({ 'snippet.dc.html': text })
    const indexed = current(SNIPPET)
    const moved = submit(writer, op('moveNode', [findId(indexed, /^<div class="a"/)], { parent: findId(indexed, /^<section class="two"/), before: null }))
    await writer.flush()
    const styled = submit(writer, setDecl(findId(current(SNIPPET), /^<div class="c"/), 'color', 'blue'))
    await writer.flush()

    expect((await ackFor(messages, moved)).warnings).toEqual([expect.stringMatching(/\.a:first-child/)])
    expect((await ackFor(messages, styled)).warnings).toEqual([])
  })
})

describe('atomic write', () => {
  it('writes through the core atomic write with the bytes that land on disk', async () => {
    const { writer, messages, current, nativeOf } = await openSession({ 'home.dc.html': HOME_TEXT })
    const opId = submit(writer, setDecl(findId(current(HOME), /^<main/), 'color', '#000000'))
    await writer.flush()
    await ackFor(messages, opId)

    expect(atomicWrite).toHaveBeenCalledTimes(1)
    const [file, bytes] = vi.mocked(atomicWrite).mock.calls[0]!
    expect(file).toBe(nativeOf(HOME))
    expect(Buffer.from(bytes).equals(readFileSync(nativeOf(HOME)))).toBe(true)
    expect(readFileSync(nativeOf(HOME), 'utf8')).toBe(replaceOnce(HOME_TEXT, MAIN_STYLE, 'style="color: #000000"'))
  })

  it('keeps a write that is still locked after the retry pending and visible, then writes it on a later flush', async () => {
    const { writer, undo, messages, current, diskText } = await openSession({ 'home.dc.html': HOME_TEXT })
    vi.mocked(atomicWrite).mockRejectedValueOnce(new Error('file locked by another program'))
    const opId = submit(writer, setDecl(findId(current(HOME), /^<main/), 'color', '#000000'))
    await writer.flush()

    const failed = await waitForMessage(messages, 'writeFailed')
    expect(failed).toMatchObject({ file: HOME, reason: 'locked' })
    expect(failed.message).toMatch(LOCKED_MESSAGE)
    expect(messagesFor(messages, opId)).toEqual([])
    expect(diskText(HOME)).toBe(HOME_TEXT)
    expect(writer.hasPending(HOME)).toBe(true)

    await writer.flush()
    await ackFor(messages, opId)
    expect(diskText(HOME)).toBe(replaceOnce(HOME_TEXT, MAIN_STYLE, 'style="color: #000000"'))
    expect(writer.hasPending(HOME)).toBe(false)

    await writer.undo()
    expect(diskText(HOME)).toBe(HOME_TEXT)
    expect(undo.state().canUndo).toBe(false)
  })
})

describe('after a write', () => {
  it('re-indexes the file and carries every id over by its shifted offset', async () => {
    const { writer, messages, current, diskText } = await openSession({ 'home.dc.html': HOME_TEXT })
    const before = current(HOME)
    const h1 = findId(before, /^<h1/)
    const opId = submit(writer, setDecl(h1, 'font-size', 'clamp(40px, 6vw, 56px)'))
    await writer.flush()
    await ackFor(messages, opId)

    const after = current(HOME)
    expect(after.text).toBe(diskText(HOME))
    expect(after.ids).toEqual(before.ids)
    const beforeTags = startTags(before)
    for (const [id, startTag] of startTags(after)) {
      if (id === h1) expect(startTag).toBe('<h1 style="margin: 0; font-size: clamp(40px, 6vw, 56px)">')
      else expect(startTag).toBe(beforeTags.get(id))
    }
  })

  it('binds the ids a structural op minted and returns them in the ack', async () => {
    const { writer, messages, current } = await openSession({ 'home.dc.html': HOME_TEXT })
    const before = current(HOME)
    const brief = findId(before, /^<div class="col" style="width: 240px/)
    const opId = submit(writer, op('duplicateNode', [brief], {}))
    await writer.flush()
    const ack = await ackFor(messages, opId)

    expect(ack.reload).toBe(true)
    expect(ack.mintedIds).toHaveLength(1)
    const [copy] = ack.mintedIds as [EdId]
    expect(before.ids).not.toContain(copy)
    const after = current(HOME)
    expect(after.ids).toEqual(expect.arrayContaining([...before.ids, copy]))
    expect(startTagOf(after, copy)).toBe(startTagOf(before, brief))
    expect(tagNames(after).get(brief)).toBe('div')
  })

  it('records the content hash of what it wrote, so the watcher can tell its own write', async () => {
    const { writer, messages, current, nativeOf } = await openSession({ 'home.dc.html': HOME_TEXT })
    expect(writer.knownHash(HOME)).toBe(contentHash(Buffer.from(HOME_TEXT)))
    const opId = submit(writer, setDecl(findId(current(HOME), /^<main/), 'color', '#000000'))
    await writer.flush()
    await ackFor(messages, opId)

    expect(writer.knownHash(HOME)).toBe(contentHash(readFileSync(nativeOf(HOME))))
    expect(writer.knownHash(HOME)).not.toBe(contentHash(Buffer.from(HOME_TEXT)))
  })

  it('acks a style edit with the value the re-indexed source resolves for every target', async () => {
    const { writer, messages, current } = await openSession({ 'home.dc.html': HOME_TEXT })
    const before = current(HOME)
    const cols = [0, 1, 2].map((nth) => findId(before, /^<div class="col"/, nth))
    const opId = submit(writer, op('setDecl', cols, { prop: 'width', value: '200px' }))
    await writer.flush()
    const ack = await ackFor(messages, opId)

    expect(ack.reload).toBe(false)
    expect(ack.resolved).toEqual(Object.fromEntries(cols.map((id) => [id, '200px'])))
    const after = current(HOME)
    for (const id of cols) expect(ack.locations[id]).toEqual(after.locate(id))
  })

  it('acks a text edit with the text the re-indexed source holds and asks for a reload', async () => {
    const { writer, messages, current, diskText } = await openSession({ 'home.dc.html': HOME_TEXT })
    const h1 = findId(current(HOME), /^<h1/)
    const opId = submit(writer, op('setText', [h1], { text: 'Studio Weekly & Co' }))
    await writer.flush()
    const ack = await ackFor(messages, opId)

    expect(diskText(HOME)).toBe(replaceOnce(HOME_TEXT, '>Studio Weekly<', '>Studio Weekly &amp; Co<'))
    expect(ack.resolved[h1]).toBe('Studio Weekly & Co')
    expect(ack.reload).toBe(true)
  })
})

describe('an outside change', () => {
  const outsideText = replaceOnce(HOME_TEXT, OUTSIDE_EDIT.from, OUTSIDE_EDIT.to)

  it('with no pending ops, re-indexes the file from disk and keeps the ids of nodes that still match', async () => {
    const { writer, messages, current, nativeOf } = await openSession({ 'home.dc.html': HOME_TEXT })
    const before = current(HOME)
    writeFileSync(nativeOf(HOME), outsideText)
    await writer.outsideChange(HOME)

    expect(await waitForMessage(messages, 'outsideChange')).toMatchObject({ file: HOME, pendingOps: false })
    const after = current(HOME)
    expect(after.text).toBe(outsideText)
    expect(after.ids).toEqual(before.ids)
    expect(tagNames(after)).toEqual(tagNames(before))
    expect(writer.knownHash(HOME)).toBe(contentHash(Buffer.from(outsideText)))
  })

  it('with pending ops, pauses writes, re-indexes from disk and asks to keep or discard them', async () => {
    const { writer, messages, current, nativeOf, diskText } = await openSession({ 'home.dc.html': HOME_TEXT })
    submit(writer, setDecl(findId(current(HOME), /^<h1/), 'font-size', '56px'))
    writeFileSync(nativeOf(HOME), outsideText)
    await writer.outsideChange(HOME)

    expect(await waitForMessage(messages, 'outsideChange')).toMatchObject({ file: HOME, pendingOps: true })
    expect(current(HOME).text).toBe(outsideText)
    await sleep(600)
    expect(atomicWrite).not.toHaveBeenCalled()
    expect(diskText(HOME)).toBe(outsideText)
    expect(writer.hasPending(HOME)).toBe(true)
  })

  it('writes the kept ops onto the outside version', async () => {
    const { writer, messages, current, nativeOf, diskText } = await openSession({ 'home.dc.html': HOME_TEXT })
    const opId = submit(writer, setDecl(findId(current(HOME), /^<h1/), 'font-size', '56px'))
    writeFileSync(nativeOf(HOME), outsideText)
    await writer.outsideChange(HOME)
    await writer.resolvePending(HOME, true)
    await writer.flush()

    await ackFor(messages, opId)
    expect(diskText(HOME)).toBe(replaceOnce(outsideText, H1_STYLE, 'style="margin: 0; font-size: 56px"'))
  })

  it('drops the discarded ops, rejects them and leaves the outside version on disk', async () => {
    const { writer, messages, current, nativeOf, diskText } = await openSession({ 'home.dc.html': HOME_TEXT })
    const opId = submit(writer, setDecl(findId(current(HOME), /^<h1/), 'font-size', '56px'))
    writeFileSync(nativeOf(HOME), outsideText)
    await writer.outsideChange(HOME)
    await writer.resolvePending(HOME, false)
    await writer.flush()
    await sleep(400)

    await waitForMessage(messages, 'rejected', (message) => message.opId === opId)
    expect(atomicWrite).not.toHaveBeenCalled()
    expect(diskText(HOME)).toBe(outsideText)
    expect(writer.hasPending(HOME)).toBe(false)
  })
})

/** PowerShell opens the file with FileShare.Read only, so a rename onto it fails until the handle closes. */
function holdOpenWithoutShareDelete(file: string, ms: number) {
  const script = [
    `$f = [System.IO.File]::Open('${file.replace(/'/g, "''")}', 'Open', 'Read', 'Read')`,
    `[Console]::Out.WriteLine('held')`,
    `Start-Sleep -Milliseconds ${ms}`,
    `$f.Close()`,
  ].join('; ')
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
  const released = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  const held = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('held')) resolve()
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`holder exited with ${code} before holding the file`)))
  })
  return { held, released }
}

describe.runIf(ON_WINDOWS)('a file held open by another program (Windows)', () => {
  it(
    'retries the save while the handle is open and writes once it closes',
    async () => {
      const { writer, messages, current, nativeOf, diskText } = await openSession({ 'home.dc.html': HOME_TEXT })
      const holder = holdOpenWithoutShareDelete(nativeOf(HOME), 1_000)
      await holder.held
      const opId = submit(writer, setDecl(findId(current(HOME), /^<main/), 'color', '#000000'))
      await writer.flush()

      await ackFor(messages, opId)
      expect(diskText(HOME)).toBe(replaceOnce(HOME_TEXT, MAIN_STYLE, 'style="color: #000000"'))
      await holder.released
    },
    20_000,
  )

  it(
    'reports the file as locked when the handle outlasts the retry, and keeps the edit until it can be written',
    async () => {
      const { writer, messages, current, nativeOf, diskText } = await openSession({ 'home.dc.html': HOME_TEXT })
      const holder = holdOpenWithoutShareDelete(nativeOf(HOME), 6_000)
      await holder.held
      const opId = submit(writer, setDecl(findId(current(HOME), /^<main/), 'color', '#000000'))
      await writer.flush()

      const failed = await waitForMessage(messages, 'writeFailed')
      expect(failed).toMatchObject({ file: HOME, reason: 'locked' })
      expect(failed.message).toMatch(LOCKED_MESSAGE)
      expect(writer.hasPending(HOME)).toBe(true)
      expect(messagesFor(messages, opId)).toEqual([])

      await holder.released
      await writer.flush()
      await ackFor(messages, opId)
      expect(diskText(HOME)).toBe(replaceOnce(HOME_TEXT, MAIN_STYLE, 'style="color: #000000"'))
    },
    30_000,
  )
})
