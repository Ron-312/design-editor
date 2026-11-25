import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from '../core/atomic-write'
import { EDITOR_FILES } from '../shared/protocol'
import { canvasLink } from '../shared/push'

function canvasFileOf(projectDir: string): string {
  return path.join(projectDir, ...EDITOR_FILES.canvas.split('/'))
}

/** The canvas a project was pulled from; null for one pulled before the link was kept, or a file that does not hold one. */
export async function readCanvasLink(projectDir: string): Promise<string | null> {
  try {
    const { url } = JSON.parse(await readFile(canvasFileOf(projectDir), 'utf8')) as { url?: unknown }
    return typeof url === 'string' ? canvasLink(url) : null
  } catch {
    return null
  }
}

export async function saveCanvasLink(projectDir: string, url: string): Promise<void> {
  const file = canvasFileOf(projectDir)
  await mkdir(path.dirname(file), { recursive: true })
  await atomicWrite(file, Buffer.from(`${JSON.stringify({ url }, null, 2)}\n`))
}
