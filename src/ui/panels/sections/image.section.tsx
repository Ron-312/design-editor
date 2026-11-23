import { findNode } from '../../canvas/selection'
import type { EditorContext, PanelSection, Selection } from '../../plugin-api'
import { FieldWarning, TextField, useDeclaration } from '../fields'

const OBJECT_FITS = ['fill', 'contain', 'cover', 'none', 'scale-down'] as const

function FitField() {
  const declaration = useDeclaration('object-fit')

  function pick(value: string) {
    if (value) declaration.write(value)
    else declaration.remove()
  }

  return (
    <div className="field" data-prop="object-fit">
      <div className={declaration.locked ? 'f dis' : 'f'}>
        <span className="l">Fit</span>
        <select className="v" aria-label="Fit" value={declaration.value ?? ''} disabled={declaration.locked} onChange={(event) => pick(event.target.value)}>
          <option value="">{declaration.mixed ? 'Mixed' : 'Default'}</option>
          {OBJECT_FITS.map((fit) => (
            <option key={fit} value={fit}>
              {fit}
            </option>
          ))}
        </select>
      </div>
      {declaration.warning && <FieldWarning message={declaration.warning} />}
    </div>
  )
}

function ImageSection() {
  return (
    <div className="r r2 image-fit">
      <style>{SECTION_CSS}</style>
      <FitField />
      <TextField prop="object-position" label="Position" />
    </div>
  )
}

function allImages(ctx: EditorContext, selection: Selection): boolean {
  const tree = ctx.index()?.tree
  return tree !== undefined && selection.edIds.every((edId) => findNode(tree, edId)?.tag === 'img')
}

export const sections: PanelSection[] = [{ id: 'image', title: 'Image', order: 70, appliesTo: allImages, component: ImageSection }]

const SECTION_CSS = `
.props .image-fit select.v{background:none;border:0;outline:none;color:inherit;font:inherit;padding:0;appearance:none}
`
