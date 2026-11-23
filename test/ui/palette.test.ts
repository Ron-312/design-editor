// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceIndex } from '../../src/server/source/source-index'
import type { BoardIndex } from '../../src/shared/protocol'
import type { EdId, ProjectPath, TemplateNode } from '../../src/shared/types'
import * as paletteActions from '../../src/ui/actions/palette.actions'
import { createActionRegistry, type ActionRegistry, type Platform } from '../../src/ui/actions/registry'
import { filterPalette, paletteItems, shortcutGlyphs, type PaletteItem } from '../../src/ui/palette'
import type { EditorAction, EditorContext } from '../../src/ui/plugin-api'

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

function action(id: string, label: string, kbd?: string): EditorAction {
  return { id, label, ...(kbd === undefined ? {} : { kbd }), run: vi.fn() }
}

const TEST_ACTIONS = [
  action('layer.wrap', 'Wrap in container', 'Mod+G'),
  action('layer.deleteUnused', 'Delete unused properties'),
  action('layer.duplicate', 'Duplicate', 'Mod+D'),
  action('history.undo', 'Undo', 'Mod+Z'),
  action('test.frobnicate', 'Frobnicate the widget'),
]

function testRegistry(platform: Platform = 'mac'): ActionRegistry {
  return createActionRegistry({ './test.actions.ts': { actions: TEST_ACTIONS } }, platform)
}

function describeItem(item: PaletteItem): string {
  return item.kind === 'action' ? `action ${item.action.id}` : `layer ${item.edId}`
}

function search(query: string, index: BoardIndex | null = boardIndexOf(PRICING_BOARD)): string[] {
  return filterPalette(paletteItems(testRegistry(), index), query).map(describeItem)
}

describe('palette items', () => {
  it('lists every action the registry holds, in registry order, and nothing else without a board', () => {
    const registry = testRegistry()

    const items = paletteItems(registry, null)

    expect(items.map(describeItem)).toEqual(registry.all().map((entry) => `action ${entry.id}`))
  })

  it('lists the layers of the board index after the actions', () => {
    const index = boardIndexOf(PRICING_BOARD)

    const described = paletteItems(testRegistry(), index).map(describeItem)

    const firstLayer = described.findIndex((entry) => entry.startsWith('layer '))
    expect(described.slice(0, firstLayer)).toEqual(TEST_ACTIONS.map((entry) => `action ${entry.id}`))
    for (const name of ['Plans', 'Pricing', 'Heading', 'CTA', 'Footnote']) {
      expect(described).toContain(`layer ${edIdNamed(index.tree, name)}`)
    }
  })
})

describe('palette filtering', () => {
  const index = boardIndexOf(PRICING_BOARD)
  const layer = (name: string) => `layer ${edIdNamed(index.tree, name)}`

  it('keeps every item for an empty query', () => {
    const items = paletteItems(testRegistry(), index)

    expect(filterPalette(items, '')).toEqual(items)
  })

  it('matches action labels fuzzily, the closest match first', () => {
    const found = search('dup', index)

    expect(found[0]).toBe('action layer.duplicate')
    expect(found).toContain('action layer.deleteUnused')
    expect(found).not.toContain('action history.undo')
    expect(found).not.toContain('action layer.wrap')
  })

  it('ignores case', () => {
    expect(search('DUPL', index)[0]).toBe('action layer.duplicate')
  })

  it('drops everything when nothing matches', () => {
    expect(search('zzqx', index)).toEqual([])
  })

  it('finds a layer by its name', () => {
    expect(search('pricing', index)).toContain(layer('Pricing'))
    expect(search('pricing', index)).not.toContain(layer('Footnote'))
  })

  it('finds a layer by its tag', () => {
    expect(search('section', index)).toContain(layer('Plans'))
    expect(search('section', index)).not.toContain(layer('Heading'))
  })

  it('finds a layer by any of its classes, not only the first', () => {
    expect(search('shadow', index)).toContain(layer('Pricing'))
    expect(search('shadow', index)).not.toContain(layer('Heading'))
  })

  it('finds a layer by its text', () => {
    expect(search('trial', index)).toContain(layer('CTA'))
    expect(search('trial', index)).not.toContain(layer('Footnote'))
  })

  it('lists an action the registry holds and no command it does not', () => {
    expect(search('frobnicate', index)).toEqual(['action test.frobnicate'])
    expect(search('ungroup', index)).toEqual([])
  })
})

