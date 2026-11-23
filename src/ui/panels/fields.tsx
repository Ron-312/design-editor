import { createContext, useContext, useEffect, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { BoardIndex, DesignToken } from '../../shared/protocol'
import type { AuthoredDeclaration, EdId, EditOp, RuleId, StyleSource } from '../../shared/types'
import type { EditorContext } from '../plugin-api'
import { colorAlpha, computedColour, inAuthoredColorFormat, shownComputed, stepNumber, withAuthoredUnit, withColorAlpha } from './css-values'

const ICON_PATHS = {
  'chev-d': <path d="M4 6l4 4 4-4" />,
  'chev-r': <path d="M6 4l4 4-4 4" />,
  eye: (
    <>
      <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  'eye-off': (
    <path d="M2.5 2.5l11 11M6.4 3.7A6.4 6.4 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11.5 11.5 0 0 1-1.6 2.1M10 12.2a6 6 0 0 1-2 .3C3.9 12.5 1.5 8 1.5 8a11.3 11.3 0 0 1 2.4-2.8M6.6 6.6a2 2 0 0 0 2.8 2.8" />
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  unlock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1" />
    </>
  ),
  frame: <path d="M5 2v12M11 2v12M2 5h12M2 11h12" />,
  box: <rect x="2.5" y="2.5" width="11" height="11" rx="2" />,
  text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6 13h4" />,
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.2" />
      <path d="M2.5 11.5l3.5-3 3 2.5 1.8-1.5 2.7 2.2" />
    </>
  ),
  grid: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </>
  ),
  file: (
    <>
      <path d="M4 2h5.5L12.5 5v9H4z" />
      <path d="M9.5 2v3h3" />
    </>
  ),
  link: <path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" />,
  code: <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />,
  warn: (
    <>
      <path d="M7.1 2.9a1 1 0 0 1 1.8 0l5.4 9.6a1 1 0 0 1-.9 1.5H2.6a1 1 0 0 1-.9-1.5z" />
      <path d="M8 6.5v3M8 11.6v.1" />
    </>
  ),
  minus: <path d="M3.5 8h9" />,
  radius: <path d="M2.5 13.5V8a5.5 5.5 0 0 1 5.5-5.5h5.5" />,
  opacity: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
    </>
  ),
  stroke: (
    <>
      <path d="M2.5 4h11" />
      <path d="M2.5 8h11" strokeWidth="2.2" />
      <path d="M2.5 12.5h11" strokeWidth="3" />
    </>
  ),
  shadow: (
    <>
      <rect x="2.5" y="2.5" width="8.5" height="8.5" rx="1.5" />
      <path d="M13.5 5.5v6a2 2 0 0 1-2 2h-6" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </>
  ),
  rotate: <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5" />,
  'font-size': <path d="M2 13l3.5-9 3.5 9M3.2 10h4.6M10 13l2-5 2 5M10.7 11.5h2.6" />,
  lh: <path d="M2.5 2.5h11M2.5 13.5h11M5.5 11l2.5-6 2.5 6M6.5 9h3" />,
  ls: <path d="M2.5 3v10M13.5 3v10M5.5 11l2.5-6 2.5 6M6.5 9h3" />,
} as const

export type IconName = keyof typeof ICON_PATHS

/** The B Warm studio icon set: 16px grid, 1.5 stroke, round joins. */
export function Icon({ name }: { readonly name: IconName }) {
  return (
    <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  )
}

export type Token = DesignToken

/** Where edits land: the element's inline `style`, or the `<helmet><style>` rule picked in the selector chip. */
export type StyleTarget = 'inline' | RuleId

export interface PanelState {
  readonly ctx: EditorContext
  readonly edIds: readonly EdId[]
  readonly styles: BoardIndex['styles']
  readonly target: StyleTarget
  readonly tokens: readonly Token[]
  readonly editable: boolean
}

export const PanelStateContext = createContext<PanelState | null>(null)

