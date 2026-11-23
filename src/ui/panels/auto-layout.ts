/** Auto Layout mapped to flexbox, per plans/v1/research/02-layout-to-css.md and the R08 corrections. */

export type Axis = 'width' | 'height'
export type SizingMode = 'hug' | 'fill' | 'fixed'

/** One declaration to set, or to remove when `value` is null. */
export interface LayoutWrite {
  readonly prop: string
  readonly value: string | null
}

export interface Alignment {
  readonly justifyContent: string
  readonly alignItems: string
}

/** What the sizing control reads from one flex item. */
export interface ItemSizing {
  /** Computed `flex-grow`, `flex-basis` and `align-self`. */
  readonly flexGrow: string
  readonly flexBasis: string
  readonly alignSelf: string
  /** The authored `width` or `height` on the axis. */
  readonly authoredSize: string | null
}

export function isFlexDisplay(display: string): boolean {
  return display === 'flex' || display === 'inline-flex'
}

export function isColumnDirection(direction: string): boolean {
  return direction.startsWith('column')
}

export function mainAxisOf(direction: string): Axis {
  return isColumnDirection(direction) ? 'height' : 'width'
}

/** `align-items: normal` behaves as stretch, and stretch has no cell in the nine (R02 §1, R08 #9). */
export function isStretchAlignment(alignItems: string): boolean {
  return alignItems === 'normal' || alignItems === 'stretch'
}

const CELL_VALUES = ['flex-start', 'center', 'flex-end'] as const

/** Computed values as well as authored ones: current Chromium serialises `flex-end` as `flow-end`. */
const CELL_POSITION: Readonly<Record<string, number>> = {
  normal: 0,
  'flow-start': 0,
  start: 0,
  'flex-start': 0,
  'self-start': 0,
  left: 0,
  center: 1,
  end: 2,
  'flow-end': 2,
  'flex-end': 2,
  'self-end': 2,
  right: 2,
}

export const CELL_NAMES = [
  'Top left',
  'Top centre',
  'Top right',
  'Middle left',
  'Centre',
  'Middle right',
  'Bottom left',
  'Bottom centre',
  'Bottom right',
] as const

/** The cell (row-major from the top left) the alignment shows; null for stretch, baseline or a `space-*` distribution. */
export function alignmentCell(direction: string, { justifyContent, alignItems }: Alignment): number | null {
  if (isStretchAlignment(alignItems)) return null
  const main = CELL_POSITION[justifyContent]
  const cross = CELL_POSITION[alignItems]
  if (main === undefined || cross === undefined) return null
  const [x, y] = isColumnDirection(direction) ? [cross, main] : [main, cross]
  return y * 3 + x
}

/** In a row the x axis is `justify-content`; in a column the axes swap. */
export function cellAlignment(direction: string, cell: number): Alignment {
  const [x, y] = [cell % 3, Math.floor(cell / 3)]
  const [main, cross] = isColumnDirection(direction) ? [y, x] : [x, y]
  return { justifyContent: CELL_VALUES[main]!, alignItems: CELL_VALUES[cross]! }
}

const ZERO_LENGTH = /^0(?:\.0*)?[a-z%]*$/i

/** Fill is `flex-grow > 0` with a zero basis whatever the shrink (R08 #10); on the cross axis it is `align-self: stretch`. */
export function sizingModeOf(onMain: boolean, item: ItemSizing): SizingMode {
  const fills = onMain ? Number(item.flexGrow) > 0 && ZERO_LENGTH.test(item.flexBasis) : item.alignSelf === 'stretch'
  if (fills) return 'fill'
  return item.authoredSize !== null && item.authoredSize !== 'auto' ? 'fixed' : 'hug'
}

const MIN_OF: Readonly<Record<Axis, string>> = { width: 'min-width', height: 'min-height' }
const OVERFLOW_GUARD = '0'

type AuthoredLookup = (prop: string) => string | null

function removals(props: readonly string[], authored: AuthoredLookup): LayoutWrite[] {
  return props.filter((prop) => authored(prop) !== null).map((prop) => ({ prop, value: null }))
}

function fillRemovals(axis: Axis, onMain: boolean, authored: AuthoredLookup): LayoutWrite[] {
  if (!onMain) return removals(['align-self'], authored)
  const guard = authored(MIN_OF[axis]) === OVERFLOW_GUARD ? [MIN_OF[axis]] : []
  return removals(['flex', 'flex-grow', 'flex-basis', ...guard], authored)
}

/**
 * The declarations that switch one item to `mode` on `axis`. Fill is `flex: 1 1 0` plus the `min-*: 0`
 * overflow guard on the main axis and `align-self: stretch` on the cross axis; Fixed keeps an authored
 * size or writes the measured one, and adds `flex-shrink: 0` on the main axis as editor policy; Hug
 * removes what the other two wrote.
 */
export function sizingWrites(mode: SizingMode, axis: Axis, onMain: boolean, authored: AuthoredLookup, measured: number): LayoutWrite[] {
  if (mode === 'fill') {
    return onMain
      ? [
          { prop: 'flex', value: '1 1 0' },
          { prop: MIN_OF[axis], value: OVERFLOW_GUARD },
        ]
      : [{ prop: 'align-self', value: 'stretch' }]
  }
  const leaveFill = fillRemovals(axis, onMain, authored)
  if (mode === 'hug') return [...leaveFill, ...removals(onMain ? [axis, 'flex-shrink'] : [axis], authored)]
  const size = authored(axis) === null ? [{ prop: axis, value: `${Math.round(measured)}px` }] : []
  return [...leaveFill, ...size, ...(onMain ? [{ prop: 'flex-shrink', value: '0' }] : [])]
}
