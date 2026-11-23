import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll } from 'vitest'
import { runEdsync } from '../../src/edsync/cli'
import { EDITOR_FILES } from '../../src/shared/protocol'
import type {
  BaseJson,
  CacheOutput,
  ClassifyOutput,
  FileAction,
  FileClassification,
  IngestOutput,
  PublishRequest,
  PushLock,
} from '../../src/shared/sync'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
export const FIXTURE_PROJECT = path.join(FIXTURES, 'canvas', 'project')
export const FIXTURE_FETCHED = path.join(FIXTURES, 'canvas', 'fetched')

export const SLUG = 'test-site'
export const PUBLISH_ROOT = `projects/${SLUG}`
export const RELEASE = 'stand-in'
export const HOME = 'project/home.dc.html'
export const CARD = 'project/card.dc.html'
export const CANVAS = 'project/canvas.json'
export const CSS_BLOB = 'b1a2c3d4e5f60718293a4b5c6d7e8f90'
export const SVG_BLOB = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'
export const ARTBOARDS_MESSAGE = 'add/remove artboards in Claude Design'

/** Edits on different lines of the two fixture artboards, so each lands in its own merge hunk. */
export const EDITS = {
  homeTitle: { from: 'font-size: 48px">Studio Weekly', to: 'font-size: 48px">Studio Monthly' },
  homeColumn: { from: 'style="width: 240px; padding: 16px">Brief', to: 'style="width: 260px; padding: 16px">Brief' },
  homeLede: { from: 'Made with <strong>care</strong>', to: 'Made with <strong>great care</strong>' },
  cardTitle: { from: '<h2 style="margin: 0 0 8px">', to: '<h2 style="margin: 0 0 12px">' },
  cardText: { from: 'Timber canopy, phase two', to: 'Timber canopy, phase three' },
} as const

export type TextEdit = { readonly from: string; readonly to: string }

export interface EdsyncRun {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export function replaceOnce(text: string, edit: TextEdit): string {
  const at = text.indexOf(edit.from)
  if (at < 0 || text.indexOf(edit.from, at + 1) >= 0) throw new Error(`"${edit.from}" must occur exactly once`)
  return text.slice(0, at) + edit.to + text.slice(at + edit.from.length)
}

function nativeOf(root: string, projectPath: string): string {
  return path.join(root, ...projectPath.split('/'))
}

function boardKeyOf(projectPath: string): string {
  return projectPath.slice('project/'.length)
}

/** The git config a developer machine might have, with autocrlf on, so any byte conversion shows. */
export function useIsolatedGitConfig(): void {
  const saved: Record<string, string | undefined> = {}
  let home = ''
  beforeAll(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'edsync-gitconfig-'))
    const globalConfig = path.join(home, 'gitconfig')
    writeFileSync(
      globalConfig,
      '[user]\n\tname = Edsync Test\n\temail = edsync@example.test\n[core]\n\tautocrlf = true\n\tsafecrlf = true\n[commit]\n\tgpgsign = false\n',
    )
    for (const [name, value] of [
      ['GIT_CONFIG_GLOBAL', globalConfig],
      ['GIT_CONFIG_NOSYSTEM', '1'],
    ] as const) {
      saved[name] = process.env[name]
      process.env[name] = value
    }
  })
  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(home, { recursive: true, force: true })
  })
}

/** Stands in for the Claude Design artifact: `project/**` on disk, read and published only by these helpers. */
export class FakeRemote {
  private snapshots = 0

  constructor(
    readonly dir: string,
    private readonly scratchRoot: string,
  ) {
    cpSync(FIXTURE_PROJECT, path.join(dir, 'project'), { recursive: true })
  }

  file(projectPath: string): string {
    return nativeOf(this.dir, projectPath)
  }

  has(projectPath: string): boolean {
    return existsSync(this.file(projectPath))
  }

  read(projectPath: string): Buffer {
    return readFileSync(this.file(projectPath))
  }

  write(projectPath: string, bytes: Buffer | string): void {
    mkdirSync(path.dirname(this.file(projectPath)), { recursive: true })
    writeFileSync(this.file(projectPath), bytes)
  }

  edit(projectPath: string, edit: TextEdit): void {
    this.write(projectPath, replaceOnce(this.read(projectPath).toString('utf8'), edit))
  }

  remove(projectPath: string): void {
    rmSync(this.file(projectPath))
  }

