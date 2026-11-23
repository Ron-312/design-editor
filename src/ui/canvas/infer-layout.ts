import type { Rect } from '../../shared/protocol'

export type LayoutDirection = 'row' | 'column'

export interface AutoLayout {
  readonly direction: LayoutDirection
  /** Px between neighbouring boxes, never negative. */
  readonly gap: number
}

type Computed = Readonly<Record<string, string>>

const px = (value: string | undefined) => Number.parseFloat(value ?? '') || 0

/** Flex does not collapse margins, so spaces are measured between margin boxes. */
export function marginBoxOf(border: Rect, computed: Computed): Rect {
  const top = px(computed['margin-top'])
  const right = px(computed['margin-right'])
  const bottom = px(computed['margin-bottom'])
  const left = px(computed['margin-left'])
  return { x: border.x - left, y: border.y - top, width: border.width + left + right, height: border.height + top + bottom }
}

function spreadOf(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values)
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function directionOf(boxes: readonly Rect[]): LayoutDirection {
  const across = spreadOf(boxes.map((box) => box.x + box.width / 2))
  const down = spreadOf(boxes.map((box) => box.y + box.height / 2))
  return across >= down ? 'row' : 'column'
}

function spacesAlong(boxes: readonly Rect[], direction: LayoutDirection): number[] {
  const start = (box: Rect) => (direction === 'row' ? box.x : box.y)
  const end = (box: Rect) => (direction === 'row' ? box.x + box.width : box.y + box.height)
  const ordered = [...boxes].sort((a, b) => start(a) - start(b))
  return ordered.slice(1).map((box, i) => start(box) - end(ordered[i]!))
}

/** A row when the boxes' centres spread more horizontally, with the median space between neighbours as the gap. */
export function inferAutoLayout(boxes: readonly Rect[]): AutoLayout {
  const direction = directionOf(boxes)
  const spaces = spacesAlong(boxes, direction)
  const gap = spaces.length === 0 ? 0 : Math.max(0, Math.round(median(spaces) * 100) / 100)
  return { direction, gap }
}
