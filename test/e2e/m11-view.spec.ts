import type { Locator, Page } from '@playwright/test'
import { EDITOR_VIEWPORT, HOME_BOARD, MOD, canvasFrame, computedStyleOf, expect, openEditor, test, type E2eProject } from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const INVISIBLE = 'rgba(0, 0, 0, 0)'
const HERO_FILL = 'rgb(194, 65, 12)'
const HERO_TEXT = 'rgb(255, 247, 237)'
const BANNER = 'Edits apply to all widths'

function expectUntouched(project: E2eProject): void {
  expect(project.read(HOME_BOARD).equals(project.fixture(HOME_BOARD))).toBe(true)
  expect(project.diff()).toBe('')
  expect(project.status()).toBe('')
}

async function toggleOutlineMode(page: Page): Promise<void> {
  await page.locator('[data-canvas-viewport]').focus()
  await page.keyboard.press(`${MOD}+Shift+KeyO`)
}

async function outlineLook(element: Locator): Promise<{ outline: string; fill: string; text: readonly string[] }> {
  const style = await computedStyleOf(element, ['outline-style', 'background-color', 'color', '-webkit-text-fill-color'])
  return { outline: style['outline-style']!, fill: style['background-color']!, text: [style['color']!, style['-webkit-text-fill-color']!] }
}

function frameWidth(page: Page): Promise<number> {
  return page.locator('[aria-label="Canvas"] iframe').evaluate((node: HTMLIFrameElement) => node.offsetWidth)
}

function pagePadding(page: Page): Promise<string> {
  return canvasFrame(page)
    .locator('main.page')
    .evaluate((node) => getComputedStyle(node).paddingLeft)
}

async function previewWidthMenu(page: Page): Promise<Locator> {
  const menu = page.getByRole('menu', { name: 'Preview width' })
  if (!(await menu.isVisible())) await page.getByRole('button', { name: 'Preview width', exact: true }).click()
  await expect(menu).toBeVisible()
  return menu
}

async function choosePreset(page: Page, width: number): Promise<void> {
  const menu = await previewWidthMenu(page)
  await menu.getByRole('menuitem', { name: new RegExp(`^${width}\\b`) }).click()
}

test.describe('M11: view', () => {
  test('outline mode on and off leaves a zero-byte diff', async ({ page, project, editor }) => {
    await openEditor(page, editor)
    const hero = canvasFrame(page).locator('header.hero')
    const heading = canvasFrame(page).locator('h1')

    await toggleOutlineMode(page)

    await expect.poll(async () => (await outlineLook(heading)).outline).not.toBe('none')
    await expect.poll(async () => (await outlineLook(hero)).fill).toBe(INVISIBLE)
    expect((await outlineLook(hero)).outline).not.toBe('none')
    expect((await outlineLook(heading)).text).toContain(INVISIBLE)

    await toggleOutlineMode(page)

    await expect.poll(async () => (await outlineLook(hero)).fill).toBe(HERO_FILL)
    expect(await outlineLook(heading)).toEqual({ outline: 'none', fill: INVISIBLE, text: [HERO_TEXT, HERO_TEXT] })
    expectUntouched(project)
  })

  test('preview width 375 re-lays out the board without a write', async ({ page, project, editor }) => {
    await openEditor(page, editor)
    expect(await pagePadding(page)).toBe('48px')
    await expect(page.getByText(BANNER)).toHaveCount(0)

    await choosePreset(page, 375)

    await expect.poll(() => frameWidth(page)).toBe(375)
    await expect.poll(() => pagePadding(page)).toBe('24px')
    await expect(page.getByText(BANNER)).toBeVisible()
    expectUntouched(project)

    await choosePreset(page, 1280)

    await expect(page.getByText(BANNER)).toHaveCount(0)
    await expect.poll(() => pagePadding(page)).toBe('48px')
    expectUntouched(project)
  })

  test('a custom preview width applies on Enter and clearing the field returns to the board width', async ({ page, project, editor }) => {
    await openEditor(page, editor)

    const field = (await previewWidthMenu(page)).getByLabel('Custom width')
    await field.fill('600')
    await field.press('Enter')

    await expect.poll(() => frameWidth(page)).toBe(600)
    await expect.poll(() => pagePadding(page)).toBe('24px')
    await expect(page.getByText(BANNER)).toBeVisible()

    const again = (await previewWidthMenu(page)).getByLabel('Custom width')
    await again.fill('')
    await again.press('Enter')

    await expect.poll(() => frameWidth(page)).toBe(1280)
    await expect(page.getByText(BANNER)).toHaveCount(0)
    expectUntouched(project)
  })
})
