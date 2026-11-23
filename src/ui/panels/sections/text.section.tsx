import { useState, type KeyboardEvent, type ReactNode } from 'react'
import type { EdId, EditOp } from '../../../shared/types'
import type { PanelSection } from '../../plugin-api'
import type { LayoutWrite } from '../auto-layout'
import { FieldWarning, useComputedValue, useDeclaration, usePanelState, type PanelState } from '../fields'
import { lineClampRemovals, lineClampWarning, lineClampWrites, resizingModeOf, resizingWrites, type ResizingMode } from '../text-layout'

type Choice = readonly [value: string, label: string, glyph: ReactNode]

const ALIGN_LINES: Readonly<Record<string, string>> = {
  left: 'M2.5 4h11M2.5 8h7M2.5 12h9',
  center: 'M2.5 4h11M4.5 8h7M3.5 12h9',
  right: 'M2.5 4h11M6.5 8h7M4.5 12h9',
  justify: 'M2.5 4h11M2.5 8h11M2.5 12h11',
}

function AlignGlyph({ align }: { readonly align: string }) {
  return (
    <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
      <path d={ALIGN_LINES[align]} />
    </svg>
  )
}

const ALIGNMENTS: readonly Choice[] = [
  ['left', 'Align left', <AlignGlyph align="left" />],
  ['center', 'Align centre', <AlignGlyph align="center" />],
  ['right', 'Align right', <AlignGlyph align="right" />],
  ['justify', 'Justify', <AlignGlyph align="justify" />],
]
const CASES: readonly Choice[] = [
  ['uppercase', 'Uppercase', 'AA'],
  ['lowercase', 'Lowercase', 'aa'],
  ['capitalize', 'Capitalize', 'Aa'],
]
const DECORATIONS: readonly Choice[] = [
  ['underline', 'Underline', <u>U</u>],
  ['line-through', 'Strikethrough', <s>S</s>],
]
const ITALIC: readonly Choice[] = [['italic', 'Italic', <i>I</i>]]
const WRAP_STYLES: readonly Choice[] = [
  ['balance', 'Balance', 'Balance'],
  ['pretty', 'Pretty', 'Pretty'],
]
const RESIZING_MODES: readonly (readonly [ResizingMode, string])[] = [
  ['auto-width', 'Auto width'],
  ['auto-height', 'Auto height'],
  ['fixed', 'Fixed'],
]
const POSITIVE_INTEGER = /^[1-9]\d*$/

function authoredValue(state: PanelState, edId: EdId, prop: string): string | null {
  const source = state.styles[edId]?.find((entry) => entry.target === state.target)
  return source?.declarations.findLast((entry) => entry.prop === prop)?.value ?? null
}

function opFor(state: PanelState, edId: EdId, { prop, value }: LayoutWrite): EditOp {
  const rule = state.target === 'inline' ? {} : { rule: state.target }
  return value === null
    ? { target: [edId], kind: 'removeDecl', payload: { prop, ...rule } }
    : { target: [edId], kind: 'setDecl', payload: { prop, value, ...rule } }
}

/** Every write of every target under one action id, so the whole change is one undo entry. */
function applyAsOneAction(state: PanelState, perTarget: ReadonlyArray<readonly [EdId, readonly LayoutWrite[]]>) {
  const actionId = state.ctx.beginAction()
  for (const [edId, writes] of perTarget) {
    // The ws client already toasted a rejection and reloaded any preview.
    for (const write of writes) state.ctx.apply(opFor(state, edId, write), actionId).catch(() => {})
  }
}

/** Radios pick one value of `prop`; toggles also clear it when the chosen one is pressed again. */
function ChoiceGroup({ prop, label, choices, toggles }: { readonly prop: string; readonly label: string; readonly choices: readonly Choice[]; readonly toggles?: boolean }) {
  const declaration = useDeclaration(prop)
  const computed = useComputedValue(prop)
  const current = declaration.value ?? computed

  function press(value: string) {
    if (toggles && value === declaration.value) declaration.remove()
    else declaration.write(value)
  }

  return (
    <div className="field" data-prop={prop}>
      <div className="seg" role={toggles ? 'group' : 'radiogroup'} aria-label={label}>
        {choices.map(([value, name, glyph]) => {
          const on = value === current
          const checked = toggles ? { 'aria-pressed': on } : { role: 'radio', 'aria-checked': on }
          return (
            <button
              type="button"
              key={value}
              className={on ? 'on' : undefined}
              aria-label={name}
              title={name}
              disabled={declaration.locked}
              onClick={() => press(value)}
              {...checked}
            >
              {glyph}
            </button>
          )
        })}
      </div>
      {declaration.warning && <FieldWarning message={declaration.warning} />}
    </div>
  )
}

