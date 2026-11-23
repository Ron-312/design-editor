import type { Locator, Page } from '@playwright/test'
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
  screenBoxOf,
  selectOnCanvas,
  test,
  type E2eProject,
} from './harness'

test.use({ viewport: EDITOR_VIEWPORT })

const CARD_BOARD = 'project/card.dc.html'
const MARK_STYLE = 'position: absolute; top: 24px; right: 32px; width: 64px'
const MARK_CSS_WIDTH = 64
/** 328px content + 2 × 16px padding + 2 × 1px border: `.card` is content-box. */
const CARD_BORDER_BOX = 362
const BRIEF_LINE = '      <div class="col" style="width: 240px; padding: 16px">Brief</div>\n'
const SKETCHES_LINE = '      <div class="col" style="width: 360px; padding: 16px">Sketches</div>\n'

interface Point {
  readonly x: number
  readonly y: number
}

interface Drag {
  /** Moves the pointer to the grab point plus (dx, dy) screen px, with the button still down. */
  readonly moveBy: (dx: number, dy: number) => Promise<void>
  readonly drop: () => Promise<void>
}

function boardText(project: E2eProject, board: string): string {
  return project.read(board).toString('utf8')
}

function originalText(project: E2eProject, board: string): string {
  return project.fixture(board).toString('utf8')
}

function markWithTop(top: string): string {
  return MARK_STYLE.replace('top: 24px', `top: ${top}`)
}

function boxOf(element: Locator) {
  return screenBoxOf(element)
}

async function centreOf(element: Locator): Promise<Point> {
  const box = await boxOf(element)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Screen px per CSS px, read off an element whose CSS width is known. */
async function zoomOf(element: Locator, cssWidth: number): Promise<number> {
  return (await boxOf(element)).width / cssWidth
}

async function grab(page: Page, at: Point): Promise<Drag> {
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  return {
    moveBy: (dx, dy) => page.mouse.move(at.x + dx, at.y + dy, { steps: 8 }),
    drop: () => page.mouse.up(),
  }
}

async function grabHandle(page: Page, name: string): Promise<Drag> {
  const handle = page.locator(`[data-resize-handle="${name}"]`)
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  if (!box) throw new Error(`the ${name} handle is not rendered`)
  return grab(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
}

async function hover(page: Page, element: Locator): Promise<void> {
  const { x, y } = await centreOf(element)
  await page.mouse.move(x, y)
}

/** The studio mark sits at the hero's right edge, outside the canvas at zoom 1. */
async function fitBoard(page: Page): Promise<void> {
  await page.locator('[aria-label="Canvas"]').focus()
  await page.keyboard.press('Shift+Digit1')
}

function studioMark(page: Page): Locator {
  return canvasFrame(page).locator('img[alt="Studio mark"]')
}

async function selectInLayers(page: Page, element: Locator): Promise<void> {
  const row = layerRowOf(page, await edIdOf(element))
  await row.click()
  await expect(row).toHaveAttribute('aria-selected', 'true')
}

async function openCardBoard(page: Page): Promise<Locator> {
  await page.locator(`[data-board="${CARD_BOARD}"]`).click()
  await expect(canvasFrame(page).locator('h2')).toBeVisible()
  return canvasFrame(page).locator('article.card')
}

async function untilNextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/** Records the kinds of every `read` the editor posts to the probe over its MessagePort. */
async function recordProbeReads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sent: string[][] = []
    Object.assign(window, { probeReads: sent })
    const post = MessagePort.prototype.postMessage
    MessagePort.prototype.postMessage = function (this: MessagePort, message: unknown, ...rest: unknown[]) {
      const read = message as { type?: unknown; reads?: Array<{ kind: string }> }
      if (read?.type === 'read' && Array.isArray(read.reads)) sent.push(read.reads.map((entry) => entry.kind))
      return (post as (...args: unknown[]) => void).call(this, message, ...rest)
    }
  })
}

function probeReads(page: Page): Promise<string[][]> {
  return page.evaluate(() => (window as unknown as { probeReads: string[][] }).probeReads)
}

