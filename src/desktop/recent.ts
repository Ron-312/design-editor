import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MAX_RECENT = 8

/** A folder `/design-pull` made: it holds the canvas under `project/`. */
export function isPulledCanvas(dir: string): boolean {
  return existsSync(path.join(dir, 'project', 'canvas.json'))
}

/** Most recent first, without duplicates, at most eight. */
export function withRecent(recent: readonly string[], dir: string): string[] {
  return [dir, ...recent.filter((entry) => entry !== dir)].slice(0, MAX_RECENT)
}

export async function readRecent(file: string): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

export async function writeRecent(file: string, recent: readonly string[]): Promise<void> {
  await writeFile(file, `${JSON.stringify(recent, null, 2)}\n`)
}
