import { describe, expect, it } from 'vitest'
import { joinRadius, splitRadius } from '../../../src/ui/panels/radius'

function corners(topLeft: string | null, topRight: string | null, bottomRight: string | null, bottomLeft: string | null) {
  return {
    'border-top-left-radius': topLeft,
    'border-top-right-radius': topRight,
    'border-bottom-right-radius': bottomRight,
    'border-bottom-left-radius': bottomLeft,
  }
}

describe('splitting border-radius into its corners', () => {
  it.each([
    ['12px', corners('12px', '12px', '12px', '12px')],
    ['0.75rem', corners('0.75rem', '0.75rem', '0.75rem', '0.75rem')],
    ['50%', corners('50%', '50%', '50%', '50%')],
    ['4px 8px', corners('4px', '8px', '4px', '8px')],
    ['1px 2px 3px', corners('1px', '2px', '3px', '2px')],
    ['1px 2em 3% 4rem', corners('1px', '2em', '3%', '4rem')],
  ])('splits %s keeping each authored unit', (shorthand, expected) => {
    expect(splitRadius(shorthand)).toEqual(expected)
  })

  it('cannot split an elliptical radius', () => {
    expect(splitRadius('10px / 20px')).toBeNull()
  })

  it('cannot split more than four values', () => {
    expect(splitRadius('1px 2px 3px 4px 5px')).toBeNull()
  })
})

describe('joining the corners back into border-radius', () => {
  it('joins four matching corners into one value', () => {
    expect(joinRadius(corners('0.5rem', '0.5rem', '0.5rem', '0.5rem'))).toBe('0.5rem')
  })

  it.each([
    ['one corner differs', corners('8px', '8px', '8px', '4px')],
    ['the same length in another unit', corners('16px', '16px', '16px', '1rem')],
    ['a corner is not authored', corners('8px', '8px', null, '8px')],
  ])('does not join when %s', (_case, split) => {
    expect(joinRadius(split)).toBeNull()
  })

  it('joins a split value back to what was authored', () => {
    expect(joinRadius(splitRadius('6px')!)).toBe('6px')
  })
})
