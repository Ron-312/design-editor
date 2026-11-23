import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROBE_HANDSHAKE, type EditorToProbe, type ProbeRead, type ProbeReadResult, type ProbeToEditor } from '../../src/shared/protocol'
import type { EdId } from '../../src/shared/types'
import { createProbeClient, type ProbeClient } from '../../src/ui/probe-client'

const edId = (id: string) => id as EdId

const SENTINEL: ProbeToEditor = { type: 'scrolled', scrollX: -1, scrollY: -1 }

class FakeFrame extends EventTarget {
  readonly contentWindow = {
    postMessage: vi.fn<(message: unknown, targetOrigin: string, transfer?: Transferable[]) => void>(),
  }

  load(): void {
    this.dispatchEvent(new Event('load'))
  }

  handshakes() {
    return this.contentWindow.postMessage.mock.calls
  }

  lastTransferredPort(): MessagePort {
    const transfer = this.handshakes().at(-1)?.[2]
    const port = transfer?.[0]
    if (!(port instanceof MessagePort)) throw new Error('no port was transferred')
    return port
  }
}

interface FakeProbe {
  readonly received: EditorToProbe[]
  send(payload: unknown): void
}

const openPorts: MessagePort[] = []

function attachFakeProbe(port: MessagePort): FakeProbe {
  openPorts.push(port)
  const received: EditorToProbe[] = []
  port.onmessage = (event: MessageEvent<EditorToProbe>) => received.push(event.data)
  return { received, send: (payload) => port.postMessage(payload) }
}

let frame: FakeFrame
let hostWindow: EventTarget
let client: ProbeClient
let listener: ReturnType<typeof vi.fn<(message: ProbeToEditor) => void>>

function loadAndAttach(): FakeProbe {
  frame.load()
  return attachFakeProbe(frame.lastTransferredPort())
}

async function untilSentinelDelivered(probe: FakeProbe): Promise<ProbeToEditor[]> {
  probe.send(SENTINEL)
  await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(SENTINEL))
  return listener.mock.calls.map(([message]) => message).filter((message) => JSON.stringify(message) !== JSON.stringify(SENTINEL))
}

beforeEach(() => {
  hostWindow = new EventTarget()
  vi.stubGlobal('window', hostWindow)
  frame = new FakeFrame()
  client = createProbeClient(frame as unknown as HTMLIFrameElement)
  listener = vi.fn<(message: ProbeToEditor) => void>()
  client.onMessage(listener)
})

afterEach(() => {
  client.dispose()
  for (const port of openPorts.splice(0)) port.close()
  vi.unstubAllGlobals()
})

describe('handshake', () => {
  it('posts nothing until the iframe loads', () => {
    expect(frame.handshakes()).toHaveLength(0)

    frame.load()

    expect(frame.handshakes()).toHaveLength(1)
  })

  it("posts one handshake to '*' with one port of a fresh MessageChannel on each load", () => {
    frame.load()
    frame.load()

    const calls = frame.handshakes()
    expect(calls).toHaveLength(2)
    for (const [message, targetOrigin, transfer] of calls) {
      expect(message).toMatchObject({ type: PROBE_HANDSHAKE })
      expect(targetOrigin).toBe('*')
      expect(transfer).toHaveLength(1)
      expect(transfer?.[0]).toBeInstanceOf(MessagePort)
    }
    expect(calls[0]?.[2]?.[0]).not.toBe(calls[1]?.[2]?.[0])
    for (const [, , transfer] of calls) openPorts.push(transfer?.[0] as MessagePort)
  })

  it('ignores window message events, even ones shaped like probe messages or carrying a port', async () => {
    const probe = loadAndAttach()
    const forged = new MessageChannel()
    openPorts.push(forged.port1, forged.port2)
    const forgedReady: ProbeToEditor = { type: 'ready', scrollX: 1, scrollY: 1 }

    hostWindow.dispatchEvent(new MessageEvent('message', { data: forgedReady }))
    hostWindow.dispatchEvent(new MessageEvent('message', { data: { type: PROBE_HANDSHAKE }, ports: [forged.port2] }))
    forged.port1.postMessage(forgedReady)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const realReady: ProbeToEditor = { type: 'ready', scrollX: 0, scrollY: 40 }
    probe.send(realReady)

    expect(await untilSentinelDelivered(probe)).toEqual([realReady])
    expect(frame.handshakes()).toHaveLength(1)
  })
})

