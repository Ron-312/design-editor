import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import type { EdId, InlineDeclaration, SourceRange } from '../../shared/types'
import type { Eol } from '../source/bytes'
import { parsesAsOneDeclaration, type IndexedDeclaration } from '../source/style-index'

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

const HTML_ATTRIBUTE_NAME = /^[^\s"'<>/=\p{Cc}]+$/u

/** Deletes the attribute with the whitespace before it, so removing what `setAttrSplice` added restores the bytes. */
export function removeAttrSplice(text: string, attr: SourceRange): Splice {
  let start = attr.start
  while (/\s/.test(text[start - 1] ?? '')) start -= 1
  return { start, end: attr.end, content: '' }
}

export function setAttrSplice(text: string, startTag: SourceRange, attr: SourceRange | undefined, name: string, value: string): Splice {
  if (!HTML_ATTRIBUTE_NAME.test(name)) refuse(`${JSON.stringify(name)} is not an attribute name`)
  if (!attr) {
    const at = attrInsertionPoint(text, startTag)
    return { start: at, end: at, content: ` ${name}="${escapeAttr(value, '"')}"` }
  }
  const current = attrValueOf(text, attr)
  if (!current) return { start: attr.end, end: attr.end, content: `="${escapeAttr(value, '"')}"` }
  const content = current.quote === '' ? `"${escapeAttr(value, '"')}"` : escapeAttr(value, current.quote)
  return { start: current.range.start, end: current.range.end, content }
}

const CSS_PROPERTY_NAME = /^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/i

export function requireCssPropertyName(prop: string): void {
  if (!CSS_PROPERTY_NAME.test(prop)) refuse(`${JSON.stringify(prop)} is not a CSS property name`)
}

export function requireSingleDeclaration(prop: string, value: string): void {
  if (!parsesAsOneDeclaration(prop, value)) refuse(`${JSON.stringify(value)} is not a single ${prop} value; edit in source`)
}

/** The value as it can sit inside a style attribute: CSS strings take the other quote, and no character reference may appear, since the style index reads the raw attribute. */
export function inlineStyleValue(value: string, quote: Quote): string {
  const attrQuote = quote || '"'
  const otherQuote = attrQuote === '"' ? "'" : '"'
  const written = value.includes(otherQuote) ? value : value.replaceAll(attrQuote, otherQuote)
  if (written.includes(attrQuote) || written.includes('&')) refuse('this value has characters a style attribute cannot hold; edit in source')
  return written
}

/** ` style="…"` holding the declarations, for a new start tag; empty when there are none. */
export function newStyleAttr(declarations: readonly InlineDeclaration[]): string {
  if (declarations.length === 0) return ''
  const written = declarations.map(({ prop, value }) => {
    requireCssPropertyName(prop)
    requireSingleDeclaration(prop, value)
    return `${prop}: ${inlineStyleValue(value, '"')}`
  })
  return ` style="${written.join('; ')}"`
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

export interface NewDeclaration {
  readonly prop: string
  readonly value: string
  readonly important?: boolean
}

function writtenDeclaration(declaration: NewDeclaration, colon: string): string {
  return `${declaration.prop}${colon}${declaration.value}${declaration.important ? ' !important' : ''}`
}

const NO_DECLARATIONS = 'there are no declarations here to add to; edit in source'

/** Appends after the last declaration, keeping a trailing `;` last; `emptyAt` is where an empty list starts. */
export function appendDeclarationSplice(
  text: string,
  declarations: readonly IndexedDeclaration[],
  emptyAt: number | null,
  declaration: NewDeclaration,
): Splice {
  const last = declarations.at(-1)
  const { gap, colon } = separatorsOf(text, declarations)
  const written = writtenDeclaration(declaration, colon)
  if (!last) {
    if (emptyAt === null) refuse(NO_DECLARATIONS)
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

export interface DeclarationListEdits {
  readonly removed: ReadonlySet<IndexedDeclaration>
  readonly replaced: ReadonlyMap<IndexedDeclaration, { readonly value: string; readonly important: boolean | undefined }>
  readonly appended: readonly NewDeclaration[]
}

function editedDeclaration(text: string, declaration: IndexedDeclaration, edits: DeclarationListEdits): string {
  const replacement = edits.replaced.get(declaration)
  const raw = text.slice(declaration.range.start, declaration.range.end)
  if (!replacement) return raw
  const value = replaceValueSplice(text, declaration, replacement.value, replacement.important)
  const at = declaration.range.start
  return raw.slice(0, value.start - at) + value.content + raw.slice(value.end - at)
}

/**
 * Several edits of one declaration list as one splice from the first changed declaration to the last, so they cannot overlap.
 * Untouched declarations keep their bytes, joins use the list's own separators, and a trailing `;` stays unless the list ends empty.
 */
export function rewriteDeclarationsSplice(
  text: string,
  declarations: readonly IndexedDeclaration[],
  emptyAt: number | null,
  edits: DeclarationListEdits,
): Splice {
  const { gap, colon } = separatorsOf(text, declarations)
  const separator = `;${gap}`
  const appended = edits.appended.map((declaration) => writtenDeclaration(declaration, colon))
  if (declarations.length === 0) {
    if (emptyAt === null) refuse(NO_DECLARATIONS)
    return { start: emptyAt, end: emptyAt, content: appended.join(separator) }
  }
  const touched = declarations.flatMap((declaration, index) => (edits.removed.has(declaration) || edits.replaced.has(declaration) ? [index] : []))
  const first = touched[0] ?? declarations.length
  const last = appended.length > 0 ? declarations.length - 1 : touched.at(-1)!
  const written = [
    ...declarations.slice(first, last + 1).filter((declaration) => !edits.removed.has(declaration)).map((declaration) => editedDeclaration(text, declaration, edits)),
    ...appended,
  ]
  const lastEnd = declarations[last]!.range.end
  if (first > 0) return { start: declarations[first - 1]!.range.end, end: lastEnd, content: written.map((item) => separator + item).join('') }
  const following = declarations[last + 1]
  if (following) return { start: declarations[0]!.range.start, end: following.range.start, content: written.map((item) => item + separator).join('') }
  const trailing = written.length === 0 ? (/^\s*;/.exec(text.slice(lastEnd))?.[0].length ?? 0) : 0
  return { start: declarations[0]!.range.start, end: lastEnd + trailing, content: written.join(separator) }
}

interface TextUnit {
  readonly raw: SourceRange
  readonly decoded: string
}

const CHARACTER_REFERENCE = /&(?:#\d+;?|#x[0-9a-f]+;?|[a-z][a-z0-9]*;?)/iy
const LINE_BREAK = /\r\n?/y

function decodeReference(reference: string): string {
  const [node] = parseFragment(reference).childNodes
  return node && 'value' in node ? node.value : reference
}

function unitAt(text: string, at: number, end: number): TextUnit {
  LINE_BREAK.lastIndex = at
  const lineBreak = LINE_BREAK.exec(text)?.[0]
  if (lineBreak) return { raw: { start: at, end: Math.min(end, at + lineBreak.length) }, decoded: '\n' }
  CHARACTER_REFERENCE.lastIndex = at
  const reference = CHARACTER_REFERENCE.exec(text)?.[0]
  const unitEnd = Math.min(end, at + (reference?.length ?? 1))
  const raw = text.slice(at, unitEnd)
  return { raw: { start: at, end: unitEnd }, decoded: reference ? decodeReference(raw) : raw }
}

/** The source text split into single characters, line breaks and whole character references, each with what it spells as parse5 reads it. */
function textUnits(text: string, range: SourceRange): TextUnit[] {
  const units: TextUnit[] = []
  for (let at = range.start; at < range.end; ) {
    const unit = unitAt(text, at, range.end)
    units.push(unit)
    at = unit.raw.end
  }
  return units
}

function encodeText(text: string, eol: Eol): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\u00a0/g, '&nbsp;').replace(/\r\n?|\n/g, eol)
}

/** Splices only the span that differs from the source text node, so untouched entity spellings and line breaks stay byte-identical; null when nothing differs. */
export function setTextSplice(text: string, node: TextNode, next: string, eol: Eol): Splice | null {
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
  if (head === tail && nextStart === nextEnd) return null
  const start = units[head]?.raw.start ?? location.endOffset
  const end = tail > head ? units[tail - 1]!.raw.end : start
  return { start, end, content: encodeText(next.slice(nextStart, nextEnd), eol) }
}
