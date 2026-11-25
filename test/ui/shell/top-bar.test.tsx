// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasCommands } from '../../../src/ui/canvas/CanvasView'
import type { PushFailure, PushState } from '../../../src/shared/push'
import type { ProjectPath } from '../../../src/shared/types'
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

function typeInto(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    input.focus()
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function pressEnter(input: HTMLInputElement) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
  })
}

function zoomField(opened: HTMLElement): HTMLInputElement {
  const field = opened.querySelector('input')
  if (!field) throw new Error('the zoom menu has no field to type a percentage in')
  return field
}

describe('a typed zoom percentage', () => {
  it.each([
    ['150', 1.5],
    ['150%', 1.5],
    [' 75 % ', 0.75],
    ['12.5', 0.125],
  ] as const)('typing %j and Enter zooms the canvas to %d and closes the menu', (typed, zoom) => {
    const canvas = fakeCanvas()
    const container = mount(<ZoomMenu zoom={1} canvas={canvas} />)
    const field = zoomField(openZoomMenu(container))

    typeInto(field, typed)
    pressEnter(field)

    expect(canvas.current.zoomTo).toHaveBeenCalledExactlyOnceWith(zoom)
    expect(canvas.current.fitBoard).not.toHaveBeenCalled()
    expect(canvas.current.fitSelection).not.toHaveBeenCalled()
    expect(menu(container)).toBeNull()
  })

  it.each(['', 'abc', '0', '-50'])('ignores %j, which is not a zoom', (typed) => {
    const canvas = fakeCanvas()
    const container = mount(<ZoomMenu zoom={1} canvas={canvas} />)
    const field = zoomField(openZoomMenu(container))

    typeInto(field, typed)
    pressEnter(field)

    expect(canvas.current.zoomTo).not.toHaveBeenCalled()
  })

  it('does not zoom while the percentage is still being typed', () => {
    const canvas = fakeCanvas()
    const container = mount(<ZoomMenu zoom={1} canvas={canvas} />)
    const field = zoomField(openZoomMenu(container))

    typeInto(field, '3')
    typeInto(field, '30')

    expect(canvas.current.zoomTo).not.toHaveBeenCalled()
    expect(menu(container)).not.toBeNull()
  })
})

describe('the Push button', () => {
  const LINK = 'https://claude.ai/artifact/abc'
  const dialog = (container: HTMLElement) => container.querySelector('[role="dialog"][aria-label="Push"]')
  const idle: PushState = { canvas: LINK, step: null, outcome: null }
  const failed = (reason: PushFailure, files: string[] = []): PushState => ({ ...idle, outcome: { kind: 'failed', reason, message: 'The reason.', files: files as ProjectPath[] } })

  function mountPush(push: PushState, options: { pending?: number; locked?: boolean } = {}) {
    const onStart = vi.fn<(canvas?: string) => void>()
    const onCancel = vi.fn<() => void>()
    const container = mount(<PushButton pending={options.pending ?? 0} locked={options.locked ?? false} push={push} onStart={onStart} onCancel={onCancel} />)
    const show = (next: PushState) => act(() => mounted!.root.render(<PushButton pending={0} locked={next.step !== null} push={next} onStart={onStart} onCancel={onCancel} />))
    return { container, onStart, onCancel, show, text: () => dialog(container)?.textContent ?? '' }
  }

  it('pushes on one press and shows each step', () => {
    const { container, onStart, show, text } = mountPush(idle, { pending: 2 })
    expect(button(container, 'Push').querySelector('.cnt')?.getAttribute('aria-label')).toBe('2 changes')

    click(button(container, 'Push'))
    expect(onStart).toHaveBeenCalledExactlyOnceWith()

    show({ ...idle, step: 'sending' })
    expect(text()).toContain('Sending your edits')
    show({ ...idle, outcome: { kind: 'pushed', title: 'Test Site', sent: ['project/Main.dc.html' as ProjectPath], received: ['project/card.dc.html' as ProjectPath] } })
    expect(text()).toContain('Pushed to Test Site')
    expect(text()).toContain('Main.dc.html')
    expect(text()).toContain('Brought in from Claude Design: card.dc.html')
  })

  it('closes on a press outside it, without starting another push', () => {
    const { container, onStart } = mountPush(idle)
    click(button(container, 'Push'))

    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })

    expect(dialog(container)).toBeNull()
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('says when nothing had to be sent', () => {
    const { container, text } = mountPush({ ...idle, outcome: { kind: 'pushed', title: 'Test Site', sent: [], received: [] } })
    click(button(container, 'Push'))

    expect(text()).toContain('Test Site already has everything here')
  })

  it('never starts a second push while one runs, whoever runs it', () => {
    const own = mountPush({ ...idle, step: 'checking' }, { locked: true })
    click(button(own.container, 'Push'))
    expect(own.onStart).not.toHaveBeenCalled()
    act(() => mounted!.root.unmount())
    own.container.remove()

    const other = mountPush(idle, { locked: true })
    click(button(other.container, 'Push'))
    expect(other.onStart).not.toHaveBeenCalled()
    expect(other.text()).toContain('Another push is running')
  })

  it.each(['starting', 'checking', 'merging'] as const)('can be cancelled while %s', (step) => {
    const { container, onCancel } = mountPush({ ...idle, step })
    click(button(container, 'Push'))

    click(button(dialog(container)!, 'Cancel'))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it.each(['sending', 'confirming'] as const)('cannot be cancelled while %s', (step) => {
    const { container, text } = mountPush({ ...idle, step })
    click(button(container, 'Push'))

    expect(text()).not.toContain('Cancel')
  })

  it('says how to sign in, and tries again on request', () => {
    const { container, onStart, show, text } = mountPush(idle)
    click(button(container, 'Push'))
    show(failed('signedOut'))
    expect(text()).toContain('claude auth login')

    click(button(dialog(container)!, 'Try again'))

    expect(onStart).toHaveBeenCalledTimes(2)
  })

  it('names the files of a conflict and where to settle it', () => {
    const { container, show, text } = mountPush(idle)
    click(button(container, 'Push'))
    show(failed('conflict', ['project/Main.dc.html']))

    expect(text()).toContain('Changed on both sides')
    expect(text()).toContain('Main.dc.html')
    expect(text()).toContain('/design-push')
  })

  it('asks for the link of a project without one, and sends it with the push', () => {
    const { container, onStart, show } = mountPush({ ...idle, canvas: null })
    click(button(container, 'Push'))
    expect(onStart).not.toHaveBeenCalled()

    const field = container.querySelector<HTMLInputElement>('input[name="canvas"]')!
    typeInto(field, `  ${LINK} `)
    act(() => field.form!.requestSubmit())

    expect(onStart).toHaveBeenCalledExactlyOnceWith(LINK)

    show({ ...idle, canvas: null, step: 'starting' })
    show({ ...failed('signedOut'), canvas: null })
    expect(container.querySelector<HTMLInputElement>('input[name="canvas"]')!.value).toContain(LINK)
  })

  it('sends no empty link', () => {
    const { container, onStart } = mountPush({ ...idle, canvas: null })
    click(button(container, 'Push'))

    act(() => container.querySelector('form')!.requestSubmit())

    expect(onStart).not.toHaveBeenCalled()
  })
})
