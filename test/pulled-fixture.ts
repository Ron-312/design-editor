import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cacheFetched } from '../src/edsync/cache'

export const FIXTURE_RELEASE = 'fixture-release'
const FETCHED = fileURLToPath(new URL('./fixtures/canvas/fetched/', import.meta.url))

/** Fills `.editor/cache/` the way `/design-pull` does: the real `edsync cache` over the fetched fixture assets. */
export async function cacheFixtureAssets(root: string): Promise<void> {
  const { missing } = await cacheFetched({ projectDir: root, from: path.resolve(FETCHED), release: FIXTURE_RELEASE })
  if (missing.length > 0) throw new Error(`the fetched fixture lacks blobs: ${missing.join(', ')}`)
}
