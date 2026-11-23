import {
  PROBE_HANDSHAKE,
  type EditorToProbe,
  type ProbeRead,
  type ProbeReadResult,
  type ProbeToEditor,
  type Rect,
  type TextCancelReason,
} from '../shared/protocol'
import type { EdId } from '../shared/types'

type ReadRequest = Extract<EditorToProbe, { type: 'read' }>
type PreviewDecl = Extract<EditorToProbe, { type: 'previewDecl' }>
type HitTest = Extract<ProbeRead, { kind: 'hitTest' }>

interface TextEdit {
  readonly session: string
  readonly edId: EdId
  readonly element: HTMLElement
  readonly observer: MutationObserver
  readonly listeners: AbortController
  typing: boolean
  typedText: string
}

const ID_ATTR = 'data-ed-id'
const TEMPLATE_ROOT = 'x-dc'
const GOOGLE_FONTS_CSS2 = 'link[rel~="stylesheet"][href^="https://fonts.googleapis.com/css2"]'
const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 }

// Taken before any project script runs, so a script that patches them later never sees the port.
const listen = EventTarget.prototype.addEventListener
const stopImmediatePropagation = Event.prototype.stopImmediatePropagation
const postToPort = MessagePort.prototype.postMessage
const startPort = MessagePort.prototype.start
const requestFrame = window.requestAnimationFrame.bind(window)
const editorWindow = window.parent

let port: MessagePort | null = null
let textEdit: TextEdit | null = null
const pendingReads: ReadRequest[] = []
const failedFamilies = new Set<string>()
const unreportedFamilies: string[] = []

function post(message: ProbeToEditor): void {
  if (port) postToPort.call(port, message)
}

function postScroll(type: 'ready' | 'scrolled'): void {
  post({ type, scrollX: window.scrollX, scrollY: window.scrollY })
}

function idOf(element: Element): EdId {
  return element.getAttribute(ID_ATTR) as EdId
}

function rendered(edId: EdId): Element[] {
  return [...document.querySelectorAll(`[${ID_ATTR}="${CSS.escape(edId)}"]`)]
}

function rectOf(element: Element): Rect {
  const { x, y, width, height } = element.getBoundingClientRect()
  return { x, y, width, height }
}

/** The element and its ancestors that carry an id, deepest first. */
function idChain(element: Element | undefined): Element[] {
  const chain: Element[] = []
  for (let current = element?.closest(`[${ID_ATTR}]`); current; current = current.parentElement?.closest(`[${ID_ATTR}]`)) chain.push(current)
  return chain
}

/** `top` and `deeper` both pick the chain member directly under the scope; the editor widens or narrows `within`. */
function hitTest({ x, y, depth, within }: HitTest): EdId | null {
  const chain = idChain(document.elementsFromPoint(x, y)[0])
  if (depth === 'deepest') return chain[0] ? idOf(chain[0]) : null
  const scope = chain.findIndex((element) => (within === null ? element.localName === TEMPLATE_ROOT : idOf(element) === within))
  const hit = scope > 0 ? chain[scope - 1] : undefined
  return hit ? idOf(hit) : null
}

function computedValues(edId: EdId, props: readonly string[]): Record<string, string> {
  const [element] = rendered(edId)
  if (!element) return {}
  const style = getComputedStyle(element)
  return Object.fromEntries(props.map((prop) => [prop, style.getPropertyValue(prop)]))
}

function snapRects(edId: EdId): Extract<ProbeReadResult, { kind: 'snapRects' }> {
  const [self] = rendered(edId)
  if (!self) return { kind: 'snapRects', self: EMPTY_RECT, parent: null, siblings: [] }
  const parent = self.parentElement
  const siblings = parent ? [...parent.children].filter((sibling) => sibling !== self).map(rectOf) : []
  return { kind: 'snapRects', self: rectOf(self), parent: parent ? rectOf(parent) : null, siblings }
}

function answer(read: ProbeRead): ProbeReadResult {
  switch (read.kind) {
    case 'rects':
      return { kind: 'rects', rects: rendered(read.edId).map(rectOf) }
    case 'computed':
      return { kind: 'computed', values: computedValues(read.edId, read.props) }
    case 'hitTest':
      return { kind: 'hitTest', edId: hitTest(read) }
    case 'snapRects':
      return snapRects(read.edId)
    case 'supports':
      return { kind: 'supports', supported: CSS.supports(read.condition) }
  }
}

/** Every measurement happens inside one animation frame, so reads never force extra layouts. */
function answerReads(): void {
  for (const { id, reads } of pendingReads.splice(0)) post({ type: 'readResult', id, results: reads.map(answer) })
}

function queueRead(read: ReadRequest): void {
  if (pendingReads.push(read) === 1) requestFrame(answerReads)
}

function previewDecl({ edIds, prop, value }: PreviewDecl): void {
  for (const element of edIds.flatMap(rendered) as HTMLElement[]) {
    if (value === null) element.style.removeProperty(prop)
    else element.style.setProperty(prop, value)
  }
}

function finishTextEdit(edit: TextEdit): void {
  edit.observer.disconnect()
  edit.listeners.abort()
  edit.element.removeAttribute('contenteditable')
  textEdit = null
}

