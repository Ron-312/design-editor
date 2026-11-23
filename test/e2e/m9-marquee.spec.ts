import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { EDITOR_VIEWPORT, HOME_BOARD, canvasFrame, edIdOf, expect, goOffline, layerRowOf, openEditor, screenBoxOf, test, type E2eProject } from './harness'

const ROW_STYLE = 'display: flex; gap: 16px; margin-top: 24px'
/** Room around the columns that is the row's own background, so a press there lands on the row itself. */
const PADDED_ROW_STYLE = `${ROW_STYLE}; padding: 32px`
/** Screen px inside the row's padding, clear of the columns and of the rotated third column's corners. */
const INSET_PX = 8

function paddedRowBoard(project: E2eProject): string {
  const original = project.fixture(HOME_BOARD).toString('utf8')
  expect(original).toContain(ROW_STYLE)
  return original.replace(ROW_STYLE, PADDED_ROW_STYLE)
}

/** The editor fixture launches on the overridden project, so the server indexes this board as pulled. */
const marqueeTest = test.extend<{ project: E2eProject }>({
  project: async ({ project }, use) => {
    writeFileSync(path.join(project.root, ...HOME_BOARD.split('/')), paddedRowBoard(project))
    await use(project)
  },
})

marqueeTest.use({ viewport: EDITOR_VIEWPORT })

function row(page: Page): Locator {
  return canvasFrame(page).locator('section.row')
}

function columns(page: Page): Locator {
  return canvasFrame(page).locator('section.row > .col')
}

/** The whole row must be on screen for the marquee to cover it. */
async function fitBoard(page: Page): Promise<void> {
  await page.locator('[aria-label="Canvas"]').focus()
  await page.keyboard.press('Shift+Digit1')
}

/** From the row's top-left padding to its bottom-right padding, in steps, as a hand drags. */
async function marqueeAcross(page: Page, element: Locator): Promise<void> {
  const box = await screenBoxOf(element)
  await page.mouse.move(box.x + INSET_PX, box.y + INSET_PX)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
  await page.mouse.move(box.x + box.width - INSET_PX, box.y + box.height - INSET_PX, { steps: 5 })
  await page.mouse.up()
}

marqueeTest.describe('M9: marquee select', () => {
  marqueeTest("a drag on the row's own background selects its three columns", async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await expect.poll(() => columns(page).count()).toBe(3)
    await fitBoard(page)
    const columnIds = await Promise.all((await columns(page).all()).map(edIdOf))
    const rowId = await edIdOf(row(page))

    await expect(async () => {
      await marqueeAcross(page, row(page))
      for (const id of columnIds) await expect(layerRowOf(page, id)).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 })
    }).toPass()

    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(3)
    await expect(layerRowOf(page, rowId)).not.toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('[data-marquee]')).toHaveCount(0)
  })
})
