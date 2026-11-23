import MagicString from 'magic-string'
import { html as spec, parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import type { SourceRange } from '../../shared/types'
import type { Eol } from '../source/bytes'
import { hasHole } from '../source/style-index'
import { elementChildren, isElement } from '../source/template-tree'
import { attrValueOf, refuse, removeAttrSplice } from './text-splice'

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode
type DocumentFragment = DefaultTreeAdapterTypes.DocumentFragment
type Attribute = Element['attrs'][number]

export interface PastedFragment {
  /** The cleaned fragment exactly as it is spliced, in the file's line endings. */
  readonly html: string
  readonly root: DocumentFragment
  /** Elements written by a start tag in `html`, in document order; the parser's own (an implied `<tbody>`) are left out. */
  readonly elements: readonly Element[]
}

const DATA_BOUND =
  'data-bound layers cannot be pasted; use Duplicate (Mod-D) or drag-reorder in the layers panel to copy or move them with their bindings'

const DATA_BOUND_TAGS = new Set(['sc-for', 'sc-if', 'dc-import'])

const GLOBAL_ATTRIBUTES = new Set(['id', 'class', 'style', 'title', 'lang', 'dir', 'role'])

/** Every pasteable HTML tag with the attributes it takes beyond the global ones. */
const HTML_ELEMENTS: ReadonlyMap<string, readonly string[]> = new Map([
  ...[
    'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
    'figure', 'figcaption', 'ul', 'dl', 'dt', 'dd', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'mark', 'code', 'pre', 'kbd',
    'sub', 'sup', 'abbr', 'br', 'hr', 'label', 'summary', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'caption',
  ].map((tag): [string, readonly string[]] => [tag, []]),
  ['a', ['href', 'target', 'rel']],
  ['img', ['src', 'alt', 'width', 'height', 'loading']],
  ['ol', ['start', 'reversed']],
  ['li', ['value']],
  ['td', ['colspan', 'rowspan']],
  ['th', ['colspan', 'rowspan', 'scope']],
  ['time', ['datetime']],
  ['blockquote', ['cite']],
  ['q', ['cite']],
  ['button', ['type', 'disabled']],
  ['details', ['open']],
])

const SVG_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask',
])

const SVG_ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'preserveAspectRatio', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'fx', 'fy', 'd', 'points', 'pathLength', 'transform', 'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'clip-path', 'mask',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'opacity', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform',
  'spreadMethod', 'clipPathUnits', 'maskUnits', 'maskContentUnits',
])

const LINK_SCHEMES = new Set(['http', 'https', 'mailto'])
const IMAGE_SCHEMES = new Set(['http', 'https'])
/** URL attributes and the schemes each takes; a URL without a scheme (relative, `#x`) is always allowed. */
const URL_ATTRIBUTES: ReadonlyMap<string, { readonly schemes: ReadonlySet<string>; readonly dataImages: boolean }> = new Map([
  ['href', { schemes: LINK_SCHEMES, dataImages: false }],
  ['cite', { schemes: LINK_SCHEMES, dataImages: false }],
  ['src', { schemes: IMAGE_SCHEMES, dataImages: true }],
])

