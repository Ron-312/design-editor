import { describe, expect, it } from 'vitest'
import { blurRadiusOf, withBlurRadius } from '../../../src/ui/panels/effects'

describe('reading the blur of a filter list', () => {
  it.each([
    ['blur(4px)', '4px'],
    ['saturate(1.2) blur(0.5rem)', '0.5rem'],
    ['drop-shadow(0 0 2px rgba(0, 0, 0, 0.5)) blur(1px) contrast(110%)', '1px'],
  ])('reads %s as %s', (filter, radius) => {
    expect(blurRadiusOf(filter)).toBe(radius)
  })

  it.each([['none'], ['saturate(1.2)'], ['drop-shadow(0 0 2px #000)']])('reads no blur in %s', (filter) => {
    expect(blurRadiusOf(filter)).toBeNull()
  })

  it('reads no blur where no filter is authored', () => {
    expect(blurRadiusOf(null)).toBeNull()
  })
})

describe('writing the blur into a filter list', () => {
  it('writes a lone blur where no filter is authored', () => {
    expect(withBlurRadius(null, '4px')).toBe('blur(4px)')
  })

  it('replaces none with the blur', () => {
    expect(withBlurRadius('none', '4px')).toBe('blur(4px)')
  })

  it('changes the blur in place and keeps the functions around it as they are', () => {
    expect(withBlurRadius('saturate(1.2) blur(2px) contrast(110%)', '6px')).toBe('saturate(1.2) blur(6px) contrast(110%)')
  })

  it('appends a blur after the authored functions', () => {
    expect(withBlurRadius('saturate(1.2) hue-rotate(30deg)', '2px')).toBe('saturate(1.2) hue-rotate(30deg) blur(2px)')
  })

  it('keeps a drop-shadow() with commas and nested parentheses whole', () => {
    expect(withBlurRadius('drop-shadow(0 0 2px rgba(0, 0, 0, 0.5)) blur(1px)', '3px')).toBe('drop-shadow(0 0 2px rgba(0, 0, 0, 0.5)) blur(3px)')
  })

  it('takes the blur out and keeps the other functions', () => {
    expect(withBlurRadius('saturate(1.2) blur(2px) url(#grain)', null)).toBe('saturate(1.2) url(#grain)')
  })

  it('leaves nothing to write when the blur was the only function', () => {
    expect(withBlurRadius('blur(2px)', null)).toBeNull()
  })
})
