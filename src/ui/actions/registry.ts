/// <reference types="vite/client" />
import type { EditorAction, EditorContext } from '../plugin-api'

export interface ActionModule {
  readonly actions: readonly EditorAction[]
}

export type Platform = 'mac' | 'windows'

export interface ActionRegistry {
  readonly all: () => readonly EditorAction[]
  readonly get: (id: string) => EditorAction | undefined
  /** Runs the first enabled action bound to the key; returns whether one ran. */
  readonly handleKeyDown: (event: KeyboardEvent, ctx: EditorContext) => boolean
  readonly setTextEditing: (editing: boolean) => void
}

interface Chord {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

type ModifierState = Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

function parseKbd(kbd: string, platform: Platform): Chord {
  const parts = kbd.split('+')
  const key = parts.pop() ?? ''
  const has = (modifier: string) => parts.includes(modifier)
  return {
    key: key.toLowerCase(),
    metaKey: platform === 'mac' && has('Mod'),
    ctrlKey: has('Ctrl') || (platform === 'windows' && has('Mod')),
    shiftKey: has('Shift'),
    altKey: has('Alt'),
  }
}

function sameModifiers(a: ModifierState, b: ModifierState): boolean {
  return a.metaKey === b.metaKey && a.ctrlKey === b.ctrlKey && a.shiftKey === b.shiftKey && a.altKey === b.altKey
}

export function createActionRegistry(modules: Record<string, ActionModule>, platform: Platform): ActionRegistry {
  const actions = Object.values(modules).flatMap((module) => module.actions)
  const byId = new Map(actions.map((entry) => [entry.id, entry]))
  const bound = actions.flatMap((entry) => (entry.kbd ? [{ entry, chord: parseKbd(entry.kbd, platform) }] : []))
  let textEditing = false

  function handleKeyDown(event: KeyboardEvent, ctx: EditorContext): boolean {
    if (textEditing) return false
    const key = event.key.toLowerCase()
    const match = bound.find(
      ({ entry, chord }) => chord.key === key && sameModifiers(chord, event) && (entry.when?.(ctx) ?? true),
    )
    if (!match) return false
    event.preventDefault()
    match.entry.run(ctx)
    return true
  }

  return {
    all: () => actions,
    get: (id) => byId.get(id),
    handleKeyDown,
    setTextEditing(editing) {
      textEditing = editing
    },
  }
}

export function createDefaultRegistry(platform: Platform): ActionRegistry {
  return createActionRegistry(import.meta.glob<ActionModule>('./*.actions.ts', { eager: true }), platform)
}
