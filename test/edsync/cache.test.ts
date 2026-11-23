import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cacheFetched, rewriteBlobs } from '../../src/edsync/cache'
import { EDITOR_FILES } from '../../src/shared/protocol'

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const FETCHED = path.join(FIXTURES, 'canvas', 'fetched')
const FIXTURE_PROJECT = path.join(FIXTURES, 'canvas', 'project')
const CSS_BLOB = 'b1a2c3d4e5f60718293a4b5c6d7e8f90'
const SVG_BLOB = '0f1e2d3c4b5a69788796a5b4c3d2e1f0'
const CSS_FILE = `${CSS_BLOB}.css`
const SVG_FILE = `${SVG_BLOB}.svg`
const RELEASE = 'stand-in'
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

const blobId = (digit: string) => digit.repeat(32)

let sandbox: string
let projectDir: string
let cacheDir: string
let roundCount: number

beforeEach(() => {
  sandbox = mkdtempSync(path.join(os.tmpdir(), 'edsync-cache-'))
  projectDir = path.join(sandbox, 'projects', 'test-site')
  cacheDir = path.join(projectDir, ...EDITOR_FILES.cache.split('/'))
  mkdirSync(projectDir, { recursive: true })
  roundCount = 0
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

function scratchRound(files: Record<string, string | Buffer>): string {
  roundCount += 1
  const dir = path.join(sandbox, `scratch-${roundCount}`)
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content)
  return dir
}

function fetchedFixture(name: string): Buffer {
  return readFileSync(path.join(FETCHED, name))
}

describe('cacheFetched', () => {
  it('copies blobs by id and support.js by release, byte for byte', async () => {
    const from = scratchRound({ [CSS_FILE]: fetchedFixture(CSS_FILE), 'support.js': fetchedFixture('support.js') })
    const output = await cacheFetched({ projectDir, from, release: RELEASE })

    expect([...output.copied].sort()).toEqual([CSS_BLOB, 'support.js'].sort())
    expect(readFileSync(path.join(cacheDir, CSS_FILE)).equals(fetchedFixture(CSS_FILE))).toBe(true)
    expect(readFileSync(path.join(cacheDir, RELEASE, 'support.js')).equals(fetchedFixture('support.js'))).toBe(true)
  })

  it('reports the url() blob a fetched stylesheet references, then nothing once it is fetched', async () => {
    const firstRound = scratchRound({ [CSS_FILE]: fetchedFixture(CSS_FILE), 'support.js': fetchedFixture('support.js') })
    const first = await cacheFetched({ projectDir, from: firstRound, release: RELEASE })
    expect(first.missing).toEqual([SVG_BLOB])

    const secondRound = scratchRound({ [SVG_FILE]: fetchedFixture(SVG_FILE) })
    const second = await cacheFetched({ projectDir, from: secondRound, release: RELEASE })
    expect(second.missing).toEqual([])
    expect(readFileSync(path.join(cacheDir, SVG_FILE)).equals(fetchedFixture(SVG_FILE))).toBe(true)
  })

  it('does not report a referenced blob that an earlier round already cached', async () => {
    await cacheFetched({ projectDir, from: scratchRound({ [SVG_FILE]: fetchedFixture(SVG_FILE) }), release: RELEASE })
    const output = await cacheFetched({
      projectDir,
      from: scratchRound({ [CSS_FILE]: fetchedFixture(CSS_FILE) }),
      release: RELEASE,
    })
    expect(output.missing).toEqual([])
  })

  it('scans fetched CSS and JS for quoted, unquoted and script /_blob references', async () => {
    const stylesheetId = blobId('a')
    const scriptId = blobId('b')
    const from = scratchRound({
      [`${stylesheetId}.css`]: [
        `@font-face { src: url("/_blob/${blobId('1')}") format("woff2"); }`,
        `.a { background: url('/_blob/${blobId('2')}'); }`,
        `.b { background: url(/_blob/${blobId('3')}); }`,
        `.c { background: url(data:image/png;base64,AAAA); }`,
        `.d { background: url(/_blob/${scriptId}); }`,
      ].join('\n'),
      [`${scriptId}.js`]: `fetch('/_blob/${blobId('4')}').then((r) => r.json())\n`,
    })
    const output = await cacheFetched({ projectDir, from, release: RELEASE })
    expect([...output.missing].sort()).toEqual([blobId('1'), blobId('2'), blobId('3'), blobId('4')])
  })

  it('keeps support.js of each type release apart', async () => {
    await cacheFetched({ projectDir, from: scratchRound({ 'support.js': 'window.release = 1\n' }), release: 'r1' })
    await cacheFetched({ projectDir, from: scratchRound({ 'support.js': 'window.release = 2\n' }), release: 'r2' })
    expect(readFileSync(path.join(cacheDir, 'r1', 'support.js'), 'utf8')).toBe('window.release = 1\n')
    expect(readFileSync(path.join(cacheDir, 'r2', 'support.js'), 'utf8')).toBe('window.release = 2\n')
  })

  it('leaves the scratch folder as it found it', async () => {
    const from = scratchRound({ [CSS_FILE]: fetchedFixture(CSS_FILE) })
    await cacheFetched({ projectDir, from, release: RELEASE })
    expect(readFileSync(path.join(from, CSS_FILE)).equals(fetchedFixture(CSS_FILE))).toBe(true)
  })
})

describe('rewriteBlobs', () => {
  const NEW_CSS_BLOB = blobId('c')
  const NEW_SVG_BLOB = blobId('d')
  const UNMAPPED_BLOB = blobId('e')

  let projectRoot: string
  let mapFile: string

  beforeEach(() => {
    projectRoot = path.join(projectDir, 'project')
    cpSync(FIXTURE_PROJECT, projectRoot, { recursive: true })
    mapFile = path.join(sandbox, 'map.json')
    writeFileSync(mapFile, JSON.stringify({ [CSS_BLOB]: NEW_CSS_BLOB, [SVG_BLOB]: NEW_SVG_BLOB }))
  })

  const projectFile = (...segments: string[]) => path.join(projectRoot, ...segments)

  it('swaps each mapped id in a board and changes no other byte', async () => {
    const before = readFileSync(projectFile('home.dc.html'), 'latin1')
    await rewriteBlobs({ projectDir, mapFile })
    const after = readFileSync(projectFile('home.dc.html'), 'latin1')

    expect(after).not.toContain(CSS_BLOB)
    expect(after).not.toContain(SVG_BLOB)
    expect(after).toBe(
      before.replaceAll(`/_blob/${CSS_BLOB}`, `/_blob/${NEW_CSS_BLOB}`).replaceAll(`/_blob/${SVG_BLOB}`, `/_blob/${NEW_SVG_BLOB}`),
    )
  })

  it('keeps BOM, CRLF, a lone LF and unmapped ids exactly as they were', async () => {
    const board = (cssId: string, svgId: string) =>
      Buffer.concat([
        UTF8_BOM,
        Buffer.from(
          `<link rel="stylesheet" href="/_blob/${cssId}">\r\n<img src="/_blob/${svgId}">\n` +
            `<img src="/_blob/${UNMAPPED_BLOB}">\r\n<p>${CSS_BLOB} without the prefix</p>`,
        ),
      ])
    writeFileSync(projectFile('legacy.dc.html'), board(CSS_BLOB, SVG_BLOB))

    await rewriteBlobs({ projectDir, mapFile })

    expect(readFileSync(projectFile('legacy.dc.html')).equals(board(NEW_CSS_BLOB, NEW_SVG_BLOB))).toBe(true)
  })

  it('leaves files with no mapped id untouched', async () => {
    const untouched = ['canvas.json', 'card.dc.html', path.join('ds', 'core', 'tokens.json')]
    const before = untouched.map((file) => readFileSync(projectFile(file)))
    await rewriteBlobs({ projectDir, mapFile })
    untouched.forEach((file, index) => {
      expect(readFileSync(projectFile(file)).equals(before[index] ?? Buffer.alloc(0)), file).toBe(true)
    })
  })

  it('does not touch the cache', async () => {
    await cacheFetched({ projectDir, from: scratchRound({ [CSS_FILE]: fetchedFixture(CSS_FILE) }), release: RELEASE })
    await rewriteBlobs({ projectDir, mapFile })
    expect(existsSync(path.join(cacheDir, CSS_FILE))).toBe(true)
    expect(readFileSync(path.join(cacheDir, CSS_FILE)).equals(fetchedFixture(CSS_FILE))).toBe(true)
  })
})
