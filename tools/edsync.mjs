import { register } from 'tsx/esm/api'

register()
const { runEdsync } = await import('../src/edsync/cli.ts')

const write = (stream, text) => new Promise((resolve) => (text ? stream.write(text, resolve) : resolve()))

const run = await runEdsync(process.argv.slice(2), { cwd: process.cwd() })
await write(process.stdout, run.stdout)
await write(process.stderr, run.stderr)
// A keep-alive socket to the editor would otherwise hold the process open for seconds.
process.exit(run.exitCode)
