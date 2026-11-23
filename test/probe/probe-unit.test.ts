// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROBE_HANDSHAKE, type EditorToProbe, type ProbeRead, type ProbeReadResult, type ProbeToEditor, type Rect } from '../../src/shared/protocol'
import type { EdId } from '../../src/shared/types'

interface FontFaceLike {
  readonly family: string
  readonly status: 'loaded' | 'error'
}

interface Editor {
  readonly received: ProbeToEditor[]
  readonly probePort: FakeMessagePort
  send(message: EditorToProbe): void
}

interface HandshakeOptions {
  readonly source?: unknown
  readonly data?: unknown
  readonly ports?: (port: FakeMessagePort) => readonly FakeMessagePort[]
}

class FakeMessagePort extends EventTarget {
  partner: FakeMessagePort | null = null
  started = false

  postMessage(data: unknown): void {
    this.partner?.dispatchEvent(new MessageEvent('message', { data }))
  }

  start(): void {
    this.started = true
  }
}

class FakeFontFaceSet extends EventTarget {
  faces: FontFaceLike[] = []
  readonly ready = Promise.resolve(this)

  forEach(callback: (face: FontFaceLike) => void): void {
    this.faces.forEach(callback)
  }
}

const edId = (id: string) => id as EdId
const EDITOR_WINDOW = { name: 'editor' }
const SUPPORTED = new Set(['(display: grid)'])
const GOOGLE_CSS2 = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Roboto+Mono&display=swap'

let frames: FrameRequestCallback[] = []
const removeListeners: (() => void)[] = []
let fonts: FakeFontFaceSet
let rects: WeakMap<Element, Rect>
const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent')!

/** Vitest's `window` is the test global with jsdom's methods bound to it; the probe's captured listen needs jsdom's own window. */
function jsdomWindow(): EventTarget {
  return (globalThis as unknown as { jsdom: { window: EventTarget } }).jsdom.window
}

async function loadProbe({ parent = EDITOR_WINDOW as unknown }: { parent?: unknown } = {}): Promise<void> {
  vi.resetModules()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('MessagePort', FakeMessagePort)
  Object.defineProperty(window, 'parent', { configurable: true, writable: true, value: parent })
  const nativeListen = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (this: EventTarget, type, listener, options) {
    const target = this === globalThis ? jsdomWindow() : this
    removeListeners.push(() => target.removeEventListener(type, listener, options))
    nativeListen.call(target, type, listener, options)
  }
  try {
    await import('../../src/probe/probe')
  } finally {
    EventTarget.prototype.addEventListener = nativeListen
  }
}

function handshake({ source = EDITOR_WINDOW, data = { type: PROBE_HANDSHAKE }, ports = (port) => [port] }: HandshakeOptions = {}): Editor {
  const editorPort = new FakeMessagePort()
  const probePort = new FakeMessagePort()
  editorPort.partner = probePort
  probePort.partner = editorPort
  const received: ProbeToEditor[] = []
  editorPort.addEventListener('message', (event) => received.push((event as MessageEvent<ProbeToEditor>).data))
  const event = new MessageEvent('message', { data })
  Object.defineProperty(event, 'source', { value: source })
  Object.defineProperty(event, 'ports', { value: Object.freeze(ports(probePort)) })
  window.dispatchEvent(event)
  return { received, probePort, send: (message) => editorPort.postMessage(message) }
}

async function connect(): Promise<Editor> {
  await loadProbe()
  return handshake()
}

