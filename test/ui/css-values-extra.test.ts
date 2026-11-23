import { describe, expect, it } from 'vitest'
import { colorAlpha, inAuthoredColorFormat, withColorAlpha } from '../../src/ui/panels/css-values'

describe('short hex colours', () => {
  it('reads #rgb as opaque and #rgba with its doubled alpha digit', () => {
    expect(colorAlpha('#f80')).toBe(1)
    expect(colorAlpha('#f808')).toBeCloseTo(0x88 / 255, 5)
    expect(colorAlpha('#F80')).toBe(1)
  })

  it('expands each digit when it writes a new alpha', () => {
    expect(withColorAlpha('#f80', 0.5)).toBe('#ff880080')
    expect(withColorAlpha('#f808', 1)).toBe('#ff8800')
  })

  it('expands a short picked hex and keeps the authored alpha', () => {
    expect(inAuthoredColorFormat('#abc', '#123')).toBe('#112233')
    expect(inAuthoredColorFormat('#1a73e880', '#f00')).toBe('#ff000080')
    expect(inAuthoredColorFormat('hsl(210 50% 40%)', '#0f0')).toBe('hsl(120 100% 50%)')
  })

  it('does not read hex of the wrong length', () => {
    expect(colorAlpha('#12345')).toBeNull()
    expect(withColorAlpha('#ab', 0.5)).toBeNull()
  })
})

describe('legacy comma colour functions', () => {
  it.each([
    ['rgb(10, 20, 30)', 1],
    ['rgba(10, 20, 30, 0.4)', 0.4],
    ['hsla(210, 50%, 40%, 25%)', 0.25],
    ['rgba( 10 ,20 , 30 , .5 )', 0.5],
  ])('reads the alpha of %s as %d', (value, alpha) => {
    expect(colorAlpha(value)).toBeCloseTo(alpha, 5)
  })

  it.each([
    ['rgb(10, 20, 30)', 0.5, 'rgb(10, 20, 30, 0.5)'],
    ['rgba(10, 20, 30, 0.4)', 0.75, 'rgba(10, 20, 30, 0.75)'],
    ['rgba(10, 20, 30, 0.4)', 1, 'rgba(10, 20, 30)'],
    ['hsla(210, 50%, 40%, 25%)', 0.5, 'hsla(210, 50%, 40%, 0.5)'],
  ])('keeps the commas when it sets the alpha of %s to %d: %s', (authored, alpha, written) => {
    expect(withColorAlpha(authored, alpha)).toBe(written)
  })
})
