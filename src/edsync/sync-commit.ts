import { mkdir, readFile, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite, retryWhileLocked } from '../core/atomic-write'
import { gitOutput } from '../core/git'
import { toNativePath } from '../shared/paths'
import { EDITOR_FILES } from '../shared/protocol'
import type { BaseJson, PublishRequest } from '../shared/sync'
import type { ProjectPath } from '../shared/types'
import type { FileOutcome } from './classify'

/** Blob id per file that the sync changes from the base; null removes the file. */
export type SyncTree = Readonly<Record<ProjectPath, string | null>>

/** What `edsync classify` hands `edsync commit`: the tree it sent and wrote, on top of the base it read. */
export interface PendingSync {
  readonly nonce: string
  readonly baseCommit: string
  readonly tree: SyncTree
}

const OUTBOX = '.editor/outbox'
const PENDING_SYNC = '.editor/pending-sync.json'
const FILE_MODE = '100644'

function editorFile(projectDir: string, editorPath: string): string {
  return path.join(projectDir, ...editorPath.split('/'))
}

export async function readBaseJson(projectDir: string): Promise<BaseJson> {
  return JSON.parse(await readFile(editorFile(projectDir, EDITOR_FILES.base), 'utf8')) as BaseJson
}

async function headBlobHashes(projectDir: string): Promise<Record<ProjectPath, string>> {
  const listing = await gitOutput(['ls-tree', '-r', '-z', 'HEAD'], { cwd: projectDir })
  const hashes: Record<ProjectPath, string> = {}
  for (const entry of listing.split('\0').filter(Boolean)) {
    const [meta = '', file = ''] = entry.split('\t')
    hashes[file as ProjectPath] = meta.split(' ')[2] ?? ''
  }
  return hashes
}

async function writeBaseJson(projectDir: string, commit: string): Promise<void> {
  const base: BaseJson = { commit, files: await headBlobHashes(projectDir) }
  await atomicWrite(editorFile(projectDir, EDITOR_FILES.base), Buffer.from(`${JSON.stringify(base, null, 2)}\n`))
}

async function headCommit(projectDir: string): Promise<string> {
  return (await gitOutput(['rev-parse', 'HEAD'], { cwd: projectDir })).trim()
}

/** Remote-only and merged bytes land in `projects/<slug>/`; the editor reconciles them on `/push/end`. */
export async function applyLocalWrites(projectDir: string, outcomes: readonly FileOutcome[]): Promise<void> {
  for (const outcome of outcomes.filter((each) => each.writeLocal)) {
    const file = toNativePath(projectDir, outcome.entry.path)
    if (outcome.synced === null) {
      await retryWhileLocked(() => unlink(file))
      continue
    }
    await mkdir(path.dirname(file), { recursive: true })
    await atomicWrite(file, outcome.synced)
  }
}

function outboxFileOf(projectDir: string, file: ProjectPath): string {
  return toNativePath(editorFile(projectDir, OUTBOX), file)
}

/** The publish reads a copy, so what is sent is what classify hashed, whatever the working file does next. */
export async function stageOutbox(projectDir: string, slug: string, outcomes: readonly FileOutcome[]): Promise<PublishRequest | null> {
  await rm(editorFile(projectDir, OUTBOX), { recursive: true, force: true })
  const sent = outcomes.filter((outcome) => outcome.send)
  if (sent.length === 0) return null
  const files: Record<string, string> = {}
  for (const outcome of sent) {
    const file = outboxFileOf(projectDir, outcome.entry.path)
    await mkdir(path.dirname(file), { recursive: true })
    await atomicWrite(file, outcome.synced!)
    files[outcome.entry.path] = `${OUTBOX}/${outcome.entry.path}`
  }
  return { root: `projects/${slug}`, files }
}

function syncedSourceOf(projectDir: string, outcome: FileOutcome): string {
  return outcome.send ? outboxFileOf(projectDir, outcome.entry.path) : toNativePath(projectDir, outcome.entry.path)
}

/** Writes the synced bytes into the object store, from the outbox for sent files and the working tree otherwise. */
export async function storeSynced(projectDir: string, outcomes: readonly FileOutcome[]): Promise<SyncTree> {
  const changed = outcomes.filter((outcome) => outcome.changedFromBase)
  const stored = changed.filter((outcome) => outcome.synced !== null)
  const tree: Record<ProjectPath, string | null> = {}
  for (const outcome of changed) tree[outcome.entry.path] = null
  if (stored.length === 0) return tree
  const sources = stored.map((outcome) => syncedSourceOf(projectDir, outcome))
  const ids = (await gitOutput(['hash-object', '-w', '--no-filters', '--', ...sources], { cwd: projectDir })).trim().split('\n')
  stored.forEach((outcome, index) => (tree[outcome.entry.path] = ids[index]!))
  return tree
}

export async function savePendingSync(projectDir: string, pending: PendingSync): Promise<void> {
  await atomicWrite(editorFile(projectDir, PENDING_SYNC), Buffer.from(JSON.stringify(pending)))
}

export async function loadPendingSync(projectDir: string, nonce: string): Promise<PendingSync> {
  let pending: PendingSync
  try {
    pending = JSON.parse(await readFile(editorFile(projectDir, PENDING_SYNC), 'utf8')) as PendingSync
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Nothing to commit: run edsync classify first.', { cause: error })
    throw error
  }
  if (pending.nonce !== nonce) throw new Error('The classified push belongs to another lock: re-run /design-push.')
  return pending
}

export async function clearPendingSync(projectDir: string): Promise<void> {
  await rm(editorFile(projectDir, PENDING_SYNC), { force: true })
  await rm(editorFile(projectDir, OUTBOX), { recursive: true, force: true })
}

async function stageTree(projectDir: string, baseCommit: string, tree: SyncTree): Promise<void> {
  const cwd = { cwd: projectDir }
  const entries = Object.entries(tree) as [ProjectPath, string | null][]
  const added = entries.filter(([, id]) => id !== null).flatMap(([file, id]) => ['--cacheinfo', `${FILE_MODE},${id},${file}`])
  const removed = entries.filter(([, id]) => id === null).map(([file]) => file)
  await gitOutput(['read-tree', baseCommit], cwd)
  if (added.length > 0) await gitOutput(['update-index', '--add', ...added], cwd)
  if (removed.length > 0) await gitOutput(['update-index', '--force-remove', '--', ...removed], cwd)
}

/**
 * Push step 5: commits the synced tree built from the stored bytes, not the working tree, and rewrites
 * base.json from that commit. Returns the synced commit, unchanged when nothing differs from the base.
 */
export async function recordSync(projectDir: string, pending: Omit<PendingSync, 'nonce'>, message: string): Promise<string> {
  const head = await headCommit(projectDir)
  if (head !== pending.baseCommit) throw new Error(`The synced commit moved to ${head} since classify: re-run /design-push.`)
  if (Object.keys(pending.tree).length === 0) return head
  await stageTree(projectDir, pending.baseCommit, pending.tree)
  await gitOutput(['commit', '-q', '--no-verify', '-m', message], { cwd: projectDir })
  const commit = await headCommit(projectDir)
  await writeBaseJson(projectDir, commit)
  return commit
}
