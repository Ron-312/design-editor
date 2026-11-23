import type { Rect } from '../../../shared/protocol'
import type { EdId } from '../../../shared/types'
import type { CanvasPointer, CanvasTool, EditorContext } from '../../plugin-api'
import { authoredValue, readMatchedRules, writeDecl, type MatchedRules } from '../authored'
import { screenBoxOf, type ScreenBox } from '../overlay'
import { snapEdges, type Axis, type Edge, type Snap, type SnapGuide, type SnapTargets } from '../snap'
import { toAuthoredUnit, type UnitBasis } from '../units'
import type { Point } from '../viewport'
import { drawLayer, lineBox, onSelectedBox, overlayMark, parentNodeOf, remeasureSelection, selectedBox, trackSelection, type SelectedBox } from './move.tool'

export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

export type ResizeHandle = (typeof RESIZE_HANDLES)[number]

type BoxSizing = 'content-box' | 'border-box'

type Computed = Readonly<Record<string, string>>

interface SizingPlan {
  readonly boxSizing: BoxSizing
  readonly horizontalInsets: number
  readonly verticalInsets: number
  readonly flexAxis: Axis | null
  readonly absolute: boolean
  readonly computed: Computed
  readonly rules: MatchedRules
  readonly rootFontSize: number
  readonly containing: Rect
  readonly targets: SnapTargets
}

interface Resize {
  readonly ctx: EditorContext
  readonly edId: EdId
  readonly actionId: string
  readonly handle: ResizeHandle
  readonly start: Rect
  readonly fromBoard: Point
  last: CanvasPointer | null
  plan: SizingPlan | null
}

interface Resized {
  readonly box: Rect
  readonly guides: readonly SnapGuide[]
}