function ResizingControl() {
  const state = usePanelState()
  const mode = resizingModeOf((prop) => authoredValue(state, state.edIds[0]!, prop))

  async function pick(next: ResizingMode) {
    const perTarget = await Promise.all(
      state.edIds.map(async (edId) => {
        const [rect] = (await state.ctx.read({ kind: 'rects', edId })).rects
        const measured = { width: rect?.width ?? 0, height: rect?.height ?? 0 }
        return [edId, resizingWrites(next, (prop) => authoredValue(state, edId, prop), measured)] as const
      }),
    )
    applyAsOneAction(state, perTarget)
  }

  return (
    <div className="seg" role="radiogroup" aria-label="Resizing">
      {RESIZING_MODES.map(([value, name]) => (
        <button
          type="button"
          role="radio"
          key={value}
          className={mode === value ? 'on' : undefined}
          aria-checked={mode === value}
          disabled={!state.editable}
          onClick={() => void pick(value).catch(() => {})}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

async function warnIfLayoutReplaced(state: PanelState): Promise<void> {
  const reads = await Promise.all(state.edIds.map((edId) => state.ctx.read({ kind: 'computed', edId, props: ['display'] })))
  const warning = reads.map((read) => lineClampWarning(read.values['display'] ?? '')).find(Boolean)
  if (warning) state.ctx.toast({ message: warning, tone: 'warning' })
}

function MaxLinesField() {
  const state = usePanelState()
  const declaration = useDeclaration('-webkit-line-clamp')
  const [typed, setTyped] = useState<string | null>(null)

  async function writeBlock(lines: number) {
    await warnIfLayoutReplaced(state)
    applyAsOneAction(
      state,
      state.edIds.map((edId) => [edId, lineClampWrites(lines)]),
    )
  }

  function removeBlock() {
    applyAsOneAction(
      state,
      state.edIds.map((edId) => [edId, lineClampRemovals((prop) => authoredValue(state, edId, prop))]),
    )
  }

  function commit() {
    if (typed === null) return
    setTyped(null)
    const text = typed.trim()
    if (text === '') return removeBlock()
    if (POSITIVE_INTEGER.test(text)) void writeBlock(Number(text)).catch(() => {})
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') setTyped(null)
  }

  return (
    <div className="field" data-prop="-webkit-line-clamp">
      <div className={declaration.locked ? 'f dis' : 'f'}>
        <span className="l">Max lines</span>
        <input
          className="v"
          aria-label="Max lines"
          inputMode="numeric"
          value={typed ?? declaration.value ?? ''}
          placeholder={declaration.mixed ? 'Mixed' : 'None'}
          readOnly={declaration.locked}
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      </div>
    </div>
  )
}

function TextSection() {
  const { edIds } = usePanelState()
  return (
    <div className="rows text-controls">
      <style>{SECTION_CSS}</style>
      <ChoiceGroup prop="text-align" label="Alignment" choices={ALIGNMENTS} />
      <div className="r r3">
        <ChoiceGroup prop="text-transform" label="Case" choices={CASES} toggles />
        <ChoiceGroup prop="text-decoration-line" label="Decoration" choices={DECORATIONS} toggles />
        <ChoiceGroup prop="font-style" label="Italic" choices={ITALIC} toggles />
      </div>
      <ResizingControl />
      <div className="r r2">
        <MaxLinesField key={edIds.join(' ')} />
        <ChoiceGroup prop="text-wrap-style" label="Wrap style" choices={WRAP_STYLES} toggles />
      </div>
    </div>
  )
}

export const sections: PanelSection[] = [{ id: 'text', title: 'Text', order: 65, appliesTo: () => true, component: TextSection }]

const SECTION_CSS = `
.props .text-controls .seg{display:flex;background:var(--field);border-radius:var(--r-sm);padding:2px;height:28px;gap:0}
.props .text-controls .seg button{height:24px;flex:1;display:flex;align-items:center;justify-content:center;padding:0 4px;border-radius:var(--r-xs);font-size:11px;font-weight:500;color:var(--text-3)}
.props .text-controls .seg button.on{background:var(--seg-on);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.18)}
.props .text-controls .f .l{min-width:auto}
`
