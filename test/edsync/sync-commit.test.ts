import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  actionOf,
  CANVAS,
  CARD,
  CSS_BLOB,
  EDITS,
  expectOk,
  gitBlobHash,
  HOME,
  SLUG,
  useIsolatedGitConfig,
  Workspace,
} from './fake-remote'

const EXTRA = 'project/extra.dc.html'
const NEW_BLOB = 'abcdef0123456789abcdef0123456789'
const EXTRA_BOARD = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n  <img src="/_blob/${NEW_BLOB}" alt="">\n  <link rel="stylesheet" href="/_blob/${CSS_BLOB}">\n</x-dc>\n</body>\n</html>\n`
const DIRTY_MESSAGE = /run \/design-push first/

useIsolatedGitConfig()

let space: Workspace

beforeEach(async () => {
  space = Workspace.create()
  await space.pull()
})

afterEach(() => {
  space.dispose()
})

function baseHashOf(projectPath: string): string | undefined {
  return (space.base().files as Readonly<Record<string, string>>)[projectPath]
}

function expectBaseJsonMatchesHead(): void {
  const base = space.base()
  expect(base.commit).toBe(space.head())
  expect(base.files).toEqual(space.committedHashes())
}

describe('edsync commit', () => {
  it('records the push as the next synced commit, with base.json, the working tree and the remote agreeing', async () => {
    const pulled = space.head()
    space.editLocal(CARD, EDITS.cardTitle)
    space.remote.edit(HOME, EDITS.homeTitle)

    const nonce = await space.lock()
    space.publish(await space.classify(nonce))
    await space.commit(nonce)

    expect(space.head()).not.toBe(pulled)
    expect(space.git('rev-parse', 'HEAD~1').trim()).toBe(pulled)
    expect(space.headBlob(CARD).equals(space.remote.read(CARD))).toBe(true)
    expect(space.headBlob(HOME).equals(space.remote.read(HOME))).toBe(true)
    expect(space.headBlob(CARD).equals(space.local(CARD))).toBe(true)
    expect(space.headBlob(HOME).equals(space.local(HOME))).toBe(true)
    expectBaseJsonMatchesHead()
    expect(space.status()).toEqual([])
  })

  it('records a push that only brings remote edits in, with nothing sent', async () => {
    const pulled = space.head()
    space.remote.edit(HOME, EDITS.homeTitle)

    const nonce = await space.lock()
    const output = await space.classify(nonce)
    expect(output.publish).toBeNull()
    await space.commit(nonce)

    expect(space.head()).not.toBe(pulled)
    expect(space.headBlob(HOME).equals(space.remote.read(HOME))).toBe(true)
    expect(baseHashOf(HOME)).toBe(gitBlobHash(space.remote.read(HOME)))
    expectBaseJsonMatchesHead()
  })

  it('records a cleanly merged file as the merged bytes that were sent', async () => {
    space.editLocal(HOME, EDITS.homeColumn)
    space.remote.edit(HOME, EDITS.homeTitle)

    const nonce = await space.lock()
    const output = await space.classify(nonce)
    space.publish(output)
    await space.commit(nonce)

    const merged = space.remote.read(HOME).toString('utf8')
    expect(merged).toContain(EDITS.homeColumn.to)
    expect(merged).toContain(EDITS.homeTitle.to)
    expect(space.headBlob(HOME).equals(space.remote.read(HOME))).toBe(true)
    expectBaseJsonMatchesHead()
  })

  it('records an artboard removed on the remote together with the remote canvas.json', async () => {
    space.remote.removeBoard(CARD)

    const nonce = await space.lock()
    await space.classify(nonce)
    await space.commit(nonce)

    expect(Object.keys(space.committedHashes())).not.toContain(CARD)
    expect(Object.keys(space.base().files)).not.toContain(CARD)
    expect(space.headBlob(CANVAS).equals(space.remote.read(CANVAS))).toBe(true)
    expect(space.status()).toEqual([])
  })

  it('builds the commit from the bytes classify sent, so an edit made after classify is a local change next push', async () => {
    space.editLocal(CARD, EDITS.cardTitle)
    const nonce = await space.lock()
    const output = await space.classify(nonce)
    const sent = space.publishedSource(output, CARD)
    space.publish(output)
    space.editLocal(CARD, EDITS.cardText)
    const later = space.local(CARD)

    await space.commit(nonce)
    expectOk(await space.unlockRun(nonce))

    expect(space.headBlob(CARD).equals(sent)).toBe(true)
    expect(baseHashOf(CARD)).toBe(gitBlobHash(sent))
    expect(space.local(CARD).equals(later)).toBe(true)
    expect(space.status()).toEqual([` M ${CARD}`])

    const next = await space.classify(await space.lock())
    expect(actionOf(next, CARD)).toBe('upload')
    expect(space.publishedSource(next, CARD).equals(later)).toBe(true)
  })

  it('still records the sync when the CLI lease lapsed after the publish', async () => {
    const pulled = space.head()
    space.editLocal(CARD, EDITS.cardTitle)
    const nonce = await space.lock()
    space.publish(await space.classify(nonce))
    const lock = space.pushLock()!
    space.writePushLock({ ...lock, expiresAt: Date.now() - 1_000 })

    expectOk(await space.commitRun(nonce))

    expect(space.head()).not.toBe(pulled)
    expect(space.headBlob(CARD).equals(space.remote.read(CARD))).toBe(true)
    expectBaseJsonMatchesHead()
  })
})

describe('two pushes in a row', () => {
  it('lands a remote edit to one artboard on the first push and keeps it through a local edit and a second push', async () => {
    space.remote.edit(HOME, EDITS.homeTitle)
    space.editLocal(CARD, EDITS.cardTitle)

    const first = await space.push()

    expect(actionOf(first, HOME)).toBe('write-remote')
    expect(space.local(HOME).toString('utf8')).toContain(EDITS.homeTitle.to)

    space.editLocal(HOME, EDITS.homeColumn)
    const second = await space.push()

    expect(actionOf(second, HOME)).toBe('upload')
    const remoteHome = space.remote.read(HOME).toString('utf8')
    expect(remoteHome).toContain(EDITS.homeTitle.to)
    expect(remoteHome).toContain(EDITS.homeColumn.to)
    expect(space.remote.read(CARD).toString('utf8')).toContain(EDITS.cardTitle.to)
    expect(space.headBlob(HOME).equals(space.remote.read(HOME))).toBe(true)
    expectBaseJsonMatchesHead()
    expect(space.status()).toEqual([])
  })
})

describe('re-running pull on an existing project', () => {
  it('writes remote-only changes and advances the synced commit and base.json, with nothing sent', async () => {
    const pulled = space.head()
    const remoteCard = space.remote.read(CARD)
    space.remote.edit(HOME, EDITS.homeTitle)
    space.remote.addBoard(EXTRA, EXTRA_BOARD)

    const refreshed = await space.ingest()

    expect(refreshed.slug).toBe(SLUG)
    expect(refreshed.blobIds).toContain(NEW_BLOB)
    expect(space.local(HOME).equals(space.remote.read(HOME))).toBe(true)
    expect(space.local(EXTRA).equals(space.remote.read(EXTRA))).toBe(true)
    expect(space.local(CANVAS).equals(space.remote.read(CANVAS))).toBe(true)
    expect(space.git('rev-parse', 'HEAD~1').trim()).toBe(pulled)
    expect(space.git('rev-list', '--max-parents=0', 'HEAD').trim()).toBe(pulled)
    expectBaseJsonMatchesHead()
    expect(space.status()).toEqual([])
    expect(space.remote.read(CARD).equals(remoteCard)).toBe(true)
  })

  it('refuses a dirty project and keeps the local bytes', async () => {
    space.remote.edit(HOME, EDITS.homeTitle)
    space.editLocal(CARD, EDITS.cardTitle)
    const edited = space.local(CARD)
    const localHome = space.local(HOME)
    const pulled = space.head()

    const run = await space.edsync('ingest', '--remote-dir', space.remote.snapshot(), '--slug', SLUG)

    expect(run.exitCode).not.toBe(0)
    expect(run.stderr).toMatch(DIRTY_MESSAGE)
    expect(space.local(CARD).equals(edited)).toBe(true)
    expect(space.local(HOME).equals(localHome)).toBe(true)
    expect(space.head()).toBe(pulled)
  })
})
