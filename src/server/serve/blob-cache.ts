import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { CURRENT_RELEASE_FILE, SUPPORT_JS } from '../../shared/protocol'

export interface CachedFile {
  readonly bytes: Buffer
  readonly contentType: string
}

const BLOB_ID = /^[0-9a-f]{32}$/
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

export function contentTypeOf(fileName: string): string {
  return CONTENT_TYPES[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream'
}

function isBlobFileOf(id: string, name: string): boolean {
  return name === id || (name.startsWith(`${id}.`) && !name.slice(id.length + 1).includes('.'))
}

const SAFE_RELEASE = /^[\w][\w.+-]*$/

/** `.editor/cache/` as `edsync cache` fills it: blobs stored as `<id>.<ext>`, `support.js` under `<release>/`, the current release named in `current-release`. */
export class BlobCache {
  constructor(private readonly cacheDir: string) {}

  async blob(id: string): Promise<CachedFile | null> {
    if (!BLOB_ID.test(id)) return null
    const name = (await this.names()).find((candidate) => isBlobFileOf(id, candidate))
    return name ? this.read(name) : null
  }

  async supportJs(): Promise<CachedFile | null> {
    const release = (await this.readIfPresent(CURRENT_RELEASE_FILE))?.toString('utf8').trim()
    if (!release || !SAFE_RELEASE.test(release)) return null
    const bytes = await this.readIfPresent(path.join(release, SUPPORT_JS))
    return bytes && { bytes, contentType: contentTypeOf(SUPPORT_JS) }
  }

  private async readIfPresent(name: string): Promise<Buffer | null> {
    try {
      return await readFile(path.join(this.cacheDir, name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async names(): Promise<string[]> {
    try {
      return await readdir(this.cacheDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async read(name: string): Promise<CachedFile> {
    return { bytes: await readFile(path.join(this.cacheDir, name)), contentType: contentTypeOf(name) }
  }
}
