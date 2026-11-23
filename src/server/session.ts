import type WebSocket from 'ws'
import { acquirePushLock, isPushLockLive, releasePushLock, renewPushLock } from '../core/push-lock'
import { findStoredPath } from '../shared/paths'
import type { BoardIndex, ClientMessage, EditorState, ServerMessage } from '../shared/protocol'
import { LEASE, type PushLock } from '../shared/sync'
import type { CanvasLayout, EdId, EditOp, ProjectPath, StyleSource } from '../shared/types'
import { parseClientMessage } from './client-message'
import { UndoLog } from './edit/undo-log'
import { contentHash, Writer } from './edit/writer'
import { readCanvasLayout, readEditorState, syncedText, writeEditorState } from './editor-services'
import { encodeSource } from './source/bytes'
import { SourceIndex, type IndexedFile } from './source/source-index'
import { reconcile } from './watch/reconcile'

const PUSH_IN_PROGRESS = 'Push in progress: the canvas is read-only until it finishes'
const FOREIGN_LOCK_POLL_MS = 500
const PROJECT_FOLDER_PREFIX = 'project/'
/** chokidar can miss a change that lands while it re-attaches to a file the Writer's atomic rename replaced. */
const OWN_WRITE_RECHECK_MS = 250

/** `pending` covers the flush before push.lock exists: ops are already refused, so none can land under the push. */
type LockState =
  | { readonly kind: 'pending'; readonly nonce: string | undefined; cancelled: boolean }
  | { readonly kind: 'own'; readonly lock: PushLock; readonly renewal: ReturnType<typeof setInterval>; askedStale: boolean }
  | { readonly kind: 'foreign'; readonly poll: ReturnType<typeof setInterval> }

function stylesOf(indexed: IndexedFile): Record<EdId, readonly StyleSource[]> {
  return Object.fromEntries(indexed.ids.flatMap((id) => {
    const inline = indexed.inlineStyle(id)
    return inline ? [[id, [inline]]] : []
  }))
}

/** Background work has no caller to fail to: a failure is reported and the session carries on. */
function inBackground(task: Promise<void>): void {
  task.catch((error: Error) => console.warn(`editor session: ${error.message}`))
}

/** The edit session behind the editor ws: one Writer and UndoLog for the project, gated by the push lock. */
export class EditSession {
  private readonly index = new SourceIndex()
  private readonly undoLog = new UndoLog()
  private readonly writer: Writer
  private readonly clients = new Set<WebSocket>()
  /** The IndexedFile each viewed board's last `index` message was built from. */
  private readonly sentIndexes = new Map<ProjectPath, IndexedFile>()
  private lock: LockState | null = null
  private frameBase = ''
  private recheck: ReturnType<typeof setTimeout> | undefined

  private constructor(
    private readonly root: string,
    private readonly layout: CanvasLayout,
    private state: EditorState,
  ) {
    this.writer = new Writer({ root, index: this.index, undo: this.undoLog, send: (message) => this.relay(message) })
  }

  /** Every board is opened up front, so the served ids and the Writer's ids are one set from the first request. */
  static async open(root: string): Promise<EditSession> {
    const session = new EditSession(root, await readCanvasLayout(root), await readEditorState(root))
    for (const board of session.layout.order) await session.writer.open(board)
    if (await isPushLockLive(root)) session.watchForeignLock()
    return session
  }

  /** `http://127.0.0.1:<project port>/project/<secret>/`, the base of every iframe `src`. */
  serveFramesAt(frameBase: string): void {
    this.frameBase = frameBase
  }

  get editorState(): EditorState {
    return this.state
  }

  knownHash(file: ProjectPath): string | undefined {
    return this.writer.knownHash(file)
  }

  outsideChange(file: ProjectPath): void {
    inBackground(this.writer.outsideChange(file))
  }

  /** The project origin serves the session's ids; bytes the watcher has not reconciled yet get fresh ones until it does. */
  indexFor(file: ProjectPath, text: string): IndexedFile {
    const indexed = this.writer.indexed(file)
    return indexed?.text === text ? indexed : this.index.indexFile(file, text)
  }

  accept(socket: WebSocket): void {
    this.clients.add(socket)
    socket.on('close', () => this.clients.delete(socket))
    socket.on('message', (data) => {
      const message = parseClientMessage(data)
      if (message) inBackground(this.receive(socket, message))
    })
    this.sendTo(socket, { type: 'hello', layout: this.layout, editorState: this.state, readOnly: this.lock !== null })
  }

  /** Flushes the debounce to disk, then takes push.lock; null while any lock is held. */
  async beginPush(nonce?: string): Promise<string | null> {
    if (this.lock?.kind === 'own' && nonce !== undefined && this.lock.lock.nonce === nonce) return nonce
    if (this.lock) return null
    const pending: LockState = { kind: 'pending', nonce, cancelled: false }
    this.lock = pending
    let lock: PushLock | null = null
    try {
      await this.writer.flush()
      lock = await acquirePushLock(this.root, { holder: 'editor', leaseMs: LEASE.editorMs, ...(nonce === undefined ? {} : { nonce }) })
      if (lock && pending.cancelled) {
        await releasePushLock(this.root, lock.nonce)
        lock = null
      }
    } finally {
      if (!lock) this.lock = null
    }
    if (!lock) return null
    this.lock = { kind: 'own', lock, renewal: setInterval(() => inBackground(this.renewLease()), LEASE.editorRenewMs), askedStale: false }
    this.broadcast({ type: 'pushLock', held: true })
    return lock.nonce
  }

