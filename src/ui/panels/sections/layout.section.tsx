import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { EdId, EditOp, TemplateNode } from '../../../shared/types'
import type { EditorContext, PanelSection, PanelSectionProps } from '../../plugin-api'
import {
  alignmentCell,
  CELL_NAMES,
  cellAlignment,
  isColumnDirection,
  isFlexDisplay,
  isStretchAlignment,
  mainAxisOf,
  sizingModeOf,
  sizingWrites,
  type Axis,
  type LayoutWrite,
  type SizingMode,
} from '../auto-layout'
import { FieldWarning, NumberField, PanelStateContext, useDeclaration, usePanelState, type PanelState } from '../fields'

const CONTAINER_PROPS = ['display', 'flex-direction', 'justify-content', 'align-items']
const ITEM_PROPS = ['flex-grow', 'flex-basis', 'align-self', 'position']
const PARENT_PROPS = ['display', 'flex-direction', 'position']
const SIZING_MODES: readonly (readonly [SizingMode, string])[] = [
  ['hug', 'Hug'],
  ['fill', 'Fill'],
  ['fixed', 'Fixed'],
]
const AXIS_NAMES: Readonly<Record<Axis, string>> = { width: 'Width', height: 'Height' }

const ARROWS = {
  right: <path d="M2.5 8h11M9.5 4l4 4-4 4" />,
  down: <path d="M8 2.5v11M4 9.5l4 4 4-4" />,
}

function Arrow({ to }: { readonly to: keyof typeof ARROWS }) {
  return (
    <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
      {ARROWS[to]}
    </svg>
  )
}

/** Computed values of `edId`, read again whenever the authored styles change. */
function useComputedStyle(edId: EdId | null, props: readonly string[]): Readonly<Record<string, string>> | null {
  const { ctx, styles } = usePanelState()
  const [values, setValues] = useState<Readonly<Record<string, string>> | null>(null)
  useEffect(() => {
    if (!edId) return
    let current = true
    void ctx.read({ kind: 'computed', edId, props }).then((result) => {
      if (current) setValues(result.values)
    })
    return () => {
      current = false
    }
  }, [ctx, edId, props, styles])
  return edId ? values : null
}

function authoredValue(state: PanelState, edId: EdId, prop: string): string | null {
  const source = state.styles[edId]?.find((entry) => entry.target === state.target)
  return source?.declarations.findLast((entry) => entry.prop === prop)?.value ?? null
}

function parentOf(tree: TemplateNode, edId: EdId): TemplateNode | null {
  for (const child of tree.children) {
    if (child.edId === edId) return tree
    const found = parentOf(child, edId)
    if (found) return found
  }
  return null
}

function applyQuietly(ctx: EditorContext, op: EditOp): Promise<unknown> {
  // The ws client already toasted a rejection and reloaded any preview.
  return ctx.apply(op).catch(() => {})
}

function opFor(state: PanelState, targets: readonly EdId[], { prop, value }: LayoutWrite): EditOp {
  const rule = state.target === 'inline' ? {} : { rule: state.target }
  return value === null
    ? { target: targets, kind: 'removeDecl', payload: { prop, ...rule } }
    : { target: targets, kind: 'setDecl', payload: { prop, value, ...rule } }
}

/** One op per distinct write, sent to every target that needs it, in order. */
async function applyWrites(state: PanelState, perTarget: ReadonlyArray<readonly [EdId, readonly LayoutWrite[]]>): Promise<void> {
  const grouped = new Map<string, { readonly write: LayoutWrite; readonly targets: EdId[] }>()
  for (const [edId, writes] of perTarget) {
    for (const write of writes) {
      const key = `${write.prop}\n${write.value}`
      if (!grouped.has(key)) grouped.set(key, { write, targets: [] })
      grouped.get(key)!.targets.push(edId)
    }
  }
  for (const { write, targets } of grouped.values()) await applyQuietly(state.ctx, opFor(state, targets, write))
}

