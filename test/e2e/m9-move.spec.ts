import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { EDITOR_VIEWPORT, HOME_BOARD, MOD, canvasFrame, computedStyleOf, edIdOf, expect, goOffline, layerRowOf, openEditor, selectOnCanvas, test, type E2eProject } from './harness'

const MARK_STYLE = 'position: absolute; top: 24px; right: 32px; width: 64px'
const LEDE_TAG = '<p class="lede">'
const LEDE_STYLE = 'position: absolute; top: 400px; left: 48px'
/** Longer than the writer's 300 ms debounce, so each repeat of a held key lands in a flush of its own. */
const PAST_DEBOUNCE_MS = 400

/** The home board with its lede taken out of flow, so two absolute elements share the page. */
function twoAbsoluteBoard(project: E2eProject): string {
  const original = project.fixture(HOME_BOARD).toString('utf8')
  expect(original).toContain(LEDE_TAG)
  return original.replace(LEDE_TAG, `<p class="lede" style="${LEDE_STYLE}">`)
}

/** The editor fixture launches on the overridden project, so the server indexes this board as pulled. */
const multiTest = test.extend<{ project: E2eProject }>({
  project: async ({ project }, use) => {
    writeFileSync(path.join(project.root, ...HOME_BOARD.split('/')), twoAbsoluteBoard(project))
    await use(project)
  },
})

multiTest.use({ viewport: EDITOR_VIEWPORT })

function boardText(project: E2eProject): string {
  return project.read(HOME_BOARD).toString('utf8')
}

function studioMark(page: Page): Locator {
  return canvasFrame(page).locator('img[alt="Studio mark"]')
}

function lede(page: Page): Locator {
  return canvasFrame(page).locator('p.lede')
}

async function addToSelectionInLayers(page: Page, element: Locator): Promise<void> {
  const row = layerRowOf(page, await edIdOf(element))
  await row.click({ modifiers: ['Shift'] })
  await expect(row).toHaveAttribute('aria-selected', 'true')
}

async function focusCanvas(page: Page): Promise<void> {
  await page.locator('[aria-label="Canvas"]').focus()
}

/** The studio mark sits at the hero's right edge, outside the canvas at zoom 1. */
async function fitBoard(page: Page): Promise<void> {
  await focusCanvas(page)
  await page.keyboard.press('Shift+Digit1')
}

multiTest.describe('M9: moving several elements', () => {
  multiTest('a held arrow nudges two absolute elements together, and one undo puts both back', async ({ page, project, editor }) => {
    const board = twoAbsoluteBoard(project)
    await goOffline(page)
    await openEditor(page, editor)
    await expect.poll(() => computedStyleOf(lede(page), ['position'])).toEqual({ position: 'absolute' })
    await fitBoard(page)
    const mark = studioMark(page)
    await selectOnCanvas(page, mark)
    await addToSelectionInLayers(page, lede(page))
    await expect(layerRowOf(page, await edIdOf(mark))).toHaveAttribute('aria-selected', 'true')
    await focusCanvas(page)

    await page.keyboard.down('ArrowDown')
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.waitForTimeout(PAST_DEBOUNCE_MS)
      await page.keyboard.down('ArrowDown')
    }
    await page.keyboard.up('ArrowDown')

    const nudged = board.replace(MARK_STYLE, MARK_STYLE.replace('top: 24px', 'top: 27px')).replace(LEDE_STYLE, LEDE_STYLE.replace('top: 400px', 'top: 403px'))
    await expect.poll(() => boardText(project)).toBe(nudged)

    await page.keyboard.press(`${MOD}+KeyZ`)

    await expect.poll(() => boardText(project)).toBe(board)
  })
})
