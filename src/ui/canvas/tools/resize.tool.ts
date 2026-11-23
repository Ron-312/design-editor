import type { Rect } from '../../../shared/protocol'
import type { EdId } from '../../../shared/types'
import type { CanvasPointer, CanvasTool, EditorContext } from '../../plugin-api'
import { screenBoxOf, type ScreenBox } from '../overlay'
import type { Point } from '../viewport'
import { drawLayer, onSelectedBox, overlayMark, parentNodeOf, remeasureSelection, selectedBox, trackSelection, type SelectedBox } from './move.tool'

export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const

export type ResizeHandle = (typeof RESIZE_HANDLES)[number]

type BoxSizing = 'content-box' | 'border-box'

interface SizingPlan {
  readonly boxSizing: BoxSizing
  readonly horizontalInsets: number
  readonly verticalInsets: number
  readonly flexAxis: 'x' | 'y' | null
}

interface Resize {
  readonly ctx: EditorContext
  readonly edId: EdId
  readonly handle: ResizeHandle
  readonly start: Rect
  readonly fromBoard: Point
  box: Rect
  plan: SizingPlan | null
}

const HANDLE_PX = 8
const ROOT_RESIZE = 'Resize the frame in Claude Design'
const FLEX_OVERRIDES = 'Flex sizing overrides this size; set flex-shrink or flex-grow to 0 to keep it'
const FLEX_DISPLAYS = ['flex', 'inline-flex']
const SIZE_PROPS = [
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

async function readSizingPlan(ctx: EditorContext, edId: EdId): Promise<SizingPlan> {
  const tree = ctx.index()?.tree
  const parent = tree ? parentNodeOf(tree, edId) : null
  const [self, parentStyle] = await Promise.all([
    ctx.read({ kind: 'computed', edId, props: SIZE_PROPS }),
    parent ? ctx.read({ kind: 'computed', edId: parent.edId, props: ['display', 'flex-direction'] }) : null,
  ])
  const value = (prop: string) => pxOf(self.values[prop])
  const display = parentStyle?.values.display ?? ''
  return {
    boxSizing: self.values['box-sizing'] === 'border-box' ? 'border-box' : 'content-box',
    horizontalInsets: value('padding-left') + value('padding-right') + value('border-left-width') + value('border-right-width'),
    verticalInsets: value('padding-top') + value('padding-bottom') + value('border-top-width') + value('border-bottom-width'),
    flexAxis: FLEX_DISPLAYS.includes(display) ? (parentStyle?.values['flex-direction']?.startsWith('column') ? 'y' : 'x') : null,
  }
}

function sizeLabel(box: Rect): string {
  return `${Math.round(box.width)} × ${Math.round(box.height)}`
}

function drawResize(resize: Resize): void {
  const box = screenBoxOf(resize.ctx.viewport(), resize.box)
  const outline = overlayMark({ 'data-resize-ghost': '' }, box, { border: '1px solid var(--sel)' })
  const label = overlayMark({ 'data-size-label': '' }, { left: box.left, top: box.top + box.height + 6, width: box.width, height: 18 }, {
    display: 'flex',
    justifyContent: 'center',
  })
  const text = document.createElement('span')
  text.textContent = sizeLabel(resize.box)
  Object.assign(text.style, { padding: '1px 6px', borderRadius: '4px', background: 'var(--sel)', color: 'var(--sel-ink)', font: '600 11px/16px system-ui, sans-serif' })
  label.append(text)
  drawLayer(DRAG_LAYER, [outline, label])
}

function writeSize(ctx: EditorContext, edId: EdId, prop: 'width' | 'height', value: number): void {
  // The ws client reports a refused op with its own toast.
  ctx.apply({ target: [edId], kind: 'setDecl', payload: { prop, value: `${Math.max(0, Math.round(value))}px` } }).catch(() => {})
}

/** The preview has landed by the time the read is answered, so a differing size means flex sizing won. */
async function warnIfFlexOverrides(ctx: EditorContext, edId: EdId, axis: 'x' | 'y', expected: Rect): Promise<void> {
  const { rects } = await ctx.read({ kind: 'rects', edId })
  const rendered = rects[0]
  if (!rendered) return
  const size = (rect: Rect) => (axis === 'x' ? rect.width : rect.height)
  if (Math.abs(size(rendered) - size(expected)) > 0.5) ctx.toast({ message: FLEX_OVERRIDES, tone: 'warning' })
}

function commitResize(resize: Resize, plan: SizingPlan): void {
  const { ctx, edId, handle, box } = resize
  const changesWidth = handle.includes('e') || handle.includes('w')
  const changesHeight = handle.includes('n') || handle.includes('s')
  if (changesWidth) writeSize(ctx, edId, 'width', cssSizeFor(box.width, plan.boxSizing, plan.horizontalInsets))
  if (changesHeight) writeSize(ctx, edId, 'height', cssSizeFor(box.height, plan.boxSizing, plan.verticalInsets))
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
  const current: Resize = { ctx, edId: selected.edId, handle, start: selected.rect, fromBoard: { x: pointer.boardX, y: pointer.boardY }, box: selected.rect, plan: null }
  resize = current
  readSizingPlan(ctx, selected.edId)
    .then((plan) => {
      current.plan = plan
    })
    // A reload rejects reads in flight; the resize then writes nothing.
    .catch(() => {})
  return true
}

function onPointerMove(_ctx: EditorContext, pointer: CanvasPointer): boolean {
  if (!resize) return false
  resize.box = resizedBox(resize.start, resize.handle, { x: pointer.boardX - resize.fromBoard.x, y: pointer.boardY - resize.fromBoard.y })
  drawResize(resize)
  return true
}

function onPointerUp(): boolean {
  const finished = resize
  resize = null
  drawLayer(DRAG_LAYER, [])
  if (!finished?.plan || finished.box === finished.start) return false
  commitResize(finished, finished.plan)
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
