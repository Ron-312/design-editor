import type { Page } from '@playwright/test'
import { EDITOR_VIEWPORT, canvasFrame, edIdOf, expect, goOffline, layerRowOf, openEditor, test, type E2eProject } from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const CARD_BOARD = 'project/card.dc.html'
const CARD_FILL = 'background-color: #ffffff'

function cardText(project: E2eProject): string {
  return project.read(CARD_BOARD).toString('utf8')
}

function changedLines(diff: string): string[] {
  return diff.split('\n').filter((line) => /^[-+](?![-+]{2} )/.test(line))
}

async function selectCardInLayers(page: Page): Promise<void> {
  await page.locator(`[data-board="${CARD_BOARD}"]`).click()
  const card = canvasFrame(page).locator('article.card')
  await expect(card).toBeVisible()
  const edId = await edIdOf(card)
  await layerRowOf(page, edId).click()
  await expect(layerRowOf(page, edId)).toHaveAttribute('aria-selected', 'true')
}

function computedBackground(page: Page): Promise<string> {
  return canvasFrame(page)
    .locator('article.card')
    .evaluate((node) => getComputedStyle(node).backgroundColor)
}

test.describe('M10: colour picker', () => {
  test('picking a colour with the square previews while dragging and writes once on release', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectCardInLayers(page)

    const fill = page.locator('aside[aria-label="Properties"] [data-prop="background-color"]')
    await fill.locator('button[aria-haspopup="dialog"]').click()
    const square = page.getByRole('dialog', { name: 'Colour picker' }).locator('[aria-label="Saturation and value"]')
    const box = await square.boundingBox()
    if (!box) throw new Error('the saturation and value square is not rendered')

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 4, box.y + (box.height * 3) / 4, { steps: 5 })
    await page.mouse.move(box.x - 5, box.y + box.height + 5, { steps: 5 })
    await expect.poll(() => computedBackground(page)).toBe('rgb(0, 0, 0)')
    expect(project.read(CARD_BOARD).equals(project.fixture(CARD_BOARD))).toBe(true)
    await page.mouse.up()

    const expected = project.fixture(CARD_BOARD).toString('utf8').replace(CARD_FILL, 'background-color: #000000')
    await expect.poll(() => cardText(project)).toBe(expected)
    expect(changedLines(project.diff())).toHaveLength(2)
    await expect(page.locator('[role="status"][aria-label^="Sync status"] [aria-current="step"]')).toContainText(/Edited\s*·\s*1/)
  })
})
