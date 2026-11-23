import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { startEditor, type Editor } from '../server/main'
import { DEFAULT_EDITOR_PORT, LOOPBACK_HOST } from '../shared/protocol'
import { findFreePortPair } from './ports'
import { isPulledCanvas, readRecent, withRecent, writeRecent } from './recent'

const APP_DIR = app.getAppPath()
const RECENT_FILE = path.join(app.getPath('userData'), 'recent.json')
/** Above the terminal editor's 5300, so both can run side by side. */
const FIRST_PORT = DEFAULT_EDITOR_PORT + 10
const NOT_A_CANVAS =
  'This folder is not a pulled Claude Design canvas. In Claude Code, run /design-pull <canvas link> first, then open the folder it made under projects/.'

let editor: Editor | undefined
let window: BrowserWindow | undefined
let recent: string[] = []
let probeScript: Promise<string> | undefined

function editorOrigin(): string | undefined {
  return editor && `http://${LOOPBACK_HOST}:${editor.address().port}`
}

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1b1714',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  created.once('ready-to-show', () => created.show())
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  created.webContents.on('will-navigate', (event, url) => {
    const origin = editorOrigin()
    if (!origin || new URL(url).origin !== origin) event.preventDefault()
  })
  created.on('page-title-updated', (event) => event.preventDefault())
  created.on('closed', () => (window = undefined))
  return created
}

async function stopEditor(): Promise<void> {
  const running = editor
  editor = undefined
  await running?.close()
}

async function openProject(dir: string): Promise<void> {
  if (!isPulledCanvas(dir)) {
    await dialog.showMessageBox({ type: 'warning', message: 'Not a canvas folder', detail: NOT_A_CANVAS })
    return
  }
  try {
    await stopEditor()
    editor = await startEditor({
      projectDir: dir,
      port: await findFreePortPair(FIRST_PORT),
      dev: false,
      uiDir: path.join(APP_DIR, 'ui'),
      probeScript: await (probeScript ??= readFile(path.join(APP_DIR, 'probe.js'), 'utf8')),
    })
  } catch (error) {
    console.error(error)
    dialog.showErrorBox('Could not open the canvas', error instanceof Error ? error.message : String(error))
    return
  }
  recent = withRecent(recent, dir)
  await writeRecent(RECENT_FILE, recent).catch(() => undefined)
  window ??= createWindow()
  window.setTitle(`Design Editor — ${path.basename(dir)}`)
  await window.loadURL(`${editorOrigin()}/`)
  buildMenu()
}

async function chooseProject(): Promise<void> {
  const picked = await dialog.showOpenDialog({
    title: 'Open a pulled canvas folder',
    buttonLabel: 'Open',
    properties: ['openDirectory'],
    ...(recent[0] ? { defaultPath: path.dirname(recent[0]) } : {}),
  })
  if (!picked.canceled && picked.filePaths[0]) await openProject(picked.filePaths[0])
}

/** No Undo/Redo roles: Mod-Z must reach the editor, whose undo writes the canvas files. */
function buildMenu(): void {
  const openRecent: MenuItemConstructorOptions[] = recent.length
    ? recent.map((dir) => ({ label: dir, click: () => void openProject(dir) }))
    : [{ label: 'None yet', enabled: false }]
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Canvas Folder…', accelerator: 'CmdOrCtrl+O', click: () => void chooseProject() },
        { label: 'Open Recent', submenu: openRecent },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function start(): Promise<void> {
  recent = await readRecent(RECENT_FILE)
  buildMenu()
  const named = process.argv.slice(1).find((arg) => !arg.startsWith('-') && isPulledCanvas(path.resolve(arg)))
  const last = named ? path.resolve(named) : recent.find(isPulledCanvas)
  if (last) await openProject(last)
  else await chooseProject()
  if (!window) app.quit()
}

app.on('window-all-closed', () => {
  void stopEditor().then(() => app.quit())
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !editor) return
  event.preventDefault()
  quitting = true
  void stopEditor().finally(() => app.quit())
})

app.on('activate', () => {
  if (!window && editor) {
    window = createWindow()
    void window.loadURL(`${editorOrigin()}/`)
  }
})

void app.whenReady().then(start).catch((error: unknown) => {
  console.error(error)
  dialog.showErrorBox('Design Editor could not start', error instanceof Error ? error.message : String(error))
  app.quit()
})
