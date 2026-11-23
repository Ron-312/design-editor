import { stepZoom, type Size } from '../canvas/viewport'
import type { EditorAction, EditorContext, Unsubscribe } from '../plugin-api'

const CANVAS_VIEWPORT = '[data-canvas-viewport]'

function canvasSize(): Size {
  const canvas = document.querySelector<HTMLElement>(CANVAS_VIEWPORT)
  return { width: canvas?.clientWidth ?? 0, height: canvas?.clientHeight ?? 0 }
}

function zoomStep(direction: 'in' | 'out') {
  return (ctx: EditorContext) => ctx.setViewport(stepZoom(ctx.viewport(), direction, canvasSize()))
}

let outlineMode = false
const outlineListeners = new Set<() => void>()

/** Outline mode lives only in this editor session: never saved, never written. */
export function isOutlineMode(): boolean {
  return outlineMode
}

export function onOutlineModeChange(listener: () => void): Unsubscribe {
  outlineListeners.add(listener)
  return () => outlineListeners.delete(listener)
}

function toggleOutlineMode(): void {
  outlineMode = !outlineMode
  outlineListeners.forEach((listener) => listener())
}

export const actions: EditorAction[] = [
  { id: 'view.zoom100', label: 'Zoom to 100%', kbd: 'Shift+0', scope: ['canvas', 'layers'], run: (ctx) => ctx.fit('100') },
  { id: 'view.zoomIn', label: 'Zoom in', kbd: ['Mod+=', 'Mod++'], run: zoomStep('in') },
  { id: 'view.zoomOut', label: 'Zoom out', kbd: 'Mod+-', run: zoomStep('out') },
  { id: 'view.outline', label: 'Toggle outline mode', kbd: 'Mod+Shift+O', run: toggleOutlineMode },
]
