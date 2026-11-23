import type { Locator, Page } from '@playwright/test'
import { EDITOR_VIEWPORT, HOME_BOARD, MOD, canvasFrame, expect, goOffline, layerRowOf, openEditor, selectOnCanvas, test, type E2eProject } from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const FINAL = '<div class="col" style="width: 480px; padding: 16px; transform: rotate(-2deg)">Final boards</div>'

function homeText(project: E2eProject): string {
  return project.read(HOME_BOARD).toString('utf8')
}

function isSynced(project: E2eProject): boolean {
  return project.read(HOME_BOARD).equals(project.fixture(HOME_BOARD))
}

function withLineRemoved(text: string, fragment: string): string {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => line.includes(fragment))
  if (at < 0) throw new Error(`no line holds ${fragment}`)
  lines.splice(at, 1)
  return lines.join('\n')
}

function column(page: Page, text: string): Locator {
  return canvasFrame(page).locator('section.row > .col', { hasText: text })
}

test.describe('M8: keyboard', () => {
  test('Backspace on the canvas deletes the selected element, and undo restores the file byte-identical', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const final = await selectOnCanvas(page, column(page, 'Final boards'))

    await page.keyboard.press('Backspace')
    await expect.poll(() => homeText(project)).toBe(withLineRemoved(project.fixture(HOME_BOARD).toString('utf8'), FINAL))
    await expect(layerRowOf(page, final)).toHaveCount(0)
    await expect(column(page, 'Final boards')).toHaveCount(0)

    await page.keyboard.press(`${MOD}+KeyZ`)
    await expect.poll(() => isSynced(project)).toBe(true)
  })
})
