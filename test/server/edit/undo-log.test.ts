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
import type { EdId, EditOp, EditPayloads, ProjectPath, RuleId, SourceRange } from '../../../src/shared/types'

vi.mock('../../../src/core/atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/atomic-write')>()
  return { ...actual, atomicWrite: vi.fn(actual.atomicWrite) }
})

type MessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>

interface OnePropertyEdit {
  readonly element: RegExp
  readonly prop: string
  readonly value: string
  readonly from: string
  readonly to: string
}

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url))
const canvasBytes = (name: string) => readFileSync(path.join(FIXTURES, 'canvas', 'project', name))
const edgeBytes = (variant: string) => readFileSync(path.join(FIXTURES, 'endings', `edge.${variant}.dc.html`))

const HOME_TEXT = decodeSource(canvasBytes('home.dc.html'))
const CARD_TEXT = decodeSource(canvasBytes('card.dc.html'))

const HOME = 'project/home.dc.html' as ProjectPath
const CARD = 'project/card.dc.html' as ProjectPath

const CARD_STYLE = 'style="background-color: #ffffff; width: 328px"'
const ENDINGS = ['lf', 'crlf', 'mixed', 'bom', 'nonl'] as const

const CANVAS_EDITS: Readonly<Record<string, OnePropertyEdit>> = {
  'home.dc.html': {
    element: /^<main/,
    prop: 'color',
    value: '#000000',
    from: '<main class="page" style="color: #1c1917">',
    to: '<main class="page" style="color: #000000">',
  },
  'card.dc.html': {
    element: /^<article/,
    prop: 'background-color',
    value: '#fafaf9',
    from: 'style="background-color: #ffffff; width: 328px"',
    to: 'style="background-color: #fafaf9; width: 328px"',
  },
}

const EDGE_EDIT: OnePropertyEdit = {
  element: /^<section/,
  prop: 'background',
  value: '#ffffff',
  from: 'sans-serif; background: #fff7ed">',
  to: 'sans-serif; background: #ffffff">',
}

const IN_MEMORY_VARIANTS: Readonly<Record<(typeof ENDINGS)[number], (lf: string) => string>> = {
  lf: (lf) => lf,
  crlf: (lf) => lf.replace(/\n/g, '\r\n'),
  mixed: (lf) => {
    let line = 0
    return lf.replace(/\n/g, () => (++line % 2 === 0 ? '\r\n' : '\n'))
  },
  bom: (lf) => `\uFEFF${lf}`,
  nonl: (lf) => lf.replace(/\n$/, ''),
}

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

function makeProject(files: Readonly<Record<string, string | Uint8Array>>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'undo-log-'))
  roots.push(root)
  mkdirSync(path.join(root, 'project'))
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(root, 'project', name), content)
  return root
}

async function openSession(files: Readonly<Record<string, string | Uint8Array>>) {
  const root = makeProject(files)
  const messages: ServerMessage[] = []
  const undo = new UndoLog()
  const writer = new Writer({ root, index: new SourceIndex(), undo, send: (message) => messages.push(message) })
  for (const name of Object.keys(files)) await writer.open(`project/${name}` as ProjectPath)
  const nativeOf = (file: ProjectPath) => toNativePath(root, file)
  const diskBytes = (file: ProjectPath) => readFileSync(nativeOf(file))
  const diskText = (file: ProjectPath) => decodeSource(diskBytes(file))
  const current = (file: ProjectPath): IndexedFile => {
    const indexed = writer.indexed(file)
    if (!indexed) throw new Error(`${file} is not open`)
    return indexed
  }
  const run = async (edit: EditOp) => {
    const opId = submit(writer, edit)
    await writer.flush()
    return ackFor(messages, opId)
  }
  return { writer, undo, messages, nativeOf, diskBytes, diskText, current, run }
}

const openHomeAndCard = () => openSession({ 'home.dc.html': HOME_TEXT, 'card.dc.html': CARD_TEXT })

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

function waitForMessage<T extends ServerMessage['type']>(
  messages: readonly ServerMessage[],
  type: T,
  matches: (message: MessageOf<T>) => boolean = () => true,
): Promise<MessageOf<T>> {
  return vi.waitFor(
    () => {
      const found = messages.findLast((message): message is MessageOf<T> => message.type === type && matches(message as MessageOf<T>))
      if (!found) throw new Error(`no ${type} message yet`)
      return found
    },
    { timeout: 6_000, interval: 20 },
  )
}

const ackFor = (messages: readonly ServerMessage[], opId: string) => waitForMessage(messages, 'ack', (message) => message.opId === opId)

function lastRestored(messages: readonly ServerMessage[]): MessageOf<'restored'> {
  const restored = messages.findLast((message): message is MessageOf<'restored'> => message.type === 'restored')
  if (!restored) throw new Error('no restored message')
  return restored
}

