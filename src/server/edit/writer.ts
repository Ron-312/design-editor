import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { atomicWrite } from '../../core/atomic-write'
import { toNativePath } from '../../shared/paths'
import type { ResolvedValues, RestoredDeclaration, ServerMessage } from '../../shared/protocol'
import type { EdId, EditOp, EditRecord, ElementLocation, ProjectPath } from '../../shared/types'
import { decodeSource, encodeSource } from '../source/bytes'
import type { IndexedFile, SourceIndex } from '../source/source-index'
import { attrValue } from '../source/template-tree'
import { reconcile } from '../watch/reconcile'
import { PatchEngine, type PatchOutcome } from './patch-engine'
import { ParsedSource } from './shape-check'
import { STRUCTURAL_KINDS } from './structural-ops'
import { lastDeclaration } from './text-splice'
import type { FileSnapshot, UndoEntry, UndoLog } from './undo-log'

const DEBOUNCE_MS = 300

const LOCKED = 'file locked by another program'
const GONE = 'that layer is gone; reload the canvas'
const DISCARDED = 'discarded: the file changed outside the editor'

export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface WriterOptions {
  readonly root: string
  readonly index: SourceIndex
  readonly undo: UndoLog
  readonly send: (message: ServerMessage) => void
}

/** One op to plan, acked under every opId it superseded. */
interface PendingOp {
  readonly opIds: readonly string[]
  readonly op: EditOp
}

interface OpenFile {
  indexed: IndexedFile
  /** Hash of the bytes the editor last read or wrote: the watcher's own-write filter. */
  hash: string
  pending: PendingOp[]
  /** An outside change arrived with ops pending; nothing is written until the user keeps or discards them. */
  paused: boolean
}

interface FlushedFile {
  readonly snapshot: FileSnapshot
  readonly records: readonly EditRecord[]
  readonly acks: readonly ServerMessage[]
}

function supersedeKey(op: EditOp): string | null {
  const targets = op.target.join(',')
  switch (op.kind) {
    case 'setDecl':
    case 'removeDecl':
      return `decl ${op.payload.rule ?? 'inline'} ${op.payload.prop} ${targets}`
    case 'setAttr':
      return `attr ${op.payload.name.toLowerCase()} ${targets}`
    case 'setText':
      return `text ${targets}`
    default:
      return null
  }
}

/** A drag or typing burst sets one thing many times inside the window; only its last value is planned. */
function withOp(pending: readonly PendingOp[], next: PendingOp): PendingOp[] {
  const key = supersedeKey(next.op)
  const at = key === null ? -1 : pending.findIndex((entry) => supersedeKey(entry.op) === key)
  if (at < 0) return [...pending, next]
  return pending.map((entry, i) => (i === at ? { opIds: [...entry.opIds, ...next.opIds], op: next.op } : entry))
}

function isInlineStyleRecord(record: EditRecord): boolean {
  return (record.kind === 'setDecl' || record.kind === 'removeDecl') && record.scope.kind !== 'rule'
}

function textOf(source: ParsedSource, id: EdId): string {
  return source
    .element(id)
    .childNodes.map((node) => (node.nodeName === '#text' && 'value' in node ? node.value : ''))
    .join('')
}

function locationsOf(indexed: IndexedFile, ids: readonly EdId[]): Record<EdId, ElementLocation> {
  return Object.fromEntries(ids.flatMap((id) => {
    const location = indexed.locate(id)
    return location ? [[id, location]] : []
  }))
}

/** What the re-indexed source now says for each target, for the UI's ack-vs-live check. */
function resolvedValues(indexed: IndexedFile, record: EditRecord): ResolvedValues {
  let source: ParsedSource | undefined
  const parsed = () => (source ??= ParsedSource.parse(indexed.text, indexed.startOffsets()))
  const valueOf = (id: EdId): string | null => {
    switch (record.kind) {
      case 'setDecl':
      case 'removeDecl':
        // RuleIds are minted afresh on every re-index, so an edited rule cannot be found again by id.
        if (record.scope.kind === 'rule') return null
        return lastDeclaration(indexed.inlineStyle(id)?.declarations ?? [], record.prop!)?.value ?? null
      case 'setAttr':
        return attrValue(parsed().element(id), record.prop!) ?? null
      case 'setText':
        return textOf(parsed(), id)
      default:
        return null
    }
  }
  return Object.fromEntries(record.target.filter((id) => indexed.locate(id)).map((id) => [id, valueOf(id)]))
}

