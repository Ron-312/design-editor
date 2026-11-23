import type { UndoState } from '../../shared/protocol'
import type { EdId, EditRecord, ProjectPath } from '../../shared/types'

/** One file as it was before the entry's write, and the hash the disk had right after that write. */
export interface FileSnapshot {
  readonly file: ProjectPath
  readonly text: string
  readonly offsets: ReadonlyMap<EdId, number>
  readonly postWriteHash: string
}

/** One user action, however many flushes it took, restored by writing its snapshots back. */
export interface UndoEntry {
  /** Absent for an op sent without one: such an entry never folds. */
  readonly actionId?: string | undefined
  readonly records: readonly EditRecord[]
  readonly snapshots: readonly FileSnapshot[]
  /** Only inline `style` declarations changed, so undo previews the old values instead of reloading. */
  readonly styleOnly: boolean
}

function labelOf(entry: UndoEntry | undefined): string | null {
  const record = entry?.records.at(-1)
  if (!record) return null
  return record.prop ? `${record.kind} ${record.prop}` : record.kind
}

function snapshotOf(entry: UndoEntry, file: ProjectPath): FileSnapshot | undefined {
  return entry.snapshots.find((snapshot) => snapshot.file === file)
}

function latestHashOf(stack: readonly UndoEntry[], file: ProjectPath): string | undefined {
  for (let at = stack.length - 1; at >= 0; at--) {
    const snapshot = snapshotOf(stack[at]!, file)
    if (snapshot) return snapshot.postWriteHash
  }
  return undefined
}

/** Each file keeps its earliest pre-image and its latest post-write hash. */
function folded(entry: UndoEntry, later: UndoEntry): UndoEntry {
  const snapshots = entry.snapshots.map((snapshot) => {
    const latest = snapshotOf(later, snapshot.file)
    return latest ? { ...snapshot, postWriteHash: latest.postWriteHash } : snapshot
  })
  const added = later.snapshots.filter((snapshot) => !snapshotOf(entry, snapshot.file))
  return {
    ...entry,
    records: [...entry.records, ...later.records],
    snapshots: [...snapshots, ...added],
    styleOnly: entry.styleOnly && later.styleOnly,
  }
}

function withoutFile(entry: UndoEntry, file: ProjectPath): UndoEntry | null {
  if (!snapshotOf(entry, file)) return entry
  const snapshots = entry.snapshots.filter((snapshot) => snapshot.file !== file)
  if (snapshots.length === 0) return null
  return { ...entry, snapshots, records: entry.records.filter((record) => !record.files.includes(file)) }
}

/** File pre-image snapshots, never inverse ops: undo writes the stored text and id map back. */
export class UndoLog {
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []
  /** The entry the last flush recorded, while no undo or redo has run since: a later flush of its action folds into it. */
  private openEntry: UndoEntry | null = null

  /** A new flush: it starts a fresh history ahead, so redo is gone. */
  record(entry: UndoEntry): void {
    this.redoStack = []
    const top = this.undoStack.at(-1)
    if (top && top === this.openEntry && entry.actionId !== undefined && entry.actionId === top.actionId) {
      this.openEntry = folded(top, entry)
      this.undoStack[this.undoStack.length - 1] = this.openEntry
      return
    }
    this.undoStack.push(entry)
    this.openEntry = entry
  }

  peekUndo(): UndoEntry | null {
    return this.undoStack.at(-1) ?? null
  }

  peekRedo(): UndoEntry | null {
    return this.redoStack.at(-1) ?? null
  }

  popUndo(): UndoEntry | null {
    this.openEntry = null
    return this.undoStack.pop() ?? null
  }

  popRedo(): UndoEntry | null {
    this.openEntry = null
    return this.redoStack.pop() ?? null
  }

  pushUndo(entry: UndoEntry): void {
    this.undoStack.push(entry)
  }

  pushRedo(entry: UndoEntry): void {
    this.redoStack.push(entry)
  }

  /** Drops the file's entries once the disk no longer holds what this log last wrote, so undo never clobbers outside work. */
  outsideChange(file: ProjectPath, diskHash: string): void {
    const expected = [latestHashOf(this.undoStack, file), latestHashOf(this.redoStack, file)]
    if (expected.every((hash) => hash === undefined || hash === diskHash)) return
    this.dropFile(file)
  }

  /** The file is gone, so no entry may write it back. */
  dropFile(file: ProjectPath): void {
    // The open entry may be rebuilt without the file; folding follows it to its new object.
    const undone = this.undoStack.map((entry) => [entry, withoutFile(entry, file)] as const)
    this.openEntry = undone.find(([entry]) => entry === this.openEntry)?.[1] ?? null
    this.undoStack = undone.flatMap(([, kept]) => (kept ? [kept] : []))
    this.redoStack = this.redoStack.flatMap((entry) => withoutFile(entry, file) ?? [])
  }

  state(): UndoState {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: labelOf(this.undoStack.at(-1)),
      redoLabel: labelOf(this.redoStack.at(-1)),
    }
  }
}
