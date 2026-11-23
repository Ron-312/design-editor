import { WS_PATH, WS_TOKEN_PARAM, type ClientMessage, type ResolvedValues, type ServerMessage } from '../shared/protocol'
import { supersedeKeyOf, type EdId, type EditOp, type EditRecord } from '../shared/types'
import type { AckMessage, Unsubscribe } from './plugin-api'
import type { EditorStore } from './store'

export interface WsClientOptions {
  /** `host:port` of the editor origin. */
  readonly host: string
  readonly token: string
  readonly store: EditorStore
  /** Reloads the artboard iframe from disk. */
  readonly reloadFrame: () => void
}

export interface WsClient {
  /** `previewed` is what the live iframe now shows for each target; the ack is checked against it. */
  readonly sendOp: (op: EditOp, previewed: ResolvedValues) => Promise<AckMessage>
  readonly undo: () => void
  readonly redo: () => void
  readonly send: (message: ClientMessage) => void
  readonly onMessage: (listener: (message: ServerMessage) => void) => Unsubscribe
  readonly close: () => void
}

interface PendingOp {
  readonly op: EditOp
  readonly previewed: ResolvedValues
  readonly resolve: (ack: AckMessage) => void
  readonly reject: (error: Error) => void
  /** Records acked for older ops of its burst, held until this op settles. */
  carried: readonly EditRecord[]
}

const PUSH_IN_PROGRESS = 'Push in progress'

function previewMatchesDisk(previewed: ResolvedValues, resolved: ResolvedValues): boolean {
  return Object.entries(previewed).every(([edId, value]) => resolved[edId as EdId] === value)
}

function sameRecord(a: EditRecord, b: EditRecord): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** An op without an actionId is an action of its own. */
function actionOf(opId: string, op: EditOp): string {
  return op.actionId ?? opId
}

export function connectWsClient({ host, token, store, reloadFrame }: WsClientOptions): WsClient {
  const url = new URL(`ws://${host}${WS_PATH}`)
  url.searchParams.set(WS_TOKEN_PARAM, token)
  const socket = new WebSocket(url)
  const pending = new Map<string, PendingOp>()
  /** Actions with an op refused and more still pending: whether the frame was already reloaded for them. */
  const refusedActions = new Map<string, { readonly reloaded: boolean }>()
  const listeners = new Set<(message: ServerMessage) => void>()
  const unsent: ClientMessage[] = []
  let nextOpId = 1

  function send(message: ClientMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    else unsent.push(message)
  }

  function hasPendingIn(action: string): boolean {
    return [...pending].some(([opId, other]) => actionOf(opId, other.op) === action)
  }

  /** The newest pending op of the same action that sets the same thing; only that op is checked against its preview. */
  function supersederOf(op: EditOp): PendingOp | undefined {
    const key = supersedeKeyOf(op)
    if (op.actionId === undefined || key === null) return undefined
    return [...pending.values()].findLast((other) => other.op.actionId === op.actionId && supersedeKeyOf(other.op) === key)
  }

  function forgetRefusalOnceSettled(opId: string, op: EditOp): void {
    const action = actionOf(opId, op)
    if (!hasPendingIn(action)) refusedActions.delete(action)
  }

  /**
   * The Writer acks a burst's superseded ops with the final record, but an older op written in an earlier flush
   * has a record of its own: it is carried to the newest op and recorded once that settles, unless it is the same.
   */
  function settleAck(ack: AckMessage): void {
    const op = pending.get(ack.opId)
    if (!op) return
    pending.delete(ack.opId)
    forgetRefusalOnceSettled(ack.opId, op.op)
    const superseder = supersederOf(op.op)
    if (superseder) {
      const carried = [...superseder.carried, ...op.carried, ack.record]
      superseder.carried = carried.filter((record, at) => at === 0 || !sameRecord(record, carried[at - 1]!))
      return op.resolve(ack)
    }
    for (const record of op.carried) if (!sameRecord(record, ack.record)) store.addRecord(record)
    store.addRecord(ack.record)
    if (ack.reload) {
      reloadFrame()
    } else if (!previewMatchesDisk(op.previewed, ack.resolved)) {
      store.toast({ message: 'The saved file shows a different value than the preview; reloaded from disk', tone: 'warning' })
      reloadFrame()
    }
    op.resolve(ack)
  }

  /** One toast and at most one reload per action, however many of its ops were refused. */
  function settleRejection(opId: string, reason: string): void {
    const op = pending.get(opId)
    if (!op) return
    pending.delete(opId)
    for (const record of op.carried) store.addRecord(record)
    const action = actionOf(opId, op.op)
    const refused = refusedActions.get(action)
    if (!refused) store.toast({ message: reason, tone: 'error' })
    const reload = !refused?.reloaded && Object.keys(op.previewed).length > 0
    if (reload) reloadFrame()
    if (hasPendingIn(action)) refusedActions.set(action, { reloaded: reload || refused?.reloaded === true })
    else refusedActions.delete(action)
    op.reject(new Error(reason))
  }

  function receive(message: ServerMessage): void {
    switch (message.type) {
      case 'ack':
        settleAck(message)
        break
      case 'rejected':
        settleRejection(message.opId, message.reason)
        break
      case 'index':
        store.setIndex(message.index)
        break
      case 'pushLock':
        store.setReadOnly(message.held)
        break
      case 'restored':
        if (message.reload) reloadFrame()
        break
      case 'outsideChange':
        store.replaceIds(message.replacedIds)
        if (message.file === store.getState().board) reloadFrame()
        break
    }
    for (const listener of listeners) listener(message)
  }

  socket.addEventListener('open', () => {
    for (const message of unsent.splice(0)) socket.send(JSON.stringify(message))
  })
  socket.addEventListener('message', (event: MessageEvent<string>) => receive(JSON.parse(event.data) as ServerMessage))

  // Ops are refused rather than queued during a push: a push may rewrite files, leaving queued ids stale.
  const pushing = () => store.getState().readOnly

  return {
    sendOp(op, previewed) {
      if (pushing()) return Promise.reject(new Error(`${PUSH_IN_PROGRESS}: the edit was not applied`))
      const opId = `op-${nextOpId++}`
      const ack = new Promise<AckMessage>((resolve, reject) => pending.set(opId, { op, previewed, resolve, reject, carried: [] }))
      send({ type: 'op', opId, op })
      return ack
    },
    undo() {
      if (!pushing()) send({ type: 'undo' })
    },
    redo() {
      if (!pushing()) send({ type: 'redo' })
    },
    send,
    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      socket.close()
    },
  }
}