describe('shortcut glyphs', () => {
  const QWERTZ = new Map([
    ['KeyZ', 'y'],
    ['KeyY', 'z'],
    ['Slash', '-'],
    ['BracketRight', '+'],
    ['Digit1', '1'],
  ])
  const AZERTY = new Map([
    ['KeyA', 'q'],
    ['Digit1', '&'],
    ['BracketRight', '$'],
  ])

  it('shows Mod as ⌘ and the modifiers as ⌥⇧ on macOS', () => {
    expect(shortcutGlyphs('Mod+D', 'mac')).toBe('⌘D')
    expect(shortcutGlyphs('Mod+Shift+Z', 'mac')).toBe('⇧⌘Z')
    expect(shortcutGlyphs('Mod+Alt+Shift+C', 'mac')).toBe('⌥⇧⌘C')
  })

  it('spells the modifiers as Ctrl+Alt+Shift on Windows', () => {
    expect(shortcutGlyphs('Mod+D', 'windows')).toBe('Ctrl+D')
    expect(shortcutGlyphs('Mod+Shift+Z', 'windows')).toBe('Ctrl+Shift+Z')
    expect(shortcutGlyphs('Mod+Alt+Shift+C', 'windows')).toBe('Ctrl+Alt+Shift+C')
  })

  it('shows the bound letter, whatever key the layout puts it on', () => {
    expect(shortcutGlyphs('Mod+Z', 'mac', QWERTZ)).toBe('⌘Z')
    expect(shortcutGlyphs('Mod+A', 'windows', AZERTY)).toBe('Ctrl+A')
  })

  it('shows the bound digit, even when the layout types a symbol on its key', () => {
    expect(shortcutGlyphs('Shift+1', 'mac', AZERTY)).toBe('⇧1')
  })

  it('shows punctuation matched on its key as bound, not from the layout', () => {
    expect(shortcutGlyphs('Mod+/', 'mac', QWERTZ)).toBe('⌘/')
    expect(shortcutGlyphs('Mod+/', 'windows', QWERTZ)).toBe('Ctrl+/')
  })

  it('labels punctuation reached through its code with what the layout prints on that key', () => {
    expect(shortcutGlyphs('Mod+Alt+]', 'mac', QWERTZ)).toBe('⌥⌘+')
    expect(shortcutGlyphs('Mod+Alt+]', 'mac', AZERTY)).toBe('⌥⌘$')
  })

  it('falls back to the US character for punctuation reached through its code without a layout map', () => {
    expect(shortcutGlyphs('Mod+Alt+]', 'mac')).toBe('⌥⌘]')
    expect(shortcutGlyphs('Mod+Shift+]', 'windows')).toBe('Ctrl+Shift+]')
    expect(shortcutGlyphs('Mod+Alt+]', 'mac', new Map([['KeyZ', 'y']]))).toBe('⌥⌘]')
  })
})

