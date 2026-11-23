import type { DefaultTreeAdapterTypes } from 'parse5'
import type { EdId, ReadOnlyReason, TemplateNode, TemplateNodeKind } from '../../shared/types'
import { hasHole } from './style-index'

type Element = DefaultTreeAdapterTypes.Element
type ChildNode = DefaultTreeAdapterTypes.ChildNode
type ParentNode = DefaultTreeAdapterTypes.ParentNode

export interface ElementFlags {
  readonly readOnly?: ReadOnlyReason
  /** Inside an `<sc-for>`: the edit shows on every repeat. */
  readonly inRepeat: boolean
  /** The children are one text node with no `{{hole}}`. */
  readonly textEditable: boolean
}

export const TEMPLATE_ROOT = 'x-dc'
const CONTROL_KINDS: ReadonlySet<TemplateNodeKind> = new Set(['sc-for', 'sc-if', 'dc-import'])
const RAW_TEXT_TAGS = new Set(['script', 'style'])

export function isElement(node: ChildNode): node is Element {
  return 'tagName' in node
}

export function elementChildren(node: ParentNode): Element[] {
  return node.childNodes.filter(isElement)
}

export function attrValue(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value
}

function kindOf(element: Element): TemplateNodeKind {
  const tag = element.tagName as TemplateNodeKind
  return CONTROL_KINDS.has(tag) ? tag : 'element'
}

function isTextEditable(element: Element): boolean {
  if (RAW_TEXT_TAGS.has(element.tagName)) return false
  const [only, ...rest] = element.childNodes
  return only !== undefined && rest.length === 0 && only.nodeName === '#text' && 'value' in only && !hasHole(only.value)
}

export interface ParentContext {
  readonly element: Element
  readonly flags: ElementFlags
}

export function flagsFor(element: Element, parent: ParentContext | undefined): ElementFlags {
  const insideImport = parent?.flags.readOnly === 'dc-import' || element.tagName === 'dc-import'
  return {
    ...(insideImport ? { readOnly: 'dc-import' as const } : {}),
    inRepeat: parent !== undefined && (parent.flags.inRepeat || parent.element.tagName === 'sc-for'),
    textEditable: !insideImport && isTextEditable(element),
  }
}

function isTemplateRow(element: Element): boolean {
  return element.tagName !== 'helmet' && !(element.tagName === 'script' && attrValue(element, 'data-dc-script') !== undefined)
}

/** Layer name: `data-layer-name` → id → first class → tag. */
function layerName(element: Element): string {
  const firstClass = attrValue(element, 'class')?.trim().split(/\s+/)[0]
  return attrValue(element, 'data-layer-name') || attrValue(element, 'id') || firstClass || element.tagName
}

type IdOf = (element: Element) => EdId | undefined

/** Implicit parse5 elements (an unwritten `<tbody>`) have no id, so their children rise to the parent row. */
function rowsUnder(element: Element, idOf: IdOf): TemplateNode[] {
  return elementChildren(element)
    .filter(isTemplateRow)
    .flatMap((child) => {
      const row = buildTemplateTree(child, idOf)
      return row ? [row] : rowsUnder(child, idOf)
    })
}

export function buildTemplateTree(element: Element, idOf: IdOf): TemplateNode | null {
  const edId = idOf(element)
  if (!edId) return null
  const kind = kindOf(element)
  return {
    edId,
    kind,
    tag: element.tagName,
    name: layerName(element),
    ...(kind === 'dc-import' ? { readOnly: 'dc-import' as const } : {}),
    children: kind === 'dc-import' ? [] : rowsUnder(element, idOf),
  }
}
