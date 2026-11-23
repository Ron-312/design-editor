import { describe, expect, it } from 'vitest'
import { formatColour, gamutMapped, isOutsideSrgb, notationOf, toHsva } from '../../../src/ui/panels/colour'

/** The function name and its numbers, `%` dropped: `hsl(210 50% 40%)` gives `['hsl', [210, 50, 40]]`. */
function channelsOf(value: string): [string, number[]] {
  const match = value.trim().match(/^([a-z]+)\((.*)\)$/i)
  if (!match) throw new Error(`${value} is not a colour function`)
  const numbers = match[2]!
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((part) => Number(part.replace(/%$/, '')))
  return [match[1]!, numbers]
}

function expectChannelsClose(actual: string, expected: string, digits: number) {
  const [actualName, actualNumbers] = channelsOf(actual)
  const [expectedName, expectedNumbers] = channelsOf(expected)
  expect(actualName).toBe(expectedName)
  expect(actualNumbers).toHaveLength(expectedNumbers.length)
  actualNumbers.forEach((number, at) => expect(number).toBeCloseTo(expectedNumbers[at]!, digits))
}

function roundTrip(value: string): string {
  const hsva = toHsva(value)
  const notation = notationOf(value)
  if (!hsva || !notation) throw new Error(`${value} is not a colour the picker reads`)
  return formatColour(hsva, notation)
}

describe('the authored notation', () => {
  it.each([
    ['#1a73e8', 'hex'],
    ['#abc', 'hex'],
    ['#1a73e880', 'hex'],
    ['rgb(26 115 232)', 'rgb'],
    ['rgba(26, 115, 232, 0.5)', 'rgb'],
    ['hsl(210 50% 40%)', 'hsl'],
    ['hsla(210, 50%, 40%, 0.5)', 'hsl'],
    ['oklch(0.7 0.15 30)', 'oklch'],
  ])('reads %s as %s', (value, notation) => {
    expect(notationOf(value)).toBe(notation)
  })

  it('reads a var() reference as no colour', () => {
    expect(notationOf('var(--brand)')).toBeNull()
    expect(toHsva('var(--brand)')).toBeNull()
  })
})

describe('the square works in sRGB hue, saturation and value', () => {
  it('reads pure red as hue 0, full saturation and value, opaque', () => {
    const hsva = toHsva('#ff0000')!
    expect(hsva.h).toBeCloseTo(0, 5)
    expect(hsva.s).toBeCloseTo(1, 5)
    expect(hsva.v).toBeCloseTo(1, 5)
    expect(hsva.a).toBe(1)
  })

  it('reads an authored blue in any notation as the same point', () => {
    for (const value of ['#1a73e8', 'rgb(26 115 232)']) {
      const hsva = toHsva(value)!
      expect(hsva.h).toBeCloseTo(214.08, 1)
      expect(hsva.s).toBeCloseTo(0.888, 2)
      expect(hsva.v).toBeCloseTo(0.9098, 3)
      expect(hsva.a).toBe(1)
    }
  })

  it('reads the authored alpha', () => {
    expect(toHsva('rgb(26 115 232 / 0.5)')!.a).toBeCloseTo(0.5, 5)
    expect(toHsva('#1a73e880')!.a).toBeCloseTo(128 / 255, 5)
  })
})

describe('a colour round-trips in its authored notation', () => {
  it.each(['#1a73e8', '#000000', '#ffffff', '#1a73e880'])('hex %s', (value) => {
    expect(roundTrip(value)).toBe(value)
  })

  it.each(['rgb(26 115 232)', 'rgb(26 115 232 / 0.5)', 'rgb(0 0 0)'])('rgb %s', (value) => {
    expect(roundTrip(value)).toBe(value)
  })

  it.each(['hsl(210 50% 40%)', 'hsl(0 100% 50%)', 'hsl(120 30% 70% / 0.25)'])('hsl %s', (value) => {
    expectChannelsClose(roundTrip(value), value, 1)
  })

  it.each(['oklch(0.7 0.15 30)', 'oklch(0.5 0.1 250)', 'oklch(0.7 0.1 150 / 0.5)'])('oklch %s', (value) => {
    expectChannelsClose(roundTrip(value), value, 3)
  })
})

describe('a picked point written in each notation', () => {
  const red = { h: 0, s: 1, v: 1, a: 1 }

  it('writes hex', () => {
    expect(formatColour(red, 'hex')).toBe('#ff0000')
  })

  it('writes rgb', () => {
    expect(formatColour(red, 'rgb')).toBe('rgb(255 0 0)')
  })

  it('writes hsl', () => {
    expectChannelsClose(formatColour(red, 'hsl'), 'hsl(0 100% 50%)', 1)
  })

  it('writes oklch', () => {
    expectChannelsClose(formatColour(red, 'oklch'), 'oklch(0.628 0.258 29.2)', 1)
  })

  it('writes a translucent pick with its alpha', () => {
    expect(formatColour({ ...red, a: 0.5 }, 'hex')).toBe('#ff000080')
    expect(formatColour({ ...red, a: 0.5 }, 'rgb')).toBe('rgb(255 0 0 / 0.5)')
  })
})

describe('oklch outside sRGB', () => {
  it('knows an oklch value outside sRGB', () => {
    expect(isOutsideSrgb('oklch(0.7 0.3 150)')).toBe(true)
  })

  it.each(['oklch(0.7 0.1 150)', 'oklch(0.7 0.15 30)', '#1a73e8', 'rgb(0 0 0)'])('knows %s is inside sRGB', (value) => {
    expect(isOutsideSrgb(value)).toBe(false)
  })

  it('maps it into sRGB in oklch by reducing chroma, keeping lightness and hue', () => {
    const mapped = gamutMapped('oklch(0.7 0.3 150)')
    const [name, [lightness, chroma, hue]] = channelsOf(mapped)

    expect(name).toBe('oklch')
    expect(lightness).toBeCloseTo(0.7, 1)
    expect(Math.abs(hue! - 150)).toBeLessThan(3)
    expect(chroma).toBeGreaterThan(0.15)
    expect(chroma).toBeLessThan(0.2)
  })

  it('places an out-of-gamut value on the square inside its bounds', () => {
    const hsva = toHsva('oklch(0.7 0.3 150)')!

    for (const channel of [hsva.s, hsva.v]) {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(1)
    }
    expect(hsva.h).toBeGreaterThan(90)
    expect(hsva.h).toBeLessThan(180)
  })
})
