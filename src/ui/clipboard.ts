import { isVoidElement, nestingViolation } from '../shared/content-model'
import type { BoardIndex } from '../shared/protocol'
import type { EdId, ProjectPath, SourceRange, TemplateNode } from '../shared/types'
import type { AckMessage } from './plugin-api'

/** The editor's own copies; any page can write it, so the server checks it like any other paste. */
export const PRIVATE_HTML_TYPE = 'application/x-design-editor+html'

/** The elements a Mod-C put on the clipboard, so a paste can tell its own copy from anything else. */
export interface LastCopy {
  readonly board: ProjectPath
  readonly edIds: readonly EdId[]
  readonly html: string
}

/** Where an `insertHtml` goes: appended to `parent` when `before` is null. */
export interface PasteTarget {
  readonly parent: EdId
  readonly before: EdId | null
}

export function writeClipboardText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

function rangeOf(index: BoardIndex, edId: EdId): SourceRange | undefined {
  return index.locations[edId]?.element
}

function inDocumentOrder(index: BoardIndex, edIds: readonly EdId[]): EdId[] {
  return edIds.filter((edId) => rangeOf(index, edId)).sort((a, b) => rangeOf(index, a)!.start - rangeOf(index, b)!.start)
}

/** The elements exactly as the source writes them, so no `data-ed-id` and no rendered values. */
export function sourceHtmlOf(index: BoardIndex, edIds: readonly EdId[]): string {
  return inDocumentOrder(index, edIds)
    .map((edId) => {
      const { start, end } = rangeOf(index, edId)!
      return index.text.slice(start, end)
    })
    .join('\n')
}

/** Nodes from the artboard root down to `edId`; empty when the tree does not hold it. */
function pathTo(tree: TemplateNode, edId: EdId): TemplateNode[] {
  if (tree.edId === edId) return [tree]
  for (const child of tree.children) {
    const path = pathTo(child, edId)
    if (path.length > 0) return [tree, ...path]
  }
  return []
}

function fragmentElements(html: string): Element[] {
  const template = document.createElement('template')
  template.innerHTML = html
  return [...template.content.children]
}

function fitsUnder(ancestors: readonly string[], elements: readonly Element[]): boolean {
  return elements.every((element) => {
    const tag = element.localName
    return nestingViolation(ancestors, tag) === null && fitsUnder([...ancestors, tag], [...element.children])
  })
}

function canHold(path: readonly TemplateNode[], html: string): boolean {
  const holder = path.at(-1)!
  if (holder.kind !== 'element' || isVoidElement(holder.tag)) return false
  return fitsUnder(path.map((node) => node.tag), fragmentElements(html))
}

function after(tree: TemplateNode, edId: EdId): PasteTarget {
  const path = pathTo(tree, edId)
  const parent = path.at(-2)!
  const siblings = parent.children
  const next = siblings[siblings.findIndex((sibling) => sibling.edId === edId) + 1]
  return { parent: parent.edId, before: next?.edId ?? null }
}

function holdsTheCopy(index: BoardIndex, selection: readonly EdId[], html: string, lastCopy: LastCopy | null): boolean {
  if (!lastCopy || lastCopy.board !== index.board || lastCopy.html !== html) return false
  return lastCopy.edIds.some((copied) => pathTo(index.tree, copied).some((node) => selection.includes(node.edId)))
}

/**
 * After the selection when it is, or holds, what was copied; inside the one selected element when it can
 * hold the fragment; else after the last selected element; at the artboard root with nothing selected.
 */
export function pasteTarget(index: BoardIndex, selection: readonly EdId[], html: string, lastCopy: LastCopy | null): PasteTarget {
  const last = inDocumentOrder(index, selection).at(-1)
  if (last === undefined) return { parent: index.tree.edId, before: null }
  if (holdsTheCopy(index, selection, html, lastCopy)) return after(index.tree, last)
  if (selection.length === 1 && canHold(pathTo(index.tree, last), html)) return { parent: last, before: null }
  return after(index.tree, last)
}

function contains(outer: SourceRange, inner: SourceRange): boolean {
  return outer !== inner && outer.start <= inner.start && inner.end <= outer.end
}

/** The pasted elements whose parent is the paste target, not their descendants. */
export function pastedTopLevel(ack: AckMessage): EdId[] {
  const ranges = ack.mintedIds.map((edId) => ack.locations[edId]!.element)
  return ack.mintedIds.filter((_, at) => !ranges.some((range) => contains(range, ranges[at]!)))
}

function classesNamedByRules(index: BoardIndex): Set<string> {
  return new Set(index.rules.flatMap((rule) => [...rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]!)))
}

function classesIn(html: string): Set<string> {
  const elements = fragmentElements(html).flatMap((element) => [element, ...element.querySelectorAll('*')])
  return new Set(elements.flatMap((element) => [...element.classList]))
}

/** Helmet rules stay on their own board, so these pasted classes style nothing here. */
export function classesWithoutRule(index: BoardIndex, html: string): string[] {
  const named = classesNamedByRules(index)
  return [...classesIn(html)].filter((name) => !named.has(name))
}
