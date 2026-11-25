import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from '../core/atomic-write'
import { cacheFetched } from '../edsync/cache'
import { readCanvasLink, saveCanvasLink } from '../edsync/canvas-link'
import { assertHoldsLock, classifyPush, commitPush, type ClassifiedPush } from '../edsync/push-steps'
import { readBaseJson } from '../edsync/sync-commit'
import { gitBlobHash } from '../edsync/classify'
import { toNativePath } from '../shared/paths'
import { CURRENT_RELEASE_FILE, EDITOR_DIR, EDITOR_FILES } from '../shared/protocol'
import { canvasLink, IDLE_PUSH, isCancellable, type PushOutcome, type PushState, type PushStep } from '../shared/push'
import type { ProjectPath } from '../shared/types'
import { assertSignedIn, findClaude, openClaude, PushError, type Claude } from './claude'
import { GUARD_HEADER, PushGuard, type HookReply } from './guard'
import { firstLine, RemoteCanvas, sha256, type RemoteFile } from './remote'

export interface PushHost {
  /** Flushes pending edits and locks the canvas; null while another push holds it. */
  beginPush(): Promise<string | null>
  endPush(nonce: string): Promise<boolean>
  changed(state: PushState): void
}

const OUTBOX = `${EDITOR_DIR}/outbox`
const WORK_DIR = `${EDITOR_DIR}/push`
const ARTBOARD = /\.dc\.html$/
const MAX_ASSET_ROUNDS = 5
const OWNER_ONLY = 0o600
const GUARD_TIMEOUT_S = 10

const NO_CLAUDE = 'Push needs Claude Code on this computer. Install it from claude.com/claude-code, then push again.'
const NO_CANVAS = 'This project does not know its canvas yet. Paste its claude.ai link.'
const WRONG_CANVAS = 'That canvas does not match this project, so nothing was sent. Check the link.'
const CONFLICT = 'These files changed in Claude Design and here in the same place. Nothing was sent.'
const ARTBOARDS = 'Artboards can only be added or removed in Claude Design. Nothing was sent.'

/** The push the Push button starts: the same steps as `/design-push`, with Claude Code making only the Artifact calls. */
export class PushRunner {
  private state: PushState = IDLE_PUSH
  private guard: PushGuard | null = null
  private claude: Claude | null = null
  private cancelled = false
  private running: Promise<void> | null = null
  private guardUrl = ''

  constructor(
    private readonly root: string,
    private readonly host: PushHost,
  ) {}

  async open(): Promise<void> {
    this.state = { ...this.state, canvas: await readCanvasLink(this.root) }
  }

  serveGuardAt(url: string): void {
    this.guardUrl = url
  }

  get current(): PushState {
    return this.state
  }

  /** Null for a secret that is not the running push's, which Claude Code then treats as a denial. */
  decide(secret: string | undefined, toolName: unknown, input: unknown): HookReply | null {
    return this.guard?.hasSecret(secret) ? this.guard.decide(toolName, input) : null
  }

  start(pasted?: string): Promise<void> {
    this.running ??= this.run(pasted).finally(() => (this.running = null))
    return this.running
  }

  cancel(): void {
    if (!isCancellable(this.state.step)) return
    this.cancelled = true
    this.claude?.close()
  }

  /** A push past cancelling is given up on: its publish may have landed, and the next push then finds it unchanged. */
  async close(): Promise<void> {
    this.cancelled = true
    this.claude?.close()
    await this.running
  }

  private show(change: Partial<PushState>): void {
    this.state = { ...this.state, ...change }
    this.host.changed(this.state)
  }

  private enter(step: PushStep): void {
    if (this.cancelled && isCancellable(this.state.step)) throw new PushError('cancelled', 'The push was cancelled. Nothing was sent.')
    this.show({ step })
  }

  private async run(pasted: string | undefined): Promise<void> {
    this.cancelled = false
    this.show({ step: 'starting', outcome: null })
    let nonce: string | null = null
    let outcome: PushOutcome
    try {
      const url = await this.canvasFor(pasted)
      const command = findClaude()
      if (!command) throw new PushError('noClaude', NO_CLAUDE)
      await assertSignedIn(command, this.root)
      nonce = await this.host.beginPush()
      if (nonce === null) throw new PushError('error', 'Another push holds the canvas. Wait for it to finish.')
      outcome = await this.push(command, url, pasted !== undefined, nonce)
    } catch (error) {
      outcome = failure(error)
    }
    this.claude?.close()
    this.claude = null
    this.guard = null
    await rm(this.path(WORK_DIR), { recursive: true, force: true }).catch(() => undefined)
    try {
      if (nonce !== null) await this.host.endPush(nonce)
    } finally {
      this.show({ step: null, outcome })
    }
  }

  private async canvasFor(pasted: string | undefined): Promise<string> {
    const url = pasted === undefined ? this.state.canvas : canvasLink(pasted)
    if (url) return url
    throw new PushError('noCanvas', pasted === undefined ? NO_CANVAS : 'That is not a claude.ai artifact link.')
  }