describe('snapshots taken before each flush', () => {
  it("stores every touched file's pre-write text, its edId -> start offset map and the post-write hash", async () => {
    const { undo, current, diskBytes, run } = await openHomeAndCard()
    const before = current(HOME)
    await run(setDecl(findId(before, /^<h1/), 'font-size', '56px'))

    const entry = undo.peekUndo()
    expect(entry).not.toBeNull()
    expect(entry!.snapshots).toHaveLength(1)
    const [snapshot] = entry!.snapshots
    expect(snapshot!.file).toBe(HOME)
    expect(snapshot!.text).toBe(HOME_TEXT)
    expect(snapshot!.offsets).toEqual(before.startOffsets())
    expect(snapshot!.postWriteHash).toBe(contentHash(diskBytes(HOME)))
    expect(snapshot!.postWriteHash).not.toBe(contentHash(Buffer.from(HOME_TEXT)))
  })

  it('coalesces a drag burst into one entry', async () => {
    const { writer, undo, messages, current, diskText } = await openHomeAndCard()
    const img = findId(current(HOME), /^<img/)
    const opIds: string[] = []
    for (const top of [25, 26, 27, 28, 29, 30, 31, 32]) {
      opIds.push(submit(writer, setDecl(img, 'top', `${top}px`)))
      await sleep(80)
    }
    await Promise.all(opIds.map((opId) => ackFor(messages, opId)))
    expect(diskText(HOME)).toBe(replaceOnce(HOME_TEXT, 'top: 24px; right', 'top: 32px; right'))

    await writer.undo()
    expect(diskText(HOME)).toBe(HOME_TEXT)
    expect(undo.state().canUndo).toBe(false)
  })

  it('coalesces a typing burst into one entry', async () => {
    const { writer, undo, messages, current, diskText } = await openHomeAndCard()
    const h1 = findId(current(HOME), /^<h1/)
    const opIds: string[] = []
    for (const text of ['Studio Weekly!', 'Studio Weekly!!', 'Studio Weekly!!!']) {
      opIds.push(submit(writer, op('setText', [h1], { text })))
      await sleep(50)
    }
    await Promise.all(opIds.map((opId) => ackFor(messages, opId)))
    expect(diskText(HOME)).toBe(replaceOnce(HOME_TEXT, '>Studio Weekly<', '>Studio Weekly!!!<'))

    await writer.undo()
    expect(diskText(HOME)).toBe(HOME_TEXT)
    expect(undo.state().canUndo).toBe(false)
  })

  it('makes one entry of a multi-target op', async () => {
    const { writer, undo, current, diskText, run } = await openHomeAndCard()
    const cols = [0, 1, 2].map((nth) => findId(current(HOME), /^<div class="col"/, nth))
    await run(op('setDecl', cols, { prop: 'width', value: '200px' }))
    expect(diskText(HOME)).not.toBe(HOME_TEXT)

    await writer.undo()
    expect(diskText(HOME)).toBe(HOME_TEXT)
    expect(undo.state().canUndo).toBe(false)
  })

  it('keeps edits from separate flushes as separate entries', async () => {
    const { writer, current, diskText, run } = await openHomeAndCard()
    await run(setDecl(findId(current(HOME), /^<h1/), 'font-size', '56px'))
    const afterFirst = diskText(HOME)
    await sleep(400)
    await run(op('setAttr', [findId(current(HOME), /^<img/)], { name: 'alt', value: 'Mark' }))

    await writer.undo()
    expect(diskText(HOME)).toBe(afterFirst)
    await writer.undo()
    expect(diskText(HOME)).toBe(HOME_TEXT)
  })

  it('records only the files the entry touched', async () => {
    const { undo, current, run } = await openHomeAndCard()
    await run(setDecl(findId(current(CARD), /^<article/), 'width', '340px'))
    expect(undo.peekUndo()!.snapshots.map((snapshot) => snapshot.file)).toEqual([CARD])
  })
})

