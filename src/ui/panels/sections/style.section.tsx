import { useEffect, useState } from 'react'
import type { PanelSection } from '../../plugin-api'
import { ColourField, FieldWarning, Icon, NumberField, TextField, useDeclaration, usePanelState } from '../fields'

const TEXT_BOX_TRIM = 'trim-both cap alphabetic'

/** Splits a comma list at the top level only, so `rgba(0, 0, 0, .1)` stays one entry. */
function splitTopLevel(list: string): string[] {
  const entries: string[] = []
  let depth = 0
  let start = 0
  for (let at = 0; at < list.length; at++) {
    const char = list[at]
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === ',' && depth === 0) {
      entries.push(list.slice(start, at))
      start = at + 1
    }
  }
  entries.push(list.slice(start))
  return entries.map((entry) => entry.trim()).filter(Boolean)
}

function AppearanceSection() {
  return (
    <div className="r r2">
      <NumberField prop="opacity" label="Opacity" icon="opacity" />
      <NumberField prop="border-radius" label="Radius" icon="radius" />
    </div>
  )
}

function FillSection() {
  return <ColourField prop="background-color" label="Fill" />
}

function StrokeSection() {
  return (
    <div className="rows">
      <ColourField prop="border-color" label="Stroke colour" />
      <NumberField prop="border-width" label="Stroke width" icon="stroke" />
    </div>
  )
}

function ShadowList() {
  const declaration = useDeclaration('box-shadow')
  const shadows = declaration.value ? splitTopLevel(declaration.value) : []

  function removeShadow(at: number) {
    const rest = shadows.filter((_, index) => index !== at)
    if (rest.length === 0) declaration.remove()
    else declaration.write(rest.join(', '))
  }

  return (
    <div className="field" data-prop="box-shadow">
      {declaration.mixed && <p className="note">Mixed</p>}
      <ul className="rows">
        {shadows.map((shadow, at) => (
          <li className="r shadow" data-shadow="" key={`${at}:${shadow}`}>
            <span className="f">
              <span className="l">
                <Icon name="shadow" />
              </span>
              <span className="v mono" title={shadow}>
                {shadow}
              </span>
            </span>
            <button type="button" className="ib" aria-label="Remove shadow" disabled={declaration.locked} onClick={() => removeShadow(at)}>
              <Icon name="minus" />
            </button>
          </li>
        ))}
      </ul>
      {declaration.warning && <FieldWarning message={declaration.warning} />}
    </div>
  )
}

function useTextBoxSupported(): boolean {
  const { ctx } = usePanelState()
  const [supported, setSupported] = useState(true)
  useEffect(() => {
    let current = true
    void ctx.read({ kind: 'supports', condition: `(text-box: ${TEXT_BOX_TRIM})` }).then((result) => {
      if (current) setSupported(result.supported)
    })
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
      <TextField prop="font-family" label="Font family" />
      <div className="r r2">
        <NumberField prop="font-size" label="Size" />
        <NumberField prop="font-weight" label="Weight" />
      </div>
      <div className="r r2">
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
  { id: 'effects', title: 'Effects', order: 50, appliesTo: always, component: ShadowList },
  { id: 'typography', title: 'Typography', order: 60, appliesTo: always, component: TypographySection },
]
