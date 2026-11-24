import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { copyDir } from '../copy-dir'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test as base, expect, type FrameLocator, type Locator, type Page } from '@playwright/test'
import { HTTP_ROUTES, TOKEN_HEADER, type ServerInfo } from '../../src/shared/protocol'
import { cacheFixtureAssets } from '../pulled-fixture'

export { expect }

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const START_SCRIPT = path.join(REPO, 'scripts', 'start.mjs')
const CANVAS_FIXTURE = path.join(REPO, 'test', 'fixtures', 'canvas')
const MOCKUP = path.join(REPO, 'design', 'ui-options', 'b-warm-studio.html')
const LAUNCH_MS = 60_000
const SHUTDOWN_MS = 10_000

export const HOME_BOARD = 'project/home.dc.html'
/** The mockup's own frame: the editor is compared with it at this size. */
export const EDITOR_VIEWPORT = { width: 1440, height: 900 }
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

export type Theme = 'dark' | 'light'

export interface E2eProject {
  /** The pulled project folder; its path has spaces and non-ASCII characters. */
  readonly root: string
  read(file: string): Buffer
  fixture(file: string): Buffer
  /** `git diff HEAD` against the pulled baseline. */
  diff(): string
  status(): string
}

export interface RunningEditor {
  readonly url: string
  readonly port: number
  stop(): Promise<void>
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
}

/** The same shape `/design-pull` leaves: the canvas in its own repo, and `.editor/cache` filled by the real `edsync cache`. */
async function pullFixture(root: string): Promise<void> {
  copyDir(path.join(CANVAS_FIXTURE, 'project'), path.join(root, 'project'))
  await cacheFixtureAssets(root)
  git(root, 'init', '-q')
  const config: ReadonlyArray<readonly [string, string]> = [
    ['core.autocrlf', 'false'],
    ['core.safecrlf', 'false'],
    ['core.longpaths', 'true'],
    ['user.name', 'Design Editor e2e'],
    ['user.email', 'e2e@design-editor.invalid'],
    ['commit.gpgsign', 'false'],
  ]
  for (const [key, value] of config) git(root, 'config', key, value)
  mkdirSync(path.join(root, '.git', 'info'), { recursive: true })
  writeFileSync(path.join(root, '.git', 'info', 'attributes'), '* -text\n')
  writeFileSync(path.join(root, '.git', 'info', 'exclude'), '.editor/\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'pulled')
}

async function createProject(): Promise<{ project: E2eProject; remove(): void }> {
  const parent = mkdtempSync(path.join(tmpdir(), 'ed e2e '))
  const root = path.join(parent, 'Café board ü')
  await pullFixture(root)
  const project: E2eProject = {
    root,
    read: (file) => readFileSync(path.join(root, ...file.split('/'))),
    fixture: (file) => readFileSync(path.join(CANVAS_FIXTURE, ...file.split('/'))),
    diff: () => git(root, 'diff', '--no-color', '--no-ext-diff', 'HEAD'),
    status: () => git(root, 'status', '--porcelain'),
  }
  return { project, remove: () => rmSync(parent, { recursive: true, force: true }) }
}

async function isFree(port: number): Promise<boolean> {
  const server = net.createServer()
  const bound = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => resolve(true))
  })
  if (bound) await new Promise<void>((resolve) => server.close(() => resolve()))
  return bound
}

/** The project origin is always the editor port + 1, so both must be free. */
async function freePortPair(): Promise<number> {
  for (;;) {
    const port = 31_000 + 2 * Math.floor(Math.random() * 4_000)
    if ((await isFree(port)) && (await isFree(port + 1))) return port
  }
}

