import type { EdId, TemplateNode } from '../../shared/types'
import { findNode, parentOf } from '../canvas/selection'
import type { EditorAction, EditorContext } from '../plugin-api'

function selected(ctx: EditorContext): readonly EdId[] {
  return ctx.selection()?.edIds ?? []
}

/** The parent of the most recently selected element, or the artboard root when nothing is selected. */
function scopeOf(tree: TemplateNode, selection: readonly EdId[]): TemplateNode {
  const last = selection.at(-1)
  const parent = last && parentOf(tree, last)
  return (parent && findNode(tree, parent)) || tree
}

function selectableChildren(ctx: EditorContext): EdId[] {
  const { locked, hidden } = ctx.editorState()
  return scopeOf(ctx.index()!.tree, selected(ctx))
    .children.filter((child) => child.kind === 'element' && !locked.includes(child.edId) && !hidden.includes(child.edId))
    .map((child) => child.edId)
}

function selectAll(ctx: EditorContext): void {
  ctx.select(selectableChildren(ctx))
}

function invertSelection(ctx: EditorContext): void {
  const current = selected(ctx)
  ctx.select(selectableChildren(ctx).filter((edId) => !current.includes(edId)))
}

const hasBoard = (ctx: EditorContext) => ctx.index() !== null

export const actions: EditorAction[] = [
  { id: 'select.all', label: 'Select all', kbd: 'Mod+A', scope: ['canvas', 'layers'], run: selectAll, when: hasBoard },
  { id: 'select.invert', label: 'Invert selection', kbd: 'Mod+Shift+A', scope: ['canvas', 'layers'], run: invertSelection, when: hasBoard },
]