function ToggleButton({ label, on, disabled, onPress, children }: { readonly label: string; readonly on: boolean; readonly disabled: boolean; readonly onPress: () => void; readonly children: ReactNode }) {
  return (
    <button type="button" className={on ? 'on' : undefined} aria-label={label} aria-pressed={on} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  )
}

function AutoLayoutSection({ selection }: PanelSectionProps) {
  const computed = useComputedStyle(selection.edIds[0]!, CONTAINER_PROPS)
  const display = useDeclaration('display')
  const direction = useDeclaration('flex-direction')
  const justify = useDeclaration('justify-content')
  const align = useDeclaration('align-items')
  if (!computed) return null

  if (!isFlexDisplay(display.value ?? computed['display']!)) {
    return (
      <button type="button" className="add-al" disabled={display.locked} onClick={() => display.write('flex')}>
        Add auto layout
      </button>
    )
  }

  const flow = direction.value ?? computed['flex-direction']!
  const alignment = { justifyContent: justify.value ?? computed['justify-content']!, alignItems: align.value ?? computed['align-items']! }
  const checked = alignmentCell(flow, alignment)
  const locked = justify.locked || align.locked
  const warning = [direction, justify, align].map((declaration) => declaration.warning).find(Boolean)

  function pickCell(cell: number) {
    const picked = cellAlignment(flow, cell)
    justify.write(picked.justifyContent)
    align.write(picked.alignItems)
  }

  return (
    <div className="rows layout">
      <style>{SECTION_CSS}</style>
      <div className="r r2">
        <div className="seg" role="radiogroup" aria-label="Direction">
          {(['Horizontal', 'Vertical'] as const).map((name) => {
            const on = isColumnDirection(flow) === (name === 'Vertical')
            return (
              <button
                type="button"
                role="radio"
                key={name}
                className={on ? 'on' : undefined}
                aria-label={name}
                title={name}
                aria-checked={on}
                disabled={direction.locked}
                onClick={() => direction.write(name === 'Vertical' ? 'column' : 'row')}
              >
                <Arrow to={name === 'Vertical' ? 'down' : 'right'} />
              </button>
            )
          })}
        </div>
        <NumberField prop="gap" label="Gap" />
      </div>
      <div className="al">
        <div className="nine" role="radiogroup" aria-label="Alignment">
          {CELL_NAMES.map((name, cell) => (
            <button
              type="button"
              role="radio"
              key={name}
              className={cell === checked ? 'on' : undefined}
              aria-label={name}
              title={name}
              aria-checked={cell === checked}
              disabled={locked}
              onClick={() => pickCell(cell)}
            />
          ))}
        </div>
        <div className="seg col">
          <ToggleButton label="Stretch" on={isStretchAlignment(alignment.alignItems)} disabled={align.locked} onPress={() => align.write('stretch')}>
            Stretch
          </ToggleButton>
          <ToggleButton
            label="Space between"
            on={alignment.justifyContent === 'space-between'}
            disabled={justify.locked}
            onPress={() => justify.write('space-between')}
          >
            Space between
          </ToggleButton>
        </div>
      </div>
      {warning && <FieldWarning message={warning} />}
      <div className="r r2">
        <NumberField prop="padding-top" label="Top" />
        <NumberField prop="padding-right" label="Right" />
        <NumberField prop="padding-bottom" label="Bottom" />
        <NumberField prop="padding-left" label="Left" />
      </div>
    </div>
  )
}

interface SizingControlProps {
  readonly axis: Axis
  readonly onMain: boolean
  readonly item: Readonly<Record<string, string>>
}

