import { existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from '../core/atomic-write'
import { gitOutput } from '../core/git'
import { isPortablePath, toNativePath, toProjectPath } from '../shared/paths'
import { EDITOR_FILES } from '../shared/protocol'
import type { BaseJson, IngestOutput } from '../shared/sync'
import type { ProjectPath } from '../shared/types'
import { blobReferences } from './cache'

export interface IngestOptions {
  readonly remoteDir: string
  readonly slug: string
  readonly projectsDir: string
}

const PROJECT_FOLDER = 'project'
const EDITOR_FOLDER = '.editor/'
const SUPPORT_JS_REFERENCE = './support.js'
const LOCAL_CONFIG = [
  ['core.autocrlf', 'false'],
  ['core.safecrlf', 'false'],
  ['core.longpaths', 'true'],
] as const

async function projectFilesIn(root: string): Promise<ProjectPath[]> {
  const entries = await readdir(path.join(root, PROJECT_FOLDER), { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => toProjectPath(root, path.join(entry.parentPath, entry.name)))
}

function assertPortable(files: readonly ProjectPath[]): void {
  const unportable = files.filter((file) => !isPortablePath(file))
  if (unportable.length > 0) throw new Error(`Cannot pull file names Windows cannot hold: ${unportable.join(', ')}`)
}

async function placeFiles(remoteDir: string, projectDir: string, files: readonly ProjectPath[]): Promise<void> {
  for (const file of files) {
    const destination = toNativePath(projectDir, file)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, await readFile(toNativePath(remoteDir, file)))
  }
}

/** Repo-local settings, so git never converts a project byte whatever the user's global config says (R11 #3). */
async function initRepository(projectDir: string): Promise<void> {
  const cwd = { cwd: projectDir }
  await gitOutput(['init', '-q'], cwd)
  for (const [key, value] of LOCAL_CONFIG) await gitOutput(['config', '--local', key, value], cwd)
  const infoDir = path.join(projectDir, '.git', 'info')
  await mkdir(infoDir, { recursive: true })
  await writeFile(path.join(infoDir, 'attributes'), '* -text\n')
  await appendFile(path.join(infoDir, 'exclude'), `${EDITOR_FOLDER}\n`)
}

async function commitBaseline(projectDir: string, slug: string): Promise<void> {
  const cwd = { cwd: projectDir }
  await gitOutput(['add', '-A'], cwd)
  await gitOutput(['commit', '-q', '-m', `Pulled ${slug} from Claude Design`], cwd)
}

function baseJsonFile(projectDir: string): string {
  return path.join(projectDir, ...EDITOR_FILES.base.split('/'))
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

async function writeBaseJson(projectDir: string): Promise<void> {
  const commit = (await gitOutput(['rev-parse', 'HEAD'], { cwd: projectDir })).trim()
  const base: BaseJson = { commit, files: await headBlobHashes(projectDir) }
  const file = baseJsonFile(projectDir)
  await mkdir(path.dirname(file), { recursive: true })
  await atomicWrite(file, Buffer.from(`${JSON.stringify(base, null, 2)}\n`))
}

async function isSynced(projectDir: string): Promise<boolean> {
  const cwd = { cwd: projectDir }
  const status = await gitOutput(['status', '--porcelain', '--untracked-files=all'], cwd)
  if (status !== '') return false
  const base = JSON.parse(await readFile(baseJsonFile(projectDir), 'utf8')) as BaseJson
  return (await gitOutput(['rev-parse', 'HEAD'], cwd)).trim() === base.commit
}

/** A pull cannot overwrite or reset the baseline under unpushed edits, like `git pull` on a dirty tree. */
async function assertSynced(projectDir: string, slug: string): Promise<void> {
  if (await isSynced(projectDir)) return
  throw new Error(`projects/${slug} has changes that are not synced: run /design-push first.`)
}

async function fetchList(projectDir: string, slug: string): Promise<IngestOutput> {
  const blobIds = new Set<string>()
  let supportJs = false
  for (const file of await projectFilesIn(projectDir)) {
    const text = await readFile(toNativePath(projectDir, file), 'utf8')
    for (const id of blobReferences(text)) blobIds.add(id)
    supportJs ||= text.includes(SUPPORT_JS_REFERENCE)
  }
  return { slug, blobIds: [...blobIds], supportJs }
}

async function ingestFresh(options: IngestOptions, projectDir: string): Promise<void> {
  const files = await projectFilesIn(options.remoteDir)
  assertPortable(files)
  await placeFiles(options.remoteDir, projectDir, files)
  await initRepository(projectDir)
  await commitBaseline(projectDir, options.slug)
  await writeBaseJson(projectDir)
}

/**
 * Pull steps 1-4 (`edsync ingest`). An existing project is never re-initialised: it must be synced,
 * and remote changes reach it through classify, merge and commit.
 */
export async function ingest(options: IngestOptions): Promise<IngestOutput> {
  const projectDir = path.join(options.projectsDir, options.slug)
  if (!existsSync(path.join(projectDir, '.git'))) await ingestFresh(options, projectDir)
  else await assertSynced(projectDir, options.slug)
  return fetchList(projectDir, options.slug)
}