  /** A new artboard arrives with its `canvas.json` entry, as Claude Design adds one. */
  addBoard(projectPath: string, bytes: Buffer | string): void {
    this.write(projectPath, bytes)
    const canvas = this.canvasJson()
    canvas.boards[boardKeyOf(projectPath)] = { x: 0, y: 1000, w: 640, h: 480 }
    canvas.order.push(boardKeyOf(projectPath))
    this.write(CANVAS, `${JSON.stringify(canvas, null, 2)}\n`)
  }

  removeBoard(projectPath: string): void {
    this.remove(projectPath)
    const canvas = this.canvasJson()
    delete canvas.boards[boardKeyOf(projectPath)]
    canvas.order = canvas.order.filter((key) => key !== boardKeyOf(projectPath))
    canvas.pages = canvas.pages.filter((key) => key !== boardKeyOf(projectPath))
    this.write(CANVAS, `${JSON.stringify(canvas, null, 2)}\n`)
  }

  /** The Artifact `read` with `paths` into a fresh default-scratchpad folder. */
  snapshot(): string {
    this.snapshots += 1
    const folder = path.join(this.scratchRoot, `snapshot-${this.snapshots}`)
    cpSync(path.join(this.dir, 'project'), path.join(folder, 'project'), { recursive: true })
    return folder
  }

  /** The one Artifact publish: each `files` entry is read from `root` (resolved against the caller's cwd). */
  publish(request: PublishRequest, cwd: string, only?: readonly string[]): void {
    for (const [key, source] of Object.entries(request.files)) {
      if (only && !only.includes(key)) continue
      this.write(key, readFileSync(path.resolve(cwd, request.root, source)))
    }
  }

  private canvasJson(): { boards: Record<string, unknown>; order: string[]; pages: string[] } {
    return JSON.parse(this.read(CANVAS).toString('utf8'))
  }
}

/** A throwaway editor checkout: `projects/<slug>/` under `cwd`, a fake remote and a scratchpad beside it. */
export class Workspace {
  readonly cwd: string
  readonly projectDir: string
  readonly remote: FakeRemote
  private readonly sandbox: string

  private constructor(sandbox: string) {
    this.sandbox = sandbox
    this.cwd = path.join(sandbox, 'editor repo')
    this.projectDir = path.join(this.cwd, 'projects', SLUG)
    mkdirSync(this.cwd, { recursive: true })
    this.remote = new FakeRemote(path.join(sandbox, 'remote'), path.join(sandbox, 'scratchpad'))
  }

  static create(): Workspace {
    return new Workspace(mkdtempSync(path.join(os.tmpdir(), 'edsync ws ')))
  }

  dispose(): void {
    rmSync(this.sandbox, { recursive: true, force: true })
  }

  edsync(...argv: string[]): Promise<EdsyncRun> {
    return runEdsync(argv, { cwd: this.cwd })
  }

  async ingest(): Promise<IngestOutput> {
    return parsedOk<IngestOutput>(await this.edsync('ingest', '--remote-dir', this.remote.snapshot(), '--slug', SLUG))
  }

  async cache(from: string): Promise<CacheOutput> {
    return parsedOk<CacheOutput>(await this.edsync('cache', '--slug', SLUG, '--from', from, '--release', RELEASE))
  }

  /** `/design-pull` on a fresh project: ingest, then the blobs and support.js through the scratchpad. */
  async pull(): Promise<IngestOutput> {
    const ingested = await this.ingest()
    const fetched = path.join(this.sandbox, 'fetched')
    cpSync(FIXTURE_FETCHED, fetched, { recursive: true })
    await this.cache(fetched)
    return ingested
  }

  async lock(): Promise<string> {
    return parsedOk<{ nonce: string }>(await this.edsync('lock', '--slug', SLUG)).nonce
  }

  classifyRun(nonce: string): Promise<EdsyncRun> {
    return this.edsync('classify', '--slug', SLUG, '--remote-dir', this.remote.snapshot(), '--nonce', nonce)
  }

  async classify(nonce: string): Promise<ClassifyOutput> {
    return parsedJson<ClassifyOutput>(await this.classifyRun(nonce))
  }

  publish(output: ClassifyOutput, only?: readonly string[]): void {
    if (!output.publish) throw new Error('classify printed no publish map')
    this.remote.publish(output.publish, this.cwd, only)
  }

  commitRun(nonce: string): Promise<EdsyncRun> {
    return this.edsync('commit', '--slug', SLUG, '--nonce', nonce)
  }

