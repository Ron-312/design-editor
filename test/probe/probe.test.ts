import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM, requestInterceptor, VirtualConsole, type DOMWindow } from 'jsdom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildProbeBundle } from '../../src/probe/bundle'
import { transformServedDocument } from '../../src/server/serve/serve-transform'
import { SourceIndex, type IndexedFile } from '../../src/server/source/source-index'
import { PROBE_HANDSHAKE, type EditorToProbe, type ProbeReadResult, type ProbeToEditor, type Rect } from '../../src/shared/protocol'
import type { EdId, ProjectPath } from '../../src/shared/types'

type FontStatus = 'unloaded' | 'loading' | 'loaded' | 'error'

interface PageOptions {
  readonly googleFonts?: 'online' | 'offline'
  readonly fontFaces?: ReadonlyArray<{ readonly family: string; readonly status: FontStatus }>
  readonly textBoxSupported?: boolean
  readonly projectHeadScript?: string
  readonly hide?: (indexed: IndexedFile) => EdId[]
}

interface EditorEnd {
  readonly received: ProbeToEditor[]
  send(message: EditorToProbe): void
}

interface FakePort extends EventTarget {
  postMessage(data: unknown): void
}

interface Page {
  readonly window: DOMWindow
  readonly indexed: IndexedFile
  readonly parentWindow: DOMWindow
  readonly windowPosts: unknown[][]
  readonly pageErrors: string[]
  readonly fontsCheck: ReturnType<typeof vi.fn>
  readonly measurements: { inFrame: boolean }[]
  handshake(source: unknown): EditorEnd
  runFrame(): void
  setRect(element: Element, rect: Rect): void
  rendered(id: EdId): HTMLElement[]
  computed(element: Element): CSSStyleDeclaration
  global<T>(name: string): T
}

const CANVAS = fileURLToPath(new URL('../fixtures/canvas/', import.meta.url))
const PROJECT = path.join(CANVAS, 'project')
const FETCHED = path.join(CANVAS, 'fetched')
const HOME = 'project/home.dc.html' as ProjectPath
const CARD = 'project/card.dc.html' as ProjectPath
const PROJECT_ORIGIN = 'http://127.0.0.1:5301'
const PREFIX = '/project/0123456789abcdef0123456789abcdef/'
const PAGE_URL = `${PROJECT_ORIGIN}${PREFIX}home.dc.html`
const EDITOR_URL = 'http://127.0.0.1:5300/'
const TEXT_BOX = '(text-box: trim-both cap alphabetic)'
const GOOGLE_FONTS_CSS = '@font-face { font-family: Inter; src: local(Inter); }'
const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.html': 'text/html',
}
const QUIET_MS = 60
const WAIT = { timeout: 2_000, interval: 10 }

let probeBundle: string
const openPages: Page[] = []

function readText(file: string): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(readFileSync(file))
}

function idOfTag(indexed: IndexedFile, tag: string, nth = 0): EdId {
  const ids = indexed.ids.filter((id) => {
    const range = indexed.locate(id)!.startTag
    return /^<([^\s/>]+)/.exec(indexed.text.slice(range.start, range.end))?.[1]?.toLowerCase() === tag
  })
  const id = ids[nth]
  if (!id) throw new Error(`no <${tag}> #${nth}`)
  return id
}

function withProjectScript(text: string, script: string | undefined): string {
  if (!script) return text
  const support = '<script src="./support.js"></script>\n'
  return text.replace(support, `${support}<script>${script}</script>\n`)
}

async function ticks(count = 3): Promise<void> {
  for (let i = 0; i < count; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function loaded(window: DOMWindow): Promise<void> {
  if (window.document.readyState === 'complete') return Promise.resolve()
  return new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }))
}

function quiet(window: DOMWindow): Promise<void> {
  return new Promise((resolve) => {
    const observer = new window.MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(done, QUIET_MS)
    })
    let timer = setTimeout(done, QUIET_MS)
    function done() {
      observer.disconnect()
      resolve()
    }
    observer.observe(window.document, { subtree: true, childList: true, attributes: true, characterData: true })
  })
}

