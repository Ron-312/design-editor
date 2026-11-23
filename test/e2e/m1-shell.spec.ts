import { existsSync, statSync } from 'node:fs'
import {
  EDITOR_VIEWPORT,
  HOME_BOARD,
  canvasFrame,
  expect,
  goOffline,
  mockupTokenNames,
  openEditor,
  openMockup,
  selectOnCanvas,
  test,
  tokenValues,
  type Theme,
} from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const syncStrip = '[role="status"][aria-label^="Sync status"]'

test.describe('M1: open a pulled project', () => {
  test('opens a project whose path has spaces and non-ASCII characters, on 127.0.0.1', async ({ page, project, editor }) => {
    expect(project.root).toMatch(/ /)
    expect(project.root).toMatch(/[^ -~]/)
    expect(new URL(editor.url).hostname).toBe('127.0.0.1')

    await openEditor(page, editor)

    const topBar = page.locator('header')
    await expect(topBar).toContainText(HOME_BOARD.split('/').at(-1)!)
    await expect(topBar.locator(syncStrip)).toContainText(/Pulled.*Edited.*Pushing/)
    await expect(topBar.locator(`${syncStrip} [aria-current="step"]`)).toContainText('Pulled')
  })

  test('clicking an element selects its layer row and shows the rule it comes from', async ({ page, editor }) => {
    await openEditor(page, editor)
    const title = canvasFrame(page).locator('h1')

    const edId = await selectOnCanvas(page, title)

    const selectedRows = page.locator('[role="treeitem"][aria-selected="true"]')
    await expect(selectedRows).toHaveCount(1)
    await expect(selectedRows).toHaveAttribute('data-layer-id', edId)
    await expect(page.locator('[data-selector-chip]')).toHaveText(/style\s*·\s*home\.dc\.html:22/)
  })

  test("shows the offline banner naming the font that did not load", async ({ page, editor }) => {
    await goOffline(page)

    await openEditor(page, editor)

    await expect(page.getByText('offline: Inter not loaded, layout may differ; sizes tuned now may be off')).toBeVisible()
  })
})

test.describe('M1: the shell follows the B Warm studio mockup', () => {
  const themes: readonly Theme[] = ['dark', 'light']

  for (const theme of themes) {
    test(`a ${theme} shot of the editor sits next to the mockup's, with the same token values`, async ({ page, editor }, testInfo) => {
      await goOffline(page)
      const names = mockupTokenNames()

      await openMockup(page, theme)
      const mockupShot = testInfo.outputPath(`mockup-${theme}.png`)
      await page.screenshot({ path: mockupShot })
      const mockupTokens = await tokenValues(page, names)

      await openEditor(page, editor, theme)
      const editorShot = testInfo.outputPath(`editor-${theme}.png`)
      await page.screenshot({ path: editorShot })
      const editorTokens = await tokenValues(page, names)

      for (const shot of [mockupShot, editorShot]) {
        expect(existsSync(shot) && statSync(shot).size > 0).toBe(true)
        await testInfo.attach(shot.split(/[\\/]/).at(-1)!, { path: shot, contentType: 'image/png' })
      }
      expect(editorTokens).toEqual(mockupTokens)
      expect(await page.evaluate(() => document.documentElement.classList.contains('light'))).toBe(theme === 'light')
    })
  }

  test('the sun/moon button switches the editor to the light theme', async ({ page, editor }) => {
    await goOffline(page)
    const names = mockupTokenNames()
    await openMockup(page, 'light')
    const lightTokens = await tokenValues(page, names)

    await openEditor(page, editor)
    await page.locator('header button[title="Toggle light / dark"]').click()

    expect(await tokenValues(page, names)).toEqual(lightTokens)
  })

  test('uses Instrument Sans with tabular numerals, JetBrains Mono for code facts, and the mockup spacing', async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectOnCanvas(page, canvasFrame(page).locator('h1'))

    const styleOf = (selector: string, prop: string) =>
      page.locator(selector).first().evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), prop)

    expect(await styleOf('body', 'font-family')).toMatch(/^"Instrument Sans"/)
    expect(await styleOf('body', 'font-variant-numeric')).toBe('tabular-nums')
    expect(await styleOf('[data-selector-chip] .mono', 'font-family')).toMatch(/^"JetBrains Mono"/)
    expect(await styleOf('header', 'column-gap')).toBe('8px')
    expect(await styleOf('[role="treeitem"]', 'height')).toBe('28px')
    expect(await styleOf('aside[aria-label="Properties"] [data-section]', 'padding-left')).toBe('12px')
    expect(await styleOf('aside[aria-label="Properties"] [data-section]', 'padding-bottom')).toBe('12px')
  })
})
