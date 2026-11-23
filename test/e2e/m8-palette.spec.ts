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
  selectOnCanvas,
  test,
  type E2eProject,
} from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const SKETCHES = '<div class="col" style="width: 360px; padding: 16px">Sketches</div>'
const DUPLICATE_GLYPH = process.platform === 'darwin' ? '⌘D' : 'Ctrl+D'
/** Past the writer's 300 ms debounce, so an edit Escape wrongly ran would be on disk. */
const PAST_DEBOUNCE_MS = 400

function homeText(project: E2eProject): string {
  return project.read(HOME_BOARD).toString('utf8')
}

function isSynced(project: E2eProject): boolean {
  return project.read(HOME_BOARD).equals(project.fixture(HOME_BOARD))
}

function withLineDuplicated(text: string, fragment: string): string {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => line.includes(fragment))
  if (at < 0) throw new Error(`no line holds ${fragment}`)
  lines.splice(at + 1, 0, lines[at]!)
  return lines.join('\n')
}

function palette(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Command palette' })
}

function topOption(page: Page): Locator {
  return palette(page).getByRole('option').first()
}

test.describe('M8: command palette', () => {
  test('Mod-K opens the palette, and Enter runs the top action on the selection', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectOnCanvas(page, canvasFrame(page).locator('.col', { hasText: 'Sketches' }))

    await page.keyboard.press(`${MOD}+KeyK`)
    await expect(palette(page)).toBeVisible()
    await palette(page).locator('input').fill('Duplicate')
    await expect(topOption(page)).toContainText('Duplicate')
    await expect(topOption(page)).toContainText(DUPLICATE_GLYPH)
    await page.keyboard.press('Enter')

    await expect(palette(page)).toBeHidden()
    const original = project.fixture(HOME_BOARD).toString('utf8')
    await expect.poll(() => homeText(project)).toBe(withLineDuplicated(original, SKETCHES))
  })

  test('Mod-/ finds a layer by name, and Enter selects it', async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const lede = await edIdOf(canvasFrame(page).locator('p.lede'))
    await page.locator('[data-canvas-viewport]').focus()

    await page.keyboard.press(`${MOD}+Slash`)
    await expect(palette(page)).toBeVisible()
    await palette(page).locator('input').fill('lede')
    await expect(topOption(page)).toContainText('lede')
    await page.keyboard.press('Enter')

    await expect(palette(page)).toBeHidden()
    await expect(layerRowOf(page, lede)).toHaveAttribute('aria-selected', 'true')
  })

  test('Escape closes the palette and changes nothing', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectOnCanvas(page, canvasFrame(page).locator('.col', { hasText: 'Sketches' }))

    await page.keyboard.press(`${MOD}+KeyK`)
    await expect(palette(page)).toBeVisible()
    await palette(page).locator('input').fill('Duplicate')
    await page.keyboard.press('Escape')

    await expect(palette(page)).toBeHidden()
    await page.waitForTimeout(PAST_DEBOUNCE_MS)
    expect(isSynced(project)).toBe(true)
  })

  test('Mod-K in the layer search box stays with the box and opens no palette', async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const search = page.locator('input[aria-label="Find layer"]')
    await search.focus()

    await page.keyboard.press(`${MOD}+KeyK`)

    await expect(search).toBeFocused()
    await expect(palette(page)).toHaveCount(0)
  })
})
