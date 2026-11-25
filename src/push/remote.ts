import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isPortablePath, toNativePath } from '../shared/paths'
import type { ProjectPath } from '../shared/types'
import { PushError, type CallResult, type Claude } from './claude'
import type { ArtifactInput, PushGuard } from './guard'

export interface RemoteFile {
  readonly path: string
  readonly sha256: string
}

interface SavedFile {
  readonly path: string
  readonly saved_to: string
}

export interface Snapshot {
  readonly title: string
  readonly dir: string
}

const PROJECT_PREFIX = 'project/'

type Fields = Readonly<Record<string, unknown>>

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Fields)[name] : undefined
}

function isRemoteFile(value: unknown): value is RemoteFile {
  return typeof field(value, 'path') === 'string' && typeof field(value, 'sha256') === 'string'
}

function isSavedFile(value: unknown): value is SavedFile {
  return typeof field(value, 'path') === 'string' && typeof field(value, 'saved_to') === 'string'
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function unreadable(what: string): PushError {
  return new PushError('error', `Claude Code's answer had no ${what}, so nothing was sent. A newer Claude Code may have changed its format.`)
}

/** The canvas on Claude Design, reached only through calls the guard expects one at a time. */
export class RemoteCanvas {
  constructor(
    private readonly claude: Claude,
    private readonly guard: PushGuard,
    private readonly url: string,
  ) {}

  /** Every `project/*` file with its checksum. */
  async list(): Promise<RemoteFile[]> {
    const { data } = await this.required({ action: 'list', url: this.url, scope: 'files' })
    const files = field(field(data, 'file_list'), 'files')
    if (!Array.isArray(files)) throw unreadable('file list')
    const own = files.filter(isRemoteFile).filter((file) => file.path.startsWith(PROJECT_PREFIX))
    if (own.length === 0) throw new PushError('wrongCanvas', 'That link is not a Claude Design canvas.')
    return own
  }

  /** Copies every listed file into `dir`, refusing a partial or altered set: a missing file would read as removed. */
  async snapshot(files: readonly RemoteFile[], dir: string): Promise<Snapshot> {
    const { data } = await this.required({ action: 'read', url: this.url, paths: files.map((file) => file.path) })
    const read = field(data, 'files_read')
    const saved = new Map(this.savedIn(read).map((file) => [file.path, file.saved_to]))
    await rm(dir, { recursive: true, force: true })
    for (const file of files) {
      const source = saved.get(file.path)
      const bytes = source === undefined ? null : await readFile(source)
      if (!bytes || sha256(bytes) !== file.sha256) throw new PushError('error', `${file.path} could not be read whole from Claude Design, so nothing was sent.`)
      if (!isPortablePath(file.path as ProjectPath)) throw new PushError('error', `Claude Design holds a file name this computer cannot: ${file.path}`)
      const target = toNativePath(dir, file.path as ProjectPath)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, bytes)
    }
    const title = field(read, 'title')
    return { title: typeof title === 'string' ? title : 'the canvas', dir }
  }

  /** Copies uploaded assets into `dir` under their ids, as `edsync cache` reads them. */
  async assets(ids: readonly string[], dir: string): Promise<void> {
    const { data } = await this.required({ action: 'read', url: this.url, paths: [...ids] })
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    for (const file of this.savedIn(field(data, 'files_read'))) {
      const id = ids.find((candidate) => file.path.includes(candidate))
      if (id) await writeFile(path.join(dir, `${id}${path.extname(file.saved_to)}`), await readFile(file.saved_to))
    }
  }

  /** The one publish; the caller compares checksums afterwards rather than trusting this answer. */
  publish(root: string, files: Readonly<Record<string, string>>): Promise<CallResult> {
    return this.call({ action: 'publish', url: this.url, root, files })
  }

  private savedIn(read: unknown): SavedFile[] {
    const files = field(read, 'files')
    if (!Array.isArray(files)) throw unreadable('saved files')
    return files.filter(isSavedFile)
  }

  private async required(input: ArtifactInput): Promise<CallResult> {
    const result = await this.call(input)
    if (result.failed) throw new PushError('error', `Claude Design refused: ${firstLine(result.text)}`)
    return result
  }

  private async call(input: ArtifactInput): Promise<CallResult> {
    this.guard.expect(input)
    try {
      return await this.claude.call(input)
    } finally {
      this.guard.expect(null)
    }
  }
}

const MESSAGE_LIMIT = 300

export function firstLine(text: string): string {
  const line = text.replace(/^Error:\s*/, '').split('\n').find((candidate) => candidate.trim() !== '') ?? 'no reason given'
  return line.trim().slice(0, MESSAGE_LIMIT)
}
