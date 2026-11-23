import type { ProbeReadResult, Rect } from '../../../shared/protocol'
import type { EdId, EditOp, OpOf, TemplateNode } from '../../../shared/types'
import { applyStructural } from '../../actions/layer.actions'
import type { CanvasPointer, CanvasTool, EditorContext, Unsubscribe } from '../../plugin-api'
import { screenBoxOf, type ScreenBox } from '../overlay'
import { snapMove, type Axis, type SnapGuide, type SnapTargets } from '../snap'
import type { Point } from '../viewport'

export type MoveMode = 'offset' | 'reorder' | 'translate'

export interface LayoutContext {
  readonly position: string
  readonly transform: string
  readonly parentDisplay: string
}

export interface Slot {
  readonly edId: EdId
  readonly rect: Rect
}

/** A selected element's first rendered rect, cached so a press can be claimed synchronously. */
export interface SelectedBox {
  readonly edId: EdId
  readonly rect: Rect
}

type Computed = Readonly<Record<string, string>>

interface DragPlan {
  readonly edId: EdId
  readonly mode: MoveMode
  readonly computed: Computed
  readonly self: Rect
  readonly containing: Rect
  readonly targets: SnapTargets
  readonly parent: EdId | null
  readonly slots: readonly Slot[]
  readonly axis: Axis
}

/** The selection moved as one: its union rect snaps, and each element writes its own offsets. */
interface GroupPlan {
  readonly plans: readonly DragPlan[]
  readonly self: Rect
  readonly targets: SnapTargets
}

/** Several elements move together only when every one is absolutely positioned. */
const MIXED = 'mixed'

type SelectionPlan = GroupPlan | typeof MIXED | null

interface Press {
  readonly ctx: EditorContext
  readonly actionId: string
  readonly from: Point
  readonly fromBoard: Point
  plan: SelectionPlan
  dragging: boolean
  last: CanvasPointer
}

interface Move {
  readonly delta: Point
  readonly guides: readonly SnapGuide[]
}

const DRAG_THRESHOLD_PX = 3
const REORDERING_DISPLAYS = ['flex', 'inline-flex', 'grid', 'inline-grid']
const OFFSET_VALUE = /^(-?\d*\.?\d+)(px|%)?$/
const TRANSLATE = /translate\(\s*(-?\d*\.?\d+)px\s*(?:,\s*(-?\d*\.?\d+)px\s*)?\)/
const SELF_PROPS = ['position', 'transform', 'top', 'right', 'bottom', 'left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']
const PARENT_PROPS = ['display', 'flex-direction']
const LAYER = 'move'
const MIXED_MOVE = 'Only absolutely positioned elements move together'

export function moveModeOf({ position, transform, parentDisplay }: LayoutContext): MoveMode | null {
  if (position === 'absolute' || position === 'fixed') return 'offset'
  if (REORDERING_DISPLAYS.includes(parentDisplay)) return 'reorder'
  if (transform !== 'none') return 'translate'
  return null
}

/** Screen px: a press that travels no further is a click. */
export function pastDragThreshold(from: Point, to: Point): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > DRAG_THRESHOLD_PX
}