function blobFile(id: string): string | null {
  const name = readdirSync(FETCHED).find((file) => file.startsWith(`${id}.`))
  return name ? path.join(FETCHED, name) : null
}

function contains(rect: Rect | undefined, x: number, y: number): boolean {
  return !!rect && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

function normalizedCondition(condition: string): string {
  return condition.trim().replace(/^\((.*)\)$/, '$1').replace(/\s*:\s*/, ':').replace(/\s+/g, ' ').trim()
}

/** jsdom has no MessageChannel; these ports live in the page's realm so its native EventTarget methods apply to them. */
function installMessaging(window: DOMWindow, pageErrors: string[]) {
  const dispatch = window.EventTarget.prototype.dispatchEvent
  const listen = window.EventTarget.prototype.addEventListener

  class FakeMessagePort extends window.EventTarget {
    partner: FakeMessagePort | null = null
    closed = false
    handler: ((event: MessageEvent) => void) | null = null

    get onmessage() {
      return this.handler
    }

    set onmessage(handler: ((event: MessageEvent) => void) | null) {
      this.handler = handler
    }

    postMessage(data: unknown): void {
      const target = this.partner
      if (this.closed || !target) return
      const copy = structuredClone(data)
      setTimeout(() => target.deliver(copy), 0)
    }

    deliver(data: unknown): void {
      if (this.closed) return
      const event = new window.MessageEvent('message', { data })
      try {
        dispatch.call(this, event)
        this.handler?.call(this, event)
      } catch (error) {
        pageErrors.push(String(error))
      }
    }

    start(): void {}

    close(): void {
      this.closed = true
    }
  }

  class FakeMessageChannel {
    readonly port1 = new FakeMessagePort()
    readonly port2 = new FakeMessagePort()

    constructor() {
      this.port1.partner = this.port2
      this.port2.partner = this.port1
    }
  }

  Object.assign(window, { MessagePort: FakeMessagePort, MessageChannel: FakeMessageChannel })
  const post = FakeMessagePort.prototype.postMessage
  return {
    channel: () => new FakeMessageChannel(),
    post: (port: FakePort, data: unknown) => post.call(port, data),
    listen: (port: FakePort, onMessage: (data: ProbeToEditor) => void) =>
      listen.call(port, 'message', (event: Event) => onMessage((event as MessageEvent<ProbeToEditor>).data)),
  }
}

function fontFaceSet(window: DOMWindow, faces: NonNullable<PageOptions['fontFaces']>, check: ReturnType<typeof vi.fn>) {
  const set = new window.EventTarget() as EventTarget & Record<string | symbol, unknown>
  Object.assign(set, {
    status: 'loaded',
    size: faces.length,
    check,
    ready: Promise.resolve(set),
    forEach: (callback: (face: unknown, key: unknown, set: unknown) => void) => faces.forEach((face) => callback(face, face, set)),
    values: () => faces.values(),
    keys: () => faces.values(),
    entries: () => faces.map((face) => [face, face]).values(),
    has: (face: unknown) => faces.includes(face as never),
    [Symbol.iterator]: () => faces.values(),
  })
  return set
}

async function openPage(options: PageOptions = {}): Promise<Page> {
  const sourceIndex = new SourceIndex()
  const indexed = sourceIndex.indexFile(HOME, withProjectScript(readText(path.join(PROJECT, 'home.dc.html')), options.projectHeadScript))
  const card = sourceIndex.indexFile(CARD, readText(path.join(PROJECT, 'card.dc.html')))
  const hidden = options.hide?.(indexed) ?? []
  const html = transformServedDocument(indexed, { probeScript: probeBundle, hidden, locked: [] }).html
  const cardHtml = transformServedDocument(card, { probeScript: probeBundle, hidden: [], locked: [] }).html

  const respond = (url: URL): Response => {
    if (url.hostname === 'fonts.googleapis.com') {
      if (options.googleFonts === 'offline') return new Response(null, { status: 404 })
      return new Response(GOOGLE_FONTS_CSS, { headers: { 'content-type': 'text/css' } })
    }
    if (url.origin !== PROJECT_ORIGIN) return new Response(null, { status: 404 })
    const blob = /^\/_blob\/([0-9a-f]{32})$/.exec(url.pathname)
    const file = blob ? blobFile(blob[1]!) : url.pathname === `${PREFIX}support.js` ? path.join(FETCHED, 'support.js') : null
    if (url.pathname === `${PREFIX}card.dc.html`) return new Response(cardHtml, { headers: { 'content-type': 'text/html' } })
    if (!file) return new Response(null, { status: 404 })
    return new Response(readFileSync(file), { headers: { 'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' } })
  }

  const parentWindow = new JSDOM('', { url: EDITOR_URL }).window
  const windowPosts: unknown[][] = []
  const pageErrors: string[] = []
  const measurements: { inFrame: boolean }[] = []
  const rects = new WeakMap<Element, Rect>()
  const frames = new Map<number, FrameRequestCallback>()
  const fontsCheck = vi.fn(() => true)
  let nextFrame = 1
  let inFrame = false
  let messaging!: ReturnType<typeof installMessaging>
  let nativeComputed!: (element: Element) => CSSStyleDeclaration

  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error: Error & { type?: string; cause?: unknown }) => {
    if (error.type === 'unhandled-exception') pageErrors.push(String(error.cause ?? error))
  })
  parentWindow.postMessage = (...args: unknown[]) => {
    windowPosts.push(['parent', ...args])
  }

  const dom = new JSDOM(html, {
    url: PAGE_URL,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    resources: { interceptors: [requestInterceptor((request) => respond(new URL(request.url)))] },
    beforeParse(window) {
      messaging = installMessaging(window, pageErrors)
      Object.defineProperty(window, 'parent', { configurable: true, get: () => parentWindow })
      window.postMessage = (...args: unknown[]) => {
        windowPosts.push(['self', ...args])
      }
      window.fetch = async (input: RequestInfo | URL) => respond(new URL(String(input), window.location.href))
      window.requestAnimationFrame = (callback: FrameRequestCallback) => {
        frames.set(nextFrame, callback)
        return nextFrame++
      }
      window.cancelAnimationFrame = (handle: number) => {
        frames.delete(handle)
      }
      window.Element.prototype.getBoundingClientRect = function (this: Element) {
        measurements.push({ inFrame })
        const { x, y, width, height } = rects.get(this) ?? { x: 0, y: 0, width: 0, height: 0 }
        return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height } as DOMRect
      }
      window.document.elementsFromPoint = (x: number, y: number) => {
        measurements.push({ inFrame })
        return [...window.document.querySelectorAll('*')].filter((element) => contains(rects.get(element), x, y)).reverse()
      }
      const computedStyle = window.getComputedStyle.bind(window)
      nativeComputed = (element) => computedStyle(element)
      window.getComputedStyle = (element: Element, pseudo?: string | null) => {
        measurements.push({ inFrame })
        return computedStyle(element, pseudo)
      }
      const supported = new Set(options.textBoxSupported ? [normalizedCondition(TEXT_BOX)] : [])
      Object.assign(window, {
        CSS: {
          supports: (property: string, value?: string) => supported.has(normalizedCondition(value === undefined ? property : `${property}: ${value}`)),
          escape: (text: string) => text.replace(/[^\w-]/g, (character) => `\\${character}`),
        },
      })
      Object.defineProperty(window.document, 'fonts', { configurable: true, value: fontFaceSet(window, options.fontFaces ?? [], fontsCheck) })
    },
  })

  const { window } = dom
  await loaded(window)
  await quiet(window)

  const page: Page = {
    window,
    indexed,
    parentWindow,
    windowPosts,
    pageErrors,
    fontsCheck,
    measurements,
    handshake(source) {
      const { port1, port2 } = messaging.channel()
      const received: ProbeToEditor[] = []
      messaging.listen(port1, (data) => received.push(data))
      const event = new window.MessageEvent('message', { data: { type: PROBE_HANDSHAKE }, source: source as MessageEventSource })
      Object.defineProperty(event, 'ports', { value: Object.freeze([port2]) })
      window.dispatchEvent(event)
      return { received, send: (message) => messaging.post(port1, message) }
    },
    runFrame() {
      const due = [...frames.values()]
      frames.clear()
      inFrame = true
      try {
        for (const callback of due) callback(window.performance.now())
      } finally {
        inFrame = false
      }
    },
    setRect(element, rect) {
      rects.set(element, rect)
    },
    rendered(id) {
      return [...window.document.querySelectorAll<HTMLElement>(`[data-ed-id="${id}"]`)]
    },
    computed(element) {
      return nativeComputed(element)
    },
    global<T>(name: string) {
      return (window as unknown as Record<string, T>)[name]!
    },
  }
  openPages.push(page)
  return page
}

