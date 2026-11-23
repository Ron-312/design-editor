import type { Rect } from '../../shared/protocol'
import type { Viewport } from '../plugin-api'

/** A rect in viewport (screen) pixels, ready for absolute positioning. */
export interface ScreenBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export function screenBoxOf(viewport: Viewport, rect: Rect): ScreenBox {
  return {
    left: viewport.panX + rect.x * viewport.zoom,
    top: viewport.panY + rect.y * viewport.zoom,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  }
}

export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
