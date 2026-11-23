import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { EDITOR_VIEWPORT, MOD, canvasFrame, edIdOf, expect, goOffline, layerRowOf, openEditor, screenBoxOf, test, type E2eProject } from './harness'

const CARD_BOARD = 'project/card.dc.html'
const PX_WIDTH = 'width: 328px'
/** 328px at the default 16px root font size. */
const REM_WIDTH = 'width: 20.5rem'
/** 20.5rem content + 2 × 16px padding + 2 × 1px border: `.card` is content-box. */
const CARD_BORDER_BOX = 362

/** The card board with its width authored in rem. */
function remBoard(project: E2eProject): string {
  const original = project.fixture(CARD_BOARD).toString('utf8')
  expect(original).toContain(PX_WIDTH)
  return original.replace(PX_WIDTH, REM_WIDTH)
}

/** The editor fixture launches on the overridden project, so the server indexes this board as pulled. */
const remTest = test.extend<{ project: E2eProject }>({
  project: async ({ project }, use) => {
    writeFileSync(path.join(project.root, ...CARD_BOARD.split('/')), remBoard(project))
    await use(project)
  },
})

remTest.use({ viewport: EDITOR_VIEWPORT })

function boardText(project: E2eProject): string {
  return project.read(CARD_BOARD).toString('utf8')
}

async function openCardBoard(page: Page): Promise<Locator> {
  await page.locator(`[data-board="${CARD_BOARD}"]`).click()
  await expect(canvasFrame(page).locator('h2')).toBeVisible()
  return canvasFrame(page).locator('article.card')
}

async function selectInLayers(page: Page, element: Locator): Promise<void> {
  const row = layerRowOf(page, await edIdOf(element))
  await row.click()
  await expect(row).toHaveAttribute('aria-selected', 'true')
}

async function hover(page: Page, element: Locator): Promise<void> {
  const box = await screenBoxOf(element)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

/** Drags a resize handle by (dx, dy) screen px. */
async function dragHandle(page: Page, name: string, dx: number, dy: number): Promise<void> {
  const handle = page.locator(`[data-resize-handle="${name}"]`)
  await expect.poll(() => handle.boundingBox()).not.toBeNull()
  const box = (await handle.boundingBox())!
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 8 })
  await page.mouse.up()
}

remTest.describe('M9: resizing keeps the authored unit', () => {
  remTest('narrowing a rem width writes rem, and one undo restores the file', async ({ page, project, editor }) => {
    const board = remBoard(project)
    await goOffline(page)
    await openEditor(page, editor)
    const card = await openCardBoard(page)
    await selectInLayers(page, card)
    const zoom = (await screenBoxOf(card)).width / CARD_BORDER_BOX
    await hover(page, card)

    await dragHandle(page, 'e', -40 * zoom, 0)

    await expect.poll(() => boardText(project)).toBe(board.replace(REM_WIDTH, 'width: 18rem'))

    await page.keyboard.press(`${MOD}+KeyZ`)

    await expect.poll(() => boardText(project)).toBe(board)
  })
})
