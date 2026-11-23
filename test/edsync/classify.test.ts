import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquirePushLock } from '../../src/core/push-lock'
import { LEASE } from '../../src/shared/sync'
import {
  actionOf,
  ARTBOARDS_MESSAGE,
  CANVAS,
  CARD,
  CSS_BLOB,
  EDITS,
  entryOf,
  expectOk,
  HOME,
  PUBLISH_ROOT,
  useIsolatedGitConfig,
  Workspace,
} from './fake-remote'

const EXTRA = 'project/extra.dc.html'
const UNCACHED_BLOB = 'c0ffee00c0ffee00c0ffee00c0ffee00'
const LOCAL_ONLY_BLOB = 'deadbeefdeadbeefdeadbeefdeadbeef'
const EXTRA_BOARD = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<script src="./support.js"></script>',
  '</head>',
  '<body>',
  '<x-dc data-props=\'{"$preview":{"w":640,"h":480}}\'>',
  '  <helmet>',
  `    <link rel="stylesheet" href="/_blob/${CSS_BLOB}">`,
  '  </helmet>',
  `  <img src="/_blob/${UNCACHED_BLOB}" alt="New mark">`,
  '</x-dc>',
  '</body>',
  '</html>',
  '',
].join('\n')

useIsolatedGitConfig()

let space: Workspace

beforeEach(async () => {
  space = Workspace.create()
  await space.pull()
})

afterEach(() => {
  space.dispose()
})

function movedCanvasJson(bytes: Buffer, x: number): string {
  const canvas = JSON.parse(bytes.toString('utf8')) as { boards: Record<string, { x: number }> }
  canvas.boards['card.dc.html']!.x = x
  return `${JSON.stringify(canvas, null, 2)}\n`
}

describe('classify against the synced commit', () => {
  it('uploads a local-only change and leaves the remote copy of it unwritten', async () => {
    space.editLocal(CARD, EDITS.cardTitle)
    const edited = space.local(CARD)

    const output = await space.classify(await space.lock())

    expect(actionOf(output, CARD)).toBe('upload')
    expect(actionOf(output, HOME)).toBe('unchanged')
    expect(Object.keys(output.publish!.files)).toEqual([CARD])
    expect(space.local(CARD).equals(edited)).toBe(true)
  })

  it('writes the remote bytes of a remote-only change into projects/<slug>/ and sends nothing', async () => {
    space.remote.edit(HOME, EDITS.homeTitle)

    const output = await space.classify(await space.lock())

    expect(actionOf(output, HOME)).toBe('write-remote')
    expect(space.local(HOME).equals(space.remote.read(HOME))).toBe(true)
    expect(output.publish).toBeNull()
  })

  it('does nothing for files unchanged on both sides', async () => {
    const before = { home: space.local(HOME), card: space.local(CARD), canvas: space.local(CANVAS) }

    const output = await space.classify(await space.lock())

    for (const file of [HOME, CARD, CANVAS]) expect(actionOf(output, file), file).toBe('unchanged')
    expect(output.publish).toBeNull()
    expect(space.local(HOME).equals(before.home)).toBe(true)
    expect(space.local(CARD).equals(before.card)).toBe(true)
    expect(space.local(CANVAS).equals(before.canvas)).toBe(true)
    expect(space.status()).toEqual([])
  })

  it('sends a merge for a file changed on both sides to different bytes', async () => {
    space.editLocal(HOME, EDITS.homeColumn)
    space.remote.edit(HOME, EDITS.homeTitle)

    const output = await space.classify(await space.lock())

    expect(actionOf(output, HOME)).toBe('merge')
    expect(Object.keys(output.publish!.files)).toEqual([HOME])
  })

  it('treats an artboard edited locally and removed on the remote as a conflict and sends nothing', async () => {
    space.editLocal(CARD, EDITS.cardTitle)
    space.editLocal(HOME, EDITS.homeColumn)
    const edited = space.local(CARD)
    space.remote.removeBoard(CARD)

    const output = await space.classify(await space.lock())

    expect(entryOf(output, CARD)).toMatchObject({ action: 'conflict', cause: 'edit-vs-remove' })
    expect(output.publish).toBeNull()
    expect(space.local(CARD).equals(edited)).toBe(true)
  })

  it('treats an artboard removed locally and edited on the remote as a conflict and sends nothing', async () => {
    space.removeLocal(CARD)
    space.editLocal(HOME, EDITS.homeColumn)
    space.remote.edit(CARD, EDITS.cardText)

    const output = await space.classify(await space.lock())

    expect(entryOf(output, CARD)).toMatchObject({ action: 'conflict', cause: 'edit-vs-remove' })
    expect(output.publish).toBeNull()
  })
})

