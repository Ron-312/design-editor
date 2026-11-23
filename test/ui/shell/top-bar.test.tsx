// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasCommands } from '../../../src/ui/canvas/CanvasView'
import { PushButton, ZoomMenu } from '../../../src/ui/TopBar'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

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

function mount(element: ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(element))
  mounted = { root, container }
  return container
}

function fakeCanvas() {
  return { current: { fitBoard: vi.fn<() => void>(), fitSelection: vi.fn<() => void>(), zoomTo: vi.fn<(zoom: number) => void>() } }
}

function button(scope: ParentNode, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent ?? '').trim().startsWith(name))
  if (!found) throw new Error(`no button named ${name}`)
  return found
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function menu(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[role="menu"]')
}

function openZoomMenu(container: HTMLElement): HTMLElement {
  click(button(container, 'Zoom'))
  const opened = menu(container)
  if (!opened) throw new Error('the zoom menu did not open')
  return opened
}

describe('the zoom menu', () => {
  it.each([
    ['Zoom in', 'zoomTo', [1.5]],
    ['Zoom out', 'zoomTo', [0.375]],
    ['Zoom to fit', 'fitBoard', []],
    ['Zoom to selection', 'fitSelection', []],
    ['200%', 'zoomTo', [2]],
  ] as const)('%s calls %s on the canvas and closes the menu', (label, command, args) => {
    const canvas = fakeCanvas()
    const container = mount(<ZoomMenu zoom={0.75} canvas={canvas} />)

    click(button(openZoomMenu(container), label))

    expect(canvas.current[command]).toHaveBeenCalledExactlyOnceWith(...args)
    const others = (Object.keys(canvas.current) as (keyof CanvasCommands)[]).filter((name) => name !== command)
    for (const other of others) expect(canvas.current[other]).not.toHaveBeenCalled()
    expect(menu(container)).toBeNull()
  })

  it('shows the fit shortcuts next to their items', () => {
    const container = mount(<ZoomMenu zoom={1} canvas={fakeCanvas()} />)

    const opened = openZoomMenu(container)

    expect(button(opened, 'Zoom to fit').querySelector('kbd')?.textContent).toBe('⇧1')
    expect(button(opened, 'Zoom to selection').querySelector('kbd')?.textContent).toBe('⇧2')
  })

  it('only closes the menu when no canvas is mounted yet', () => {
    const container = mount(<ZoomMenu zoom={1} canvas={{ current: null }} />)

    expect(() => click(button(openZoomMenu(container), 'Zoom in'))).not.toThrow()
    expect(menu(container)).toBeNull()
  })

  it('closes on a press outside it and stays open on a press inside it', () => {
    const container = mount(<ZoomMenu zoom={1} canvas={fakeCanvas()} />)
    const opened = openZoomMenu(container)

    act(() => {
      opened.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(menu(container)).not.toBeNull()

    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(menu(container)).toBeNull()
    expect(button(container, 'Zoom').getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape and ignores other keys', () => {
    const container = mount(<ZoomMenu zoom={1} canvas={fakeCanvas()} />)
    openZoomMenu(container)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(menu(container)).not.toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(menu(container)).toBeNull()
  })

  it('stops listening for outside presses once closed', () => {
    const removed = vi.spyOn(document, 'removeEventListener')
    const container = mount(<ZoomMenu zoom={1} canvas={fakeCanvas()} />)
    openZoomMenu(container)

    click(button(container, 'Zoom'))

    expect(removed.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['pointerdown', 'keydown']))
    removed.mockRestore()
  })
})

describe('the Push popover', () => {
  const dialog = (container: HTMLElement) => container.querySelector('[role="dialog"][aria-label="Push"]')

  it('closes on a press outside it', () => {
    const container = mount(<PushButton pending={2} pushing={false} />)
    click(button(container, 'Push'))
    expect(dialog(container)?.textContent).toContain('2 changes waiting to push.')

    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })

    expect(dialog(container)).toBeNull()
  })

  it('says a push is running while one holds the lock, and names one change in the singular', () => {
    const running = mount(<PushButton pending={1} pushing />)
    click(button(running, 'Push'))

    expect(dialog(running)?.textContent).toContain('A push is running now')
    expect(button(running, 'Push').querySelector('.cnt')?.getAttribute('aria-label')).toBe('1 change')
  })
})
