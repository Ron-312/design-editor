import { _electron as electron } from 'playwright'

const [executablePath, project] = process.argv.slice(2)
if (!executablePath || !project) throw new Error('usage: node scripts/electron-suite.mjs <app executable> <pulled canvas folder>')

/**
 * Runs an Edit menu item the way its accelerator does, so the packaged menu itself is under test.
 * On macOS a role item goes through the key window, which a window launched behind the test runner
 * never is, so a role is run as the webContents call Electron makes for it on Windows.
 */
async function clickEditMenu(app, label) {
  await app.evaluate(({ BrowserWindow, Menu }, wanted) => {
    const edit = Menu.getApplicationMenu().items.find((item) => item.label === 'Edit')
    const item = edit.submenu.items.find((entry) => entry.label === wanted)
    if (!item) throw new Error(`the Edit menu has no ${wanted} item`)
    const [window] = BrowserWindow.getAllWindows()
    if (['cut', 'copy', 'paste'].includes(item.role)) window.webContents[item.role]()
    else item.click(undefined, window, window.webContents)
  }, label)
}

function check(passed, failure) {
  if (!passed) throw new Error(failure)
}

async function waitUntil(condition, failure) {
  const deadline = Date.now() + 15_000
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(failure)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function selectedLayers(window) {
  return window.locator('[role="treeitem"][aria-selected="true"]').evaluateAll((rows) => rows.map((row) => row.getAttribute('aria-label')))
}

async function selectAllOnCanvasSelectsLayers(app, window) {
  await window.locator('[role="treeitem"][aria-label="h1"]').click()
  await window.locator('[data-canvas-viewport]').focus()
  await clickEditMenu(app, 'Select All')
  await waitUntil(async () => (await selectedLayers(window)).length > 1, 'Select All on the canvas selected no more layers')
  const selected = await selectedLayers(window)
  check(['h1', 'p', 'img'].every((label) => selected.includes(label)), `Select All on the canvas selected ${selected.join(', ')}, not the hero's layers`)
}

async function selectAllInFieldSelectsText(app, window) {
  await window.locator('[role="treeitem"][aria-label="h1"]').click()
  const search = window.locator('input[aria-label="Find layer"]')
  await search.fill('h1')
  await search.evaluate((input) => input.setSelectionRange(1, 1))
  await clickEditMenu(app, 'Select All')
  await waitUntil(
    () => search.evaluate((input) => input.selectionStart === 0 && input.selectionEnd === input.value.length),
    'Select All in a field did not select its text',
  )
  const selected = await selectedLayers(window)
  check(selected.length === 1 && selected[0] === 'h1', `Select All in a field changed the layer selection to ${selected.join(', ')}`)
  await search.fill('')
}

async function copyThenPasteOnCanvasPastes(app, window) {
  const headings = window.locator('[role="treeitem"][aria-label="h1"]')
  await headings.first().click()
  await window.locator('[data-canvas-viewport]').focus()
  await clickEditMenu(app, 'Copy')
  await clickEditMenu(app, 'Paste')
  await headings.nth(1).waitFor({ timeout: 15_000 })
}

const app = await electron.launch({ executablePath, args: [project] })
try {
  const window = await app.firstWindow()
  await window.frameLocator('[aria-label="Canvas"] iframe').locator('h1').waitFor({ timeout: 30_000 })
  await selectAllOnCanvasSelectsLayers(app, window)
  await selectAllInFieldSelectsText(app, window)
  await copyThenPasteOnCanvasPastes(app, window)
  console.log(`the packaged app's Edit menu selected layers, selected field text, and pasted a copied layer in ${project}`)
} finally {
  await app.close()
}
