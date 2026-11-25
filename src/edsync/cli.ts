import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { ensureSupportedGit } from '../core/git'
import { acquirePushLock, readPushLock, releasePushLock } from '../core/push-lock'
import { EDITOR_FILES, HTTP_ROUTES, LOOPBACK_HOST, TOKEN_HEADER, type PushBeginRequest, type PushBeginResponse, type ServerInfo } from '../shared/protocol'
import { canvasLink } from '../shared/push'
import { EDSYNC_VERBS, LEASE, type ClassifyOutput, type EdsyncVerb, type FileClassification, type MergeOutcome, type PushLock } from '../shared/sync'
import { cacheFetched, rewriteBlobs } from './cache'
import { saveCanvasLink } from './canvas-link'
import { classifyProject } from './classify'
import { ingest } from './ingest'
import { hasClosedBlocks, mergeThreeWay } from './merge'
import { assertHoldsLock, classifyPush, commitPush } from './push-steps'
import { applyLocalWrites, recordSync, storeSynced } from './sync-commit'

export interface EdsyncRun {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

interface VerbResult {
  readonly exitCode: number
  readonly output?: unknown
  readonly message?: string
}

type Flags = Readonly<Record<string, string | undefined>>

const EXIT = { ok: 0, failed: 1, stopped: 2 } as const
const PROJECTS_FOLDER = 'projects'
const ARTBOARDS_MESSAGE = 'add/remove artboards in Claude Design'
const FLAG_NAMES = ['slug', 'remote-dir', 'from', 'release', 'map', 'nonce', 'ours', 'base', 'theirs', 'file', 'url'] as const
const HEALTH_TIMEOUT_MS = 2_000

function isVerb(verb: string | undefined): verb is EdsyncVerb {
  return (EDSYNC_VERBS as readonly string[]).includes(verb ?? '')
}

function flagsOf(args: readonly string[]): Flags {
  const options = Object.fromEntries(FLAG_NAMES.map((name) => [name, { type: 'string' as const }]))
  return parseArgs({ args: [...args], options, strict: true }).values as Flags
}

function required(flags: Flags, name: (typeof FLAG_NAMES)[number]): string {
  const value = flags[name]
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function ok(output?: unknown): VerbResult {
  return { exitCode: EXIT.ok, output }
}

function projectDirOf(flags: Flags, cwd: string): string {
  return path.join(cwd, PROJECTS_FOLDER, required(flags, 'slug'))
}

function pathFlag(flags: Flags, name: (typeof FLAG_NAMES)[number], cwd: string): string {
  return path.resolve(cwd, required(flags, name))
}

// ── the running editor ────────────────────────────────────────────────────────

async function serverInfoOf(projectDir: string): Promise<ServerInfo | null> {
  try {
    return JSON.parse(await readFile(path.join(projectDir, ...EDITOR_FILES.server.split('/')), 'utf8')) as ServerInfo
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function callEditor(editor: ServerInfo, route: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(`http://${LOOPBACK_HOST}:${editor.port}${route}`, {
    ...init,
    headers: { [TOKEN_HEADER]: editor.token, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/** server.json outlives a crashed editor, so only an answer to GET /health counts as running. */
async function runningEditor(projectDir: string): Promise<ServerInfo | null> {
  const editor = await serverInfoOf(projectDir)
  if (!editor) return null
  try {
    return (await callEditor(editor, HTTP_ROUTES.health, { method: 'GET' }, HEALTH_TIMEOUT_MS)).ok ? editor : null
  } catch {
    return null
  }
}

/** The nonce is ours, so when the editor is too slow to answer, ending the push under it cancels the begin it is still running. */
async function lockThroughEditor(editor: ServerInfo): Promise<Pick<PushLock, 'nonce' | 'holder'>> {
  const request: PushBeginRequest = { nonce: randomUUID() }
  let response: Response
  try {
    response = await callEditor(editor, HTTP_ROUTES.pushBegin, { method: 'POST', body: JSON.stringify(request) }, LEASE.pushBeginTimeoutMs)
  } catch (error) {
    if ((error as Error).name !== 'TimeoutError') throw error
    await unlockThroughEditor(editor, request.nonce!).catch(() => undefined)
    throw new Error(`The editor did not flush its edits within ${LEASE.pushBeginTimeoutMs / 1000} s: retry /design-push.`, { cause: error })
  }
  if (!response.ok) throw new Error(`The editor refused the push lock: ${await response.text()}`)
  return { nonce: ((await response.json()) as PushBeginResponse).nonce, holder: 'editor' }
}

async function unlockThroughEditor(editor: ServerInfo, nonce: string): Promise<void> {
  const response = await callEditor(editor, HTTP_ROUTES.pushEnd, { method: 'POST', body: JSON.stringify({ nonce }) }, LEASE.pushBeginTimeoutMs)
  if (!response.ok) throw new Error(`The editor kept the push lock: ${await response.text()}`)
}

// ── verbs ─────────────────────────────────────────────────────────────────────

/**
 * Push step 1: the editor takes the lock when one answers, so it flushes first and renews the lease itself.
 * With `--nonce` it takes nothing and only re-checks that the push still holds the lock, the guard right before the publish.
 */
async function lock(flags: Flags, cwd: string): Promise<VerbResult> {
  const projectDir = projectDirOf(flags, cwd)
  const held = flags.nonce
  if (held) {
    await assertHoldsLock(projectDir, held)
    return ok({ nonce: held, held: true })
  }
  const editor = await runningEditor(projectDir)
  if (editor) return ok(await lockThroughEditor(editor))
  const taken = await acquirePushLock(projectDir, { holder: 'edsync', leaseMs: LEASE.cliMs })
  if (!taken) throw new Error('push.lock is held by another push: wait for it to finish, then re-run /design-push.')
  return ok({ nonce: taken.nonce, holder: taken.holder })
}

/** Nobody deletes a lock whose nonce is not theirs. */
async function unlock(flags: Flags, cwd: string): Promise<VerbResult> {
  const projectDir = projectDirOf(flags, cwd)
  const nonce = required(flags, 'nonce')
  const held = await readPushLock(projectDir)
  if (!held) return ok({ released: false })
  if (held.nonce !== nonce) throw new Error('push.lock carries another push’s nonce: it was left in place.')
  const editor = held.holder === 'editor' ? await runningEditor(projectDir) : null
  if (editor) await unlockThroughEditor(editor, nonce)
  else await releasePushLock(projectDir, nonce)
  return ok({ released: true })
}

function stopMessage(entries: readonly FileClassification[]): string {
  const stops = entries.filter((entry) => entry.action === 'stop').map((entry) => entry.path)
  const conflicts = entries.filter((entry) => entry.action === 'conflict').map((entry) => entry.path)
  const lines = ['The push stopped and nothing was sent.']
  if (stops.length > 0) lines.push(`${ARTBOARDS_MESSAGE}, then re-run /design-push: ${stops.join(', ')}`)
  if (conflicts.length > 0) {
    lines.push(`Changed on both sides; keep Claude Design's, keep the editor's or edit by hand, then re-run /design-push: ${conflicts.join(', ')}`)
  }
  return lines.join('\n')
}

async function classify(flags: Flags, cwd: string): Promise<VerbResult> {
  const slug = required(flags, 'slug')
  const projectDir = projectDirOf(flags, cwd)
  const nonce = required(flags, 'nonce')
  const { plan, blocking, publish, missingBlobs } = await classifyPush({ projectDir, slug, remoteDir: pathFlag(flags, 'remote-dir', cwd), nonce })
  const output: ClassifyOutput = { plan, publish, missingBlobs }
  return blocking.length > 0 ? { exitCode: EXIT.stopped, output, message: stopMessage(blocking) } : ok(output)
}

async function commit(flags: Flags, cwd: string): Promise<VerbResult> {
  const slug = required(flags, 'slug')
  return ok({ commit: await commitPush(projectDirOf(flags, cwd), slug, required(flags, 'nonce')) })
}

/** A refresh is a push with nothing to upload: a synced project can only hold remote-only changes. */
async function refreshFromRemote(projectDir: string, remoteDir: string, slug: string): Promise<void> {
  const classification = await classifyProject(projectDir, remoteDir)
  await applyLocalWrites(projectDir, classification.outcomes)
  const tree = await storeSynced(projectDir, classification.outcomes)
  await recordSync(projectDir, { baseCommit: classification.baseCommit, tree }, `Refreshed ${slug} from Claude Design`)
}

/** Pull steps 1-4; on an existing project ingest refuses unless it is synced, and then reports the refreshed files. */
async function ingestVerb(flags: Flags, cwd: string): Promise<VerbResult> {
  const options = { remoteDir: pathFlag(flags, 'remote-dir', cwd), slug: required(flags, 'slug'), projectsDir: path.join(cwd, PROJECTS_FOLDER) }
  const projectDir = projectDirOf(flags, cwd)
  const link = canvasLink(flags.url ?? '')
  if (flags.url && !link) throw new Error(`--url must be a claude.ai artifact link, not ${JSON.stringify(flags.url)}`)
  const isRefresh = existsSync(path.join(projectDir, '.git'))
  const fetchList = await ingest(options)
  if (link) await saveCanvasLink(projectDir, link)
  if (!isRefresh) return ok(fetchList)
  await refreshFromRemote(projectDir, options.remoteDir, options.slug)
  return ok(await ingest(options))
}

async function cache(flags: Flags, cwd: string): Promise<VerbResult> {
  return ok(await cacheFetched({ projectDir: projectDirOf(flags, cwd), from: pathFlag(flags, 'from', cwd), release: required(flags, 'release') }))
}

async function rewriteBlobsVerb(flags: Flags, cwd: string): Promise<VerbResult> {
  await rewriteBlobs({ projectDir: projectDirOf(flags, cwd), mapFile: pathFlag(flags, 'map', cwd) })
  return ok()
}

async function merge(flags: Flags, cwd: string): Promise<VerbResult> {
  const paths = (['ours', 'base', 'theirs'] as const).map((name) => pathFlag(flags, name, cwd))
  const [ours, base, theirs] = await Promise.all(paths.map((file) => readFile(file)))
  const result = await mergeThreeWay({ ours: ours!, base: base!, theirs: theirs! }, required(flags, 'ours'))
  const output: MergeOutcome = result.kind === 'clean' ? { kind: 'clean', merged: result.merged.toString('utf8') } : result
  return { exitCode: result.kind === 'clean' ? EXIT.ok : EXIT.stopped, output }
}

async function check(flags: Flags, cwd: string): Promise<VerbResult> {
  const intact = hasClosedBlocks(await readFile(pathFlag(flags, 'file', cwd)))
  return { exitCode: intact ? EXIT.ok : EXIT.stopped, output: { file: required(flags, 'file'), intact } }
}

async function shots(): Promise<VerbResult> {
  return { exitCode: EXIT.failed, message: 'edsync shots is not available in v1: it comes with the visual diff in M7.' }
}

const VERBS: Readonly<Record<EdsyncVerb, (flags: Flags, cwd: string) => Promise<VerbResult>>> = {
  ingest: ingestVerb,
  lock,
  classify,
  merge,
  check,
  commit,
  unlock,
  shots,
  'rewrite-blobs': rewriteBlobsVerb,
  cache,
}

function printed(result: VerbResult): EdsyncRun {
  return {
    exitCode: result.exitCode,
    stdout: result.output === undefined ? '' : `${JSON.stringify(result.output, null, 2)}\n`,
    stderr: result.message ? `${result.message}\n` : '',
  }
}

/** `node tools/edsync.mjs <verb>`: Git is checked before any verb touches a file. */
export async function runEdsync(argv: readonly string[], options: { cwd: string }): Promise<EdsyncRun> {
  const [verb, ...args] = argv
  if (!isVerb(verb)) return printed({ exitCode: EXIT.failed, message: `Unknown verb "${verb ?? ''}"; expected one of ${EDSYNC_VERBS.join(', ')}.` })
  try {
    await ensureSupportedGit()
    return printed(await VERBS[verb](flagsOf(args), options.cwd))
  } catch (error) {
    return printed({ exitCode: EXIT.failed, message: error instanceof Error ? error.message : String(error) })
  }
}
