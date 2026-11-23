import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { nestingViolation } from '../../shared/content-model'
import type { EdId } from '../../shared/types'
import { elementChildren } from '../source/template-tree'

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode

/** One element of the id'd tree; elements without an id (an implicit `<tbody>`) are looked through. */
export interface ShapeNode {
  readonly tag: string
  parent: EdId | null
  children: EdId[]
}

/** The tree a flush intends, by edId, in document order; structural ops edit it in step with their splices. */
export type Shape = Map<EdId, ShapeNode>

/** A parse5 tree whose located elements are bound to edIds by start offset. */
export class ParsedSource {
  private constructor(
    private readonly elementById: ReadonlyMap<EdId, Element>,
    private readonly idByElement: ReadonlyMap<Element, EdId>,
    readonly unbound: readonly Element[],
    private readonly root: ParentNode,
  ) {}

  static parse(text: string, offsets: ReadonlyMap<EdId, number>): ParsedSource {
    const idAt = new Map([...offsets].map(([id, offset]) => [offset, id]))
    const elementById = new Map<EdId, Element>()
    const idByElement = new Map<Element, EdId>()
    const unbound: Element[] = []
    const visit = (node: ParentNode) => {
      for (const element of elementChildren(node)) {
        const start = element.sourceCodeLocation?.startOffset
        const id = start === undefined ? undefined : idAt.get(start)
        if (id) {
          elementById.set(id, element)
          idByElement.set(element, id)
        } else if (start !== undefined) unbound.push(element)
        visit(element)
      }
    }
    const root = parse(text, { sourceCodeLocationInfo: true })
    visit(root)
    return new ParsedSource(elementById, idByElement, unbound, root)
  }

  element(id: EdId): Element {
    const element = this.elementById.get(id)
    if (!element) throw new Error(`no element for edId ${id}`)
    return element
  }

  idOf(element: Element): EdId | undefined {
    return this.idByElement.get(element)
  }

  /** Bound elements in document order. */
  elements(): IterableIterator<Element> {
    return this.elementById.values()
  }

  /** Tag names from the document down to the element's parent, implicit elements included. */
  ancestorTags(element: Element): string[] {
    const tags: string[] = []
    for (let node = element.parentNode; node && 'tagName' in node; node = node.parentNode) tags.unshift(node.tagName)
    return tags
  }

  /** Bound descendants, the element first, in document order. */
  subtree(element: Element): Element[] {
    return [element, ...elementChildren(element).flatMap((child) => this.subtree(child))].filter((node) => this.idByElement.has(node))
  }

  shape(): Shape {
    const shape: Shape = new Map()
    const boundChildren = (node: ParentNode): EdId[] =>
      elementChildren(node).flatMap((child) => {
        const id = this.idByElement.get(child)
        return id ? [id] : boundChildren(child)
      })
    const visit = (node: ParentNode, parent: EdId | null) => {
      for (const child of elementChildren(node)) {
        const id = this.idByElement.get(child)
        if (id) shape.set(id, { tag: child.tagName, parent, children: boundChildren(child) })
        visit(child, id ?? parent)
      }
    }
    visit(this.root, null)
    return shape
  }
}

function shapeAncestorTags(shape: Shape, id: EdId): string[] {
  const tags: string[] = []
  for (let parent = shape.get(id)!.parent; parent; parent = shape.get(parent)!.parent) tags.unshift(shape.get(parent)!.tag)
  return tags
}

function displacedReason(shape: Shape, id: EdId): string {
  const node = shape.get(id)!
  const parentTag = node.parent ? shape.get(node.parent)!.tag : 'document'
  return nestingViolation(shapeAncestorTags(shape, id), node.tag) ?? `the browser would move the <${node.tag}> out of the <${parentTag}>`
}

function sameIds(left: readonly EdId[], right: readonly EdId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** Why the re-parsed output is not the intended tree (parser fix-ups such as `<p>` auto-close), or null when it is. */
export function shapeMismatch(intended: Shape, reparsed: ParsedSource): string | null {
  const actual = reparsed.shape()
  for (const [id, node] of intended) {
    if (actual.get(id)?.parent !== node.parent) return displacedReason(intended, id)
  }
  for (const [id, node] of intended) {
    if (!sameIds(actual.get(id)!.children, node.children)) return `the browser would reorder what is inside the <${node.tag}>`
  }
  const [extra] = reparsed.unbound
  return extra ? `the browser would add an extra <${extra.tagName}>` : null
}
