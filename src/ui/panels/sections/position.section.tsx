import { useEffect, useState } from 'react'
import type { EdId } from '../../../shared/types'
import { parentOf } from '../../canvas/selection'
import type { EditorContext, PanelSection } from '../../plugin-api'
import { NumberField, usePanelState } from '../fields'

const OFFSET_POSITIONS = new Set(['absolute', 'fixed', 'relative', 'sticky'])
const AUTO_LAYOUT_DISPLAYS = new Set(['flex', 'inline-flex', 'grid', 'inline-grid'])

/** Where the first selected element sits and what places it. */
interface Placement {
  readonly edId: EdId
  readonly position: string
  readonly inAutoLayout: boolean
  readonly x: number | null
  readonly y: number | null
}

async function placementOf(ctx: EditorContext, edId: EdId): Promise<Placement> {
  const tree = ctx.index()?.tree
  const parent = tree ? parentOf(tree, edId) : null
  const [own, container, rendered] = await Promise.all([
    ctx.read({ kind: 'computed', edId, props: ['position'] }),
    parent ? ctx.read({ kind: 'computed', edId: parent, props: ['display'] }) : null,
    ctx.read({ kind: 'rects', edId }),
  ])
  const [rect] = rendered.rects
  return {
    edId,
    position: own.values['position'] || 'static',
    inAutoLayout: AUTO_LAYOUT_DISPLAYS.has(container?.values['display'] ?? ''),
    x: rect ? Math.round(rect.x) : null,
    y: rect ? Math.round(rect.y) : null,
  }
}

function usePlacement(): Placement | null {
  const { ctx, edIds, styles } = usePanelState()
  const first = edIds[0]!
  const [placement, setPlacement] = useState<Placement | null>(null)
  useEffect(() => {
    let current = true
    placementOf(ctx, first)
      .then((next) => {
        if (current) setPlacement(next)
      })
      // A reload rejects reads in flight; the next index change reads again.
      .catch(() => {})
    return () => {
      current = false
    }
  }, [ctx, first, styles])
  return placement?.edId === first ? placement : null
}

const isOffset = (placement: Placement) => OFFSET_POSITIONS.has(placement.position)

function PlacementNote() {
  const placement = usePlacement()
  if (!placement) return null
  if (isOffset(placement)) return <>{placement.position}</>
  return placement.inAutoLayout ? <>in auto layout</> : null
}

/** A position the layout decides: shown, never written. */
function PlacedAt({ label, value }: { readonly label: string; readonly value: number | null }) {
  return (
    <div className="field" data-placed={label}>
      <div className="f dis" title="Set by the layout">
        <span className="l">{label}</span>
        <span className="v">{value ?? ''}</span>
      </div>
    </div>
  )
}

function PositionSection() {
  const placement = usePlacement()
  if (!placement) return null
  return (
    <div className="r r3">
      {isOffset(placement) ? (
        <>
          <NumberField prop="left" label="X" />
          <NumberField prop="top" label="Y" />
        </>
      ) : (
        <>
          <PlacedAt label="X" value={placement.x} />
          <PlacedAt label="Y" value={placement.y} />
        </>
      )}
      <NumberField prop="rotate" label="Rotation" icon="rotate" />
    </div>
  )
}

export const sections: PanelSection[] = [
  { id: 'position', title: 'Position', order: 5, appliesTo: () => true, component: PositionSection, note: PlacementNote },
]
