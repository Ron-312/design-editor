import type { EdId, TemplateNode } from '../../shared/types'
import type { EditorAction, EditorContext } from '../plugin-api'

/** An imported component's inside belongs to another file, so it never opens in this board's tree. */
export function isExpandable(node: TemplateNode): boolean {
  return node.kind !== 'dc-import' && node.children.length > 0
}

/** `node` and every layer inside it that has a disclosure arrow. */
export function expandableWithin(node: TemplateNode): EdId[] {
  const own = isExpandable(node) ? [node.edId] : []
  return [...own, ...node.children.flatMap(expandableWithin)]
}

function focusLayerSearch(): void {
  const search = globalThis.document?.querySelector<HTMLInputElement>('input[aria-label="Find layer"]')
  search?.focus()
  search?.select()
}

/** The artboard stays open, so its top-level layers remain in view. */
function collapseAll(ctx: EditorContext): void {
  const tree = ctx.index()?.tree
  if (!tree) return
  const layers = tree.children.flatMap(expandableWithin)
  ctx.setEditorState({ collapsed: [...new Set([...ctx.editorState().collapsed, ...layers])] })
}

export const actions: EditorAction[] = [
  // Fires from text fields too, or Mod-F from the search box itself would open the browser's Find bar.
  { id: 'layers.find', label: 'Find layer', kbd: 'Mod+F', inTextEntry: true, run: focusLayerSearch },
  { id: 'layers.collapseAll', label: 'Collapse all layers', kbd: 'Alt+L', run: collapseAll },
]
