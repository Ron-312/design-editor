import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { acquirePushLock, readPushLock, releasePushLock } from '../../src/core/push-lock'
import { readCanvasLink, saveCanvasLink } from '../../src/edsync/canvas-link'
import { startEditor, type Editor } from '../../src/server/main'
import { HTTP_ROUTES, WS_PATH, WS_TOKEN_PARAM, type ClientMessage, type ServerMessage } from '../../src/shared/protocol'
import type { PushOutcome, PushState, PushStep } from '../../src/shared/push'
import { copyDir } from '../copy-dir'
import { CANVAS, CARD, EDITS, FIXTURE_FETCHED, HOME, replaceOnce, SVG_BLOB, useIsolatedGitConfig, Workspace } from '../edsync/fake-remote'
import { FakeClaude } from './fake-claude'

useIsolatedGitConfig()

const LINK = 'https://claude.ai/artifact/Throwaway1'
const WAIT_MS = process.platform === 'win32' ? 25_000 : 10_000

let sandbox: string
let workspace: Workspace
let claude: FakeClaude
let editor: Editor | undefined
let socket: WebSocket | undefined
let states: PushState[]

beforeEach(async () => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'ed push '))
  claude = new FakeClaude(path.join(sandbox, 'fake claude ü'))
  workspace = Workspace.create()
  await workspace.pull()
  copyDir(path.join(workspace.remote.dir, 'project'), path.join(claude.remote, 'project'))
  for (const [name, value] of Object.entries(claude.env)) vi.stubEnv(name, value)
  await saveCanvasLink(workspace.projectDir, LINK)
}, 30_000)