async function untilReceived(page: Page, editor: EditorEnd, matches: (message: ProbeToEditor) => boolean): Promise<ProbeToEditor> {
  return vi.waitFor(() => {
    page.runFrame()
    const found = editor.received.find(matches)
    if (!found) throw new Error('not received yet')
    return found
  }, WAIT)
}

async function connect(page: Page): Promise<EditorEnd> {
  const editor = page.handshake(page.parentWindow)
  await untilReceived(page, editor, (message) => message.type === 'ready')
  return editor
}

let nextReadId = 1000

/** A read answered means every message sent before it was handled. */
async function roundTrip(page: Page, editor: EditorEnd): Promise<void> {
  const id = nextReadId++
  editor.send({ type: 'read', id, reads: [{ kind: 'supports', condition: TEXT_BOX }] })
  await untilReceived(page, editor, (message) => message.type === 'readResult' && message.id === id)
}

async function readOne(page: Page, editor: EditorEnd, read: EditorToProbe & { type: 'read' }): Promise<readonly ProbeReadResult[]> {
  editor.send(read)
  const answer = await untilReceived(page, editor, (message) => message.type === 'readResult' && message.id === read.id)
  return (answer as Extract<ProbeToEditor, { type: 'readResult' }>).results
}

function readResults(editor: EditorEnd) {
  return editor.received.filter((message): message is Extract<ProbeToEditor, { type: 'readResult' }> => message.type === 'readResult')
}

