import { nudgeSelection } from '../canvas/tools/move.tool'
import type { Point } from '../canvas/viewport'
import type { EditorAction, EditorContext } from '../plugin-api'

const BIG_NUDGE = 10

const DIRECTIONS: ReadonlyArray<readonly [key: string, name: string, step: Point]> = [
  ['ArrowUp', 'Up', { x: 0, y: -1 }],
  ['ArrowDown', 'Down', { x: 0, y: 1 }],
  ['ArrowLeft', 'Left', { x: -1, y: 0 }],
  ['ArrowRight', 'Right', { x: 1, y: 0 }],
]

const canNudge = (ctx: EditorContext) => !ctx.readOnly() && (ctx.selection()?.edIds.length ?? 0) > 0

function nudgeAction(id: string, label: string, kbd: string, delta: Point): EditorAction {
  return {
    id,
    label,
    kbd,
    scope: 'canvas',
    hold: true,
    when: canNudge,
    // A reload rejects the reads; the nudge is then dropped.
    run: (ctx, actionId) => void nudgeSelection(ctx, delta, actionId).catch(() => {}),
  }
}

export const actions: EditorAction[] = DIRECTIONS.flatMap(([key, name, step]) => [
  nudgeAction(`move.nudge${name}`, `Nudge ${name.toLowerCase()}`, key, step),
  nudgeAction(`move.nudge${name}Big`, `Nudge ${name.toLowerCase()} ${BIG_NUDGE} px`, `Shift+${key}`, { x: step.x * BIG_NUDGE, y: step.y * BIG_NUDGE }),
])
