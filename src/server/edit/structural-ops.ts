import type { DefaultTreeAdapterTypes } from 'parse5'
import selectorParser from 'postcss-selector-parser'
import { isVoidElement, nestingViolation } from '../../shared/content-model'
import type { EdId, OpOf, SourceRange } from '../../shared/types'
import type { Eol } from '../source/bytes'
import { attrValue, elementChildren } from '../source/template-tree'
import { pastedFragment } from './insert-html'
import type { ParsedSource, Shape } from './shape-check'
import { newStyleAttr, refuse, type Splice } from './text-splice'

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode

export type StructuralKind = 'moveNode' | 'wrapNode' | 'unwrapNode' | 'duplicateNode' | 'deleteNode'
export const STRUCTURAL_KINDS: ReadonlySet<string> = new Set<StructuralKind>(['moveNode', 'wrapNode', 'unwrapNode', 'duplicateNode', 'deleteNode'])

export interface StructuralContext {
  readonly text: string
  readonly source: ParsedSource
  /** The intended tree; each op edits it in step with its splices for the shape check. */
  readonly shape: Shape
  readonly eol: Eol
  readonly mintId: () => EdId
  /** Selectors of the file's `<helmet><style>` rules. */
  readonly selectors: () => readonly string[]
}

export interface StructuralPlan {
  readonly splices: Splice[]
  readonly minted: EdId[]
  readonly warnings: string[]
}

const TAG_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

function rangeOf(element: Element): SourceRange {
  const location = element.sourceCodeLocation!
  return { start: location.startOffset, end: location.endOffset }
}

function lineStartOf(text: string, offset: number): number {
  let at = offset
  while (at > 0 && text[at - 1] !== '\n' && text[at - 1] !== '\r') at -= 1
  return at
}

/** The spaces and tabs before `offset` on its line, or null when anything else comes first. */
function indentBefore(text: string, offset: number): string | null {
  const indent = text.slice(lineStartOf(text, offset), offset)
  return /^[ \t]*$/.test(indent) ? indent : null
}

/** Just past the line ending that follows `offset` after only spaces and tabs, or null. */
function lineEndAfter(text: string, offset: number): number | null {
  const rest = /^[ \t]*(?:\r\n|\n|\r)/.exec(text.slice(offset))
  return rest ? offset + rest[0].length : null
}

/** The whole lines of a range that sits alone on them, so it moves with its indentation and line ending. */
function wholeLines(text: string, range: SourceRange): SourceRange | null {
  const end = lineEndAfter(text, range.end)
  if (indentBefore(text, range.start) === null || end === null) return null
  return { start: lineStartOf(text, range.start), end }
}

function removal(text: string, range: SourceRange): Splice {
  const lines = wholeLines(text, range) ?? range
  return { start: lines.start, end: lines.end, content: '' }
}

function refuseNesting(ancestors: readonly string[], tag: string): void {
  const violation = nestingViolation(ancestors, tag)
  if (violation) refuse(violation)
}

function refuseVoidParent(tag: string): void {
  if (isVoidElement(tag)) refuse(`a <${tag}> can't hold other layers`)
}

function detach(shape: Shape, id: EdId): void {
  const parent = shape.get(shape.get(id)!.parent!)!
  parent.children = parent.children.filter((child) => child !== id)
}

function attach(shape: Shape, id: EdId, parent: EdId, before: EdId | null): void {
  const node = shape.get(parent)!
  const at = before === null ? node.children.length : node.children.indexOf(before)
  node.children.splice(at, 0, id)
  shape.get(id)!.parent = parent
}

function forgetSubtree(shape: Shape, id: EdId): void {
  for (const child of shape.get(id)!.children) forgetSubtree(shape, child)
  shape.delete(id)
}

function carriedFrom(context: StructuralContext, element: Element, origin: number) {
  return context.source.subtree(element).map((node) => ({ id: context.source.idOf(node)!, at: rangeOf(node).start - origin }))
}