afterEach(async () => {
  socket?.close()
  await editor?.close()
  editor = undefined
  vi.unstubAllEnvs()
  workspace.dispose()
  rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

async function freePort(): Promise<number> {
  const isFree = (port: number) =>
    new Promise<boolean>((resolve) => {
      const server = net.createServer().once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })
  for (;;) {
    const port = 40_000 + 2 * Math.floor(Math.random() * 5_000)
    if ((await isFree(port)) && (await isFree(port + 1))) return port
  }
}

async function open(): Promise<void> {
  const uiDir = path.join(sandbox, 'ui')
  mkdirSync(uiDir, { recursive: true })
  writeFileSync(path.join(uiDir, 'index.html'), '<head></head>')
  editor = await startEditor({ projectDir: workspace.projectDir, port: await freePort(), dev: false, uiDir, probeScript: '' })
  const { port } = editor.address()
  const { token } = JSON.parse(readFileSync(path.join(workspace.projectDir, '.editor', 'server.json'), 'utf8')) as { token: string }
  states = []
  const opened = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}?${WS_TOKEN_PARAM}=${token}`, { origin: `http://127.0.0.1:${port}` })
  socket = opened
  opened.on('message', (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage
    if (message.type === 'pushState') states.push(message.state)
  })
  await new Promise((resolve) => opened.once('open', resolve))
}

function send(message: ClientMessage): void {
  socket!.send(JSON.stringify(message))
}

async function until<T>(read: () => T | undefined | false): Promise<T> {
  return vi.waitFor(() => {
    const value = read()
    if (!value) throw new Error(`not yet; states: ${JSON.stringify(states.at(-1))}`)
    return value
  }, { timeout: WAIT_MS, interval: 20 })
}

async function push(canvas?: string): Promise<PushOutcome> {
  if (!editor) await open()
  const from = states.length
  send(canvas === undefined ? { type: 'startPush' } : { type: 'startPush', canvas })
  return until(() => states.slice(from).find((state) => state.outcome !== null)?.outcome ?? undefined)
}

const remoteText = (file: string) => readFileSync(path.join(claude.remote, file), 'utf8')
const editRemote = (file: string, edit: { from: string; to: string }) => writeFileSync(path.join(claude.remote, file), replaceOnce(remoteText(file), edit))
const steps = (): (PushStep | null)[] => states.map((state) => state.step)

describe('the Push button’s push', () => {
  it('sends the edited file, commits it as synced, and leaves nothing locked or behind', async () => {
    workspace.editLocal(HOME, EDITS.homeTitle)

    expect(await push()).toEqual({ kind: 'pushed', title: 'Throwaway', sent: [HOME], received: [] })

    expect(remoteText(HOME)).toBe(workspace.local(HOME).toString('utf8'))
    expect(workspace.status()).toEqual([])
    expect(await readPushLock(workspace.projectDir)).toBeNull()
    await until(() => !existsSync(path.join(workspace.projectDir, '.editor', 'push')))
    expect(existsSync(path.join(workspace.projectDir, '.editor', 'outbox'))).toBe(false)
    expect(steps()).toEqual(expect.arrayContaining(['starting', 'opening', 'checking', 'merging', 'sending', 'confirming', null]))
  })

  it('makes one publish of only the changed files, through the outbox', async () => {
    workspace.editLocal(HOME, EDITS.homeTitle)

    await push()

    const source = path.join(realpathSync.native(workspace.projectDir), '.editor', 'outbox', ...HOME.split('/'))
    expect(claude.publishes()).toEqual([{ action: 'publish', url: LINK, root: '.editor/outbox', file_path: source }])
    expect(claude.reads()).toEqual([{ file: source, allowed: true }])
    expect(realpathSync.native(claude.started().cwd)).toBe(realpathSync.native(workspace.projectDir))
  })

  it('sends several files in the one publish, each read by Claude first', async () => {
    workspace.editLocal(HOME, EDITS.homeTitle)
    workspace.editLocal(CARD, EDITS.cardText)

    expect(await push()).toMatchObject({ kind: 'pushed', sent: [CARD, HOME] })

    expect(claude.publishes()).toHaveLength(1)
    expect(claude.reads().map((read) => path.basename(read.file))).toEqual(['card.dc.html', 'home.dc.html'])
    expect(remoteText(CARD)).toBe(workspace.local(CARD).toString('utf8'))
    expect(remoteText(HOME)).toBe(workspace.local(HOME).toString('utf8'))
  })

  it('publishes nothing when both sides already agree', async () => {
    expect(await push()).toEqual({ kind: 'pushed', title: 'Throwaway', sent: [], received: [] })

    expect(claude.publishes()).toEqual([])
  })

  it('brings in an edit made only in Claude Design', async () => {
    editRemote(CARD, EDITS.cardText)

    expect(await push()).toMatchObject({ kind: 'pushed', sent: [], received: [CARD] })

    expect(workspace.local(CARD).toString('utf8')).toBe(remoteText(CARD))
    expect(workspace.status()).toEqual([])
  })

  it('merges edits made on both sides of one file and sends the merge', async () => {
    workspace.editLocal(HOME, EDITS.homeTitle)
    editRemote(HOME, EDITS.homeLede)

    expect(await push()).toMatchObject({ kind: 'pushed', sent: [HOME], received: [HOME] })

    expect(remoteText(HOME)).toContain(EDITS.homeTitle.to)
    expect(remoteText(HOME)).toContain(EDITS.homeLede.to)
    expect(workspace.local(HOME).toString('utf8')).toBe(remoteText(HOME))
  })

  it('stops on a conflict, naming the file, with both sides untouched', async () => {
    workspace.editLocal(HOME, EDITS.homeTitle)
    editRemote(HOME, { from: EDITS.homeTitle.from, to: `${EDITS.homeTitle.from} Weekly` })
    const [local, remote] = [workspace.local(HOME).toString('utf8'), remoteText(HOME)]

    expect(await push()).toMatchObject({ kind: 'failed', reason: 'conflict', files: [HOME] })

    expect(workspace.local(HOME).toString('utf8')).toBe(local)
    expect(remoteText(HOME)).toBe(remote)
    expect(claude.publishes()).toEqual([])
    expect(await readPushLock(workspace.projectDir)).toBeNull()
  })

  it('stops when an artboard was removed here', async () => {
    await open()
    workspace.removeLocal(CARD)

    expect(await push()).toMatchObject({ kind: 'failed', reason: 'artboards', files: [CARD] })
  })

  it('fetches the images of an artboard that arrived from Claude Design', async () => {
    const cached = path.join(workspace.projectDir, '.editor', 'cache', `${SVG_BLOB}.svg`)
    rmSync(cached)
    copyDir(FIXTURE_FETCHED, path.join(claude.home, 'assets'))
    const before = remoteText(CARD)
    writeFileSync(path.join(claude.remote, CARD), replaceOnce(before, { from: EDITS.cardText.from, to: `${EDITS.cardText.from}<img src="/_blob/${SVG_BLOB}">` }))

    expect(await push()).toMatchObject({ kind: 'pushed', received: [CARD] })

    expect(existsSync(cached)).toBe(true)
  })
})

describe('what Claude may do during a push', () => {
  it('denies calls that differ from the one asked for, whatever made Claude try them', async () => {
    workspace.editLocal(HOME, EDITS.homeTitle)
    claude.behave({ strays: [{ action: 'delete' }, { url: 'https://claude.ai/artifact/Another' }, { action: 'publish', file_path: '/etc/passwd' }] })

    expect(await push()).toMatchObject({ kind: 'pushed', sent: [HOME] })

    expect(claude.calls().filter((call) => call.allowed).map((call) => call.action)).toEqual(['read', 'list', 'read', 'publish', 'list'])
    expect(claude.publishes()).toHaveLength(1)
  })

  it('lets a publish through once', async () => {
    workspace.editLocal(HOME, EDITS.homeTitle)
    claude.behave({ twice: true })

    await push()

    expect(claude.publishes()).toHaveLength(1)
  })

  it('keeps the guard secret out of the arguments, and in a file only the owner reads', async () => {
    claude.behave({ hang: true })
    await open()
    send({ type: 'startPush' })
    await until(() => claude.wasStarted())
    const settings = path.join(workspace.projectDir, '.editor', 'push', 'settings.json')
    const secret = (JSON.parse(readFileSync(settings, 'utf8')) as { hooks: { PreToolUse: { hooks: { headers: Record<string, string> }[] }[] } }).hooks.PreToolUse[0]!.hooks[0]!.headers['x-push-secret']!

    expect(secret.length).toBeGreaterThan(30)
    expect(claude.started().args.join(' ')).not.toContain(secret)
    if (process.platform !== 'win32') expect(statSync(settings).mode & 0o777).toBe(0o600)
  })

  it('answers the hook only for the running push’s secret', async () => {
    await open()
    const ask = (secret: string) =>
      fetch(`http://127.0.0.1:${editor!.address().port}${HTTP_ROUTES.pushGuard}`, { method: 'POST', headers: { 'x-push-secret': secret }, body: '{"tool_name":"Artifact","tool_input":{}}' })

    expect((await ask('guess')).status).toBe(403)
    expect((await ask('')).status).toBe(403)
  })
})

describe('when a push cannot finish', () => {
  beforeEach(() => workspace.editLocal(HOME, EDITS.homeTitle))

  it('says to sign in, without starting Claude or locking the canvas', async () => {
    claude.behave({ signedOut: true })

    expect(await push()).toMatchObject({ kind: 'failed', reason: 'signedOut' })

    expect(claude.wasStarted()).toBe(false)
  })

  it('says when Claude Code is not installed', async () => {
    vi.stubEnv('DESIGN_EDITOR_CLAUDE', path.join(sandbox, 'nowhere', 'claude'))

    expect(await push()).toMatchObject({ kind: 'failed', reason: 'noClaude' })
  })

  it.each([
    ['’s window is closed', { crash: true }],
    ['answers without the call', { talkOnly: true }],
    ['reads only some of the files', { partialRead: true }],
    ['is refused the publish', { refusePublish: true }],
    ['claims a publish that did not land', { dropPublish: true }],
  ])('fails, unlocks and keeps the edit waiting when Claude %s', async (_label, behaviour) => {
    claude.behave(behaviour)
    const head = workspace.head()

    expect(await push()).toMatchObject({ kind: 'failed', reason: 'error' })

    expect(workspace.head()).toBe(head)
    expect(workspace.local(HOME).toString('utf8')).toContain(EDITS.homeTitle.to)
    expect(await readPushLock(workspace.projectDir)).toBeNull()
  })

  it('a partial read never deletes the file it left out', async () => {
    claude.behave({ partialRead: true })

    await push()

    for (const file of [HOME, CARD, CANVAS]) expect(workspace.hasLocal(file)).toBe(true)
  })

  it('succeeds when pushed again after a refusal', async () => {
    claude.behave({ refusePublish: true })
    expect(await push()).toMatchObject({ kind: 'failed' })
    claude.behave({})

    expect(await push()).toMatchObject({ kind: 'pushed', sent: [HOME] })
  })

  it('says the window was closed when it was', async () => {
    claude.behave({ crash: true })

    expect(await push()).toMatchObject({ message: expect.stringContaining('window was closed') })
  })

  it('can be cancelled while it waits on Claude, sending nothing', async () => {
    claude.behave({ hang: true })
    await open()
    send({ type: 'startPush' })
    await until(() => claude.wasStarted())

    send({ type: 'cancelPush' })

    expect(await until(() => states.at(-1)?.outcome ?? undefined)).toMatchObject({ kind: 'failed', reason: 'cancelled' })
    expect(await readPushLock(workspace.projectDir)).toBeNull()
  })

  it('closing the editor ends the push and releases the lock', async () => {
    claude.behave({ hang: true })
    await open()
    send({ type: 'startPush' })
    await until(() => claude.wasStarted())

    await editor!.close()
    editor = undefined

    expect(await readPushLock(workspace.projectDir)).toBeNull()
  })

  it('refuses while another push holds the canvas', async () => {
    await open()
    const lock = await acquirePushLock(workspace.projectDir, { holder: 'edsync', leaseMs: 60_000 })

    expect(await push()).toMatchObject({ kind: 'failed', reason: 'error' })

    await releasePushLock(workspace.projectDir, lock!.nonce)
  })
})

describe('a project that does not know its canvas', () => {
  beforeEach(() => rmSync(path.join(workspace.projectDir, '.editor', 'canvas.json')))

  it('asks for the link instead of starting', async () => {
    expect(await push()).toMatchObject({ kind: 'failed', reason: 'noCanvas' })

    expect(claude.wasStarted()).toBe(false)
  })

  it('keeps a pasted link that matches the project', async () => {
    workspace.editLocal(HOME, EDITS.homeTitle)

    expect(await push(` ${LINK}?x=1 `)).toMatchObject({ kind: 'pushed', sent: [HOME] })

    expect(await readCanvasLink(workspace.projectDir)).toBe(LINK)
    expect(states.at(-1)?.canvas).toBe(LINK)
  })

  it('refuses a canvas that shares no artboard with the project, changing neither side', async () => {
    for (const file of [HOME, CARD]) writeFileSync(path.join(claude.remote, file), '<!doctype html><html><body>Other</body></html>')

    expect(await push(LINK)).toMatchObject({ kind: 'failed', reason: 'wrongCanvas' })

    expect(await readCanvasLink(workspace.projectDir)).toBeNull()
    expect(workspace.status()).toEqual([])
    expect(claude.publishes()).toEqual([])
  })

  it('refuses a canvas that lacks one of the artboards', async () => {
    rmSync(path.join(claude.remote, CARD))

    expect(await push(LINK)).toMatchObject({ kind: 'failed', reason: 'wrongCanvas' })

    expect(workspace.hasLocal(CARD)).toBe(true)
  })

  it.each(['https://evil.example/artifact/x', 'claude.ai/artifact/x', 'https://claude.ai/chat/x'])('refuses %s as a link', async (link) => {
    expect(await push(link)).toMatchObject({ kind: 'failed', reason: 'noCanvas' })
  })
})
