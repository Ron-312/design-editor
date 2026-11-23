// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceIndex } from '../../../src/server/source/source-index'
import type { BoardIndex, EditorState } from '../../../src/shared/protocol'
import type { EdId, ProjectPath, TemplateNode } from '../../../src/shared/types'
import { actions as paletteActions } from '../../../src/ui/actions/palette.actions'
import { createActionRegistry, type ActionRegistry, type Platform } from '../../../src/ui/actions/registry'
import type { EditorAction, EditorContext } from '../../../src/ui/plugin-api'
import { slots } from '../../../src/ui/shell/palette.slot'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

type Run = (context: EditorContext, actionId: string) => void

const board = 'project/pricing.dc.html' as ProjectPath

const PRICING_BOARD = `<!doctype html>
<html><body>
<x-dc>
  <section data-layer-name="Plans">
    <div class="card shadow-lg" data-layer-name="Pricing">
      <h2 data-layer-name="Heading">Team</h2>
      <button class="btn" data-layer-name="CTA">Start free trial</button>
    </div>
  </section>
  <p data-layer-name="Footnote">Prices exclude VAT</p>
</x-dc>
</body></html>
`

/** The index the server sends for `text`, built by the server's own SourceIndex. */
function boardIndexOf(text: string): BoardIndex {
  const indexed = new SourceIndex().indexFile(board, text)
  return {
    board,
    frameSrc: `/project/s/${board}`,
    tree: indexed.tree!,
    text: indexed.text,
    locations: Object.fromEntries(indexed.ids.map((id) => [id, indexed.locate(id)!])),
    styles: {},
    rules: indexed.rules,
  }
}

function layersOf(tree: TemplateNode): TemplateNode[] {
  return [tree, ...tree.children.flatMap(layersOf)]
}

function edIdNamed(tree: TemplateNode, name: string): EdId {
  const found = layersOf(tree).find((layer) => layer.name === name)
  if (!found) throw new Error(`no layer named ${name}`)
  return found.edId
}

const index = boardIndexOf(PRICING_BOARD)
const editorState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function fakeContext() {
  let minted = 0
  const spies = {
    index: vi.fn(() => index),
    selection: vi.fn(() => null),
    viewport: vi.fn(() => ({ zoom: 1, panX: 0, panY: 0 })),
    editorState: vi.fn(() => editorState),
    readOnly: vi.fn(() => false),
    select: vi.fn<(edIds: readonly EdId[]) => void>(),
    setViewport: vi.fn(),
    setMode: vi.fn(),
    fit: vi.fn(),
    cancelGesture: vi.fn(() => false),
    setEditorState: vi.fn(),
    beginAction: vi.fn(() => `minted-${++minted}`),
    apply: vi.fn(),
    preview: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    read: vi.fn(),
    records: vi.fn(() => []),
    toast: vi.fn(),
    onChange: vi.fn(() => () => {}),
  }
  return spies as typeof spies & EditorContext
}

function testAction(id: string, label: string, options: Partial<EditorAction> = {}) {
  const run = vi.fn<Run>()
  const entry: EditorAction = { id, label, run, ...options }
  return { entry, run }
}

let ctx = fakeContext()
let duplicate = testAction('layer.duplicate', 'Duplicate', { kbd: 'Mod+D' })
let wrap = testAction('layer.wrap', 'Wrap in container', { kbd: 'Mod+G' })
let frobnicate = testAction('test.frobnicate', 'Frobnicate the widget')
let bringToFront = testAction('arrange.toFront', 'Bring to front', { kbd: 'Mod+Alt+]' })
let lockAll = testAction('test.lockAll', 'Lock everything', { when: () => false, disabledReason: 'Nothing to lock' })
let registry: ActionRegistry
let mounted: { root: Root; container: HTMLElement; stopKeys: () => void } | null = null

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  ctx = fakeContext()
  duplicate = testAction('layer.duplicate', 'Duplicate', { kbd: 'Mod+D' })
  wrap = testAction('layer.wrap', 'Wrap in container', { kbd: 'Mod+G' })
  frobnicate = testAction('test.frobnicate', 'Frobnicate the widget')
  bringToFront = testAction('arrange.toFront', 'Bring to front', { kbd: 'Mod+Alt+]' })
  lockAll = testAction('test.lockAll', 'Lock everything', { when: () => false, disabledReason: 'Nothing to lock' })
})