  async endPush(nonce: string): Promise<boolean> {
    if (this.lock?.kind === 'pending' && this.lock.nonce === nonce) {
      this.lock.cancelled = true
      return true
    }
    if (this.lock?.kind !== 'own' || this.lock.lock.nonce !== nonce) return false
    await releasePushLock(this.root, nonce)
    await this.resume()
    return true
  }

  async close(): Promise<void> {
    this.stopLockTimer()
    clearTimeout(this.recheck)
    if (!this.lock) await this.writer.flush()
  }

  private async receive(socket: WebSocket, message: ClientMessage): Promise<void> {
    if (message.type === 'op') return this.submit(socket, message.opId, message.op)
    if (message.type === 'open') return this.openBoard(socket, message.board)
    if (message.type === 'saveEditorState') return this.saveEditorState(message.state)
    if (this.lock) return
    switch (message.type) {
      case 'undo':
        return this.writer.undo()
      case 'redo':
        return this.writer.redo()
      case 'resolvePending':
        return this.writer.resolvePending(message.file, message.keep)
      case 'revertFile':
        return this.revertFile(message.file)
    }
  }

  /** Ops are refused, never queued, during a push: it may rewrite files and leave queued ids stale. */
  private submit(socket: WebSocket, opId: string, op: EditOp): void {
    if (this.lock) return this.sendTo(socket, { type: 'rejected', opId, reason: PUSH_IN_PROGRESS })
    this.writer.submit(opId, op)
  }

  private openBoard(socket: WebSocket, requested: ProjectPath): void {
    const board = findStoredPath(this.layout.order, requested)
    const indexed = board && this.writer.indexed(board)
    if (!board || !indexed?.tree) return
    this.sentIndexes.set(board, indexed)
    this.sendTo(socket, { type: 'index', index: this.boardIndex(board, indexed) })
  }

  private async saveEditorState(state: EditorState): Promise<void> {
    this.state = state
    await writeEditorState(this.root, state)
  }

  /** Written as a redo of the synced bytes, so it lands as one undoable entry through the Writer's own write path. */
  private async revertFile(file: ProjectPath): Promise<void> {
    if (!this.writer.indexed(file)) return
    const text = await syncedText(this.root, file)
    await this.writer.flush()
    const current = this.writer.indexed(file)!
    if (current.text === text) return
    const offsets = reconcile(this.index, current, text).indexed.startOffsets()
    while (this.undoLog.popRedo()) continue
    this.undoLog.pushRedo({ records: [], snapshots: [{ file, text, offsets, postWriteHash: contentHash(encodeSource(text)) }], styleOnly: false })
    await this.writer.redo()
  }

  private boardIndex(board: ProjectPath, indexed: IndexedFile): BoardIndex {
    const framePath = board.slice(PROJECT_FOLDER_PREFIX.length).split('/').map(encodeURIComponent).join('/')
    return {
      board,
      frameSrc: `${this.frameBase}${framePath}`,
      tree: indexed.tree!,
      locations: Object.fromEntries(indexed.ids.map((id) => [id, indexed.locate(id)!])),
      styles: stylesOf(indexed),
    }
  }

  /** Every flush, undo, redo and reconcile ends with an undoState; viewed boards whose index changed are re-sent then. */
  private relay(message: ServerMessage): void {
    this.broadcast(message)
    if (message.type !== 'undoState') return
    this.resendChangedIndexes()
    this.recheckBoardsSoon()
  }

  private recheckBoardsSoon(): void {
    clearTimeout(this.recheck)
    this.recheck = setTimeout(() => {
      for (const board of this.layout.order) inBackground(this.writer.outsideChange(board))
    }, OWN_WRITE_RECHECK_MS)
  }

  private resendChangedIndexes(): void {
    for (const [board, sent] of this.sentIndexes) {
      const indexed = this.writer.indexed(board)
      if (!indexed?.tree || indexed === sent) continue
      this.sentIndexes.set(board, indexed)
      this.broadcast({ type: 'index', index: this.boardIndex(board, indexed) })
    }
  }

  /** The editor is the push's heartbeat; after 30 minutes it asks the user, and never unlocks by itself. */
  private async renewLease(): Promise<void> {
    if (this.lock?.kind !== 'own') return
    const renewed = await renewPushLock(this.root, this.lock.lock.nonce, LEASE.editorMs)
    if (!renewed) return this.resume()
    const heldForMs = Date.now() - this.lock.lock.startedAt
    if (heldForMs < LEASE.askUnlockAfterMs || this.lock.askedStale) return
    this.lock.askedStale = true
    this.broadcast({ type: 'pushStale', heldForMs })
  }

  private watchForeignLock(): void {
    const poll = setInterval(() => inBackground(this.resumeOnceForeignLockEnds()), FOREIGN_LOCK_POLL_MS)
    this.lock = { kind: 'foreign', poll }
  }

  private async resumeOnceForeignLockEnds(): Promise<void> {
    if (this.lock?.kind !== 'foreign' || (await isPushLockLive(this.root))) return
    await this.resume()
  }

  /** Files the push rewrote are reconciled before input resumes, dropping only their undo entries. */
  private async resume(): Promise<void> {
    this.stopLockTimer()
    for (const board of this.layout.order) await this.writer.outsideChange(board)
    this.lock = null
    this.broadcast({ type: 'pushLock', held: false })
  }

  private stopLockTimer(): void {
    if (this.lock?.kind === 'own') clearInterval(this.lock.renewal)
    if (this.lock?.kind === 'foreign') clearInterval(this.lock.poll)
  }

  private sendTo(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
  }

  private broadcast(message: ServerMessage): void {
    for (const socket of this.clients) this.sendTo(socket, message)
  }
}
