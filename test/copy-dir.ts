import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * A recursive copy for test fixtures. Node 22's native `cpSync` copies nothing, without an error,
 * into a destination with non-ASCII characters on Windows, and the fixtures live under "Café board ü".
 */
export function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(source, target)
    else copyFileSync(source, target)
  }
}
