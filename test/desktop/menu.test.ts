import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { BaseWindow, KeyboardEvent as MenuKeyboardEvent, MenuItem, MenuItemConstructorOptions } from 'electron'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { menuTemplate } from '../../src/desktop/menu'

const SELECT_ALL_EVENT = 'editor:select-all'
const ROOT = path.resolve(import.meta.dirname, '../..')

type Platform = 'darwin' | 'win32'

function templateFor(platform: Platform, recent: readonly string[] = []) {
  const openProject = vi.fn<(dir: string) => void>()
  const chooseProject = vi.fn<() => void>()
  const template = menuTemplate({ platform, recent, openProject, chooseProject })
  return { template, openProject, chooseProject }
}

function submenuOf(item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] {
  return Array.isArray(item?.submenu) ? item.submenu : []
}

function everyItem(items: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [item, ...everyItem(submenuOf(item))])
}

function menuNamed(template: readonly MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  return submenuOf(template.find((item) => item.label === label))
}

function selectAllItem(template: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions {
  const item = menuNamed(template, 'Edit').find((entry) => entry.accelerator === 'CmdOrCtrl+A')
  if (!item) throw new Error('the Edit menu has no CmdOrCtrl+A item')
  return item
}

const rolesOf = (items: readonly MenuItemConstructorOptions[]) => everyItem(items).flatMap((item) => (item.role ? [item.role.toLowerCase()] : []))

/** The renderer the script runs in: a real DOM window, with the editor's listener when it has one. */
function rendererWindow(editorCancels: boolean | 'no listener') {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' })
  const seen: Event[] = []
  if (editorCancels !== 'no listener') {
    dom.window.addEventListener(SELECT_ALL_EVENT, (event) => {
      seen.push(event)
      if (editorCancels) event.preventDefault()
    })
  }
  const webContents = {
    executeJavaScript: vi.fn(async (code: string) => dom.window.eval(code) as unknown),
    selectAll: vi.fn(),
  }
  return { dom, seen, webContents }
}

async function clickSelectAll(template: readonly MenuItemConstructorOptions[], window: BaseWindow | undefined) {
  selectAllItem(template).click!({} as MenuItem, window, {} as MenuKeyboardEvent)
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const windowWith = (webContents: object) => ({ webContents }) as unknown as BaseWindow

describe('the Edit menu', () => {
  it.each(['darwin', 'win32'] as const)('has a Select All item on CmdOrCtrl+A and no selectAll role on %s', (platform) => {
    const { template } = templateFor(platform)

    const item = selectAllItem(template)

    expect(item.label).toBe('Select All')
    expect(item.role).toBeUndefined()
    expect(typeof item.click).toBe('function')
    expect(rolesOf(template)).not.toContain('selectall')
  })

  it.each(['darwin', 'win32'] as const)('keeps cut, copy and paste as roles and leaves out Undo and Redo on %s', (platform) => {
    const { template } = templateFor(platform)

    const roles = rolesOf(template)

    expect(rolesOf(menuNamed(template, 'Edit'))).toEqual(expect.arrayContaining(['cut', 'copy', 'paste']))
    expect(roles).not.toContain('undo')
    expect(roles).not.toContain('redo')
  })
})

describe('Select All', () => {
  it('lets the editor take it: a cancelled event does not run the native select-all', async () => {
    const { template } = templateFor('darwin')
    const renderer = rendererWindow(true)

    await clickSelectAll(template, windowWith(renderer.webContents))

    expect(renderer.webContents.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(renderer.seen).toHaveLength(1)
    expect(renderer.webContents.selectAll).not.toHaveBeenCalled()
  })

  it('runs the native select-all in the focused frame when the editor leaves the event alone', async () => {
    const { template } = templateFor('win32')
    const renderer = rendererWindow(false)

    await clickSelectAll(template, windowWith(renderer.webContents))

    expect(renderer.seen).toHaveLength(1)
    expect(renderer.webContents.selectAll).toHaveBeenCalledTimes(1)
  })

  it('runs the native select-all when nothing in the page listens', async () => {
    const { template } = templateFor('darwin')
    const renderer = rendererWindow('no listener')

    await clickSelectAll(template, windowWith(renderer.webContents))

    expect(renderer.webContents.selectAll).toHaveBeenCalledTimes(1)
  })

  it('dispatches one cancelable editor:select-all event on window', async () => {
    const { template } = templateFor('darwin')
    const renderer = rendererWindow(true)

    await clickSelectAll(template, windowWith(renderer.webContents))

    const [event] = renderer.seen
    expect(event?.type).toBe(SELECT_ALL_EVENT)
    expect(event?.cancelable).toBe(true)
    expect(event?.target).toBe(renderer.dom.window)
  })

  it('sends the same fixed script whatever the menu holds, carrying no data', async () => {
    const recentDir = '/Users/someone/canvases/secret-launch'
    const scripts: string[] = []
    for (const [platform, recent] of [
      ['darwin', []],
      ['win32', [recentDir, 'C:\\canvases\\other']],
    ] as const) {
      const renderer = rendererWindow(true)
      await clickSelectAll(templateFor(platform, recent).template, windowWith(renderer.webContents))
      scripts.push(...renderer.webContents.executeJavaScript.mock.calls.map(([code]) => code))
    }

    expect(scripts).toHaveLength(2)
    expect(new Set(scripts).size).toBe(1)
    expect(scripts[0]).not.toContain('secret-launch')
  })

  it('does nothing without a focused window', async () => {
    const { template } = templateFor('darwin')

    await expect(clickSelectAll(template, undefined)).resolves.toBeUndefined()
  })
})

describe('the File menu', () => {
  it('opens a canvas folder on CmdOrCtrl+O', () => {
    const { template, chooseProject } = templateFor('darwin')

    const open = menuNamed(template, 'File').find((item) => item.accelerator === 'CmdOrCtrl+O')
    open?.click?.({} as MenuItem, undefined, {} as MenuKeyboardEvent)

    expect(chooseProject).toHaveBeenCalledTimes(1)
  })

  it('lists recent folders, each opening its folder', () => {
    const { template, openProject } = templateFor('win32', ['/one', '/two'])

    const recent = submenuOf(menuNamed(template, 'File').find((item) => item.label === 'Open Recent'))
    recent[1]?.click?.({} as MenuItem, undefined, {} as MenuKeyboardEvent)

    expect(recent.map((item) => item.label)).toEqual(['/one', '/two'])
    expect(openProject).toHaveBeenCalledWith('/two')
  })

  it('shows a disabled placeholder when nothing was opened yet', () => {
    const { template } = templateFor('darwin')

    const recent = submenuOf(menuNamed(template, 'File').find((item) => item.label === 'Open Recent'))

    expect(recent).toEqual([expect.objectContaining({ enabled: false })])
  })
})

describe('the main process', () => {
  const main = readFileSync(path.join(ROOT, 'src/desktop/main.ts'), 'utf8')

  it('builds its menu from menu.ts', () => {
    expect(main).toMatch(/from '\.\/menu'/)
    expect(main).not.toMatch(/role: 'selectAll'/)
  })

  it('keeps the window sandboxed with no preload', () => {
    expect(main).toMatch(/sandbox: true/)
    expect(main).not.toMatch(/preload/)
  })
})

describe('the packaged-app suite', () => {
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/installers.yml'), 'utf8')

  function stepRunning(script: string): string {
    const step = workflow.split(/\n(?=\s+- )/).find((chunk) => chunk.includes(`node ${script}`))
    if (!step) throw new Error(`installers.yml runs no ${script}`)
    return step
  }

  it('drives the packaged app through its application menu', () => {
    const suite = readFileSync(path.join(ROOT, 'scripts/electron-suite.mjs'), 'utf8')

    expect(suite).toMatch(/_electron/)
    expect(suite).toMatch(/\.evaluate\(/)
    expect(suite).toMatch(/Menu\.getApplicationMenu\(\)/)
  })

  it('runs in the installers workflow on every OS of the matrix, and a change to it triggers the workflow', () => {
    const step = stepRunning('scripts/electron-suite.mjs')

    expect(step).toMatch(/node scripts\/electron-suite\.mjs "\$\{\{ matrix\.exe \}\}"/)
    expect(step).not.toMatch(/^\s+if:/m)
    expect(workflow).toMatch(/os: windows-latest/)
    expect(workflow).toMatch(/os: macos-latest/)
    expect(workflow).toMatch(/- 'scripts\/electron-suite\.mjs'/)
  })
})
