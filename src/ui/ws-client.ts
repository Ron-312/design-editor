import { WS_PATH, WS_TOKEN_PARAM, type ClientMessage, type ResolvedValues, type ServerMessage } from '../shared/protocol'
import type { EdId, EditOp } from '../shared/types'
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
  readonly previewed: ResolvedValues
  readonly resolve: (ack: AckMessage) => void
  readonly reject: (error: Error) => void
}

const PUSH_IN_PROGRESS = 'Push in progress'

function previewMatchesDisk(previewed: ResolvedValues, resolved: ResolvedValues): boolean {
  return Object.entries(previewed).every(([edId, value]) => resolved[edId as EdId] === value)
}

export function connectWsClient({ host, token, store, reloadFrame }: WsClientOptions): WsClient {
  const url = new URL(`ws://${host}${WS_PATH}`)
  url.searchParams.set(WS_TOKEN_PARAM, token)
  const socket = new WebSocket(url)
  const pending = new Map<string, PendingOp>()
  const listeners = new Set<(message: ServerMessage) => void>()
  const unsent: ClientMessage[] = []
  let nextOpId = 1

  function send(message: ClientMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    else unsent.push(message)
  }

  function settleAck(ack: AckMessage): void {
    const op = pending.get(ack.opId)
    if (!op) return
    pending.delete(ack.opId)
    store.addRecord(ack.record)
    if (ack.reload) {
      reloadFrame()
    } else if (!previewMatchesDisk(op.previewed, ack.resolved)) {
      store.toast({ message: 'The saved file shows a different value than the preview; reloaded from disk', tone: 'warning' })
      reloadFrame()
    }
    op.resolve(ack)
  }

  function settleRejection(opId: string, reason: string): void {
    const op = pending.get(opId)
    if (!op) return
    pending.delete(opId)
    store.toast({ message: reason, tone: 'error' })
    if (Object.keys(op.previewed).length > 0) reloadFrame()
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
      const ack = new Promise<AckMessage>((resolve, reject) => pending.set(opId, { previewed, resolve, reject }))
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