function isHidden(page: Page, element: Element): boolean {
  const style = page.computed(element)
  return style.display === 'none' || style.visibility === 'hidden'
}

beforeAll(async () => {
  probeBundle = await buildProbeBundle()
}, 30_000)

afterEach(() => {
  const pages = openPages.splice(0)
  for (const page of pages) {
    page.window.close()
    page.parentWindow.close()
  }
  for (const page of pages) expect(page.pageErrors).toEqual([])
})

describe('buildProbeBundle', () => {
  it('builds the probe into one classic-script IIFE for injection', () => {
    expect(probeBundle.length).toBeGreaterThan(200)
    expect(probeBundle).not.toMatch(/^\s*(import|export)\b/m)
    expect(() => new Function(probeBundle)).not.toThrow()
  })
})

describe('probe handshake', () => {
  it("accepts the parent's handshake and answers ready over the transferred port", async () => {
    const page = await openPage()
    const editor = await connect(page)
    expect(editor.received[0]).toMatchObject({ type: 'ready', scrollX: expect.any(Number), scrollY: expect.any(Number) })
  })

  it('ignores a handshake the frame posts to itself, then still accepts the parent', async () => {
    const page = await openPage()
    const forged = page.handshake(page.window)
    const editor = await connect(page)
    forged.send({ type: 'read', id: 1, reads: [{ kind: 'supports', condition: TEXT_BOX }] })
    await roundTrip(page, editor)
    expect(forged.received).toEqual([])
  })

  it('ignores a handshake from a window other than the parent', async () => {
    const page = await openPage()
    const stranger = new JSDOM('', { url: 'http://evil.test/' }).window
    const forged = page.handshake(stranger)
    const editor = await connect(page)
    forged.send({ type: 'read', id: 1, reads: [{ kind: 'supports', condition: TEXT_BOX }] })
    await roundTrip(page, editor)
    expect(forged.received).toEqual([])
    stranger.close()
  })

  it('accepts the handshake once: a second one gets nothing and the first port keeps answering', async () => {
    const page = await openPage()
    const editor = await connect(page)
    const second = page.handshake(page.parentWindow)
    second.send({ type: 'read', id: 1, reads: [{ kind: 'supports', condition: TEXT_BOX }] })
    await roundTrip(page, editor)
    await ticks()
    expect(second.received).toEqual([])
  })

  it('hides the accepted handshake from every later listener', async () => {
    const page = await openPage({
      projectHeadScript: "window.seenMessages = []; addEventListener('message', (event) => seenMessages.push(event.ports.length))",
    })
    await connect(page)
    expect(page.global<number[]>('seenMessages')).toEqual([])
  })

  it('keeps native port methods from before project scripts patch them', async () => {
    const page = await openPage({
      projectHeadScript: [
        'window.hijacks = []',
        'const nativeListen = EventTarget.prototype.addEventListener',
        "EventTarget.prototype.addEventListener = function (type, listener, options) { if (this instanceof MessagePort) { hijacks.push('addEventListener'); return } return nativeListen.call(this, type, listener, options) }",
        "Object.defineProperty(MessagePort.prototype, 'onmessage', { configurable: true, get() { return null }, set() { hijacks.push('onmessage') } })",
        "MessagePort.prototype.postMessage = function () { hijacks.push('postMessage') }",
      ].join('\n'),
    })
    const editor = await connect(page)
    await roundTrip(page, editor)
    expect(page.global<string[]>('hijacks')).toEqual([])
  })

  it('sends nothing over window.postMessage', async () => {
    const page = await openPage({ googleFonts: 'offline' })
    const editor = await connect(page)
    const h1 = idOfTag(page.indexed, 'h1')
    editor.send({ type: 'read', id: 1, reads: [{ kind: 'rects', edId: h1 }, { kind: 'computed', edId: h1, props: ['font-size'] }] })
    editor.send({ type: 'previewDecl', edIds: [h1], prop: 'color', value: 'rgb(1, 2, 3)' })
    editor.send({ type: 'beginTextEdit', session: 's1', edId: h1 })
    editor.send({ type: 'endTextEdit', session: 's1' })
    await untilReceived(page, editor, (message) => message.type === 'textCommit')
    await untilReceived(page, editor, (message) => message.type === 'fontsFailed')
    await roundTrip(page, editor)
    expect(page.windowPosts).toEqual([])
  })
})

