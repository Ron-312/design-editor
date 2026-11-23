import type { ProjectPath } from './types'

export const EDSYNC_VERBS = [
  'ingest',
  'lock',
  'classify',
  'merge',
  'check',
  'commit',
  'unlock',
  'shots',
  'rewrite-blobs',
  'cache',
] as const

export type EdsyncVerb = (typeof EDSYNC_VERBS)[number]

/** `git merge-file --diff-algorithm` first shipped in 2.44; there is no Myers fallback. */
export const MIN_GIT_VERSION = [2, 44] as const

export const CANVAS_JSON = 'project/canvas.json' as ProjectPath

export const LEASE = {
  editorMs: 60_000,
  editorRenewMs: 20_000,
  cliMs: 15 * 60_000,
  pushBeginTimeoutMs: 5_000,
  askUnlockAfterMs: 30 * 60_000,
} as const

/** `.editor/push.lock`, created exclusively. Stale only once `expiresAt` has passed; `pid` is a hint. */
export interface PushLock {
  readonly nonce: string
  readonly holder: 'editor' | 'edsync'
  readonly pid: number
  readonly startedAt: number
  readonly expiresAt: number
}

/** `.editor/base.json`: per-file git blob hashes of the last synced commit. */
export interface BaseJson {
  readonly commit: string
  readonly files: Readonly<Record<ProjectPath, string>>
}

export type FileAction = 'unchanged' | 'upload' | 'write-remote' | 'merge' | 'conflict' | 'stop'

export type ConflictCause = 'both-changed' | 'edit-vs-remove' | 'shape-check'

export type StopCause = 'local-artboard-added' | 'local-artboard-removed'

export type FileClassification =
  | { readonly path: ProjectPath; readonly action: 'unchanged' | 'upload' | 'write-remote' | 'merge' }
  | { readonly path: ProjectPath; readonly action: 'conflict'; readonly cause: ConflictCause; readonly hunks: string }
  | { readonly path: ProjectPath; readonly action: 'stop'; readonly cause: StopCause }

/** The one Artifact publish a push makes: keys are `project/<path>`, `root` is `projects/<slug>`. */
export interface PublishRequest {
  readonly root: string
  readonly files: Readonly<Record<string, string>>
}

/** `edsync classify` stdout. `publish` is null when nothing is to be sent or the push must stop. */
export interface ClassifyOutput {
  readonly plan: readonly FileClassification[]
  readonly publish: PublishRequest | null
  /** Remote-only files to write whose `/_blob` ids are not cached yet. */
  readonly missingBlobs: readonly string[]
}

/** `edsync ingest` stdout: what the skill must fetch next into the scratchpad for `edsync cache`. */
export interface IngestOutput {
  readonly slug: string
  readonly blobIds: readonly string[]
  readonly supportJs: boolean
}

/** `edsync cache` stdout; the skill fetches `missing` and re-runs until it is empty. */
export interface CacheOutput {
  readonly copied: readonly string[]
  readonly missing: readonly string[]
}

/** `git merge-file` exit: 0 clean, positive = conflict count (truncated to 127), negative = error. */
export type MergeOutcome =
  | { readonly kind: 'clean'; readonly merged: string }
  | { readonly kind: 'conflict'; readonly conflicts: number; readonly hunks: string }
  | { readonly kind: 'error'; readonly exitCode: number; readonly message: string }