describe('artboards added or removed', () => {
  it('carries an artboard added on the remote across with the remote canvas.json', async () => {
    space.remote.addBoard(EXTRA, EXTRA_BOARD)

    const output = await space.classify(await space.lock())

    expect(actionOf(output, EXTRA)).toBe('write-remote')
    expect(actionOf(output, CANVAS)).toBe('write-remote')
    expect(space.local(EXTRA).equals(space.remote.read(EXTRA))).toBe(true)
    expect(space.local(CANVAS).equals(space.remote.read(CANVAS))).toBe(true)
    expect(output.publish).toBeNull()
  })

  it('carries an artboard removed on the remote across with the remote canvas.json', async () => {
    space.remote.removeBoard(CARD)

    const output = await space.classify(await space.lock())

    expect(actionOf(output, CARD)).toBe('write-remote')
    expect(space.hasLocal(CARD)).toBe(false)
    expect(space.local(CANVAS).equals(space.remote.read(CANVAS))).toBe(true)
  })

  it('stops the push on an artboard added locally only, saying to add it in Claude Design, and sends nothing', async () => {
    space.writeLocal(EXTRA, EXTRA_BOARD)
    space.editLocal(HOME, EDITS.homeColumn)

    const run = await space.classifyRun(await space.lock())
    const output = JSON.parse(run.stdout)

    expect(entryOf(output, EXTRA)).toMatchObject({ action: 'stop', cause: 'local-artboard-added' })
    expect(output.publish).toBeNull()
    expect(run.stdout + run.stderr).toContain(ARTBOARDS_MESSAGE)
    expect(space.remote.has(EXTRA)).toBe(false)
  })

  it('stops the push on an artboard removed locally only, saying to remove it in Claude Design, and sends nothing', async () => {
    space.removeLocal(CARD)
    space.editLocal(HOME, EDITS.homeColumn)

    const run = await space.classifyRun(await space.lock())
    const output = JSON.parse(run.stdout)

    expect(entryOf(output, CARD)).toMatchObject({ action: 'stop', cause: 'local-artboard-removed' })
    expect(output.publish).toBeNull()
    expect(run.stdout + run.stderr).toContain(ARTBOARDS_MESSAGE)
  })
})

describe('project/canvas.json', () => {
  it('is never uploaded: a local change gives way to the remote bytes', async () => {
    space.writeLocal(CANVAS, movedCanvasJson(space.local(CANVAS), 1500))
    space.editLocal(HOME, EDITS.homeColumn)

    const output = await space.classify(await space.lock())

    expect(['upload', 'merge', 'conflict', 'stop']).not.toContain(actionOf(output, CANVAS))
    expect(Object.keys(output.publish!.files)).toEqual([HOME])
    expect(space.local(CANVAS).equals(space.remote.read(CANVAS))).toBe(true)
  })

  it('is never merged: changed on both sides, the remote one is taken as is', async () => {
    space.writeLocal(CANVAS, movedCanvasJson(space.local(CANVAS), 1500))
    space.remote.write(CANVAS, movedCanvasJson(space.remote.read(CANVAS), 1700))
    space.editLocal(HOME, EDITS.homeColumn)

    const output = await space.classify(await space.lock())

    expect(['upload', 'merge', 'conflict', 'stop']).not.toContain(actionOf(output, CANVAS))
    expect(Object.keys(output.publish!.files)).toEqual([HOME])
    expect(space.local(CANVAS).equals(space.remote.read(CANVAS))).toBe(true)
  })
})

describe('the publish map', () => {
  it('is one Artifact files map keyed project/<path> under root projects/<slug>, artboard files only', async () => {
    space.editLocal(HOME, EDITS.homeColumn)
    space.editLocal(CARD, EDITS.cardTitle)
    space.remote.write(CANVAS, movedCanvasJson(space.remote.read(CANVAS), 1700))

    const output = await space.classify(await space.lock())

    expect(output.publish!.root).toBe(PUBLISH_ROOT)
    expect(Object.keys(output.publish!.files).sort()).toEqual([CARD, HOME].sort())
    expect(space.publishedSource(output, HOME).equals(space.local(HOME))).toBe(true)
    expect(space.publishedSource(output, CARD).equals(space.local(CARD))).toBe(true)
  })
})

describe('/_blob ids missing from the cache', () => {
  it('lists the ids a remote-only file references that are not cached, and none from local files', async () => {
    space.remote.addBoard(EXTRA, EXTRA_BOARD)
    space.editLocal(CARD, { from: '<p style="margin: 0">', to: `<p style="margin: 0; background: url(/_blob/${LOCAL_ONLY_BLOB})">` })

    const output = await space.classify(await space.lock())

    expect(output.missingBlobs).toEqual([UNCACHED_BLOB])
  })
})

describe('the nonce re-check', () => {
  it('aborts with nothing written or sent when the lock is gone', async () => {
    space.remote.edit(HOME, EDITS.homeTitle)
    space.editLocal(CARD, EDITS.cardTitle)
    const localHome = space.local(HOME)
    const nonce = await space.lock()
    expectOk(await space.unlockRun(nonce))

    const run = await space.classifyRun(nonce)

    expect(run.exitCode).not.toBe(0)
    expect(space.local(HOME).equals(localHome)).toBe(true)
    expect(run.stdout).not.toContain(PUBLISH_ROOT)
  })

  it('aborts with nothing written or sent when the lock now carries someone else’s nonce, and keeps that lock', async () => {
    space.remote.edit(HOME, EDITS.homeTitle)
    space.editLocal(CARD, EDITS.cardTitle)
    const localHome = space.local(HOME)
    const nonce = await space.lock()
    expectOk(await space.unlockRun(nonce))
    const other = await acquirePushLock(space.projectDir, { holder: 'editor', leaseMs: LEASE.editorMs })

    const run = await space.classifyRun(nonce)

    expect(run.exitCode).not.toBe(0)
    expect(space.local(HOME).equals(localHome)).toBe(true)
    expect(run.stdout).not.toContain(PUBLISH_ROOT)
    expect(space.pushLock()?.nonce).toBe(other!.nonce)
  })
})

describe('a partial publish re-run', () => {
  it('classifies the files that already landed as unchanged and sends only the rest', async () => {
    space.editLocal(HOME, EDITS.homeColumn)
    space.editLocal(CARD, EDITS.cardTitle)
    const firstNonce = await space.lock()
    const first = await space.classify(firstNonce)
    space.publish(first, [HOME])
    expectOk(await space.unlockRun(firstNonce))

    const rerun = await space.classify(await space.lock())

    expect(actionOf(rerun, HOME)).toBe('unchanged')
    expect(actionOf(rerun, CARD)).toBe('upload')
    expect(Object.keys(rerun.publish!.files)).toEqual([CARD])
  })
})
