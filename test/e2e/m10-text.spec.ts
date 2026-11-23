import type { Locator, Page } from '@playwright/test'
import { EDITOR_VIEWPORT, canvasFrame, computedStyleOf, edIdOf, expect, goOffline, layerRowOf, openEditor, test, type E2eProject } from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const CARD_BOARD = 'project/card.dc.html'
const TITLE_TAG = '<h2 '

function cardText(project: E2eProject): string {
  return project.read(CARD_BOARD).toString('utf8')
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

function textSection(page: Page): Locator {
  return page
    .locator('aside[aria-label="Properties"] section[data-section]')
    .filter({ has: page.locator('h3', { hasText: /^Text/ }) })
}

function namedControl(scope: Locator, name: RegExp): Locator {
  return scope.getByRole('radio', { name }).or(scope.getByRole('button', { name }))
}

async function selectInLayers(page: Page, element: Locator): Promise<void> {
  const edId = await edIdOf(element)
  await layerRowOf(page, edId).click()
  await expect(layerRowOf(page, edId)).toHaveAttribute('aria-selected', 'true')
}

test.describe('M10: text controls', () => {
  test('centring a heading writes text-align: center into its inline style and nothing else', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await page.locator(`[data-board="${CARD_BOARD}"]`).click()
    const title = canvasFrame(page).locator('h2')
    await expect(title).toBeVisible()
    await selectInLayers(page, title)

    await namedControl(textSection(page), /cent(er|re)/i).click()

    await expect.poll(() => inlineStyleOf(cardText(project), TITLE_TAG)).toEqual({ margin: '0 0 8px', 'text-align': 'center' })
    expect(changedLines(project.diff())).toHaveLength(2)
    await expect.poll(() => computedStyleOf(title, ['text-align'])).toEqual({ 'text-align': 'center' })
  })
})
