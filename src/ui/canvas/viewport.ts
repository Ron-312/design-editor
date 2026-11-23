import type { Rect } from '../../shared/protocol'
import type { Viewport } from '../plugin-api'

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

const MIN_ZOOM = 0.02
const MAX_ZOOM = 64
const FIT_MARGIN = 24
/** Wheel delta that doubles (or halves) the zoom. */
const WHEEL_DELTA_PER_DOUBLING = 200

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function boardToScreen(viewport: Viewport, point: Point): Point {
  return { x: viewport.panX + point.x * viewport.zoom, y: viewport.panY + point.y * viewport.zoom }
}

export function screenToBoard(viewport: Viewport, point: Point): Point {
  return { x: (point.x - viewport.panX) / viewport.zoom, y: (point.y - viewport.panY) / viewport.zoom }
}

/** Scales the zoom by `factor`, keeping the board point under `cursor` where it is. */
export function zoomAt(viewport: Viewport, factor: number, cursor: Point): Viewport {
  const zoom = clampZoom(viewport.zoom * factor)
  const scale = zoom / viewport.zoom
  return { zoom, panX: cursor.x - (cursor.x - viewport.panX) * scale, panY: cursor.y - (cursor.y - viewport.panY) * scale }
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { zoom: viewport.zoom, panX: viewport.panX + dx, panY: viewport.panY + dy }
}

/** The viewport that shows `rect` whole and centred in `container`, with a margin. */
export function fitRect(rect: Rect, container: Size): Viewport {
  const zoom = clampZoom(
    Math.min((container.width - 2 * FIT_MARGIN) / rect.width, (container.height - 2 * FIT_MARGIN) / rect.height),
  )
  return {
    zoom,
    panX: container.width / 2 - (rect.x + rect.width / 2) * zoom,
    panY: container.height / 2 - (rect.y + rect.height / 2) * zoom,
  }
}

export function wheelZoomFactor(deltaY: number): number {
  return 2 ** (-deltaY / WHEEL_DELTA_PER_DOUBLING)
}

export function viewportTransform(viewport: Viewport): string {
  return `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`
}