export function usePanelState(): PanelState {
  const state = useContext(PanelStateContext)
  if (!state) throw new Error('panel fields render only inside the properties panel')
  return state
}

export function labelOf(source: StyleSource): string {
  return source.target === 'inline' ? 'style' : (source.selector ?? source.target)
}

function declarationIn(sources: readonly StyleSource[] | undefined, target: StyleTarget, prop: string): AuthoredDeclaration | null {
  return sources?.find((source) => source.target === target)?.declarations.findLast((entry) => entry.prop === prop) ?? null
}

const PX_LENGTH = /^-?(?:\d+\.?\d*|\.\d+)px$/

/** The authored declaration the live value came from instead of the written one. */
function rivalOf(sources: readonly StyleSource[], target: StyleTarget, prop: string, live: string): StyleSource | null {
  const beats = (entry: AuthoredDeclaration) => entry.prop === prop && (entry.important || entry.value === live)
  return sources.find((source) => source.target !== target && source.declarations.some(beats)) ?? null
}

async function overrideWarning(state: PanelState, prop: string, written: string): Promise<string | null> {
  const lives = await Promise.all(
    state.edIds.map(async (edId) => ({ edId, live: (await state.ctx.read({ kind: 'computed', edId, props: [prop] })).values[prop] })),
  )
  for (const { edId, live } of lives) {
    if (!live || live === written) continue
    const rival = rivalOf(state.styles[edId] ?? [], state.target, prop, live)
    if (rival) return `overridden by ${labelOf(rival)}`
    // Computed values are normalised (rem to px, colours to rgb), so only a px write can be compared verbatim.
    if (PX_LENGTH.test(written)) return 'a script overrides this value'
  }
  return null
}

export interface Declaration {
  /** The value every target shares; null when none is authored or the targets differ. */
  readonly value: string | null
  readonly mixed: boolean
  /** A `{{hole}}`, a read-only node or a push lock: shown, never written. */
  readonly locked: boolean
  readonly warning: string | null
  readonly write: (value: string) => void
  readonly remove: () => void
}

function sharedDeclaration(state: PanelState, prop: string) {
  const entries = state.edIds.map((edId) => declarationIn(state.styles[edId], state.target, prop))
  const first = entries[0] ?? null
  const mixed = entries.some((entry) => entry?.value !== first?.value)
  return { value: mixed ? null : (first?.value ?? null), mixed, hasHole: entries.some((entry) => entry?.hasHole) }
}

export function useDeclaration(prop: string): Declaration {
  const state = usePanelState()
  const [warning, setWarning] = useState<string | null>(null)
  const shared = sharedDeclaration(state, prop)
  const locked = !state.editable || shared.hasHole
  const rule = state.target === 'inline' ? {} : { rule: state.target }

  async function send(op: EditOp, written: string | null) {
    try {
      await state.ctx.apply(op)
    } catch {
      // The ws client already toasted the rejection and reloaded any preview.
      return
    }
    setWarning(written === null ? null : await overrideWarning(state, prop, written))
  }

  return {
    ...shared,
    locked,
    warning,
    write(value) {
      if (locked) return
      void send({ target: state.edIds, kind: 'setDecl', payload: { prop, value, ...rule } }, value)
    },
    remove() {
      if (locked) return
      void send({ target: state.edIds, kind: 'removeDecl', payload: { prop, ...rule } }, null)
    },
  }
}

/** The live value of `prop` on the one selected element, read again whenever the authored styles change; null for a multi-selection. */
export function useComputedValue(prop: string): string | null {
  const { ctx, edIds, styles } = usePanelState()
  const only = edIds.length === 1 ? edIds[0]! : null
  const [computed, setComputed] = useState<{ readonly edId: EdId; readonly value: string } | null>(null)
  useEffect(() => {
    if (!only) return
    let current = true
    ctx
      .read({ kind: 'computed', edId: only, props: [prop] })
      .then((result) => {
        if (current) setComputed({ edId: only, value: result.values[prop] ?? '' })
      })
      // A reload rejects reads in flight; the next index change reads again.
      .catch(() => {})
    return () => {
      current = false
    }
  }, [ctx, only, prop, styles])
  return computed && computed.edId === only && computed.value !== '' ? computed.value : null
}

