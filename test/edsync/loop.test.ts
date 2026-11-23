import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { startEditor, type Editor } from '../../src/server/main'
import { WS_PATH, WS_TOKEN_PARAM, type BoardIndex, type ServerMessage } from '../../src/shared/protocol'
import { LEASE } from '../../src/shared/sync'
import type { EdId, EditOp, ProjectPath } from '../../src/shared/types'
import { actionOf, CARD, EDITS, expectOk, HOME, parsedOk, SLUG, useIsolatedGitConfig, Workspace } from './fake-remote'

type MessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>

const WAIT_MS = 10_000
const LOOP_MS = 90_000
const APPROVAL_OPEN_MS = 5 * 60_000
const CARD_COLOR = 'color: #c2410c'

interface Client {
  readonly messages: ServerMessage[]
  waitFor<T extends ServerMessage['type']>(type: T, where?: (message: MessageOf<T>) => boolean, after?: number): Promise<MessageOf<T>>
  open(board: string): Promise<BoardIndex>
  edit(op: EditOp): Promise<MessageOf<'ack'> | MessageOf<'rejected'>>
  close(): void
}

useIsolatedGitConfig()

let space: Workspace
let editor: Editor | undefined
let client: Client | undefined
let uiDir = ''
let nextOpId = 0

beforeAll(() => {
  uiDir = mkdtempSync(path.join(tmpdir(), 'edsync ui '))
  writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><html><head><title>Design Editor</title></head><body></body></html>\n')
})

afterAll(() => {
  rmSync(uiDir, { recursive: true, force: true })
})

beforeEach(async () => {
  space = Workspace.create()
  await space.pull()
})

afterEach(async () => {
  vi.useRealTimers()
  client?.close()
  await editor?.close()
  client = undefined
  editor = undefined
  space.dispose()
})

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
    const port = 30_000 + worker * 2_000 + 2 * Math.floor(Math.random() * 1_000)
    if ((await isFree(port)) && (await isFree(port + 1))) return port
  }
}

/** Timed with performance.now(), which keeps running while a test fakes Date. */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + WAIT_MS
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`${what} within ${WAIT_MS} ms`)
    await delay(20)
  }
}

function connect(port: number, token: string): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}?${WS_TOKEN_PARAM}=${token}`, { origin: `http://127.0.0.1:${port}` })
  const messages: ServerMessage[] = []
  const listeners = new Set<() => void>()
  socket.on('message', (data) => {
    messages.push(JSON.parse(data.toString()) as ServerMessage)
    for (const listener of [...listeners]) listener()
  })
  const waitFor: Client['waitFor'] = (type, where = () => true, after = 0) =>
    new Promise((resolve, reject) => {
      const deadline = new AbortController()
      const check = () => {
        const found = messages.slice(after).find((message) => message.type === type && where(message as never))
        if (!found) return
        listeners.delete(check)
        deadline.abort()
        resolve(found as never)
      }
      delay(WAIT_MS, undefined, { signal: deadline.signal }).then(
        () => {
          listeners.delete(check)
          reject(new Error(`no ${type} message within ${WAIT_MS} ms; got ${messages.map((message) => message.type).join(', ')}`))
        },
        () => undefined,
      )
      listeners.add(check)
      check()
    })
  const opened: Client = {
    messages,
    waitFor,
    open: async (board) => {
      const after = messages.length
      socket.send(JSON.stringify({ type: 'open', board }))
      return (await waitFor('index', (message) => message.index.board === board, after)).index
    },
    edit: (op) => {
      const opId = `loop-${++nextOpId}`
      socket.send(JSON.stringify({ type: 'op', opId, op }))
      return Promise.race([
        waitFor('ack', (message) => message.opId === opId),
        waitFor('rejected', (message) => message.opId === opId),
      ])
    },
    close: () => socket.close(),
  }
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(opened))
    socket.once('error', reject)
  })
}

/** The editor started on the pulled project, as `/design-pull` step 5 leaves it, with one client on its ws. */
async function editorOnPulledProject(): Promise<Client> {
  editor = await startEditor({ projectDir: space.projectDir, port: await freePortPair(), dev: false, uiDir })
  const { port, token } = JSON.parse(readFileSync(space.serverJsonFile(), 'utf8')) as { port: number; token: string }
  client = await connect(port, token)
  await client.waitFor('hello')
  return client
}

function idOf(index: BoardIndex, text: string, startTag: RegExp): EdId {
  const found = Object.entries(index.locations)
    .filter(([, location]) => startTag.test(text.slice(location.startTag.start, location.startTag.end)))
    .sort(([, a], [, b]) => a.startTag.start - b.startTag.start)[0]
  if (!found) throw new Error(`no element whose start tag matches ${startTag}`)
  return found[0] as EdId
}

function setDecl(target: EdId, prop: string, value: string): EditOp {
  return { kind: 'setDecl', target: [target], payload: { prop, value } }
}

async function editCardTitleColor(editing: Client): Promise<void> {
  const card = await editing.open(CARD as ProjectPath)
  const h2 = idOf(card, space.local(CARD).toString('utf8'), /^<h2\b/)
  expect((await editing.edit(setDecl(h2, 'color', '#c2410c'))).type).toBe('ack')
  await until(() => space.local(CARD).toString('utf8').includes(CARD_COLOR), 'the ws edit did not reach disk')
}

