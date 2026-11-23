import type { Page } from '@playwright/test'
import {
  EDITOR_VIEWPORT,
  HOME_BOARD,
  MOD,
  canvasFrame,
  clickOnCanvas,
  computedStyleOf,
  doubleClickOnCanvas,
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

const BOARDS = [HOME_BOARD, 'project/card.dc.html']
const HEADER_RADIUS = 'border-radius: 12px'
const COMPARED_PROPS = [
  'border-top-left-radius',
  'border-bottom-right-radius',
  'background-color',
  'color',
  'padding-top',
  'padding-left',
  'width',
  'height',
] as const

function homeText(project: E2eProject): string {
  return project.read(HOME_BOARD).toString('utf8')
}

function originalHome(project: E2eProject): string {
  return project.fixture(HOME_BOARD).toString('utf8')
}

function changedLines(diff: string): string[] {
  return diff.split('\n').filter((line) => /^[-+](?![-+]{2} )/.test(line))
}

async function selectHeaderInLayers(page: Page): Promise<string> {
  const edId = await edIdOf(canvasFrame(page).locator('header.hero'))
  await layerRowOf(page, edId).click()
  await expect(layerRowOf(page, edId)).toHaveAttribute('aria-selected', 'true')
  return edId
}

async function setRadiusInPanel(page: Page, value: string): Promise<void> {
  const radius = page.locator('aside[aria-label="Properties"] [data-prop="border-radius"] input')
  await expect(radius).toHaveValue('12px')
  await radius.fill(value)
  await radius.press('Enter')
}

test.describe('M2: write-back', () => {
  test('an untouched session leaves a zero-byte diff', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectOnCanvas(page, canvasFrame(page).locator('h1'))
    await page.locator('header button[title="Toggle light / dark"]').click()
    await page.locator('[data-board="project/card.dc.html"]').click()
    await page.locator(`[data-board="${HOME_BOARD}"]`).click()
    await expect(canvasFrame(page).locator('h1')).toBeVisible()

    await editor.stop()

    expect(project.diff()).toBe('')
    expect(project.status()).toBe('')
    for (const board of BOARDS) expect(project.read(board).equals(project.fixture(board))).toBe(true)
  })

  test('editing one property in the panel gives a one-line diff, echoed by the save toast', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectHeaderInLayers(page)

    await setRadiusInPanel(page, '16px')

    const expected = originalHome(project).replace(HEADER_RADIUS, 'border-radius: 16px')
    await expect.poll(() => homeText(project)).toBe(expected)
    const changed = changedLines(project.diff())
    expect(changed).toHaveLength(2)
    expect(changed[0]).toMatch(/^-.*border-radius: 12px/)
    expect(changed[1]).toMatch(/^\+.*border-radius: 16px/)

    const toast = page.locator('[role="status"]').filter({ hasText: 'border-radius: 12px → 16px' })
    await expect(toast).toContainText('home.dc.html')
    await expect(toast).toContainText(/L21\b/)
    await expect(toast.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
    await expect(toast.getByRole('button', { name: 'Diff', exact: true })).toBeVisible()
    await expect(page.locator('[role="status"][aria-label^="Sync status"] [aria-current="step"]')).toContainText(/Edited\s*·\s*1/)
  })

  test("after the edit the iframe's computed style equals a fresh load of the written file", async ({ page, context, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectHeaderInLayers(page)
    const frameSrc = await page.locator('[aria-label="Canvas"] iframe').getAttribute('src')
    if (!frameSrc) throw new Error('the artboard frame has no src')

    await setRadiusInPanel(page, '16px')
    await expect.poll(() => homeText(project)).toContain('border-radius: 16px')

    const live = await computedStyleOf(canvasFrame(page).locator('header.hero'), COMPARED_PROPS)
    expect(live['border-top-left-radius']).toBe('16px')
    const fresh = await context.newPage()
    await goOffline(fresh)
    await fresh.setViewportSize({ width: 1280, height: 900 })
    await fresh.goto(new URL(frameSrc, editor.url).href)
    await expect(fresh.locator('header.hero')).toBeVisible()
    expect(await computedStyleOf(fresh.locator('header.hero'), COMPARED_PROPS)).toEqual(live)
  })

  test('Mod-Z restores the file byte-identical and Mod-Shift-Z writes the edit again', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectHeaderInLayers(page)
    await setRadiusInPanel(page, '16px')
    const edited = originalHome(project).replace(HEADER_RADIUS, 'border-radius: 16px')
    await expect.poll(() => homeText(project)).toBe(edited)
    await page.locator('header').click({ position: { x: 2, y: 2 } })

    await page.keyboard.press(`${MOD}+KeyZ`)
    await expect.poll(() => project.read(HOME_BOARD).equals(project.fixture(HOME_BOARD))).toBe(true)

    await page.keyboard.press(`${MOD}+Shift+KeyZ`)
    await expect.poll(() => homeText(project)).toBe(edited)
  })

  test("the diff panel lists the edit under its file and 'Revert file' restores it", async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectHeaderInLayers(page)
    await setRadiusInPanel(page, '16px')
    await expect.poll(() => homeText(project)).toContain('border-radius: 16px')

    const toast = page.locator('[role="status"]').filter({ hasText: 'border-radius: 12px → 16px' })
    await toast.getByRole('button', { name: 'Diff', exact: true }).click()
    const group = page.locator(`[data-diff-file="${HOME_BOARD}"]`)
    await expect(group).toContainText('border-radius: 12px → 16px')

    await group.getByRole('button', { name: 'Revert file' }).click()
    await expect.poll(() => project.read(HOME_BOARD).equals(project.fixture(HOME_BOARD))).toBe(true)
  })

  test('a text edit commit lands in the source', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const title = canvasFrame(page).locator('h1')
    await selectOnCanvas(page, title)

    await doubleClickOnCanvas(page, title)
    const editing = canvasFrame(page).locator('h1[contenteditable]')
    await expect(editing).toBeVisible()
    await editing.fill('Studio Monthly')
    await clickOnCanvas(page, canvasFrame(page).locator('p.lede'))

    const expected = originalHome(project).replace('>Studio Weekly</h1>', '>Studio Monthly</h1>')
    await expect.poll(() => homeText(project)).toBe(expected)
    expect(changedLines(project.diff())).toHaveLength(2)
    await expect(canvasFrame(page).locator('h1')).toHaveText('Studio Monthly')
  })
})