function moveNode(context: StructuralContext, target: EdId, { parent, before }: OpOf<'moveNode'>['payload']): StructuralPlan {
  const { text, source, shape } = context
  const element = source.element(target)
  const parentElement = source.element(parent)
  if (source.subtree(element).includes(parentElement)) refuse("a layer can't move into itself")
  if (before === target) refuse('the layer is already there')
  if (before !== null && shape.get(before)?.parent !== parent) refuse('the drop position is not inside that layer')
  refuseVoidParent(parentElement.tagName)
  refuseNesting([...source.ancestorTags(parentElement), parentElement.tagName], element.tagName)

  const parentLocation = parentElement.sourceCodeLocation!
  const point = before === null ? (parentLocation.endTag?.startOffset ?? parentLocation.endOffset) : rangeOf(source.element(before)).start
  const lines = wholeLines(text, rangeOf(element))
  const lineMove = lines !== null && indentBefore(text, point) !== null
  const from = lineMove ? lines : rangeOf(element)
  const at = lineMove ? lineStartOf(text, point) : point
  const warnings = positionalSelectorWarnings(context.selectors(), [
    element,
    ...elementChildren(element.parentNode!),
    ...elementChildren(parentElement),
  ])

  detach(shape, target)
  attach(shape, target, parent, before)
  return {
    splices: [
      { start: from.start, end: from.end, content: '' },
      { start: at, end: at, content: text.slice(from.start, from.end), carried: carriedFrom(context, element, from.start) },
    ],
    minted: [],
    warnings,
  }
}

function siblingRun(shape: Shape, targets: readonly EdId[]): { parent: EdId; run: EdId[] } {
  const parent = shape.get(targets[0]!)!.parent!
  if (targets.some((id) => shape.get(id)!.parent !== parent)) refuse('only layers with the same parent can be wrapped together')
  const siblings = shape.get(parent)!.children
  const indexes = targets.map((id) => siblings.indexOf(id)).sort((a, b) => a - b)
  if (indexes.at(-1)! - indexes[0]! !== indexes.length - 1) refuse('only neighbouring layers can be wrapped together')
  return { parent, run: indexes.map((index) => siblings[index]!) }
}

function wrapNode(context: StructuralContext, targets: readonly EdId[], { tag, style = [] }: OpOf<'wrapNode'>['payload']): StructuralPlan {
  const { text, source, shape, eol } = context
  if (!TAG_NAME.test(tag)) refuse(`<${tag}> is not a tag name`)
  refuseVoidParent(tag)
  const { parent, run } = siblingRun(shape, targets)
  const first = source.element(run[0]!)
  const last = source.element(run.at(-1)!)
  const ancestors = source.ancestorTags(first)
  for (const id of run) refuseNesting([...ancestors, tag], source.element(id).tagName)
  refuseNesting(ancestors, tag)

  const startTag = `<${tag}${newStyleAttr(style)}>`
  const wrapper = context.mintId()
  const indent = indentBefore(text, rangeOf(first).start)
  const lineEnd = lineEndAfter(text, rangeOf(last).end)
  const splices: Splice[] =
    indent !== null && lineEnd !== null
      ? [
          { start: lineStartOf(text, rangeOf(first).start), end: lineStartOf(text, rangeOf(first).start), content: `${indent}${startTag}${eol}`, carried: [{ id: wrapper, at: indent.length }] },
          { start: lineEnd, end: lineEnd, content: `${indent}</${tag}>${eol}` },
        ]
      : [
          { start: rangeOf(first).start, end: rangeOf(first).start, content: startTag, carried: [{ id: wrapper, at: 0 }] },
          { start: rangeOf(last).end, end: rangeOf(last).end, content: `</${tag}>` },
        ]

  const parentNode = shape.get(parent)!
  parentNode.children.splice(parentNode.children.indexOf(run[0]!), run.length, wrapper)
  shape.set(wrapper, { tag, parent, children: run })
  for (const id of run) shape.get(id)!.parent = wrapper
  return { splices, minted: [wrapper], warnings: [] }
}

function unwrapNode(context: StructuralContext, target: EdId): StructuralPlan {
  const { text, source, shape } = context
  const element = source.element(target)
  if (isVoidElement(element.tagName)) refuse(`a <${element.tagName}> has no layers to ungroup`)
  const ancestors = source.ancestorTags(element)
  for (const child of elementChildren(element)) refuseNesting(ancestors, child.tagName)

  const location = element.sourceCodeLocation!
  const startTag = { start: location.startTag!.startOffset, end: location.startTag!.endOffset }
  const splices = [removal(text, startTag)]
  if (location.endTag) splices.push(removal(text, { start: location.endTag.startOffset, end: location.endTag.endOffset }))

  const node = shape.get(target)!
  const parentNode = shape.get(node.parent!)!
  parentNode.children.splice(parentNode.children.indexOf(target), 1, ...node.children)
  for (const child of node.children) shape.get(child)!.parent = node.parent
  shape.delete(target)
  return { splices, minted: [], warnings: [] }
}

