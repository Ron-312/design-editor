import net from 'node:net'
import { LOOPBACK_HOST, projectPortFor } from '../shared/protocol'

const LAST_PORT = 65_534

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, LOOPBACK_HOST, () => server.close(() => resolve(true)))
  })
}

/** The first editor port from `start` whose project port (the next one) is free too; the app runs beside a terminal editor on 5300. */
export async function findFreePortPair(start: number, isFree: (port: number) => Promise<boolean> = isPortFree): Promise<number> {
  for (let port = start; projectPortFor(port) <= LAST_PORT; port += 2) {
    if ((await isFree(port)) && (await isFree(projectPortFor(port)))) return port
  }
  throw new Error(`no free pair of ports from ${start} up`)
}
