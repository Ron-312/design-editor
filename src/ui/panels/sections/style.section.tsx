import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { EditOp } from '../../../shared/types'
import type { PanelSection } from '../../plugin-api'
import { ColourPicker } from '../colour-picker'
import { withAuthoredUnit } from '../css-values'
import { blurRadiusOf, withBlurRadius } from '../effects'
import { ColourField, FieldWarning, Icon, NumberField, TextField, useDeclaration, usePanelState, type Declaration, type IconName } from '../fields'
import { CORNERS, SIDE_WIDTHS, joinBox, splitBox, splitRadius, type BoxValues } from '../radius'
import { formatShadows, parseShadows, type ShadowLayer } from '../shadows'

const TEXT_BOX_TRIM = 'trim-both cap alphabetic'

const NEW_SHADOW: ShadowLayer = { inset: false, x: '0', y: '4px', blur: '12px', spread: null, colour: 'rgb(0 0 0 / 25%)' }

const STROKE_STYLES = ['solid', 'dashed', 'dotted', 'none'] as const

const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const

type DeclarationChange = readonly [prop: string, value: string | null]

/** Several declarations written as one action, each op sent without awaiting the last one's ack (plan contract #9). */
function useDeclarationChanges() {
  const { ctx, edIds, target } = usePanelState()
  const rule = target === 'inline' ? {} : { rule: target }
  return (changes: readonly DeclarationChange[]) => {
    const actionId = ctx.beginAction()
    for (const [prop, value] of changes) {
      const op: EditOp =
        value === null
          ? { target: edIds, kind: 'removeDecl', payload: { prop, ...rule } }
          : { target: edIds, kind: 'setDecl', payload: { prop, value, ...rule } }
      // The ws client already toasted the rejection and reloaded any preview.
      ctx.apply(op, actionId).catch(() => {})
    }
  }
}

type Longhands<P extends string> = readonly [P, P, P, P]

interface IndependentBox {
  readonly independent: boolean
  readonly locked: boolean
  readonly toggle: () => void
}

/**
 * A shorthand and its four longhands. Splitting writes each longhand with its authored value and unit;
 * joining writes the shorthand back only when all four match as written.
 */
function useIndependentBox<P extends string>(
  shorthand: string,
  longhands: Longhands<P>,
  split: (value: string) => BoxValues<P> | null,
): IndependentBox {
  const whole = useDeclaration(shorthand)
  const parts = [useDeclaration(longhands[0]), useDeclaration(longhands[1]), useDeclaration(longhands[2]), useDeclaration(longhands[3])]
  const writeChanges = useDeclarationChanges()
  const [opened, setOpened] = useState(false)
  const partsAuthored = parts.some((part) => part.value !== null)
  const locked = whole.locked || parts.some((part) => part.locked)

  function splitWhole() {
    if (whole.value === null) return setOpened(true)
    const values = split(whole.value)
    if (!values) return
    writeChanges([[shorthand, null], ...longhands.map((longhand): DeclarationChange => [longhand, values[longhand]])])
  }

  function joinParts() {
    setOpened(false)
    if (!partsAuthored) return
    const joined = joinBox(Object.fromEntries(longhands.map((longhand, at) => [longhand, parts[at]!.value])) as BoxValues<P>)
    if (joined === null) return
    writeChanges([...longhands.map((longhand): DeclarationChange => [longhand, null]), [shorthand, joined]])
  }

  const independent = partsAuthored || opened
  return { independent, locked, toggle: () => (independent ? joinParts() : splitWhole()) }
}

function IndependentToggle({ label, box }: { readonly label: string; readonly box: IndependentBox }) {
  return (
    <button type="button" className="ib" aria-label={label} title={label} aria-pressed={box.independent} disabled={box.locked} onClick={box.toggle}>
      <Icon name="frame" />
    </button>
  )
}

interface LonghandField {
  readonly prop: string
  readonly label: string
}

function LonghandFields({ fields, icon }: { readonly fields: readonly LonghandField[]; readonly icon: IconName }) {
  return (
    <div className="r r2 longhands">
      {fields.map(({ prop, label }) => (
        <NumberField key={prop} prop={prop} label={label} icon={icon} />
      ))}
    </div>
  )
}

/** Laid out two by two, top row first, so each corner sits where it rounds. */
const CORNER_FIELDS: readonly LonghandField[] = [
  { prop: 'border-top-left-radius', label: 'Top left radius' },
  { prop: 'border-top-right-radius', label: 'Top right radius' },
  { prop: 'border-bottom-left-radius', label: 'Bottom left radius' },
  { prop: 'border-bottom-right-radius', label: 'Bottom right radius' },
]

