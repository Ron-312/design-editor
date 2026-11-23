import { describe, expect, it } from 'vitest'
import { toAuthoredUnit, type UnitBasis } from '../../../src/ui/canvas/units'

/** Root 12 px and element 20 px, so a rem and an em of the same px differ. */
const basis: UnitBasis = { rootFontSize: 12, fontSize: 20, containingSize: 800 }

describe('writing a px size in the authored unit', () => {
  it('keeps px in px', () => {
    expect(toAuthoredUnit(245, '200px', basis)).toBe('245px')
  })

  it('writes px when the property is not authored', () => {
    expect(toAuthoredUnit(245, null, basis)).toBe('245px')
  })

  it('rounds px to whole px, as v1 did', () => {
    expect(toAuthoredUnit(245.6, '200px', basis)).toBe('246px')
  })

  it('converts rem with the root font size, not the element font size', () => {
    expect(toAuthoredUnit(240, '20rem', basis)).toBe('20rem')
    expect(toAuthoredUnit(246, '20rem', basis)).toBe('20.5rem')
  })

  it('converts em with the element font size', () => {
    expect(toAuthoredUnit(215, '10em', basis)).toBe('10.75em')
  })

  it('converts % with the containing block size', () => {
    expect(toAuthoredUnit(210, '25%', basis)).toBe('26.25%')
    expect(toAuthoredUnit(210, '25%', { ...basis, containingSize: 400 })).toBe('52.5%')
  })

  it('rounds a converted value to 2 decimals', () => {
    expect(toAuthoredUnit(205, '20rem', basis)).toBe('17.08rem')
    expect(toAuthoredUnit(107, '5em', basis)).toBe('5.35em')
    expect(toAuthoredUnit(100, '50%', { ...basis, containingSize: 300 })).toBe('33.33%')
  })

  it('keeps the unit of a decimal authored value', () => {
    expect(toAuthoredUnit(120, '12.5rem', basis)).toBe('10rem')
  })
})

describe('a unit it cannot convert', () => {
  it.each(['calc(100% - 40px)', '20vw', '30vh'])('gives no value for %s, so the caller falls back to px', (authored) => {
    expect(toAuthoredUnit(245, authored, basis)).toBeNull()
  })
})
