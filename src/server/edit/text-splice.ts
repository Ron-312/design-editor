import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import type { EdId, SourceRange } from '../../shared/types'
import type { IndexedDeclaration } from '../source/style-index'

type TextNode = DefaultTreeAdapterTypes.TextNode

/** A node whose new start offset is the splice's output position plus `at`. */
export interface CarriedId {
  readonly id: EdId
  readonly at: number
}

/** Replaces `[start, end)` of the original text with `content`; `start === end` inserts. */
export interface Splice {
  readonly start: number
  readonly end: number
  readonly content: string
  readonly carried?: readonly CarriedId[]
}

/** An op the source cannot take; the whole flush is dropped and `message` is shown as is. */
export class Refusal extends Error {}

export function refuse(reason: string): never {
  throw new Refusal(reason)
}

export const LIVE_VALUE = 'contains a live value; edit in source or Tweaks'

type Quote = '"' | "'" | ''

interface AttrValue {
  readonly range: SourceRange
  readonly quote: Quote
}

export function escapeAttr(value: string, quote: Quote): string {
  const escaped = value.replace(/&/g, '&amp;')
  return quote === "'" ? escaped.replace(/'/g, '&#39;') : escaped.replace(/"/g, '&quot;')
}

/** The value span inside an attribute's quotes; null for a bare `disabled`. */
export function attrValueOf(text: string, attr: SourceRange): AttrValue | null {
  const prefix = /^[^=]*=\s*(["']?)/.exec(text.slice(attr.start, attr.end))
  if (!prefix) return null
  const quote = prefix[1] as Quote
  return { range: { start: attr.start + prefix[0].length, end: attr.end - quote.length }, quote }
}

/** Before the start tag's `>` (or `/>`), after any whitespace that precedes it. */
function attrInsertionPoint(text: string, startTag: SourceRange): number {
  let at = startTag.end - 1
  if (text[at - 1] === '/') at -= 1
  while (/\s/.test(text[at - 1] ?? '')) at -= 1
  return at
}

export function setAttrSplice(text: string, startTag: SourceRange, attr: SourceRange | undefined, name: string, value: string): Splice {
  if (!attr) {
    const at = attrInsertionPoint(text, startTag)
    return { start: at, end: at, content: ` ${name}="${escapeAttr(value, '"')}"` }
  }
  const current = attrValueOf(text, attr)
  if (!current) return { start: attr.end, end: attr.end, content: `="${escapeAttr(value, '"')}"` }
  const content = current.quote === '' ? `"${escapeAttr(value, '"')}"` : escapeAttr(value, current.quote)
  return { start: current.range.start, end: current.range.end, content }
}

export function lastDeclaration(declarations: readonly IndexedDeclaration[], prop: string): IndexedDeclaration | undefined {
  return declarations.findLast((declaration) => declaration.prop.toLowerCase() === prop.toLowerCase())
}

function valueStartOf(text: string, declaration: IndexedDeclaration): number {
  const afterColon = text.indexOf(':', declaration.range.start) + 1
  return afterColon + /^\s*/.exec(text.slice(afterColon, declaration.range.end))![0].length
}

/** Rewrites the value span only, so the authored spacing and an existing `!important` stay unless `important` is given. */
export function replaceValueSplice(text: string, declaration: IndexedDeclaration, value: string, important: boolean | undefined): Splice {
  const start = valueStartOf(text, declaration)
  if (important === undefined) return { start, end: start + declaration.value.length, content: value }
  return { start, end: declaration.range.end, content: important ? `${value} !important` : value }
}

/** Separator spelling of the existing list: `; ` between declarations and `: ` after the prop, or their compact forms. */
function separatorsOf(text: string, declarations: readonly IndexedDeclaration[]): { gap: string; colon: string } {
  const [first, second] = declarations
  const colon = first ? /^\s*:\s*/.exec(text.slice(first.range.start + first.prop.length, first.range.end))![0] : ': '
  if (first && second) return { gap: /;(\s*)/.exec(text.slice(first.range.end, second.range.start))?.[1] ?? ' ', colon }
  return { gap: colon.endsWith(' ') ? ' ' : '', colon }
}

/** Appends after the last declaration, keeping a trailing `;` last; `emptyAt` is where an empty list starts. */
export function appendDeclarationSplice(
  text: string,
  declarations: readonly IndexedDeclaration[],
  emptyAt: number | null,
  declaration: { prop: string; value: string; important?: boolean },
): Splice {
  const last = declarations.at(-1)
  const { gap, colon } = separatorsOf(text, declarations)
  const written = `${declaration.prop}${colon}${declaration.value}${declaration.important ? ' !important' : ''}`
  if (!last) {
    if (emptyAt === null) refuse('there are no declarations here to add to; edit in source')
    return { start: emptyAt, end: emptyAt, content: written }
  }
  const trailing = /^\s*;/.exec(text.slice(last.range.end))
  if (!trailing) return { start: last.range.end, end: last.range.end, content: `;${gap}${written}` }
  const at = last.range.end + trailing[0].length
  return { start: at, end: at, content: `${gap}${written};` }
}

/** Takes the separator after a declaration with it, or the one before it when it is the last. */
export function removeDeclarationSplice(text: string, declarations: readonly IndexedDeclaration[], declaration: IndexedDeclaration): Splice {
  const index = declarations.indexOf(declaration)
  const next = declarations[index + 1]
  if (next) return { start: declaration.range.start, end: next.range.start, content: '' }
  const previous = declarations[index - 1]
  if (previous) return { start: previous.range.end, end: declaration.range.end, content: '' }
  const trailing = /^\s*;/.exec(text.slice(declaration.range.end))?.[0] ?? ''
  return { start: declaration.range.start, end: declaration.range.end + trailing.length, content: '' }
}

interface TextUnit {
  readonly raw: SourceRange
  readonly decoded: string
}

const CHARACTER_REFERENCE = /&(?:#\d+;?|#x[0-9a-f]+;?|[a-z][a-z0-9]*;?)/iy

function decodeReference(reference: string): string {
  const [node] = parseFragment(reference).childNodes
  return node && 'value' in node ? node.value : reference
}

/** The source text split into single characters and whole character references, each with what it spells. */
function textUnits(text: string, range: SourceRange): TextUnit[] {
  const units: TextUnit[] = []
  let at = range.start
  while (at < range.end) {
    CHARACTER_REFERENCE.lastIndex = at
    const reference = CHARACTER_REFERENCE.exec(text)?.[0]
    const end = Math.min(range.end, at + (reference?.length ?? 1))
    const raw = text.slice(at, end)
    units.push({ raw: { start: at, end }, decoded: reference ? decodeReference(raw) : raw })
    at = end
  }
  return units
}

function encodeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\u00a0/g, '&nbsp;')
}

/** Splices only the span that differs from the source text node, so untouched entity spellings stay byte-identical. */
export function setTextSplice(text: string, node: TextNode, next: string): Splice {
  const location = node.sourceCodeLocation!
  const units = textUnits(text, { start: location.startOffset, end: location.endOffset })
  let head = 0
  let nextStart = 0
  while (head < units.length && next.startsWith(units[head]!.decoded, nextStart)) nextStart += units[head++]!.decoded.length
  let tail = units.length
  let nextEnd = next.length
  while (tail > head && nextEnd - units[tail - 1]!.decoded.length >= nextStart && next.endsWith(units[tail - 1]!.decoded, nextEnd)) {
    nextEnd -= units[--tail]!.decoded.length
  }
  const start = units[head]?.raw.start ?? location.endOffset
  const end = tail > head ? units[tail - 1]!.raw.end : start
  return { start, end, content: encodeText(next.slice(nextStart, nextEnd)) }
}