  async commit(nonce: string): Promise<void> {
    expectOk(await this.commitRun(nonce))
  }

  unlockRun(nonce: string): Promise<EdsyncRun> {
    return this.edsync('unlock', '--slug', SLUG, '--nonce', nonce)
  }

  /** Push steps 1-5 plus the unlock, as `/design-push` runs them when nothing stops the push. */
  async push(): Promise<ClassifyOutput> {
    const nonce = await this.lock()
    const output = await this.classify(nonce)
    if (output.publish) this.publish(output)
    await this.commit(nonce)
    expectOk(await this.unlockRun(nonce))
    return output
  }

  local(projectPath: string): Buffer {
    return readFileSync(nativeOf(this.projectDir, projectPath))
  }

  hasLocal(projectPath: string): boolean {
    return existsSync(nativeOf(this.projectDir, projectPath))
  }

  writeLocal(projectPath: string, bytes: Buffer | string): void {
    mkdirSync(path.dirname(nativeOf(this.projectDir, projectPath)), { recursive: true })
    writeFileSync(nativeOf(this.projectDir, projectPath), bytes)
  }

  editLocal(projectPath: string, edit: TextEdit): void {
    this.writeLocal(projectPath, replaceOnce(this.local(projectPath).toString('utf8'), edit))
  }

  removeLocal(projectPath: string): void {
    rmSync(nativeOf(this.projectDir, projectPath))
  }

  publishedSource(output: ClassifyOutput, key: string): Buffer {
    const request = output.publish!
    return readFileSync(path.resolve(this.cwd, request.root, request.files[key]!))
  }

  git(...args: string[]): string {
    return execFileSync('git', args, { cwd: this.projectDir, encoding: 'utf8' })
  }

  head(): string {
    return this.git('rev-parse', 'HEAD').trim()
  }

  headBlob(projectPath: string): Buffer {
    return execFileSync('git', ['cat-file', 'blob', `HEAD:${projectPath}`], { cwd: this.projectDir })
  }

  committedHashes(): Record<string, string> {
    const hashes: Record<string, string> = {}
    for (const line of this.git('ls-tree', '-r', 'HEAD').trim().split('\n')) {
      const [meta, file] = line.split('\t')
      const hash = meta?.split(' ')[2]
      if (file && hash) hashes[file] = hash
    }
    return hashes
  }

  status(): string[] {
    return this.git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean)
  }

  base(): BaseJson {
    return JSON.parse(readFileSync(nativeOf(this.projectDir, EDITOR_FILES.base), 'utf8')) as BaseJson
  }

  pushLockFile(): string {
    return nativeOf(this.projectDir, EDITOR_FILES.pushLock)
  }

  pushLock(): PushLock | null {
    return existsSync(this.pushLockFile()) ? (JSON.parse(readFileSync(this.pushLockFile(), 'utf8')) as PushLock) : null
  }

  writePushLock(lock: PushLock): void {
    writeFileSync(this.pushLockFile(), JSON.stringify(lock))
  }

  serverJsonFile(): string {
    return nativeOf(this.projectDir, EDITOR_FILES.server)
  }

  cacheDir(): string {
    return nativeOf(this.projectDir, EDITOR_FILES.cache)
  }
}

export function gitBlobHash(bytes: Buffer | string): string {
  return execFileSync('git', ['hash-object', '--no-filters', '--stdin'], { input: bytes, encoding: 'utf8' }).trim()
}

export function expectOk(run: EdsyncRun): EdsyncRun {
  if (run.exitCode !== 0) throw new Error(`edsync exited ${run.exitCode}: ${run.stderr}${run.stdout}`)
  return run
}

export function parsedJson<T>(run: EdsyncRun): T {
  try {
    return JSON.parse(run.stdout) as T
  } catch {
    throw new Error(`edsync printed no JSON (exit ${run.exitCode}): ${run.stdout}${run.stderr}`)
  }
}

export function parsedOk<T>(run: EdsyncRun): T {
  return parsedJson<T>(expectOk(run))
}

/** A file the plan leaves out has nothing to do, the same as an `unchanged` entry. */
export function actionOf(output: ClassifyOutput, projectPath: string): FileAction {
  return output.plan.find((entry) => entry.path === projectPath)?.action ?? 'unchanged'
}

export function entryOf(output: ClassifyOutput, projectPath: string): FileClassification | undefined {
  return output.plan.find((entry) => entry.path === projectPath)
}
