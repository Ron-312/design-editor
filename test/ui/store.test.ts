import { describe, expect, it, vi } from 'vitest'
import type { BoardIndex } from '../../src/shared/protocol'
import type { EdId, EditRecord, ProjectPath, TemplateNode } from '../../src/shared/types'
import { createEditorStore } from '../../src/ui/store'

const edId = (id: string) => id as EdId
const boardA = 'project/hero.dc.html' as ProjectPath
const boardB = 'project/pricing.dc.html' as ProjectPath

function node(id: string, children: TemplateNode[] = []): TemplateNode {
  return { edId: edId(id), kind: 'element', tag: 'div', name: id, children }
}

// root > card > (title, button > label), root > aside
const tree = node('root', [node('card', [node('title'), node('button', [node('label')])]), node('aside')])

function indexFor(board: ProjectPath): BoardIndex {
  return { board, frameSrc: `/project/secret/${board}`, tree, locations: {}, styles: {} }
}

function record(after: string): EditRecord {
  return {
    target: [edId('card')],
    kind: 'setDecl',
    prop: 'color',
    before: null,
    after,
    scope: { kind: 'element' },
    files: [boardA],
  }
}

function storeOnBoard(board: ProjectPath) {
  const store = createEditorStore()
  store.setBoard(board)
  store.setIndex(indexFor(board))
  return store
}

const bannerMessages = (store: ReturnType<typeof createEditorStore>) =>
  store.getState().banners.map((banner) => banner.message)

describe('per-board view', () => {
  it('keeps selection, zoom and scroll for each board across board switches', () => {
    const store = storeOnBoard(boardA)
    store.select([edId('title')])
    store.setViewport({ zoom: 2.5, panX: 120, panY: -40 })
    store.setScroll({ x: 0, y: 300 })

    store.setBoard(boardB)
    store.setIndex(indexFor(boardB))

    expect(store.getState().board).toBe(boardB)
    expect(store.getState().view.selection).toEqual([])
    expect(store.getState().view.viewport.zoom).not.toBe(2.5)
    expect(store.getState().view.scroll.y).not.toBe(300)

    store.select([edId('aside')])
    store.setBoard(boardA)

    expect(store.getState().view.selection).toEqual([edId('title')])
    expect(store.getState().view.viewport).toEqual({ zoom: 2.5, panX: 120, panY: -40 })
    expect(store.getState().view.scroll).toEqual({ x: 0, y: 300 })

    store.setBoard(boardB)

    expect(store.getState().view.selection).toEqual([edId('aside')])
  })
})

describe('multi-selection', () => {
  it('drops elements whose ancestors are also selected', () => {
    const store = storeOnBoard(boardA)

    store.select([edId('card'), edId('label'), edId('aside'), edId('title')])

    expect(store.getState().view.selection).toEqual([edId('card'), edId('aside')])
  })

  it('drops a descendant listed before its ancestor', () => {
    const store = storeOnBoard(boardA)

    store.select([edId('label'), edId('button')])

    expect(store.getState().view.selection).toEqual([edId('button')])
  })

  it('keeps siblings and cousins that do not contain each other', () => {
    const store = storeOnBoard(boardA)

    store.select([edId('title'), edId('label')])

    expect(store.getState().view.selection).toEqual([edId('title'), edId('label')])
  })
})

describe('hover and interact mode', () => {
  it('tracks the hovered element', () => {
    const store = storeOnBoard(boardA)

    store.setHover(edId('title'))
    expect(store.getState().hover).toBe(edId('title'))

    store.setHover(null)
    expect(store.getState().hover).toBeNull()
  })

  it('pauses hover while interact mode is on', () => {
    const store = storeOnBoard(boardA)
    store.setHover(edId('title'))

    store.setInteract(true)

    expect(store.getState().interact).toBe(true)
    expect(store.getState().hover).toBeNull()
    store.setHover(edId('label'))
    expect(store.getState().hover).toBeNull()

    store.setInteract(false)
    store.setHover(edId('label'))

    expect(store.getState().interact).toBe(false)
    expect(store.getState().hover).toBe(edId('label'))
  })
})

describe('edit records', () => {
  it('keeps edit records in the order they were added', () => {
    const store = storeOnBoard(boardA)
    const first = record('red')
    const second = record('blue')

    store.addRecord(first)
    store.addRecord(second)

    expect(store.getState().records).toEqual([first, second])
  })
})

describe('toasts and banners', () => {
  it('adds a toast and removes it when dismissed', () => {
    const store = storeOnBoard(boardA)

    const id = store.toast({ message: 'Saved', tone: 'info' })

    expect(store.getState().toasts).toEqual([expect.objectContaining({ id, message: 'Saved', tone: 'info' })])
    store.dismissToast(id)
    expect(store.getState().toasts).toEqual([])
  })

  it('shows one banner per id and hides it by id', () => {
    const store = storeOnBoard(boardA)

    store.showBanner({ id: 'fonts', message: 'offline: Inter not loaded' })
    store.showBanner({ id: 'fonts', message: 'offline: Inter and Lora not loaded' })

    expect(bannerMessages(store)).toEqual(['offline: Inter and Lora not loaded'])
    store.hideBanner('fonts')
    expect(store.getState().banners).toEqual([])
  })
})

describe('read-only', () => {
  it("shows the 'Push in progress' state while the push lock is held", () => {
    const store = storeOnBoard(boardA)
    expect(store.getState().readOnly).toBe(false)

    store.setReadOnly(true)

    expect(store.getState().readOnly).toBe(true)
    expect(bannerMessages(store)).toContainEqual(expect.stringMatching(/push in progress/i))

    store.setReadOnly(false)

    expect(store.getState().readOnly).toBe(false)
    expect(bannerMessages(store)).not.toContainEqual(expect.stringMatching(/push in progress/i))
  })
})

describe('subscriptions', () => {
  it('notifies subscribers with a fresh snapshot until they unsubscribe', () => {
    const store = storeOnBoard(boardA)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const before = store.getState()

    store.setHover(edId('title'))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getState()).not.toBe(before)
    expect(before.hover).toBeNull()

    unsubscribe()
    store.setHover(edId('label'))

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
