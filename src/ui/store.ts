import type { BoardIndex, EditorState } from '../shared/protocol'
import type { EdId, EditRecord, ProjectPath, TemplateNode } from '../shared/types'
import type { Toast, Viewport } from './plugin-api'

export interface ScrollPosition {
  readonly x: number
  readonly y: number
}

/** What the editor keeps per board, so switching boards and back restores it. */
export interface BoardView {
  readonly selection: readonly EdId[]
  readonly viewport: Viewport
  readonly scroll: ScrollPosition
}

export interface ShownToast extends Toast {
  readonly id: string
}

export interface Banner {
  readonly id: string
  readonly message: string
}

export interface EditorStoreState {
  readonly board: ProjectPath | null
  readonly index: BoardIndex | null
  readonly view: BoardView
  readonly hover: EdId | null
  readonly interact: boolean
  readonly records: readonly EditRecord[]
  readonly toasts: readonly ShownToast[]
  readonly banners: readonly Banner[]
  readonly readOnly: boolean
}

export type EditorStore = ReturnType<typeof createEditorStore>

const PUSH_BANNER: Banner = { id: 'push-lock', message: 'Push in progress: editing is paused until it finishes' }

const EMPTY_VIEW: BoardView = { selection: [], viewport: { zoom: 1, panX: 0, panY: 0 }, scroll: { x: 0, y: 0 } }

function parentsOf(tree: TemplateNode): Map<EdId, EdId> {
  const parents = new Map<EdId, EdId>()
  const visit = (node: TemplateNode) => {
    for (const child of node.children) {
      parents.set(child.edId, node.edId)
      visit(child)
    }
  }
  visit(tree)
  return parents
}

function withoutSelectedDescendants(edIds: readonly EdId[], tree: TemplateNode | undefined): EdId[] {
  const parents = tree ? parentsOf(tree) : new Map<EdId, EdId>()
  const selected = new Set(edIds)
  const hasSelectedAncestor = (edId: EdId) => {
    for (let parent = parents.get(edId); parent; parent = parents.get(parent)) {
      if (selected.has(parent)) return true
    }
    return false
  }
  return [...selected].filter((edId) => !hasSelectedAncestor(edId))
}

export function createEditorStore() {
  const views = new Map<ProjectPath, BoardView>()
  const indexes = new Map<ProjectPath, BoardIndex>()
  const listeners = new Set<() => void>()
  let nextToast = 1
  let state: EditorStoreState = {
    board: null,
    index: null,
    view: EMPTY_VIEW,
    hover: null,
    interact: false,
    records: [],
    toasts: [],
    banners: [],
    readOnly: false,
  }

  function update(patch: Partial<EditorStoreState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  function updateView(patch: Partial<BoardView>): void {
    const view = { ...state.view, ...patch }
    if (state.board) views.set(state.board, view)
    update({ view })
  }

  const bannersWithout = (id: string) => state.banners.filter((shown) => shown.id !== id)

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Zoom, pan and selection saved in `.editor/state.json`, for each board not yet viewed this session. */
    restoreBoardViews(boards: EditorState['boards']) {
      for (const [board, { zoom, panX, panY, selection }] of Object.entries(boards) as [ProjectPath, EditorState['boards'][ProjectPath]][]) {
        if (!views.has(board)) views.set(board, { selection, viewport: { zoom, panX, panY }, scroll: { x: 0, y: 0 } })
      }
    },
    setBoard(board: ProjectPath) {
      update({ board, index: indexes.get(board) ?? null, view: views.get(board) ?? EMPTY_VIEW, hover: null })
    },
    setIndex(index: BoardIndex) {
      indexes.set(index.board, index)
      if (index.board === state.board) update({ index })
    },
    select(edIds: readonly EdId[]) {
      updateView({ selection: withoutSelectedDescendants(edIds, state.index?.tree) })
    },
    /** An outside edit re-ids the nodes it replaced; each board's selection follows them by element path. */
    replaceIds(replaced: Readonly<Record<EdId, EdId>>) {
      const follow = (view: BoardView): BoardView => ({ ...view, selection: view.selection.map((edId) => replaced[edId] ?? edId) })
      for (const [board, view] of views) views.set(board, follow(view))
      update({ view: follow(state.view), hover: null })
    },
    setViewport(viewport: Viewport) {
      updateView({ viewport })
    },
    setScroll(scroll: ScrollPosition) {
      updateView({ scroll })
    },
    setHover(hover: EdId | null) {
      if (state.interact) return
      update({ hover })
    },
    /** Interact mode passes pointer events to the design, so hover and selection pause. */
    setInteract(interact: boolean) {
      update({ interact, hover: null })
    },
    addRecord(record: EditRecord) {
      update({ records: [...state.records, record] })
    },
    toast(toast: Toast): string {
      const id = `toast-${nextToast++}`
      update({ toasts: [...state.toasts, { ...toast, id }] })
      return id
    },
    dismissToast(id: string) {
      update({ toasts: state.toasts.filter((toast) => toast.id !== id) })
    },
    /** A banner replaces any banner shown with the same id. */
    showBanner(banner: Banner) {
      update({ banners: [...bannersWithout(banner.id), banner] })
    },
    hideBanner(id: string) {
      update({ banners: bannersWithout(id) })
    },
    setReadOnly(readOnly: boolean) {
      const banners = bannersWithout(PUSH_BANNER.id)
      update({ readOnly, banners: readOnly ? [...banners, PUSH_BANNER] : banners })
    },
  }
}