describe('probe reads', () => {
  it('batches every read into the next animation frame and answers them there', async () => {
    const page = await openPage()
    const editor = await connect(page)
    const li = idOfTag(page.indexed, 'li')
    const h1 = idOfTag(page.indexed, 'h1')
    page.rendered(li).forEach((element, i) => page.setRect(element, { x: 10, y: 100 + 40 * i, width: 200, height: 30 }))
    page.measurements.length = 0

    editor.send({ type: 'read', id: 1, reads: [{ kind: 'rects', edId: li }] })
    editor.send({
      type: 'read',
      id: 2,
      reads: [
        { kind: 'computed', edId: h1, props: ['font-size'] },
        { kind: 'hitTest', x: 20, y: 150, depth: 'deepest', within: null },
      ],
    })
    await ticks(5)
    expect(readResults(editor)).toEqual([])
    expect(page.measurements).toEqual([])

    page.runFrame()
    await vi.waitFor(() => expect(readResults(editor).map((message) => message.id)).toEqual([1, 2]), WAIT)
    expect(page.measurements.length).toBeGreaterThanOrEqual(3)
    expect(page.measurements.every((call) => call.inFrame)).toBe(true)
  })

  it('answers rects for every rendered node that shares the id', async () => {
    const page = await openPage()
    const editor = await connect(page)
    const li = idOfTag(page.indexed, 'li')
    const repeats = page.rendered(li)
    expect(repeats).toHaveLength(3)
    const expected = repeats.map((_element, i) => ({ x: 10, y: 100 + 40 * i, width: 200, height: 30 }))
    repeats.forEach((element, i) => page.setRect(element, expected[i]!))
    const [result] = await readOne(page, editor, { type: 'read', id: 1, reads: [{ kind: 'rects', edId: li }] })
    expect(result).toMatchObject({ kind: 'rects', rects: expected })
  })

  it('answers computed values from getComputedStyle', async () => {
    const page = await openPage()
    const editor = await connect(page)
    const h1 = idOfTag(page.indexed, 'h1')
    const expected = page.computed(page.rendered(h1)[0]!).getPropertyValue('font-size')
    expect(expected).not.toBe('')
    const [result] = await readOne(page, editor, { type: 'read', id: 1, reads: [{ kind: 'computed', edId: h1, props: ['font-size'] }] })
    expect(result).toEqual({ kind: 'computed', values: { 'font-size': expected } })
  })

  it('hit-tests with elementsFromPoint to the deepest element that carries an id', async () => {
    const page = await openPage()
    const editor = await connect(page)
    const li = idOfTag(page.indexed, 'li')
    const ul = idOfTag(page.indexed, 'ul')
    page.setRect(page.rendered(ul)[0]!, { x: 0, y: 90, width: 400, height: 200 })
    page.rendered(li).forEach((element, i) => page.setRect(element, { x: 10, y: 100 + 40 * i, width: 200, height: 30 }))
    const scriptMade = page.window.document.createElement('span')
    page.rendered(li)[1]!.append(scriptMade)
    page.setRect(scriptMade, { x: 10, y: 140, width: 200, height: 30 })

    const results = await readOne(page, editor, {
      type: 'read',
      id: 1,
      reads: [
        { kind: 'hitTest', x: 20, y: 150, depth: 'deepest', within: null },
        { kind: 'hitTest', x: 300, y: 270, depth: 'deepest', within: null },
        { kind: 'hitTest', x: 5000, y: 5000, depth: 'deepest', within: null },
      ],
    })
    expect(results).toEqual([
      { kind: 'hitTest', edId: li },
      { kind: 'hitTest', edId: ul },
      { kind: 'hitTest', edId: null },
    ])
  })

  it("snapshots the dragged element's parent and sibling rects in one answer", async () => {
    const page = await openPage()
    const editor = await connect(page)
    const section = idOfTag(page.indexed, 'section')
    const columns = [0, 1, 2].map((nth) => idOfTag(page.indexed, 'div', nth))
    const sectionRect = { x: 0, y: 300, width: 1200, height: 100 }
    const columnRects = [
      { x: 0, y: 300, width: 240, height: 60 },
      { x: 256, y: 300, width: 360, height: 60 },
      { x: 632, y: 300, width: 480, height: 60 },
    ]
    page.setRect(page.rendered(section)[0]!, sectionRect)
    columns.forEach((id, i) => page.setRect(page.rendered(id)[0]!, columnRects[i]!))

    const [result] = await readOne(page, editor, { type: 'read', id: 1, reads: [{ kind: 'snapRects', edId: columns[1]! }] })
    expect(result).toMatchObject({ kind: 'snapRects', self: columnRects[1], parent: sectionRect, siblings: [columnRects[0], columnRects[2]] })
  })

  it.each([true, false])('reports CSS.supports for text-box trim-both cap alphabetic (supported: %s)', async (textBoxSupported) => {
    const page = await openPage({ textBoxSupported })
    const editor = await connect(page)
    const [result] = await readOne(page, editor, { type: 'read', id: 1, reads: [{ kind: 'supports', condition: TEXT_BOX }] })
    expect(result).toEqual({ kind: 'supports', supported: textBoxSupported })
  })
})

