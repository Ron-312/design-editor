import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { gitBlobBytes } from '../core/git'
import { toProjectPath } from '../shared/paths'
import { CANVAS_JSON, type ConflictCause, type FileClassification, type StopCause } from '../shared/sync'
import type { ProjectPath } from '../shared/types'
import { blobReferences, cacheDirOf } from './cache'
import { keepsBlocksIntact, mergeThreeWay } from './merge'
import { readBaseJson } from './sync-commit'

export interface FileOutcome {
  readonly entry: FileClassification
  /** What both sides hold once the push lands; null when the file is gone from both. */
  readonly synced: Buffer | null
  readonly writeLocal: boolean
  readonly send: boolean
  readonly changedFromBase: boolean
}

export interface Classification {
  readonly baseCommit: string
  readonly outcomes: readonly FileOutcome[]
}

interface Sides {
  readonly base: string | undefined
  readonly local: Buffer | undefined
  readonly remote: Buffer | undefined
}

const PROJECT_FOLDER = 'project'
const CACHED_BLOB = /^([0-9a-f]{32})(\.[A-Za-z0-9]+)?$/

/** The id `git hash-object` gives these bytes, so it compares with base.json's ls-tree hashes. */
function gitBlobHash(bytes: Buffer | undefined): string | undefined {
  return bytes && createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

async function projectFilesIn(root: string): Promise<Map<ProjectPath, Buffer>> {
  const entries = await readdir(path.join(root, PROJECT_FOLDER), { recursive: true, withFileTypes: true })
  const files = new Map<ProjectPath, Buffer>()
  for (const entry of entries.filter((each) => each.isFile())) {
    const file = path.join(entry.parentPath, entry.name)
    files.set(toProjectPath(root, file), await readFile(file))
  }
  return files
}

function settled(entry: FileClassification, sides: Sides, synced: Buffer | undefined, moves: { writeLocal?: true; send?: true } = {}): FileOutcome {
  return {
    entry,
    synced: synced ?? null,
    writeLocal: moves.writeLocal ?? false,
    send: moves.send ?? false,
    changedFromBase: gitBlobHash(synced) !== sides.base,
  }
}

function blocked(entry: FileClassification): FileOutcome {
  return { entry, synced: null, writeLocal: false, send: false, changedFromBase: false }
}

function conflict(file: ProjectPath, cause: ConflictCause, hunks = ''): FileOutcome {
  return blocked({ path: file, action: 'conflict', cause, hunks })
}

function stopped(file: ProjectPath, cause: StopCause): FileOutcome {
  return blocked({ path: file, action: 'stop', cause })
}

/** The editor has no add/remove op and never writes canvas.json, so a local add or remove cannot follow its entry. */
function localOnlyChange(file: ProjectPath, sides: Sides): FileOutcome {
  if (sides.base === undefined) return stopped(file, 'local-artboard-added')
  if (!sides.local) return stopped(file, 'local-artboard-removed')
  return settled({ path: file, action: 'upload' }, sides, sides.local, { send: true })
}

async function baseBytes(projectDir: string, hash: string | undefined): Promise<Buffer> {
  if (hash === undefined) return Buffer.alloc(0)
  return gitBlobBytes(hash, { cwd: projectDir })
}

async function bothChanged(projectDir: string, file: ProjectPath, sides: Sides & { local: Buffer; remote: Buffer }): Promise<FileOutcome> {
  const base = await baseBytes(projectDir, sides.base)
  const result = await mergeThreeWay({ ours: sides.local, base, theirs: sides.remote }, file)
  if (result.kind === 'conflict') return conflict(file, 'both-changed', result.hunks)
  if (!keepsBlocksIntact(result.merged, sides.local, sides.remote)) return conflict(file, 'shape-check')
  return settled({ path: file, action: 'merge' }, sides, result.merged, { writeLocal: true, send: true })
}

/** Unison's two-replica rule: a one-sided change moves across, only a both-sided change can conflict. */
async function classifyFile(projectDir: string, file: ProjectPath, sides: Sides): Promise<FileOutcome> {
  const [local, remote] = [gitBlobHash(sides.local), gitBlobHash(sides.remote)]
  if (local === remote) return settled({ path: file, action: 'unchanged' }, sides, sides.local)
  if (file === CANVAS_JSON || local === sides.base) {
    return settled({ path: file, action: 'write-remote' }, sides, sides.remote, { writeLocal: true })
  }
  if (remote === sides.base) return localOnlyChange(file, sides)
  if (!sides.local || !sides.remote) return conflict(file, 'edit-vs-remove')
  return bothChanged(projectDir, file, { ...sides, local: sides.local, remote: sides.remote })
}

/** Push steps 3-4 without side effects: every file against base.json, the remote snapshot and the working tree. */
export async function classifyProject(projectDir: string, remoteDir: string): Promise<Classification> {
  const base = await readBaseJson(projectDir)
  const [local, remote] = await Promise.all([projectFilesIn(projectDir), projectFilesIn(remoteDir)])
  const baseFiles = base.files as Readonly<Record<string, string>>
  const files = [...new Set([...Object.keys(baseFiles), ...local.keys(), ...remote.keys()])].sort() as ProjectPath[]
  const outcomes: FileOutcome[] = []
  for (const file of files) {
    outcomes.push(await classifyFile(projectDir, file, { base: baseFiles[file], local: local.get(file), remote: remote.get(file) }))
  }
  return { baseCommit: base.commit, outcomes }
}

export function blockingEntries(classification: Classification): FileClassification[] {
  return classification.outcomes.map((outcome) => outcome.entry).filter((entry) => entry.action === 'conflict' || entry.action === 'stop')
}

async function cachedBlobIds(projectDir: string): Promise<Set<string>> {
  try {
    const names = await readdir(cacheDirOf(projectDir))
    return new Set(names.flatMap((name) => CACHED_BLOB.exec(name)?.[1] ?? []))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw error
  }
}

/** Remote-only files must render with their assets, so their uncached `/_blob` ids are fetched before commit. */
export async function missingBlobs(projectDir: string, classification: Classification): Promise<string[]> {
  const cached = await cachedBlobIds(projectDir)
  const written = classification.outcomes.filter((outcome) => outcome.entry.action === 'write-remote' && outcome.synced)
  const referenced = new Set(written.flatMap((outcome) => blobReferences(outcome.synced!.toString('utf8'))))
  return [...referenced].filter((id) => !cached.has(id))
}