afterEach(() => {
  if (mounted) {
    const { root, container, stopKeys } = mounted
    act(() => root.unmount())
    stopKeys()
    container.remove()
    mounted = null
  }
  document.body.innerHTML = ''
  Reflect.deleteProperty(navigator, 'keyboard')
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The editor shell as App renders it: the palette's slots, a canvas, a text field, and App's document keydown routing. */
function mountPalette(platform: Platform = 'mac') {
  registry = createActionRegistry(
    {
      './palette.actions.ts': { actions: paletteActions },
      './test.actions.ts': { actions: [duplicate.entry, wrap.entry, frobnicate.entry, bringToFront.entry, lockAll.entry] },
    },
    platform,
  )
  const container = document.createElement('div')
  container.innerHTML = `
    <main class="center"><div data-canvas-viewport="" tabindex="0" id="canvas"></div></main>
    <input id="width" aria-label="Width" />
  `
  const host = document.createElement('div')
  container.append(host)
  document.body.append(container)
  const onKeyDown = (event: KeyboardEvent) => registry.handleKeyDown(event, ctx)
  document.addEventListener('keydown', onKeyDown)
  const root = createRoot(host)
  act(() =>
    root.render(
      <>
        {slots.map(({ id, component: Slot }) => (
          <Slot key={id} ctx={ctx} registry={registry} platform={platform} probe={null} />
        ))}
      </>,
    ),
  )
  mounted = { root, container, stopKeys: () => document.removeEventListener('keydown', onKeyDown) }
  return { canvas: document.getElementById('canvas')!, field: document.getElementById('width') as HTMLInputElement }
}

function keydown(target: Element, init: KeyboardEventInit) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

const MOD_K: KeyboardEventInit = { key: 'k', code: 'KeyK', metaKey: true }

function palette(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-label="Command palette"]')
}

function openPalette(target: Element, init: KeyboardEventInit = MOD_K): HTMLElement {
  keydown(target, init)
  const opened = palette()
  if (!opened) throw new Error('the palette did not open')
  return opened
}

function searchBox(): HTMLInputElement {
  const input = palette()?.querySelector('input')
  if (!input) throw new Error('the palette has no search box')
  return input
}

function options(): HTMLElement[] {
  return [...(palette()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
}

function optionTexts(): string[] {
  return options().map((option) => option.textContent ?? '')
}

function optionFor(label: string): HTMLElement {
  const found = options().find((option) => option.textContent?.includes(label))
  if (!found) throw new Error(`no palette option for ${label}`)
  return found
}

async function typeQuery(query: string) {
  act(() => {
    const input = searchBox()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}

describe('opening and closing', () => {
  it('stays closed until Mod-K, then opens with its search box focused', () => {
    const { canvas } = mountPalette()
    expect(palette()).toBeNull()

    openPalette(canvas)

    expect(document.activeElement).toBe(searchBox())
  })

  it('opens on Mod-/ as well', () => {
    const { canvas } = mountPalette()

    openPalette(canvas, { key: '/', code: 'Slash', metaKey: true })

    expect(palette()).not.toBeNull()
  })

  it('opens on Ctrl-K on Windows', () => {
    const { canvas } = mountPalette('windows')

    openPalette(canvas, { key: 'k', code: 'KeyK', ctrlKey: true })

    expect(palette()).not.toBeNull()
  })

  it('never opens while an input has focus', () => {
    const { field } = mountPalette()
    field.focus()

    keydown(field, MOD_K)
    keydown(field, { key: '/', code: 'Slash', metaKey: true })

    expect(palette()).toBeNull()
  })

  it('never opens while text editing in the canvas', () => {
    const { canvas } = mountPalette()
    registry.setTextEditing(true)

    keydown(canvas, MOD_K)

    expect(palette()).toBeNull()
  })

  it('closes on Escape without running or selecting anything', async () => {
    const { canvas } = mountPalette()
    openPalette(canvas)
    await typeQuery('dupl')

    keydown(searchBox(), { key: 'Escape', code: 'Escape' })

    expect(palette()).toBeNull()
    expect(duplicate.run).not.toHaveBeenCalled()
    expect(ctx.select).not.toHaveBeenCalled()
  })
})

describe('the list', () => {
  it("lists the registry's actions by label with ⌘ glyphs on macOS, and no command the registry lacks", () => {
    const { canvas } = mountPalette()

    openPalette(canvas)

    expect(optionFor('Duplicate').textContent).toContain('⌘D')
    expect(optionFor('Wrap in container').textContent).toContain('⌘G')
    expect(optionTexts().some((text) => text.includes('Frobnicate the widget'))).toBe(true)
    expect(optionTexts().some((text) => text.includes('Ungroup'))).toBe(false)
  })

  it('spells shortcuts with Ctrl on Windows', () => {
    const { canvas } = mountPalette('windows')

    openPalette(canvas, { key: 'k', code: 'KeyK', ctrlKey: true })

    expect(optionFor('Duplicate').textContent).toContain('Ctrl+D')
    expect(optionFor('Duplicate').textContent).not.toContain('⌘')
  })

  it("lists the board's layers by name", () => {
    const { canvas } = mountPalette()

    openPalette(canvas)

    for (const name of ['Pricing', 'Heading', 'Footnote']) expect(optionTexts().some((text) => text.includes(name))).toBe(true)
  })

  it('narrows the list as the query is typed, closest match first', async () => {
    const { canvas } = mountPalette()
    openPalette(canvas)

    await typeQuery('dupl')

    expect(optionTexts()[0]).toContain('Duplicate')
    expect(optionTexts().some((text) => text.includes('Wrap in container'))).toBe(false)
    expect(optionTexts().some((text) => text.includes('Footnote'))).toBe(false)
  })

  it('labels punctuation reached through its code with what the keyboard layout map prints on that key', async () => {
    Object.defineProperty(navigator, 'keyboard', {
      configurable: true,
      value: { getLayoutMap: () => Promise.resolve(new Map([['BracketRight', '+']])) },
    })
    const { canvas } = mountPalette()

    openPalette(canvas)
    await settle()

    expect(optionFor('Bring to front').textContent).toContain('⌥⌘+')
  })

  it('falls back to the US character when the browser has no keyboard layout map', async () => {
    const { canvas } = mountPalette()

    openPalette(canvas)
    await settle()

    expect(optionFor('Bring to front').textContent).toContain('⌥⌘]')
  })
})

describe('choosing', () => {
  it('runs the top action on Enter with the editor context and a fresh action id, then closes', async () => {
    const { canvas } = mountPalette()
    openPalette(canvas)
    await typeQuery('dupl')

    keydown(searchBox(), { key: 'Enter', code: 'Enter' })

    expect(duplicate.run).toHaveBeenCalledOnce()
    expect(duplicate.run).toHaveBeenCalledWith(ctx, expect.any(String))
    expect(wrap.run).not.toHaveBeenCalled()
    expect(palette()).toBeNull()
  })

  it('selects the top layer on Enter, then closes', async () => {
    const { canvas } = mountPalette()
    openPalette(canvas)
    await typeQuery('pricing')

    keydown(searchBox(), { key: 'Enter', code: 'Enter' })

    expect(ctx.select).toHaveBeenCalledWith([edIdNamed(index.tree, 'Pricing')])
    expect(palette()).toBeNull()
  })

  it('runs nothing for a disabled action and shows its disabled reason, as its shortcut would', async () => {
    const { canvas } = mountPalette()
    openPalette(canvas)
    await typeQuery('lock everything')

    keydown(searchBox(), { key: 'Enter', code: 'Enter' })

    expect(lockAll.run).not.toHaveBeenCalled()
    expect(ctx.toast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Nothing to lock' }))
  })
})
