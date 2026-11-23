// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMessage, ServerMessage } from '../../../src/shared/protocol'
import type { EdId, EditOp, EditRecord, ProjectPath } from '../../../src/shared/types'
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

function setDeclIn(actionId: string, prop: string, value: string): EditOp {
  return { target: ['e1' as EdId], kind: 'setDecl', payload: { prop, value }, actionId }
}

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

function sentOpIds(): string[] {
  return socket.sent.flatMap((message) => (message.type === 'op' ? [message.opId] : []))
}

describe('a refused action', () => {
  it('shows one toast and reloads once however many of its ops were refused', async () => {
    const ops = [setDeclIn('act-1', 'border-top-left-radius', '8px'), setDeclIn('act-1', 'border-top-right-radius', '8px'), setDeclIn('act-1', 'border-radius', '')]
    const acks = ops.map((op) => client.sendOp(op, { ['e1' as EdId]: '8px' }))

    for (const opId of sentOpIds()) socket.receive({ type: 'rejected', opId, reason: 'overlapping patches' })

    await Promise.all(acks.map((ack) => expect(ack).rejects.toThrow('overlapping patches')))
    expect(store.getState().toasts).toEqual([expect.objectContaining({ message: 'overlapping patches', tone: 'error' })])
    expect(reloadFrame).toHaveBeenCalledTimes(1)
  })

  it('reloads once when only a later op of the action previewed', async () => {
    const first = client.sendOp(setDeclIn('act-2', 'display', 'flex'), {})
    const second = client.sendOp(setDeclIn('act-2', 'gap', '8px'), { ['e1' as EdId]: '8px' })

    for (const opId of sentOpIds()) socket.receive({ type: 'rejected', opId, reason: 'refused' })

    await Promise.all([first, second].map((ack) => expect(ack).rejects.toThrow('refused')))
    expect(store.getState().toasts).toHaveLength(1)
    expect(reloadFrame).toHaveBeenCalledTimes(1)
  })

  it('shows a toast for each of two separate actions', async () => {
    const first = client.sendOp(setDeclIn('act-3', 'color', 'red'), { ['e1' as EdId]: 'red' })
    const second = client.sendOp(setDeclIn('act-4', 'color', 'blue'), { ['e1' as EdId]: 'blue' })

    const [firstId, secondId] = sentOpIds()
    socket.receive({ type: 'rejected', opId: firstId!, reason: 'first' })
    socket.receive({ type: 'rejected', opId: secondId!, reason: 'second' })

    await Promise.all([expect(first).rejects.toThrow('first'), expect(second).rejects.toThrow('second')])
    expect(store.getState().toasts.map((toast) => toast.message)).toEqual(['first', 'second'])
  })
})

describe('an action refused while another of its ops was pending', () => {
  it('toasts and reloads again for a later refusal once that op was acked', async () => {
    const left = setDeclIn('held-1', 'left', '1px')
    const top = setDeclIn('held-1', 'top', '2px')
    const refused = client.sendOp(left, { ['e1' as EdId]: '1px' })
    const acked = client.sendOp(top, { ['e1' as EdId]: '2px' })
    const [refusedId, ackedId] = sentOpIds()
    socket.receive({ type: 'rejected', opId: refusedId!, reason: 'refused A' })
    socket.receive(ackOf(ackedId!, recordOf('top', null, '2px'), '2px'))
    await Promise.all([expect(refused).rejects.toThrow('refused A'), acked])

    const later = client.sendOp(setDeclIn('held-1', 'left', '3px'), { ['e1' as EdId]: '3px' })
    socket.receive({ type: 'rejected', opId: sentOpId(), reason: 'refused C' })

    await expect(later).rejects.toThrow('refused C')
    expect(store.getState().toasts.map((toast) => toast.message)).toEqual(['refused A', 'refused C'])
    expect(reloadFrame).toHaveBeenCalledTimes(2)
  })
})

function recordOf(prop: string, before: string | null, after: string): EditRecord {
  return { target: ['e1' as EdId], kind: 'setDecl', prop, before, after, scope: { kind: 'element' }, files: ['project/home.dc.html' as ProjectPath] }
}

function ackOf(opId: string, record: EditRecord, value: string): ServerMessage {
  return { type: 'ack', opId, record, mintedIds: [], locations: {}, resolved: { ['e1' as EdId]: value }, reload: false, warnings: [] }
}

describe('an op acked in an earlier write than a newer op of its action on the same property', () => {
  const first = recordOf('width', '100px', '120px')
  const second = recordOf('width', '120px', '140px')

  it('keeps its record when the newer op is refused', async () => {
    const written = client.sendOp(setDeclIn('drag-1', 'width', '120px'), { ['e1' as EdId]: '120px' })
    const refused = client.sendOp(setDeclIn('drag-1', 'width', '140px'), { ['e1' as EdId]: '140px' })
    const [writtenId, refusedId] = sentOpIds()

    socket.receive(ackOf(writtenId!, first, '120px'))
    socket.receive({ type: 'rejected', opId: refusedId!, reason: 'refused' })

    await Promise.all([written, expect(refused).rejects.toThrow('refused')])
    expect(store.getState().records).toEqual([first])
  })

  it('records both writes when the newer op lands in its own write', async () => {
    const written = client.sendOp(setDeclIn('drag-1', 'width', '120px'), { ['e1' as EdId]: '120px' })
    const newer = client.sendOp(setDeclIn('drag-1', 'width', '140px'), { ['e1' as EdId]: '140px' })
    const [writtenId, newerId] = sentOpIds()

    socket.receive(ackOf(writtenId!, first, '120px'))
    socket.receive(ackOf(newerId!, second, '140px'))

    await Promise.all([written, newer])
    expect(store.getState().records).toEqual([first, second])
    expect(store.getState().toasts).toEqual([])
  })

  it('records a write once when the newer op was folded into it', async () => {
    const acks = ['120px', '140px'].map((value) => client.sendOp(setDeclIn('drag-1', 'width', value), { ['e1' as EdId]: value }))
    const folded = recordOf('width', '100px', '140px')

    for (const opId of sentOpIds()) socket.receive(ackOf(opId, folded, '140px'))

    await Promise.all(acks)
    expect(store.getState().records).toEqual([folded])
  })
})

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
