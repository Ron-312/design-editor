import { parseProbeToEditor } from '../shared/probe-schema'
import { PROBE_HANDSHAKE, type EditorToProbe, type ProbeRead, type ProbeReadResult, type ProbeToEditor } from '../shared/protocol'
import type { EdId } from '../shared/types'
import type { Unsubscribe } from './plugin-api'

export type ReadResultFor<R extends ProbeRead> = Extract<ProbeReadResult, { kind: R['kind'] }>

export interface ProbeClient {
  readonly onMessage: (listener: (message: ProbeToEditor) => void) => Unsubscribe
  readonly read: <R extends ProbeRead>(read: R) => Promise<ReadResultFor<R>>
  readonly previewDecl: (edIds: readonly EdId[], prop: string, value: string | null) => void
  readonly scrollTo: (x: number, y: number) => void
  /** Re-send on every probe `ready`: a reload drops the stylesheet with the old document. */
  readonly setEditorStyles: (css: string | null) => void
  /** Returns the session id; only commits for this session and element are delivered. */
  readonly beginTextEdit: (edId: EdId) => string
  readonly endTextEdit: (session: string) => void
  readonly dispose: () => void
}

interface PendingRead {
  readonly read: ProbeRead
  readonly resolve: (result: ProbeReadResult) => void
  readonly reject: (error: Error) => void
}

export function createProbeClient(frame: HTMLIFrameElement): ProbeClient {
  const listeners = new Set<(message: ProbeToEditor) => void>()
  const textSessions = new Map<string, EdId>()
  const inFlight = new Map<number, readonly PendingRead[]>()
  let queued: PendingRead[] = []
  let port: MessagePort | null = null
  let nextReadId = 1
  let nextSession = 1

  function post(message: EditorToProbe): void {
    port?.postMessage(message)
  }

  function rejectInFlight(reason: string): void {
    for (const batch of inFlight.values()) for (const pending of batch) pending.reject(new Error(reason))
    inFlight.clear()
  }

  function flushReads(): void {
    if (!port || queued.length === 0) return
    const batch = queued
    queued = []
    const id = nextReadId++
    inFlight.set(id, batch)
    post({ type: 'read', id, reads: batch.map((pending) => pending.read) })
  }

  function settleReads(id: number, results: readonly ProbeReadResult[]): void {
    const batch = inFlight.get(id)
    if (!batch) return
    inFlight.delete(id)
    batch.forEach((pending, i) => {
      const result = results[i]
      if (result?.kind === pending.read.kind) pending.resolve(result)
      else pending.reject(new Error(`probe answered a '${pending.read.kind}' read with ${result?.kind ?? 'nothing'}`))
    })
  }

  function isOwnTextMessage(message: ProbeToEditor): boolean {
    if (message.type === 'textCommit') return textSessions.get(message.session) === message.edId
    if (message.type === 'textCancelled') return textSessions.delete(message.session)
    return true
  }

  function receive(event: MessageEvent): void {
    const message = parseProbeToEditor(event.data)
    if (!message || !isOwnTextMessage(message)) return
    if (message.type === 'readResult') settleReads(message.id, message.results)
    for (const listener of listeners) listener(message)
  }

  function handshake(): void {
    port?.close()
    rejectInFlight('the frame reloaded before the probe answered')
    textSessions.clear()
    const channel = new MessageChannel()
    port = channel.port1
    port.onmessage = receive
    frame.contentWindow?.postMessage({ type: PROBE_HANDSHAKE }, '*', [channel.port2])
    flushReads()
  }

  frame.addEventListener('load', handshake)

  return {
    onMessage(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read<R extends ProbeRead>(read: R) {
      return new Promise<ReadResultFor<R>>((resolve, reject) => {
        if (queued.length === 0) queueMicrotask(flushReads)
        queued.push({ read, resolve: resolve as (result: ProbeReadResult) => void, reject })
      })
    },
    previewDecl(edIds, prop, value) {
      post({ type: 'previewDecl', edIds, prop, value })
    },
    scrollTo(x, y) {
      post({ type: 'scrollTo', x, y })
    },
    setEditorStyles(css) {
      post({ type: 'setEditorStyles', css })
    },
    beginTextEdit(edId) {
      const session = `text-${nextSession++}`
      textSessions.set(session, edId)
      post({ type: 'beginTextEdit', session, edId })
      return session
    },
    endTextEdit(session) {
      textSessions.delete(session)
      post({ type: 'endTextEdit', session })
    },
    dispose() {
      frame.removeEventListener('load', handshake)
      rejectInFlight('the probe client was disposed')
      port?.close()
      port = null
    },
  }
}
