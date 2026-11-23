import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { watch } from 'chokidar'
import { retryWhileLocked } from '../../core/atomic-write'
import { toProjectPath } from '../../shared/paths'
import type { ProjectPath } from '../../shared/types'
import { contentHash } from '../edit/writer'

export interface WatchOptions {
  /** The git root that holds project/, .editor/ and .git/. */
  readonly root: string
  /** The hash of the bytes the editor last read or wrote, if it has the file open. */
  readonly knownHash: (file: ProjectPath) => string | undefined
  readonly onOutsideChange: (file: ProjectPath) => void
  readonly onWarning: (message: string) => void
}

export interface ProjectWatcher {
  close(): Promise<void>
}

const EDITOR_ONLY_DIRS = new Set(['.editor', '.git'])
const SYNCED_FOLDERS = ['OneDrive', 'Dropbox']

function isEditorOnly(root: string, file: string): boolean {
  const [first] = path.relative(root, file).split(path.sep)
  return EDITOR_ONLY_DIRS.has(first ?? '')
}

function syncedFolderOf(root: string): string | undefined {
  const segments = path.resolve(root).toLowerCase().split(path.sep)
  return SYNCED_FOLDERS.find((folder) => segments.some((segment) => segment.startsWith(folder.toLowerCase())))
}

/** A temp file renamed over its target is gone by the time it is read; that is not a change to report. */
async function readIfPresent(file: string): Promise<Buffer | null> {
  try {
    return await retryWhileLocked(() => readFile(file))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Reports project files whose bytes differ from what the editor knows; the filter is by content hash, never timing. */
export async function watchProject(options: WatchOptions): Promise<ProjectWatcher> {
  const { root, knownHash, onOutsideChange, onWarning } = options
  const synced = syncedFolderOf(root)
  if (synced) onWarning(`${root} is in a ${synced} folder, which can hold files and drop change events; set CHOKIDAR_USEPOLLING=1 if outside edits do not show`)

  const watcher = watch(root, { atomic: true, ignored: (file: string) => isEditorOnly(root, file) })
  // fs.watch can replay writes made just before it started, so each file's last seen hash is the baseline too.
  const lastSeen = new Map<ProjectPath, string>()
  const baseline: Promise<void>[] = []
  let started = false

  const record = async (nativeFile: string, report: boolean) => {
    const bytes = await readIfPresent(nativeFile)
    if (!bytes) return
    const file = toProjectPath(root, nativeFile)
    const hash = contentHash(bytes)
    const unchanged = hash === lastSeen.get(file) || hash === knownHash(file)
    lastSeen.set(file, hash)
    if (report && !unchanged) onOutsideChange(file)
  }
  const onFileEvent = (nativeFile: string) => {
    const recorded = record(nativeFile, started).catch((error: Error) => onWarning(`could not read ${nativeFile}: ${error.message}`))
    if (!started) baseline.push(recorded)
  }

  watcher.on('add', onFileEvent).on('change', onFileEvent)
  watcher.on('error', (error) => {
    // Windows raises EPERM when a watched directory's handle goes away; watching it again recovers.
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return void watcher.unwatch(root).add(root)
    onWarning(`file watcher: ${(error as Error).message}`)
  })
  await new Promise<void>((resolve) => watcher.once('ready', resolve))
  await Promise.all(baseline)
  started = true
  return { close: () => watcher.close() }
}