describe('probe previews', () => {
  it('applies an optimistic decl to every rendered node of every target id', async () => {
    const page = await openPage()
    const editor = await connect(page)
    const li = idOfTag(page.indexed, 'li')
    const h1 = idOfTag(page.indexed, 'h1')
    const section = idOfTag(page.indexed, 'section')
    editor.send({ type: 'previewDecl', edIds: [li, h1], prop: 'color', value: 'rgb(1, 2, 3)' })
    const targets = [...page.rendered(li), ...page.rendered(h1)]
    expect(targets).toHaveLength(4)
    await vi.waitFor(() => {
      page.runFrame()
      for (const element of targets) expect(element.style.getPropertyValue('color')).toBe('rgb(1, 2, 3)')
    }, WAIT)
    expect(page.rendered(section)[0]!.style.getPropertyValue('color')).toBe('')
  })

  it('removes the declaration from every rendered node when the preview value is null', async () => {
    const page = await openPage()
    const editor = await connect(page)
    const li = idOfTag(page.indexed, 'li')
    const repeats = page.rendered(li)
    editor.send({ type: 'previewDecl', edIds: [li], prop: 'color', value: 'rgb(1, 2, 3)' })
    await vi.waitFor(() => {
      page.runFrame()
      for (const element of repeats) expect(element.style.getPropertyValue('color')).toBe('rgb(1, 2, 3)')
    }, WAIT)
    editor.send({ type: 'previewDecl', edIds: [li], prop: 'color', value: null })
    await vi.waitFor(() => {
      page.runFrame()
      for (const element of repeats) expect(element.style.getPropertyValue('color')).toBe('')
    }, WAIT)
    for (const element of repeats) expect(element.style.getPropertyValue('border-bottom-style')).toBe('solid')
  })
})

