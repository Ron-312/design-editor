import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { gitOutput } from '../../src/core/git'
import { acquirePushLock, readPushLock, releasePushLock } from '../../src/core/push-lock'
import { startEditor } from '../../src/server/main'
import { EditSession } from '../../src/server/session'
import {
  HTTP_ROUTES,
  TOKEN_HEADER,
  WS_PATH,
  WS_TOKEN_PARAM,
  type BoardIndex,
  type ClientMessage,
  type EditorState,
  type ServerMessage,
} from '../../src/shared/protocol'
import { LEASE } from '../../src/shared/sync'
import type { EdId, EditOp, EditPayloads, ProjectPath } from '../../src/shared/types'
import { cacheFixtureAssets } from '../pulled-fixture'

type MessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>

const CANVAS = fileURLToPath(new URL('../fixtures/canvas/', import.meta.url))
const HOME = 'project/home.dc.html' as ProjectPath
const CARD = 'project/card.dc.html' as ProjectPath
const HOME_BYTES = readFileSync(path.join(CANVAS, 'project', 'home.dc.html'))
const CARD_BYTES = readFileSync(path.join(CANVAS, 'project', 'card.dc.html'))
const HOME_TEXT = HOME_BYTES.toString('utf8')
const CARD_TEXT = CARD_BYTES.toString('utf8')
const OUTSIDE_EDIT = { from: '  <main class="page"', to: '  <!-- edited outside -->\n  <main class="page"' }
const WAIT_MS = 8_000
const QUIET_MS = 700

interface Running {
  readonly root: string
  readonly port: number
  readonly projectPort: number
  readonly token: string
  readonly close: () => Promise<void>
}

interface Client {
  readonly messages: ServerMessage[]
  send(message: ClientMessage): void
  waitFor<T extends ServerMessage['type']>(type: T, where?: (message: MessageOf<T>) => boolean, after?: number): Promise<MessageOf<T>>
  close(): void
}

interface Reply {
  readonly status: number
  readonly body: string
}

const parents: string[] = []
const editors: Running[] = []
const clients: Client[] = []
let uiDir = ''
let nextOpId = 0

beforeAll(() => {
  uiDir = mkdtempSync(path.join(tmpdir(), 'ed ui '))
  writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><html><head><title>Design Editor</title></head><body><div id="root"></div></body></html>\n')
})

afterEach(async () => {
  vi.useRealTimers()
  for (const client of clients.splice(0)) client.close()
  for (const editor of editors.splice(0)) await editor.close()
  for (const parent of parents.splice(0)) rmSync(parent, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(uiDir, { recursive: true, force: true })
})

function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from)
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`"${from}" must occur exactly once`)
  return text.slice(0, at) + to + text.slice(at + from.length)
}

async function git(root: string, ...args: string[]): Promise<string> {
  return gitOutput(args, { cwd: root })
}

/** A pulled project as `/design-pull` leaves it, under a path with spaces and non-ASCII characters. */
async function makeProject(homeBytes: Buffer = HOME_BYTES): Promise<string> {
  const parent = mkdtempSync(path.join(tmpdir(), 'ed session '))
  parents.push(parent)
  const root = path.join(parent, 'Café board ü')
  cpSync(path.join(CANVAS, 'project'), path.join(root, 'project'), { recursive: true })
  writeFileSync(path.join(root, 'project', 'home.dc.html'), homeBytes)
  await cacheFixtureAssets(root)
  await git(root, 'init', '-q')
  await git(root, 'config', 'user.email', 'test@example.com')
  await git(root, 'config', 'user.name', 'Test')
  await git(root, 'config', 'core.autocrlf', 'false')
  await git(root, 'config', 'commit.gpgsign', 'false')
  mkdirSync(path.join(root, '.git', 'info'), { recursive: true })
  writeFileSync(path.join(root, '.git', 'info', 'attributes'), '* -text\n')
  writeFileSync(path.join(root, '.git', 'info', 'exclude'), '.editor/\n')
  await git(root, 'add', '-A')
  await git(root, 'commit', '-q', '-m', 'Pulled test from Claude Design')
  return root
}

