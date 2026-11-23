import type { Locator, Page } from '@playwright/test'
import type { EditorState } from '../../src/shared/protocol'
import {
  EDITOR_VIEWPORT,
  HOME_BOARD,
  MOD,
  canvasFrame,
  edIdOf,
  expect,
  goOffline,
  layerRowOf,
  openEditor,
  test,
  type E2eProject,
} from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const BRIEF = '<div class="col" style="width: 240px; padding: 16px">Brief</div>'
const SKETCHES = '<div class="col" style="width: 360px; padding: 16px">Sketches</div>'
const FINAL = '<div class="col" style="width: 480px; padding: 16px; transform: rotate(-2deg)">Final boards</div>'

function homeText(project: E2eProject): string {
  return project.read(HOME_BOARD).toString('utf8')
}

function originalHome(project: E2eProject): string {
  return project.fixture(HOME_BOARD).toString('utf8')
}

function isSynced(project: E2eProject): boolean {
  return project.read(HOME_BOARD).equals(project.fixture(HOME_BOARD))
}

function changedLines(diff: string): string[] {
  return diff.split('\n').filter((line) => /^[-+](?![-+]{2} )/.test(line))
}

function lineIndex(lines: readonly string[], fragment: string): number {
  const at = lines.findIndex((line) => line.includes(fragment))
  if (at < 0) throw new Error(`no line holds ${fragment}`)
  return at
}

/** `text` with the line holding `moved` taken out and put back just above the line holding `above`. */
function withLineMovedAbove(text: string, moved: string, above: string): string {
  const lines = text.split('\n')
  const [line] = lines.splice(lineIndex(lines, moved), 1)
  lines.splice(lineIndex(lines, above), 0, line!)
  return lines.join('\n')
}

function withLineDuplicated(text: string, fragment: string): string {
  const lines = text.split('\n')
  const at = lineIndex(lines, fragment)
  lines.splice(at + 1, 0, lines[at]!)
  return lines.join('\n')
}

function withLineRemoved(text: string, fragment: string): string {
  const lines = text.split('\n')
  lines.splice(lineIndex(lines, fragment), 1)
  return lines.join('\n')
}

/** `text` with the lines from `first` to `last` wrapped in a `<div>` at their own indentation. */
function withLinesWrapped(text: string, first: string, last: string): string {
  const lines = text.split('\n')
  const start = lineIndex(lines, first)
  const indent = /^[ \t]*/.exec(lines[start]!)![0]
  lines.splice(lineIndex(lines, last) + 1, 0, `${indent}</div>`)
  lines.splice(start, 0, `${indent}<div>`)
  return lines.join('\n')
}

function properties(page: Page): Locator {
  return page.locator('aside[aria-label="Properties"]')
}

function widthInput(page: Page): Locator {
  return properties(page).locator('[data-prop="width"] input')
}

function column(page: Page, text: string): Locator {
  return canvasFrame(page).locator('section.row > .col', { hasText: text })
}

async function selectRow(page: Page, edId: string, modifiers: Array<'Shift'> = []): Promise<void> {
  await layerRowOf(page, edId).click({ modifiers })
  await expect(layerRowOf(page, edId)).toHaveAttribute('aria-selected', 'true')
}

/** Drops `moved` on the top quarter of `target`'s row in the layers panel, which places it before that layer. */
async function dragRowAbove(page: Page, moved: string, target: string): Promise<void> {
  const from = await layerRowOf(page, moved).boundingBox()
  const to = await layerRowOf(page, target).boundingBox()
  if (!from || !to) throw new Error('a layer row is not on screen')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 })
  await page.mouse.move(to.x + to.width / 2, to.y + 3, { steps: 4 })
  await page.mouse.up()
}

/** Keyboard shortcuts reach the registry only while focus is outside text entry. */
async function blurFields(page: Page): Promise<void> {
  await page.locator('header').first().click({ position: { x: 2, y: 2 } })
}

async function setWidth(page: Page, value: string): Promise<void> {
  await widthInput(page).fill(value)
  await widthInput(page).press('Enter')
}

function editorState(project: E2eProject): EditorState | null {
  try {
    return JSON.parse(project.read('.editor/state.json').toString('utf8')) as EditorState
  } catch {
    return null
  }
}

async function columnIds(page: Page): Promise<{ brief: string; sketches: string; final: string }> {
  return {
    brief: await edIdOf(column(page, 'Brief')),
    sketches: await edIdOf(column(page, 'Sketches')),
    final: await edIdOf(column(page, 'Final boards')),
  }
}

