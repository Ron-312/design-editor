import { _electron as electron } from 'playwright'

const [executablePath, project, shot] = process.argv.slice(2)
if (!executablePath || !project) throw new Error('usage: node scripts/smoke-app.mjs <app executable> <pulled canvas folder> [screenshot.png]')

const app = await electron.launch({ executablePath, args: [project] })
try {
  const window = await app.firstWindow()
  await window.frameLocator('[aria-label="Canvas"] iframe').locator('h1').waitFor({ timeout: 30_000 })
  const row = window.locator('[role="treeitem"][aria-label="h1"]')
  await row.click()
  if ((await row.getAttribute('aria-selected')) !== 'true') throw new Error('selecting a layer in the packaged app did nothing')
  if (shot) await window.screenshot({ path: shot })
  console.log(`the packaged app opened ${project} as "${await window.title()}" and selected a layer`)
} finally {
  await app.close()
}
