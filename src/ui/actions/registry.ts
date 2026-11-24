/// <reference types="vite/client" />
import { mintHeldActionId } from '../../shared/types'
import type { ActionScope, EditorAction, EditorContext } from '../plugin-api'

export interface ActionModule {
  readonly actions: readonly EditorAction[]
}

export type Platform = 'mac' | 'windows'

export interface ActionRegistry {
  readonly all: () => readonly EditorAction[]
  readonly get: (id: string) => EditorAction | undefined
  /** The alias menus and the palette show: the action's first. */
  readonly shortcutOf: (id: string) => string | undefined
  /** Runs the first enabled in-scope action bound to the key; returns whether one ran. */
  readonly handleKeyDown: (event: KeyboardEvent, ctx: EditorContext) => boolean
  readonly handleKeyUp: (event: KeyboardEvent) => void
  readonly handleBlur: () => void
  readonly setTextEditing: (editing: boolean) => void
}

interface Chord {
  /** Lower-cased: a character, or a named key such as `delete`. */
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

interface Binding {
  readonly action: EditorAction
  readonly chord: Chord
}

interface HeldAction {
  readonly action: EditorAction
  readonly code: string
  readonly actionId: string
}

type ModifierState = Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

const LAYERS_PANEL = '.layers'
const CANVAS_VIEWPORT = '[data-canvas-viewport]'

/** The character each punctuation key types on a US layout. */
const US_PUNCTUATION: Readonly<Record<string, string>> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
}

function aliasesOf(action: EditorAction, platform: Platform): readonly string[] {
  const kbd = action.kbdByPlatform?.[platform] ?? action.kbd
  if (kbd === undefined) return []
  return typeof kbd === 'string' ? [kbd] : kbd
}

function scopesOf(action: EditorAction): readonly ActionScope[] {
  const scope = action.scope ?? 'global'
  return typeof scope === 'string' ? [scope] : scope
}

/** `Mod++` is Mod and the + key. */
function parseKbd(kbd: string, platform: Platform): Chord {
  const key = kbd.endsWith('+') ? '+' : kbd.slice(kbd.lastIndexOf('+') + 1)
  const modifiers = kbd.slice(0, kbd.length - key.length).split('+')
  const has = (modifier: string) => modifiers.includes(modifier)
  return {
    key: key.toLowerCase(),
    metaKey: platform === 'mac' && has('Mod'),
    ctrlKey: has('Ctrl') || (platform === 'windows' && has('Mod')),
    shiftKey: has('Shift'),
    altKey: has('Alt'),
  }
}

const isNamedKey = (key: string) => key.length > 1
const isAsciiLetterOrDigit = (key: string) => /^[a-z0-9]$/i.test(key)

function usCharacterOf(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit\d$/.test(code)) return code.slice(5)
  return US_PUNCTUATION[code]
}

function sameModifiers(a: ModifierState, b: ModifierState): boolean {
  return a.shiftKey === b.shiftKey && sameModifiersBesidesShift(a, b)
}

function sameModifiersBesidesShift(a: ModifierState, b: ModifierState): boolean {
  return a.metaKey === b.metaKey && a.ctrlKey === b.ctrlKey && a.altKey === b.altKey
}

/** Any other character already carries Shift, so a chord naming Shift is reached only through the code. */
function matchesKey(chord: Chord, event: KeyboardEvent): boolean {
  const { key } = event
  if (isNamedKey(key) || isAsciiLetterOrDigit(key)) return chord.key === key.toLowerCase() && sameModifiers(chord, event)
  return chord.key === key && !chord.shiftKey && sameModifiersBesidesShift(chord, event)
}

function matchesCode(chord: Chord, event: KeyboardEvent): boolean {
  return chord.key === usCharacterOf(event.code) && sameModifiers(chord, event)
}

