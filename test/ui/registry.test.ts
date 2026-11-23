// @vitest-environment jsdom
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createActionRegistry, createDefaultRegistry, type ActionModule, type ActionRegistry, type Platform } from '../../src/ui/actions/registry'
import type { EditorAction, EditorContext, ShellSlot, ShellSlotProps } from '../../src/ui/plugin-api'
import type { ProbeClient } from '../../src/ui/probe-client'

type Scope = 'canvas' | 'layers' | 'global'
type Run = (context: EditorContext, actionId: string) => void

function fakeContext() {
  let minted = 0
  const spies = {
    toast: vi.fn(),
    beginAction: vi.fn(() => `minted-${++minted}`),
    setMode: vi.fn(),
    fit: vi.fn(),
    cancelGesture: vi.fn(() => false),
    select: vi.fn(),
    selection: vi.fn(() => null),
    index: vi.fn(() => null),
    readOnly: vi.fn(() => false),
  }
  return spies as typeof spies & EditorContext
}

let ctx = fakeContext()

interface ActionOptions {
  readonly kbd?: string | readonly string[]
  readonly when?: EditorAction['when']
  readonly scope?: Scope | readonly Scope[]
  readonly inTextEntry?: boolean
  readonly hold?: boolean
  readonly disabledReason?: string
}

function action(id: string, options: ActionOptions = {}) {
  const run = vi.fn<Run>()
  const entry: EditorAction = { id, label: id, run, ...options }
  return { entry, run }
}

function modulesOf(...actions: EditorAction[]): Record<string, ActionModule> {
  return { './test.actions.ts': { actions } }
}