async function isFree(port: number): Promise<boolean> {
  const server = net.createServer()
  const bound = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => resolve(true))
  })
  if (bound) await new Promise<void>((resolve) => server.close(() => resolve()))
  return bound
}

async function freePortPair(): Promise<number> {
  const worker = Number(process.env.VITEST_POOL_ID ?? 0)
  for (;;) {
    const port = 20_000 + worker * 2_000 + 2 * Math.floor(Math.random() * 1_000)
    if ((await isFree(port)) && (await isFree(port + 1))) return port
  }
}

async function launch(root: string): Promise<Running> {
  const port = await freePortPair()
  const editor = await startEditor({ projectDir: root, port, dev: false, uiDir })
  const info = JSON.parse(readFileSync(path.join(root, '.editor', 'server.json'), 'utf8')) as { token: string }
  const running = { root, port, projectPort: port + 1, token: info.token, close: () => editor.close() }
  editors.push(running)
  return running
}

function connect(editor: Running): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${editor.port}${WS_PATH}?${WS_TOKEN_PARAM}=${editor.token}`, {
    origin: `http://127.0.0.1:${editor.port}`,
  })
  const messages: ServerMessage[] = []
  const listeners = new Set<() => void>()
  socket.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as ServerMessage)
    for (const listener of [...listeners]) listener()
  })
  const client: Client = {
    messages,
    send: (message) => socket.send(JSON.stringify(message)),
    waitFor: (type, where = () => true, after = 0) =>
      new Promise((resolve, reject) => {
        const timeout = new AbortController()
        const check = () => {
          const found = messages.slice(after).find((message) => message.type === type && where(message as never))
          if (!found) return
          listeners.delete(check)
          timeout.abort()
          resolve(found as never)
        }
        delay(WAIT_MS, undefined, { signal: timeout.signal }).then(
          () => {
            listeners.delete(check)
            reject(new Error(`no ${type} message within ${WAIT_MS} ms; got ${messages.map((message) => message.type).join(', ')}`))
          },
          () => undefined,
        )
        listeners.add(check)
        check()
      }),
    close: () => socket.close(),
  }
  clients.push(client)
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(client))
    socket.once('error', reject)
  })
}

async function openBoard(client: Client, board: ProjectPath): Promise<BoardIndex> {
  const after = client.messages.length
  client.send({ type: 'open', board })
  return (await client.waitFor('index', (message) => message.index.board === board, after)).index
}

function idOf(index: BoardIndex, text: string, startTag: RegExp, nth = 0): EdId {
  const ids = Object.entries(index.locations)
    .filter(([, location]) => startTag.test(text.slice(location.startTag.start, location.startTag.end)))
    .sort(([, a], [, b]) => a.startTag.start - b.startTag.start)
    .map(([id]) => id as EdId)
  const id = ids[nth]
  if (!id) throw new Error(`no element whose start tag matches ${startTag} #${nth}`)
  return id
}

function op<K extends keyof EditPayloads>(kind: K, target: readonly EdId[], payload: EditPayloads[K]): EditOp {
  return { kind, target, payload } as EditOp
}

function sendOp(client: Client, edit: EditOp): string {
  const opId = `op-${++nextOpId}`
  client.send({ type: 'op', opId, op: edit })
  return opId
}

function settled(client: Client, opId: string): Promise<MessageOf<'ack'> | MessageOf<'rejected'>> {
  return Promise.race([
    client.waitFor('ack', (message) => message.opId === opId),
    client.waitFor('rejected', (message) => message.opId === opId),
  ])
}

async function acked(client: Client, edit: EditOp): Promise<MessageOf<'ack'>> {
  const outcome = await settled(client, sendOp(client, edit))
  if (outcome.type !== 'ack') throw new Error(`op rejected: ${outcome.reason}`)
  return outcome
}