/** The element's source with every `id` attribute (and the whitespace before it) removed, and where each start tag lands in it. */
function copyWithoutIds(text: string, elements: readonly Element[]): { copy: string; offsetOf: (element: Element) => number } {
  const range = rangeOf(elements[0]!)
  const removed = elements.flatMap((element) => {
    const attr = element.sourceCodeLocation!.attrs?.['id']
    if (!attr) return []
    const leading = /[ \t\r\n]*$/.exec(text.slice(range.start, attr.startOffset))![0].length
    return [{ start: attr.startOffset - leading, end: attr.endOffset }]
  })
  let copy = ''
  let at = range.start
  for (const cut of removed) {
    copy += text.slice(at, cut.start)
    at = cut.end
  }
  copy += text.slice(at, range.end)
  const offsetOf = (element: Element) => {
    const start = rangeOf(element).start
    return start - range.start - removed.filter((cut) => cut.end <= start).reduce((sum, cut) => sum + cut.end - cut.start, 0)
  }
  return { copy, offsetOf }
}

function cloneInto(shape: Shape, id: EdId, parent: EdId, idOfCopy: (id: EdId) => EdId): EdId {
  const node = shape.get(id)!
  const copyId = idOfCopy(id)
  shape.set(copyId, { tag: node.tag, parent, children: [] })
  shape.get(copyId)!.children = node.children.map((child) => cloneInto(shape, child, copyId, idOfCopy))
  return copyId
}

function duplicateNode(context: StructuralContext, target: EdId): StructuralPlan {
  const { text, source, shape, eol } = context
  const element = source.element(target)
  const elements = source.subtree(element)
  const minted = elements.map(() => context.mintId())
  const copyIdOf = new Map(elements.map((node, index) => [source.idOf(node)!, minted[index]!]))
  const { copy, offsetOf } = copyWithoutIds(text, elements)
  const lines = wholeLines(text, rangeOf(element))
  const indent = lines ? indentBefore(text, rangeOf(element).start)! : ''
  const at = lines ? lines.end : rangeOf(element).end
  const carried = elements.map((node, index) => ({ id: minted[index]!, at: indent.length + offsetOf(node) }))

  const parent = shape.get(target)!.parent!
  const copyId = cloneInto(shape, target, parent, (id) => copyIdOf.get(id)!)
  const siblings = shape.get(parent)!.children
  siblings.splice(siblings.indexOf(target) + 1, 0, copyId)
  return { splices: [{ start: at, end: at, content: lines ? `${indent}${copy}${eol}` : copy, carried }], minted, warnings: [] }
}

/** Adds the pasted elements to the shape under `parent`, looking through the ones the parser made up, and returns the top-level ids. */
function attachPasted(shape: Shape, node: ParentNode, parent: EdId, ids: ReadonlyMap<Element, EdId>): EdId[] {
  return elementChildren(node).flatMap((child) => {
    const id = ids.get(child)
    if (!id) return attachPasted(shape, child, parent, ids)
    shape.set(id, { tag: child.tagName, parent, children: [] })
    shape.get(id)!.children = attachPasted(shape, child, id, ids)
    return [id]
  })
}

/** Splices the cleaned fragment before `before` (or the parent's end tag) on its own line when that sits alone, indented like it. */
export function planInsertHtml(context: StructuralContext, parent: EdId, { before, html }: OpOf<'insertHtml'>['payload']): StructuralPlan {
  const { text, source, shape, eol } = context
  const parentElement = source.element(parent)
  refuseVoidParent(parentElement.tagName)
  if (before !== null && shape.get(before)?.parent !== parent) refuse('the paste position is not inside that layer')
  const fragment = pastedFragment(html, parentElement, eol, () => `${context.mintId()}-`)
  const ids = new Map(fragment.elements.map((element) => [element, context.mintId()]))

  const parentLocation = parentElement.sourceCodeLocation!
  const point = before === null ? (parentLocation.endTag?.startOffset ?? parentLocation.endOffset) : rangeOf(source.element(before)).start
  const indent = indentBefore(text, point)
  const at = indent === null ? point : lineStartOf(text, point)
  const content = indent === null ? fragment.html : `${indent}${fragment.html}${eol}`
  const carried = [...ids].map(([element, id]) => ({ id, at: (indent?.length ?? 0) + element.sourceCodeLocation!.startOffset }))

  const pasted = attachPasted(shape, fragment.root, parent, ids)
  const siblings = shape.get(parent)!.children
  siblings.splice(before === null ? siblings.length : siblings.indexOf(before), 0, ...pasted)
  return { splices: [{ start: at, end: at, content, carried }], minted: [...ids.values()], warnings: [] }
}