describe('opening the palette', () => {
  function mountShell() {
    document.body.innerHTML = `
      <header class="top"><button type="button" id="undo-button">Undo</button></header>
      <aside class="left">
        <nav class="layers" aria-label="Layers">
          <input id="layer-search" aria-label="Find layer" />
          <div role="tree" aria-label="Layers">
            <div role="treeitem" tabindex="0" id="layer-row" data-layer-id="card"><span>card</span></div>
          </div>
        </nav>
      </aside>
      <main class="center"><div data-canvas-viewport="" tabindex="0" id="canvas"></div></main>
      <textarea id="notes"></textarea>
      <div contenteditable="true" id="editable"></div>
    `
    const byId = (id: string) => document.getElementById(id)!
    return { canvas: byId('canvas'), search: byId('layer-search'), layerRow: byId('layer-row'), textarea: byId('notes'), editable: byId('editable') }
  }

  let shell = mountShell()
  const ctx = { toast: vi.fn(), beginAction: vi.fn(() => 'minted'), index: vi.fn(() => null), selection: vi.fn(() => null) } as unknown as EditorContext

  beforeEach(() => {
    shell = mountShell()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function paletteRegistry(platform: Platform): ActionRegistry {
    return createActionRegistry({ './palette.actions.ts': { actions: paletteActions.actions } }, platform)
  }

  function press(registry: ActionRegistry, init: KeyboardEventInit, target: HTMLElement | null = shell.canvas) {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    let handled: boolean | undefined
    const listen = (dispatched: Event) => {
      handled = registry.handleKeyDown(dispatched as KeyboardEvent, ctx)
    }
    document.addEventListener('keydown', listen)
    ;(target ?? document.body).dispatchEvent(event)
    document.removeEventListener('keydown', listen)
    return { handled, prevented: event.defaultPrevented }
  }

  it('opens on Mod-K and Mod-/ with ⌘ on macOS', () => {
    const registry = paletteRegistry('mac')

    expect(press(registry, { key: 'k', code: 'KeyK', metaKey: true })).toEqual({ handled: true, prevented: true })
    expect(press(registry, { key: '/', code: 'Slash', metaKey: true })).toEqual({ handled: true, prevented: true })
    expect(press(registry, { key: 'k', code: 'KeyK', ctrlKey: true }).handled).toBe(false)
  })

  it('opens on Ctrl-K and Ctrl-/ on Windows', () => {
    const registry = paletteRegistry('windows')

    expect(press(registry, { key: 'k', code: 'KeyK', ctrlKey: true })).toEqual({ handled: true, prevented: true })
    expect(press(registry, { key: '/', code: 'Slash', ctrlKey: true })).toEqual({ handled: true, prevented: true })
  })

  it('opens on QWERTZ Ctrl+Shift+7, which types /, and not on the - key at US /', () => {
    const registry = paletteRegistry('windows')

    expect(press(registry, { key: '/', code: 'Digit7', ctrlKey: true, shiftKey: true }).handled).toBe(true)
    expect(press(registry, { key: '-', code: 'Slash', ctrlKey: true }).handled).toBe(false)
  })

  it('opens with nothing focused, from a focused layer row and from a top-bar button', () => {
    const registry = paletteRegistry('mac')

    expect(press(registry, { key: 'k', code: 'KeyK', metaKey: true }, null).handled).toBe(true)
    expect(press(registry, { key: 'k', code: 'KeyK', metaKey: true }, shell.layerRow).handled).toBe(true)
    expect(press(registry, { key: 'k', code: 'KeyK', metaKey: true }, document.getElementById('undo-button')).handled).toBe(true)
  })

  it.each([
    ['the layer search box', () => shell.search],
    ['a textarea', () => shell.textarea],
    ['a contenteditable', () => shell.editable],
  ])('never opens while %s has focus, and leaves the key to it', (_name, target) => {
    const registry = paletteRegistry('mac')

    expect(press(registry, { key: 'k', code: 'KeyK', metaKey: true }, target())).toEqual({ handled: false, prevented: false })
    expect(press(registry, { key: '/', code: 'Slash', metaKey: true }, target())).toEqual({ handled: false, prevented: false })
  })

  it('never opens while text editing in the canvas, and opens again once it ends', () => {
    const registry = paletteRegistry('mac')

    registry.setTextEditing(true)
    expect(press(registry, { key: 'k', code: 'KeyK', metaKey: true })).toEqual({ handled: false, prevented: false })
    expect(press(registry, { key: '/', code: 'Slash', metaKey: true }).handled).toBe(false)

    registry.setTextEditing(false)
    expect(press(registry, { key: 'k', code: 'KeyK', metaKey: true }).handled).toBe(true)
  })
})
