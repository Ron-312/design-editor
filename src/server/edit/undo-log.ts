import type { UndoState } from '../../shared/protocol'
import type { EdId, EditRecord, ProjectPath } from '../../shared/types'

/** One file as it was before the entry's write, and the hash the disk had right after that write. */
export interface FileSnapshot {
  readonly file: ProjectPath
  readonly text: string
  readonly offsets: ReadonlyMap<EdId, number>
  readonly postWriteHash: string
}

/** One flush (a drag or typing burst lands in one), restored by writing its snapshots back. */
export interface UndoEntry {
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

function withoutFile(stack: readonly UndoEntry[], file: ProjectPath): UndoEntry[] {
  return stack
    .map((entry) => ({
      ...entry,
      snapshots: entry.snapshots.filter((snapshot) => snapshot.file !== file),
      records: entry.records.filter((record) => !record.files.includes(file)),
    }))
    .filter((entry) => entry.snapshots.length > 0)
}

/** File pre-image snapshots, never inverse ops: undo writes the stored text and id map back. */
export class UndoLog {
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []

  /** A new flush: it starts a fresh history ahead, so redo is gone. */
  record(entry: UndoEntry): void {
    this.undoStack.push(entry)
    this.redoStack = []
  }

  peekUndo(): UndoEntry | null {
    return this.undoStack.at(-1) ?? null
  }

  peekRedo(): UndoEntry | null {
    return this.redoStack.at(-1) ?? null
  }

  popUndo(): UndoEntry | null {
    return this.undoStack.pop() ?? null
  }

  popRedo(): UndoEntry | null {
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
    this.undoStack = withoutFile(this.undoStack, file)
    this.redoStack = withoutFile(this.redoStack, file)
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