describe('probe text editing', () => {
  async function editHeading(page: Page) {
    const editor = await connect(page)
    const h1 = idOfTag(page.indexed, 'h1')
    const [heading] = page.rendered(h1)
    editor.send({ type: 'beginTextEdit', session: 's1', edId: h1 })
    await vi.waitFor(() => {
      page.runFrame()
      expect(heading!.getAttribute('contenteditable')).toBe('plaintext-only')
    }, WAIT)
    return { editor, h1, heading: heading! }
  }

  function type(page: Page, element: HTMLElement, text: string): void {
    const { InputEvent } = page.window
    element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }))
    ;(element.firstChild as Text).data += text
    element.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }))
  }

  function commits(editor: EditorEnd) {
    return editor.received.filter((message) => message.type === 'textCommit')
  }

  it('edits in place with contenteditable="plaintext-only"', async () => {
    const page = await openPage()
    const { heading } = await editHeading(page)
    expect(page.window.document.querySelectorAll('[contenteditable]')).toHaveLength(1)
    expect(heading.isConnected).toBe(true)
  })

  it('commits the typed text when the edit ends, and leaves editing mode', async () => {
    const page = await openPage()
    const { editor, h1, heading } = await editHeading(page)
    type(page, heading, '!')
    await roundTrip(page, editor)
    editor.send({ type: 'endTextEdit', session: 's1' })
    const commit = await untilReceived(page, editor, (message) => message.type === 'textCommit')
    expect(commit).toEqual({ type: 'textCommit', session: 's1', edId: h1, text: 'Studio Weekly!' })
    expect(editor.received.some((message) => message.type === 'textCancelled')).toBe(false)
    expect(heading.hasAttribute('contenteditable')).toBe(false)
  })

  it.each([
    ['a timer rewrites the text node', (heading: HTMLElement) => ((heading.firstChild as Text).data = 'Ticked')],
    ['setState replaces the text', (heading: HTMLElement) => (heading.textContent = 'Redrawn')],
    ['a hover handler toggles a class', (heading: HTMLElement) => heading.classList.add('hovered')],
  ])('cancels and discards the edit when %s', async (_cause, redraw) => {
    const page = await openPage()
    const { editor, heading } = await editHeading(page)
    type(page, heading, '!')
    await roundTrip(page, editor)
    redraw(heading)
    const cancel = await untilReceived(page, editor, (message) => message.type === 'textCancelled')
    expect(cancel).toEqual({ type: 'textCancelled', session: 's1', reason: 'redrawn' })
    editor.send({ type: 'endTextEdit', session: 's1' })
    await roundTrip(page, editor)
    expect(commits(editor)).toEqual([])
  })

  it('cancels with detached when the node leaves the page, and never commits it', async () => {
    const page = await openPage()
    const { editor, heading } = await editHeading(page)
    type(page, heading, '!')
    await roundTrip(page, editor)
    heading.remove()
    const cancel = await untilReceived(page, editor, (message) => message.type === 'textCancelled')
    expect(cancel).toEqual({ type: 'textCancelled', session: 's1', reason: 'detached' })
    editor.send({ type: 'endTextEdit', session: 's1' })
    await roundTrip(page, editor)
    expect(commits(editor)).toEqual([])
  })
})

