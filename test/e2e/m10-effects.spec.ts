import type { Page } from '@playwright/test'
import { EDITOR_VIEWPORT, canvasFrame, edIdOf, expect, goOffline, layerRowOf, openEditor, test, type E2eProject } from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const CARD_BOARD = 'project/card.dc.html'

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

function computedShadow(page: Page): Promise<string> {
  return canvasFrame(page)
    .locator('article.card')
    .evaluate((node) => getComputedStyle(node).boxShadow)
}

test.describe('M10: shadows', () => {
  test('adding a shadow layer writes one box-shadow declaration and shows the layer', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectCardInLayers(page)
    expect(await computedShadow(page)).toBe('none')

    const shadows = page.locator('aside[aria-label="Properties"] [data-prop="box-shadow"]')
    await shadows.getByRole('button', { name: 'Add shadow' }).click()

    await expect(shadows.locator('[data-shadow]')).toHaveCount(1)
    await expect.poll(() => computedShadow(page)).not.toBe('none')
    await expect.poll(() => cardText(project)).toMatch(/style="background-color: #ffffff; width: 328px; box-shadow: [^";]+"/)
    expect(cardText(project).replace(/; box-shadow: [^";]+"/, '"')).toBe(project.fixture(CARD_BOARD).toString('utf8'))
    expect(changedLines(project.diff())).toHaveLength(2)
    await expect(page.locator('[role="status"][aria-label^="Sync status"] [aria-current="step"]')).toContainText(/Edited\s*·\s*1/)
  })
})