describe('undo', () => {
  it('writes the pre-image back through the Writer byte-identically and restores the stored id map', async () => {
    const { writer, current, nativeOf, diskBytes, run } = await openHomeAndCard()
    const before = current(HOME)
    await run(setDecl(findId(before, /^<h1/), 'font-size', 'clamp(40px, 6vw, 56px)'))
    vi.mocked(atomicWrite).mockClear()

    await writer.undo()
    expect(vi.mocked(atomicWrite).mock.calls.map(([file]) => file)).toEqual([nativeOf(HOME)])
    expect(diskBytes(HOME).equals(canvasBytes('home.dc.html'))).toBe(true)
    expect(current(HOME).text).toBe(HOME_TEXT)
    expect(current(HOME).startOffsets()).toEqual(before.startOffsets())
    expect(writer.knownHash(HOME)).toBe(contentHash(canvasBytes('home.dc.html')))
  })

  const structuralOps: ReadonlyArray<[string, (indexed: IndexedFile) => EditOp]> = [
    ['a deleted node', (indexed) => op('deleteNode', [findId(indexed, /^<div class="col"/, 1)], {})],
    ['a moved node', (indexed) => op('moveNode', [findId(indexed, /^<img/)], { parent: findId(indexed, /^<section/), before: null })],
    ['a wrapped node', (indexed) => op('wrapNode', [findId(indexed, /^<h1/)], { tag: 'div' })],
    ['a duplicated node', (indexed) => op('duplicateNode', [findId(indexed, /^<div class="col"/, 0)], {})],
  ]

  it.each(structuralOps)('gives %s its old id back and retires the ids the op minted', async (_name, edit) => {
    const { writer, messages, current, diskText, run } = await openHomeAndCard()
    const before = current(HOME)
    const ack = await run(edit(before))
    expect(diskText(HOME)).not.toBe(HOME_TEXT)

    await writer.undo()
    expect(diskText(HOME)).toBe(HOME_TEXT)
    const restored = current(HOME)
    expect(restored.startOffsets()).toEqual(before.startOffsets())
    for (const minted of ack.mintedIds) expect(restored.ids).not.toContain(minted)
    expect(lastRestored(messages).reload).toBe(true)
  })

  it('does nothing when there is nothing to undo', async () => {
    const { writer, messages, diskText } = await openHomeAndCard()
    await writer.undo()
    expect(atomicWrite).not.toHaveBeenCalled()
    expect(messages.some((message) => message.type === 'restored')).toBe(false)
    expect(diskText(HOME)).toBe(HOME_TEXT)
  })
})

describe('redo', () => {
  it('restores the post-write text with the id map captured at undo time', async () => {
    const { writer, undo, current, diskText, run } = await openHomeAndCard()
    const ack = await run(op('duplicateNode', [findId(current(HOME), /^<div class="col"/, 0)], {}))
    const postText = diskText(HOME)
    const postOffsets = current(HOME).startOffsets()

    await writer.undo()
    const [snapshot] = undo.peekRedo()!.snapshots
    expect(snapshot!.text).toBe(postText)
    expect(snapshot!.offsets).toEqual(postOffsets)

    await writer.redo()
    expect(diskText(HOME)).toBe(postText)
    expect(current(HOME).startOffsets()).toEqual(postOffsets)
    expect(current(HOME).ids).toContain(ack.mintedIds[0])
  })

  it('never hands out an id twice: the counter does not rewind when undo retires minted ids', async () => {
    const { writer, current, run } = await openHomeAndCard()
    const seen = new Set<EdId>([...current(HOME).ids, ...current(CARD).ids])
    const first = await run(op('duplicateNode', [findId(current(HOME), /^<div class="col"/, 0)], {}))
    for (const id of first.mintedIds) seen.add(id)
    for (const id of current(HOME).ids) seen.add(id)

    await writer.undo()
    const second = await run(op('duplicateNode', [findId(current(HOME), /^<div class="col"/, 0)], {}))
    expect(second.mintedIds).toHaveLength(1)
    for (const id of second.mintedIds) expect(seen.has(id)).toBe(false)
    const newIds = current(HOME).ids.filter((id) => !seen.has(id))
    expect(newIds).toEqual([...second.mintedIds])
  })
})

describe('style-only entries', () => {
  it('flags an entry that touched only inline style declarations and undoes it without a reload', async () => {
    const { writer, undo, messages, current, diskText, run } = await openHomeAndCard()
    const h1 = findId(current(HOME), /^<h1/)
    await run(setDecl(h1, 'font-size', '56px'))
    expect(undo.peekUndo()!.styleOnly).toBe(true)

    await writer.undo()
    expect(diskText(HOME)).toBe(HOME_TEXT)
    const restored = lastRestored(messages)
    expect(restored.reload).toBe(false)
    expect(restored.resolved[h1]).toBe('48px')
  })

  it('flags an inline removeDecl as style-only', async () => {
    const { undo, current, run } = await openHomeAndCard()
    await run(op('removeDecl', [findId(current(HOME), /^<h1/)], { prop: 'margin' }))
    expect(undo.peekUndo()!.styleOnly).toBe(true)
  })

  const reloadingOps: ReadonlyArray<[string, (indexed: IndexedFile) => EditOp]> = [
    ['a <helmet><style> rule edit', (indexed) => op('setDecl', [findId(indexed, /^<main/)], { prop: 'padding', value: '40px', rule: indexed.findRule('.page', 0)!.target as RuleId })],
    ['a text edit', (indexed) => op('setText', [findId(indexed, /^<h1/)], { text: 'Studio Monthly' })],
    ['an attribute edit', (indexed) => op('setAttr', [findId(indexed, /^<img/)], { name: 'alt', value: 'Mark' })],
  ]

  it.each(reloadingOps)('does not flag %s and undoes it with a reload', async (_name, edit) => {
    const { writer, undo, messages, current, diskText, run } = await openHomeAndCard()
    await run(edit(current(HOME)))
    expect(diskText(HOME)).not.toBe(HOME_TEXT)
    expect(undo.peekUndo()!.styleOnly).toBe(false)

    await writer.undo()
    expect(diskText(HOME)).toBe(HOME_TEXT)
    expect(lastRestored(messages).reload).toBe(true)
  })
})

