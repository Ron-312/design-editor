import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as bundle } from 'esbuild'
import { register } from 'tsx/esm/api'
import { build as buildUi } from 'vite'

const REPO = fileURLToPath(new URL('../', import.meta.url))
const APP = path.join(REPO, 'build', 'app')
const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'))

rmSync(APP, { recursive: true, force: true })
mkdirSync(APP, { recursive: true })

await buildUi({ configFile: path.join(REPO, 'vite.config.ts'), logLevel: 'warn' })
cpSync(path.join(REPO, 'dist', 'ui'), path.join(APP, 'ui'), { recursive: true })

register()
const { buildProbeBundle } = await import('../src/probe/bundle.ts')
writeFileSync(path.join(APP, 'probe.js'), await buildProbeBundle())

await bundle({
  entryPoints: [path.join(REPO, 'src', 'desktop', 'main.ts')],
  outfile: path.join(APP, 'main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // vite is only reached by the dev server and the on-demand UI build, neither of which the app runs.
  external: ['electron', 'vite'],
  // Bundled CommonJS dependencies (write-file-atomic, cross-spawn) expect require and __filename.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module'",
      "import { fileURLToPath as __fileURLToPath } from 'node:url'",
      'const require = __createRequire(import.meta.url)',
      'const __filename = __fileURLToPath(import.meta.url)',
      "const __dirname = __filename.slice(0, Math.max(__filename.lastIndexOf('/'), __filename.lastIndexOf('\\\\')))",
    ].join(';\n'),
  },
  logLevel: 'warning',
})

writeFileSync(
  path.join(APP, 'package.json'),
  `${JSON.stringify({ name: pkg.name, productName: 'Design Editor', version: pkg.version, description: pkg.description, author: pkg.author, type: 'module', main: 'main.mjs' }, null, 2)}\n`,
)
console.log(`built the app into ${path.relative(REPO, APP)}`)
