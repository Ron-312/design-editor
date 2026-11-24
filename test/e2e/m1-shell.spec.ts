import { existsSync, statSync } from 'node:fs'
import {
  EDITOR_VIEWPORT,
  HOME_BOARD,
  MOD,
  canvasFrame,
  clickOnCanvas,
  edIdOf,
  expect,
  goOffline,
  layerRowOf,
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

  test('a click selects the smallest layer, and a Cmd/Ctrl-click the layer around it', async ({ page, editor }) => {
    await openEditor(page, editor)
    const title = canvasFrame(page).locator('h1')
    const selectedRows = page.locator('[role="treeitem"][aria-selected="true"]')
    const hero = canvasFrame(page).locator('header.hero')
    const aroundId = await edIdOf(title.locator('xpath=..'))
    const outerId = await edIdOf(title.locator('xpath=../..'))

    const titleId = await selectOnCanvas(page, title)
    await expect(selectedRows).toHaveCount(1)
    await expect(selectedRows).toHaveAttribute('data-layer-id', titleId)

    await clickOnCanvas(page, title, [MOD])
    await expect(selectedRows).toHaveAttribute('data-layer-id', aroundId)
    await clickOnCanvas(page, title, [MOD])
    await expect(selectedRows).toHaveAttribute('data-layer-id', outerId)
    await expect(selectedRows).toHaveCount(1)

    const heroId = await edIdOf(hero)
    await layerRowOf(page, heroId).click()
    await expect(selectedRows).toHaveAttribute('data-layer-id', heroId)
    await clickOnCanvas(page, canvasFrame(page).locator('section.row > .col').first(), [MOD])
    await expect(selectedRows).toHaveCount(1)
    await expect(selectedRows).toHaveAttribute('data-layer-id', await edIdOf(canvasFrame(page).locator('section.row')))
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

test.describe("M1: the mockup's canvas chrome", () => {
  test('opens with the board fitted whole inside the canvas, its zoom shown in the top bar', async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)

    const canvas = await page.locator('[aria-label="Canvas"]').boundingBox()
    const frame = await page.locator('[aria-label="Canvas"] iframe').boundingBox()
    if (!canvas || !frame) throw new Error('the canvas or its board is not laid out')
    expect(frame.x).toBeGreaterThan(canvas.x + 20)
    expect(frame.y).toBeGreaterThan(canvas.y + 20)
    expect(frame.x + frame.width).toBeLessThan(canvas.x + canvas.width)
    expect(frame.y + frame.height).toBeLessThan(canvas.y + canvas.height)
    const zoom = Math.round((frame.width / 1280) * 100)
    await expect(page.locator('header [data-zoom-percent]')).toHaveText(`${zoom}%`)
    await expect(page.locator('[data-board-label]')).toHaveText(/home\.dc\.html\s*1280 × 900/)
  })

  test('Push only says to run /design-push in Claude Code, with the count of waiting changes', async ({ page, editor, project }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const before = project.status()

    await page.locator('header').getByRole('button', { name: /^Push/ }).click()

    const dialog = page.getByRole('dialog', { name: 'Push' })
    await expect(dialog).toContainText('Run /design-push in Claude Code')
    await expect(dialog).toContainText('No changes waiting to push yet')
    expect(project.status()).toBe(before)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('the dock pans with the hand tool, and shows the tools still to come as disabled', async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const dock = page.getByRole('toolbar', { name: 'Tools' })
    const frame = page.locator('[aria-label="Canvas"] iframe')
    const start = (await frame.boundingBox())!

    await dock.getByRole('button', { name: 'Hand' }).click()
    await page.mouse.move(600, 400)
    await page.mouse.down()
    await page.mouse.move(660, 440, { steps: 4 })
    await page.mouse.up()

    const moved = (await frame.boundingBox())!
    expect(moved.x - start.x).toBeCloseTo(60, 0)
    expect(moved.y - start.y).toBeCloseTo(40, 0)
    await expect(dock.getByRole('button', { name: 'Hand' })).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Frame', 'Box', 'Text', 'Image', 'Code view']) {
      await expect(dock.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
      await expect(dock.getByRole('button', { name })).toHaveAttribute('title', /coming soon/)
    }
  })
})
