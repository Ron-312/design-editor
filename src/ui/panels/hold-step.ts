import { useRef } from 'react'
import type { EditorContext } from '../plugin-api'

interface StepKey {
  readonly key: string
  readonly repeat: boolean
}

/**
 * One action id for a step key's press and its repeats, so a held key is one undo entry and one write
 * (plan contract #6). The key's keyup or the field's blur releases it.
 */
export function useHeldStep(ctx: EditorContext) {
  const held = useRef<{ readonly key: string; readonly actionId: string } | null>(null)
  return {
    actionFor({ key, repeat }: StepKey): string {
      if (!repeat || held.current?.key !== key) held.current = { key, actionId: ctx.beginAction({ held: true }) }
      return held.current.actionId
    },
    keyUp({ key }: Pick<StepKey, 'key'>) {
      if (held.current?.key === key) held.current = null
    },
    release() {
      held.current = null
    },
  }
}