test.describe('M3: moving', () => {
  test('dragging an absolute element writes its top offset in px and nothing else', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await fitBoard(page)
    const mark = studioMark(page)
    await selectOnCanvas(page, mark)
    const zoom = await zoomOf(mark, MARK_CSS_WIDTH)

    const drag = await grab(page, await centreOf(mark))
    await drag.moveBy(0, 300 * zoom)
    await drag.drop()

    const expected = originalText(project, HOME_BOARD).replace(MARK_STYLE, markWithTop('324px'))
    await expect.poll(() => boardText(project, HOME_BOARD)).toBe(expected)
  })

  test('a 2 px press is a click, an arrow nudges 1 px and Shift-arrow 10 px', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await fitBoard(page)
    const mark = studioMark(page)
    await selectOnCanvas(page, mark)

    const press = await grab(page, await centreOf(mark))
    await press.moveBy(0, 2)
    await press.drop()
    await page.keyboard.press('ArrowDown')

    const original = originalText(project, HOME_BOARD)
    await expect.poll(() => boardText(project, HOME_BOARD)).toBe(original.replace(MARK_STYLE, markWithTop('25px')))

    await page.keyboard.press('Shift+ArrowDown')
    await expect.poll(() => boardText(project, HOME_BOARD)).toBe(original.replace(MARK_STYLE, markWithTop('35px')))
  })

  test('dragging a flex child past a sibling reorders it with an insertion line', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const brief = canvasFrame(page).locator('.col', { hasText: 'Brief' })
    const sketches = canvasFrame(page).locator('.col', { hasText: 'Sketches' })
    await selectOnCanvas(page, brief)
    const from = await centreOf(brief)
    const past = await boxOf(sketches)

    const drag = await grab(page, from)
    await drag.moveBy(past.x + past.width * 0.75 - from.x, 0)
    await expect(page.locator('[data-insertion-line]')).toBeVisible()
    await drag.drop()

    const original = originalText(project, HOME_BOARD)
    expect(original).toContain(BRIEF_LINE + SKETCHES_LINE)
    await expect.poll(() => boardText(project, HOME_BOARD)).toBe(original.replace(BRIEF_LINE + SKETCHES_LINE, SKETCHES_LINE + BRIEF_LINE))
    await expect(page.locator('[data-insertion-line]')).toHaveCount(0)
  })
})

test.describe('M3: snapping', () => {
  test("a drag ending 4 px from the parent's top edge snaps onto it and draws a guide", async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await fitBoard(page)
    const mark = studioMark(page)
    await selectOnCanvas(page, mark)
    const zoom = await zoomOf(mark, MARK_CSS_WIDTH)

    const drag = await grab(page, await centreOf(mark))
    await drag.moveBy(0, -20 * zoom)
    await expect(page.locator('[data-snap-guide]').first()).toBeVisible()
    await drag.drop()

    const expected = originalText(project, HOME_BOARD).replace(MARK_STYLE, markWithTop('0px'))
    await expect.poll(() => boardText(project, HOME_BOARD)).toBe(expected)
    await expect(page.locator('[data-snap-guide]')).toHaveCount(0)
  })

  test('holding Ctrl during the drag bypasses snapping', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await fitBoard(page)
    const mark = studioMark(page)
    await selectOnCanvas(page, mark)
    const zoom = await zoomOf(mark, MARK_CSS_WIDTH)

    const drag = await grab(page, await centreOf(mark))
    await page.keyboard.down('Control')
    await drag.moveBy(0, -20 * zoom)
    await expect(page.locator('[data-snap-guide]')).toHaveCount(0)
    await drag.drop()
    await page.keyboard.up('Control')

    const expected = originalText(project, HOME_BOARD).replace(MARK_STYLE, markWithTop('4px'))
    await expect.poll(() => boardText(project, HOME_BOARD)).toBe(expected)
  })

  test('the drag reads the sibling and parent rects once at its start and snaps without asking the probe per move', async ({ page, editor }) => {
    await recordProbeReads(page)
    await goOffline(page)
    await openEditor(page, editor)
    await fitBoard(page)
    const mark = studioMark(page)
    await selectOnCanvas(page, mark)
    const zoom = await zoomOf(mark, MARK_CSS_WIDTH)
    const before = (await probeReads(page)).length
    const snapshotsSinceGrab = async () => (await probeReads(page)).slice(before).flat().filter((kind) => kind === 'snapRects').length

    const drag = await grab(page, await centreOf(mark))
    await drag.moveBy(0, 8 * zoom)
    await expect.poll(snapshotsSinceGrab).toBe(1)
    await untilNextFrames(page)
    const readsOnceStarted = (await probeReads(page)).length
    for (const dy of [60, 120, 180, 240, 300]) await drag.moveBy(0, dy * zoom)
    await untilNextFrames(page)

    expect((await probeReads(page)).length).toBe(readsOnceStarted)
    await drag.drop()
    expect(await snapshotsSinceGrab()).toBe(1)
  })
})

