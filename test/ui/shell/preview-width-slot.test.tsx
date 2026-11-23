// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardIndex, BoardView, EditorState } from '../../../src/shared/protocol'
import type { EdId, ProjectPath } from '../../../src/shared/types'
import { createActionRegistry } from '../../../src/ui/actions/registry'
import type { EditorContext, ShellSlot } from '../../../src/ui/plugin-api'
import { slots } from '../../../src/ui/shell/preview-width.slot'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const HOME = 'project/home.dc.html' as ProjectPath
const CARD = 'project/card.dc.html' as ProjectPath
const CARD_VIEW: BoardView = { zoom: 0.25, panX: 5, panY: 6, selection: [], previewWidth: 768 }
const BANNER = 'Edits apply to all widths'

function stateWith(homeView: Partial<BoardView> = {}): EditorState {
  return {
    hidden: [],
    locked: [],
    collapsed: [],
    boards: { [HOME]: { zoom: 0.5, panX: 10, panY: 20, selection: ['a' as EdId], ...homeView }, [CARD]: CARD_VIEW },
  }
}

function fakeContext(initial: EditorState) {
  let state = initial
  const listeners = new Set<() => void>()
  const spies = {
    editorState: vi.fn(() => state),
    setEditorState: vi.fn((patch: Partial<EditorState>) => {
      state = { ...state, ...patch }
      listeners.forEach((listener) => listener())
    }),
    index: vi.fn(() => ({ board: HOME }) as BoardIndex),
    selection: vi.fn(() => ({ board: HOME, edIds: ['a' as EdId] })),
    viewport: vi.fn(() => ({ zoom: 0.5, panX: 10, panY: 20 })),
    apply: vi.fn(),
    readOnly: vi.fn(() => false),
    toast: vi.fn(),
    onChange: vi.fn(() => () => {}),
  }
  const ctx = spies as typeof spies & EditorContext
  return Object.assign(ctx, {
    /** App hands its slots a new context whenever the editor state changes. */
    watchEditorState: (listener: () => void) => listeners.add(listener),
  })
}

type Context = ReturnType<typeof fakeContext>

let mounted: { root: Root; container: HTMLElement } | null = null

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted
    act(() => root.unmount())
    container.remove()
    mounted = null
  }
})

const registry = createActionRegistry({}, 'mac')

function slotsAt(place: ShellSlot['place']): readonly ShellSlot[] {
  return slots.filter((slot: ShellSlot) => slot.place === place)
}

/** Mounts the module's slots for `place`, re-rendering them with a fresh context object on every editor-state change, as App does. */
function mount(ctx: Context, place: ShellSlot['place']): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = () => {
    const current: EditorContext = { ...ctx }
    root.render(
      <>
        {slotsAt(place).map(({ id, component: Slot }) => (
          <Slot key={id} ctx={current} registry={registry} platform="mac" probe={null} />
        ))}
      </>,
    )
  }
  act(render)
  ctx.watchEditorState(render)
  mounted = { root, container }
  return container
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function controlButton(container: HTMLElement): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>('button[aria-label="Preview width"]')
  if (!found) throw new Error('no Preview width button in the top bar')
  return found
}

function openMenu(container: HTMLElement): HTMLElement {
  const existing = container.querySelector<HTMLElement>('[role="menu"][aria-label="Preview width"]')
  if (existing) return existing
  click(controlButton(container))
  const opened = container.querySelector<HTMLElement>('[role="menu"][aria-label="Preview width"]')
  if (!opened) throw new Error('the Preview width menu did not open')
  return opened
}

function preset(menu: HTMLElement, width: number): HTMLElement {
  const found = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim().startsWith(String(width)))
  if (!found) throw new Error(`no ${width} preset`)
  return found
}

function customField(menu: HTMLElement): HTMLInputElement {
  const found = menu.querySelector<HTMLInputElement>('input[aria-label="Custom width"]')
  if (!found) throw new Error('no Custom width field')
  return found
}

function typeAndEnter(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    input.focus()
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
  })
}

function lastPatch(ctx: Context): Partial<EditorState> {
  const patch = ctx.setEditorState.mock.calls.at(-1)?.[0]
  if (!patch) throw new Error('setEditorState was never called')
  return patch
}

function homeViewIn(patch: Partial<EditorState>): BoardView {
  const view = patch.boards?.[HOME]
  if (!view) throw new Error(`the patch has no view for ${HOME}`)
  return view
}

function expectViewKept(view: BoardView) {
  expect(view).toEqual(expect.objectContaining({ zoom: expect.any(Number), panX: expect.any(Number), panY: expect.any(Number), selection: expect.any(Array) }))
}

describe('the preview width control', () => {
  it('lives in the top bar', () => {
    expect(slotsAt('top-bar').length).toBeGreaterThan(0)
  })

  it.each([375, 768, 1280, 1440])('the %d preset sets that preview width for the open board only', (width) => {
    const ctx = fakeContext(stateWith())
    const container = mount(ctx, 'top-bar')

    click(preset(openMenu(container), width))

    expect(ctx.setEditorState).toHaveBeenCalledTimes(1)
    const patch = lastPatch(ctx)
    expect(homeViewIn(patch).previewWidth).toBe(width)
    expectViewKept(homeViewIn(patch))
    expect(patch.boards?.[CARD]).toEqual(CARD_VIEW)
  })

  it('a custom width typed in the field sets the preview width', () => {
    const ctx = fakeContext(stateWith())
    const container = mount(ctx, 'top-bar')

    typeAndEnter(customField(openMenu(container)), '900')

    expect(homeViewIn(lastPatch(ctx)).previewWidth).toBe(900)
    expect(lastPatch(ctx).boards?.[CARD]).toEqual(CARD_VIEW)
  })

  it('clearing the custom field clears the preview width and keeps the view', () => {
    const ctx = fakeContext(stateWith({ previewWidth: 375 }))
    const container = mount(ctx, 'top-bar')

    typeAndEnter(customField(openMenu(container)), '')

    const view = homeViewIn(lastPatch(ctx))
    expect(view.previewWidth).toBeUndefined()
    expectViewKept(view)
    expect(lastPatch(ctx).boards?.[CARD]).toEqual(CARD_VIEW)
  })

  it('never writes the source', () => {
    const ctx = fakeContext(stateWith())
    const container = mount(ctx, 'top-bar')

    click(preset(openMenu(container), 375))
    typeAndEnter(customField(openMenu(container)), '')

    expect(ctx.apply).not.toHaveBeenCalled()
  })
})

describe('the all-widths bar', () => {
  it('reads "Edits apply to all widths" while the open board has a preview width', () => {
    const container = mount(fakeContext(stateWith({ previewWidth: 375 })), 'overlay')

    expect(container.textContent).toContain(BANNER)
  })

  it('is absent while the open board shows its own width, even when another board has a preview width', () => {
    const container = mount(fakeContext(stateWith()), 'overlay')

    expect(container.textContent).not.toContain(BANNER)
  })

  it('appears when a preview width is set and goes when it is cleared', () => {
    const ctx = fakeContext(stateWith())
    const bar = mount(ctx, 'overlay')
    expect(bar.textContent).not.toContain(BANNER)

    act(() => ctx.setEditorState({ boards: { ...ctx.editorState().boards, [HOME]: { ...stateWith().boards[HOME]!, previewWidth: 375 } } }))
    expect(bar.textContent).toContain(BANNER)

    act(() => ctx.setEditorState({ boards: { ...ctx.editorState().boards, [HOME]: stateWith().boards[HOME]! } }))
    expect(bar.textContent).not.toContain(BANNER)
  })
})
