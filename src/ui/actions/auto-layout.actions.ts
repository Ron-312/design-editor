import type { Rect } from '../../shared/protocol'
import type { EdId, EditOp, TemplateNode } from '../../shared/types'
import { inferAutoLayout, marginBoxOf } from '../canvas/infer-layout'
import { findNode } from '../canvas/selection'
import { addAutoLayoutWrites, AUTO_LAYOUT_PROPS, insetOf, type LayoutWrite } from '../panels/auto-layout'
import type { EditorAction, EditorContext } from '../plugin-api'

const OUT_OF_FLOW = ['absolute', 'fixed']
const CHILD_PROPS = ['position', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']
const BORDER_PROPS = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']

function selected(ctx: EditorContext): readonly EdId[] {
  return ctx.selection()?.edIds ?? []
}

const whileEditable = (ctx: EditorContext) => !ctx.readOnly() && selected(ctx).length > 0

const px = (value: string | undefined) => Number.parseFloat(value ?? '') || 0

function opFor(edId: EdId, { prop, value }: LayoutWrite): EditOp {
  return value === null ? { target: [edId], kind: 'removeDecl', payload: { prop } } : { target: [edId], kind: 'setDecl', payload: { prop, value } }
}

/** Every op goes out at once under the action's id, so the server folds them into one splice and one undo entry. */
function send(ctx: EditorContext, edId: EdId, writes: readonly LayoutWrite[], actionId: string): void {
  // The ws client reports a refused op with its own toast.
  for (const write of writes) ctx.apply(opFor(edId, write), actionId).catch(() => {})
}

async function paddingBoxOf(ctx: EditorContext, edId: EdId): Promise<Rect | null> {
  const [{ values }, { rects }] = await Promise.all([ctx.read({ kind: 'computed', edId, props: BORDER_PROPS }), ctx.read({ kind: 'rects', edId })])
  const border = rects[0]
  if (!border) return null
  const [top, right, bottom, left] = BORDER_PROPS.map((prop) => px(values[prop]))
  return { x: border.x + left!, y: border.y + top!, width: border.width - left! - right!, height: border.height - top! - bottom! }
}

/** An absolutely or fixedly positioned child keeps its place under flex, so it counts for nothing. */
async function inFlowMarginBoxesOf(ctx: EditorContext, edId: EdId): Promise<Rect[]> {
  const [{ values }, { rects }] = await Promise.all([ctx.read({ kind: 'computed', edId, props: CHILD_PROPS }), ctx.read({ kind: 'rects', edId })])
  if (OUT_OF_FLOW.includes(values['position'] ?? 'static')) return []
  return rects.map((rect) => marginBoxOf(rect, values))
}

async function addedLayoutOf(ctx: EditorContext, container: TemplateNode): Promise<LayoutWrite[]> {
  const [paddingBox, perChild] = await Promise.all([
    paddingBoxOf(ctx, container.edId),
    Promise.all(container.children.map((child) => inFlowMarginBoxesOf(ctx, child.edId))),
  ])
  const boxes = perChild.flat()
  return addAutoLayoutWrites(inferAutoLayout(boxes), paddingBox && boxes.length > 0 ? insetOf(paddingBox, boxes) : null)
}

/** Every rect is read before the first write, because a write reloads the frame. */
async function addAutoLayout(ctx: EditorContext, actionId: string): Promise<void> {
  const tree = ctx.index()!.tree
  const containers = selected(ctx).flatMap((edId) => findNode(tree, edId) ?? [])
  const perContainer = await Promise.all(containers.map(async (container) => [container.edId, await addedLayoutOf(ctx, container)] as const))
  for (const [edId, writes] of perContainer) send(ctx, edId, writes, actionId)
}

function inlineProps(ctx: EditorContext, edId: EdId): readonly string[] {
  const inline = ctx.index()?.styles[edId]?.find((source) => source.target === 'inline')
  return inline?.declarations.map((declaration) => declaration.prop) ?? []
}

function removeAutoLayout(ctx: EditorContext, actionId: string): void {
  for (const edId of selected(ctx)) {
    const authored = AUTO_LAYOUT_PROPS.filter((prop) => inlineProps(ctx, edId).includes(prop))
    send(
      ctx,
      edId,
      authored.map((prop) => ({ prop, value: null })),
      actionId,
    )
  }
}

export const actions: EditorAction[] = [
  {
    id: 'layout.add-auto-layout',
    label: 'Add auto layout',
    kbd: 'Shift+A',
    scope: ['canvas', 'layers'],
    // A reload rejects the reads in flight; nothing has been written by then.
    run: (ctx, actionId) => void addAutoLayout(ctx, actionId).catch(() => {}),
    when: whileEditable,
  },
  {
    id: 'layout.remove-auto-layout',
    label: 'Remove auto layout',
    kbd: 'Alt+Shift+A',
    scope: ['canvas', 'layers'],
    run: removeAutoLayout,
    when: whileEditable,
  },
]
