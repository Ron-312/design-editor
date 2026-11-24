import type { Rect } from '../../shared/protocol'
import type { EdId, TemplateNode } from '../../shared/types'

export interface ClickModifiers {
  /** Cmd on macOS, Ctrl on Windows: select the enclosing layer instead of the smallest one. */
  readonly mod?: boolean
  readonly shift?: boolean
}

/** A child a marquee can select, at its first rendered rect. */
export interface MarqueeCandidate {
  readonly edId: EdId
  readonly rect: Rect
}

const INLINE_LEVEL_DISPLAYS = ['inline', 'inline-block', 'contents']

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

/** An icon is one layer on the canvas; its paths are picked in the layers panel. */
function outermostSvg(tree: TemplateNode, path: readonly EdId[]): EdId | undefined {
  return path.find((edId) => findNode(tree, edId)?.tag === 'svg')
}

/** Moves a hit inside a locked layer out to the element that holds the locked layer, and one inside an icon out to the icon. */
export function selectableHit(tree: TemplateNode, hit: EdId | null, locked: readonly EdId[]): EdId | null {
  if (!hit) return null
  const path = pathTo(tree, hit)
  const outermostLocked = path.findIndex((edId) => locked.includes(edId))
  const reachable = outermostLocked < 0 ? path : path.slice(0, outermostLocked)
  if (path.length > 0 && reachable.length === 0) return null
  return outermostSvg(tree, reachable) ?? reachable.at(-1) ?? hit
}

/** One layer out from the selection when the hit is inside it, else from the hit; never the artboard root. */
function enclosingTarget(selection: readonly EdId[], path: readonly EdId[]): EdId | undefined {
  const selected = selection.length === 1 ? path.indexOf(selection[0]!) : -1
  const from = selected > 0 ? selected : path.length - 1
  return path[Math.max(1, from - 1)]
}

function clickTarget(tree: TemplateNode, selection: readonly EdId[], hit: EdId | null, mod: boolean): EdId | undefined {
  if (!hit || hit === tree.edId) return undefined
  const path = pathTo(tree, hit)
  return mod ? enclosingTarget(selection, path) : path.at(-1)
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

/** The artboard root always marquees; any other element only when a child of it lays out as a block. An icon is one layer. */
export function isMarqueeContainer(tree: TemplateNode, edId: EdId, childDisplays: readonly string[]): boolean {
  if (findNode(tree, edId)?.tag === 'svg') return false
  return edId === tree.edId || childDisplays.some((display) => !INLINE_LEVEL_DISPLAYS.includes(display))
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** The candidates `area` touches, replacing the selection at press, or added to it with Shift. */
export function marqueeSelection(
  selection: readonly EdId[],
  candidates: readonly MarqueeCandidate[],
  area: Rect,
  { shift = false }: ClickModifiers = {},
): EdId[] {
  const hit = candidates.filter((candidate) => intersects(candidate.rect, area)).map((candidate) => candidate.edId)
  return shift ? unique([...selection, ...hit]) : hit
}