function runFrame(): void {
  for (const callback of frames.splice(0)) callback(0)
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function html(markup: string): void {
  document.body.innerHTML = markup
}

function byId(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-ed-id="${id}"]`)!
}

function setRect(element: Element, rect: Rect): void {
  rects.set(element, rect)
}

function stubElementsFromPoint(hits: (x: number, y: number) => Element[]): void {
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: hits })
}

function readOne(editor: Editor, ...reads: ProbeRead[]): readonly ProbeReadResult[] {
  const id = editor.received.length + 100
  editor.send({ type: 'read', id, reads })
  runFrame()
  const answer = editor.received.find((message) => message.type === 'readResult' && message.id === id)
  if (answer?.type !== 'readResult') throw new Error(`read ${id} was not answered`)
  return answer.results
}

function ofType<T extends ProbeToEditor['type']>(editor: Editor, type: T) {
  return editor.received.filter((message): message is Extract<ProbeToEditor, { type: T }> => message.type === type)
}

beforeEach(() => {
  frames = []
  rects = new WeakMap()
  fonts = new FakeFontFaceSet()
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
  vi.stubGlobal('CSS', {
    escape: (text: string) => text.replace(/[^\w-]/g, (character) => `\\${character}`),
    supports: (condition: string) => SUPPORTED.has(condition),
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const { x, y, width, height } = rects.get(this) ?? { x: 0, y: 0, width: 0, height: 0 }
    return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}) }
  })
})

afterEach(() => {
  for (const remove of removeListeners.splice(0)) remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'parent', parentDescriptor)
  Reflect.deleteProperty(document, 'fonts')
  Reflect.deleteProperty(document, 'elementsFromPoint')
  document.documentElement.removeAttribute('data-ed-id')
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('handshake', () => {
  it("accepts the editor window's handshake, starts the port and answers ready with the scroll position", async () => {
    vi.stubGlobal('scrollX', 12)
    vi.stubGlobal('scrollY', 34)
    const editor = await connect()

    expect(editor.received).toEqual([{ type: 'ready', scrollX: 12, scrollY: 34 }])
    expect(editor.probePort.started).toBe(true)
  })

  it.each<[string, HandshakeOptions]>([
    ['comes from a window other than the parent', { source: { name: 'stranger' } }],
    ['carries a different message type', { data: { type: 'something-else' } }],
    ['carries no data', { data: null }],
    ['transfers no port', { ports: () => [] }],
    ['transfers two ports', { ports: (port) => [port, new FakeMessagePort()] }],
  ])('ignores a handshake that %s, and still accepts the real one after it', async (_case, options) => {
    await loadProbe()

    const forged = handshake(options)
    const editor = handshake()

    expect(forged.received).toEqual([])
    expect(forged.probePort.started).toBe(false)
    expect(editor.received.map((message) => message.type)).toEqual(['ready'])
  })

  it('never accepts a handshake when the probe runs in a top-level window', async () => {
    await loadProbe({ parent: window })

    expect(handshake({ source: window }).received).toEqual([])
  })

  it('accepts only the first handshake, and the first port keeps answering', async () => {
    const editor = await connect()
    const second = handshake()

    second.send({ type: 'read', id: 1, reads: [{ kind: 'supports', condition: '(display: grid)' }] })
    editor.send({ type: 'read', id: 2, reads: [{ kind: 'supports', condition: '(display: grid)' }] })
    runFrame()

    expect(second.received).toEqual([])
    expect(ofType(editor, 'readResult').map((message) => message.id)).toEqual([2])
  })

  it('hides the accepted handshake from later window listeners but lets rejected ones through', async () => {
    await loadProbe()
    const seen: unknown[] = []
    const record = (event: Event) => seen.push((event as MessageEvent).data)
    window.addEventListener('message', record)

    handshake({ data: { type: PROBE_HANDSHAKE, forged: true }, source: { name: 'stranger' } })
    handshake()
    window.removeEventListener('message', record)

    expect(seen).toEqual([{ type: PROBE_HANDSHAKE, forged: true }])
  })
})

describe('reads', () => {
  it('queues every read until the next animation frame and answers them in order there', async () => {
    const editor = await connect()

    editor.send({ type: 'read', id: 1, reads: [{ kind: 'supports', condition: '(display: grid)' }] })
    editor.send({ type: 'read', id: 2, reads: [{ kind: 'supports', condition: '(display: subgrid)' }] })

    expect(frames).toHaveLength(1)
    expect(ofType(editor, 'readResult')).toEqual([])
    runFrame()
    expect(ofType(editor, 'readResult')).toEqual([
      { type: 'readResult', id: 1, results: [{ kind: 'supports', supported: true }] },
      { type: 'readResult', id: 2, results: [{ kind: 'supports', supported: false }] },
    ])
  })

  it('requests a new frame for reads that arrive after the previous frame ran', async () => {
    const editor = await connect()
    readOne(editor, { kind: 'supports', condition: '(display: grid)' })

    editor.send({ type: 'read', id: 7, reads: [] })

    expect(frames).toHaveLength(1)
  })

  it('answers rects for every rendered node that shares the id, and none for an unknown id', async () => {
    html('<ul><li data-ed-id="li">a</li><li data-ed-id="li">b</li><li data-ed-id="other">c</li></ul>')
    const [first, second] = document.querySelectorAll('[data-ed-id="li"]')
    setRect(first!, { x: 1, y: 2, width: 3, height: 4 })
    setRect(second!, { x: 5, y: 6, width: 7, height: 8 })
    const editor = await connect()

    expect(readOne(editor, { kind: 'rects', edId: edId('li') }, { kind: 'rects', edId: edId('missing') })).toEqual([
      { kind: 'rects', rects: [{ x: 1, y: 2, width: 3, height: 4 }, { x: 5, y: 6, width: 7, height: 8 }] },
      { kind: 'rects', rects: [] },
    ])
  })

  it('finds an id that needs escaping in a selector', async () => {
    html('<p data-ed-id="a&quot;b]">quoted</p>')
    setRect(document.querySelector('p')!, { x: 9, y: 9, width: 9, height: 9 })
    const editor = await connect()

    expect(readOne(editor, { kind: 'rects', edId: edId('a"b]') })).toEqual([{ kind: 'rects', rects: [{ x: 9, y: 9, width: 9, height: 9 }] }])
  })

  it('answers computed values of the first rendered node, and nothing for an unknown id', async () => {
    html('<h1 data-ed-id="h1" style="color: rgb(1, 2, 3); margin-top: 7px">Title</h1>')
    const editor = await connect()

    expect(
      readOne(editor, { kind: 'computed', edId: edId('h1'), props: ['color', 'margin-top'] }, { kind: 'computed', edId: edId('missing'), props: ['color'] }),
    ).toEqual([
      { kind: 'computed', values: { color: 'rgb(1, 2, 3)', 'margin-top': '7px' } },
      { kind: 'computed', values: {} },
    ])
  })

  describe('hitTest', () => {
    beforeEach(() => {
      html('<x-dc data-ed-id="root"><section data-ed-id="section"><div data-ed-id="card"><span data-ed-id="label"><b>x</b></span></div></section></x-dc>')
    })

    function hit(editor: Editor, depth: 'top' | 'deeper' | 'deepest', within: string | null): ProbeReadResult {
      return readOne(editor, { kind: 'hitTest', x: 10, y: 20, depth, within: within === null ? null : edId(within) })[0]!
    }

    it('hit-tests the topmost element at the point and answers the deepest ancestor that carries an id', async () => {
      const points: number[][] = []
      stubElementsFromPoint((x, y) => {
        points.push([x, y])
        return [document.querySelector('b')!, byId('label')]
      })
      const editor = await connect()

      expect(hit(editor, 'deepest', null)).toEqual({ kind: 'hitTest', edId: 'label' })
      expect(points).toEqual([[10, 20]])
    })

    it('answers null when nothing with an id is under the point', async () => {
      stubElementsFromPoint(() => [])
      const editor = await connect()

      expect(hit(editor, 'deepest', null)).toEqual({ kind: 'hitTest', edId: null })
      expect(hit(editor, 'top', null)).toEqual({ kind: 'hitTest', edId: null })
    })

    it.each(['top', 'deeper'] as const)('picks the element directly under the template root for %s with no scope', async (depth) => {
      stubElementsFromPoint(() => [document.querySelector('b')!])
      const editor = await connect()

      expect(hit(editor, depth, null)).toEqual({ kind: 'hitTest', edId: 'section' })
    })

    it('picks the element directly under the given scope', async () => {
      stubElementsFromPoint(() => [document.querySelector('b')!])
      const editor = await connect()

      expect(hit(editor, 'deeper', 'section')).toEqual({ kind: 'hitTest', edId: 'card' })
      expect(hit(editor, 'deeper', 'card')).toEqual({ kind: 'hitTest', edId: 'label' })
    })

    it('answers null when the hit is the scope itself or lies outside it', async () => {
      stubElementsFromPoint(() => [document.querySelector('b')!])
      const editor = await connect()

      expect(hit(editor, 'deeper', 'label')).toEqual({ kind: 'hitTest', edId: null })
      expect(hit(editor, 'deeper', 'elsewhere')).toEqual({ kind: 'hitTest', edId: null })
    })
  })

  it("snapshots the element's own, parent and sibling rects", async () => {
    html('<section data-ed-id="row"><div data-ed-id="a"></div><div data-ed-id="b"></div><div data-ed-id="c"></div></section>')
    setRect(byId('row'), { x: 0, y: 0, width: 300, height: 50 })
    setRect(byId('a'), { x: 0, y: 0, width: 100, height: 50 })
    setRect(byId('b'), { x: 100, y: 0, width: 100, height: 50 })
    setRect(byId('c'), { x: 200, y: 0, width: 100, height: 50 })
    const editor = await connect()

    expect(readOne(editor, { kind: 'snapRects', edId: edId('b') })).toEqual([
      {
        kind: 'snapRects',
        self: { x: 100, y: 0, width: 100, height: 50 },
        parent: { x: 0, y: 0, width: 300, height: 50 },
        siblings: [
          { x: 0, y: 0, width: 100, height: 50 },
          { x: 200, y: 0, width: 100, height: 50 },
        ],
      },
    ])
  })

  it('snapshots an element with no parent element as having no parent and no siblings', async () => {
    document.documentElement.setAttribute('data-ed-id', 'html')
    setRect(document.documentElement, { x: 0, y: 0, width: 800, height: 600 })
    const editor = await connect()

    expect(readOne(editor, { kind: 'snapRects', edId: edId('html') })).toEqual([
      { kind: 'snapRects', self: { x: 0, y: 0, width: 800, height: 600 }, parent: null, siblings: [] },
    ])
  })

  it('snapshots an empty rect for an unknown id', async () => {
    const editor = await connect()

    expect(readOne(editor, { kind: 'snapRects', edId: edId('missing') })).toEqual([
      { kind: 'snapRects', self: { x: 0, y: 0, width: 0, height: 0 }, parent: null, siblings: [] },
    ])
  })

  it('reports CSS.supports for the condition', async () => {
    const editor = await connect()

    expect(readOne(editor, { kind: 'supports', condition: '(display: grid)' }, { kind: 'supports', condition: '(display: subgrid)' })).toEqual([
      { kind: 'supports', supported: true },
      { kind: 'supports', supported: false },
    ])
  })
})

describe('matches', () => {
  beforeEach(() => {
    html(
      '<section class="row"><button class="btn primary" data-ed-id="btn">a</button><button class="btn ghost" data-ed-id="btn">b</button></section>' +
        '<input class="field" data-ed-id="field">',
    )
  })

  function matched(editor: Editor, id: string, selectors: readonly string[]): ProbeReadResult {
    return readOne(editor, { kind: 'matches', edId: edId(id), selectors })[0]!
  }

  it('answers, per selector, whether any rendered instance of the element matches it', async () => {
    const editor = await connect()

    expect(matched(editor, 'btn', ['.btn', '.primary', '.ghost', '.row > .btn', '.missing', 'input'])).toEqual({
      kind: 'matches',
      matched: [true, true, true, true, false, false],
    })
  })

  it('answers no match for every selector of an id that renders nothing', async () => {
    const editor = await connect()

    expect(matched(editor, 'missing', ['.btn', '*'])).toEqual({ kind: 'matches', matched: [false, false] })
  })

  it('counts a selector that throws as no match and still answers the others', async () => {
    const editor = await connect()

    expect(matched(editor, 'btn', ['[[', '.btn', '.btn >'])).toEqual({ kind: 'matches', matched: [false, true, false] })
  })

  it.each([':hover', ':focus', ':active', ':focus-visible'])('strips the %s state before matching', async (state) => {
    const editor = await connect()

    expect(matched(editor, 'btn', [`.btn${state}`, `.row${state} .ghost`, `.missing${state}`])).toEqual({
      kind: 'matches',
      matched: [true, true, false],
    })
  })

  it.each([
    ['btn', '.btn::before'],
    ['btn', '.primary::after'],
    ['field', '.field::placeholder'],
  ])('strips the pseudo-element before matching %s against %s', async (id, selector) => {
    const editor = await connect()

    expect(matched(editor, id, [selector, `.missing${selector.slice(selector.indexOf('::'))}`])).toEqual({
      kind: 'matches',
      matched: [true, false],
    })
  })

  it('strips states and pseudo-elements from every selector of a list', async () => {
    const editor = await connect()

    expect(matched(editor, 'btn', ['.missing:hover, .ghost::after'])).toEqual({ kind: 'matches', matched: [true] })
  })
})

describe('document height', () => {
  afterEach(() => {
    Reflect.deleteProperty(document.documentElement, 'scrollHeight')
  })

  it('answers the document scrollHeight as measured in the read frame, alongside the other reads', async () => {
    let scrollHeight = 900
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => scrollHeight })
    const editor = await connect()

    editor.send({ type: 'read', id: 5, reads: [{ kind: 'supports', condition: '(display: grid)' }, { kind: 'documentHeight' }] })
    scrollHeight = 1460
    expect(ofType(editor, 'readResult')).toEqual([])
    runFrame()

    expect(ofType(editor, 'readResult')).toEqual([
      { type: 'readResult', id: 5, results: [{ kind: 'supports', supported: true }, { kind: 'documentHeight', scrollHeight: 1460 }] },
    ])
  })
})

describe('root font size', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('font-size')
  })

  it('answers the font size of <html>, which rem is relative to', async () => {
    document.documentElement.style.fontSize = '12px'
    const editor = await connect()

    editor.send({ type: 'read', id: 6, reads: [{ kind: 'rootFontSize' }] })
    runFrame()

    expect(ofType(editor, 'readResult')).toEqual([{ type: 'readResult', id: 6, results: [{ kind: 'rootFontSize', fontSize: 12 }] }])
  })
})

describe('editor styles', () => {
  const OUTLINE = '[data-ed-id] { color: rgb(1, 2, 3) }'
  const PAGE_STYLE = 'h1 { margin: 0 }'

  beforeEach(() => {
    document.head.innerHTML = `<style>${PAGE_STYLE}</style>`
    html('<h1 data-ed-id="h1">Title</h1>')
  })

  afterEach(() => {
    for (const style of document.querySelectorAll('style')) style.remove()
  })

  function styleTexts(): string[] {
    return [...document.querySelectorAll('style')].map((style) => style.textContent ?? '').sort()
  }

  function colorOf(editor: Editor): ProbeReadResult {
    return readOne(editor, { kind: 'computed', edId: edId('h1'), props: ['color'] })[0]!
  }

  it("adds one editor-only stylesheet next to the page's own, and the page renders with it", async () => {
    const editor = await connect()

    editor.send({ type: 'setEditorStyles', css: OUTLINE })

    expect(styleTexts()).toEqual([OUTLINE, PAGE_STYLE].sort())
    expect(colorOf(editor)).toEqual({ kind: 'computed', values: { color: 'rgb(1, 2, 3)' } })
  })

  it('replaces the editor stylesheet on the next message instead of adding another', async () => {
    const editor = await connect()
    const hidden = '[data-ed-id] { visibility: hidden }'

    editor.send({ type: 'setEditorStyles', css: OUTLINE })
    editor.send({ type: 'setEditorStyles', css: hidden })

    expect(styleTexts()).toEqual([hidden, PAGE_STYLE].sort())
  })

  it('removes the editor stylesheet on null and leaves the page as authored', async () => {
    const editor = await connect()
    editor.send({ type: 'setEditorStyles', css: OUTLINE })

    editor.send({ type: 'setEditorStyles', css: null })

    expect(styleTexts()).toEqual([PAGE_STYLE])
    expect(colorOf(editor)).not.toEqual({ kind: 'computed', values: { color: 'rgb(1, 2, 3)' } })
  })

  it('does nothing on null when no editor stylesheet is in place, and adds one again after a removal', async () => {
    const editor = await connect()

    editor.send({ type: 'setEditorStyles', css: null })
    expect(styleTexts()).toEqual([PAGE_STYLE])
    editor.send({ type: 'setEditorStyles', css: OUTLINE })
    editor.send({ type: 'setEditorStyles', css: null })
    editor.send({ type: 'setEditorStyles', css: OUTLINE })

    expect(styleTexts()).toEqual([OUTLINE, PAGE_STYLE].sort())
  })
})

describe('previewDecl', () => {
  beforeEach(() => {
    html('<li data-ed-id="li" style="border-bottom: 1px solid red">a</li><li data-ed-id="li">b</li><h1 data-ed-id="h1">t</h1><p data-ed-id="p">p</p>')
  })

  it('sets the declaration on every rendered node of every target id', async () => {
    const editor = await connect()

    editor.send({ type: 'previewDecl', edIds: [edId('li'), edId('h1')], prop: 'color', value: 'rgb(1, 2, 3)' })

    const colors = [...document.querySelectorAll<HTMLElement>('[data-ed-id]')].map((element) => element.style.getPropertyValue('color'))
    expect(colors).toEqual(['rgb(1, 2, 3)', 'rgb(1, 2, 3)', 'rgb(1, 2, 3)', ''])
  })

  it('removes only that declaration when the value is null', async () => {
    const editor = await connect()
    editor.send({ type: 'previewDecl', edIds: [edId('li')], prop: 'color', value: 'red' })

    editor.send({ type: 'previewDecl', edIds: [edId('li')], prop: 'color', value: null })

    const [first] = document.querySelectorAll<HTMLElement>('[data-ed-id="li"]')
    expect(first!.style.getPropertyValue('color')).toBe('')
    expect(first!.style.getPropertyValue('border-bottom-style')).toBe('solid')
  })
})

describe('text editing', () => {
  beforeEach(() => {
    html('<h1 data-ed-id="h1">Hello</h1><p data-ed-id="p">Other</p><input id="elsewhere">')
  })

  function heading(): HTMLElement {
    return byId('h1')
  }

  function type(element: HTMLElement, text: string): void {
    element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true }))
    ;(element.firstChild as Text).data += text
    element.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }))
  }

  async function editHeading(): Promise<Editor> {
    const editor = await connect()
    editor.send({ type: 'beginTextEdit', session: 's1', edId: edId('h1') })
    return editor
  }

  function textMessages(editor: Editor) {
    return editor.received.filter((message) => message.type === 'textCommit' || message.type === 'textCancelled')
  }

  it('makes the node plaintext-only contenteditable and focuses it', async () => {
    await editHeading()

    expect(heading().getAttribute('contenteditable')).toBe('plaintext-only')
    expect(document.activeElement).toBe(heading())
  })

  it('cancels with detached when no node renders the id', async () => {
    const editor = await connect()

    editor.send({ type: 'beginTextEdit', session: 's9', edId: edId('missing') })

    expect(textMessages(editor)).toEqual([{ type: 'textCancelled', session: 's9', reason: 'detached' }])
  })

  it('commits the typed text when the editor ends the session, and leaves editing mode', async () => {
    const editor = await editHeading()
    type(heading(), ' world')
    await settle()

    editor.send({ type: 'endTextEdit', session: 's1' })

    expect(textMessages(editor)).toEqual([{ type: 'textCommit', session: 's1', edId: 'h1', text: 'Hello world' }])
    expect(heading().hasAttribute('contenteditable')).toBe(false)
  })

  it('commits when an input event left the text as typed, even without a beforeinput', async () => {
    const editor = await editHeading()
    ;(heading().firstChild as Text).data = 'Typed'
    heading().dispatchEvent(new InputEvent('input'))
    await settle()

    editor.send({ type: 'endTextEdit', session: 's1' })

    expect(textMessages(editor)).toEqual([{ type: 'textCommit', session: 's1', edId: 'h1', text: 'Typed' }])
  })

  it('ignores the end of a session it is not editing', async () => {
    const editor = await editHeading()

    editor.send({ type: 'endTextEdit', session: 'other' })

    expect(textMessages(editor)).toEqual([])
    expect(heading().getAttribute('contenteditable')).toBe('plaintext-only')
  })

  it('commits when the node loses focus', async () => {
    const editor = await editHeading()
    type(heading(), '!')
    await settle()

    document.querySelector<HTMLInputElement>('#elsewhere')!.focus()

    expect(textMessages(editor)).toEqual([{ type: 'textCommit', session: 's1', edId: 'h1', text: 'Hello!' }])
  })

  it('cancels with escape on the Escape key and ignores other keys', async () => {
    const editor = await editHeading()

    heading().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(textMessages(editor)).toEqual([])
    heading().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(textMessages(editor)).toEqual([{ type: 'textCancelled', session: 's1', reason: 'escape' }])
    expect(heading().hasAttribute('contenteditable')).toBe(false)
  })

  it('stops listening once the edit ends', async () => {
    const editor = await editHeading()
    editor.send({ type: 'endTextEdit', session: 's1' })

    heading().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    heading().textContent = 'Redrawn later'
    await settle()

    expect(textMessages(editor)).toEqual([{ type: 'textCommit', session: 's1', edId: 'h1', text: 'Hello' }])
  })

  it.each([
    ['a script rewrites the text node', (element: HTMLElement) => ((element.firstChild as Text).data = 'Ticked')],
    ['a render replaces the text', (element: HTMLElement) => (element.textContent = 'Redrawn')],
    ['a handler toggles a class while the user types', (element: HTMLElement) => {
      type(element, '!')
      element.classList.add('hovered')
    }],
  ])('cancels with redrawn when %s', async (_cause, redraw) => {
    const editor = await editHeading()

    redraw(heading())
    await settle()
    editor.send({ type: 'endTextEdit', session: 's1' })

    expect(textMessages(editor)).toEqual([{ type: 'textCancelled', session: 's1', reason: 'redrawn' }])
    expect(heading().hasAttribute('contenteditable')).toBe(false)
  })

  it('ignores changes outside the edited node', async () => {
    const editor = await editHeading()

    byId('p').textContent = 'Changed'
    byId('p').classList.add('x')
    await settle()

    expect(textMessages(editor)).toEqual([])
  })

  it('checks pending changes before committing, so a redraw just before the end still cancels', async () => {
    const editor = await editHeading()

    heading().textContent = 'Redrawn'
    editor.send({ type: 'endTextEdit', session: 's1' })

    expect(textMessages(editor)).toEqual([{ type: 'textCancelled', session: 's1', reason: 'redrawn' }])
  })

  it('cancels with detached when the node leaves the page, and never commits it', async () => {
    const editor = await editHeading()

    heading().remove()
    await settle()
    editor.send({ type: 'endTextEdit', session: 's1' })

    expect(textMessages(editor)).toEqual([{ type: 'textCancelled', session: 's1', reason: 'detached' }])
  })

  it('leaves a superseded edit alone when its node changes after a newer edit began', async () => {
    const editor = await editHeading()
    editor.send({ type: 'beginTextEdit', session: 's2', edId: edId('p') })

    heading().textContent = 'Changed'
    await settle()
    editor.send({ type: 'endTextEdit', session: 's2' })

    expect(textMessages(editor)).toEqual([{ type: 'textCommit', session: 's2', edId: 'p', text: 'Other' }])
  })
})

describe('scrolling', () => {
  it('reports the scroll position on every window scroll', async () => {
    const editor = await connect()
    vi.stubGlobal('scrollX', 5)
    vi.stubGlobal('scrollY', 600)

    window.dispatchEvent(new Event('scroll'))

    expect(ofType(editor, 'scrolled')).toEqual([{ type: 'scrolled', scrollX: 5, scrollY: 600 }])
  })

  it('sends nothing for scrolls before the handshake', async () => {
    await loadProbe()

    window.dispatchEvent(new Event('scroll'))
    const editor = handshake()

    expect(editor.received.map((message) => message.type)).toEqual(['ready'])
  })

  it('scrolls the window to the requested position', async () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    const editor = await connect()

    editor.send({ type: 'scrollTo', x: 40, y: 900 })

    expect(scrollTo).toHaveBeenCalledWith(40, 900)
  })
})

describe('font failures', () => {
  function addLink(href: string, rel = 'stylesheet'): HTMLLinkElement {
    const link = document.createElement('link')
    link.rel = rel
    link.href = href
    document.head.append(link)
    return link
  }

  function failedFamilies(editor: Editor): string[] {
    return ofType(editor, 'fontsFailed').flatMap((message) => message.families)
  }

  function loadingError(families: string[]): void {
    const event = new Event('loadingerror')
    Object.defineProperty(event, 'fontfaces', { value: families.map((family) => ({ family })) })
    fonts.dispatchEvent(event)
  }

  it('reports every family of a css2 link that fails to load, once connected', async () => {
    await loadProbe()

    addLink(GOOGLE_CSS2).dispatchEvent(new Event('error'))
    const editor = handshake()

    expect(editor.received).toEqual([
      { type: 'ready', scrollX: 0, scrollY: 0 },
      { type: 'fontsFailed', families: ['Inter', 'Roboto Mono'] },
    ])
  })

  it('ignores load errors from anything but a Google Fonts css2 stylesheet', async () => {
    const editor = await connect()

    addLink('https://fonts.googleapis.com/css?family=Lato').dispatchEvent(new Event('error'))
    addLink(GOOGLE_CSS2, 'preload').dispatchEvent(new Event('error'))
    const image = document.createElement('img')
    document.body.append(image)
    image.dispatchEvent(new Event('error'))

    expect(failedFamilies(editor)).toEqual([])
  })

  it('reports FontFace loading errors immediately once connected, without quotes', async () => {
    const editor = await connect()

    loadingError(['"Fraunces"', "'Space Grotesk'", 'Inter'])

    expect(ofType(editor, 'fontsFailed')).toEqual([{ type: 'fontsFailed', families: ['Fraunces', 'Space Grotesk', 'Inter'] }])
  })

  it('reports each family once however many times it fails', async () => {
    const editor = await connect()

    loadingError(['Fraunces'])
    loadingError(['"Fraunces"', 'Inter'])
    loadingError(['Inter'])

    expect(ofType(editor, 'fontsFailed')).toEqual([
      { type: 'fontsFailed', families: ['Fraunces'] },
      { type: 'fontsFailed', families: ['Inter'] },
    ])
  })

  it('on window load, reports css2 links that have no stylesheet and FontFaces whose status is error', async () => {
    addLink(GOOGLE_CSS2)
    const loadedLink = addLink('https://fonts.googleapis.com/css2?family=Lora')
    Object.defineProperty(loadedLink, 'sheet', { value: {} })
    fonts.faces = [
      { family: 'Lora', status: 'loaded' },
      { family: 'Fraunces', status: 'error' },
    ]
    const editor = await connect()

    window.dispatchEvent(new Event('load'))
    await settle()

    expect(failedFamilies(editor)).toEqual(['Inter', 'Roboto Mono', 'Fraunces'])
  })

  it('reports nothing on window load when every sheet and FontFace loaded', async () => {
    const link = addLink(GOOGLE_CSS2)
    Object.defineProperty(link, 'sheet', { value: {} })
    fonts.faces = [{ family: 'Inter', status: 'loaded' }]
    const editor = await connect()

    window.dispatchEvent(new Event('load'))
    await settle()

    expect(failedFamilies(editor)).toEqual([])
  })
})