describe('probe offline fonts', () => {
  function fontsFailed(editor: EditorEnd) {
    return editor.received.filter((message): message is Extract<ProbeToEditor, { type: 'fontsFailed' }> => message.type === 'fontsFailed')
  }

  it('reports the css2 family when its <link> fails to load', async () => {
    const page = await openPage({ googleFonts: 'offline' })
    const editor = await connect(page)
    await untilReceived(page, editor, (message) => message.type === 'fontsFailed')
    expect(fontsFailed(editor).flatMap((message) => message.families)).toContain('Inter')
    expect(page.fontsCheck).not.toHaveBeenCalled()
  })

  it('reports a FontFace whose status is error', async () => {
    const page = await openPage({
      googleFonts: 'online',
      fontFaces: [
        { family: 'Inter', status: 'loaded' },
        { family: 'Fraunces', status: 'error' },
      ],
    })
    const editor = await connect(page)
    await untilReceived(page, editor, (message) => message.type === 'fontsFailed')
    const families = fontsFailed(editor).flatMap((message) => message.families)
    expect(families).toContain('Fraunces')
    expect(families).not.toContain('Inter')
    expect(page.fontsCheck).not.toHaveBeenCalled()
  })

  it('reports nothing when the css2 sheet and every FontFace loaded', async () => {
    const page = await openPage({ googleFonts: 'online', fontFaces: [{ family: 'Inter', status: 'loaded' }] })
    const editor = await connect(page)
    await roundTrip(page, editor)
    await ticks(5)
    page.runFrame()
    await roundTrip(page, editor)
    expect(fontsFailed(editor)).toEqual([])
    expect(page.fontsCheck).not.toHaveBeenCalled()
  })
})

describe('editor-only hide', () => {
  it('hides every rendered node of a hidden id through served bytes only', async () => {
    const page = await openPage({ hide: (indexed) => [idOfTag(indexed, 'li')] })
    const li = idOfTag(page.indexed, 'li')
    const h1 = idOfTag(page.indexed, 'h1')
    await connect(page)
    const repeats = page.rendered(li)
    expect(repeats).toHaveLength(3)
    for (const element of repeats) expect(isHidden(page, element)).toBe(true)
    expect(isHidden(page, page.rendered(h1)[0]!)).toBe(false)
  })

  it('hides nothing when no id is hidden', async () => {
    const page = await openPage()
    await connect(page)
    for (const element of page.rendered(idOfTag(page.indexed, 'li'))) expect(isHidden(page, element)).toBe(false)
  })
})