/** The editor's shell as the registry sees it: a top bar, the layers panel and the canvas. */
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
    <main class="center">
      <div data-canvas-viewport="" tabindex="0" id="canvas"><div data-canvas-shield="" id="shield"></div></div>
    </main>
    <textarea id="notes"></textarea>
    <div contenteditable="true" id="editable"></div>
  `
  const byId = (id: string) => document.getElementById(id)!
  return {
    button: byId('undo-button'),
    search: byId('layer-search'),
    layerRow: byId('layer-row'),
    canvas: byId('canvas'),
    shield: byId('shield'),
    textarea: byId('notes'),
    editable: byId('editable'),
  }
}

let shell = mountShell()

beforeEach(() => {
  ctx = fakeContext()
  shell = mountShell()
})

afterEach(() => {
  document.body.innerHTML = ''
})

/** Dispatches a real keydown at `target` and hands it to the registry the way the app's document listener does. */
function fire(registry: ActionRegistry, init: KeyboardEventInit, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  let handled: boolean | undefined
  const listen = (dispatched: Event) => {
    handled = registry.handleKeyDown(dispatched as KeyboardEvent, ctx)
  }
  document.addEventListener('keydown', listen)
  target.dispatchEvent(event)
  document.removeEventListener('keydown', listen)
  return { event, handled }
}

function keyup(registry: ActionRegistry, init: KeyboardEventInit, target: EventTarget = document.body): void {
  const event = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init })
  const listen = (dispatched: Event) => registry.handleKeyUp(dispatched as KeyboardEvent)
  document.addEventListener('keyup', listen)
  target.dispatchEvent(event)
  document.removeEventListener('keyup', listen)
}

function actionIdsOf(run: ReturnType<typeof vi.fn<Run>>): string[] {
  return run.mock.calls.map(([, actionId]) => actionId)
}

describe('holding actions', () => {
  it('holds every action from every module, looked up by id', () => {
    const duplicate = action('layer.duplicate', { kbd: 'Mod+D' })
    const remove = action('layer.delete', { kbd: 'Delete' })
    const zoomIn = action('view.zoomIn')

    const registry = createActionRegistry(
      { './layer.actions.ts': { actions: [duplicate.entry, remove.entry] }, './view.actions.ts': { actions: [zoomIn.entry] } },
      'mac',
    )

    expect(registry.all().map((entry) => entry.id).sort()).toEqual(['layer.delete', 'layer.duplicate', 'view.zoomIn'])
    expect(registry.get('layer.delete')).toBe(remove.entry)
    expect(registry.get('layer.missing')).toBeUndefined()
  })

  it('registers every action the ./*.actions.ts files export', () => {
    const files = import.meta.glob<ActionModule>('../../src/ui/actions/*.actions.ts', { eager: true })
    const exportedIds = Object.values(files).flatMap((file) => file.actions.map((entry) => entry.id))

    const registry = createDefaultRegistry('mac')

    expect(registry.all().map((entry) => entry.id).sort()).toEqual(exportedIds.sort())
  })
})

describe('shortcuts', () => {
  it('reads Mod as Cmd on macOS', () => {
    const duplicate = action('layer.duplicate', { kbd: 'Mod+D' })
    const registry = createActionRegistry(modulesOf(duplicate.entry), 'mac')

    const withCtrl = fire(registry, { key: 'd', code: 'KeyD', ctrlKey: true })
    expect(withCtrl.handled).toBe(false)
    expect(duplicate.run).not.toHaveBeenCalled()
    expect(withCtrl.event.defaultPrevented).toBe(false)

    const withCmd = fire(registry, { key: 'd', code: 'KeyD', metaKey: true })
    expect(withCmd.handled).toBe(true)
    expect(duplicate.run).toHaveBeenCalledExactlyOnceWith(ctx, expect.any(String))
    expect(withCmd.event.defaultPrevented).toBe(true)
  })

  it('reads Mod as Ctrl on Windows', () => {
    const duplicate = action('layer.duplicate', { kbd: 'Mod+D' })
    const registry = createActionRegistry(modulesOf(duplicate.entry), 'windows')

    expect(fire(registry, { key: 'd', code: 'KeyD', metaKey: true }).handled).toBe(false)
    expect(duplicate.run).not.toHaveBeenCalled()

    expect(fire(registry, { key: 'd', code: 'KeyD', ctrlKey: true }).handled).toBe(true)
    expect(duplicate.run).toHaveBeenCalledExactlyOnceWith(ctx, expect.any(String))
  })

  it('matches the modifiers exactly', () => {
    const duplicate = action('layer.duplicate', { kbd: 'Mod+D' })
    const groupAll = action('layer.group', { kbd: 'Mod+Shift+G' })
    const remove = action('layer.delete', { kbd: 'Delete' })
    const registry = createActionRegistry(modulesOf(duplicate.entry, groupAll.entry, remove.entry), 'mac')

    expect(fire(registry, { key: 'd', code: 'KeyD' }).handled).toBe(false)
    expect(fire(registry, { key: 'D', code: 'KeyD', metaKey: true, shiftKey: true }).handled).toBe(false)
    expect(fire(registry, { key: 'g', code: 'KeyG', metaKey: true }).handled).toBe(false)
    expect(fire(registry, { key: 'Delete', code: 'Delete', metaKey: true }).handled).toBe(false)
    expect(duplicate.run).not.toHaveBeenCalled()
    expect(groupAll.run).not.toHaveBeenCalled()
    expect(remove.run).not.toHaveBeenCalled()

    expect(fire(registry, { key: 'G', code: 'KeyG', metaKey: true, shiftKey: true }).handled).toBe(true)
    expect(fire(registry, { key: 'Delete', code: 'Delete' }).handled).toBe(true)
    expect(groupAll.run).toHaveBeenCalledOnce()
    expect(remove.run).toHaveBeenCalledOnce()
  })

  it('suspends shortcuts while text editing in the frame', () => {
    const duplicate = action('layer.duplicate', { kbd: 'Mod+D' })
    const registry = createActionRegistry(modulesOf(duplicate.entry), 'mac')

    registry.setTextEditing(true)
    const whileEditing = fire(registry, { key: 'd', code: 'KeyD', metaKey: true })

    expect(whileEditing.handled).toBe(false)
    expect(duplicate.run).not.toHaveBeenCalled()
    expect(whileEditing.event.defaultPrevented).toBe(false)

    registry.setTextEditing(false)

    expect(fire(registry, { key: 'd', code: 'KeyD', metaKey: true }).handled).toBe(true)
    expect(duplicate.run).toHaveBeenCalledOnce()
  })
})

describe('key aliases', () => {
  it('binds every alias of an action', () => {
    const remove = action('layer.delete', { kbd: ['Backspace', 'Delete'] })
    const registry = createActionRegistry(modulesOf(remove.entry), 'mac')

    expect(fire(registry, { key: 'Backspace', code: 'Backspace' }).handled).toBe(true)
    expect(fire(registry, { key: 'Delete', code: 'Delete' }).handled).toBe(true)

    expect(remove.run).toHaveBeenCalledTimes(2)
  })

  it('names the first alias as the shortcut the palette shows', () => {
    const remove = action('layer.delete', { kbd: ['Backspace', 'Delete'] })
    const undo = action('history.undo', { kbd: 'Mod+Z' })
    const unbound = action('view.outline')
    const registry = createActionRegistry(modulesOf(remove.entry, undo.entry, unbound.entry), 'mac')

    expect(registry.shortcutOf('layer.delete')).toBe('Backspace')
    expect(registry.shortcutOf('history.undo')).toBe('Mod+Z')
    expect(registry.shortcutOf('view.outline')).toBeUndefined()
  })
})

describe('key-first matching with a code fallback', () => {
  function layoutRegistry(platform: Platform) {
    const bound = {
      undo: action('history.undo', { kbd: 'Mod+Z' }),
      redo: action('history.redo', { kbd: 'Mod+Shift+Z' }),
      redoAlias: action('history.redoY', { kbd: 'Mod+Y' }),
      zoomIn: action('view.zoomIn', { kbd: ['Mod+=', 'Mod++'] }),
      zoomOut: action('view.zoomOut', { kbd: 'Mod+-' }),
      palette: action('palette.open', { kbd: ['Mod+K', 'Mod+/'] }),
      bringForward: action('arrange.bringForward', { kbd: 'Mod+]' }),
      shiftBracket: action('arrange.bringToFront', { kbd: 'Mod+Shift+]' }),
      alignLeft: action('align.left', { kbd: 'Alt+A' }),
      copyStyle: action('style.copy', { kbd: 'Mod+Alt+C' }),
      zoom100: action('view.zoom100', { kbd: 'Shift+0' }),
    }
    const registry = createActionRegistry(modulesOf(...Object.values(bound).map(({ entry }) => entry)), platform)
    const ran = () => Object.entries(bound).flatMap(([name, { run }]) => (run.mock.calls.length > 0 ? [name] : []))
    return { registry, ran }
  }

  it('reaches an Option-composed letter through its code on macOS', () => {
    const { registry, ran } = layoutRegistry('mac')

    const option = fire(registry, { key: 'å', code: 'KeyA', altKey: true })

    expect(ran()).toEqual(['alignLeft'])
    expect(option.event.defaultPrevented).toBe(true)
  })

  it('reaches ⌘⌥C arriving as ç through its code', () => {
    const { registry, ran } = layoutRegistry('mac')

    fire(registry, { key: 'ç', code: 'KeyC', metaKey: true, altKey: true })

    expect(ran()).toEqual(['copyStyle'])
  })

  it('reaches a Shift symbol through its code: ⌘⇧] arrives as }', () => {
    const { registry, ran } = layoutRegistry('mac')

    fire(registry, { key: '}', code: 'BracketRight', metaKey: true, shiftKey: true })

    expect(ran()).toEqual(['shiftBracket'])
  })

  it('reaches Shift-0 arriving as ) through its code', () => {
    const { registry, ran } = layoutRegistry('mac')

    fire(registry, { key: ')', code: 'Digit0', shiftKey: true }, shell.canvas)

    expect(ran()).toEqual(['zoom100'])
  })

  it('AZERTY: Ctrl+Z on the key labelled Z is undo', () => {
    const { registry, ran } = layoutRegistry('windows')

    fire(registry, { key: 'z', code: 'KeyW', ctrlKey: true })

    expect(ran()).toEqual(['undo'])
  })

  it('AZERTY: the key at QWERTY Z, labelled W, matches nothing and passes through', () => {
    const { registry, ran } = layoutRegistry('windows')

    const atQwertyZ = fire(registry, { key: 'w', code: 'KeyZ', ctrlKey: true })

    expect(ran()).toEqual([])
    expect(atQwertyZ.handled).toBe(false)
    expect(atQwertyZ.event.defaultPrevented).toBe(false)
  })

  it('QWERTZ: Ctrl+Z on the key labelled Z is undo, not the redo bound to the key at QWERTY Y', () => {
    const { registry, ran } = layoutRegistry('windows')

    fire(registry, { key: 'z', code: 'KeyY', ctrlKey: true })

    expect(ran()).toEqual(['undo'])
  })

  it('a shifted letter is the Shift chord, not the plain one', () => {
    const { registry, ran } = layoutRegistry('mac')

    fire(registry, { key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true })

    expect(ran()).toEqual(['redo'])
  })

  it('QWERTZ: Ctrl and the + key at US ] is zoom in, not Bring forward', () => {
    const { registry, ran } = layoutRegistry('windows')

    fire(registry, { key: '+', code: 'BracketRight', ctrlKey: true })

    expect(ran()).toEqual(['zoomIn'])
  })

  it('QWERTZ: Ctrl and the - key at US / is zoom out, not the palette', () => {
    const { registry, ran } = layoutRegistry('windows')

    fire(registry, { key: '-', code: 'Slash', ctrlKey: true })

    expect(ran()).toEqual(['zoomOut'])
  })

  it('QWERTZ: Ctrl+Shift+7 types / and opens the palette', () => {
    const { registry, ran } = layoutRegistry('windows')

    fire(registry, { key: '/', code: 'Digit7', ctrlKey: true, shiftKey: true })

    expect(ran()).toEqual(['palette'])
  })

  it('AZERTY: Ctrl and the - key at US 6 is zoom out', () => {
    const { registry, ran } = layoutRegistry('windows')

    fire(registry, { key: '-', code: 'Digit6', ctrlKey: true })

    expect(ran()).toEqual(['zoomOut'])
  })

  it('US: Ctrl+] is Bring forward', () => {
    const { registry, ran } = layoutRegistry('windows')

    fire(registry, { key: ']', code: 'BracketRight', ctrlKey: true })

    expect(ran()).toEqual(['bringForward'])
  })

  it('Hebrew: ⌘ and the key typing ז is undo', () => {
    const { registry, ran } = layoutRegistry('mac')

    fire(registry, { key: 'ז', code: 'KeyZ', metaKey: true })

    expect(ran()).toEqual(['undo'])
  })

  it('never falls back to the code without a modifier', () => {
    const plainA = action('tool.a', { kbd: 'A' })
    const registry = createActionRegistry(modulesOf(plainA.entry), 'mac')

    const composed = fire(registry, { key: 'ф', code: 'KeyA' }, shell.canvas)

    expect(plainA.run).not.toHaveBeenCalled()
    expect(composed.event.defaultPrevented).toBe(false)
  })

  it('Windows: skips a Ctrl+Alt chord while AltGr is down, so AltGr characters type', () => {
    const { registry, ran } = layoutRegistry('windows')

    const altGr = fire(registry, { key: 'ć', code: 'KeyC', ctrlKey: true, altKey: true, modifierAltGraph: true } as KeyboardEventInit)

    expect(ran()).toEqual([])
    expect(altGr.event.defaultPrevented).toBe(false)

    fire(registry, { key: 'c', code: 'KeyC', ctrlKey: true, altKey: true })

    expect(ran()).toEqual(['copyStyle'])
  })

  it('matches a named key on event.key', () => {
    const escape = action('canvas.escape', { kbd: 'Escape', scope: 'canvas' })
    const registry = createActionRegistry(modulesOf(escape.entry), 'mac')

    fire(registry, { key: 'Escape', code: 'CapsLock' }, shell.canvas)
    fire(registry, { key: 'CapsLock', code: 'Escape' }, shell.canvas)

    expect(escape.run).toHaveBeenCalledOnce()
  })
})

describe('scopes', () => {
  const NAVIGATION_KEYS = ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

  it('runs canvas-scoped navigation keys only from the canvas, and prevents them only there', () => {
    const bound = NAVIGATION_KEYS.map((key) => action(`canvas.${key}`, { kbd: key, scope: 'canvas' }))
    const registry = createActionRegistry(modulesOf(...bound.map(({ entry }) => entry)), 'mac')

    for (const [i, key] of NAVIGATION_KEYS.entries()) {
      const fromButton = fire(registry, { key, code: key }, shell.button)
      const fromLayerRow = fire(registry, { key, code: key }, shell.layerRow)
      expect(bound[i]!.run).not.toHaveBeenCalled()
      expect(fromButton.event.defaultPrevented).toBe(false)
      expect(fromLayerRow.event.defaultPrevented).toBe(false)

      const fromCanvas = fire(registry, { key, code: key }, shell.shield)
      expect(bound[i]!.run).toHaveBeenCalledOnce()
      expect(fromCanvas.event.defaultPrevented).toBe(true)
    }
  })

  it('treats a keydown with nothing focused as on the canvas', () => {
    const enter = action('canvas.enter', { kbd: 'Enter', scope: 'canvas' })
    const registry = createActionRegistry(modulesOf(enter.entry), 'mac')

    const unfocused = fire(registry, { key: 'Enter', code: 'Enter' }, document.body)

    expect(enter.run).toHaveBeenCalledOnce()
    expect(unfocused.event.defaultPrevented).toBe(true)
  })

  it('runs a layers-scoped action only from inside the layers panel', () => {
    const collapse = action('layers.collapse', { kbd: 'ArrowLeft', scope: 'layers' })
    const registry = createActionRegistry(modulesOf(collapse.entry), 'mac')

    expect(fire(registry, { key: 'ArrowLeft', code: 'ArrowLeft' }, shell.canvas).event.defaultPrevented).toBe(false)
    expect(fire(registry, { key: 'ArrowLeft', code: 'ArrowLeft' }, shell.button).event.defaultPrevented).toBe(false)
    expect(collapse.run).not.toHaveBeenCalled()

    expect(fire(registry, { key: 'ArrowLeft', code: 'ArrowLeft' }, shell.layerRow).event.defaultPrevented).toBe(true)
    expect(collapse.run).toHaveBeenCalledOnce()
  })

  it('runs an action with a list of scopes wherever any of them applies', () => {
    const remove = action('layer.delete', { kbd: ['Backspace', 'Delete'], scope: ['canvas', 'layers'] })
    const registry = createActionRegistry(modulesOf(remove.entry), 'mac')

    expect(fire(registry, { key: 'Delete', code: 'Delete' }, shell.button).event.defaultPrevented).toBe(false)
    expect(remove.run).not.toHaveBeenCalled()

    fire(registry, { key: 'Delete', code: 'Delete' }, shell.canvas)
    fire(registry, { key: 'Backspace', code: 'Backspace' }, shell.layerRow)
    expect(remove.run).toHaveBeenCalledTimes(2)
  })

  it('runs a global action anywhere but in text entry', () => {
    const undo = action('history.undo', { kbd: 'Mod+Z' })
    const registry = createActionRegistry(modulesOf(undo.entry), 'mac')

    for (const target of [shell.button, shell.layerRow, shell.canvas, document.body]) fire(registry, { key: 'z', code: 'KeyZ', metaKey: true }, target)
    expect(undo.run).toHaveBeenCalledTimes(4)

    for (const target of [shell.search, shell.textarea, shell.editable]) {
      const inField = fire(registry, { key: 'z', code: 'KeyZ', metaKey: true }, target)
      expect(inField.handled).toBe(false)
      expect(inField.event.defaultPrevented).toBe(false)
    }
    expect(undo.run).toHaveBeenCalledTimes(4)
  })

  it('fires an inTextEntry action from a text field, such as Mod-F from the layer search box, and no other chord', () => {
    const find = action('layers.find', { kbd: 'Mod+F', inTextEntry: true })
    const undo = action('history.undo', { kbd: 'Mod+Z' })
    const registry = createActionRegistry(modulesOf(find.entry, undo.entry), 'mac')

    const findInSearch = fire(registry, { key: 'f', code: 'KeyF', metaKey: true }, shell.search)
    const findOnCanvas = fire(registry, { key: 'f', code: 'KeyF', metaKey: true }, shell.canvas)
    const undoInSearch = fire(registry, { key: 'z', code: 'KeyZ', metaKey: true }, shell.search)

    expect(find.run).toHaveBeenCalledTimes(2)
    expect(findInSearch.event.defaultPrevented).toBe(true)
    expect(findOnCanvas.event.defaultPrevented).toBe(true)
    expect(undo.run).not.toHaveBeenCalled()
    expect(undoInSearch.event.defaultPrevented).toBe(false)
  })
})

describe('disabled actions', () => {
  const disabled = () => false

  it('prevents a disabled in-scope chord, runs nothing and shows its disabled reason', () => {
    const sendBackward = action('arrange.sendBackward', { kbd: 'Mod+[', when: disabled, disabledReason: 'Nothing behind to move past' })
    const registry = createActionRegistry(modulesOf(sendBackward.entry), 'mac')

    const chord = fire(registry, { key: '[', code: 'BracketLeft', metaKey: true }, shell.canvas)

    expect(chord.event.defaultPrevented).toBe(true)
    expect(sendBackward.run).not.toHaveBeenCalled()
    expect(ctx.toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Nothing behind to move past' }))
  })

  it('prevents a disabled Alt-letter chord so it never reaches the browser', () => {
    const distribute = action('align.distribute', { kbd: 'Alt+D', when: disabled, disabledReason: 'Select three or more layers' })
    const registry = createActionRegistry(modulesOf(distribute.entry), 'mac')

    const chord = fire(registry, { key: '∂', code: 'KeyD', altKey: true }, shell.canvas)

    expect(chord.event.defaultPrevented).toBe(true)
    expect(distribute.run).not.toHaveBeenCalled()
    expect(ctx.toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Select three or more layers' }))
  })

  it('keeps a disabled bare key with no reason silent', () => {
    const remove = action('layer.delete', { kbd: 'Delete', scope: ['canvas', 'layers'], when: disabled })
    const registry = createActionRegistry(modulesOf(remove.entry), 'mac')

    const key = fire(registry, { key: 'Delete', code: 'Delete' }, shell.canvas)

    expect(key.event.defaultPrevented).toBe(true)
    expect(remove.run).not.toHaveBeenCalled()
    expect(ctx.toast).not.toHaveBeenCalled()
  })

  it('lets a disabled chord outside its scope pass through', () => {
    const sendBackward = action('arrange.sendBackward', { kbd: 'Mod+[', when: disabled, disabledReason: 'Nothing behind to move past' })
    const remove = action('layer.delete', { kbd: 'Delete', scope: 'canvas', when: disabled, disabledReason: 'Select a layer' })
    const registry = createActionRegistry(modulesOf(sendBackward.entry, remove.entry), 'mac')

    const chordInField = fire(registry, { key: '[', code: 'BracketLeft', metaKey: true }, shell.search)
    const deleteOnButton = fire(registry, { key: 'Delete', code: 'Delete' }, shell.button)

    expect(chordInField.event.defaultPrevented).toBe(false)
    expect(deleteOnButton.event.defaultPrevented).toBe(false)
    expect(ctx.toast).not.toHaveBeenCalled()
  })

  it('runs the enabled action when two in-scope bindings share a chord', () => {
    const blocked = action('first', { kbd: 'Mod+D', when: disabled, disabledReason: 'Not now' })
    const allowed = action('second', { kbd: 'Mod+D' })
    const registry = createActionRegistry(modulesOf(blocked.entry, allowed.entry), 'mac')

    const chord = fire(registry, { key: 'd', code: 'KeyD', metaKey: true })

    expect(chord.handled).toBe(true)
    expect(allowed.run).toHaveBeenCalledOnce()
    expect(blocked.run).not.toHaveBeenCalled()
    expect(ctx.toast).not.toHaveBeenCalled()
  })
})

describe('action ids', () => {
  it('hands each run a fresh action id', () => {
    const duplicate = action('layer.duplicate', { kbd: 'Mod+D' })
    const registry = createActionRegistry(modulesOf(duplicate.entry), 'mac')

    fire(registry, { key: 'd', code: 'KeyD', metaKey: true })
    fire(registry, { key: 'd', code: 'KeyD', metaKey: true })

    const [first, second] = actionIdsOf(duplicate.run)
    expect(first).toEqual(expect.any(String))
    expect(second).toEqual(expect.any(String))
    expect(first).not.toBe(second)
  })

  it('keeps one action id across the repeats of a held key and releases it on keyup', () => {
    const nudge = action('move.nudgeRight', { kbd: 'ArrowRight', scope: 'canvas', hold: true })
    const registry = createActionRegistry(modulesOf(nudge.entry), 'mac')

    fire(registry, { key: 'ArrowRight', code: 'ArrowRight' }, shell.canvas)
    for (let i = 0; i < 3; i++) fire(registry, { key: 'ArrowRight', code: 'ArrowRight', repeat: true }, shell.canvas)
    keyup(registry, { key: 'ArrowRight', code: 'ArrowRight' }, shell.canvas)
    fire(registry, { key: 'ArrowRight', code: 'ArrowRight' }, shell.canvas)

    const ids = actionIdsOf(nudge.run)
    expect(ids).toHaveLength(5)
    expect(new Set(ids.slice(0, 4)).size).toBe(1)
    expect(ids[4]).not.toBe(ids[0])
  })

  it('starts a new action on a fresh press of a held key, even before its keyup', () => {
    const nudge = action('move.nudgeRight', { kbd: 'ArrowRight', scope: 'canvas', hold: true })
    const registry = createActionRegistry(modulesOf(nudge.entry), 'mac')

    fire(registry, { key: 'ArrowRight', code: 'ArrowRight' }, shell.canvas)
    fire(registry, { key: 'ArrowRight', code: 'ArrowRight' }, shell.canvas)

    const [first, second] = actionIdsOf(nudge.run)
    expect(first).not.toBe(second)
  })

  it('starts a new action when another held key repeats', () => {
    const right = action('move.nudgeRight', { kbd: 'ArrowRight', scope: 'canvas', hold: true })
    const down = action('move.nudgeDown', { kbd: 'ArrowDown', scope: 'canvas', hold: true })
    const registry = createActionRegistry(modulesOf(right.entry, down.entry), 'mac')

    fire(registry, { key: 'ArrowRight', code: 'ArrowRight' }, shell.canvas)
    fire(registry, { key: 'ArrowDown', code: 'ArrowDown', repeat: true }, shell.canvas)

    expect(actionIdsOf(down.run)[0]).not.toBe(actionIdsOf(right.run)[0])
  })

  it('releases a held action id when the window loses focus', () => {
    const nudge = action('move.nudgeRight', { kbd: 'ArrowRight', scope: 'canvas', hold: true })
    const registry = createActionRegistry(modulesOf(nudge.entry), 'mac')

    fire(registry, { key: 'ArrowRight', code: 'ArrowRight' }, shell.canvas)
    registry.handleBlur()
    fire(registry, { key: 'ArrowRight', code: 'ArrowRight', repeat: true }, shell.canvas)

    const [beforeBlur, afterBlur] = actionIdsOf(nudge.run)
    expect(afterBlur).not.toBe(beforeBlur)
  })

  it('gives a repeat of an action that is not held a new id each time', () => {
    const undo = action('history.undo', { kbd: 'Mod+Z' })
    const registry = createActionRegistry(modulesOf(undo.entry), 'mac')

    fire(registry, { key: 'z', code: 'KeyZ', metaKey: true })
    fire(registry, { key: 'z', code: 'KeyZ', metaKey: true, repeat: true })

    const [first, repeated] = actionIdsOf(undo.run)
    expect(repeated).not.toBe(first)
  })
})

describe('the canvas actions', () => {
  it('switches tools with V and H on the canvas, and leaves the keys to a focused button', () => {
    const registry = createDefaultRegistry('mac')

    const onButton = fire(registry, { key: 'h', code: 'KeyH' }, shell.button)
    expect(ctx.setMode).not.toHaveBeenCalled()
    expect(onButton.event.defaultPrevented).toBe(false)

    fire(registry, { key: 'h', code: 'KeyH' }, shell.canvas)
    expect(ctx.setMode).toHaveBeenLastCalledWith('hand')

    fire(registry, { key: 'v', code: 'KeyV' }, shell.canvas)
    expect(ctx.setMode).toHaveBeenLastCalledWith('select')
  })

  it('fits the board with Shift-1 and the selection with Shift-2', () => {
    const registry = createDefaultRegistry('windows')

    fire(registry, { key: '!', code: 'Digit1', shiftKey: true }, shell.canvas)
    expect(ctx.fit).toHaveBeenLastCalledWith('board')

    fire(registry, { key: '@', code: 'Digit2', shiftKey: true }, shell.canvas)
    expect(ctx.fit).toHaveBeenLastCalledWith('selection')
  })
})

/** A chord as a comparable string: Mod as the platform's own key, modifiers sorted, the key lower-cased; `Mod++` is Mod and the + key. */
function chordOf(kbd: string, platform: Platform): string {
  const plusKey = kbd.endsWith('++') || kbd === '+'
  const parts = (plusKey ? kbd.slice(0, -1) : kbd).split('+').filter((part) => part !== '')
  const key = plusKey ? '+' : parts.pop()!.toLowerCase()
  const modifiers = parts.map((part) => (part === 'Mod' ? (platform === 'mac' ? 'Meta' : 'Ctrl') : part))
  return [...new Set(modifiers)].sort().concat(key === ' ' ? 'space' : key).join('+')
}

function scopesOf(entry: EditorAction): readonly Scope[] {
  const scope = entry.scope ?? 'global'
  return typeof scope === 'string' ? [scope] : scope
}

function overlap(a: readonly Scope[], b: readonly Scope[]): boolean {
  return a.includes('global') || b.includes('global') || a.some((scope) => b.includes(scope))
}

interface Binding {
  readonly id: string
  readonly chord: string
  readonly scopes: readonly Scope[]
}

function bindingsOf(registry: ActionRegistry, platform: Platform): Binding[] {
  return registry.all().flatMap((entry) => {
    const kbd = entry.kbdByPlatform?.[platform] ?? entry.kbd
    const aliases = kbd === undefined ? [] : typeof kbd === 'string' ? [kbd] : kbd
    return aliases.map((alias) => ({ id: entry.id, chord: chordOf(alias, platform), scopes: scopesOf(entry) }))
  })
}

/** Space pans and I passes pointer events to the design while held; CanvasView keeps both. */
const RESERVED_HELD_KEYS: readonly Binding[] = [
  { id: 'canvas: hold Space to pan', chord: 'space', scopes: ['canvas'] },
  { id: 'canvas: hold I to interact', chord: 'i', scopes: ['canvas'] },
]

describe('shortcut conflicts', () => {
  it('binds the canvas navigation keys as canvas-scoped actions', () => {
    const canvasChords = bindingsOf(createDefaultRegistry('mac'), 'mac')
      .filter((binding) => binding.scopes.length === 1 && binding.scopes[0] === 'canvas')
      .map((binding) => binding.chord)

    for (const kbd of ['V', 'H', 'Enter', 'Shift+Enter', 'Tab', 'Shift+Tab', 'Escape', 'Shift+1', 'Shift+2']) {
      expect(canvasChords).toContain(chordOf(kbd, 'mac'))
    }
  })

  it.each<[Platform, string, string]>([
    ['mac', 'arrange.bringToFront', 'Alt+Meta+]'],
    ['windows', 'arrange.bringToFront', 'Ctrl+Shift+]'],
    ['windows', 'arrange.sendToBack', 'Ctrl+Shift+['],
  ])('checks the keys the %s registry binds, %s on %s among them', (platform, id, chord) => {
    const bindings = bindingsOf(createDefaultRegistry(platform), platform)

    expect(bindings.filter((binding) => binding.id === id).map((binding) => binding.chord)).toEqual([chord])
  })

  it.each<Platform>(['mac', 'windows'])('binds no chord twice where the scopes overlap, nor a reserved held key (%s)', (platform) => {
    const bindings = [...RESERVED_HELD_KEYS, ...bindingsOf(createDefaultRegistry(platform), platform)]

    const conflicts = bindings.flatMap((a, i) =>
      bindings.slice(i + 1).flatMap((b) => (a.id !== b.id && a.chord === b.chord && overlap(a.scopes, b.scopes) ? [`${a.id} / ${b.id}: ${a.chord}`] : [])),
    )

    expect(conflicts).toEqual([])
  })
})

describe('shell slots', () => {
  it('hands a top-bar or overlay slot the context, the registry, the platform and the probe', () => {
    expectTypeOf<ShellSlotProps>().toEqualTypeOf<{
      readonly ctx: EditorContext
      readonly registry: ActionRegistry
      readonly platform: Platform
      readonly probe: ProbeClient | null
    }>()
    expectTypeOf<ShellSlot['place']>().toEqualTypeOf<'top-bar' | 'overlay'>()
    expectTypeOf<EditorAction['kbd']>().toEqualTypeOf<string | readonly string[] | undefined>()
    expectTypeOf<Parameters<EditorAction['run']>>().toEqualTypeOf<[ctx: EditorContext, actionId: string]>()
  })
})