function formatted(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** Adds a board px delta to an offset, keeping its unit; a % offset is relative to the containing block. */
export function shiftedOffset(authored: string, delta: number, containingSize: number): string {
  const [, number = '0', unit = 'px'] = OFFSET_VALUE.exec(authored.trim()) ?? []
  const value = Number(number)
  if (unit === '%') return `${formatted(value + (delta / containingSize) * 100)}%`
  return `${formatted(value + delta)}px`
}

export function translatedTransform(authored: string, delta: Point): string {
  const translate = TRANSLATE.exec(authored)
  if (!translate) return `translate(${formatted(delta.x)}px, ${formatted(delta.y)}px) ${authored}`.trim()
  const x = Number(translate[1]) + delta.x
  const y = Number(translate[2] ?? 0) + delta.y
  return authored.replace(translate[0], `translate(${formatted(x)}px, ${formatted(y)}px)`)
}

function startOf(rect: Rect, axis: Axis): number {
  return axis === 'x' ? rect.x : rect.y
}

function sizeOf(rect: Rect, axis: Axis): number {
  return axis === 'x' ? rect.width : rect.height
}

function midpointOf(rect: Rect, axis: Axis): number {
  return startOf(rect, axis) + sizeOf(rect, axis) / 2
}

/** The sibling the dragged child lands before, or null to append; `slots` are the parent's children in order. */
function dropBefore(dragged: EdId, slots: readonly Slot[], pointer: Point, axis: Axis): EdId | null {
  const others = slots.filter((slot) => slot.edId !== dragged)
  return others.find((slot) => midpointOf(slot.rect, axis) > pointer[axis])?.edId ?? null
}

export function reorderOp(dragged: EdId, parent: EdId, slots: readonly Slot[], pointer: Point, axis: Axis): OpOf<'moveNode'> | null {
  const before = dropBefore(dragged, slots, pointer, axis)
  const current = slots[slots.findIndex((slot) => slot.edId === dragged) + 1]?.edId ?? null
  if (before === current) return null
  return { target: [dragged], kind: 'moveNode', payload: { parent, before } }
}

// ── Overlay drawing, shared by the canvas tools ───────────────────────────────

/** A pointer-transparent layer of its own above the canvas; the canvas view renders no plugin overlay layers yet. */
function overlayLayer(name: string): HTMLElement | null {
  const viewport = document.querySelector<HTMLElement>('[data-canvas-viewport]')
  if (!viewport) return null
  const existing = viewport.querySelector<HTMLElement>(`:scope > [data-tool-layer="${name}"]`)
  if (existing) return existing
  const layer = document.createElement('div')
  layer.setAttribute('data-tool-layer', name)
  Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' })
  viewport.append(layer)
  return layer
}

export function drawLayer(name: string, marks: readonly HTMLElement[]): void {
  overlayLayer(name)?.replaceChildren(...marks)
}

export function overlayMark(attrs: Readonly<Record<string, string>>, box: ScreenBox, style: Partial<CSSStyleDeclaration> = {}): HTMLElement {
  const mark = document.createElement('div')
  for (const [name, value] of Object.entries(attrs)) mark.setAttribute(name, value)
  Object.assign(
    mark.style,
    { position: 'absolute', boxSizing: 'border-box', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` },
    style,
  )
  return mark
}

/** A 1 px line at least, so a guide or indicator along one axis stays visible. */
export function lineBox(box: ScreenBox): ScreenBox {
  return { ...box, width: Math.max(box.width, 1), height: Math.max(box.height, 1) }
}

// ── The selection, tracked for every tool ─────────────────────────────────────

let trackedCtx: EditorContext | null = null
let stopTracking: Unsubscribe | null = null
let trackedSelection: readonly EdId[] | null = null
let measuredSelection: readonly EdId[] | null = null
let selectedBoxes: readonly SelectedBox[] = []
const selectedListeners = new Set<(ctx: EditorContext, box: SelectedBox | null) => void>()

function notifySelected(ctx: EditorContext): void {
  for (const listener of selectedListeners) listener(ctx, selectedBox())
}

async function firstRectOf(ctx: EditorContext, edId: EdId): Promise<Rect | undefined> {
  const { rects } = await ctx.read({ kind: 'rects', edId }).catch(() => ({ rects: [] as Rect[] }))
  return rects[0]
}

export async function remeasureSelection(ctx: EditorContext): Promise<void> {
  const edIds = ctx.selection()?.edIds ?? []
  const rects = await Promise.all(edIds.map((edId) => firstRectOf(ctx, edId)))
  if (ctx.selection()?.edIds !== edIds) return
  const boxes = edIds.flatMap((edId, i) => {
    const rect = rects[i]
    return rect ? [{ edId, rect }] : []
  })
  measuredSelection = edIds
  selectedBoxes = boxes.length === edIds.length ? boxes : []
  notifySelected(ctx)
}

function selectionMayHaveChanged(ctx: EditorContext): void {
  const edIds = ctx.selection()?.edIds ?? null
  if (edIds === trackedSelection) return notifySelected(ctx)
  trackedSelection = edIds
  void remeasureSelection(ctx)
}

export function trackSelection(ctx: EditorContext): void {
  if (trackedCtx === ctx) return
  stopTracking?.()
  trackedCtx = ctx
  trackedSelection = null
  stopTracking = ctx.onChange(() => selectionMayHaveChanged(ctx))
  selectionMayHaveChanged(ctx)
}

/** The selected element's box when exactly one is selected and measured. */
export function selectedBox(): SelectedBox | null {
  return selectedBoxes.length === 1 ? selectedBoxes[0]! : null
}

function unionOf(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Null while any selected element cannot be measured. */
function selectionUnion(): Rect | null {
  return selectedBoxes.length > 0 ? unionOf(selectedBoxes.map((box) => box.rect)) : null
}

export function onSelectedBox(listener: (ctx: EditorContext, box: SelectedBox | null) => void): void {
  selectedListeners.add(listener)
}

export function parentNodeOf(tree: TemplateNode, edId: EdId): TemplateNode | null {
  for (const child of tree.children) {
    if (child.edId === edId) return tree
    const parent = parentNodeOf(child, edId)
    if (parent) return parent
  }
  return null
}

// ── Authored values, ahead of the index while a write is pending ──────────────

const unflushed = new Map<string, string>()
let unflushedIndex: unknown = null

function authoredValue(ctx: EditorContext, edId: EdId, prop: string): string | null {
  const index = ctx.index()
  if (index !== unflushedIndex) {
    unflushed.clear()
    unflushedIndex = index
  }
  const pending = unflushed.get(`${edId} ${prop}`)
  if (pending !== undefined) return pending
  const sources = index?.styles[edId] ?? []
  const ordered = [...sources.filter((source) => source.target === 'inline'), ...[...sources].reverse()]
  for (const source of ordered) {
    const declaration = source.declarations.find((entry) => entry.prop === prop)
    if (declaration) return declaration.value
  }
  return null
}

function writeDecl(ctx: EditorContext, edId: EdId, prop: string, value: string, actionId: string): void {
  unflushed.set(`${edId} ${prop}`, value)
  // The ws client reports a refused op with its own toast.
  ctx.apply({ target: [edId], kind: 'setDecl', payload: { prop, value } }, actionId).catch(() => {})
}

// ── Reading the layout once per gesture ───────────────────────────────────────

function pxOf(value: string | undefined): number {
  return Number.parseFloat(value ?? '') || 0
}

/** An absolute element's containing block, recovered from its used insets and margins. */
function containingBlockOf(self: Rect, computed: Computed): Rect {
  const left = pxOf(computed.left) + pxOf(computed['margin-left'])
  const right = pxOf(computed.right) + pxOf(computed['margin-right'])
  const top = pxOf(computed.top) + pxOf(computed['margin-top'])
  const bottom = pxOf(computed.bottom) + pxOf(computed['margin-bottom'])
  return { x: self.x - left, y: self.y - top, width: left + self.width + right, height: top + self.height + bottom }
}

const NO_VALUES: Extract<ProbeReadResult, { kind: 'computed' }> = { kind: 'computed', values: {} }

async function slotsOf(ctx: EditorContext, parent: TemplateNode): Promise<Slot[]> {
  const children = parent.children.filter((child) => child.kind === 'element')
  const rects = await Promise.all(children.map((child) => ctx.read({ kind: 'rects', edId: child.edId })))
  return children.flatMap((child, i) => {
    const rect = rects[i]!.rects[0]
    return rect ? [{ edId: child.edId, rect }] : []
  })
}

async function readDragPlan(ctx: EditorContext, edId: EdId): Promise<DragPlan | null> {
  const index = ctx.index()
  if (!index) return null
  const parent = parentNodeOf(index.tree, edId)
  const [self, parentStyle, rects] = await Promise.all([
    ctx.read({ kind: 'computed', edId, props: SELF_PROPS }),
    parent ? ctx.read({ kind: 'computed', edId: parent.edId, props: PARENT_PROPS }) : NO_VALUES,
    ctx.read({ kind: 'snapRects', edId }),
  ])
  const computed = self.values
  const mode = moveModeOf({
    position: computed.position ?? '',
    transform: computed.transform ?? 'none',
    parentDisplay: parentStyle.values.display ?? '',
  })
  if (!mode) return null
  const containing = containingBlockOf(rects.self, computed)
  const domParent = rects.parent ? [rects.parent] : []
  return {
    edId,
    mode,
    computed,
    self: rects.self,
    containing,
    targets: mode === 'offset' ? { parent: containing, siblings: [...domParent, ...rects.siblings] } : rects,
    parent: parent?.edId ?? null,
    slots: mode === 'reorder' && parent ? await slotsOf(ctx, parent) : [],
    axis: parentStyle.values['flex-direction']?.startsWith('column') ? 'y' : 'x',
  }
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Snaps to the first element's parent and every element's siblings, except the selected elements themselves. */
function groupOf(plans: readonly DragPlan[]): GroupPlan {
  const selves = plans.map((plan) => plan.self)
  const isSelected = (rect: Rect) => selves.some((self) => sameRect(self, rect))
  return {
    plans,
    self: unionOf(selves),
    targets: { parent: plans[0]!.targets.parent, siblings: plans.flatMap((plan) => plan.targets.siblings).filter((rect) => !isSelected(rect)) },
  }
}

async function readSelectionPlan(ctx: EditorContext, edIds: readonly EdId[]): Promise<SelectionPlan> {
  const plans = await Promise.all(edIds.map((edId) => readDragPlan(ctx, edId)))
  const [only] = plans
  if (plans.length === 1) return only ? groupOf([only]) : null
  const offsets = plans.filter((plan): plan is DragPlan => plan?.mode === 'offset')
  return offsets.length === plans.length ? groupOf(offsets) : MIXED
}

function refuseMixedMove(ctx: EditorContext): void {
  ctx.toast({ message: MIXED_MOVE, tone: 'info' })
}

// ── Committing a move ─────────────────────────────────────────────────────────

/** Writes the inset the element is anchored by, so a `right`-anchored element stays right-anchored. */
function shiftInset(ctx: EditorContext, plan: DragPlan, axis: Axis, delta: number, actionId: string): void {
  const [start, end] = axis === 'x' ? ['left', 'right'] : ['top', 'bottom']
  const anchoredAtEnd = authoredValue(ctx, plan.edId, start!) === null && authoredValue(ctx, plan.edId, end!) !== null
  const prop = anchoredAtEnd ? end! : start!
  const authored = authoredValue(ctx, plan.edId, prop)
  const base = authored !== null && OFFSET_VALUE.test(authored.trim()) ? authored : (plan.computed[prop] ?? '0')
  const size = sizeOf(plan.containing, axis)
  writeDecl(ctx, plan.edId, prop, shiftedOffset(base, anchoredAtEnd ? -delta : delta, size), actionId)
}

function commitShift(ctx: EditorContext, plan: DragPlan, delta: Point, actionId: string): void {
  if (plan.mode === 'translate') {
    writeDecl(ctx, plan.edId, 'transform', translatedTransform(authoredValue(ctx, plan.edId, 'transform') ?? '', delta), actionId)
    return
  }
  if (delta.x !== 0) shiftInset(ctx, plan, 'x', delta.x, actionId)
  if (delta.y !== 0) shiftInset(ctx, plan, 'y', delta.y, actionId)
}

function commitGroupShift(ctx: EditorContext, group: GroupPlan, delta: Point, actionId: string): void {
  for (const plan of group.plans) commitShift(ctx, plan, delta, actionId)
}

function reordersInPlace(group: GroupPlan): boolean {
  return group.plans[0]!.mode === 'reorder'
}

function applyReorder(ctx: EditorContext, op: EditOp): void {
  void applyStructural(ctx, op)
}

// ── The drag ──────────────────────────────────────────────────────────────────

let press: Press | null = null

function shifted(rect: Rect, delta: Point): Rect {
  return { ...rect, x: rect.x + delta.x, y: rect.y + delta.y }
}

function movedBy(press: Press, group: GroupPlan): Move {
  const delta = { x: Math.round(press.last.boardX - press.fromBoard.x), y: Math.round(press.last.boardY - press.fromBoard.y) }
  if (press.last.ctrlKey) return { delta, guides: [] }
  const snap = snapMove(shifted(group.self, delta), group.targets, press.ctx.viewport().zoom)
  return { delta: { x: Math.round(delta.x + snap.dx), y: Math.round(delta.y + snap.dy) }, guides: snap.guides }
}

function reorderOf(press: Press, plan: DragPlan): OpOf<'moveNode'> | null {
  if (!plan.parent) return null
  return reorderOp(plan.edId, plan.parent, plan.slots, { x: press.last.boardX, y: press.last.boardY }, plan.axis)
}

function guideMark(ctx: EditorContext, guide: SnapGuide): HTMLElement {
  const rect =
    guide.axis === 'x'
      ? { x: guide.at, y: guide.from, width: 0, height: guide.to - guide.from }
      : { x: guide.from, y: guide.at, width: guide.to - guide.from, height: 0 }
  return overlayMark({ 'data-snap-guide': guide.axis }, lineBox(screenBoxOf(ctx.viewport(), rect)), { background: 'var(--guide)' })
}

function insertionLineMark(ctx: EditorContext, plan: DragPlan, before: EdId | null): HTMLElement | null {
  const others = plan.slots.filter((slot) => slot.edId !== plan.edId)
  const target = others.find((slot) => slot.edId === before) ?? others.at(-1)
  if (!target) return null
  const at = before ? startOf(target.rect, plan.axis) : startOf(target.rect, plan.axis) + sizeOf(target.rect, plan.axis)
  const cross = plan.axis === 'x' ? 'y' : 'x'
  const from = Math.min(...others.map((slot) => startOf(slot.rect, cross)))
  const to = Math.max(...others.map((slot) => startOf(slot.rect, cross) + sizeOf(slot.rect, cross)))
  const rect = plan.axis === 'x' ? { x: at, y: from, width: 0, height: to - from } : { x: from, y: at, width: to - from, height: 0 }
  const box = screenBoxOf(ctx.viewport(), rect)
  const thick = plan.axis === 'x' ? { ...box, left: box.left - 1, width: 2 } : { ...box, top: box.top - 1, height: 2 }
  return overlayMark({ 'data-insertion-line': '' }, thick, { background: 'var(--sel)' })
}

function ghostMark(ctx: EditorContext, rect: Rect): HTMLElement {
  return overlayMark({ 'data-move-ghost': '' }, screenBoxOf(ctx.viewport(), rect), { border: '1px dashed var(--sel)' })
}

function drawDrag(press: Press): void {
  const group = press.plan
  if (!group || group === MIXED) return
  const { ctx } = press
  const [first] = group.plans
  if (reordersInPlace(group)) {
    const op = reorderOf(press, first!)
    const line = op && insertionLineMark(ctx, first!, op.payload.before)
    drawLayer(LAYER, line ? [line] : [])
    return
  }
  const { delta, guides } = movedBy(press, group)
  const ghosts = group.plans.map((plan) => ghostMark(ctx, shifted(plan.self, delta)))
  drawLayer(LAYER, [...ghosts, ...guides.map((guide) => guideMark(ctx, guide))])
}

function commitDrag(press: Press, group: GroupPlan): void {
  if (!reordersInPlace(group)) return commitGroupShift(press.ctx, group, movedBy(press, group).delta, press.actionId)
  const op = reorderOf(press, group.plans[0]!)
  if (op) applyReorder(press.ctx, op)
}

function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

function pressLandsOn(plan: SelectionPlan, at: Point): boolean {
  return plan === null || plan === MIXED || containsPoint(plan.self, at.x, at.y)
}

/** A press right after the selection changed comes before its measurement, so it is claimed and checked once the plan lands. */
function onPointerDown(ctx: EditorContext, pointer: CanvasPointer): boolean {
  trackSelection(ctx)
  const edIds = ctx.selection()?.edIds ?? []
  if (ctx.readOnly() || pointer.modKey || pointer.shiftKey || edIds.length === 0) return false
  const measuring = edIds !== measuredSelection
  const union = selectionUnion()
  if (!measuring && !(union && containsPoint(union, pointer.boardX, pointer.boardY))) return false
  const fromBoard = { x: pointer.boardX, y: pointer.boardY }
  const current: Press = { ctx, actionId: ctx.beginAction(), from: pointer, fromBoard, plan: null, dragging: false, last: pointer }
  press = current
  readSelectionPlan(ctx, edIds)
    .then((plan) => {
      current.plan = !measuring || pressLandsOn(plan, fromBoard) ? plan : null
      if (press === current && current.dragging) drawDrag(current)
    })
    // A reload rejects reads in flight; the press then does nothing.
    .catch(() => {})
  return true
}

function onPointerMove(_ctx: EditorContext, pointer: CanvasPointer): boolean {
  if (!press) return false
  press.last = pointer
  if (!press.dragging && !pastDragThreshold(press.from, pointer)) return true
  press.dragging = true
  drawDrag(press)
  return true
}

function onPointerUp(_ctx: EditorContext, pointer: CanvasPointer): boolean {
  const finished = press
  press = null
  drawLayer(LAYER, [])
  if (!finished?.dragging || !finished.plan) return false
  if (finished.plan === MIXED) {
    refuseMixedMove(finished.ctx)
    return true
  }
  finished.last = pointer
  commitDrag(finished, finished.plan)
  void remeasureSelection(finished.ctx)
  return true
}

function onCancel(): void {
  press = null
  drawLayer(LAYER, [])
}

function onHover(ctx: EditorContext): boolean {
  trackSelection(ctx)
  void remeasureSelection(ctx)
  return false
}

// ── Arrow nudge ───────────────────────────────────────────────────────────────

/** Moves the selection by a board px step; a flex child keeps its place, since its place is its order. */
export async function nudgeSelection(ctx: EditorContext, delta: Point, actionId: string): Promise<void> {
  const group = await readSelectionPlan(ctx, ctx.selection()?.edIds ?? [])
  if (group === MIXED) return refuseMixedMove(ctx)
  if (group && !reordersInPlace(group)) commitGroupShift(ctx, group, delta, actionId)
}

export const tool: CanvasTool = {
  id: 'move',
  priority: 20,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onHover,
  onCancel,
}
