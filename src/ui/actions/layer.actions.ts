import type { Rect } from '../../shared/protocol'
import type { EdId, EditOp, InlineDeclaration, TemplateNode } from '../../shared/types'
import { inferAutoLayout, marginBoxOf, type AutoLayout } from '../canvas/infer-layout'
import { findNode, parentOf } from '../canvas/selection'
import type { AckMessage, EditorAction, EditorContext } from '../plugin-api'

type EditorToggle = 'hidden' | 'locked'

interface FramedLayer {
  readonly position: string
  readonly marginBoxes: readonly Rect[]
}

const FRAME_NEEDS_IN_FLOW = 'Frame selection needs in-flow layers — use Wrap in container (Mod-G)'
const OUT_OF_FLOW = ['absolute', 'fixed']
const FRAME_PROPS = ['position', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']

function selected(ctx: EditorContext): readonly EdId[] {
  return ctx.selection()?.edIds ?? []
}

const hasSelection = (ctx: EditorContext) => selected(ctx).length > 0
const whileEditable = (ctx: EditorContext) => !ctx.readOnly() && hasSelection(ctx)

/** Shows the server's selector-match warnings (R04) for a structural op as toasts. */
export async function applyStructural(ctx: EditorContext, op: EditOp): Promise<void> {
  let ack: AckMessage
  try {
    ack = await ctx.apply(op)
  } catch {
    // The ws client already toasted the server's one-line refusal; it is never retried with another tag.
    return
  }
  for (const warning of ack.warnings) ctx.toast({ message: warning, tone: 'warning' })
}

function structural(kind: 'unwrapNode' | 'duplicateNode' | 'deleteNode') {
  return (ctx: EditorContext) => void applyStructural(ctx, { target: selected(ctx), kind, payload: {} })
}

/** As in Figma, a selection that is all hidden (or all locked) is shown again; any other one is hidden. */
function toggleEditorState(key: EditorToggle) {
  return (ctx: EditorContext) => {
    const current = ctx.editorState()[key]
    const targets = selected(ctx)
    const allSet = targets.every((edId) => current.includes(edId))
    ctx.setEditorState({ [key]: allSet ? current.filter((edId) => !targets.includes(edId)) : [...new Set([...current, ...targets])] })
  }
}

/** The server's siblingRun refusals, checked before any read so a refused frame reads nothing. */
function siblingRunRefusal(tree: TemplateNode, targets: readonly EdId[]): string | null {
  const parent = parentOf(tree, targets[0]!)
  if (targets.some((edId) => parentOf(tree, edId) !== parent)) return 'only layers with the same parent can be wrapped together'
  const siblings = parent ? findNode(tree, parent)!.children.map((child) => child.edId) : [tree.edId]
  const indexes = targets.map((edId) => siblings.indexOf(edId)).sort((a, b) => a - b)
  return indexes.at(-1)! - indexes[0]! === indexes.length - 1 ? null : 'only neighbouring layers can be wrapped together'
}

async function readFramedLayer(ctx: EditorContext, edId: EdId): Promise<FramedLayer> {
  const [{ values }, { rects }] = await Promise.all([ctx.read({ kind: 'computed', edId, props: FRAME_PROPS }), ctx.read({ kind: 'rects', edId })])
  return { position: values.position ?? 'static', marginBoxes: rects.slice(0, 1).map((rect) => marginBoxOf(rect, values)) }
}

function autoLayoutStyle({ direction, gap }: AutoLayout): InlineDeclaration[] {
  return [
    { prop: 'display', value: 'flex' },
    ...(direction === 'column' ? [{ prop: 'flex-direction', value: 'column' }] : []),
    { prop: 'gap', value: `${gap}px` },
  ]
}

/**
 * The layout comes from rects read before the op, because the wrap reloads the frame and the wrapper's
 * id is known only after the ack; wrap and layout are therefore one op and one undo entry.
 */
async function frameSelection(ctx: EditorContext): Promise<void> {
  const targets = selected(ctx)
  const refusal = siblingRunRefusal(ctx.index()!.tree, targets)
  if (refusal) return ctx.toast({ message: refusal, tone: 'info' })
  const layers = await Promise.all(targets.map((edId) => readFramedLayer(ctx, edId)))
  if (layers.some((layer) => OUT_OF_FLOW.includes(layer.position))) return ctx.toast({ message: FRAME_NEEDS_IN_FLOW, tone: 'info' })
  const style = autoLayoutStyle(inferAutoLayout(layers.flatMap((layer) => layer.marginBoxes)))
  await applyStructural(ctx, { target: targets, kind: 'wrapNode', payload: { tag: 'div', style } })
}

export const actions: EditorAction[] = [
  {
    id: 'layer.wrap',
    label: 'Wrap in container',
    kbd: 'Mod+G',
    run: (ctx) => void applyStructural(ctx, { target: selected(ctx), kind: 'wrapNode', payload: { tag: 'div' } }),
    when: whileEditable,
  },
  { id: 'layer.frame', label: 'Frame selection', kbd: 'Mod+Alt+G', run: (ctx) => void frameSelection(ctx), when: whileEditable },
  { id: 'layer.ungroup', label: 'Ungroup', kbd: ['Mod+Shift+G', 'Mod+Backspace'], run: structural('unwrapNode'), when: whileEditable },
  { id: 'layer.duplicate', label: 'Duplicate', kbd: 'Mod+D', run: structural('duplicateNode'), when: whileEditable },
  {
    id: 'layer.delete',
    label: 'Delete',
    kbd: ['Delete', 'Backspace'],
    scope: ['canvas', 'layers'],
    run: structural('deleteNode'),
    when: whileEditable,
  },
  { id: 'layer.hide', label: 'Hide / show', kbd: 'Mod+Shift+H', run: toggleEditorState('hidden'), when: hasSelection },
  { id: 'layer.lock', label: 'Lock / unlock', kbd: 'Mod+Shift+L', run: toggleEditorState('locked'), when: hasSelection },
]