function sawUnlock(editing: Client, after: number): boolean {
  return editing.messages.slice(after).some((message) => message.type === 'pushLock' && !message.held)
}

describe('edsync lock and unlock with a live editor', () => {
  it('asks the editor for the lock with POST /push/begin, which locks the canvas, and hands it back with POST /push/end', async () => {
    const editing = await editorOnPulledProject()
    const home = await editing.open(HOME as ProjectPath)
    const h1 = idOf(home, space.local(HOME).toString('utf8'), /^<h1\b/)
    const before = editing.messages.length

    const printed = parsedOk<{ nonce: string; holder: string }>(await space.edsync('lock', '--slug', SLUG))

    expect(space.pushLock()).toMatchObject({ nonce: printed.nonce, holder: 'editor' })
    await editing.waitFor('pushLock', (message) => message.held, before)
    expect((await editing.edit(setDecl(h1, 'font-size', '56px'))).type).toBe('rejected')

    expectOk(await space.unlockRun(printed.nonce))

    await editing.waitFor('pushLock', (message) => !message.held, before)
    expect(space.pushLock()).toBeNull()
    expect((await editing.edit(setDecl(h1, 'font-size', '56px'))).type).toBe('ack')
  }, LOOP_MS)

  it('leaves the editor locked when unlock is given a nonce that is not the editor’s', async () => {
    const editing = await editorOnPulledProject()
    const before = editing.messages.length
    const nonce = await space.lock()

    await space.unlockRun('not-the-editor-nonce')

    expect(space.pushLock()?.nonce).toBe(nonce)
    expect(sawUnlock(editing, before)).toBe(false)
    expectOk(await space.unlockRun(nonce))
  }, LOOP_MS)
})

describe('the pull, edit, push loop against a fake remote', () => {
  it('ingests, edits over the ws, pushes through lock, classify, publish, commit and unlock, and the editor resumes', async () => {
    const editing = await editorOnPulledProject()
    await editCardTitleColor(editing)
    space.remote.edit(HOME, EDITS.homeTitle)
    const before = editing.messages.length

    const nonce = await space.lock()
    const output = await space.classify(nonce)
    expect(actionOf(output, CARD)).toBe('upload')
    expect(actionOf(output, HOME)).toBe('write-remote')
    expect(Object.keys(output.publish!.files)).toEqual([CARD])
    space.publish(output)
    await space.commit(nonce)
    expectOk(await space.unlockRun(nonce))

    expect(space.remote.read(CARD).toString('utf8')).toContain(CARD_COLOR)
    expect(space.local(HOME).equals(space.remote.read(HOME))).toBe(true)
    expect(space.base().commit).toBe(space.head())
    expect(space.base().files).toEqual(space.committedHashes())
    expect(space.status()).toEqual([])
    await editing.waitFor('pushLock', (message) => !message.held, before)
    expect(space.pushLock()).toBeNull()

    const home = await editing.open(HOME as ProjectPath)
    const h1 = idOf(home, space.local(HOME).toString('utf8'), /^<h1\b/)
    expect((await editing.edit(setDecl(h1, 'font-size', '56px'))).type).toBe('ack')
    await until(() => space.local(HOME).toString('utf8').includes('font-size: 56px'), 'the resumed edit did not reach disk')
    expect(space.local(HOME).toString('utf8')).toContain('font-size: 56px">Studio Monthly')
  }, LOOP_MS)

  it('neither unlocks the editor nor leaves the sync unrecorded when the publish approval stays open for 5 minutes', async () => {
    const editing = await editorOnPulledProject()
    await editCardTitleColor(editing)
    const pulled = space.head()
    const home = await editing.open(HOME as ProjectPath)
    const h1 = idOf(home, space.local(HOME).toString('utf8'), /^<h1\b/)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const before = editing.messages.length

    const nonce = await space.lock()
    const output = await space.classify(nonce)
    for (let open = 0; open < APPROVAL_OPEN_MS; open += LEASE.editorRenewMs) {
      await vi.advanceTimersByTimeAsync(LEASE.editorRenewMs)
      await delay(20)
    }
    await until(() => (space.pushLock()?.expiresAt ?? 0) > Date.now(), 'the editor did not renew its lease')

    expect(space.pushLock()?.nonce).toBe(nonce)
    expect(sawUnlock(editing, before)).toBe(false)
    expect((await editing.edit(setDecl(h1, 'font-size', '56px'))).type).toBe('rejected')

    space.publish(output)
    await space.commit(nonce)

    expect(space.head()).not.toBe(pulled)
    expect(space.headBlob(CARD).equals(space.remote.read(CARD))).toBe(true)
    expect(space.base().commit).toBe(space.head())
    expect(space.pushLock()?.nonce).toBe(nonce)

    vi.useRealTimers()
    expectOk(await space.unlockRun(nonce))
    await editing.waitFor('pushLock', (message) => !message.held, before)
  }, LOOP_MS)
})
