import type { BaseWindow, BrowserWindow, MenuItemConstructorOptions } from 'electron'

/** Fixed and data-free: the renderer's editor cancels the event when it takes the select-all. */
const DISPATCH_SELECT_ALL = `window.dispatchEvent(new Event('editor:select-all', { cancelable: true }))`

export interface MenuOptions {
  readonly platform: NodeJS.Platform
  readonly recent: readonly string[]
  readonly openProject: (dir: string) => void
  readonly chooseProject: () => void
}

/** A selectAll role would ignore `click`, so the editor could never take Mod-A from the menu accelerator. */
async function selectAll(window: BaseWindow | undefined): Promise<void> {
  const webContents = (window as BrowserWindow | undefined)?.webContents
  if (!webContents) return
  const notCancelled: unknown = await webContents.executeJavaScript(DISPATCH_SELECT_ALL)
  if (notCancelled) webContents.selectAll()
}

/** No Undo/Redo roles: Mod-Z must reach the editor, whose undo writes the canvas files. */
export function menuTemplate({ platform, recent, openProject, chooseProject }: MenuOptions): MenuItemConstructorOptions[] {
  const openRecent: MenuItemConstructorOptions[] = recent.length
    ? recent.map((dir) => ({ label: dir, click: () => openProject(dir) }))
    : [{ label: 'None yet', enabled: false }]
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Canvas Folder…', accelerator: 'CmdOrCtrl+O', click: () => chooseProject() },
        { label: 'Open Recent', submenu: openRecent },
        { type: 'separator' },
        platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: (_item, window) => void selectAll(window) },
      ],
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]
}
