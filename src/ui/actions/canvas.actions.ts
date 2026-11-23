import type { EdId, TemplateNode } from '../../shared/types'
import { childSelection, parentSelection, siblingSelection } from '../canvas/selection'
import type { EditorAction, EditorContext } from '../plugin-api'

type SelectionStep = (tree: TemplateNode, selection: readonly EdId[]) => EdId[]

function selectWith(step: SelectionStep) {
  return (ctx: EditorContext) => {
    const index = ctx.index()
    if (index) ctx.select(step(index.tree, ctx.selection()?.edIds ?? []))
  }
}

const nextSibling: SelectionStep = (tree, selection) => siblingSelection(tree, selection, 1)
const previousSibling: SelectionStep = (tree, selection) => siblingSelection(tree, selection, -1)

/** Escape drops a drag in progress and keeps the selection; with no drag it clears the selection. */
function cancelOrDeselect(ctx: EditorContext): void {
  if (!ctx.cancelGesture()) ctx.select([])
}

export const actions: EditorAction[] = [
  { id: 'canvas.selectTool', label: 'Move tool', kbd: 'V', scope: 'canvas', run: (ctx) => ctx.setMode('select') },
  { id: 'canvas.handTool', label: 'Hand tool', kbd: 'H', scope: 'canvas', run: (ctx) => ctx.setMode('hand') },
  { id: 'canvas.selectChild', label: 'Select child', kbd: 'Enter', scope: 'canvas', run: selectWith(childSelection) },
  { id: 'canvas.selectParent', label: 'Select parent', kbd: 'Shift+Enter', scope: 'canvas', run: selectWith(parentSelection) },
  { id: 'canvas.selectNext', label: 'Select next sibling', kbd: 'Tab', scope: 'canvas', run: selectWith(nextSibling) },
  { id: 'canvas.selectPrevious', label: 'Select previous sibling', kbd: 'Shift+Tab', scope: 'canvas', run: selectWith(previousSibling) },
  { id: 'canvas.escape', label: 'Cancel or deselect', kbd: 'Escape', scope: 'canvas', run: cancelOrDeselect },
  { id: 'canvas.fitBoard', label: 'Zoom to fit', kbd: 'Shift+1', scope: 'canvas', run: (ctx) => ctx.fit('board') },
  { id: 'canvas.fitSelection', label: 'Zoom to selection', kbd: 'Shift+2', scope: 'canvas', run: (ctx) => ctx.fit('selection') },
]
