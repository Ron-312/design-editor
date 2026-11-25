import { readPushLock } from '../core/push-lock'
import type { FileClassification, PublishRequest } from '../shared/sync'
import { blockingEntries, classifyProject, missingBlobs } from './classify'
import { applyLocalWrites, clearPendingSync, loadPendingSync, recordSync, savePendingSync, stageOutbox, storeSynced } from './sync-commit'

export interface ClassifiedPush {
  readonly plan: readonly FileClassification[]
  /** Conflicts and stops; when there are any, nothing was written and nothing may be sent. */
  readonly blocking: readonly FileClassification[]
  readonly publish: PublishRequest | null
  readonly missingBlobs: readonly string[]
}

export async function assertHoldsLock(projectDir: string, nonce: string): Promise<void> {
  if ((await readPushLock(projectDir))?.nonce === nonce) return
  throw new Error('push.lock is gone or belongs to another push: nothing was written or sent. Re-run /design-push.')
}

/** Push steps 3-4: writes remote-only and merged bytes, stages the one publish and the commit that follows it. */
export async function classifyPush(options: { projectDir: string; slug: string; remoteDir: string; nonce: string }): Promise<ClassifiedPush> {
  const { projectDir, nonce } = options
  await assertHoldsLock(projectDir, nonce)
  const classification = await classifyProject(projectDir, options.remoteDir)
  const plan = classification.outcomes.map((outcome) => outcome.entry)
  const blocking = blockingEntries(classification)
  if (blocking.length > 0) return { plan, blocking, publish: null, missingBlobs: [] }
  await assertHoldsLock(projectDir, nonce)
  await applyLocalWrites(projectDir, classification.outcomes)
  const publish = await stageOutbox(projectDir, options.slug, classification.outcomes)
  const tree = await storeSynced(projectDir, classification.outcomes)
  await savePendingSync(projectDir, { nonce, baseCommit: classification.baseCommit, tree })
  return { plan, blocking, publish, missingBlobs: await missingBlobs(projectDir, classification) }
}

/** Push step 5 runs once the publish succeeded, so it needs the classified push, not a live lease. */
export async function commitPush(projectDir: string, slug: string, nonce: string): Promise<string> {
  const pending = await loadPendingSync(projectDir, nonce)
  const synced = await recordSync(projectDir, pending, `Pushed ${slug} to Claude Design`)
  await clearPendingSync(projectDir)
  return synced
}