  private async push(command: string, url: string, isNewLink: boolean, nonce: string): Promise<PushOutcome> {
    const slug = path.basename(this.root)
    this.guard = new PushGuard()
    this.enter('checking')
    this.claude = openClaude(command, { cwd: this.root, settingsFile: await this.writeSettings(this.guard) })
    const remote = new RemoteCanvas(this.claude, this.guard, url)
    const files = await remote.list()
    const { title, dir } = await remote.snapshot(files, this.path(WORK_DIR, 'snapshot'))
    if (isNewLink) await this.adoptLink(url, dir, files)

    this.enter('merging')
    const classified = await classifyPush({ projectDir: this.root, slug, remoteDir: dir, nonce })
    if (classified.blocking.length > 0) throw blocked(classified)
    await this.fetchAssets(remote, classified.missingBlobs)

    const sent = Object.keys(classified.publish?.files ?? {}) as ProjectPath[]
    if (sent.length > 0) {
      await assertHoldsLock(this.root, nonce)
      this.enter('sending')
      await this.send(remote, sent)
    }
    await commitPush(this.root, slug, nonce)
    const received = classified.plan.filter((entry) => entry.action === 'write-remote' || entry.action === 'merge').map((entry) => entry.path)
    return { kind: 'pushed', title, sent, received }
  }

  /** The checksums Claude Design lists afterwards decide, not the publish's own answer. */
  private async send(remote: RemoteCanvas, sent: readonly ProjectPath[]): Promise<void> {
    const published = await remote.publish(OUTBOX, Object.fromEntries(sent.map((file) => [file, file])))
    this.enter('confirming')
    const landed = new Map((await remote.list()).map((file) => [file.path, file.sha256]))
    for (const file of sent) {
      const bytes = await readFile(path.join(this.path(OUTBOX), ...file.split('/')))
      if (landed.get(file) === sha256(bytes)) continue
      throw new PushError('error', published.failed ? `Claude Design refused the push: ${firstLine(published.text)}` : 'Claude Design does not hold what was sent. Push again to check.', [file])
    }
  }

  /** A pasted link may name any canvas, and merging with the wrong one would replace this project's files. */
  private async adoptLink(url: string, snapshotDir: string, files: readonly RemoteFile[]): Promise<void> {
    const base = (await readBaseJson(this.root)).files as Readonly<Record<string, string>>
    const artboards = Object.keys(base).filter((file) => ARTBOARD.test(file))
    const remote = new Set(files.map((file) => file.path))
    const hasEvery = artboards.every((file) => remote.has(file))
    const unchanged = hasEvery
      ? await Promise.all(artboards.map(async (file) => gitBlobHash(await readFile(toNativePath(snapshotDir, file as ProjectPath))) === base[file]))
      : []
    if (!unchanged.includes(true)) throw new PushError('wrongCanvas', WRONG_CANVAS)
    await saveCanvasLink(this.root, url)
    this.show({ canvas: url })
  }

  /** Images of artboards that arrived from Claude Design; without them the canvas still opens, so a failure only leaves them blank. */
  private async fetchAssets(remote: RemoteCanvas, missing: readonly string[]): Promise<void> {
    let wanted = missing
    const from = this.path(WORK_DIR, 'assets')
    try {
      for (let round = 0; wanted.length > 0 && round < MAX_ASSET_ROUNDS; round++) {
        await remote.assets(wanted, from)
        const release = (await readFile(this.path(EDITOR_FILES.cache, CURRENT_RELEASE_FILE), 'utf8')).trim()
        wanted = (await cacheFetched({ projectDir: this.root, from, release })).missing
      }
    } catch (error) {
      if (this.cancelled) throw error
      console.warn(`push: some images were not fetched: ${(error as Error).message}`)
    }
  }

  private path(...parts: string[]): string {
    return path.join(this.root, ...parts.flatMap((part) => part.split('/')))
  }

  /** In a file, since command-line arguments are visible to every process of every user. */
  private async writeSettings(guard: PushGuard): Promise<string> {
    const hook = { type: 'http', url: this.guardUrl, headers: { [GUARD_HEADER]: guard.secret }, timeout: GUARD_TIMEOUT_S }
    const settings = { hooks: { PreToolUse: [{ matcher: '*', hooks: [hook] }] } }
    const file = this.path(WORK_DIR, 'settings.json')
    await mkdir(path.dirname(file), { recursive: true })
    await atomicWrite(file, Buffer.from(JSON.stringify(settings)), { mode: OWNER_ONLY })
    return file
  }
}

function blocked({ blocking }: ClassifiedPush): PushError {
  const conflicts = blocking.filter((entry) => entry.action === 'conflict').map((entry) => entry.path)
  if (conflicts.length > 0) return new PushError('conflict', CONFLICT, conflicts)
  return new PushError('artboards', ARTBOARDS, blocking.map((entry) => entry.path))
}

function failure(error: unknown): PushOutcome {
  if (error instanceof PushError) return { kind: 'failed', reason: error.reason, message: error.message, files: error.files as readonly ProjectPath[] }
  return { kind: 'failed', reason: 'error', message: error instanceof Error ? error.message : String(error), files: [] }
}
