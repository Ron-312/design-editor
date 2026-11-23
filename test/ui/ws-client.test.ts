import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import { WS_PATH, WS_TOKEN_PARAM, type ClientMessage, type ResolvedValues, type ServerMessage } from '../../src/shared/protocol'
import type { EdId, EditOp, ProjectPath } from '../../src/shared/types'
import { createEditorStore } from '../../src/ui/store'
import { connectWsClient, type WsClient } from '../../src/ui/ws-client'

const edId = (id: string) => id as EdId
const TOKEN = 'launch-token-6f1c'

const setColor: EditOp = { target: [edId('e1'), edId('e2')], kind: 'setDecl', payload: { prop: 'color', value: 'red' } }
const setWidth: EditOp = { target: [edId('e3')], kind: 'setDecl', payload: { prop: 'width', value: '10px' } }

function setDeclIn(actionId: string, prop: string, value: string): EditOp {
  return { target: [edId('e3')], kind: 'setDecl', payload: { prop, value }, actionId }
}

interface ServerSide {
  readonly requestUrl: URL
  readonly received: ClientMessage[]
  send(message: ServerMessage): void
}

let wss: WebSocketServer
let connected: Promise<ServerSide>
let store: ReturnType<typeof createEditorStore>
let reloadFrame: ReturnType<typeof vi.fn<() => void>>
let client: WsClient

function acceptOneConnection(server: WebSocketServer): Promise<ServerSide> {
  return new Promise((resolve) => {
    server.once('connection', (socket: ServerSocket, request) => {
      const received: ClientMessage[] = []
      socket.on('message', (data) => received.push(JSON.parse(data.toString()) as ClientMessage))
      resolve({
        requestUrl: new URL(request.url ?? '', 'http://127.0.0.1'),
        received,
        send: (message) => socket.send(JSON.stringify(message)),
      })
    })
  })
}

function opsReceived(server: ServerSide) {
  return server.received.filter((message) => message.type === 'op')
}

function ackFor(opId: string, op: EditOp, resolved: ResolvedValues): ServerMessage {
  return {
    type: 'ack',
    opId,
    record: {
      target: op.target,
      kind: op.kind,
      prop: 'prop' in op.payload ? op.payload.prop : null,
      before: null,
      after: 'value' in op.payload ? op.payload.value : null,
      scope: { kind: 'element' },
      files: ['project/hero.dc.html' as ProjectPath],
    },
    mintedIds: [],
    locations: {},
    resolved,
    reload: false,
    warnings: [],
  }
}

async function sendAndAck(op: EditOp, previewed: ResolvedValues, resolved: ResolvedValues) {
  const server = await connected
  const ack = client.sendOp(op, previewed)
  await vi.waitFor(() => expect(opsReceived(server)).toHaveLength(1))
  const [sent] = opsReceived(server)
  server.send(ackFor(sent?.opId ?? '', op, resolved))
  return ack
}

beforeEach(async () => {
  wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()))
  connected = acceptOneConnection(wss)
  store = createEditorStore()
  reloadFrame = vi.fn<() => void>()
  const { port } = wss.address() as AddressInfo
  client = connectWsClient({ host: `127.0.0.1:${port}`, token: TOKEN, store, reloadFrame })
})

afterEach(async () => {
  client.close()
  for (const socket of wss.clients) socket.terminate()
  await new Promise<void>((resolve) => wss.close(() => resolve()))
})

describe('connection', () => {
  it('connects to the ws path with the per-launch token', async () => {
    const server = await connected

    expect(server.requestUrl.pathname).toBe(WS_PATH)
    expect(server.requestUrl.searchParams.get(WS_TOKEN_PARAM)).toBe(TOKEN)
  })
})

