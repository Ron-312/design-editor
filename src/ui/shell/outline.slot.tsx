import { useEffect, useSyncExternalStore } from 'react'
import { isOutlineMode, onOutlineModeChange } from '../actions/view.actions'
import type { ShellSlot, ShellSlotProps } from '../plugin-api'

const HIDDEN_PAINT = `
  background-color: transparent !important;
  background-image: none !important;
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
`

const OUTLINE_STYLESHEET = `
* {
  outline: 1px solid rgb(128 128 128 / 0.7) !important;
  outline-offset: -1px !important;
  ${HIDDEN_PAINT}
}
*::before, *::after {
  ${HIDDEN_PAINT}
}
`

function OutlineStyles({ probe }: ShellSlotProps) {
  const outlined = useSyncExternalStore(onOutlineModeChange, isOutlineMode)

  useEffect(() => {
    if (!probe) return
    probe.setEditorStyles(outlined ? OUTLINE_STYLESHEET : null)
    if (!outlined) return
    // Every structural op reloads the frame, and the reloaded document has lost the stylesheet.
    return probe.onMessage((message) => {
      if (message.type === 'ready') probe.setEditorStyles(OUTLINE_STYLESHEET)
    })
  }, [probe, outlined])

  return null
}

export const slots: ShellSlot[] = [{ id: 'outline-mode', place: 'overlay', component: OutlineStyles }]
