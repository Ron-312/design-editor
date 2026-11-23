import spawn from 'cross-spawn'

const STEPS = [
  ['eslint', ['.']],
  ['tsc', ['--noEmit', '-p', 'tsconfig.json']],
  ['vitest', ['run']],
]

function runStep(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawn.sync(command, args, { stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  return result.status ?? 1
}

for (const [command, args] of STEPS) {
  const status = runStep(command, args)
  if (status !== 0) process.exit(status)
}