function diskText(root: string, file: ProjectPath): string {
  return readFileSync(path.join(root, ...file.split('/')), 'utf8')
}

function diskBytes(root: string, file: ProjectPath): Buffer {
  return readFileSync(path.join(root, ...file.split('/')))
}

function writeOutside(root: string, file: ProjectPath, text: string): void {
  writeFileSync(path.join(root, ...file.split('/')), text)
}

/** Timed with performance.now(), which keeps running while a test fakes Date. */
async function until(condition: () => boolean, ms = WAIT_MS): Promise<void> {
  const deadline = performance.now() + ms
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`condition not met within ${ms} ms`)
    await delay(20)
  }
}

function post(editor: Running, route: string, body?: unknown, token: string | null = editor.token): Promise<Reply> {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: editor.port,
        path: route,
        method: 'POST',
        agent: false,
        headers: {
          host: `127.0.0.1:${editor.port}`,
          ...(token === null ? {} : { [TOKEN_HEADER]: token }),
          ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    request.on('error', reject)
    request.end(payload)
  })
}

function get(port: number, url: string): Promise<Reply> {
  const { pathname } = new URL(url)
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: pathname, agent: false, headers: { host: `127.0.0.1:${port}` } },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    request.on('error', reject)
    request.end()
  })
}

async function beginPush(editor: Running): Promise<string> {
  const reply = await post(editor, HTTP_ROUTES.pushBegin)
  expect(reply.status).toBe(200)
  return (JSON.parse(reply.body) as { nonce: string }).nonce
}

async function sessionOn(homeBytes?: Buffer) {
  const root = await makeProject(homeBytes)
  const editor = await launch(root)
  const client = await connect(editor)
  const home = await openBoard(client, HOME)
  const homeText = diskText(root, HOME)
  return {
    root,
    editor,
    client,
    home,
    h1: idOf(home, homeText, /^<h1\b/),
    firstCol: idOf(home, homeText, /^<div class="col"/),
    holeText: idOf(home, homeText, /^<p aria-label=/),
  }
}

