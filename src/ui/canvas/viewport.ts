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

/** Room kept clear on each side of a fitted rect, in screen px. */
export interface Insets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

const MIN_ZOOM = 0.02
const MAX_ZOOM = 64
const FIT_MARGIN = 24
const EVEN_MARGIN: Insets = { top: FIT_MARGIN, right: FIT_MARGIN, bottom: FIT_MARGIN, left: FIT_MARGIN }
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

/** The viewport that shows `rect` whole and centred in what `insets` leave of `container`. */
export function fitRect(rect: Rect, container: Size, insets: Insets = EVEN_MARGIN): Viewport {
  const room = { width: container.width - insets.left - insets.right, height: container.height - insets.top - insets.bottom }
  const zoom = clampZoom(Math.min(room.width / rect.width, room.height / rect.height))
  return {
    zoom,
    panX: insets.left + room.width / 2 - (rect.x + rect.width / 2) * zoom,
    panY: insets.top + room.height / 2 - (rect.y + rect.height / 2) * zoom,
  }
}

/** The viewport at `zoom`, keeping the board point at the centre of `container` where it is. */
export function zoomTo(viewport: Viewport, zoom: number, container: Size): Viewport {
  return zoomAt(viewport, clampZoom(zoom) / viewport.zoom, { x: container.width / 2, y: container.height / 2 })
}

export function wheelZoomFactor(deltaY: number): number {
  return 2 ** (-deltaY / WHEEL_DELTA_PER_DOUBLING)
}

export function viewportTransform(viewport: Viewport): string {
  return `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`
}
