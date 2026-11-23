import type { Rect } from '../../shared/protocol'
import type { EdId, TemplateNode } from '../../shared/types'
import { findNode, parentOf } from '../canvas/selection'
import type { EditorAction, EditorContext } from '../plugin-api'
import { applyStructural } from './layer.actions'

type Direction = 'forward' | 'backward' | 'front' | 'back'

/** A sibling as the paint order sees it; `order` is its place among the element siblings. */
interface Layer {
  readonly edId: EdId
  readonly order: number
  readonly position: string
  readonly zIndex: string
  readonly rects: readonly Rect[]
}

const ARRANGE_NEEDS = 'Arrange needs one absolutely positioned layer, or one flex or grid item'
const NOTHING_TO_PASS = 'Nothing overlaps this layer in that direction'
const OUT_OF_FLOW = ['absolute', 'fixed']
const ITEM_DISPLAYS = ['flex', 'inline-flex', 'grid', 'inline-grid']

function selected(ctx: EditorContext): readonly EdId[] {
  return ctx.selection()?.edIds ?? []
}

const whileOneEditable = (ctx: EditorContext) => !ctx.readOnly() && selected(ctx).length === 1

const zOf = (layer: Layer) => Number.parseInt(layer.zIndex, 10) || 0
const byPaintOrder = (a: Layer, b: Layer) => zOf(a) - zOf(b) || a.order - b.order
const isForward = (direction: Direction) => direction === 'forward' || direction === 'front'

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function overlaps(a: Layer, b: Layer): boolean {
  return a.rects.some((rect) => b.rects.some((other) => intersects(rect, other)))
}

async function readLayer(ctx: EditorContext, edId: EdId, order: number): Promise<Layer> {
  const [{ values }, { rects }] = await Promise.all([
    ctx.read({ kind: 'computed', edId, props: ['position', 'z-index'] }),
    ctx.read({ kind: 'rects', edId }),
  ])
  return { edId, order, position: values.position ?? 'static', zIndex: values['z-index'] ?? 'auto', rects }
}

async function displayOf(ctx: EditorContext, edId: EdId): Promise<string> {
  const { values } = await ctx.read({ kind: 'computed', edId, props: ['display'] })
  return values.display ?? 'block'
}

/** The overlapping sibling the layer moves past: the nearest one for a step, the farthest for front or back. */
function passedLayer(direction: Direction, self: Layer, paintLayer: readonly Layer[]): Layer | undefined {
  const overlapping = paintLayer.filter((layer) => layer !== self && overlaps(layer, self)).sort(byPaintOrder)
  const below = overlapping.filter((layer) => byPaintOrder(layer, self) < 0)
  const above = overlapping.filter((layer) => byPaintOrder(layer, self) > 0)
  switch (direction) {
    case 'forward':
      return above[0]
    case 'front':
      return above.at(-1)
    case 'backward':
      return below.at(-1)
    case 'back':
      return below[0]
  }
}

/** An absolutely positioned layer paints in DOM order among positioned siblings with its z-index, so it moves in the DOM. */
function moveInDom(ctx: EditorContext, direction: Direction, parent: TemplateNode, self: Layer, siblings: readonly Layer[]): void {
  const paintLayer = siblings.filter((layer) => layer.position !== 'static' && layer.zIndex === self.zIndex)
  const passed = passedLayer(direction, self, paintLayer)
  if (!passed) return ctx.toast({ message: NOTHING_TO_PASS, tone: 'info' })
  const children = parent.children.map((child) => child.edId)
  const before = isForward(direction) ? (children[children.indexOf(passed.edId) + 1] ?? null) : passed.edId
  void applyStructural(ctx, { target: [self.edId], kind: 'moveNode', payload: { parent: parent.edId, before } })
}

/** A flex or grid item would move in the layout with its DOM order, so it takes a z-index instead. */
function writeZIndex(ctx: EditorContext, direction: Direction, self: Layer, siblings: readonly Layer[]): void {
  const passed = passedLayer(direction, self, siblings)
  if (!passed) return ctx.toast({ message: NOTHING_TO_PASS, tone: 'info' })
  const value = String(zOf(passed) + (isForward(direction) ? 1 : -1))
  void applyStructural(ctx, { target: [self.edId], kind: 'setDecl', payload: { prop: 'z-index', value } })
}

async function arrange(ctx: EditorContext, direction: Direction): Promise<void> {
  const [edId] = selected(ctx)
  const tree = ctx.index()!.tree
  const parentId = parentOf(tree, edId!)
  if (!parentId) return ctx.toast({ message: ARRANGE_NEEDS, tone: 'info' })
  const parent = findNode(tree, parentId)!
  const elements = parent.children.filter((child) => child.kind === 'element')
  const [parentDisplay, ...siblings] = await Promise.all([
    displayOf(ctx, parentId),
    ...elements.map((child, order) => readLayer(ctx, child.edId, order)),
  ])
  const self = siblings.find((layer) => layer.edId === edId)!
  if (OUT_OF_FLOW.includes(self.position)) return moveInDom(ctx, direction, parent, self, siblings)
  if (ITEM_DISPLAYS.includes(parentDisplay)) return writeZIndex(ctx, direction, self, siblings)
  ctx.toast({ message: ARRANGE_NEEDS, tone: 'info' })
}

function arrangeAction(id: string, label: string, keys: Pick<EditorAction, 'kbd' | 'kbdByPlatform'>, direction: Direction): EditorAction {
  return {
    id,
    label,
    ...keys,
    // A reload rejects the reads; the command is then dropped.
    run: (ctx) => void arrange(ctx, direction).catch(() => {}),
    when: whileOneEditable,
    disabledReason: ARRANGE_NEEDS,
  }
}

// Cmd-Shift-] / [ is the browser's tab switch on macOS, so the macOS front and back keys take Option instead.
export const actions: EditorAction[] = [
  arrangeAction('arrange.bringForward', 'Bring forward', { kbd: 'Mod+]' }, 'forward'),
  arrangeAction('arrange.sendBackward', 'Send backward', { kbd: 'Mod+[' }, 'backward'),
  arrangeAction('arrange.bringToFront', 'Bring to front', { kbd: 'Mod+Alt+]', kbdByPlatform: { windows: 'Ctrl+Shift+]' } }, 'front'),
  arrangeAction('arrange.sendToBack', 'Send to back', { kbd: 'Mod+Alt+[', kbdByPlatform: { windows: 'Ctrl+Shift+[' } }, 'back'),
]