test.describe('M3: resizing', () => {
  test('dragging the east handle writes the content-box width, with a live size label', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const card = await openCardBoard(page)
    await selectInLayers(page, card)
    const zoom = await zoomOf(card, CARD_BORDER_BOX)
    await hover(page, card)
    const handles = page.locator('[data-resize-handle]')
    await expect(handles).toHaveCount(8)

    const drag = await grabHandle(page, 'e')
    await drag.moveBy(-20 * zoom, 0)
    const label = page.locator('[data-size-label]')
    await expect(label).toHaveText(/\d+\s*[×x]\s*\d+/)
    const midway = (await label.textContent()) ?? ''
    await drag.moveBy(-40 * zoom, 0)
    await expect(label).not.toHaveText(midway)
    await expect(label).toHaveText(/\d+\s*[×x]\s*\d+/)
    await drag.drop()

    const expected = originalText(project, CARD_BOARD).replace('width: 328px', 'width: 288px')
    await expect.poll(() => boardText(project, CARD_BOARD)).toBe(expected)
  })

  test('a corner resize writing width and height is one undo entry', async ({ page, project, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const card = await openCardBoard(page)
    await selectInLayers(page, card)
    const zoom = await zoomOf(card, CARD_BORDER_BOX)
    await hover(page, card)

    const drag = await grabHandle(page, 'se')
    for (const step of [1, 2, 3]) {
      await drag.moveBy(-step * 10 * zoom, step * 10 * zoom)
      // Longer than the writer's 300 ms debounce, so a write per move would make several undo entries.
      await page.waitForTimeout(400)
    }
    await drag.drop()

    await expect.poll(() => boardText(project, CARD_BOARD)).toMatch(/style="background-color: #ffffff; width: 298px;[^"]*height: \d+(\.\d+)?px/)
    await page.keyboard.press(`${MOD}+KeyZ`)
    await expect.poll(() => project.read(CARD_BOARD).equals(project.fixture(CARD_BOARD))).toBe(true)
  })

  test('resizing a flex child that flex sizing shrinks shows a warning', async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const sketches = canvasFrame(page).locator('.col', { hasText: 'Sketches' })
    await selectOnCanvas(page, sketches)
    await hover(page, sketches)

    const drag = await grabHandle(page, 'e')
    await drag.moveBy(20, 0)
    await drag.drop()

    await expect(page.getByText(/flex sizing overrides/i).first()).toBeVisible()
  })

  test("the artboard root's handles are disabled and point to Claude Design", async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const rootRow = page.locator('[role="treeitem"]').first()
    await rootRow.click()
    await expect(rootRow).toHaveAttribute('aria-selected', 'true')
    await hover(page, canvasFrame(page).locator('h1'))

    const handles = page.locator('[data-resize-handle]')
    await expect(handles).toHaveCount(8)
    for (const handle of await handles.all()) {
      await expect(handle).toHaveAttribute('aria-disabled', 'true')
      await expect(handle).toHaveAttribute('title', /resize the frame in Claude Design/i)
    }
  })
})

test.describe('M3: Alt-measure', () => {
  test('Alt-hover draws red distance lines labelled margin to a sibling and padding to the parent', async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    const title = canvasFrame(page).locator('h1')
    await selectOnCanvas(page, title)
    const labels = page.locator('[data-measure-label]')

    await page.keyboard.down('Alt')
    await hover(page, canvasFrame(page).locator('header.hero p'))
    await expect(page.locator('[data-measure-line]').first()).toBeVisible()
    await expect(labels.filter({ hasText: /margin/i }).filter({ hasText: /\b16\b/ }).first()).toBeVisible()

    const hero = await boxOf(canvasFrame(page).locator('header.hero'))
    await page.mouse.move(hero.x + 10, hero.y + 10)
    await expect(labels.filter({ hasText: /padding/i }).filter({ hasText: /\b24\b/ }).first()).toBeVisible()
    await expect(labels.filter({ hasText: /padding/i }).filter({ hasText: /\b32\b/ }).first()).toBeVisible()
    await page.keyboard.up('Alt')

    await page.mouse.move(hero.x + 12, hero.y + 12)
    await expect(page.locator('[data-measure-line]')).toHaveCount(0)
  })

  test('Alt-hover between two flex children labels the distance as gap', async ({ page, editor }) => {
    await goOffline(page)
    await openEditor(page, editor)
    await selectOnCanvas(page, canvasFrame(page).locator('.col', { hasText: 'Brief' }))

    await page.keyboard.down('Alt')
    await hover(page, canvasFrame(page).locator('.col', { hasText: 'Sketches' }))

    await expect(page.locator('[data-measure-line]').first()).toBeVisible()
    await expect(page.locator('[data-measure-label]').filter({ hasText: /gap/i }).filter({ hasText: /\b16\b/ }).first()).toBeVisible()
    await page.keyboard.up('Alt')
  })
})