describe('probe-to-editor payloads', () => {
  it('drops every payload that does not match the schema', async () => {
    const probe = loadAndAttach()
    const invalid: unknown[] = [
      null,
      'ready',
      42,
      { type: 'unknownType' },
      { type: 'ready', scrollX: '0', scrollY: 0 },
      { type: 'scrolled', scrollX: 1 },
      { type: 'fontsFailed', families: [42] },
      { type: 'textCancelled', session: 's1', reason: 'bored' },
      { type: 'readResult', id: 'one', results: [] },
      { type: 'readResult', id: 1, results: [{ kind: 'rects', rects: [{ x: 0 }] }] },
    ]
    for (const payload of invalid) probe.send(payload)
    const fontsFailed: ProbeToEditor = { type: 'fontsFailed', families: ['Inter'] }
    probe.send(fontsFailed)

    expect(await untilSentinelDelivered(probe)).toEqual([fontsFailed])
  })

  it('accepts a text commit only for the session and element the editor opened', async () => {
    const probe = loadAndAttach()

    const session = client.beginTextEdit(edId('e1'))

    await vi.waitFor(() =>
      expect(probe.received).toContainEqual({ type: 'beginTextEdit', session, edId: edId('e1') }),
    )
    probe.send({ type: 'textCommit', session: `${session}-forged`, edId: edId('e1'), text: 'forged session' })
    probe.send({ type: 'textCommit', session, edId: edId('e2'), text: 'other element' })
    const commit: ProbeToEditor = { type: 'textCommit', session, edId: edId('e1'), text: 'Hello' }
    probe.send(commit)

    expect(await untilSentinelDelivered(probe)).toEqual([commit])
  })

  it('drops a text commit for a session the editor already ended', async () => {
    const probe = loadAndAttach()
    const session = client.beginTextEdit(edId('e1'))

    client.endTextEdit(session)

    await vi.waitFor(() => expect(probe.received).toContainEqual({ type: 'endTextEdit', session }))
    probe.send({ type: 'textCommit', session, edId: edId('e1'), text: 'too late' })

    expect(await untilSentinelDelivered(probe)).toEqual([])
  })
})

describe('reads', () => {
  const rectsRead: ProbeRead = { kind: 'rects', edId: edId('e1') }
  const supportsRead: ProbeRead = { kind: 'supports', condition: 'display: grid' }
  const rectsResult: ProbeReadResult = { kind: 'rects', rects: [{ x: 10, y: 20, width: 30, height: 40 }] }
  const supportsResult: ProbeReadResult = { kind: 'supports', supported: true }

  function answer(read: ProbeRead): ProbeReadResult {
    return read.kind === 'rects' ? rectsResult : supportsResult
  }

  function readRequests(probe: FakeProbe) {
    return probe.received.filter((message) => message.type === 'read')
  }

  it('sends reads over the port and resolves each one from the batched result', async () => {
    const probe = loadAndAttach()

    const rects = client.read(rectsRead)
    const supports = client.read(supportsRead)

    await vi.waitFor(() => expect(readRequests(probe).flatMap((request) => request.reads)).toHaveLength(2))
    const requests = readRequests(probe)
    expect(requests.flatMap((request) => request.reads)).toEqual([rectsRead, supportsRead])
    expect(new Set(requests.map((request) => request.id)).size).toBe(requests.length)
    for (const request of [...requests].reverse()) {
      probe.send({ type: 'readResult', id: request.id, results: request.reads.map(answer) })
    }

    await expect(rects).resolves.toEqual(rectsResult)
    await expect(supports).resolves.toEqual(supportsResult)
  })
})