function cancelTextEdit(edit: TextEdit, reason: TextCancelReason): void {
  finishTextEdit(edit)
  post({ type: 'textCancelled', session: edit.session, reason })
}

/** Only the user's own typing may change the edited node; any other change means the runtime redrew it. */
function checkTextEdit(edit: TextEdit, records: readonly MutationRecord[]): void {
  if (textEdit !== edit) return
  if (!edit.element.isConnected) return cancelTextEdit(edit, 'detached')
  const isTyping = edit.typing || edit.element.textContent === edit.typedText
  const redrawn = records.some((record) => edit.element.contains(record.target) && (record.type === 'attributes' || !isTyping))
  edit.typing = false
  if (redrawn) cancelTextEdit(edit, 'redrawn')
}

function listenWhileEditing(edit: TextEdit): void {
  const options = { signal: edit.listeners.signal }
  listen.call(edit.element, 'beforeinput', () => (edit.typing = true), options)
  listen.call(edit.element, 'input', () => (edit.typedText = edit.element.textContent ?? ''), options)
  listen.call(edit.element, 'keydown', (event) => (event as KeyboardEvent).key === 'Escape' && cancelTextEdit(edit, 'escape'), options)
}

function beginTextEdit(session: string, edId: EdId): void {
  const [element] = rendered(edId) as HTMLElement[]
  if (!element) return post({ type: 'textCancelled', session, reason: 'detached' })
  element.setAttribute('contenteditable', 'plaintext-only')
  const edit: TextEdit = {
    session,
    edId,
    element,
    observer: new MutationObserver((records) => checkTextEdit(edit, records)),
    listeners: new AbortController(),
    typing: false,
    typedText: element.textContent ?? '',
  }
  edit.observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true })
  listenWhileEditing(edit)
  textEdit = edit
  element.focus()
}

/** Commit reads the text only while the node is still connected; pending records are checked first. */
function endTextEdit(session: string): void {
  const edit = textEdit
  if (!edit || edit.session !== session) return
  checkTextEdit(edit, edit.observer.takeRecords())
  if (textEdit !== edit) return
  finishTextEdit(edit)
  post({ type: 'textCommit', session, edId: edit.edId, text: edit.element.textContent ?? '' })
}

function onEditorMessage(message: EditorToProbe): void {
  switch (message.type) {
    case 'read':
      return queueRead(message)
    case 'previewDecl':
      return previewDecl(message)
    case 'beginTextEdit':
      return beginTextEdit(message.session, message.edId)
    case 'endTextEdit':
      return endTextEdit(message.session)
    case 'scrollTo':
      return window.scrollTo(message.x, message.y)
  }
}

function reportFailedFonts(): void {
  if (!port || unreportedFamilies.length === 0) return
  post({ type: 'fontsFailed', families: unreportedFamilies.splice(0) })
}

function noteFailedFamilies(families: readonly string[]): void {
  for (const family of families.map((name) => name.replace(/^["']|["']$/g, ''))) {
    if (failedFamilies.has(family)) continue
    failedFamilies.add(family)
    unreportedFamilies.push(family)
  }
  reportFailedFonts()
}

function css2Families(link: HTMLLinkElement): string[] {
  return new URL(link.href).searchParams.getAll('family').map((family) => family.split(':')[0]!)
}

function isCss2Link(target: EventTarget | null): target is HTMLLinkElement {
  return target instanceof HTMLLinkElement && target.matches(GOOGLE_FONTS_CSS2)
}

/** `document.fonts.check()` is true for a family with no @font-face at all, so failures come from loads instead. */
function watchFonts(): void {
  listen.call(document, 'error', (event) => isCss2Link(event.target) && noteFailedFamilies(css2Families(event.target)), true)
  listen.call(document.fonts, 'loadingerror', (event) => noteFailedFamilies((event as FontFaceSetLoadEvent).fontfaces.map((face) => face.family)))
  listen.call(window, 'load', () => {
    for (const link of document.querySelectorAll<HTMLLinkElement>(GOOGLE_FONTS_CSS2)) if (!link.sheet) noteFailedFamilies(css2Families(link))
    void document.fonts.ready.then((faces) => {
      const failed: string[] = []
      faces.forEach((face) => face.status === 'error' && failed.push(face.family))
      noteFailedFamilies(failed)
    })
  })
}

function isEditorHandshake(event: MessageEvent): boolean {
  const data = event.data as { type?: unknown } | null
  return port === null && editorWindow !== window && event.source === editorWindow && data?.type === PROBE_HANDSHAKE && event.ports.length === 1
}

function acceptHandshake(event: Event): void {
  const message = event as MessageEvent
  if (!isEditorHandshake(message)) return
  stopImmediatePropagation.call(message)
  port = message.ports[0]!
  listen.call(port, 'message', (portEvent) => onEditorMessage((portEvent as MessageEvent<EditorToProbe>).data))
  startPort.call(port)
  postScroll('ready')
  reportFailedFonts()
}

listen.call(window, 'message', acceptHandshake)
listen.call(window, 'scroll', () => postScroll('scrolled'), { passive: true })
watchFonts()