function SizingControl({ axis, onMain, item }: SizingControlProps) {
  const state = usePanelState()
  const first = state.edIds[0]!
  const mode = sizingModeOf(onMain, {
    flexGrow: item['flex-grow']!,
    flexBasis: item['flex-basis']!,
    alignSelf: item['align-self']!,
    authoredSize: authoredValue(state, first, axis),
  })

  async function pick(next: SizingMode) {
    const perTarget = await Promise.all(
      state.edIds.map(async (edId) => {
        const [rect] = (await state.ctx.read({ kind: 'rects', edId })).rects
        const writes = sizingWrites(next, axis, onMain, (prop) => authoredValue(state, edId, prop), rect?.[axis] ?? 0)
        return [edId, writes] as const
      }),
    )
    await applyWrites(state, perTarget)
  }

  return (
    <div className="seg" role="radiogroup" aria-label={`${AXIS_NAMES[axis]} sizing`}>
      {SIZING_MODES.map(([value, name]) => (
        <button
          type="button"
          role="radio"
          key={value}
          className={mode === value ? 'on' : undefined}
          aria-checked={mode === value}
          disabled={!state.editable}
          onClick={() => void pick(value)}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

async function warnIfContentBox(ctx: EditorContext, op: EditOp): Promise<void> {
  if (op.kind !== 'setDecl' || !op.payload.prop.startsWith('max-')) return
  const boxes = await Promise.all(op.target.map((edId) => ctx.read({ kind: 'computed', edId, props: ['box-sizing'] })))
  if (!boxes.some((box) => box.values['box-sizing'] === 'content-box')) return
  ctx.toast({ message: `padding adds to ${op.payload.prop} on a content-box element`, tone: 'warning' })
}

/** Fields inside see an `apply` that warns when a `max-*` lands on a content-box element (R08 C2). */
function ContentBoxMaxWarning({ children }: { readonly children: ReactNode }) {
  const state = usePanelState()
  const scoped = useMemo<PanelState>(() => {
    const { ctx } = state
    const apply = async (op: EditOp) => {
      const ack = await ctx.apply(op)
      void warnIfContentBox(ctx, op)
      return ack
    }
    return { ...state, ctx: { ...ctx, apply } }
  }, [state])
  return <PanelStateContext.Provider value={scoped}>{children}</PanelStateContext.Provider>
}

async function positionOf(ctx: EditorContext, edId: EdId): Promise<string> {
  return (await ctx.read({ kind: 'computed', edId, props: ['position'] })).values['position'] ?? 'static'
}

/** Absolute descendants of `node` whose containing block is further out, so they move when `node` is positioned. */
async function countUncontainedAbsolutes(ctx: EditorContext, node: TemplateNode, skipped: readonly EdId[]): Promise<number> {
  const counts = await Promise.all(
    node.children
      .filter((child) => !skipped.includes(child.edId))
      .map(async (child) => {
        const position = await positionOf(ctx, child.edId)
        if (position === 'absolute') return 1
        return position === 'static' ? countUncontainedAbsolutes(ctx, child, skipped) : 0
      }),
  )
  return counts.reduce((sum, count) => sum + count, 0)
}

function containingBlockWarning(parent: TemplateNode, count: number): string {
  return `${count} absolutely positioned ${count === 1 ? 'layer' : 'layers'} inside ${parent.name} now ${count === 1 ? 'positions' : 'position'} against it`
}

/** R02 §3: the item leaves the flow as `position: absolute` and its static parent becomes `position: relative`. */
async function ignoreAutoLayout(state: PanelState, tree: TemplateNode): Promise<void> {
  const { ctx, edIds } = state
  const parents = [...new Set(edIds.map((edId) => parentOf(tree, edId)).filter((parent) => parent !== null))]
  const staticParents = (await Promise.all(parents.map(async (parent) => ((await positionOf(ctx, parent.edId)) === 'static' ? parent : null)))).filter(
    (parent) => parent !== null,
  )
  const moved = await Promise.all(staticParents.map(async (parent) => [parent, await countUncontainedAbsolutes(ctx, parent, edIds)] as const))
  await applyWrites(
    state,
    edIds.map((edId) => [edId, [{ prop: 'position', value: 'absolute' }]]),
  )
  for (const parent of staticParents) {
    await applyQuietly(ctx, { target: [parent.edId], kind: 'setDecl', payload: { prop: 'position', value: 'relative' } })
  }
  for (const [parent, count] of moved) if (count > 0) ctx.toast({ message: containingBlockWarning(parent, count), tone: 'warning' })
}

function SizeSection({ ctx, selection }: PanelSectionProps) {
  const state = usePanelState()
  const tree = ctx.index()?.tree
  const first = selection.edIds[0]!
  const parent = tree ? parentOf(tree, first) : null
  const item = useComputedStyle(first, ITEM_PROPS)
  const container = useComputedStyle(parent?.edId ?? null, PARENT_PROPS)
  const inFlex = item !== null && container !== null && isFlexDisplay(container['display']!)
  const mainAxis = mainAxisOf(container?.['flex-direction'] ?? 'row')

  return (
    <div className="rows layout">
      <style>{SECTION_CSS}</style>
      {(['width', 'height'] as const).map((axis) => (
        <div className={inFlex ? 'sz' : 'sz plain'} key={axis}>
          {inFlex && <SizingControl axis={axis} onMain={axis === mainAxis} item={item} />}
          <NumberField prop={axis} label={axis === 'width' ? 'W' : 'H'} />
        </div>
      ))}
      <ContentBoxMaxWarning>
        <div className="r r2">
          <NumberField prop="min-width" label="Min W" />
          <NumberField prop="max-width" label="Max W" />
          <NumberField prop="min-height" label="Min H" />
          <NumberField prop="max-height" label="Max H" />
        </div>
      </ContentBoxMaxWarning>
      {inFlex && tree && item['position'] !== 'absolute' && (
        <button type="button" className="add-al" disabled={!state.editable} onClick={() => void ignoreAutoLayout(state, tree)}>
          Ignore auto layout
        </button>
      )}
    </div>
  )
}

const always = () => true

export const sections: PanelSection[] = [
  { id: 'auto-layout', title: 'Auto layout', order: 10, appliesTo: always, component: AutoLayoutSection },
  { id: 'size', title: 'Size', order: 12, appliesTo: always, component: SizeSection },
]

const SECTION_CSS = `
.props .layout .seg{display:flex;background:var(--field);border-radius:var(--r-sm);padding:2px;height:28px;gap:0}
.props .layout .seg button{height:24px;flex:1;display:flex;align-items:center;justify-content:center;gap:4px;padding:0 4px;border-radius:var(--r-xs);font-size:11px;font-weight:500;color:var(--text-3)}
.props .layout .seg button.on{background:var(--seg-on);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.18)}
.props .layout .seg.col{flex-direction:column;height:auto;align-self:start}
.props .layout .seg.col button{width:100%}
.props .layout .al{display:grid;grid-template-columns:64px 1fr;gap:8px}
.props .layout .nine{width:64px;height:64px;border-radius:var(--r-sm);background:var(--field);display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);padding:4px}
.props .layout .nine button{display:grid;place-items:center;padding:0;border-radius:var(--r-xs)}
.props .layout .nine button::before{content:"";width:3px;height:3px;border-radius:50%;background:var(--text-3);opacity:.7}
.props .layout .nine button.on{background:var(--seg-on);box-shadow:0 1px 2px rgba(0,0,0,.2)}
.props .layout .nine button.on::before{width:8px;height:2px;border-radius:1px;background:var(--accent);opacity:1}
.props .layout .sz{display:grid;grid-template-columns:1fr 88px;gap:8px;align-items:center}
.props .layout .sz.plain{grid-template-columns:1fr}
.props .layout .add-al{height:28px;border-radius:var(--r-sm);border:1px dashed var(--line-strong);color:var(--text-2);font-weight:500}
.props .layout .add-al:hover:not(:disabled){background:var(--field);color:var(--text)}
`
