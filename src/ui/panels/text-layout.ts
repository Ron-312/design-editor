import type { LayoutWrite } from './auto-layout'

/** Figma's text resizing: auto width grows the line, auto height wraps at a fixed width, fixed sets both. */
export type ResizingMode = 'auto-width' | 'auto-height' | 'fixed'

export interface MeasuredBox {
  readonly width: number
  readonly height: number
}

type AuthoredLookup = (prop: string) => string | null

const NO_WRAP = 'nowrap'
const LINE_CLAMP_PROPS = ['display', '-webkit-line-clamp', '-webkit-box-orient', 'overflow'] as const
const LAYOUT_DISPLAYS = new Set(['flex', 'inline-flex', 'grid', 'inline-grid'])

function removals(props: readonly string[], authored: AuthoredLookup): LayoutWrite[] {
  return props.filter((prop) => authored(prop) !== null).map((prop) => ({ prop, value: null }))
}

const px = (length: number) => `${Math.round(length)}px`

/** Null when the authored declarations match no mode, such as a block that fills its container. */
export function resizingModeOf(authored: AuthoredLookup): ResizingMode | null {
  const width = authored('width')
  if (width === null) return authored('white-space') === NO_WRAP ? 'auto-width' : null
  return authored('height') === null ? 'auto-height' : 'fixed'
}

function unwrapped(authored: AuthoredLookup): LayoutWrite[] {
  return authored('white-space') === NO_WRAP ? [{ prop: 'white-space', value: null }] : []
}

function fixedSize(axis: keyof MeasuredBox, authored: AuthoredLookup, measured: MeasuredBox): LayoutWrite[] {
  return authored(axis) === null ? [{ prop: axis, value: px(measured[axis]) }] : []
}

/** Auto width also drops the height, so the box hugs its one line both ways. */
export function resizingWrites(mode: ResizingMode, authored: AuthoredLookup, measured: MeasuredBox): LayoutWrite[] {
  if (mode === 'auto-width') {
    const noWrap = authored('white-space') === NO_WRAP ? [] : [{ prop: 'white-space', value: NO_WRAP }]
    return [...noWrap, ...removals(['width', 'height'], authored)]
  }
  const width = fixedSize('width', authored, measured)
  if (mode === 'auto-height') return [...width, ...removals(['height'], authored), ...unwrapped(authored)]
  return [...width, ...fixedSize('height', authored, measured), ...unwrapped(authored)]
}

export function lineClampWrites(lines: number): LayoutWrite[] {
  return [
    { prop: 'display', value: '-webkit-box' },
    { prop: '-webkit-line-clamp', value: String(lines) },
    { prop: '-webkit-box-orient', value: 'vertical' },
    { prop: 'overflow', value: 'hidden' },
  ]
}

export function lineClampRemovals(authored: AuthoredLookup): LayoutWrite[] {
  return removals(LINE_CLAMP_PROPS, authored)
}

/** The block needs `display: -webkit-box`, which drops a flex or grid layout. */
export function lineClampWarning(display: string): string | null {
  return LAYOUT_DISPLAYS.has(display) ? `Max lines replaced display: ${display} with -webkit-box` : null
}