describe('ops and acks', () => {
  it('sends each op with its own opId and resolves it with the ack that carries that opId', async () => {
    const server = await connected

    const colorAck = client.sendOp(setColor, { [edId('e1')]: 'red', [edId('e2')]: 'red' })
    const widthAck = client.sendOp(setWidth, { [edId('e3')]: '10px' })

    await vi.waitFor(() => expect(opsReceived(server)).toHaveLength(2))
    const [colorSent, widthSent] = opsReceived(server)
    expect(colorSent).toEqual({ type: 'op', opId: expect.any(String), op: setColor })
    expect(widthSent).toEqual({ type: 'op', opId: expect.any(String), op: setWidth })
    expect(colorSent?.opId).not.toBe(widthSent?.opId)

    server.send(ackFor(widthSent?.opId ?? '', setWidth, { [edId('e3')]: '10px' }))
    server.send(ackFor(colorSent?.opId ?? '', setColor, { [edId('e1')]: 'red', [edId('e2')]: 'red' }))

    await expect(colorAck).resolves.toMatchObject({ type: 'ack', opId: colorSent?.opId })
    await expect(widthAck).resolves.toMatchObject({ type: 'ack', opId: widthSent?.opId })
  })

  it('keeps the preview when the acked value matches what was previewed', async () => {
    const previewed = { [edId('e1')]: 'red', [edId('e2')]: 'red' }

    await sendAndAck(setColor, previewed, previewed)

    expect(reloadFrame).not.toHaveBeenCalled()
    expect(store.getState().toasts).toEqual([])
  })

  it('raises a toast and reloads from disk when the acked value differs from the preview', async () => {
    await sendAndAck(
      setColor,
      { [edId('e1')]: 'red', [edId('e2')]: 'red' },
      { [edId('e1')]: 'red', [edId('e2')]: 'blue' },
    )

    expect(store.getState().toasts).toHaveLength(1)
    expect(reloadFrame).toHaveBeenCalledTimes(1)
  })
})

describe("one action's ops", () => {
  async function sendAll(ops: readonly EditOp[], previewedValues: readonly string[]) {
    const server = await connected
    const acks = ops.map((op, i) => client.sendOp(op, { [edId('e3')]: previewedValues[i]! }))
    await vi.waitFor(() => expect(opsReceived(server)).toHaveLength(ops.length))
    return { server, acks, opIds: opsReceived(server).map((sent) => sent.opId) }
  }

  it("sends the op's actionId with it", async () => {
    const op = setDeclIn('act-1', 'width', '10px')
    const { server, opIds } = await sendAll([op], ['10px'])

    expect(opsReceived(server)).toEqual([{ type: 'op', opId: opIds[0], op }])
  })

  it('gives a burst of three ops on one property one record, no toast and no reload', async () => {
    const burst = ['25px', '26px', '27px'].map((value) => setDeclIn('drag-1', 'top', value))
    const { server, acks, opIds } = await sendAll(burst, ['25px', '26px', '27px'])
    for (const opId of opIds) server.send(ackFor(opId, burst[2]!, { [edId('e3')]: '27px' }))

    const settled = await Promise.all(acks)
    expect(settled.map((ack) => ack.opId)).toEqual(opIds)
    expect(store.getState().records).toEqual([expect.objectContaining({ prop: 'top', after: '27px' })])
    expect(store.getState().toasts).toEqual([])
    expect(reloadFrame).not.toHaveBeenCalled()
  })

  it("still checks the burst's newest op against its preview", async () => {
    const burst = ['25px', '26px', '27px'].map((value) => setDeclIn('drag-1', 'top', value))
    const { server, acks, opIds } = await sendAll(burst, ['25px', '26px', '27px'])
    for (const opId of opIds) server.send(ackFor(opId, burst[2]!, { [edId('e3')]: '30px' }))

    await Promise.all(acks)
    expect(store.getState().toasts).toHaveLength(1)
    expect(reloadFrame).toHaveBeenCalledTimes(1)
    expect(store.getState().records).toHaveLength(1)
  })

  it('stays quiet and records each write when a held-arrow nudge has its earlier acks arrive superseded by a later press', async () => {
    const nudge = ['11px', '12px', '13px'].map((value) => setDeclIn('nudge-1', 'left', value))
    const { server, acks, opIds } = await sendAll(nudge, ['11px', '12px', '13px'])
    server.send(ackFor(opIds[0]!, nudge[1]!, { [edId('e3')]: '12px' }))
    server.send(ackFor(opIds[1]!, nudge[1]!, { [edId('e3')]: '12px' }))
    server.send(ackFor(opIds[2]!, nudge[2]!, { [edId('e3')]: '13px' }))

    await Promise.all(acks)
    expect(store.getState().toasts).toEqual([])
    expect(reloadFrame).not.toHaveBeenCalled()
    expect(store.getState().records).toEqual([
      expect.objectContaining({ prop: 'left', after: '12px' }),
      expect.objectContaining({ prop: 'left', after: '13px' }),
    ])
  })

  it('checks and records an op whose newer neighbour sets another property', async () => {
    const ops = [setDeclIn('act-2', 'top', '25px'), setDeclIn('act-2', 'left', '40px')]
    const { server, acks, opIds } = await sendAll(ops, ['25px', '40px'])

    server.send(ackFor(opIds[0]!, ops[0]!, { [edId('e3')]: '30px' }))
    server.send(ackFor(opIds[1]!, ops[1]!, { [edId('e3')]: '40px' }))

    await Promise.all(acks)
    expect(store.getState().toasts).toHaveLength(1)
    expect(reloadFrame).toHaveBeenCalledTimes(1)
    expect(store.getState().records.map((record) => record.prop)).toEqual(['top', 'left'])
  })
})