function requestStatus(port: number, route: string, token: string, method = 'GET'): Promise<number> {
  return new Promise((resolve) => {
    const outgoing = http.request({ host: '127.0.0.1', port, path: route, method, headers: { [TOKEN_HEADER]: token } }, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    outgoing.on('error', () => resolve(0))
    outgoing.end()
  })
}

function readServerJson(root: string): ServerInfo | null {
  const file = path.join(root, '.editor', 'server.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ServerInfo) : null
}

/** server.json is written once the session is open; /health answers 503 until then. */
async function untilReady(root: string, port: number, child: ChildProcess, output: () => string): Promise<string> {
  const deadline = Date.now() + LAUNCH_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the editor exited with ${child.exitCode}:\n${output()}`)
    const info = readServerJson(root)
    if (info?.port === port && (await requestStatus(port, HTTP_ROUTES.health, info.token)) === 200) return info.token
    await delay(200)
  }
  throw new Error(`the editor did not become ready on port ${port}:\n${output()}`)
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => child.once('exit', () => resolve()))
}

async function launchEditor(root: string): Promise<RunningEditor> {
  const port = await freePortPair()
  // stdin stays open: the editor treats its close as a shutdown.
  const child = spawn(process.execPath, [START_SCRIPT, '--project', root, '--port', String(port), '--dev'], {
    cwd: REPO,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const token = await untilReady(root, port, child, () => output)
  let stopped: Promise<void> | undefined
  const stop = () =>
    (stopped ??= (async () => {
      await requestStatus(port, HTTP_ROUTES.shutdown, token, 'POST')
      const gone = await Promise.race([exited(child).then(() => true), delay(SHUTDOWN_MS).then(() => false)])
      if (!gone) child.kill()
      await exited(child)
    })())
  return { url: `http://127.0.0.1:${port}`, port, stop }
}

export const test = base.extend<{ project: E2eProject; editor: RunningEditor }>({
  // Playwright reads a fixture's dependencies from its first argument, which must be an object pattern.
  // eslint-disable-next-line no-empty-pattern
  project: async ({}, use) => {
    const { project, remove } = await createProject()
    await use(project)
    remove()
  },
  editor: async ({ project }, use) => {
    const editor = await launchEditor(project.root)
    await use(editor)
    await editor.stop()
  },
})

/** Google Fonts is the canvas's one outside request; failing it is what an offline session sees. */
export async function goOffline(page: Page): Promise<void> {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort('internetdisconnected'))
}

export function canvasFrame(page: Page): FrameLocator {
  return page.frameLocator('[aria-label="Canvas"] iframe')
}

export async function openEditor(page: Page, editor: RunningEditor, theme: Theme = 'dark'): Promise<void> {
  await page.goto(`${editor.url}/${theme === 'light' ? '#light' : ''}`)
  await expect(canvasFrame(page).locator('h1')).toBeVisible()
  await expect(page.locator('[role="treeitem"]').first()).toBeVisible()
}

export async function openMockup(page: Page, theme: Theme): Promise<void> {
  await page.goto(`${pathToFileURL(MOCKUP).href}${theme === 'light' ? '#light' : ''}`)
}

/** Every custom property the mockup declares on `:root`, with `html.light` overriding a subset. */
export function mockupTokenNames(): string[] {
  const html = readFileSync(MOCKUP, 'utf8')
  const rootBlock = /:root\{([\s\S]*?)\}/.exec(html)?.[1] ?? ''
  return [...rootBlock.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]!)
}

export function tokenValues(page: Page, names: readonly string[]): Promise<Record<string, string>> {
  return page.evaluate((tokenNames) => {
    const computed = getComputedStyle(document.documentElement)
    return Object.fromEntries(tokenNames.map((name) => [name, computed.getPropertyValue(name).trim()]))
  }, names)
}

export function computedStyleOf(element: Locator, props: readonly string[]): Promise<Record<string, string>> {
  return element.evaluate((node, names) => {
    const computed = getComputedStyle(node)
    return Object.fromEntries(names.map((name) => [name, computed.getPropertyValue(name)]))
  }, props)
}

/**
 * An editor element's box once two reads in a row agree. A selection handle can be rendered again between
 * a check that it is there and a second read, so the read that settles is the one that is returned.
 */
export async function settledBoxOf(element: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  let last: { x: number; y: number; width: number; height: number } | null = null
  await expect
    .poll(async () => {
      const box = await element.boundingBox()
      const settled = box !== null && JSON.stringify(box) === JSON.stringify(last)
      last = box
      return settled
    })
    .toBe(true)
  return last!
}

/**
 * The on-page box of an element inside the artboard frame. Edge's `boundingBox()` leaves out the
 * frame's zoom transform, so the box is built from the frame's own box and the element's rect in it.
 */
export async function screenBoxOf(element: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const frame = element.page().locator('[aria-label="Canvas"] iframe')
  const frameBox = await frame.boundingBox()
  const cssWidth = await frame.evaluate((node: HTMLIFrameElement) => node.offsetWidth)
  const rect = await element.evaluate((node) => {
    const { x, y, width, height } = node.getBoundingClientRect()
    return { x, y, width, height }
  })
  if (!frameBox || cssWidth === 0 || (rect.width === 0 && rect.height === 0)) throw new Error('the element is not rendered on the canvas')
  const scale = frameBox.width / cssWidth
  return { x: frameBox.x + rect.x * scale, y: frameBox.y + rect.y * scale, width: rect.width * scale, height: rect.height * scale }
}

async function pointOn(element: Locator): Promise<{ x: number; y: number }> {
  const box = await screenBoxOf(element)
  return { x: box.x + Math.min(box.width / 2, 24), y: box.y + box.height / 2 }
}

/** Clicks through the event shield onto an element inside the artboard frame. */
export async function clickOnCanvas(page: Page, element: Locator, modifiers: readonly string[] = []): Promise<void> {
  const { x, y } = await pointOn(element)
  for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.click(x, y)
  for (const key of modifiers) await page.keyboard.up(key)
}

export async function doubleClickOnCanvas(page: Page, element: Locator): Promise<void> {
  const { x, y } = await pointOn(element)
  await page.mouse.dblclick(x, y)
}

export function layerRowOf(page: Page, edId: string): Locator {
  return page.locator(`[role="treeitem"][data-layer-id="${edId}"]`)
}

export async function edIdOf(element: Locator): Promise<string> {
  const edId = await element.getAttribute('data-ed-id')
  if (!edId) throw new Error('the served element carries no data-ed-id')
  return edId
}

/** Mod-click selects the deepest element under the pointer; retried until the probe has shaken hands. */
export async function selectOnCanvas(page: Page, element: Locator): Promise<string> {
  const edId = await edIdOf(element)
  await expect(async () => {
    await clickOnCanvas(page, element, [MOD])
    await expect(layerRowOf(page, edId)).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 })
  }).toPass()
  return edId
}
