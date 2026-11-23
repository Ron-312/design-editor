import { fileURLToPath } from 'node:url'
import { build, type Rollup } from 'vite'

const PROBE_ENTRY = fileURLToPath(new URL('./probe.ts', import.meta.url))

function soleChunk(output: Awaited<ReturnType<typeof build>>): Rollup.OutputChunk {
  const [result] = Array.isArray(output) ? output : [output]
  const chunk = (result as Rollup.RollupOutput).output.find((item): item is Rollup.OutputChunk => item.type === 'chunk')
  if (!chunk) throw new Error('probe build produced no chunk')
  return chunk
}

/** The probe as one classic-script IIFE, inlined by the serving transform as the first script in `<head>`. */
export async function buildProbeBundle(): Promise<string> {
  const output = await build({
    configFile: false,
    logLevel: 'silent',
    publicDir: false,
    build: {
      write: false,
      emptyOutDir: false,
      minify: true,
      lib: { entry: PROBE_ENTRY, formats: ['iife'], name: 'designEditorProbe' },
    },
  })
  return soleChunk(output).code
}