describe('outside edits', () => {
  it('reloads the open board and moves the selection onto the ids now at the replaced nodes’ element paths', async () => {
    const server = await connected
    const home = 'project/home.dc.html' as ProjectPath
    store.setBoard(home)
    store.select([edId('e5'), edId('e7')])

    server.send({ type: 'outsideChange', file: home, pendingOps: false, replacedIds: { [edId('e5')]: edId('e41') } })

    await vi.waitFor(() => expect(reloadFrame).toHaveBeenCalledTimes(1))
    expect(store.getState().view.selection).toEqual([edId('e41'), edId('e7')])
  })

  it('does not reload for a change to a board that is not open', async () => {
    const server = await connected
    store.setBoard('project/home.dc.html' as ProjectPath)

    server.send({ type: 'outsideChange', file: 'project/card.dc.html' as ProjectPath, pendingOps: false, replacedIds: {} })
    server.send({ type: 'pushLock', held: false })

    await vi.waitFor(() => expect(store.getState().readOnly).toBe(false))
    expect(reloadFrame).not.toHaveBeenCalled()
  })
})

describe('push lock', () => {
  it('refuses ops and undo locally while a push holds the lock', async () => {
    const server = await connected

    server.send({ type: 'pushLock', held: true })
    await vi.waitFor(() => expect(store.getState().readOnly).toBe(true))
    expect(store.getState().banners.map((banner) => banner.message)).toContainEqual(
      expect.stringMatching(/push in progress/i),
    )

    await expect(client.sendOp(setColor, { [edId('e1')]: 'red', [edId('e2')]: 'red' })).rejects.toThrow(
      /push in progress/i,
    )
    client.undo()

    server.send({ type: 'pushLock', held: false })
    await vi.waitFor(() => expect(store.getState().readOnly).toBe(false))
    client.undo()
    void client.sendOp(setWidth, { [edId('e3')]: '10px' })

    await vi.waitFor(() => expect(opsReceived(server)).toHaveLength(1))
    expect(server.received.filter((message) => message.type === 'op' || message.type === 'undo')).toEqual([
      { type: 'undo' },
      { type: 'op', opId: expect.any(String), op: setWidth },
    ])
  })
})
