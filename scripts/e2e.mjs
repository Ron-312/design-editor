import spawn from 'cross-spawn'

const result = spawn.sync('playwright', ['test', '--pass-with-no-tests', ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
