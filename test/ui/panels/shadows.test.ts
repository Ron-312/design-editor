import { describe, expect, it } from 'vitest'
import { formatShadows, parseShadows, type ShadowLayer } from '../../../src/ui/panels/shadows'

function layer(fields: Partial<ShadowLayer> & Pick<ShadowLayer, 'x' | 'y'>): ShadowLayer {
  return { inset: false, blur: null, spread: null, colour: null, ...fields }
}

describe('parsing a box-shadow list', () => {
  it('reads every length and the colour of one layer', () => {
    expect(parseShadows('0 4px 12px 2px #000')).toEqual([layer({ x: '0', y: '4px', blur: '12px', spread: '2px', colour: '#000' })])
  })

  it('leaves the blur and spread unset where they are not authored', () => {
    expect(parseShadows('2px 3px red')).toEqual([layer({ x: '2px', y: '3px', colour: 'red' })])
  })

  it('leaves the colour unset where none is authored', () => {
    expect(parseShadows('2px 2px 4px')).toEqual([layer({ x: '2px', y: '2px', blur: '4px' })])
  })

  it('splits layers only at top-level commas, so a legacy rgba() stays one colour', () => {
    expect(parseShadows('0 4px 12px rgba(0, 0, 0, 0.04), inset 0 0 0 1px #e6ddcf')).toEqual([
      layer({ x: '0', y: '4px', blur: '12px', colour: 'rgba(0, 0, 0, 0.04)' }),
      layer({ inset: true, x: '0', y: '0', blur: '0', spread: '1px', colour: '#e6ddcf' }),
    ])
  })

  it('keeps a nested colour function with commas inside it as one colour', () => {
    expect(parseShadows('0 1px 2px color-mix(in srgb, rgb(0, 0, 0) 40%, transparent), 0 0 1px #111')).toEqual([
      layer({ x: '0', y: '1px', blur: '2px', colour: 'color-mix(in srgb, rgb(0, 0, 0) 40%, transparent)' }),
      layer({ x: '0', y: '0', blur: '1px', colour: '#111' }),
    ])
  })

  it.each(['hsl(210 50% 40% / .5)', 'oklch(0.7 0.15 30 / 50%)', 'rgb(0 0 0 / 20%)', 'var(--shadow-colour)'])(
    'reads %s as the colour, spaces and slash included',
    (colour) => {
      expect(parseShadows(`0 2px 6px ${colour}`)).toEqual([layer({ x: '0', y: '2px', blur: '6px', colour })])
    },
  )

  it('reads a colour written before the lengths', () => {
    expect(parseShadows('rgb(0 0 0 / 20%) 0 1px 2px')).toEqual([layer({ x: '0', y: '1px', blur: '2px', colour: 'rgb(0 0 0 / 20%)' })])
  })

  it('reads inset written after the lengths', () => {
    expect(parseShadows('0 0 4px #000 inset')).toEqual([layer({ inset: true, x: '0', y: '0', blur: '4px', colour: '#000' })])
  })

  it('keeps negative and fractional lengths in their authored units', () => {
    expect(parseShadows('-2px -.5rem 1.5em 0 #000')).toEqual([layer({ x: '-2px', y: '-.5rem', blur: '1.5em', spread: '0', colour: '#000' })])
  })

  it('trims line breaks between layers', () => {
    expect(parseShadows('0 1px 2px #000,\n    0 2px 4px #111')).toEqual([
      layer({ x: '0', y: '1px', blur: '2px', colour: '#000' }),
      layer({ x: '0', y: '2px', blur: '4px', colour: '#111' }),
    ])
  })

  it('reads none as an empty list', () => {
    expect(parseShadows('none')).toEqual([])
  })

  it.each([
    ['a lone token', 'var(--elevation)'],
    ['a lone colour', '#000'],
    ['five lengths', '0 4px 12px 3px 5px #000'],
    ['two colours', 'red blue 1px 1px'],
    ['one readable layer beside an unreadable one', '0 1px 2px #000, var(--elevation)'],
  ])('cannot read %s', (_case, value) => {
    expect(parseShadows(value)).toBeNull()
  })
})

describe('writing a box-shadow list', () => {
  it('writes inset first, then the lengths, then the colour, layers joined by a comma and a space', () => {
    expect(
      formatShadows([
        layer({ inset: true, x: '1px', y: '2px', blur: '3px', spread: '4px', colour: 'rgb(0 0 0 / 20%)' }),
        layer({ x: '0', y: '1px', colour: '#000' }),
      ]),
    ).toBe('inset 1px 2px 3px 4px rgb(0 0 0 / 20%), 0 1px #000')
  })

  it('writes a zero blur when only the spread is set', () => {
    expect(formatShadows([layer({ x: '0', y: '0', spread: '2px', colour: '#000' })])).toBe('0 0 0 2px #000')
  })

  it('writes no colour where none is set', () => {
    expect(formatShadows([layer({ x: '2px', y: '2px', blur: '4px' })])).toBe('2px 2px 4px')
  })

  it('writes none for an empty list', () => {
    expect(formatShadows([])).toBe('none')
  })

  it.each([
    '0 4px 12px rgba(0, 0, 0, 0.04), inset 0 0 0 1px #e6ddcf',
    '2px 2px 0 0 #000',
    '0 1px 2px color-mix(in srgb, rgb(0, 0, 0) 40%, transparent)',
    'inset 0 .25rem .5rem -1px oklch(0.7 0.15 30 / 50%)',
  ])('writes %s back byte for byte', (authored) => {
    expect(formatShadows(parseShadows(authored)!)).toBe(authored)
  })
})