const FRAGMENT_MARKERS = /<!--StartFragment-->([\s\S]*)<!--EndFragment-->/
const LEADING_META_CHARSET = /^\s*<meta\s+charset\s*=\s*["']?[\w-]+["']?\s*\/?>/i
const BODY = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi
const URL_REFERENCE = /(url\(\s*["']?#)([^"')\s]+)/g
const HREF_REFERENCE = /^(\s*#)(.+?)(\s*)$/
/** What the tokenizer reads as a tag, comment or declaration rather than text. */
const MARKUP = /<[a-z!?/]/i

/** Drops the clipboard's own packaging: the CF_HTML or StartFragment markers, a leading `<meta charset>`, and the document wrappers. */
function unwrapPackaging(html: string): string {
  const marked = FRAGMENT_MARKERS.exec(html)
  if (marked) return marked[1]!.trim()
  const content = html.replace(LEADING_META_CHARSET, '')
  return (BODY.exec(content)?.[1] ?? content).trim()
}

function parsed(html: string, context: Element): DocumentFragment {
  return parseFragment(context, html, { sourceCodeLocationInfo: true })
}

function descendants(node: ParentNode): Element[] {
  return elementChildren(node).flatMap((child) => [child, ...descendants(child)])
}

interface LocatedAttribute {
  readonly name: string
  readonly range: SourceRange
  /** Inside the quotes; null for a bare attribute. */
  readonly value: SourceRange | null
  readonly raw: string
}

function locatedAttributes(html: string, root: ParentNode): LocatedAttribute[] {
  return descendants(root).flatMap((element) =>
    Object.entries(element.sourceCodeLocation?.attrs ?? {}).map(([name, location]) => {
      const range = { start: location.startOffset, end: location.endOffset }
      const value = attrValueOf(html, range)?.range ?? null
      return { name, range, value, raw: value ? html.slice(value.start, value.end) : '' }
    }),
  )
}

function referencesIn({ name, raw }: LocatedAttribute): string[] {
  const urls = [...raw.matchAll(URL_REFERENCE)].map((match) => match[2]!)
  const href = name === 'href' ? HREF_REFERENCE.exec(raw)?.[2] : undefined
  return href === undefined ? urls : [...urls, href]
}

function withReferencesRenamed({ name, raw }: LocatedAttribute, rename: (id: string) => string): string {
  const urls = raw.replace(URL_REFERENCE, (_match, head: string, id: string) => head + rename(id))
  return name === 'href' ? urls.replace(HREF_REFERENCE, (_match, head: string, id: string, tail: string) => head + rename(id) + tail) : urls
}

/** Ids the fragment points at (`href="#x"`, `url(#x)`) get a per-paste prefix and their references follow; the rest are dropped, as `duplicateNode` drops them. */
function withPasteIds(html: string, context: Element, mintPrefix: () => string): string {
  const attrs = locatedAttributes(html, parsed(html, context))
  const referenced = new Set(attrs.flatMap(referencesIn))
  const kept = new Set(attrs.filter(({ name, raw }) => name === 'id' && referenced.has(raw)).map(({ raw }) => raw))
  const prefix = kept.size > 0 ? mintPrefix() : ''
  const rename = (id: string) => (kept.has(id) ? prefix + id : id)
  const magic = new MagicString(html)
  for (const attr of attrs) {
    if (attr.name === 'id' && !kept.has(attr.raw)) {
      const { start, end } = removeAttrSplice(html, attr.range)
      magic.remove(start, end)
      continue
    }
    const rewritten = attr.name === 'id' ? rename(attr.raw) : withReferencesRenamed(attr, rename)
    if (attr.value && rewritten !== attr.raw) magic.update(attr.value.start, attr.value.end, rewritten)
  }
  return magic.toString()
}

/** The scheme before the first `/`, `?` or `#`, after the URL parser's own removal of tabs, newlines and surrounding spaces; null for a relative URL. */
function schemeOf(url: string): string | null {
  const cleaned = url.replace(/[\t\n\r]/g, '').trim().toLowerCase()
  const head = /^[^/?#]*/.exec(cleaned)![0]
  const colon = head.indexOf(':')
  return colon < 0 ? null : head.slice(0, colon)
}

function isAllowedUrl(url: string, schemes: ReadonlySet<string>, dataImages: boolean): boolean {
  const scheme = schemeOf(url)
  if (scheme === null) return true
  if (scheme === 'data') return dataImages && /^data:image\//i.test(url.replace(/[\t\n\r]/g, '').trim())
  return schemes.has(scheme)
}

function requireAllowedCssUrls(attr: Attribute): void {
  if (attr.name === 'style' && attr.value.includes('\\')) refuse('a style with CSS escapes cannot be pasted')
  for (const [, double, single, bare] of attr.value.matchAll(CSS_URL)) {
    if (!isAllowedUrl(double ?? single ?? bare ?? '', IMAGE_SCHEMES, true)) refuse(`the url() in this ${attr.name} cannot be pasted`)
  }
}

function isAllowedAttribute(element: Element, name: string): boolean {
  if (GLOBAL_ATTRIBUTES.has(name) || /^aria-[a-z]+$/.test(name)) return true
  if (name.startsWith('data-')) return name !== 'data-ed-id'
  if (element.namespaceURI === spec.NS.SVG) return SVG_ATTRIBUTES.has(name)
  return HTML_ELEMENTS.get(element.tagName)!.includes(name)
}

function requireAllowedAttribute(element: Element, attr: Attribute): void {
  if (attr.prefix || !isAllowedAttribute(element, attr.name)) refuse(`the ${attr.prefix ? `${attr.prefix}:` : ''}${attr.name} attribute cannot be pasted`)
  const url = URL_ATTRIBUTES.get(attr.name)
  if (url && !isAllowedUrl(attr.value, url.schemes, url.dataImages)) refuse(`that ${attr.name} link cannot be pasted`)
  requireAllowedCssUrls(attr)
}

function isAllowedElement(element: Element): boolean {
  if (element.namespaceURI === spec.NS.SVG) return SVG_ELEMENTS.has(element.tagName)
  return element.namespaceURI === spec.NS.HTML && HTML_ELEMENTS.has(element.tagName)
}

/**
 * The parent must be one the allow-list would let a paste write, or a custom element: under a `<script>`, `<style>` or
 * another element whose content the parser reads as text, the fragment holds no elements for the checks to refuse.
 */
function requireAllowedParent(parent: Element): void {
  const custom = parent.namespaceURI === spec.NS.HTML && parent.tagName.includes('-')
  if (!custom && !isAllowedElement(parent)) refuse(`nothing can be pasted inside a <${parent.tagName}>`)
}

function requireAllowed(elements: readonly Element[]): void {
  for (const element of elements) {
    if (DATA_BOUND_TAGS.has(element.tagName)) refuse(DATA_BOUND)
    if (!isAllowedElement(element)) refuse(`a <${element.tagName}> cannot be pasted`)
    for (const attr of element.attrs) requireAllowedAttribute(element, attr)
  }
}

/** Start and end tags and comments, the source the fragment's nodes account for; text is left out, since a text node can run across a dropped tag. */
function keptRanges(node: ParentNode): SourceRange[] {
  return node.childNodes.flatMap((child): SourceRange[] => {
    if (isElement(child)) {
      const { startTag, endTag } = child.sourceCodeLocation ?? {}
      return [...[startTag, endTag].flatMap((tag) => (tag ? [{ start: tag.startOffset, end: tag.endOffset }] : [])), ...keptRanges(child)]
    }
    const location = child.sourceCodeLocation
    return child.nodeName === '#comment' && location ? [{ start: location.startOffset, end: location.endOffset }] : []
  })
}

/** Every tag must become a node: the parser silently drops some (a stray `</p>`, a nested `<body>`), and the whole board would read those differently. */
function requireEveryTagKept(html: string, root: ParentNode): void {
  let at = 0
  for (const range of [...keptRanges(root).sort((a, b) => a.start - b.start), { start: html.length, end: html.length }]) {
    const dropped = MARKUP.exec(html.slice(at, range.start))
    if (dropped) {
      const tag = /^<\/?([a-z][^\s/>]*)/i.exec(html.slice(at + dropped.index))?.[1]
      refuse(tag ? `the browser would not keep the <${tag.toLowerCase()}> as written` : 'the browser would not keep this HTML as written')
    }
    at = Math.max(at, range.end)
  }
}

/** Unwraps, renames ids and checks pasted HTML against the allow-list; refuses anything not on it. */
export function pastedFragment(html: string, context: Element, eol: Eol, mintPrefix: () => string): PastedFragment {
  requireAllowedParent(context)
  const unwrapped = unwrapPackaging(html).replace(/\r\n?|\n/g, eol)
  if (unwrapped === '') refuse('there is nothing to paste')
  if (hasHole(unwrapped)) refuse(DATA_BOUND)
  const cleaned = withPasteIds(unwrapped, context, mintPrefix)
  const root = parsed(cleaned, context)
  const elements = descendants(root)
  requireAllowed(elements)
  requireEveryTagKept(cleaned, root)
  return { html: cleaned, root, elements: elements.filter((element) => element.sourceCodeLocation?.startTag) }
}
