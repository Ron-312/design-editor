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
  screenBoxOf,
  selectOnCanvas,
  test,
  type E2eProject,
} from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const MARK_STYLE = 'position: absolute; top: 24px; right: 32px; width: 64px'

function homeText(project: E2eProject): string {
  return project.read(HOME_BOARD).toString('utf8')
}

/** The studio mark's whole line in the pulled board, indentation and newline included. */
function markLine(original: string): string {
  const line = original.split('\n').find((entry) => entry.includes(MARK_STYLE))
  if (!line) throw new Error('the board has no studio mark')
  return `${line}\n`
}

function withRight(line: string, right: string): string {
  return line.replace('right: 32px', `right: ${right}`)
}

function studioMarks(page: Page): Locator {
  return canvasFrame(page).locator('img[alt="Studio mark"]')
}

/** Screen px between the two studio marks' left edges. */
async function leftEdgeGap(page: Page): Promise<number> {
  const [first, second] = await Promise.all([screenBoxOf(studioMarks(page).nth(0)), screenBoxOf(studioMarks(page).nth(1))])
  return Math.abs(first.x - second.x)
}

async function selectRow(page: Page, edId: string, modifiers: Array<'Shift'> = []): Promise<void> {
  await layerRowOf(page, edId).click({ modifiers })
  await expect(layerRowOf(page, edId)).toHaveAttribute('aria-selected', 'true')
}

/** The studio mark sits at the hero's right edge, outside the canvas at zoom 1. */
async function fitBoard(page: Page): Promise<void> {
  await page.locator('[aria-label="Canvas"]').focus()
  await page.keyboard.press('Shift+Digit1')
}

test.describe('M9: align', () => {
  test('Alt-A aligns two absolute boxes to the leftmost one in one undo entry', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await fitBoard(page)
    const original = homeText(project)
    const mark = markLine(original)

    await selectRow(page, await edIdOf(studioMarks(page)))
    await page.keyboard.press(`${MOD}+KeyD`)
    await expect.poll(() => homeText(project)).toBe(original.replace(mark, mark + mark))
    await expect(studioMarks(page)).toHaveCount(2)

    const [first, second] = [studioMarks(page).nth(0), studioMarks(page).nth(1)]
    const [firstId, secondId] = [await edIdOf(first), await edIdOf(second)]
    await selectOnCanvas(page, second)
    await expect(page.locator('[data-resize-handle]').first()).toBeVisible()
    await page.keyboard.press('Shift+ArrowLeft')
    const nudged = original.replace(mark, mark + withRight(mark, '42px'))
    await expect.poll(() => homeText(project)).toBe(nudged)

    await selectRow(page, firstId)
    await selectRow(page, secondId, ['Shift'])
    await page.keyboard.press('Alt+KeyA')

    const aligned = original.replace(mark, withRight(mark, '42px') + withRight(mark, '42px'))
    await expect.poll(() => homeText(project)).toBe(aligned)
    await expect.poll(() => leftEdgeGap(page)).toBeLessThan(0.5)

    await page.keyboard.press(`${MOD}+KeyZ`)
    await expect.poll(() => homeText(project)).toBe(nudged)
  })
})
