import { useEffect } from 'react'
import type { Platform } from '../actions/registry'
import type { ShellSlot, ShellSlotProps } from '../plugin-api'

/** Dispatched by the Electron Edit menu's Select All; cancelling it keeps the native select-all from running. */
const SELECT_ALL_EVENT = 'editor:select-all'

/** Mod-A as if pressed where focus is, so the registry applies its own text-field and text-editing rules. */
function modAAtFocus(platform: Platform): KeyboardEvent {
  const mod = platform === 'mac' ? { metaKey: true, ctrlKey: false } : { metaKey: false, ctrlKey: true }
  return {
    key: 'a',
    code: 'KeyA',
    ...mod,
    shiftKey: false,
    altKey: false,
    repeat: false,
    target: document.activeElement ?? document.body,
    preventDefault: () => {},
  } as unknown as KeyboardEvent
}

function MenuSelectAll({ ctx, registry, platform }: ShellSlotProps) {
  useEffect(() => {
    function onMenuSelectAll(event: Event) {
      if (registry.handleKeyDown(modAAtFocus(platform), ctx)) event.preventDefault()
    }

    window.addEventListener(SELECT_ALL_EVENT, onMenuSelectAll)
    return () => window.removeEventListener(SELECT_ALL_EVENT, onMenuSelectAll)
  }, [ctx, registry, platform])

  return null
}

export const slots: readonly ShellSlot[] = [{ id: 'menu-select-all', place: 'overlay', component: MenuSelectAll }]