const HANDLE_PX = 8
const ROOT_RESIZE = 'Resize the frame in Claude Design'
const FLEX_OVERRIDES = 'Flex sizing overrides this size; set flex-shrink or flex-grow to 0 to keep it'
const UNIT_FALLBACK = 'Resize wrote px: calc() and viewport units cannot be converted'
const FLEX_DISPLAYS = ['flex', 'inline-flex']
const ABSOLUTE_POSITIONS = ['absolute', 'fixed']
const BOX_PROPS = [
  'box-sizing',
  'padding-left',
  'padding-right',
  'padding-top',
  'padding-bottom',
  'border-left-width',
  'border-right-width',
  'border-top-width',
  'border-bottom-width',
]
const INSET_PROPS = ['left', 'right', 'top', 'bottom', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom']
const SELF_PROPS = [...BOX_PROPS, ...INSET_PROPS, 'position', 'font-size']
const PARENT_PROPS = [...BOX_PROPS, 'display', 'flex-direction', 'width', 'height']
const NO_SNAP: Snap = { dx: 0, dy: 0, guides: [] }
const HANDLES_LAYER = 'resize-handles'
const DRAG_LAYER = 'resize'

/** The edges a handle drags move by the delta; the opposite edges stay put. */
export function resizedBox(box: Rect, handle: ResizeHandle, delta: Point): Rect {
  const left = handle.includes('w') ? delta.x : 0
  const right = handle.includes('e') ? delta.x : 0
  const top = handle.includes('n') ? delta.y : 0
  const bottom = handle.includes('s') ? delta.y : 0
  return { x: box.x + left, y: box.y + top, width: box.width - left + right, height: box.height - top + bottom }
}

function draggedEdges(handle: ResizeHandle): Edge[] {
  const edges: Array<[string, Edge]> = [
    ['w', 'left'],
    ['e', 'right'],
    ['n', 'top'],
    ['s', 'bottom'],
  ]
  return edges.flatMap(([letter, edge]) => (handle.includes(letter) ? [edge] : []))
}

/** Grows the opposite edges by as much as the dragged ones, so the centre stays put. */
function centredBox(start: Rect, resized: Rect): Rect {
  const grownX = resized.width - start.width
  const grownY = resized.height - start.height
  return { x: start.x - grownX, y: start.y - grownY, width: start.width + grownX * 2, height: start.height + grownY * 2 }
}

/** Scales `start` by whichever axis of `resized` moved further, anchored where the handle's opposite side is. */
function aspectKeptBox(start: Rect, resized: Rect, handle: ResizeHandle, centred: boolean): Rect {
  if (!start.width || !start.height) return resized
  const scaleX = resized.width / start.width
  const scaleY = resized.height / start.height
  const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY
  const width = start.width * scale
  const height = start.height * scale
  if (centred) return { x: start.x + (start.width - width) / 2, y: start.y + (start.height - height) / 2, width, height }
  const x = handle.includes('w') ? start.x + start.width - width : start.x
  const y = handle.includes('n') ? start.y + start.height - height : start.y
  return { x, y, width, height }
}

/** The `width` / `height` value that gives a rendered border box of `borderBox`. */
export function cssSizeFor(borderBox: number, boxSizing: BoxSizing, paddingAndBorder: number): number {
  return boxSizing === 'content-box' ? borderBox - paddingAndBorder : borderBox
}

function handlePoint(box: ScreenBox, handle: ResizeHandle): Point {
  const x = handle.includes('w') ? box.left : handle.includes('e') ? box.left + box.width : box.left + box.width / 2
  const y = handle.includes('n') ? box.top : handle.includes('s') ? box.top + box.height : box.top + box.height / 2
  return { x, y }
}

function isArtboardRoot(ctx: EditorContext, edId: EdId): boolean {
  return ctx.index()?.tree.edId === edId
}

function handleMark(box: ScreenBox, handle: ResizeHandle, disabled: boolean): HTMLElement {
  const at = handlePoint(box, handle)
  const square = { left: at.x - HANDLE_PX / 2, top: at.y - HANDLE_PX / 2, width: HANDLE_PX, height: HANDLE_PX }
  const attrs = disabled ? { 'data-resize-handle': handle, 'aria-disabled': 'true', title: ROOT_RESIZE } : { 'data-resize-handle': handle }
  return overlayMark(attrs, square, { background: '#fff', border: '1px solid var(--sel)', opacity: disabled ? '0.45' : '1' })
}

function drawHandles(ctx: EditorContext, selected: SelectedBox | null): void {
  if (!selected) return drawLayer(HANDLES_LAYER, [])
  const box = screenBoxOf(ctx.viewport(), selected.rect)
  const disabled = isArtboardRoot(ctx, selected.edId)
  drawLayer(HANDLES_LAYER, RESIZE_HANDLES.map((handle) => handleMark(box, handle, disabled)))
}

function handleUnder(ctx: EditorContext, selected: SelectedBox, pointer: CanvasPointer): ResizeHandle | undefined {
  const box = screenBoxOf(ctx.viewport(), selected.rect)
  return RESIZE_HANDLES.find((handle) => {
    const at = handlePoint(box, handle)
    return Math.abs(at.x - pointer.x) <= HANDLE_PX && Math.abs(at.y - pointer.y) <= HANDLE_PX
  })
}

function pxOf(value: string | undefined): number {
  return Number.parseFloat(value ?? '') || 0
}

/** A box's inner size along both axes: its computed width / height, less padding and border under border-box. */
function contentBoxOf(computed: Computed): Rect {
  const value = (prop: string) => pxOf(computed[prop])
  const borderBox = computed['box-sizing'] === 'border-box'
  const insetsX = value('padding-left') + value('padding-right') + value('border-left-width') + value('border-right-width')
  const insetsY = value('padding-top') + value('padding-bottom') + value('border-top-width') + value('border-bottom-width')
  return { x: 0, y: 0, width: value('width') - (borderBox ? insetsX : 0), height: value('height') - (borderBox ? insetsY : 0) }
}

/** An absolute element's containing block, recovered from its used insets and margins. */
function containingBlockOf(self: Rect, computed: Computed): Rect {
  const value = (prop: string) => pxOf(computed[prop])
  const left = value('left') + value('margin-left')
  const right = value('right') + value('margin-right')
  const top = value('top') + value('margin-top')
  const bottom = value('bottom') + value('margin-bottom')
  return { x: self.x - left, y: self.y - top, width: left + self.width + right, height: top + self.height + bottom }
}

const NO_VALUES: Computed = {}

async function readSizingPlan(ctx: EditorContext, edId: EdId): Promise<SizingPlan> {
  const tree = ctx.index()?.tree
  const parent = tree ? parentNodeOf(tree, edId) : null
  const [self, parentStyle, root, rects, rules] = await Promise.all([
    ctx.read({ kind: 'computed', edId, props: SELF_PROPS }),
    parent ? ctx.read({ kind: 'computed', edId: parent.edId, props: PARENT_PROPS }) : null,
    ctx.read({ kind: 'rootFontSize' }),
    ctx.read({ kind: 'snapRects', edId }),
    readMatchedRules(ctx, edId),
  ])
  const computed = self.values
  const value = (prop: string) => pxOf(computed[prop])
  const parentValues = parentStyle?.values ?? NO_VALUES
  const absolute = ABSOLUTE_POSITIONS.includes(computed.position ?? '')
  return {
    boxSizing: computed['box-sizing'] === 'border-box' ? 'border-box' : 'content-box',
    horizontalInsets: value('padding-left') + value('padding-right') + value('border-left-width') + value('border-right-width'),
    verticalInsets: value('padding-top') + value('padding-bottom') + value('border-top-width') + value('border-bottom-width'),
    flexAxis: FLEX_DISPLAYS.includes(parentValues.display ?? '') ? (parentValues['flex-direction']?.startsWith('column') ? 'y' : 'x') : null,
    absolute,
    computed,
    rules,
    rootFontSize: root.fontSize,
    containing: absolute ? containingBlockOf(rects.self, computed) : contentBoxOf(parentValues),
    targets: rects,
  }
}

function basisOf(plan: SizingPlan, axis: Axis): UnitBasis {
  return {
    rootFontSize: plan.rootFontSize,
    fontSize: pxOf(plan.computed['font-size']),
    containingSize: axis === 'x' ? plan.containing.width : plan.containing.height,
  }
}

function resizedFor(resize: Resize, pointer: CanvasPointer): Resized {
  const { ctx, handle, start, plan } = resize
  const delta = { x: pointer.boardX - resize.fromBoard.x, y: pointer.boardY - resize.fromBoard.y }
  const snap = plan && !pointer.ctrlKey ? snapEdges(resizedBox(start, handle, delta), draggedEdges(handle), plan.targets, ctx.viewport().zoom) : NO_SNAP
  const dragged = resizedBox(start, handle, { x: delta.x + snap.dx, y: delta.y + snap.dy })
  const centred = pointer.altKey && !!plan?.absolute
  const box = centred ? centredBox(start, dragged) : dragged
  return { box: pointer.shiftKey ? aspectKeptBox(start, box, handle, centred) : box, guides: snap.guides }
}

function sizeLabel(box: Rect): string {
  return `${Math.round(box.width)} × ${Math.round(box.height)}`
}

function guideMark(ctx: EditorContext, guide: SnapGuide): HTMLElement {
  const rect =
    guide.axis === 'x'
      ? { x: guide.at, y: guide.from, width: 0, height: guide.to - guide.from }
      : { x: guide.from, y: guide.at, width: guide.to - guide.from, height: 0 }
  return overlayMark({ 'data-snap-guide': guide.axis }, lineBox(screenBoxOf(ctx.viewport(), rect)), { background: 'var(--guide)' })
}

function drawResize(ctx: EditorContext, resized: Resized): void {
  const box = screenBoxOf(ctx.viewport(), resized.box)
  const outline = overlayMark({ 'data-resize-ghost': '' }, box, { border: '1px solid var(--sel)' })
  const label = overlayMark({ 'data-size-label': '' }, { left: box.left, top: box.top + box.height + 6, width: box.width, height: 18 }, {
    display: 'flex',
    justifyContent: 'center',
  })
  const text = document.createElement('span')
  text.textContent = sizeLabel(resized.box)
  Object.assign(text.style, { padding: '1px 6px', borderRadius: '4px', background: 'var(--sel)', color: 'var(--sel-ink)', font: '600 11px/16px system-ui, sans-serif' })
  label.append(text)
  drawLayer(DRAG_LAYER, [outline, label, ...resized.guides.map((guide) => guideMark(ctx, guide))])
}

/** Writes `px` in the property's authored unit; returns false when it had to fall back to px. */
function writeLength(resize: Resize, plan: SizingPlan, prop: string, axis: Axis, px: number): boolean {
  const converted = toAuthoredUnit(px, authoredValue(resize.ctx, resize.edId, prop, plan.rules), basisOf(plan, axis))
  writeDecl(resize.ctx, resize.edId, prop, converted ?? `${Math.round(px)}px`, resize.actionId)
  return converted !== null
}

/** Writes the inset the element is anchored by, so a `right`-anchored element stays right-anchored. */
function writeInset(resize: Resize, plan: SizingPlan, axis: Axis, box: Rect): boolean {
  const [start, end] = axis === 'x' ? (['left', 'right'] as const) : (['top', 'bottom'] as const)
  const authored = (prop: string) => authoredValue(resize.ctx, resize.edId, prop, plan.rules)
  const anchoredAtEnd = authored(start) === null && authored(end) !== null
  const startMoved = axis === 'x' ? box.x - resize.start.x : box.y - resize.start.y
  const endMoved = axis === 'x' ? box.x + box.width - resize.start.x - resize.start.width : box.y + box.height - resize.start.y - resize.start.height
  const prop = anchoredAtEnd ? end : start
  const inset = pxOf(plan.computed[prop]) + (anchoredAtEnd ? -endMoved : startMoved)
  return writeLength(resize, plan, prop, axis, inset)
}

/** The preview has landed by the time the read is answered, so a differing size means flex sizing won. */
async function warnIfFlexOverrides(ctx: EditorContext, edId: EdId, axis: 'x' | 'y', expected: Rect): Promise<void> {
  const { rects } = await ctx.read({ kind: 'rects', edId })
  const rendered = rects[0]
  if (!rendered) return
  const size = (rect: Rect) => (axis === 'x' ? rect.width : rect.height)
  if (Math.abs(size(rendered) - size(expected)) > 0.5) ctx.toast({ message: FLEX_OVERRIDES, tone: 'warning' })
}

function commitResize(resize: Resize, plan: SizingPlan, pointer: CanvasPointer): void {
  const { ctx, edId, handle, start } = resize
  const { box } = resizedFor(resize, pointer)
  const changesWidth = pointer.shiftKey || handle.includes('e') || handle.includes('w')
  const changesHeight = pointer.shiftKey || handle.includes('n') || handle.includes('s')
  const centred = pointer.altKey && plan.absolute
  const kept = [
    !changesWidth || writeLength(resize, plan, 'width', 'x', Math.max(0, cssSizeFor(box.width, plan.boxSizing, plan.horizontalInsets))),
    !changesHeight || writeLength(resize, plan, 'height', 'y', Math.max(0, cssSizeFor(box.height, plan.boxSizing, plan.verticalInsets))),
    !centred || box.x === start.x || writeInset(resize, plan, 'x', box),
    !centred || box.y === start.y || writeInset(resize, plan, 'y', box),
  ]
  if (kept.includes(false)) ctx.toast({ message: UNIT_FALLBACK, tone: 'warning' })
  const resizedMainAxis = plan.flexAxis === 'x' ? changesWidth : changesHeight
  const check = plan.flexAxis && resizedMainAxis ? warnIfFlexOverrides(ctx, edId, plan.flexAxis, box) : Promise.resolve()
  // A reload rejects the reads; the handles follow on the next hover.
  check.then(() => remeasureSelection(ctx)).catch(() => {})
}

let resize: Resize | null = null

function onPointerDown(ctx: EditorContext, pointer: CanvasPointer): boolean {
  trackSelection(ctx)
  const selected = selectedBox()
  const handle = selected && handleUnder(ctx, selected, pointer)
  if (!selected || !handle) return false
  if (isArtboardRoot(ctx, selected.edId)) {
    ctx.toast({ message: ROOT_RESIZE, tone: 'info' })
    return true
  }
  if (ctx.readOnly()) return true
  const fromBoard = { x: pointer.boardX, y: pointer.boardY }
  const current: Resize = { ctx, edId: selected.edId, actionId: ctx.beginAction(), handle, start: selected.rect, fromBoard, last: null, plan: null }
  resize = current
  readSizingPlan(ctx, selected.edId)
    .then((plan) => {
      current.plan = plan
    })
    // A reload rejects reads in flight; the resize then writes nothing.
    .catch(() => {})
  return true
}

function onPointerMove(ctx: EditorContext, pointer: CanvasPointer): boolean {
  if (!resize) return false
  resize.last = pointer
  drawResize(ctx, resizedFor(resize, pointer))
  return true
}

function onPointerUp(): boolean {
  const finished = resize
  resize = null
  drawLayer(DRAG_LAYER, [])
  if (!finished?.plan || !finished.last) return false
  commitResize(finished, finished.plan, finished.last)
  return true
}

function onCancel(): void {
  resize = null
  drawLayer(DRAG_LAYER, [])
}

function onHover(ctx: EditorContext): boolean {
  trackSelection(ctx)
  return false
}

onSelectedBox(drawHandles)

export const tool: CanvasTool = {
  id: 'resize',
  priority: 60,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onHover,
  onCancel,
}
