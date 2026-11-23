import type { Locator, Page } from '@playwright/test'
import type { EditorState } from '../../src/shared/protocol'
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

const ROW_START_TAG = '<section class="row" style="display: flex; gap: 16px; margin-top: 24px">'

function homeText(project: E2eProject): string {
  return project.read(HOME_BOARD).toString('utf8')
}

function originalHome(project: E2eProject): string {
  return project.fixture(HOME_BOARD).toString('utf8')
}

function isSynced(project: E2eProject): boolean {
  return project.read(HOME_BOARD).equals(project.fixture(HOME_BOARD))
}

function changedLines(diff: string): string[] {
  return diff.split('\n').filter((line) => /^[-+](?![-+]{2} )/.test(line))
}

function editorState(project: E2eProject): EditorState | null {
  try {
    return JSON.parse(project.read('.editor/state.json').toString('utf8')) as EditorState
  } catch {
    return null
  }
}

function layerSearch(page: Page): Locator {
  return page.getByRole('searchbox', { name: 'Find layer' })
}

function rowWithTag(page: Page, tag: string): Locator {
  return page.locator('[role="treeitem"]').filter({ hasText: tag })
}

function layerTypeOf(row: Locator): Locator {
  return row.locator('[data-layer-type]')
}

async function renameLayer(page: Page, edId: string, shownName: string, newName: string, commitKey = 'Enter'): Promise<void> {
  const row = layerRowOf(page, edId)
  await row.getByText(shownName, { exact: true }).dblclick()
  const field = row.getByRole('textbox')
  await expect(field).toBeFocused()
  await expect(field).toHaveValue(shownName)
  await field.fill(newName)
  await field.press(commitKey)
}

function focusIsInLayersPanel(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest('nav[aria-label="Layers"]') != null)
}

test.describe('M11: layers panel', () => {
  test('renaming a layer writes data-layer-name into its start tag, and clearing the name removes it byte-for-byte', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const row = await edIdOf(canvasFrame(page).locator('section.row'))

    await renameLayer(page, row, 'row', 'Columns')

    const renamed = originalHome(project).replace(ROW_START_TAG, ROW_START_TAG.replace('>', ' data-layer-name="Columns">'))
    await expect.poll(() => homeText(project)).toBe(renamed)
    const changed = changedLines(project.diff())
    expect(changed).toHaveLength(2)
    expect(changed[1]).toMatch(/^\+.*<section class="row".*data-layer-name="Columns"/)
    await expect(layerRowOf(page, row)).toHaveAttribute('aria-label', 'Columns')

    await renameLayer(page, row, 'Columns', '')

    await expect.poll(() => isSynced(project)).toBe(true)
    await expect(layerRowOf(page, row)).toHaveAttribute('aria-label', 'row')
  })

  test('Escape leaves the name and the file as they were', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const row = await edIdOf(canvasFrame(page).locator('section.row'))

    await renameLayer(page, row, 'row', 'Columns', 'Escape')

    await expect(layerRowOf(page, row).getByRole('textbox')).toHaveCount(0)
    await expect(layerRowOf(page, row)).toHaveAttribute('aria-label', 'row')
    expect(isSynced(project)).toBe(true)
  })

  test('layer icons show the live layout and the template kind', async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)

    await expect(layerTypeOf(layerRowOf(page, await edIdOf(canvasFrame(page).locator('section.row'))))).toHaveAttribute('data-layer-type', 'flex-row')
    await expect(layerTypeOf(layerRowOf(page, await edIdOf(canvasFrame(page).locator('h1'))))).toHaveAttribute('data-layer-type', 'text')
    await expect(layerTypeOf(layerRowOf(page, await edIdOf(canvasFrame(page).locator('header img'))))).toHaveAttribute('data-layer-type', 'image')
    await expect(layerTypeOf(rowWithTag(page, 'sc-for'))).toHaveAttribute('data-layer-type', 'repeat')
    await expect(layerTypeOf(rowWithTag(page, 'sc-if'))).toHaveAttribute('data-layer-type', 'condition')
    await expect(layerTypeOf(rowWithTag(page, 'dc-import'))).toHaveAttribute('data-layer-type', 'import')
  })

  test('Mod-F focuses layer search from the canvas, and Alt-L collapses every layer as editor-only state', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const brief = await selectOnCanvas(page, canvasFrame(page).locator('section.row > .col', { hasText: 'Brief' }))

    await page.keyboard.press(`${MOD}+KeyF`)
    await expect(layerSearch(page)).toBeFocused()

    await layerSearch(page).press('Escape')
    await page.keyboard.press('Alt+KeyL')

    await expect(layerRowOf(page, brief)).toHaveCount(0)
    await expect.poll(() => editorState(project)?.collapsed.length ?? 0).toBeGreaterThan(0)
    expect(project.diff()).toBe('')
  })

  test('clicking a layer-row button keeps focus in the layers panel', async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const row = layerRowOf(page, await edIdOf(canvasFrame(page).locator('section.row')))

    await row.getByRole('button', { name: 'Collapse' }).click()
    await expect.poll(() => focusIsInLayersPanel(page)).toBe(true)

    await row.getByRole('button', { name: 'Hide' }).click()
    await expect.poll(() => focusIsInLayersPanel(page)).toBe(true)
  })
})