const SIDE_FIELDS: readonly LonghandField[] = [
  { prop: 'border-top-width', label: 'Top stroke width' },
  { prop: 'border-right-width', label: 'Right stroke width' },
  { prop: 'border-bottom-width', label: 'Bottom stroke width' },
  { prop: 'border-left-width', label: 'Left stroke width' },
]

function AppearanceSection() {
  const corners = useIndependentBox('border-radius', CORNERS, splitRadius)
  return (
    <div className="rows">
      <style>{SECTION_CSS}</style>
      <div className="r r2">
        <NumberField prop="opacity" label="Opacity" icon="opacity" />
        <div className="r linked">
          {corners.independent ? <span className="note">Corners</span> : <NumberField prop="border-radius" label="Radius" icon="radius" />}
          <IndependentToggle label="Independent corners" box={corners} />
        </div>
      </div>
      {corners.independent && <LonghandFields fields={CORNER_FIELDS} icon="radius" />}
    </div>
  )
}

function FillSection() {
  return <ColourField prop="background-color" label="Fill" />
}

interface KeywordSelectProps {
  readonly prop: string
  readonly label: string
  readonly shortLabel: string
  readonly keywords: readonly string[]
}

function KeywordSelect({ prop, label, shortLabel, keywords }: KeywordSelectProps) {
  const declaration = useDeclaration(prop)
  const authored = declaration.value ?? ''
  const unlisted = authored !== '' && !keywords.includes(authored)

  function pick(value: string) {
    if (value) declaration.write(value)
    else declaration.remove()
  }

  return (
    <div className="field keyword" data-prop={prop}>
      <div className={declaration.locked ? 'f dis' : 'f'}>
        <span className="l">{shortLabel}</span>
        <select className="v" aria-label={label} value={authored} disabled={declaration.locked} onChange={(event) => pick(event.target.value)}>
          <option value="">{declaration.mixed ? 'Mixed' : 'Default'}</option>
          {unlisted && <option value={authored}>{authored}</option>}
          {keywords.map((keyword) => (
            <option key={keyword} value={keyword}>
              {keyword}
            </option>
          ))}
        </select>
      </div>
      {declaration.warning && <FieldWarning message={declaration.warning} />}
    </div>
  )
}

function StrokeSection() {
  const sides = useIndependentBox('border-width', SIDE_WIDTHS, (value) => splitBox(value, SIDE_WIDTHS))
  return (
    <div className="rows">
      <div className="r stroke">
        <ColourField prop="border-color" label="Stroke colour" />
        <KeywordSelect prop="border-style" label="Stroke style" shortLabel="Style" keywords={STROKE_STYLES} />
      </div>
      <div className="r linked">
        {sides.independent ? <span className="note">Sides</span> : <NumberField prop="border-width" label="Stroke width" icon="stroke" />}
        <IndependentToggle label="Independent sides" box={sides} />
      </div>
      {sides.independent && <LonghandFields fields={SIDE_FIELDS} icon="stroke" />}
    </div>
  )
}

interface LengthInputProps {
  readonly label: string
  readonly value: string | null
  readonly locked: boolean
  readonly onCommit: (text: string) => void
}