interface FieldText {
  readonly text: string
  readonly dirty: boolean
}

/** A field's typed text, dropped as soon as the authored value under it changes. */
function useFieldText(shown: string) {
  const [edit, setEdit] = useState<(FieldText & { readonly base: string }) | null>(null)
  const current = edit && edit.base === shown ? edit : null
  return {
    text: current?.text ?? shown,
    dirty: current?.dirty ?? false,
    type: (text: string) => setEdit({ text, dirty: true, base: shown }),
    show: (text: string) => setEdit({ text, dirty: false, base: shown }),
    reset: () => setEdit(null),
  }
}

type FieldTextState = ReturnType<typeof useFieldText>

interface TextInputProps {
  readonly label: string
  readonly declaration: Declaration
  readonly field: FieldTextState
  readonly onCommit: (text: string) => void
  readonly onStep?: (direction: 1 | -1, large: boolean) => void
  readonly placeholder?: string | undefined
  readonly disabled?: boolean
}

function TextInput({ label, declaration, field, onCommit, onStep, placeholder, disabled }: TextInputProps) {
  function commit() {
    if (!field.dirty) return
    field.reset()
    onCommit(field.text.trim())
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') return commit()
    if (event.key === 'Escape') return field.reset()
    if (!onStep || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    onStep(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey)
  }

  return (
    <input
      className="v"
      aria-label={label}
      title={label}
      value={field.text}
      placeholder={declaration.mixed ? 'Mixed' : placeholder}
      readOnly={declaration.locked}
      disabled={disabled}
      spellCheck={false}
      onChange={(event: ChangeEvent<HTMLInputElement>) => field.type(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  )
}

function FieldShell({ prop, declaration, children }: { readonly prop: string; readonly declaration: Declaration; readonly children: ReactNode }) {
  return (
    <div className="field" data-prop={prop}>
      <div className={declaration.locked ? 'f dis' : 'f'}>{children}</div>
      {declaration.warning && <FieldWarning message={declaration.warning} />}
    </div>
  )
}

export function FieldWarning({ message }: { readonly message: string }) {
  return (
    <p className="fwarn" role="status">
      <Icon name="warn" />
      {message}
    </p>
  )
}

const TOKEN_REFERENCE = /^var\(\s*(--[\w-]+)\s*\)$/

export function boundTokenName(value: string | null): string | null {
  return value?.match(TOKEN_REFERENCE)?.[1] ?? null
}

export function TokenPill({ name }: { readonly name: string }) {
  return (
    <span className="tok" data-token={name} title={`Bound to token ${name}`}>
      <Icon name="link" />
      {name}
    </span>
  )
}

function tokenValue(token: Token): string {
  return token.source === ':root' ? `var(${token.name})` : token.value
}

function TokenPicker({ declaration }: { readonly declaration: Declaration }) {
  const { tokens } = usePanelState()
  const [open, setOpen] = useState(false)
  if (tokens.length === 0) return null

  function pick(token: Token) {
    setOpen(false)
    declaration.write(tokenValue(token))
  }

  return (
    <span className="picker">
      <button
        type="button"
        className="ib"
        aria-label="Tokens"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={declaration.locked}
        onClick={() => setOpen(!open)}
      >
        <Icon name="link" />
      </button>
      {open && (
        <div className="pop" role="listbox" aria-label="Tokens" onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}>
          {tokens.map((token) => (
            <button type="button" key={token.name} role="option" aria-selected={false} className="opt" onClick={() => pick(token)}>
              <span className="sw" style={{ background: token.value }} />
              <span className="mono">{token.name}</span>
              <span className="mono dimmed">{token.value}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

export interface NumberFieldProps {
  readonly prop: string
  readonly label: string
  readonly icon?: IconName
  /** The row names the field already, so it shows no label of its own. */
  readonly bare?: boolean
}

export function NumberField({ prop, label, icon, bare = false }: NumberFieldProps) {
  const declaration = useDeclaration(prop)
  const field = useFieldText(declaration.value ?? '')
  const token = boundTokenName(declaration.value)
  const computed = useComputedValue(prop)

  function step(direction: 1 | -1, large: boolean) {
    const stepped = stepNumber(field.text, direction * (large ? 10 : 1))
    if (stepped === null || declaration.locked) return
    const written = withAuthoredUnit(prop, stepped, declaration.value)
    field.show(written)
    declaration.write(written)
  }

  return (
    <FieldShell prop={prop} declaration={declaration}>
      {!bare && (
        <span className="l" title={label}>
          {icon ? <Icon name={icon} /> : label}
        </span>
      )}
      {token && <TokenPill name={token} />}
      <TextInput
        label={label}
        declaration={declaration}
        field={field}
        placeholder={computed === null ? undefined : shownComputed(prop, computed)}
        onStep={step}
        onCommit={(text) => (text ? declaration.write(withAuthoredUnit(prop, text, declaration.value)) : declaration.remove())}
      />
      <TokenPicker declaration={declaration} />
    </FieldShell>
  )
}

export function TextField({ prop, label }: { readonly prop: string; readonly label: string }) {
  const declaration = useDeclaration(prop)
  const field = useFieldText(declaration.value ?? '')
  const computed = useComputedValue(prop)
  return (
    <FieldShell prop={prop} declaration={declaration}>
      <TextInput
        label={label}
        declaration={declaration}
        field={field}
        placeholder={computed ?? undefined}
        onCommit={(text) => (text ? declaration.write(text) : declaration.remove())}
      />
      <TokenPicker declaration={declaration} />
    </FieldShell>
  )
}

/** Null, meaning no change, for anything but a number: an emptied field included. */
function parsePercent(text: string): number | null {
  const digits = text.trim().replace(/%$/, '').trim()
  if (digits === '') return null
  const percent = Number(digits)
  return Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) / 100 : null
}

export function ColourField({ prop, label }: { readonly prop: string; readonly label: string }) {
  const declaration = useDeclaration(prop)
  const token = boundTokenName(declaration.value)
  const authored = declaration.value ?? ''
  const alpha = colorAlpha(authored)
  const colourText = useFieldText(token ? '' : authored)
  const alphaText = useFieldText(alpha === null ? '' : `${Math.round(alpha * 100)}%`)
  const computedValue = useComputedValue(prop)
  const computed = declaration.value === null && computedValue ? computedColour(computedValue) : null
  const shownComputedColour = computed && computed.alpha > 0 ? computed : null

  function commitColour(text: string) {
    if (!text) return declaration.remove()
    declaration.write(inAuthoredColorFormat(authored, text))
  }

  function commitAlpha(text: string) {
    const next = parsePercent(text)
    const written = next === null ? null : withColorAlpha(authored, next)
    if (written) declaration.write(written)
  }

  return (
    <FieldShell prop={prop} declaration={declaration}>
      {token ? (
        <TokenPill name={token} />
      ) : (
        <span className="sw" title={label} style={{ background: authored || shownComputedColour?.hex || 'transparent' }} />
      )}
      <TextInput
        label="Colour"
        declaration={declaration}
        field={colourText}
        onCommit={commitColour}
        placeholder={token ? 'Type to detach' : (shownComputedColour?.hex.toUpperCase() ?? '')}
      />
      <span className="alpha">
        <TextInput
          label="Alpha"
          declaration={declaration}
          field={alphaText}
          onCommit={commitAlpha}
          disabled={alpha === null}
          placeholder={shownComputedColour ? `${Math.round(shownComputedColour.alpha * 100)}%` : undefined}
        />
      </span>
      <TokenPicker declaration={declaration} />
    </FieldShell>
  )
}