test.describe('M5: structure and multi-edit', () => {
  test('golden sequence: move, duplicate, undo twice, then a property edit lands on the intended element', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const original = originalHome(project)
    const { brief, sketches, final } = await columnIds(page)

    await dragRowAbove(page, final, brief)
    const moved = withLineMovedAbove(original, FINAL, BRIEF)
    await expect.poll(() => homeText(project)).toBe(moved)

    await selectRow(page, sketches)
    await page.keyboard.press(`${MOD}+KeyD`)
    await expect.poll(() => homeText(project)).toBe(withLineDuplicated(moved, SKETCHES))

    await blurFields(page)
    await page.keyboard.press(`${MOD}+KeyZ`)
    await expect.poll(() => homeText(project)).toBe(moved)
    await page.keyboard.press(`${MOD}+KeyZ`)
    await expect.poll(() => isSynced(project)).toBe(true)

    await selectRow(page, sketches)
    await expect(widthInput(page)).toHaveValue('360px')
    await setWidth(page, '400px')

    const expected = original.replace(SKETCHES, SKETCHES.replace('width: 360px', 'width: 400px'))
    await expect.poll(() => homeText(project)).toBe(expected)
    const changed = changedLines(project.diff())
    expect(changed).toHaveLength(2)
    expect(changed[0]).toMatch(/^-.*width: 360px.*Sketches/)
    expect(changed[1]).toMatch(/^\+.*width: 400px.*Sketches/)
  })

  test("multi-edit: three widths show 'Mixed', one edit writes three declarations and one undo restores the file", async ({
    page,
    project,
    editor,
  }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const { brief, sketches, final } = await columnIds(page)

    await selectRow(page, brief)
    await selectRow(page, sketches, ['Shift'])
    await selectRow(page, final, ['Shift'])
    await expect(widthInput(page)).toHaveValue('')
    await expect(widthInput(page)).toHaveAttribute('placeholder', 'Mixed')

    await setWidth(page, '300px')

    const expected = [BRIEF, SKETCHES, FINAL].reduce(
      (text, line) => text.replace(line, line.replace(/width: \d+px/, 'width: 300px')),
      originalHome(project),
    )
    await expect.poll(() => homeText(project)).toBe(expected)
    expect(changedLines(project.diff())).toHaveLength(6)
    await expect(page.locator('[role="status"][aria-label^="Sync status"] [aria-current="step"]')).toContainText(/Edited\s*·\s*1/)

    await blurFields(page)
    await page.keyboard.press(`${MOD}+KeyZ`)
    await expect.poll(() => isSynced(project)).toBe(true)
    expect(project.status()).toBe('')
  })

  test("'Revert file' in the diff panel restores the synced bytes after structural and style edits", async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const { brief, final } = await columnIds(page)

    await selectRow(page, final)
    await page.keyboard.press(`${MOD}+KeyD`)
    await expect.poll(() => homeText(project)).toBe(withLineDuplicated(originalHome(project), FINAL))
    await selectRow(page, brief)
    await setWidth(page, '250px')
    await expect.poll(() => homeText(project)).toContain('width: 250px')

    await page.getByRole('tab', { name: /^Changes/ }).click()
    await page.locator(`[data-diff-file="${HOME_BOARD}"]`).getByRole('button', { name: 'Revert file' }).click()

    await expect.poll(() => isSynced(project)).toBe(true)
    expect(project.status()).toBe('')
  })

  test('wrap and ungroup round-trip, and a wrap that breaks HTML nesting is refused with one explanation', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const original = originalHome(project)

    await selectRow(page, await edIdOf(canvasFrame(page).locator('p.lede strong')))
    await page.keyboard.press(`${MOD}+KeyG`)
    await expect(page.locator('[role="status"]').filter({ hasText: "a <div> can't go inside a <p>" })).toHaveCount(1)
    expect(isSynced(project)).toBe(true)

    const { brief, sketches } = await columnIds(page)
    await selectRow(page, brief)
    await selectRow(page, sketches, ['Shift'])
    await page.keyboard.press(`${MOD}+KeyG`)
    await expect.poll(() => homeText(project)).toBe(withLinesWrapped(original, BRIEF, SKETCHES))

    const wrapper = canvasFrame(page).locator('section.row > div:not(.col)')
    await expect(wrapper.locator('.col')).toHaveCount(2)
    await selectRow(page, await edIdOf(wrapper))
    await page.keyboard.press(`${MOD}+Shift+KeyG`)
    await expect.poll(() => isSynced(project)).toBe(true)
  })

  test('Delete removes the layer from the source and undo brings it back byte-identical', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const { final } = await columnIds(page)

    await selectRow(page, final)
    await page.keyboard.press('Delete')
    await expect.poll(() => homeText(project)).toBe(withLineRemoved(originalHome(project), FINAL))

    await page.keyboard.press(`${MOD}+KeyZ`)
    await expect.poll(() => isSynced(project)).toBe(true)
    await expect(layerRowOf(page, final)).toBeVisible()
  })

  test('picking a tokens.json token writes its literal value into the selected element', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectRow(page, await edIdOf(column(page, 'Brief')))

    const field = properties(page).locator('[data-prop="background-color"]')
    await field.getByRole('button', { name: 'Tokens' }).click()
    await properties(page).getByRole('option', { name: /color\.paper/ }).click()

    const expected = originalHome(project).replace(BRIEF, BRIEF.replace('padding: 16px', 'padding: 16px; background-color: #fff7ed'))
    await expect.poll(() => homeText(project)).toBe(expected)
    await expect(column(page, 'Brief')).toHaveCSS('background-color', 'rgb(255, 247, 237)')
  })

  test('hide and lock shortcuts change editor-only state and never the source', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const title = await edIdOf(canvasFrame(page).locator('h1'))
    const row = layerRowOf(page, title)

    await selectRow(page, title)
    await page.keyboard.press(`${MOD}+Shift+KeyH`)
    await expect(row).toHaveAttribute('data-hidden', '')
    await expect.poll(() => editorState(project)?.hidden).toContain(title)

    await page.keyboard.press(`${MOD}+Shift+KeyL`)
    await expect(row.getByRole('button', { name: 'Unlock' })).toBeVisible()
    await expect.poll(() => editorState(project)?.locked).toContain(title)

    await page.keyboard.press(`${MOD}+Shift+KeyH`)
    await expect(row).not.toHaveAttribute('data-hidden', '')
    await expect.poll(() => editorState(project)?.hidden).not.toContain(title)

    expect(project.diff()).toBe('')
    expect(project.status()).toBe('')
    expect(isSynced(project)).toBe(true)
  })
})
