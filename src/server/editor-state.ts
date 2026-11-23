import type { EditorState } from '../shared/protocol'
import type { EdId, ProjectPath, TemplateNode } from '../shared/types'

/** `<board>#<child index>/<child index>…` from the board's `<x-dc>` root, e.g. `project/home.dc.html#0/2`. */
export type ElementPath = string

type BoardView = EditorState['boards'][ProjectPath]

/** `.editor/state.json`: keyed by element path, since ids are per session and would not survive a restart. */
export interface StoredEditorState {
  readonly hidden: readonly ElementPath[]
  readonly locked: readonly ElementPath[]
  readonly collapsed: readonly ElementPath[]
  readonly boards: Readonly<Record<ProjectPath, Omit<BoardView, 'selection'> & { readonly selection: readonly ElementPath[] }>>
}

export const EMPTY_STORED_STATE: StoredEditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function mapKnown<From, To>(values: readonly From[], lookup: ReadonlyMap<From, To>): To[] {
  return values.flatMap((value) => {
    const found = lookup.get(value)
    return found === undefined ? [] : [found]
  })
}

/** The two-way map between this session's ids and the element paths of every board's layer rows. */
export class ElementPaths {
  private readonly pathOf = new Map<EdId, ElementPath>()
  private readonly idOf = new Map<ElementPath, EdId>()

  constructor(boards: Iterable<readonly [ProjectPath, TemplateNode | null | undefined]>) {
    for (const [board, tree] of boards) if (tree) this.visit(tree, `${board}#`)
  }

  toStored(state: EditorState): StoredEditorState {
    const boards = Object.entries(state.boards).map(([board, view]) => [board, { ...view, selection: mapKnown(view.selection, this.pathOf) }])
    return {
      hidden: mapKnown(state.hidden, this.pathOf),
      locked: mapKnown(state.locked, this.pathOf),
      collapsed: mapKnown(state.collapsed, this.pathOf),
      boards: Object.fromEntries(boards),
    }
  }

  toIds(stored: StoredEditorState): EditorState {
    const boards = Object.entries(stored.boards).map(([board, view]) => [board, { ...view, selection: mapKnown(view.selection, this.idOf) }])
    return {
      hidden: mapKnown(stored.hidden, this.idOf),
      locked: mapKnown(stored.locked, this.idOf),
      collapsed: mapKnown(stored.collapsed, this.idOf),
      boards: Object.fromEntries(boards),
    }
  }

  private visit(node: TemplateNode, path: ElementPath): void {
    this.pathOf.set(node.edId, path)
    this.idOf.set(path, node.edId)
    const prefix = path.endsWith('#') ? path : `${path}/`
    node.children.forEach((child, index) => this.visit(child, `${prefix}${index}`))
  }
}