const isAsciiPunctuation = (key: string) => /^[!-/:-@[-`{-~]$/.test(key)

/** Letters, digits and unshifted punctuation follow the layout's label; only a composed, shifted or non-Latin character retries on its key's position. */
function mayMatchCode(event: KeyboardEvent): boolean {
  const modified = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
  if (!modified || isNamedKey(event.key) || isAsciiLetterOrDigit(event.key)) return false
  return event.altKey || event.shiftKey || !isAsciiPunctuation(event.key)
}

function isAltGraph(event: KeyboardEvent, platform: Platform): boolean {
  // A key replayed from a plain object has no getModifierState.
  return platform === 'windows' && event.ctrlKey && event.altKey && event.getModifierState?.('AltGraph') === true
}

/** The element the keydown came from; null when nothing has focus, so the key lands on the body. */
function focusedElement(event: KeyboardEvent): Element | null {
  const { target } = event
  if (!target || !('closest' in target)) return null
  const element = target as Element
  return element === element.ownerDocument.body ? null : element
}

function isTextEntry(element: Element): boolean {
  return element.matches('input, textarea, select') || element.closest('[contenteditable]:not([contenteditable="false"])') !== null
}

function isInScope(scope: ActionScope, focused: Element | null): boolean {
  switch (scope) {
    case 'canvas':
      return focused === null || focused.closest(CANVAS_VIEWPORT) !== null
    case 'layers':
      return focused !== null && focused.closest(LAYERS_PANEL) !== null
    case 'global':
      return true
  }
}

function appliesAt(action: EditorAction, focused: Element | null): boolean {
  if (focused && isTextEntry(focused) && !action.inTextEntry) return false
  return scopesOf(action).some((scope) => isInScope(scope, focused))
}

export function createActionRegistry(modules: Record<string, ActionModule>, platform: Platform): ActionRegistry {
  const actions = Object.values(modules).flatMap((module) => module.actions)
  const byId = new Map(actions.map((entry) => [entry.id, entry]))
  const bindings: Binding[] = actions.flatMap((action) => aliasesOf(action, platform).map((kbd) => ({ action, chord: parseKbd(kbd, platform) })))
  let textEditing = false
  let held: HeldAction | null = null

  function matchingBindings(event: KeyboardEvent): Binding[] {
    const focused = focusedElement(event)
    const inScope = bindings.filter(({ action }) => appliesAt(action, focused))
    const byKey = inScope.filter(({ chord }) => matchesKey(chord, event))
    if (byKey.length > 0 || !mayMatchCode(event)) return byKey
    return inScope.filter(({ chord }) => matchesCode(chord, event))
  }

  function actionIdFor(action: EditorAction, event: KeyboardEvent): string {
    const actionId = event.repeat && held?.action === action ? held.actionId : action.hold ? mintHeldActionId() : crypto.randomUUID()
    held = action.hold ? { action, code: event.code, actionId } : null
    return actionId
  }

  function handleKeyDown(event: KeyboardEvent, ctx: EditorContext): boolean {
    if (textEditing || isAltGraph(event, platform)) return false
    const matched = matchingBindings(event)
    if (matched.length === 0) return false
    // A disabled chord is still prevented: Mod-[ and Alt-D would otherwise reach the browser as Back and the address bar.
    event.preventDefault()
    const enabled = matched.find(({ action }) => action.when?.(ctx) ?? true)
    if (!enabled) {
      const reason = matched[0]!.action.disabledReason
      if (reason) ctx.toast({ message: reason, tone: 'info' })
      return false
    }
    enabled.action.run(ctx, actionIdFor(enabled.action, event))
    return true
  }

  return {
    all: () => actions,
    get: (id) => byId.get(id),
    shortcutOf: (id) => {
      const action = byId.get(id)
      return action && aliasesOf(action, platform)[0]
    },
    handleKeyDown,
    handleKeyUp(event) {
      if (held?.code === event.code) held = null
    },
    handleBlur() {
      held = null
    },
    setTextEditing(editing) {
      textEditing = editing
    },
  }
}

export function createDefaultRegistry(platform: Platform): ActionRegistry {
  return createActionRegistry(import.meta.glob<ActionModule>('./*.actions.ts', { eager: true }), platform)
}
