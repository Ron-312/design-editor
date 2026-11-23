import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { findFreePortPair, isPortFree } from '../../src/desktop/ports'

const open: net.Server[] = []

afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

function occupy(port: number): Promise<void> {
  const server = net.createServer()
  open.push(server)
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve()))
}

describe('findFreePortPair', () => {
  it('returns the first port whose next port is free too, stepping by two', async () => {
    const taken = new Set([5310, 5313])

    expect(await findFreePortPair(5310, async (port) => !taken.has(port))).toBe(5314)
  })

  it('takes the start itself when both ports are free', async () => {
    expect(await findFreePortPair(5310, async () => true)).toBe(5310)
  })

  it('gives up past the last port', async () => {
    await expect(findFreePortPair(65_530, async () => false)).rejects.toThrow('no free pair of ports from 65530 up')
  })
})

describe('isPortFree', () => {
  it('is false for a port something listens on and true once it closes', async () => {
    const probe = net.createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
    const { port } = probe.address() as net.AddressInfo
    await new Promise((resolve) => probe.close(resolve))

    await occupy(port)
    expect(await isPortFree(port)).toBe(false)
    await Promise.all(open.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
    expect(await isPortFree(port)).toBe(true)
  })
})
