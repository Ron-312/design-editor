import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { EDITOR_VIEWPORT, canvasFrame, expect, goOffline, HOME_BOARD, openEditor, selectOnCanvas, test, type E2eProject } from './harness'

const LINK = 'https://claude.ai/artifact/Throwaway1'

function editorFile(project: E2eProject, name: string, value: unknown): void {
  mkdirSync(path.join(project.root, '.editor'), { recursive: true })
  writeFileSync(path.join(project.root, '.editor', name), JSON.stringify(value))
}

/** What `/design-pull` also leaves: the hashes a push compares against. */
function keepBase(project: E2eProject): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project.root, encoding: 'utf8' }).trim()
  const files = git('ls-tree', '-r', 'HEAD').split('\n').map((line) => [line.split('\t')[1]!, line.split(/\s/)[2]!])
  editorFile(project, 'base.json', { commit: git('rev-parse', 'HEAD'), files: Object.fromEntries(files) })
}

test.use({ viewport: EDITOR_VIEWPORT })

test.describe('the Push button', () => {
  test('asks once for the canvas link, then sends the edit to it and clears the count', async ({ page, editor, claude, project }) => {
    keepBase(project)
    await goOffline(page)
    await openEditor(page, editor)
    await selectOnCanvas(page, canvasFrame(page).locator('h1'))
    await page.keyboard.press('Delete')
    const push = page.locator('header').getByRole('button', { name: /^Push/ })
    await expect(push.locator('.cnt')).toHaveText('1')

    await push.click()
    const dialog = page.getByRole('dialog', { name: 'Push' })
    await dialog.getByLabel('Canvas link').fill(LINK)
    await dialog.getByRole('button', { name: 'Push' }).click()

    await expect(dialog).toContainText('Pushed to Throwaway', { timeout: 20_000 })
    await expect(dialog).toContainText('home.dc.html')
    await expect(push.locator('.cnt')).toBeHidden()
    expect(readFileSync(path.join(claude.remote, ...HOME_BOARD.split('/'))).equals(project.read(HOME_BOARD))).toBe(true)
    expect(project.status()).toBe('')
    expect(claude.publishes()).toHaveLength(1)

    await page.keyboard.press('Escape')
    await push.click()
    await expect(dialog).toContainText('already has everything here', { timeout: 20_000 })
    expect(claude.publishes()).toHaveLength(1)
  })

  test('pauses editing while it runs, and Cancel resumes it with nothing sent', async ({ page, editor, claude, project }) => {
    keepBase(project)
    claude.behave({ hang: true })
    await goOffline(page)
    await openEditor(page, editor)
    const push = page.locator('header').getByRole('button', { name: /^Push/ })

    await push.click()
    const dialog = page.getByRole('dialog', { name: 'Push' })
    await dialog.getByLabel('Canvas link').fill(LINK)
    await dialog.getByRole('button', { name: 'Push' }).click()
    await expect(page.getByText('editing is paused')).toBeVisible({ timeout: 20_000 })
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(dialog).toContainText('Push cancelled')
    await expect(page.getByText('editing is paused')).toBeHidden()
    expect(claude.publishes()).toHaveLength(0)
  })

  test('says how to sign in when Claude Code is signed out', async ({ page, editor, claude, project }) => {
    keepBase(project)
    claude.behave({ signedOut: true })
    await goOffline(page)
    await openEditor(page, editor)

    await page.locator('header').getByRole('button', { name: /^Push/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Push' })
    await dialog.getByLabel('Canvas link').fill(LINK)
    await dialog.getByRole('button', { name: 'Push' }).click()

    await expect(dialog).toContainText('claude auth login')
    expect(claude.wasStarted()).toBe(false)
  })
})
