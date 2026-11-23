/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest'
import { createActionRegistry, createDefaultRegistry, type ActionModule } from '../../src/ui/actions/registry'
import type { EditorAction, EditorContext } from '../../src/ui/plugin-api'

const ctx = {} as EditorContext

type Modifiers = Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>>

function keydown(key: string, modifiers: Modifiers = {}) {
  const preventDefault = vi.fn()
  const event = { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers, preventDefault }
  return { event: event as unknown as KeyboardEvent, preventDefault }
}

function action(id: string, kbd?: string, when?: EditorAction['when']) {
  const run = vi.fn<(context: EditorContext) => void>()
  const entry: EditorAction = { id, label: id, run, ...(kbd ? { kbd } : {}), ...(when ? { when } : {}) }
  return { entry, run }
}

function modulesOf(...actions: EditorAction[]): Record<string, ActionModule> {
  return { './test.actions.ts': { actions } }
}

describe('holding actions', () => {
  it('holds every action from every module, looked up by id', () => {
    const duplicate = action('layer.duplicate', 'Mod+D')
    const remove = action('layer.delete', 'Delete')
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
    const duplicate = action('layer.duplicate', 'Mod+D')
    const registry = createActionRegistry(modulesOf(duplicate.entry), 'mac')

    const withCtrl = keydown('d', { ctrlKey: true })
    expect(registry.handleKeyDown(withCtrl.event, ctx)).toBe(false)
    expect(duplicate.run).not.toHaveBeenCalled()
    expect(withCtrl.preventDefault).not.toHaveBeenCalled()

    const withCmd = keydown('d', { metaKey: true })
    expect(registry.handleKeyDown(withCmd.event, ctx)).toBe(true)
    expect(duplicate.run).toHaveBeenCalledExactlyOnceWith(ctx)
    expect(withCmd.preventDefault).toHaveBeenCalled()
  })

  it('reads Mod as Ctrl on Windows', () => {
    const duplicate = action('layer.duplicate', 'Mod+D')
    const registry = createActionRegistry(modulesOf(duplicate.entry), 'windows')

    expect(registry.handleKeyDown(keydown('d', { metaKey: true }).event, ctx)).toBe(false)
    expect(duplicate.run).not.toHaveBeenCalled()

    expect(registry.handleKeyDown(keydown('d', { ctrlKey: true }).event, ctx)).toBe(true)
    expect(duplicate.run).toHaveBeenCalledExactlyOnceWith(ctx)
  })

  it('matches the modifiers exactly', () => {
    const duplicate = action('layer.duplicate', 'Mod+D')
    const groupAll = action('layer.group', 'Mod+Shift+G')
    const remove = action('layer.delete', 'Delete')
    const registry = createActionRegistry(modulesOf(duplicate.entry, groupAll.entry, remove.entry), 'mac')

    expect(registry.handleKeyDown(keydown('d').event, ctx)).toBe(false)
    expect(registry.handleKeyDown(keydown('d', { metaKey: true, shiftKey: true }).event, ctx)).toBe(false)
    expect(registry.handleKeyDown(keydown('g', { metaKey: true }).event, ctx)).toBe(false)
    expect(registry.handleKeyDown(keydown('Delete', { metaKey: true }).event, ctx)).toBe(false)
    expect(duplicate.run).not.toHaveBeenCalled()
    expect(groupAll.run).not.toHaveBeenCalled()
    expect(remove.run).not.toHaveBeenCalled()

    expect(registry.handleKeyDown(keydown('g', { metaKey: true, shiftKey: true }).event, ctx)).toBe(true)
    expect(registry.handleKeyDown(keydown('Delete').event, ctx)).toBe(true)
    expect(groupAll.run).toHaveBeenCalledOnce()
    expect(remove.run).toHaveBeenCalledOnce()
  })

  it('skips an action whose when() is false for the context', () => {
    const when = vi.fn<(context: EditorContext) => boolean>(() => false)
    const duplicate = action('layer.duplicate', 'Mod+D', when)
    const registry = createActionRegistry(modulesOf(duplicate.entry), 'mac')

    expect(registry.handleKeyDown(keydown('d', { metaKey: true }).event, ctx)).toBe(false)
    expect(when).toHaveBeenCalledWith(ctx)
    expect(duplicate.run).not.toHaveBeenCalled()
  })

  it('suspends shortcuts while text editing', () => {
    const duplicate = action('layer.duplicate', 'Mod+D')
    const registry = createActionRegistry(modulesOf(duplicate.entry), 'mac')

    registry.setTextEditing(true)
    const whileEditing = keydown('d', { metaKey: true })

    expect(registry.handleKeyDown(whileEditing.event, ctx)).toBe(false)
    expect(duplicate.run).not.toHaveBeenCalled()
    expect(whileEditing.preventDefault).not.toHaveBeenCalled()

    registry.setTextEditing(false)

    expect(registry.handleKeyDown(keydown('d', { metaKey: true }).event, ctx)).toBe(true)
    expect(duplicate.run).toHaveBeenCalledOnce()
  })
})
