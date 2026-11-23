import { randomBytes } from 'node:crypto'
import MagicString from 'magic-string'
import type { EditorState } from '../../shared/protocol'
import { isEdId, type EdId, type ElementLocation } from '../../shared/types'
import type { IndexedFile } from '../source/source-index'

export interface ServeOptions extends Pick<EditorState, 'hidden' | 'locked'> {
  readonly probeScript: string
}

export interface ServedDocument {
  readonly html: string
  readonly nonce: string
}

const TAG_NAME = /^<([^\s/>]+)/
const LEADING_WHITESPACE = /\s+$/

interface LocatedElement {
  readonly id: EdId
  readonly location: ElementLocation
  readonly rawTagName: string
}

function locatedElements(indexed: IndexedFile): LocatedElement[] {
  return indexed.ids.map((id) => {
    const location = indexed.locate(id)!
    const rawTagName = TAG_NAME.exec(indexed.text.slice(location.startTag.start, location.startTag.end))![1]!
    return { id, location, rawTagName }
  })
}

function freshNonce(): string {
  return randomBytes(16).toString('base64url')
}

function stampId(output: MagicString, { id, location, rawTagName }: LocatedElement): void {
  output.appendLeft(location.startTag.start + 1 + rawTagName.length, ` data-ed-id="${id}"`)
}

function stripNonce(output: MagicString, text: string, { location }: LocatedElement): void {
  const nonce = location.attrs['nonce']
  if (!nonce) return
  const whitespace = LEADING_WHITESPACE.exec(text.slice(location.startTag.start, nonce.start))?.[0].length ?? 0
  output.remove(nonce.start - whitespace, nonce.end)
}

/** After `<head>`, or else before the first element the parser puts in the implied head or body. */
function probeOffset(text: string, elements: readonly LocatedElement[]): number {
  const head = elements.find((element) => element.rawTagName.toLowerCase() === 'head')
  if (head) return head.location.startTag.end
  const firstContent = elements.find((element) => element.rawTagName.toLowerCase() !== 'html')
  return firstContent?.location.element.start ?? text.length
}

function hideStyle(hidden: readonly EdId[]): string {
  const ids = hidden.filter(isEdId)
  if (ids.length === 0) return ''
  const selectors = ids.map((id) => `[data-ed-id="${id}"]`).join(',')
  return `<style>${selectors}{display:none!important}</style>`
}

/** Served bytes only: the file on disk never carries ids, the probe or the hide rule (R05). */
export function transformServedDocument(indexed: IndexedFile, options: ServeOptions): ServedDocument {
  const { text } = indexed
  const elements = locatedElements(indexed)
  const output = new MagicString(text)
  const nonce = freshNonce()
  for (const element of elements) {
    stripNonce(output, text, element)
    stampId(output, element)
  }
  output.appendLeft(probeOffset(text, elements), `<script nonce="${nonce}">${options.probeScript}</script>${hideStyle(options.hidden)}`)
  return { html: output.toString(), nonce }
}
