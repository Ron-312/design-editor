import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from '../core/atomic-write'
import { CURRENT_RELEASE_FILE, EDITOR_FILES, SUPPORT_JS } from '../shared/protocol'
import type { CacheOutput } from '../shared/sync'

const BLOB_FILE = /^([0-9a-f]{32})(\.[A-Za-z0-9]+)?$/
const BLOB_REFERENCE = /\/_blob\/([0-9a-f]{32})/g
const SCANNED_EXTENSIONS = new Set(['.css', '.js'])
const SAFE_RELEASE = /^[\w][\w.+-]*$/

export function cacheDirOf(projectDir: string): string {
  return path.join(projectDir, ...EDITOR_FILES.cache.split('/'))
}

/** Every `/_blob/<id>`, quoted or not, inside url(), an attribute or a script string. */
export function blobReferences(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(BLOB_REFERENCE), (match) => match[1]!))]
}

async function namesIn(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function copyInto(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true })
  await atomicWrite(destination, await readFile(source))
}

function cachedNameOf(name: string, release: string): { key: string; destination: string } | undefined {
  if (name === SUPPORT_JS) return { key: SUPPORT_JS, destination: path.join(release, SUPPORT_JS) }
  const blobId = BLOB_FILE.exec(name)?.[1]
  return blobId ? { key: blobId, destination: name } : undefined
}

async function copyFetched(from: string, cacheDir: string, release: string): Promise<string[]> {
  const copied: string[] = []
  for (const name of await namesIn(from)) {
    const cached = cachedNameOf(name, release)
    if (!cached) continue
    await copyInto(path.join(from, name), path.join(cacheDir, cached.destination))
    copied.push(cached.key)
  }
  return copied
}

/** Scans the whole cache, so the answer does not depend on which round fetched a stylesheet. */
async function missingReferences(cacheDir: string): Promise<string[]> {
  const blobNames = (await namesIn(cacheDir)).filter((name) => BLOB_FILE.test(name))
  const cached = new Set(blobNames.map((name) => BLOB_FILE.exec(name)![1]))
  const referenced = new Set<string>()
  for (const name of blobNames.filter((blobName) => SCANNED_EXTENSIONS.has(path.extname(blobName)))) {
    for (const id of blobReferences(await readFile(path.join(cacheDir, name), 'utf8'))) referenced.add(id)
  }
  return [...referenced].filter((id) => !cached.has(id))
}

/** `edsync cache --from <dir>`: copies blobs by id and support.js by type release into `.editor/cache/`, and makes that release current. */
export async function cacheFetched(options: { projectDir: string; from: string; release: string }): Promise<CacheOutput> {
  if (!SAFE_RELEASE.test(options.release)) throw new Error(`--release must be a plain version name, not ${JSON.stringify(options.release)}`)
  const cacheDir = cacheDirOf(options.projectDir)
  await mkdir(cacheDir, { recursive: true })
  const copied = await copyFetched(options.from, cacheDir, options.release)
  if (copied.includes(SUPPORT_JS)) await atomicWrite(path.join(cacheDir, CURRENT_RELEASE_FILE), Buffer.from(`${options.release}\n`))
  return { copied, missing: await missingReferences(cacheDir) }
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name))
}

/** latin1 maps each byte to one char and back, so every byte but the swapped ids survives. */
async function rewriteFile(file: string, idMap: Readonly<Record<string, string>>): Promise<void> {
  const before = (await readFile(file)).toString('latin1')
  const after = before.replace(BLOB_REFERENCE, (reference, id: string) => {
    const replacement = idMap[id]
    return replacement ? `/_blob/${replacement}` : reference
  })
  if (after !== before) await atomicWrite(file, Buffer.from(after, 'latin1'))
}

/** `edsync rewrite-blobs --map map.json`: swaps old `/_blob` ids for a copy's ids in every project file. */
export async function rewriteBlobs(options: { projectDir: string; mapFile: string }): Promise<void> {
  const idMap = JSON.parse(await readFile(options.mapFile, 'utf8')) as Record<string, string>
  for (const file of await filesUnder(path.join(options.projectDir, 'project'))) await rewriteFile(file, idMap)
}