/** Debounces ops per file, splices them through the PatchEngine, writes atomically and keeps the snapshot undo log. */
export class Writer {
  private readonly files = new Map<ProjectPath, OpenFile>()
  private readonly engine: PatchEngine
  private mintedCount = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: WriterOptions) {
    // A prefix of its own keeps op-minted ids apart from the SourceIndex counter, whose minting is private.
    this.engine = new PatchEngine({ mintId: () => `n${++this.mintedCount}` as EdId })
  }

  async open(file: ProjectPath): Promise<IndexedFile> {
    const existing = this.files.get(file)
    if (existing) return existing.indexed
    const bytes = await readFile(this.nativeOf(file))
    const indexed = this.options.index.indexFile(file, decodeSource(bytes))
    this.files.set(file, { indexed, hash: contentHash(bytes), pending: [], paused: false })
    return indexed
  }

  indexed(file: ProjectPath): IndexedFile | undefined {
    return this.files.get(file)?.indexed
  }

  knownHash(file: ProjectPath): string | undefined {
    return this.files.get(file)?.hash
  }

  hasPending(file: ProjectPath): boolean {
    return (this.files.get(file)?.pending.length ?? 0) > 0
  }

  submit(opId: string, op: EditOp): void {
    const open = this.ownerOf(op.target[0])
    if (!open) return this.options.send({ type: 'rejected', opId, reason: GONE })
    open.pending = withOp(open.pending, { opIds: [opId], op })
    this.armDebounce()
  }

  flush(): Promise<void> {
    return this.serialized(() => this.flushAll())
  }

  undo(): Promise<void> {
    return this.serialized(async () => {
      await this.flushAll()
      const entry = this.options.undo.popUndo()
      if (!entry) return
      const inverse = await this.restore(entry)
      if (!inverse) return this.options.undo.pushUndo(entry)
      this.options.undo.pushRedo(inverse)
      this.announceRestored(entry)
    })
  }

  redo(): Promise<void> {
    return this.serialized(async () => {
      await this.flushAll()
      const entry = this.options.undo.popRedo()
      if (!entry) return
      const inverse = await this.restore(entry)
      if (!inverse) return this.options.undo.pushRedo(entry)
      this.options.undo.pushUndo(inverse)
      this.announceRestored(entry)
    })
  }

  /** The watcher saw bytes the editor did not write: re-index by reconcile, drop the file's undo history, pause pending ops. */
  outsideChange(file: ProjectPath): Promise<void> {
    return this.serialized(async () => {
      const open = this.files.get(file)
      if (!open) return
      const bytes = await readFile(this.nativeOf(file))
      const hash = contentHash(bytes)
      if (hash === open.hash) return
      const { indexed, restoreByPath } = reconcile(this.options.index, open.indexed, decodeSource(bytes))
      open.indexed = indexed
      open.hash = hash
      open.paused = open.pending.length > 0
      this.options.undo.outsideChange(file, hash)
      this.options.send({ type: 'outsideChange', file, pendingOps: open.paused, replacedIds: Object.fromEntries(restoreByPath) })
      this.sendUndoState()
    })
  }

  /** The board was removed: its pending ops are refused and its undo history dropped. */
  close(file: ProjectPath): Promise<void> {
    return this.serialized(async () => {
      const open = this.files.get(file)
      if (!open) return
      this.files.delete(file)
      this.reject(open.pending, GONE)
      this.options.undo.dropFile(file)
      this.sendUndoState()
    })
  }

  resolvePending(file: ProjectPath, keep: boolean): Promise<void> {
    return this.serialized(async () => {
      const open = this.files.get(file)
      if (!open) return
      open.paused = false
      if (keep) return this.armDebounce()
      this.reject(open.pending, DISCARDED)
      open.pending = []
    })
  }

  private nativeOf(file: ProjectPath): string {
    return toNativePath(this.options.root, file)
  }

  private ownerOf(id: EdId | undefined): OpenFile | undefined {
    if (!id) return undefined
    return [...this.files.values()].find((open) => open.indexed.locate(id))
  }

  private armDebounce(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS)
  }

  private serialized(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Every touched file is written once, and the flush becomes one undo entry before any op is acked. */
  private async flushAll(): Promise<void> {
    clearTimeout(this.timer)
    const flushed: FlushedFile[] = []
    for (const [file, open] of this.files) {
      if (open.paused || open.pending.length === 0) continue
      const result = await this.flushFile(file, open)
      if (result) flushed.push(result)
    }
    if (flushed.length === 0) return
    const records = flushed.flatMap((result) => result.records)
    this.options.undo.record({ records, snapshots: flushed.map((result) => result.snapshot), styleOnly: records.every(isInlineStyleRecord) })
    for (const ack of flushed.flatMap((result) => result.acks)) this.options.send(ack)
    this.sendUndoState()
  }

  private async flushFile(file: ProjectPath, open: OpenFile): Promise<FlushedFile | null> {
    const batch = open.pending
    open.pending = []
    const before = open.indexed
    const outcome = this.plan(before, batch)
    if (!outcome.ok) {
      this.reject(batch, outcome.reason)
      return null
    }
    if (!(await this.writeText(file, open, outcome.text))) {
      open.pending = open.pending.reduce(withOp, batch)
      return null
    }
    open.indexed = this.options.index.indexFile(file, outcome.text, outcome.offsets)
    return {
      snapshot: { file, text: before.text, offsets: before.startOffsets(), postWriteHash: open.hash },
      records: outcome.records,
      acks: batch.flatMap((pending, i) => this.acks(open.indexed, pending, outcome.records[i]!, outcome.minted, outcome.warnings)),
    }
  }

  private plan(indexed: IndexedFile, batch: readonly PendingOp[]): PatchOutcome {
    try {
      return this.engine.apply(indexed, batch.map((pending) => pending.op))
    } catch (error) {
      return { ok: false, reason: (error as Error).message }
    }
  }

  /** Structural ops carry the flush's minted ids and warnings; the engine collects both per flush, not per op. */
  private acks(indexed: IndexedFile, pending: PendingOp, record: EditRecord, minted: readonly EdId[], flushWarnings: readonly string[]): ServerMessage[] {
    const structural = STRUCTURAL_KINDS.has(pending.op.kind)
    const mintedIds = structural ? minted : []
    const warnings = structural ? flushWarnings : []
    const locations = locationsOf(indexed, [...record.target, ...mintedIds])
    const resolved = resolvedValues(indexed, record)
    const reload = !isInlineStyleRecord(record)
    return pending.opIds.map((opId) => ({ type: 'ack', opId, record, mintedIds, locations, resolved, reload, warnings }))
  }

  /** The hash is recorded before the rename lands, so the watcher never mistakes this write for an outside edit. */
  private async writeText(file: ProjectPath, open: OpenFile, text: string): Promise<boolean> {
    const bytes = encodeSource(text)
    const priorHash = open.hash
    open.hash = contentHash(bytes)
    try {
      await atomicWrite(this.nativeOf(file), bytes)
      return true
    } catch (error) {
      open.hash = priorHash
      const message = (error as Error).message
      this.options.send({ type: 'writeFailed', file, reason: message.includes(LOCKED) ? 'locked' : 'error', message: `${file}: ${message}` })
      return false
    }
  }

  /** Writes each snapshot back with its stored id map; returns the entry that reverses this restore. */
  private async restore(entry: UndoEntry): Promise<UndoEntry | null> {
    const inverse: FileSnapshot[] = []
    for (const snapshot of entry.snapshots) {
      const open = this.files.get(snapshot.file)!
      const current = open.indexed
      if (!(await this.writeText(snapshot.file, open, snapshot.text))) return null
      open.indexed = this.options.index.indexFile(snapshot.file, snapshot.text, snapshot.offsets)
      inverse.push({ file: snapshot.file, text: current.text, offsets: current.startOffsets(), postWriteHash: open.hash })
    }
    return { ...entry, snapshots: inverse }
  }

  private announceRestored(entry: UndoEntry): void {
    const locations: Record<EdId, ElementLocation> = {}
    const resolved: Record<EdId, string | null> = {}
    const declarations: RestoredDeclaration[] = []
    for (const record of entry.records) {
      const indexed = this.files.get(record.files[0]!)!.indexed
      const values = resolvedValues(indexed, record)
      Object.assign(locations, locationsOf(indexed, record.target))
      Object.assign(resolved, values)
      if (!isInlineStyleRecord(record)) continue
      for (const [edId, value] of Object.entries(values)) declarations.push({ edId: edId as EdId, prop: record.prop!, value })
    }
    const record = entry.records.at(-1)!
    this.options.send({ type: 'restored', record, locations, resolved, reload: !entry.styleOnly, declarations })
    this.sendUndoState()
  }

  private reject(batch: readonly PendingOp[], reason: string): void {
    for (const opId of batch.flatMap((pending) => pending.opIds)) this.options.send({ type: 'rejected', opId, reason })
  }

  private sendUndoState(): void {
    this.options.send({ type: 'undoState', state: this.options.undo.state() })
  }
}