describe('the edit session over the ws', () => {
  it('greets with the canvas layout and indexes a board under a path with spaces and non-ASCII characters', async () => {
    const root = await makeProject()
    const editor = await launch(root)
    const client = await connect(editor)

    const hello = await client.waitFor('hello')
    expect(hello.readOnly).toBe(false)
    expect(hello.layout.order.map((board) => board.replace(/^project\//, ''))).toEqual(['home.dc.html', 'card.dc.html'])
    expect(hello.layout.boards.find((board) => board.path.endsWith('home.dc.html'))).toMatchObject({ w: 1280, h: 900 })

    const index = await openBoard(client, HOME)
    expect(index.frameSrc).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${editor.projectPort}/project/[0-9a-f]{32}/home\\.dc\\.html$`))
    expect(index.tree.tag).toBe('x-dc')
    const served = await get(editor.projectPort, index.frameSrc)
    expect(served.status).toBe(200)
    expect(served.body).toContain('Studio Weekly')
    expect(served.body).toContain(`data-ed-id="${idOf(index, HOME_TEXT, /^<h1\b/)}"`)
    expect(served.body).not.toContain(editor.token)
  })

  it('acks a style edit with its resolved value and locations, without a reload, as a one-line change', async () => {
    const { root, client, h1 } = await sessionOn()

    const ack = await acked(client, op('setDecl', [h1], { prop: 'font-size', value: '56px' }))

    expect(ack.reload).toBe(false)
    expect(ack.resolved[h1]).toBe('56px')
    expect(ack.record).toMatchObject({ kind: 'setDecl', prop: 'font-size', target: [h1] })
    const text = diskText(root, HOME)
    const location = ack.locations[h1]!
    expect(text.slice(location.startTag.start, location.startTag.end)).toBe('<h1 style="margin: 0; font-size: 56px">')
    expect(text).toBe(replaceOnce(HOME_TEXT, 'font-size: 48px', 'font-size: 56px'))
  })

  it('broadcasts every edit record to each connected editor', async () => {
    const { editor, client, h1 } = await sessionOn()
    const other = await connect(editor)

    await acked(client, op('setDecl', [h1], { prop: 'font-size', value: '56px' }))

    const seen = await other.waitFor('ack', (message) => message.record.kind === 'setDecl')
    expect(seen.record).toMatchObject({ prop: 'font-size', after: '56px', target: [h1] })
  })

  it('rejects an op the PatchEngine refuses and leaves the file byte-identical', async () => {
    const { root, client, holeText } = await sessionOn()

    const outcome = await settled(client, sendOp(client, op('setText', [holeText], { text: 'Hello there' })))

    expect(outcome.type).toBe('rejected')
    await delay(QUIET_MS)
    expect(diskBytes(root, HOME).equals(HOME_BYTES)).toBe(true)
  })

  it('acks a structural op with its minted ids and asks for a reload that restores the target', async () => {
    const { root, client, firstCol } = await sessionOn()

    const ack = await acked(client, op('duplicateNode', [firstCol], {}))

    expect(ack.reload).toBe(true)
    expect(ack.mintedIds).toHaveLength(1)
    expect(ack.mintedIds[0]).not.toBe(firstCol)
    expect(Object.keys(ack.locations)).toEqual(expect.arrayContaining([firstCol, ack.mintedIds[0]]))
    expect(diskText(root, HOME).match(/>Brief</g)).toHaveLength(2)
  })

  it('writes a text commit to the file and asks for a reload', async () => {
    const { root, client, h1 } = await sessionOn()

    const ack = await acked(client, op('setText', [h1], { text: 'Studio Monthly' }))

    expect(ack.reload).toBe(true)
    expect(ack.resolved[h1]).toBe('Studio Monthly')
    expect(diskText(root, HOME)).toBe(replaceOnce(HOME_TEXT, '>Studio Weekly<', '>Studio Monthly<'))
  })

  it('undoes and redoes a structural entry byte-exactly, reloading with the ids to restore', async () => {
    const { root, client, firstCol } = await sessionOn()
    await acked(client, op('duplicateNode', [firstCol], {}))
    const duplicated = diskText(root, HOME)

    const undoneAt = client.messages.length
    client.send({ type: 'undo' })
    const undone = await client.waitFor('restored', () => true, undoneAt)

    expect(undone.reload).toBe(true)
    expect(Object.keys(undone.locations)).toContain(firstCol)
    expect(diskBytes(root, HOME).equals(HOME_BYTES)).toBe(true)

    const redoneAt = client.messages.length
    client.send({ type: 'redo' })
    const redone = await client.waitFor('restored', () => true, redoneAt)

    expect(redone.reload).toBe(true)
    expect(diskText(root, HOME)).toBe(duplicated)
  })

  it('undoes a style-only entry by re-applying the pre-image value as a preview, with no reload', async () => {
    const { root, client, h1 } = await sessionOn()
    await acked(client, op('setDecl', [h1], { prop: 'font-size', value: '56px' }))

    const at = client.messages.length
    client.send({ type: 'undo' })
    const restored = await client.waitFor('restored', () => true, at)

    expect(restored.reload).toBe(false)
    expect(restored.resolved[h1]).toBe('48px')
    expect(diskBytes(root, HOME).equals(HOME_BYTES)).toBe(true)
    expect((await client.waitFor('undoState', (message) => message.state.canRedo, at)).state.canUndo).toBe(false)
  })
})

describe('outside edits seen by the watcher', () => {
  it('reconciles the file, re-sends the board index with matching ids kept, and drops that file’s undo', async () => {
    const { root, client, h1 } = await sessionOn()
    await acked(client, op('setDecl', [h1], { prop: 'font-size', value: '56px' }))
    const outside = replaceOnce(diskText(root, HOME), OUTSIDE_EDIT.from, OUTSIDE_EDIT.to)

    const at = client.messages.length
    writeOutside(root, HOME, outside)

    expect(await client.waitFor('outsideChange', (message) => message.file === HOME, at)).toMatchObject({ pendingOps: false })
    const reindexed = (await client.waitFor('index', (message) => message.index.board === HOME, at)).index
    const location = reindexed.locations[h1]!
    expect(outside.slice(location.startTag.start, location.startTag.end)).toBe('<h1 style="margin: 0; font-size: 56px">')
    await client.waitFor('undoState', (message) => !message.state.canUndo, at)

    client.send({ type: 'undo' })
    await delay(QUIET_MS)
    expect(diskText(root, HOME)).toBe(outside)
  })

  async function pendingDuringOutsideEdit() {
    const session = await sessionOn()
    const { root, client, h1 } = session
    const outside = replaceOnce(HOME_TEXT, OUTSIDE_EDIT.from, OUTSIDE_EDIT.to)
    const opIds: string[] = []
    const at = client.messages.length
    const sendBurst = (size: number) => opIds.push(sendOp(client, op('setDecl', [h1], { prop: 'font-size', value: `${size}px` })))
    sendBurst(50)
    writeOutside(root, HOME, outside)
    // Ops arriving faster than the 300 ms debounce keep it pending until the watcher reports the outside edit.
    let size = 51
    const question = client.waitFor('outsideChange', (message) => message.file === HOME, at)
    let asked = false
    void question.then(() => (asked = true), () => (asked = true))
    while (!asked) {
      sendBurst(size++)
      await delay(100)
    }
    return { ...session, outside, opIds, question: await question, lastSize: size - 1 }
  }

  it('pauses ops pending for that file and discards them when the user says discard', async () => {
    const { root, client, outside, opIds, question } = await pendingDuringOutsideEdit()
    expect(question.pendingOps).toBe(true)

    client.send({ type: 'resolvePending', file: HOME, keep: false })

    await client.waitFor('rejected', (message) => message.opId === opIds.at(-1))
    await delay(QUIET_MS)
    expect(diskText(root, HOME)).toBe(outside)
  })

  it('writes the paused ops over the outside edit when the user says keep', async () => {
    const { root, client, outside, opIds, question, lastSize } = await pendingDuringOutsideEdit()
    expect(question.pendingOps).toBe(true)

    client.send({ type: 'resolvePending', file: HOME, keep: true })

    await client.waitFor('ack', (message) => message.opId === opIds.at(-1))
    expect(diskText(root, HOME)).toBe(replaceOnce(outside, 'font-size: 48px', `font-size: ${lastSize}px`))
  })
})

describe('the push lock endpoints', () => {
  it('push/begin flushes the debounce to disk, takes push.lock with a 60 s lease and answers with its nonce', async () => {
    const { root, editor, client, h1 } = await sessionOn()
    sendOp(client, op('setDecl', [h1], { prop: 'font-size', value: '56px' }))
    const at = client.messages.length

    const started = Date.now()
    const nonce = await beginPush(editor)

    expect(Date.now() - started).toBeLessThan(LEASE.pushBeginTimeoutMs)
    expect(diskText(root, HOME)).toContain('font-size: 56px')
    const lock = await readPushLock(root)
    expect(lock).toMatchObject({ nonce, holder: 'editor', pid: process.pid })
    expect(lock!.expiresAt - lock!.startedAt).toBe(LEASE.editorMs)
    await client.waitFor('pushLock', (message) => message.held, at)
  })

  it('while the push holds the lock, refuses ops and undo instead of queueing them', async () => {
    const { root, editor, client, h1 } = await sessionOn()
    await acked(client, op('setDecl', [h1], { prop: 'font-size', value: '56px' }))
    const flushed = diskText(root, HOME)
    const nonce = await beginPush(editor)

    const refused = await settled(client, sendOp(client, op('setDecl', [h1], { prop: 'font-size', value: '64px' })))
    expect(refused.type).toBe('rejected')
    client.send({ type: 'undo' })
    const late = await connect(editor)
    expect((await late.waitFor('hello')).readOnly).toBe(true)
    await delay(QUIET_MS)
    expect(diskText(root, HOME)).toBe(flushed)

    expect((await post(editor, HTTP_ROUTES.pushEnd, { nonce })).status).toBe(200)
    await delay(QUIET_MS)
    expect(diskText(root, HOME)).toBe(flushed)
  })

  it('takes the lock under the nonce the caller sends, and answers a repeat begin with it', async () => {
    const { root, editor } = await sessionOn()

    const reply = await post(editor, HTTP_ROUTES.pushBegin, { nonce: 'cli-nonce' })
    const again = await post(editor, HTTP_ROUTES.pushBegin, { nonce: 'cli-nonce' })

    expect(JSON.parse(reply.body)).toEqual({ nonce: 'cli-nonce' })
    expect(JSON.parse(again.body)).toEqual({ nonce: 'cli-nonce' })
    expect((await readPushLock(root))?.nonce).toBe('cli-nonce')
  })

  it('a push/end under the nonce of a begin still flushing cancels it, so no lock is left behind', async () => {
    const root = await makeProject()
    const session = await EditSession.open(root)
    try {
      const begun = session.beginPush('given-up')
      expect(await session.endPush('given-up')).toBe(true)

      expect(await begun).toBeNull()
      expect(await readPushLock(root)).toBeNull()
      expect(await session.beginPush()).not.toBeNull()
    } finally {
      await session.close()
    }
  })

  it('refuses push/end with a wrong nonce or without the token, and keeps the lock', async () => {
    const { root, editor, client, h1 } = await sessionOn()
    const nonce = await beginPush(editor)

    expect((await post(editor, HTTP_ROUTES.pushEnd, { nonce: `${nonce}x` })).status).toBeGreaterThanOrEqual(400)
    expect((await post(editor, HTTP_ROUTES.pushEnd, { nonce }, null)).status).toBeGreaterThanOrEqual(400)

    expect((await readPushLock(root))?.nonce).toBe(nonce)
    expect((await settled(client, sendOp(client, op('setDecl', [h1], { prop: 'font-size', value: '64px' })))).type).toBe('rejected')
  })

  it('refuses push/begin while another holder’s lease is live', async () => {
    const { root, editor } = await sessionOn()
    const cli = await acquirePushLock(root, { holder: 'edsync', leaseMs: LEASE.cliMs })

    expect((await post(editor, HTTP_ROUTES.pushBegin)).status).toBeGreaterThanOrEqual(400)
    expect((await readPushLock(root))?.nonce).toBe(cli!.nonce)
  })

  it('push/end deletes the lock, re-indexes files the push rewrote, drops only their undo entries and resumes', async () => {
    const { root, editor, client, h1 } = await sessionOn()
    const card = await openBoard(client, CARD)
    const article = idOf(card, CARD_TEXT, /^<article\b/)
    await acked(client, op('setDecl', [article], { prop: 'width', value: '320px' }))
    await acked(client, op('setDecl', [h1], { prop: 'font-size', value: '56px' }))
    const nonce = await beginPush(editor)

    const at = client.messages.length
    const merged = replaceOnce(diskText(root, HOME), OUTSIDE_EDIT.from, OUTSIDE_EDIT.to)
    writeOutside(root, HOME, merged)
    const ended = await post(editor, HTTP_ROUTES.pushEnd, { nonce })

    expect(ended.status).toBe(200)
    expect(existsSync(path.join(root, '.editor', 'push.lock'))).toBe(false)
    await client.waitFor('pushLock', (message) => !message.held, at)
    await client.waitFor('outsideChange', (message) => message.file === HOME, at)
    const reindexed = (await client.waitFor('index', (message) => message.index.board === HOME, at)).index
    expect(merged.slice(reindexed.locations[h1]!.startTag.start, reindexed.locations[h1]!.startTag.end)).toMatch(/^<h1\b/)

    const undoneAt = client.messages.length
    client.send({ type: 'undo' })
    const restored = await client.waitFor('restored', () => true, undoneAt)
    expect(restored.record.files).toEqual([CARD])
    expect(diskBytes(root, CARD).equals(CARD_BYTES)).toBe(true)
    expect(diskText(root, HOME)).toBe(merged)

    const resumed = await acked(client, op('setDecl', [h1], { prop: 'font-size', value: '64px' }))
    expect(resumed.resolved[h1]).toBe('64px')
  })

  it('renews the lease every 20 s and after 30 minutes asks whether to unlock, never unlocking by itself', async () => {
    const { root, editor, client, h1 } = await sessionOn()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    const nonce = await beginPush(editor)
    const first = (await readPushLock(root))!

    await vi.advanceTimersByTimeAsync(LEASE.editorRenewMs)
    await until(() => JSON.parse(readFileSync(path.join(root, '.editor', 'push.lock'), 'utf8')).expiresAt > first.expiresAt)
    const renewed = (await readPushLock(root))!
    expect(renewed.nonce).toBe(nonce)
    expect(renewed.expiresAt).toBeGreaterThanOrEqual(first.expiresAt + LEASE.editorRenewMs)

    const at = client.messages.length
    for (let held = LEASE.editorRenewMs; held <= LEASE.askUnlockAfterMs; held += LEASE.editorRenewMs) {
      await vi.advanceTimersByTimeAsync(LEASE.editorRenewMs)
      await delay(5)
    }

    const asked = await client.waitFor('pushStale', () => true, at)
    expect(asked.heldForMs).toBeGreaterThanOrEqual(LEASE.askUnlockAfterMs)
    expect((await readPushLock(root))?.nonce).toBe(nonce)
    expect((await settled(client, sendOp(client, op('setDecl', [h1], { prop: 'font-size', value: '64px' })))).type).toBe('rejected')
    vi.useRealTimers()
    expect((await post(editor, HTTP_ROUTES.pushEnd, { nonce })).status).toBe(200)
  }, 30_000)
})

describe('a push lock the editor does not own at startup', () => {
  it('opens read-only with "Push in progress" until the lock is released', async () => {
    const root = await makeProject()
    const cli = await acquirePushLock(root, { holder: 'edsync', leaseMs: LEASE.cliMs })
    const editor = await launch(root)
    const client = await connect(editor)
    expect((await client.waitFor('hello')).readOnly).toBe(true)
    const home = await openBoard(client, HOME)
    const h1 = idOf(home, HOME_TEXT, /^<h1\b/)

    const refused = await settled(client, sendOp(client, op('setDecl', [h1], { prop: 'font-size', value: '56px' })))
    expect(refused).toMatchObject({ type: 'rejected', reason: expect.stringMatching(/push in progress/i) })

    const at = client.messages.length
    await releasePushLock(root, cli!.nonce)
    await client.waitFor('pushLock', (message) => !message.held, at)
    await acked(client, op('setDecl', [h1], { prop: 'font-size', value: '56px' }))
    expect(diskText(root, HOME)).toContain('font-size: 56px')
  }, 20_000)

  it('stays read-only until the lease expires, and never deletes a lock that is not its own', async () => {
    const root = await makeProject()
    await acquirePushLock(root, { holder: 'edsync', leaseMs: 2_000 })
    const editor = await launch(root)
    const client = await connect(editor)
    expect((await client.waitFor('hello')).readOnly).toBe(true)

    await client.waitFor('pushLock', (message) => !message.held)

    expect(existsSync(path.join(root, '.editor', 'push.lock'))).toBe(true)
  }, 20_000)

  it('opens writable when the lock found at startup has already expired', async () => {
    const root = await makeProject()
    await acquirePushLock(root, { holder: 'edsync', leaseMs: 1 })
    await delay(10)

    const editor = await launch(root)
    const client = await connect(editor)

    expect((await client.waitFor('hello')).readOnly).toBe(false)
  })
})

describe('design tokens', () => {
  it('sends the tokens.json tokens on connect, and again when tokens.json changes outside the editor', async () => {
    const root = await makeProject()
    const editor = await launch(root)
    const client = await connect(editor)

    const first = await client.waitFor('tokens')
    expect(first.tokens).toContainEqual({ name: 'color.accent', value: '#c2410c', source: 'tokens.json' })

    const tokensFile = path.join(root, 'project', 'ds', 'core', 'tokens.json')
    const at = client.messages.length
    writeFileSync(tokensFile, JSON.stringify({ color: { brand: { value: '#123456' } } }))

    const changed = await client.waitFor('tokens', () => true, at)
    expect(changed.tokens).toEqual([{ name: 'color.brand', value: '#123456', source: 'tokens.json' }])
  })
})

describe('editor state and revert through the session', () => {
  it('persists saveEditorState to .editor/state.json without touching source, and hides hidden ids in served bytes', async () => {
    const { root, editor, client, home, h1 } = await sessionOn()
    const state: EditorState = {
      hidden: [h1],
      locked: [],
      collapsed: [home.tree.edId],
      boards: { [HOME]: { zoom: 1.5, panX: 40, panY: -12, selection: [h1] } },
    }

    client.send({ type: 'saveEditorState', state })

    const stateFile = path.join(root, '.editor', 'state.json')
    await until(() => existsSync(stateFile) && JSON.parse(readFileSync(stateFile, 'utf8')).hidden?.length === 1)
    expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toEqual(state)
    expect(diskBytes(root, HOME).equals(HOME_BYTES)).toBe(true)
    expect(await git(root, 'status', '--porcelain')).toBe('')
    expect((await (await connect(editor)).waitFor('hello')).editorState).toEqual(state)
    const served = await get(editor.projectPort, home.frameSrc)
    expect(served.body).toMatch(new RegExp(`\\[data-ed-id="${h1}"\\][^{]*\\{display:\\s*none`))
  })

  it('drops malformed messages and a malformed editor state, and keeps serving the client', async () => {
    const { root, client, h1 } = await sessionOn()
    const raw = (message: unknown) => client.send(message as ClientMessage)

    raw({ type: 'saveEditorState', state: { hidden: ['x"],body{display:none}[x="'], locked: [], collapsed: [], boards: {} } })
    raw({ type: 'saveEditorState', state: { hidden: 'e1' } })
    raw({ type: 'op', opId: 'bad-1', op: { kind: 'setDecl', target: h1, payload: { prop: 'color' } } })
    raw({ type: 'op', opId: 'bad-2', op: { kind: 'eval', target: [h1], payload: {} } })
    raw({ type: 'resolvePending', file: HOME })
    raw({ type: 'open' })
    raw(null)

    await acked(client, op('setDecl', [h1], { prop: 'font-size', value: '56px' }))
    expect(existsSync(path.join(root, '.editor', 'state.json'))).toBe(false)
    expect(client.messages.some((message) => 'opId' in message && message.opId.startsWith('bad-'))).toBe(false)
  })

  it('revertFile writes the synced commit’s exact bytes as one undoable entry, not as an outside edit', async () => {
    const crlfWithBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(HOME_TEXT.replace(/\n/g, '\r\n'))])
    const { root, client, h1, firstCol } = await sessionOn(crlfWithBom)
    await acked(client, op('setDecl', [h1], { prop: 'font-size', value: '56px' }))
    await acked(client, op('setDecl', [firstCol], { prop: 'padding', value: '20px' }))
    const edited = diskBytes(root, HOME)

    const at = client.messages.length
    client.send({ type: 'revertFile', file: HOME })

    await until(() => diskBytes(root, HOME).equals(crlfWithBom))
    await delay(QUIET_MS)
    expect(client.messages.slice(at).some((message) => message.type === 'outsideChange')).toBe(false)

    const undoneAt = client.messages.length
    client.send({ type: 'undo' })
    await client.waitFor('restored', () => true, undoneAt)
    expect(diskBytes(root, HOME).equals(edited)).toBe(true)
  })
})
