import type { Locator, Page } from '@playwright/test'
import { EDITOR_VIEWPORT, HOME_BOARD, canvasFrame, computedStyleOf, edIdOf, expect, goOffline, layerRowOf, openEditor, screenBoxOf, test, type E2eProject } from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const ROW_TAG = '<section class="row"'

function homeText(project: E2eProject): string {
  return project.read(HOME_BOARD).toString('utf8')
}

function originalHome(project: E2eProject): string {
  return project.fixture(HOME_BOARD).toString('utf8')
}

function changedLines(diff: string): string[] {
  return diff.split('\n').filter((line) => /^[-+](?![-+]{2} )/.test(line))
}

/** The declarations of the inline `style` on the first line holding `openTag`. */
function inlineStyleOf(text: string, openTag: string): Record<string, string> {
  const line = text.split('\n').find((candidate) => candidate.includes(openTag))
  const style = line && /style="([^"]*)"/.exec(line)?.[1]
  if (style === undefined || style === null) throw new Error(`no inline style on ${openTag}`)
  return Object.fromEntries(
    style
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const colon = declaration.indexOf(':')
        return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]
      }),
  )
}

function properties(page: Page): Locator {
  return page.locator('aside[aria-label="Properties"]')
}

async function selectInLayers(page: Page, element: Locator): Promise<void> {
  const edId = await edIdOf(element)
  await layerRowOf(page, edId).click()
  await expect(layerRowOf(page, edId)).toHaveAttribute('aria-selected', 'true')
}

async function centreYOf(element: Locator): Promise<number> {
  const box = await screenBoxOf(element)
  return box.y + box.height / 2
}

async function bottomOf(element: Locator): Promise<number> {
  const box = await screenBoxOf(element)
  return box.y + box.height
}

test.describe('M10: auto layout', () => {
  test('wrapping a flex row moves the item that no longer fits onto a new line, and row-gap spaces the lines', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const original = originalHome(project)
    const row = canvasFrame(page).locator('section.row')
    const first = row.locator('.col').nth(0)
    // The three columns are 1208px wide with their gaps, wider than the 1184px row, so the last wraps.
    const last = row.locator('.col').nth(2)
    expect(Math.abs((await centreYOf(last)) - (await centreYOf(first)))).toBeLessThan(10)

    await selectInLayers(page, row)
    const wrap = properties(page).getByRole('button', { name: 'Wrap', exact: true })
    await expect(wrap).toHaveAttribute('aria-pressed', 'false')
    await wrap.click()

    await expect.poll(() => inlineStyleOf(homeText(project), ROW_TAG)['flex-wrap']).toBe('wrap')
    await expect(wrap).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await centreYOf(last)) > (await bottomOf(first))).toBe(true)
    const wrappedTop = (await screenBoxOf(last)).y

    const rowGap = properties(page).locator('[data-prop="row-gap"] input')
    await expect(rowGap).toBeVisible()
    await expect(properties(page).locator('[data-prop="column-gap"] input')).toBeVisible()
    await expect(properties(page).locator('[data-prop="align-content"] select')).toBeVisible()
    await rowGap.fill('40')
    await rowGap.press('Enter')

    await expect.poll(() => inlineStyleOf(homeText(project), ROW_TAG)).toEqual({ ...inlineStyleOf(original, ROW_TAG), 'flex-wrap': 'wrap', 'row-gap': '40px' })
    const frame = page.locator('[aria-label="Canvas"] iframe')
    const scale = await frame.evaluate((node: HTMLIFrameElement) => node.getBoundingClientRect().width / node.offsetWidth)
    // The default row gap came from `gap: 16px`, so the second line moves down by the other 24px.
    await expect.poll(async () => (await screenBoxOf(last)).y - wrappedTop).toBeCloseTo(24 * scale, 0)
    expect(await computedStyleOf(row, ['flex-wrap', 'row-gap'])).toEqual({ 'flex-wrap': 'wrap', 'row-gap': '40px' })
    expect(changedLines(project.diff())).toHaveLength(2)
  })
})