function deleteNode(context: StructuralContext, target: EdId): StructuralPlan {
  const { text, source, shape } = context
  detach(shape, target)
  forgetSubtree(shape, target)
  return { splices: [removal(text, rangeOf(source.element(target)))], minted: [], warnings: [] }
}

function merged(plans: readonly StructuralPlan[]): StructuralPlan {
  return {
    splices: plans.flatMap((plan) => plan.splices),
    minted: plans.flatMap((plan) => plan.minted),
    warnings: plans.flatMap((plan) => plan.warnings),
  }
}

export function planStructuralOp(context: StructuralContext, op: OpOf<StructuralKind>): StructuralPlan {
  switch (op.kind) {
    case 'moveNode':
      return merged(op.target.map((id) => moveNode(context, id, op.payload)))
    case 'wrapNode':
      return wrapNode(context, op.target, op.payload)
    case 'unwrapNode':
      return merged(op.target.map((id) => unwrapNode(context, id)))
    case 'duplicateNode':
      return merged(op.target.map((id) => duplicateNode(context, id)))
    case 'deleteNode':
      return merged(op.target.map((id) => deleteNode(context, id)))
  }
}

const POSITIONAL_PSEUDOS = new Set([
  ':first-child', ':last-child', ':only-child', ':nth-child', ':nth-last-child',
  ':first-of-type', ':last-of-type', ':only-of-type', ':nth-of-type', ':nth-last-of-type',
])

interface Compound {
  tag: string | null
  ids: string[]
  classes: string[]
  positional: boolean
}

function emptyCompound(positional: boolean): Compound {
  return { tag: null, ids: [], classes: [], positional }
}

function isSiblingCombinator(node: selectorParser.Node): boolean {
  return selectorParser.isCombinator(node) && (node.value === '+' || node.value === '~')
}

/** The compound selectors of a selector list, each marked positional when a sibling-order pseudo-class or `+`/`~` touches it. */
function compoundsOf(selector: string): Compound[] {
  const compounds: Compound[] = []
  selectorParser().astSync(selector).each((complex) => {
    let current = emptyCompound(false)
    for (const node of complex.nodes) {
      if (selectorParser.isCombinator(node)) {
        current.positional ||= isSiblingCombinator(node)
        compounds.push(current)
        current = emptyCompound(isSiblingCombinator(node))
      } else if (selectorParser.isTag(node)) current.tag = node.value.toLowerCase()
      else if (selectorParser.isIdentifier(node)) current.ids.push(node.value)
      else if (selectorParser.isClassName(node)) current.classes.push(node.value)
      else if (selectorParser.isPseudoClass(node)) current.positional ||= POSITIONAL_PSEUDOS.has(node.value.toLowerCase())
    }
    compounds.push(current)
  })
  return compounds
}

function canMatch(compound: Compound, element: Element): boolean {
  const classes = (attrValue(element, 'class') ?? '').split(/\s+/)
  return (
    (compound.tag === null || compound.tag === element.tagName) &&
    compound.ids.every((id) => attrValue(element, 'id') === id) &&
    compound.classes.every((name) => classes.includes(name))
  )
}

/** One warning naming the sibling-order selectors that may match differently once the nodes' siblings change. */
function positionalSelectorWarnings(selectors: readonly string[], affected: readonly Element[]): string[] {
  const shifted = selectors.filter((selector) =>
    compoundsOf(selector).some((compound) => compound.positional && affected.some((element) => canMatch(compound, element))),
  )
  return shifted.length > 0 ? [`this move can change which selectors match: ${[...new Set(shifted)].join(', ')}`] : []
}
