import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { EdId } from '../../shared/types'
import type { IndexedFile, SourceIndex } from '../source/source-index'
import { elementChildren } from '../source/template-tree'

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode

export interface Reconciled {
  readonly indexed: IndexedFile
  /** Old id of a node that no longer matches -> the fresh id of the node now at its element path, for selection restore. */
  readonly restoreByPath: ReadonlyMap<EdId, EdId>
}

function parseLocated(text: string): ParentNode {
  return parse(text, { sourceCodeLocationInfo: true })
}

/** Longest common subsequence of the two child lists by tag name, as index pairs in order. */
function matchingChildren(olds: readonly Element[], news: readonly Element[]): Array<[number, number]> {
  const lengths = Array.from({ length: olds.length + 1 }, () => new Array<number>(news.length + 1).fill(0))
  for (let i = olds.length - 1; i >= 0; i--) {
    for (let j = news.length - 1; j >= 0; j--) {
      lengths[i]![j] = olds[i]!.tagName === news[j]!.tagName ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!)
    }
  }
  const pairs: Array<[number, number]> = []
  for (let i = 0, j = 0; i < olds.length && j < news.length; ) {
    if (olds[i]!.tagName === news[j]!.tagName) pairs.push([i++, j++])
    else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) i++
    else j++
  }
  return pairs
}

/**
 * Re-indexes text changed outside the editor: a node keeps its id when it still matches by tag under a
 * matching parent, wherever its offset moved; every other node gets a fresh id.
 */
export function reconcile(index: SourceIndex, previous: IndexedFile, text: string): Reconciled {
  const idAt = new Map([...previous.startOffsets()].map(([id, offset]) => [offset, id]))
  const idOf = (element: Element) => idAt.get(element.sourceCodeLocation?.startOffset ?? -1)
  const carried = new Map<EdId, number>()
  const replacedAt = new Map<EdId, number>()

  const matchChildren = (oldParent: ParentNode, newParent: ParentNode) => {
    const olds = elementChildren(oldParent)
    const news = elementChildren(newParent)
    const pairs = matchingChildren(olds, news)
    for (const [i, j] of pairs) {
      const id = idOf(olds[i]!)
      const start = news[j]!.sourceCodeLocation?.startOffset
      if (id && start !== undefined) carried.set(id, start)
      matchChildren(olds[i]!, news[j]!)
    }
    const matchedOld = new Set(pairs.map(([i]) => i))
    const matchedNew = new Set(pairs.map(([, j]) => j))
    olds.forEach((element, i) => {
      const id = idOf(element)
      const start = news[i]?.sourceCodeLocation?.startOffset
      if (id && start !== undefined && !matchedOld.has(i) && !matchedNew.has(i)) replacedAt.set(id, start)
    })
  }
  matchChildren(parseLocated(previous.text), parseLocated(text))

  const indexed = index.indexFile(previous.file, text, carried)
  const newIdAt = new Map([...indexed.startOffsets()].map(([id, offset]) => [offset, id]))
  const restoreByPath = new Map([...replacedAt].map(([oldId, offset]) => [oldId, newIdAt.get(offset)!]))
  return { indexed, restoreByPath }
}
