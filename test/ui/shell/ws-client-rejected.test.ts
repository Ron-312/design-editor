// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMessage, ServerMessage } from '../../../src/shared/protocol'
import type { EdId, EditOp } from '../../../src/shared/types'
import { createEditorStore, type EditorStore } from '../../../src/ui/store'
import { connectWsClient, type WsClient } from '../../../src/ui/ws-client'

class FakeSocket extends EventTarget {
  static readonly OPEN = 1
  static latest: FakeSocket | null = null
  readyState = FakeSocket.OPEN
  readonly sent: ClientMessage[] = []

  constructor(readonly url: string | URL) {
    super()
    FakeSocket.latest = this
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage)
  }

  close() {}

  receive(message: ServerMessage) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
  }
}

const setColor: EditOp = { target: ['e1' as EdId], kind: 'setDecl', payload: { prop: 'color', value: 'red' } }

let store: EditorStore
let reloadFrame: ReturnType<typeof vi.fn<() => void>>
let client: WsClient
let socket: FakeSocket

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  store = createEditorStore()
  reloadFrame = vi.fn<() => void>()
  client = connectWsClient({ host: '127.0.0.1:5300', token: 'token', store, reloadFrame })
  socket = FakeSocket.latest!
})

afterEach(() => {
  FakeSocket.latest = null
  vi.unstubAllGlobals()
})

function sentOpId(): string {
  const sent = socket.sent.filter((message) => message.type === 'op').at(-1)
  if (sent?.type !== 'op') throw new Error('no op was sent')
  return sent.opId
}

describe('a rejected op', () => {
  it('rejects its promise with the reason, shows it as an error toast and reloads the previewed frame', async () => {
    const ack = client.sendOp(setColor, { ['e1' as EdId]: 'red' })

    socket.receive({ type: 'rejected', opId: sentOpId(), reason: 'the node is gone' })

    await expect(ack).rejects.toThrow('the node is gone')
    expect(store.getState().toasts).toEqual([expect.objectContaining({ message: 'the node is gone', tone: 'error' })])
    expect(reloadFrame).toHaveBeenCalledTimes(1)
    expect(store.getState().records).toEqual([])
  })

  it('does not reload when the op previewed nothing', async () => {
    const ack = client.sendOp(setColor, {})

    socket.receive({ type: 'rejected', opId: sentOpId(), reason: 'refused' })

    await expect(ack).rejects.toThrow('refused')
    expect(reloadFrame).not.toHaveBeenCalled()
  })

  it('ignores a rejection for an op it is not waiting on, and a second one for the same op', async () => {
    const ack = client.sendOp(setColor, { ['e1' as EdId]: 'red' })
    const opId = sentOpId()

    socket.receive({ type: 'rejected', opId: 'op-999', reason: 'stray' })
    socket.receive({ type: 'rejected', opId, reason: 'first' })
    socket.receive({ type: 'rejected', opId, reason: 'second' })

    await expect(ack).rejects.toThrow('first')
    expect(store.getState().toasts.map((toast) => toast.message)).toEqual(['first'])
    expect(reloadFrame).toHaveBeenCalledTimes(1)
  })

  it('still hands the rejection to message listeners', () => {
    const heard: ServerMessage[] = []
    client.onMessage((message) => heard.push(message))
    void client.sendOp(setColor, {}).catch(() => {})

    socket.receive({ type: 'rejected', opId: sentOpId(), reason: 'refused' })

    expect(heard).toEqual([{ type: 'rejected', opId: sentOpId(), reason: 'refused' }])
  })
})