/** A value typed here lasts until Enter or blur commits it, or Escape drops it. */
function LengthInput({ label, value, locked, onCommit }: LengthInputProps) {
  const [typed, setTyped] = useState<string | null>(null)

  function commit() {
    if (typed === null) return
    setTyped(null)
    onCommit(typed.trim())
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') commit()
    else if (event.key === 'Escape') setTyped(null)
  }

  return (
    <input
      className="v"
      aria-label={label}
      title={label}
      value={typed ?? value ?? ''}
      placeholder="0"
      readOnly={locked}
      spellCheck={false}
      onChange={(event: ChangeEvent<HTMLInputElement>) => setTyped(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  )
}

function LengthField({ shortLabel, ...input }: LengthInputProps & { readonly shortLabel: string }) {
  return (
    <span className={input.locked ? 'f dis' : 'f'}>
      <span className="l">{shortLabel}</span>
      <LengthInput {...input} />
    </span>
  )
}

/** A shadow layer's colour as a declaration of its own, so the colour picker writes and previews the whole list. */
function layerColour(list: Declaration, layers: readonly ShadowLayer[], at: number): Declaration {
  const withColour = (colour: string | null) => formatShadows(layers.map((layer, index) => (index === at ? { ...layer, colour } : layer)))
  return {
    value: layers[at]!.colour,
    mixed: false,
    locked: list.locked,
    warning: null,
    write: (colour, actionId) => list.write(withColour(colour), actionId),
    remove: () => list.write(withColour(null)),
    preview: (colour) => list.preview(colour === null ? list.value : withColour(colour)),
  }
}

type LayerLength = 'x' | 'y' | 'blur' | 'spread'

interface ShadowRowProps {
  readonly list: Declaration
  readonly layers: readonly ShadowLayer[]
  readonly at: number
  readonly onWrite: (layers: readonly ShadowLayer[]) => void
}

function ShadowRow({ list, layers, at, onWrite }: ShadowRowProps) {
  const { ctx } = usePanelState()
  const layer = layers[at]!

  function change(next: Partial<ShadowLayer>) {
    onWrite(layers.map((entry, index) => (index === at ? { ...entry, ...next } : entry)))
  }

  function commitLength(key: LayerLength, text: string) {
    const required = key === 'x' || key === 'y'
    if (!text && required) return
    change({ [key]: text ? withAuthoredUnit('box-shadow', text, layer[key]) : null })
  }

  function move(by: 1 | -1) {
    const next = [...layers]
    next.splice(at + by, 0, ...next.splice(at, 1))
    onWrite(next)
  }

  const lengthField = (key: LayerLength, label: string, shortLabel: string) => (
    <LengthField label={label} shortLabel={shortLabel} value={layer[key]} locked={list.locked} onCommit={(text) => commitLength(key, text)} />
  )

  return (
    <li className="rows shadow-layer" data-shadow="">
      <div className="r shadow-head">
        <span className="f">
          <ColourPicker ctx={ctx} label="Shadow colour" declaration={layerColour(list, layers, at)} fallback={null} />
          <span className="v mono" title={layer.colour ?? 'currentColor'}>
            {layer.colour ?? 'currentColor'}
          </span>
        </span>
        <label className="check">
          <button
            type="button"
            role="switch"
            className="switch"
            aria-label="Inset"
            aria-checked={layer.inset}
            disabled={list.locked}
            onClick={() => change({ inset: !layer.inset })}
          />
          Inset
        </label>
        <button type="button" className="ib up" aria-label="Move shadow up" disabled={list.locked || at === 0} onClick={() => move(-1)}>
          <Icon name="chev-d" />
        </button>
        <button type="button" className="ib" aria-label="Move shadow down" disabled={list.locked || at === layers.length - 1} onClick={() => move(1)}>
          <Icon name="chev-d" />
        </button>
        <button type="button" className="ib" aria-label="Remove shadow" disabled={list.locked} onClick={() => onWrite(layers.filter((_, index) => index !== at))}>
          <Icon name="minus" />
        </button>
      </div>
      <div className="r r2">
        {lengthField('x', 'X', 'X')}
        {lengthField('y', 'Y', 'Y')}
      </div>
      <div className="r r2">
        {lengthField('blur', 'Blur', 'Blur')}
        {lengthField('spread', 'Spread', 'Spread')}
      </div>
    </li>
  )
}

function UnreadableShadow({ list }: { readonly list: Declaration }) {
  return (
    <div className="r shadow" data-shadow="">
      <span className="f">
        <span className="l">
          <Icon name="shadow" />
        </span>
        <span className="v mono" title={list.value ?? ''}>
          {list.value}
        </span>
      </span>
      <button type="button" className="ib" aria-label="Remove shadow" disabled={list.locked} onClick={() => list.remove()}>
        <Icon name="minus" />
      </button>
    </div>
  )
}

function ShadowList() {
  const declaration = useDeclaration('box-shadow')
  const layers = declaration.value === null ? [] : parseShadows(declaration.value)

  function writeLayers(next: readonly ShadowLayer[]) {
    if (next.length === 0) declaration.remove()
    else declaration.write(formatShadows(next))
  }

  return (
    <div className="field" data-prop="box-shadow">
      <div className="r shadow-title">
        <span className="note">{declaration.mixed ? 'Shadows · Mixed' : 'Shadows'}</span>
        {layers && (
          <button type="button" className="ib" aria-label="Add shadow" title="Add shadow" disabled={declaration.locked} onClick={() => writeLayers([...layers, NEW_SHADOW])}>
            +
          </button>
        )}
      </div>
      {layers ? (
        <ul className="rows">
          {layers.map((layer, at) => (
            <ShadowRow key={`${at}:${formatShadows([layer])}`} list={declaration} layers={layers} at={at} onWrite={writeLayers} />
          ))}
        </ul>
      ) : (
        <UnreadableShadow list={declaration} />
      )}
      {declaration.warning && <FieldWarning message={declaration.warning} />}
    </div>
  )
}

function BlurField({ prop, label }: { readonly prop: string; readonly label: string }) {
  const declaration = useDeclaration(prop)
  const radius = blurRadiusOf(declaration.value)

  function commit(text: string) {
    if (!text && radius === null) return
    const next = withBlurRadius(declaration.value, text ? withAuthoredUnit(prop, text, radius) : null)
    if (next === null) declaration.remove()
    else declaration.write(next)
  }

  return (
    <div className="field" data-prop={prop}>
      <LengthField label={label} shortLabel={label} value={radius} locked={declaration.locked} onCommit={commit} />
      {declaration.warning && <FieldWarning message={declaration.warning} />}
    </div>
  )
}

function EffectsSection() {
  return (
    <div className="rows">
      <ShadowList />
      <div className="r r2">
        <BlurField prop="filter" label="Layer blur" />
        <BlurField prop="backdrop-filter" label="Background blur" />
      </div>
      <KeywordSelect prop="mix-blend-mode" label="Blend mode" shortLabel="Blend" keywords={BLEND_MODES} />
    </div>
  )
}

function useTextBoxSupported(): boolean {
  const { ctx } = usePanelState()
  const [supported, setSupported] = useState(true)
  useEffect(() => {
    let current = true
    ctx
      .read({ kind: 'supports', condition: `(text-box: ${TEXT_BOX_TRIM})` })
      .then((result) => {
        if (current) setSupported(result.supported)
      })
      // A reload rejects reads in flight; until one answers the toggle stays offered.
      .catch(() => {})
    return () => {
      current = false
    }
  }, [ctx])
  return supported
}

function TextBoxTrim() {
  const declaration = useDeclaration('text-box')
  const supported = useTextBoxSupported()
  const on = declaration.value === TEXT_BOX_TRIM

  return (
    <div className="field" data-prop="text-box">
      <label className="check">
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={on}
          disabled={declaration.locked}
          onClick={() => (on ? declaration.remove() : declaration.write(TEXT_BOX_TRIM))}
        />
        Trim text box
      </label>
      {!supported && <FieldWarning message="text-box trim is not supported in this browser" />}
    </div>
  )
}

function TypographySection() {
  return (
    <div className="rows">
      <div className="r family">
        <TextField prop="font-family" label="Font family" />
        <NumberField prop="font-weight" label="Weight" bare />
      </div>
      <div className="r r3">
        <NumberField prop="font-size" label="Size" icon="font-size" />
        <NumberField prop="line-height" label="Line height" icon="lh" />
        <NumberField prop="letter-spacing" label="Letter spacing" icon="ls" />
      </div>
      <TextBoxTrim />
    </div>
  )
}

const always = () => true

export const sections: PanelSection[] = [
  { id: 'appearance', title: 'Appearance', order: 20, appliesTo: always, component: AppearanceSection },
  { id: 'fill', title: 'Fill', order: 30, appliesTo: always, component: FillSection },
  { id: 'stroke', title: 'Stroke', order: 40, appliesTo: always, component: StrokeSection },
  { id: 'effects', title: 'Effects', order: 50, appliesTo: always, component: EffectsSection },
  { id: 'typography', title: 'Typography', order: 60, appliesTo: always, component: TypographySection },
]

const SECTION_CSS = `
.props .linked{grid-template-columns:minmax(0,1fr) 24px;gap:4px}
.props .longhands .field[data-prop="border-top-right-radius"] .l svg{transform:rotate(90deg)}
.props .longhands .field[data-prop="border-bottom-right-radius"] .l svg{transform:rotate(180deg)}
.props .longhands .field[data-prop="border-bottom-left-radius"] .l svg{transform:rotate(270deg)}
.props .keyword select.v{background:none;border:0;outline:none;color:inherit;font:inherit;padding:0;appearance:none}
.props .shadow-title{grid-template-columns:minmax(0,1fr) 24px;margin-bottom:4px}
.props .shadow-head{grid-template-columns:minmax(0,1fr) auto 24px 24px 24px;gap:4px}
.props .shadow-layer{padding-bottom:8px;border-bottom:1px solid var(--line)}
.props .shadow-layer:last-child{border-bottom:0;padding-bottom:0}
.props .ib.up svg.i{transform:rotate(180deg)}
`
