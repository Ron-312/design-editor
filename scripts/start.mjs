import { register } from 'tsx/esm/api'

register()
const { parseArgs, startEditor } = await import('../src/server/main.ts')

try {
  const editor = await startEditor(parseArgs(process.argv.slice(2)))
  const stop = () => void editor.close()
  // SIGTERM runs no handler on Windows, so shutdown rides on SIGINT, SIGBREAK, stdin close and POST /shutdown.
  for (const signal of ['SIGINT', 'SIGBREAK']) process.on(signal, stop)
  process.stdin.on('end', stop).resume()
  await editor.closed
  process.exit(0)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
