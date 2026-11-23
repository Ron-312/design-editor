import { afterEach, describe, expect, it } from 'vitest'
import { CARD, EDITS, entryOf, actionOf, replaceOnce, useIsolatedGitConfig, Workspace, type TextEdit } from './fake-remote'

const NOTES = 'project/notes.dc.html'
const NOTES_LINES = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<script src="./support.js"></script>',
  '</head>',
  '<body>',
  '<x-dc data-props=\'{"$preview":{"w":640,"h":480}}\'>',
  '  <h1 style="color: #111111">Notes</h1>',
  '  <p style="margin: 0">One</p>',
  '  <p style="margin: 0">Two</p>',
  '  <p style="margin: 0">Three</p>',
  '  <p style="margin: 0">Four</p>',
  '  <script data-dc-script>',
  '    class Component extends DCLogic {}',
  '  </script>',
  '</x-dc>',
  '</body>',
  '</html>',
  '',
]
const NOTES_BASE = NOTES_LINES.join('\n')

const OURS_TITLE: TextEdit = { from: 'color: #111111">Notes', to: 'color: #222222">Notes' }
const THEIRS_TITLE: TextEdit = { from: 'color: #111111">Notes', to: 'color: #333333">Notes' }
const THEIRS_FOUR: TextEdit = { from: '<p style="margin: 0">Four', to: '<p style="margin: 8px 0">Four' }
const THEIRS_BREAKS_SHAPE: TextEdit[] = [
  { from: '  <script data-dc-script>\n', to: '' },
  { from: '</x-dc>\n', to: '' },
]

useIsolatedGitConfig()

let space: Workspace

afterEach(() => {
  space.dispose()
})

function crlf(text: string): string {
  return text.replaceAll('\n', '\r\n')
}

function applied(text: string, ...edits: TextEdit[]): string {
  return edits.reduce((result, edit) => replaceOnce(result, edit), text)
}

/** Pulls a project whose remote holds an extra artboard with these bytes, the merge base. */
async function pulledWith(notesBase: string): Promise<Workspace> {
  space = Workspace.create()
  space.remote.addBoard(NOTES, notesBase)
  await space.pull()
  return space
}

describe('a file changed on both sides', () => {
  it('merges edits on different lines cleanly, writes the result and sends it', async () => {
    await pulledWith(NOTES_BASE)
    space.writeLocal(NOTES, applied(NOTES_BASE, OURS_TITLE))
    space.remote.write(NOTES, applied(NOTES_BASE, THEIRS_FOUR))
    const merged = Buffer.from(applied(NOTES_BASE, OURS_TITLE, THEIRS_FOUR))

    const output = await space.classify(await space.lock())

    expect(actionOf(output, NOTES)).toBe('merge')
    expect(space.local(NOTES).equals(merged)).toBe(true)
    expect(space.publishedSource(output, NOTES).equals(merged)).toBe(true)
  })

  it('stops on a same-line edit, listing the file and its hunks with ours before theirs, and sends nothing', async () => {
    await pulledWith(NOTES_BASE)
    const ours = Buffer.from(applied(NOTES_BASE, OURS_TITLE))
    space.writeLocal(NOTES, ours)
    space.remote.write(NOTES, applied(NOTES_BASE, THEIRS_TITLE))
    space.editLocal(CARD, EDITS.cardTitle)

    const output = await space.classify(await space.lock())

    const conflict = entryOf(output, NOTES)
    expect(conflict).toMatchObject({ action: 'conflict', cause: 'both-changed' })
    const hunks = conflict && 'hunks' in conflict ? conflict.hunks : ''
    expect(hunks).toContain('<<<<<<<')
    expect(hunks.indexOf('#222222')).toBeGreaterThanOrEqual(0)
    expect(hunks.indexOf('#222222')).toBeLessThan(hunks.indexOf('======='))
    expect(hunks.indexOf('=======')).toBeLessThan(hunks.indexOf('#333333'))
    expect(output.publish).toBeNull()
    expect(space.local(NOTES).equals(ours)).toBe(true)
  })

  it.each([
    { name: 'LF base and ours, CRLF remote', base: NOTES_BASE, oursEnding: (text: string) => text, theirsEnding: crlf },
    { name: 'CRLF base and ours, LF remote', base: crlf(NOTES_BASE), oursEnding: crlf, theirsEnding: (text: string) => text },
  ])('merges inputs with different dominant line endings as LF and keeps ours’ ending ($name)', async ({ base, oursEnding, theirsEnding }) => {
    await pulledWith(base)
    space.writeLocal(NOTES, oursEnding(applied(NOTES_BASE, OURS_TITLE)))
    space.remote.write(NOTES, theirsEnding(applied(NOTES_BASE, THEIRS_FOUR)))
    const merged = Buffer.from(oursEnding(applied(NOTES_BASE, OURS_TITLE, THEIRS_FOUR)))

    const output = await space.classify(await space.lock())

    expect(actionOf(output, NOTES)).toBe('merge')
    expect(space.local(NOTES).equals(merged)).toBe(true)
  })

  it('treats a clean line merge that breaks <x-dc> and the data-dc-script block as a conflict and sends nothing', async () => {
    await pulledWith(NOTES_BASE)
    const ours = Buffer.from(applied(NOTES_BASE, OURS_TITLE))
    space.writeLocal(NOTES, ours)
    space.remote.write(NOTES, applied(NOTES_BASE, ...THEIRS_BREAKS_SHAPE))
    space.editLocal(CARD, EDITS.cardTitle)

    const output = await space.classify(await space.lock())

    expect(entryOf(output, NOTES)).toMatchObject({ action: 'conflict', cause: 'shape-check' })
    expect(output.publish).toBeNull()
    expect(space.local(NOTES).equals(ours)).toBe(true)
  })

  it('reports a negative git merge-file exit as an error, not a merge, and sends nothing', async () => {
    const binaryBase = NOTES_BASE.replace('Three', 'Thr\u0000ee')
    await pulledWith(binaryBase)
    const ours = Buffer.from(applied(binaryBase, OURS_TITLE))
    space.writeLocal(NOTES, ours)
    space.remote.write(NOTES, applied(binaryBase, THEIRS_FOUR))

    const run = await space.classifyRun(await space.lock())

    expect(run.exitCode).not.toBe(0)
    expect(run.stderr).not.toBe('')
    expect(run.stdout).not.toContain('"root"')
    expect(space.local(NOTES).equals(ours)).toBe(true)
  })
})
