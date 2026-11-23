import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { SUPPORT_JS } from '../../shared/protocol'

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

/** `.editor/cache/` as `edsync cache` fills it: blobs stored as `<id>.<ext>`, plus the runtime's `support.js`. */
export class BlobCache {
  constructor(private readonly cacheDir: string) {}

  async blob(id: string): Promise<CachedFile | null> {
    if (!BLOB_ID.test(id)) return null
    const name = (await this.names()).find((candidate) => isBlobFileOf(id, candidate))
    return name ? this.read(name) : null
  }

  async supportJs(): Promise<CachedFile | null> {
    return (await this.names()).includes(SUPPORT_JS) ? this.read(SUPPORT_JS) : null
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
