import type { Rect } from '../../shared/protocol'
import type { EdId } from '../../shared/types'
import { alignDeltas, axisOf, distributeDeltas, type AlignEdge } from '../canvas/align'
import { authoredValue, readMatchedRules, writeDecl, type MatchedRules } from '../canvas/authored'
import type { Axis } from '../canvas/snap'
import { parentNodeOf, shiftedOffset } from '../canvas/tools/move.tool'
import type { Point } from '../canvas/viewport'
import { isColumnDirection, isFlexDisplay } from '../panels/auto-layout'
import type { EditorAction, EditorContext } from '../plugin-api'

type Computed = Readonly<Record<string, string>>

interface PlacedBox {
  readonly edId: EdId
  readonly rect: Rect
  readonly computed: Computed
  readonly rules: MatchedRules
}

const ALIGN_REFUSAL = 'Align needs absolutely positioned elements, or a single flex child aligned across its row or column'
const DISTRIBUTE_REFUSAL = 'Distribute needs three or more absolutely positioned elements'

const BOX_PROPS = ['position', 'top', 'right', 'bottom', 'left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']
const PARENT_PROPS = ['display', 'flex-direction']
const PLAIN_OFFSET = /^-?\d*\.?\d+(?:px|%)?$/
const INSETS: Readonly<Record<Axis, readonly [start: string, end: string]>> = { x: ['left', 'right'], y: ['top', 'bottom'] }

const ALIGN_SELF: Readonly<Record<AlignEdge, string>> = {
  left: 'flex-start',
  centre: 'center',
  right: 'flex-end',
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
}

function selected(ctx: EditorContext): readonly EdId[] {
  return ctx.selection()?.edIds ?? []
}

const whileEditable = (ctx: EditorContext) => !ctx.readOnly() && selected(ctx).length > 0
const whileThreeEditable = (ctx: EditorContext) => !ctx.readOnly() && selected(ctx).length >= 3

async function readBox(ctx: EditorContext, edId: EdId): Promise<PlacedBox | null> {
  const [{ rects }, { values }, rules] = await Promise.all([
    ctx.read({ kind: 'rects', edId }),
    ctx.read({ kind: 'computed', edId, props: BOX_PROPS }),
    readMatchedRules(ctx, edId),
  ])
  return rects[0] ? { edId, rect: rects[0], computed: values, rules } : null
}

function isAbsolute(box: PlacedBox | null): box is PlacedBox {
  return box?.computed.position === 'absolute' || box?.computed.position === 'fixed'
}

function pxOf(value: string | undefined): number {
  return Number.parseFloat(value ?? '') || 0
}

/** An absolute box's containing block size on `axis`, recovered from its used insets and margins. */
function containingSizeOf(box: PlacedBox, axis: Axis): number {
  const size = axis === 'x' ? box.rect.width : box.rect.height
  return INSETS[axis].reduce((total, inset) => total + pxOf(box.computed[inset]) + pxOf(box.computed[`margin-${inset}`]), size)
}

/** Shifts the inset the box is anchored by, so a `right`-anchored box stays right-anchored. */
function shiftInset(ctx: EditorContext, box: PlacedBox, axis: Axis, delta: number, actionId: string): void {
  const [start, end] = INSETS[axis]
  const authored = (prop: string) => authoredValue(ctx, box.edId, prop, box.rules)
  const anchoredAtEnd = authored(start) === null && authored(end) !== null
  const prop = anchoredAtEnd ? end : start
  const value = authored(prop)
  const base = value !== null && PLAIN_OFFSET.test(value.trim()) ? value : (box.computed[prop] ?? '0')
  writeDecl(ctx, box.edId, prop, shiftedOffset(base, anchoredAtEnd ? -delta : delta, containingSizeOf(box, axis)), actionId)
}

function rectsOf(boxes: readonly PlacedBox[]): Rect[] {
  return boxes.map((box) => box.rect)
}

function moveBoxes(ctx: EditorContext, boxes: readonly PlacedBox[], deltas: readonly Point[], actionId: string): void {
  boxes.forEach((box, i) => {
    const { x, y } = deltas[i]!
    if (x !== 0) shiftInset(ctx, box, 'x', x, actionId)
    if (y !== 0) shiftInset(ctx, box, 'y', y, actionId)
  })
}

async function readParentLayout(ctx: EditorContext, edId: EdId): Promise<Computed> {
  const index = ctx.index()
  const parent = index && parentNodeOf(index.tree, edId)
  if (!parent) return {}
  return (await ctx.read({ kind: 'computed', edId: parent.edId, props: PARENT_PROPS })).values
}

/** A single flex child aligns itself along the cross axis only; the main axis belongs to the parent's `justify-content`. */
async function alignFlexChild(ctx: EditorContext, edId: EdId, edge: AlignEdge, actionId: string): Promise<boolean> {
  const parent = await readParentLayout(ctx, edId)
  if (!isFlexDisplay(parent.display ?? '')) return false
  const crossAxis: Axis = isColumnDirection(parent['flex-direction'] ?? 'row') ? 'x' : 'y'
  if (axisOf(edge) !== crossAxis) return false
  writeDecl(ctx, edId, 'align-self', ALIGN_SELF[edge], actionId)
  return true
}

async function align(ctx: EditorContext, edge: AlignEdge, actionId: string): Promise<void> {
  const edIds = selected(ctx)
  const boxes = await Promise.all(edIds.map((edId) => readBox(ctx, edId)))
  if (boxes.every(isAbsolute)) return moveBoxes(ctx, boxes, alignDeltas(rectsOf(boxes), edge), actionId)
  const aligned = edIds.length === 1 && (await alignFlexChild(ctx, edIds[0]!, edge, actionId))
  if (!aligned) ctx.toast({ message: ALIGN_REFUSAL, tone: 'info' })
}

async function distribute(ctx: EditorContext, axis: Axis, actionId: string): Promise<void> {
  const boxes = await Promise.all(selected(ctx).map((edId) => readBox(ctx, edId)))
  if (!boxes.every(isAbsolute)) return ctx.toast({ message: DISTRIBUTE_REFUSAL, tone: 'info' })
  moveBoxes(ctx, boxes, distributeDeltas(rectsOf(boxes), axis), actionId)
}

function alignAction(edge: AlignEdge, label: string, key: string): EditorAction {
  return {
    id: `align.${edge}`,
    label,
    kbd: `Alt+${key}`,
    disabledReason: ALIGN_REFUSAL,
    // A reload rejects the reads; the command is then dropped.
    run: (ctx, actionId) => void align(ctx, edge, actionId).catch(() => {}),
    when: whileEditable,
  }
}

function distributeAction(axis: Axis, label: string, key: string): EditorAction {
  return {
    id: `align.distribute-${axis}`,
    label,
    kbd: `Alt+Shift+${key}`,
    disabledReason: DISTRIBUTE_REFUSAL,
    run: (ctx, actionId) => void distribute(ctx, axis, actionId).catch(() => {}),
    when: whileThreeEditable,
  }
}

export const actions: EditorAction[] = [
  alignAction('left', 'Align left', 'A'),
  alignAction('centre', 'Align horizontal centres', 'H'),
  alignAction('right', 'Align right', 'D'),
  alignAction('top', 'Align top', 'W'),
  alignAction('middle', 'Align vertical centres', 'V'),
  alignAction('bottom', 'Align bottom', 'S'),
  distributeAction('x', 'Distribute horizontal spacing', 'H'),
  distributeAction('y', 'Distribute vertical spacing', 'V'),
]