async function expectOneOpThenUndoIsByteIdentical(name: string, bytes: Buffer, edit: OnePropertyEdit): Promise<void> {
  const file = `project/${name}` as ProjectPath
  const { writer, current, diskBytes, diskText, run } = await openSession({ [name]: bytes })
  await run(setDecl(findId(current(file), edit.element), edit.prop, edit.value))
  expect(diskText(file)).toBe(replaceOnce(decodeSource(bytes), edit.from, edit.to))

  await writer.undo()
  expect(diskBytes(file).equals(bytes)).toBe(true)
}

describe.each(Object.keys(CANVAS_EDITS))('canvas fixture %s', (name) => {
  const lf = decodeSource(canvasBytes(name))

  it.each(ENDINGS)('is byte-identical after one op and its undo, as the %s variant', async (variant) => {
    await expectOneOpThenUndoIsByteIdentical(name, Buffer.from(IN_MEMORY_VARIANTS[variant](lf), 'utf8'), CANVAS_EDITS[name]!)
  })
})

describe.each(ENDINGS)('edge.%s.dc.html', (variant) => {
  it('is byte-identical after one op and its undo', async () => {
    await expectOneOpThenUndoIsByteIdentical(`edge.${variant}.dc.html`, edgeBytes(variant), EDGE_EDIT)
  })
})

describe('an outside change', () => {
  const outsideHome = replaceOnce(HOME_TEXT, '>Studio Weekly<', '>Studio Weekly, edited outside<')

  it("drops that file's undo entries and keeps the other files' entries", async () => {
    const { writer, undo, current, nativeOf, diskText, run } = await openHomeAndCard()
    await run(setDecl(findId(current(HOME), /^<h1/), 'font-size', '56px'))
    await sleep(400)
    await run(setDecl(findId(current(CARD), /^<article/), 'width', '340px'))
    writeFileSync(nativeOf(HOME), outsideHome)
    await writer.outsideChange(HOME)

    await writer.undo()
    expect(diskText(CARD)).toBe(CARD_TEXT)
    expect(diskText(HOME)).toBe(outsideHome)
    expect(undo.state().canUndo).toBe(false)
    await writer.undo()
    expect(diskText(HOME)).toBe(outsideHome)
  })

  it("drops that file's redo entries", async () => {
    const { writer, undo, current, nativeOf, diskText, run } = await openHomeAndCard()
    await run(setDecl(findId(current(HOME), /^<h1/), 'font-size', '56px'))
    await writer.undo()
    expect(undo.state().canRedo).toBe(true)
    writeFileSync(nativeOf(HOME), outsideHome)
    await writer.outsideChange(HOME)

    expect(undo.state().canRedo).toBe(false)
    await writer.redo()
    expect(diskText(HOME)).toBe(outsideHome)
  })

  it('keeps the entries while the disk hash matches the post-write hash, and drops them once it differs', async () => {
    const { undo, current, diskBytes, run } = await openHomeAndCard()
    await run(setDecl(findId(current(HOME), /^<h1/), 'font-size', '56px'))
    await sleep(400)
    await run(setDecl(findId(current(CARD), /^<article/), 'width', '340px'))

    undo.outsideChange(HOME, contentHash(diskBytes(HOME)))
    expect(undo.peekUndo()!.snapshots.map((snapshot) => snapshot.file)).toEqual([CARD])
    undo.outsideChange(CARD, contentHash(diskBytes(CARD)))
    expect(undo.state().canUndo).toBe(true)

    undo.outsideChange(CARD, contentHash(Buffer.from(CARD_TEXT.replace(CARD_STYLE, 'style="width: 1px"'))))
    expect(undo.peekUndo()!.snapshots.map((snapshot) => snapshot.file)).toEqual([HOME])
    expect(undo.peekUndo()!.snapshots[0]!.text).toBe(HOME_TEXT)
  })
})
