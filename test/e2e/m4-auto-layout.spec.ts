import type { Locator, Page } from '@playwright/test'
import {
  EDITOR_VIEWPORT,
  HOME_BOARD,
  canvasFrame,
  computedStyleOf,
  edIdOf,
  expect,
  goOffline,
  layerRowOf,
  openEditor,
  test,
  type E2eProject,
} from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const HEADER_TAG = '<header class="hero"'
const TITLE_TAG = '<h1 '
const HEADER_LAYOUT_PROPS = ['display', 'flex-direction', 'justify-content', 'align-items'] as const
const TITLE_SIZING_PROPS = ['flex-grow', 'flex-shrink', 'flex-basis', 'min-width'] as const

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

function onState(control: Locator): Promise<string | null> {
  return control.evaluate((element) => element.getAttribute('aria-pressed') ?? element.getAttribute('aria-checked'))
}

async function selectInLayers(page: Page, element: Locator): Promise<void> {
  const edId = await edIdOf(element)
  await layerRowOf(page, edId).click()
  await expect(layerRowOf(page, edId)).toHaveAttribute('aria-selected', 'true')
}

test.describe('M4: auto layout', () => {
  test('a block header becomes a row, its alignment and sizing change, and the diff follows the R02 mapping', async ({
    page,
    context,
    project,
    editor,
  }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const original = originalHome(project)
    const header = canvasFrame(page).locator('header.hero')
    const title = canvasFrame(page).locator('h1')

    await selectInLayers(page, header)
    await properties(page).getByRole('button', { name: 'Add auto layout' }).click()
    await expect.poll(() => inlineStyleOf(homeText(project), HEADER_TAG)['display']).toBe('flex')

    const horizontal = properties(page).getByRole('button', { name: 'Horizontal' }).or(properties(page).getByRole('radio', { name: 'Horizontal' }))
    await horizontal.click()
    await expect.poll(() => onState(horizontal)).toBe('true')
    await expect.poll(() => inlineStyleOf(homeText(project), HEADER_TAG)['flex-direction']).toBe('row')

    // Top-right in a row: the x axis is justify-content, the y axis align-items.
    await properties(page).getByRole('radiogroup', { name: 'Alignment' }).getByRole('radio').nth(2).click()
    await expect.poll(() => inlineStyleOf(homeText(project), HEADER_TAG)['align-items']).toBe('flex-start')

    await selectInLayers(page, title)
    await properties(page).getByRole('radiogroup', { name: 'Width sizing' }).getByRole('radio', { name: 'Fill' }).click()

    await expect
      .poll(() => inlineStyleOf(homeText(project), TITLE_TAG))
      .toEqual({ ...inlineStyleOf(original, TITLE_TAG), flex: '1 1 0', 'min-width': '0' })
    expect(inlineStyleOf(homeText(project), HEADER_TAG)).toEqual({
      ...inlineStyleOf(original, HEADER_TAG),
      display: 'flex',
      'flex-direction': 'row',
      'justify-content': 'flex-end',
      'align-items': 'flex-start',
    })

    const changed = changedLines(project.diff())
    expect(changed).toHaveLength(4)
    expect(changed.filter((line) => line.startsWith('-')).map((line) => line.slice(1))).toEqual(
      original.split('\n').filter((line) => line.includes(HEADER_TAG) || line.includes(TITLE_TAG)),
    )

    const frameSrc = await page.locator('[aria-label="Canvas"] iframe').getAttribute('src')
    if (!frameSrc) throw new Error('the artboard frame has no src')
    const liveHeader = await computedStyleOf(header, HEADER_LAYOUT_PROPS)
    const liveTitle = await computedStyleOf(title, TITLE_SIZING_PROPS)
    const asFlex = (value: string | undefined) => value?.replace(/^flow-/, 'flex-')
    expect({ ...liveHeader, 'justify-content': asFlex(liveHeader['justify-content']), 'align-items': asFlex(liveHeader['align-items']) })
      .toEqual({ display: 'flex', 'flex-direction': 'row', 'justify-content': 'flex-end', 'align-items': 'flex-start' })
    expect(liveTitle['flex-grow']).toBe('1')
    expect(liveTitle['flex-basis']).toBe('0px')
    expect(liveTitle['min-width']).toBe('0px')

    const fresh = await context.newPage()
    await goOffline(fresh)
    await fresh.setViewportSize({ width: 1280, height: 900 })
    await fresh.goto(new URL(frameSrc, editor.url).href)
    await expect(fresh.locator('header.hero')).toBeVisible()
    expect(await computedStyleOf(fresh.locator('header.hero'), HEADER_LAYOUT_PROPS)).toEqual(liveHeader)
    expect(await computedStyleOf(fresh.locator('h1'), TITLE_SIZING_PROPS)).toEqual(liveTitle)
  })
})
