import type { EdId, TemplateNode } from '../../shared/types'

export interface ClickModifiers {
  /** Cmd on macOS, Ctrl on Windows: select the deepest element. */
  readonly mod?: boolean
  readonly shift?: boolean
}

export function findNode(tree: TemplateNode, edId: EdId): TemplateNode | null {
  if (tree.edId === edId) return tree
  for (const child of tree.children) {
    const found = findNode(child, edId)
    if (found) return found
  }
  return null
}

/** Ids from the artboard root down to `edId`; empty when the tree does not hold it. */
function pathTo(tree: TemplateNode, edId: EdId): EdId[] {
  if (tree.edId === edId) return [edId]
  for (const child of tree.children) {
    const path = pathTo(child, edId)
    if (path.length > 0) return [tree.edId, ...path]
  }
  return []
}

export function parentOf(tree: TemplateNode, edId: EdId): EdId | null {
  const path = pathTo(tree, edId)
  return path.at(-2) ?? null
}

/** Moves a hit inside a locked layer out to the element that holds the locked layer. */
export function selectableHit(tree: TemplateNode, hit: EdId | null, locked: readonly EdId[]): EdId | null {
  if (!hit) return null
  const path = pathTo(tree, hit)
  const outermostLocked = path.findIndex((edId) => locked.includes(edId))
  if (outermostLocked < 0) return hit
  return path[outermostLocked - 1] ?? null
}

/** Clicks select within the parent of the selection, or at the top level when the hit is outside it. */
function scopedTarget(tree: TemplateNode, selection: readonly EdId[], path: readonly EdId[]): EdId | undefined {
  const scope = selection[0] ? parentOf(tree, selection[0]) : null
  const scopeDepth = scope ? path.indexOf(scope) : -1
  const insideScope = scopeDepth >= 0 && scopeDepth < path.length - 1
  return path[insideScope ? scopeDepth + 1 : 1]
}

function clickTarget(tree: TemplateNode, selection: readonly EdId[], hit: EdId | null, mod: boolean): EdId | undefined {
  if (!hit || hit === tree.edId) return undefined
  const path = pathTo(tree, hit)
  return mod ? path.at(-1) : scopedTarget(tree, selection, path)
}

export function clickSelection(
  tree: TemplateNode,
  selection: readonly EdId[],
  hit: EdId | null,
  { mod = false, shift = false }: ClickModifiers = {},
): EdId[] {
  const target = clickTarget(tree, selection, hit, mod)
  if (!target) return shift ? [...selection] : []
  if (!shift) return [target]
  return selection.includes(target) ? selection.filter((edId) => edId !== target) : [...selection, target]
}

/** One level below what a click would select, toward the hit. */
export function doubleClickSelection(tree: TemplateNode, selection: readonly EdId[], hit: EdId | null): EdId[] {
  const [target] = clickSelection(tree, selection, hit)
  if (!target || !hit) return []
  const path = pathTo(tree, hit)
  return [path[path.indexOf(target) + 1] ?? target]
}

function unique(edIds: readonly EdId[]): EdId[] {
  return [...new Set(edIds)]
}

export function childSelection(tree: TemplateNode, selection: readonly EdId[]): EdId[] {
  return unique(selection.map((edId) => findNode(tree, edId)?.children[0]?.edId ?? edId))
}

/** The artboard root is never selected, so a top-level element stays put. */
export function parentSelection(tree: TemplateNode, selection: readonly EdId[]): EdId[] {
  return unique(
    selection.map((edId) => {
      const parent = parentOf(tree, edId)
      return parent && parent !== tree.edId ? parent : edId
    }),
  )
}

export function siblingSelection(tree: TemplateNode, selection: readonly EdId[], step: 1 | -1): EdId[] {
  if (selection.length === 0) return tree.children[0] ? [tree.children[0].edId] : []
  return unique(
    selection.map((edId) => {
      const parent = parentOf(tree, edId)
      const siblings = (parent ? findNode(tree, parent) : null)?.children ?? []
      const index = siblings.findIndex((sibling) => sibling.edId === edId)
      return siblings[(index + step + siblings.length) % siblings.length]?.edId ?? edId
    }),
  )
}
