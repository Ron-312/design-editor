import type { Rect } from '../../../shared/protocol'
import type { EdId, TemplateNode } from '../../../shared/types'
import type { CanvasPointer, CanvasTool, EditorContext } from '../../plugin-api'
import { screenBoxOf } from '../overlay'
import { clickSelection, findNode, isMarqueeContainer, marqueeSelection, selectableHit, type MarqueeCandidate } from '../selection'
import { drawLayer, overlayMark, pastDragThreshold, tool as move } from './move.tool'

/** What the press turned out to be once its hit landed. */
type Phase =
  | { readonly kind: 'hitPending' }
  | { readonly kind: 'marquee'; readonly hit: EdId | null; readonly candidates: Promise<MarqueeCandidate[]> }
  | { readonly kind: 'moving' }
  | { readonly kind: 'selected' }

interface Press {
  readonly ctx: EditorContext
  readonly tree: TemplateNode
  readonly from: CanvasPointer
  readonly selectionAtPress: readonly EdId[]
  last: CanvasPointer
  phase: Phase
  dragging: boolean
  released: boolean
  cancelled: boolean
}

const LAYER = 'marquee'

let press: Press | null = null

function elementChildren(node: TemplateNode): TemplateNode[] {
  return node.children.filter((child) => child.kind === 'element')
}

async function displaysOf(ctx: EditorContext, children: readonly TemplateNode[]): Promise<string[]> {
  const results = await Promise.all(children.map((child) => ctx.read({ kind: 'computed', edId: child.edId, props: ['display'] })))
  return results.map((result) => result.values.display ?? '')
}

async function candidatesOf(ctx: EditorContext, children: readonly TemplateNode[]): Promise<MarqueeCandidate[]> {
  const results = await Promise.all(children.map((child) => ctx.read({ kind: 'rects', edId: child.edId })))
  return children.flatMap((child, i) => {
    const rect = results[i]!.rects[0]
    return rect ? [{ edId: child.edId, rect }] : []
  })
}

function dragArea(press: Press): Rect {
  const x = Math.min(press.from.boardX, press.last.boardX)
  const y = Math.min(press.from.boardY, press.last.boardY)
  return { x, y, width: Math.abs(press.last.boardX - press.from.boardX), height: Math.abs(press.last.boardY - press.from.boardY) }
}

function drawMarquee(press: Press): void {
  const box = screenBoxOf(press.ctx.viewport(), dragArea(press))
  drawLayer(LAYER, [overlayMark({ 'data-marquee': '' }, box, { border: '1px solid var(--sel)', background: 'color-mix(in srgb, var(--sel) 10%, transparent)' })])
}

function selectAsClick(press: Press, hit: EdId | null): void {
  const selection = press.ctx.selection()?.edIds ?? []
  press.ctx.select(clickSelection(press.tree, selection, hit, { mod: press.from.modKey, shift: press.from.shiftKey }))
}

function startMarquee(press: Press, hit: EdId | null, children: readonly TemplateNode[]): void {
  press.phase = { kind: 'marquee', hit, candidates: candidatesOf(press.ctx, children) }
  if (press.dragging) drawMarquee(press)
}

/** The move tool claims a press on a selection it has not measured yet, and moves by the whole drag from the press point. */
function handToMove(press: Press, hit: EdId | null): void {
  selectAsClick(press, hit)
  if (!move.onPointerDown!(press.ctx, press.from)) {
    press.phase = { kind: 'selected' }
    return
  }
  press.phase = { kind: 'moving' }
  if (press.dragging) move.onPointerMove!(press.ctx, press.last)
}

async function land(press: Press): Promise<void> {
  const { ctx, tree, from } = press
  const { edId } = await ctx.read({ kind: 'hitTest', x: from.boardX, y: from.boardY, depth: 'deepest', within: null })
  const hit = selectableHit(tree, edId, ctx.editorState().locked)
  const node = (hit && findNode(tree, hit)) ?? tree
  const children = elementChildren(node)
  // A childless hit selects without another read, as v1 did, so a double-click right after reads the selection it set.
  const displays = children.length > 0 ? await displaysOf(ctx, children) : []
  if (press.cancelled) return
  if (press.released) return selectAsClick(press, hit)
  if (isMarqueeContainer(tree, node.edId, displays)) startMarquee(press, hit, children)
  else handToMove(press, hit)
}

function finishMarquee(press: Press, phase: Extract<Phase, { kind: 'marquee' }>): void {
  if (!press.dragging) return selectAsClick(press, phase.hit)
  const area = dragArea(press)
  phase.candidates
    .then((candidates) => press.ctx.select(marqueeSelection(press.selectionAtPress, candidates, area, { shift: press.from.shiftKey })))
    // A reload rejects reads in flight; the marquee then selects nothing.
    .catch(() => {})
}

/** Claims every press no higher tool takes; whether it marquees, moves or clicks is decided when the hit lands. */
function onPointerDown(ctx: EditorContext, pointer: CanvasPointer): boolean {
  const index = ctx.index()
  if (!index) return false
  const current: Press = {
    ctx,
    tree: index.tree,
    from: pointer,
    selectionAtPress: ctx.selection()?.edIds ?? [],
    last: pointer,
    phase: { kind: 'hitPending' },
    dragging: false,
    released: false,
    cancelled: false,
  }
  press = current
  // A reload rejects reads in flight; the press then does nothing.
  land(current).catch(() => {})
  return true
}

function onPointerMove(ctx: EditorContext, pointer: CanvasPointer): boolean {
  if (!press) return false
  press.last = pointer
  press.dragging ||= pastDragThreshold(press.from, pointer)
  if (press.phase.kind === 'moving') move.onPointerMove!(ctx, pointer)
  else if (press.phase.kind === 'marquee' && press.dragging) drawMarquee(press)
  return true
}

/** Always used: a click is applied here or when the hit lands, never by the canvas. */
function onPointerUp(ctx: EditorContext, pointer: CanvasPointer): boolean {
  const finished = press
  press = null
  drawLayer(LAYER, [])
  if (!finished) return true
  finished.last = pointer
  finished.released = true
  if (finished.phase.kind === 'moving') move.onPointerUp!(ctx, pointer)
  else if (finished.phase.kind === 'marquee') finishMarquee(finished, finished.phase)
  return true
}

function onCancel(ctx: EditorContext): void {
  if (press?.phase.kind === 'moving') move.onCancel!(ctx)
  if (press) press.cancelled = true
  press = null
  drawLayer(LAYER, [])
}

export const tool: CanvasTool = {
  id: 'marquee',
  priority: 0,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onCancel,
}
