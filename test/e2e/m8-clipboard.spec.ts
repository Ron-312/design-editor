import type { Locator, Page } from '@playwright/test'
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

/** What a pure insertion added, with the whitespace between its tags taken out. */
function insertedHtml(project: E2eProject): string {
  const changed = changedLines(project.diff())
  expect(changed.filter((line) => line.startsWith('-'))).toEqual([])
  return changed
    .map((line) => line.slice(1))
    .join('\n')
    .trim()
    .replace(/>\s+</g, '><')
}

function withLineRemoved(text: string, fragment: string): string {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => line.includes(fragment))
  if (at < 0) throw new Error(`no line holds ${fragment}`)
  lines.splice(at, 1)
  return lines.join('\n')
}

/** The source between two markers, each found from the start of the file. */
function between(text: string, from: string, to: string): string {
  return text.slice(text.indexOf(from), text.indexOf(to))
}

function occurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1
}

function column(page: Page, text: string): Locator {
  return canvasFrame(page).locator('section.row > .col', { hasText: text })
}

function selectedRows(page: Page): Locator {
  return page.locator('[role="treeitem"][aria-selected="true"]')
}

async function selectRow(page: Page, edId: string, modifiers: Array<'Shift'> = []): Promise<void> {
  await layerRowOf(page, edId).click({ modifiers })
  await expect(layerRowOf(page, edId)).toHaveAttribute('aria-selected', 'true')
}

async function clearSelectionOnCanvas(page: Page): Promise<void> {
  await page.locator('[data-canvas-viewport]').focus()
  await page.keyboard.press('Escape')
  await expect(selectedRows(page)).toHaveCount(0)
}

test.describe('M8: layer copy, cut and paste', () => {
  test('copies two layers and pastes them into another container, selecting the pasted layers', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const brief = await edIdOf(column(page, 'Brief'))
    const sketches = await edIdOf(column(page, 'Sketches'))
    const hero = await edIdOf(canvasFrame(page).locator('header.hero'))

    await selectRow(page, brief)
    await selectRow(page, sketches, ['Shift'])
    await page.keyboard.press(`${MOD}+KeyC`)
    await selectRow(page, hero)
    await page.keyboard.press(`${MOD}+KeyV`)

    await expect.poll(() => occurrences(homeText(project), BRIEF)).toBe(2)
    const text = homeText(project)
    expect(insertedHtml(project)).toBe(`${BRIEF}${SKETCHES}`)
    const heroSource = between(text, '<header class="hero"', '</header>')
    expect(heroSource.indexOf(BRIEF)).toBeGreaterThan(-1)
    expect(heroSource.indexOf(SKETCHES)).toBeGreaterThan(heroSource.indexOf(BRIEF))
    expect(text).not.toContain('data-ed-id')

    const pasted = canvasFrame(page).locator('header.hero > .col')
    await expect(pasted).toHaveText(['Brief', 'Sketches'])
    const pastedIds = [await edIdOf(pasted.nth(0)), await edIdOf(pasted.nth(1))]
    await expect(selectedRows(page)).toHaveCount(2)
    for (const pastedId of pastedIds) await expect(layerRowOf(page, pastedId)).toHaveAttribute('aria-selected', 'true')
  })

  test('a paste with nothing selected appends to the artboard root', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)

    await selectRow(page, await edIdOf(column(page, 'Brief')))
    await page.keyboard.press(`${MOD}+KeyC`)
    await clearSelectionOnCanvas(page)
    await page.keyboard.press(`${MOD}+KeyV`)

    await expect.poll(() => occurrences(homeText(project), BRIEF)).toBe(2)
    expect(insertedHtml(project)).toBe(BRIEF)
    expect(between(homeText(project), '</main>', '</x-dc>')).toContain(BRIEF)
  })

  test('a paste onto a top-level layer that holds the copied one lands as its sibling at the root', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)

    await selectRow(page, await edIdOf(column(page, 'Brief')))
    await page.keyboard.press(`${MOD}+KeyC`)
    await selectRow(page, await edIdOf(canvasFrame(page).locator('main.page')))
    await page.keyboard.press(`${MOD}+KeyV`)

    await expect.poll(() => occurrences(homeText(project), BRIEF)).toBe(2)
    expect(insertedHtml(project)).toBe(BRIEF)
    expect(between(homeText(project), '</main>', '</x-dc>')).toContain(BRIEF)
  })

  test('cut removes the layer and undo restores the file byte-identical', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const final = await edIdOf(column(page, 'Final boards'))

    await selectRow(page, final)
    await page.keyboard.press(`${MOD}+KeyX`)
    await expect.poll(() => homeText(project)).toBe(withLineRemoved(originalHome(project), FINAL))

    await page.keyboard.press(`${MOD}+KeyZ`)
    await expect.poll(() => isSynced(project)).toBe(true)
    expect(project.status()).toBe('')
  })

  test('pasting a copy of a data-bound layer is refused with one explanation and writes nothing', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)

    await selectRow(page, await edIdOf(canvasFrame(page).locator('header.hero > p')))
    await page.keyboard.press(`${MOD}+KeyC`)
    await page.keyboard.press(`${MOD}+KeyV`)

    await expect(page.locator('[role="status"]').filter({ hasText: /Duplicate/ })).toHaveCount(1)
    expect(isSynced(project)).toBe(true)
  })
})
