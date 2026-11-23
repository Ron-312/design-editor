import { describe, expect, it } from 'vitest'
import {
  colorAlpha,
  inAuthoredColorFormat,
  isUnitless,
  stepNumber,
  withAuthoredUnit,
  withColorAlpha,
} from '../../../src/ui/panels/css-values'

describe('unitless properties', () => {
  it.each(['line-height', 'opacity', 'z-index', 'flex-grow', 'font-weight'])('treats %s as unitless', (prop) => {
    expect(isUnitless(prop)).toBe(true)
  })

  it.each(['width', 'font-size', 'border-radius', 'letter-spacing', 'border-width'])('gives %s a unit', (prop) => {
    expect(isUnitless(prop)).toBe(false)
  })
})

describe('a typed number keeps the authored unit', () => {
  it.each([
    ['width', '24', '12rem', '24rem'],
    ['border-radius', '16', '12px', '16px'],
    ['letter-spacing', '-0.5', '0.02em', '-0.5em'],
    ['font-size', '20', '1.25rem', '20rem'],
  ])('%s: typing %s over %s writes %s', (prop, typed, authored, written) => {
    expect(withAuthoredUnit(prop, typed, authored)).toBe(written)
  })

  it('adds px to a bare number when nothing was authored', () => {
    expect(withAuthoredUnit('border-radius', '16', null)).toBe('16px')
  })

  it('takes a unit the user typed over the authored one', () => {
    expect(withAuthoredUnit('font-size', '24px', '1rem')).toBe('24px')
    expect(withAuthoredUnit('width', '50%', '200px')).toBe('50%')
  })

  it('writes a keyword as typed', () => {
    expect(withAuthoredUnit('width', 'auto', '200px')).toBe('auto')
  })

  it.each([
    ['line-height', '2', '1.5'],
    ['line-height', '2', null],
    ['opacity', '0.5', null],
    ['z-index', '3', null],
    ['flex-grow', '1', null],
    ['font-weight', '600', '400'],
  ])('adds no px to %s: typing %s writes it as typed', (prop, typed, authored) => {
    expect(withAuthoredUnit(prop, typed, authored)).toBe(typed)
  })
})

describe('arrow steps', () => {
  it.each([
    ['12px', 1, '13px'],
    ['12px', 10, '22px'],
    ['2rem', -1, '1rem'],
    ['-4px', 10, '6px'],
    ['0.25em', 1, '1.25em'],
    ['1.5', 1, '2.5'],
    ['1.5', -1, '0.5'],
    ['50%', -10, '40%'],
  ])('%s stepped by %d is %s', (value, delta, stepped) => {
    expect(stepNumber(value, delta)).toBe(stepped)
  })

  it('does not step a value that is not a single number', () => {
    expect(stepNumber('auto', 1)).toBeNull()
    expect(stepNumber('calc(100% - 8px)', 1)).toBeNull()
    expect(stepNumber('var(--space-md)', 1)).toBeNull()
  })
})

describe('colour alpha', () => {
  it('reads the alpha of every authored format, and none from a var()', () => {
    expect(colorAlpha('#1a73e8')).toBe(1)
    expect(colorAlpha('#1a73e880')).toBeCloseTo(0.5, 2)
    expect(colorAlpha('hsl(210 50% 40% / 0.5)')).toBe(0.5)
    expect(colorAlpha('oklch(0.7 0.15 30 / 40%)')).toBeCloseTo(0.4, 5)
    expect(colorAlpha('color(display-p3 1 0 0)')).toBe(1)
    expect(colorAlpha('var(--brand)')).toBeNull()
  })

  it.each([
    ['#1a73e8', 0.5, '#1a73e880'],
    ['#1a73e880', 1, '#1a73e8'],
    ['hsl(210 50% 40%)', 0.5, 'hsl(210 50% 40% / 0.5)'],
    ['rgb(10 20 30 / 0.2)', 0.75, 'rgb(10 20 30 / 0.75)'],
    ['oklch(0.7 0.15 30)', 0.5, 'oklch(0.7 0.15 30 / 0.5)'],
    ['color(display-p3 1 0.2 0)', 0.25, 'color(display-p3 1 0.2 0 / 0.25)'],
  ])('sets the alpha of %s to %d in the same format: %s', (authored, alpha, written) => {
    expect(withColorAlpha(authored, alpha)).toBe(written)
  })

  it('keeps a wide-gamut colour outside sRGB untouched when only the alpha changes', () => {
    expect(withColorAlpha('oklch(0.7 0.4 30)', 0.8)).toBe('oklch(0.7 0.4 30 / 0.8)')
    expect(withColorAlpha('color(display-p3 1 0 0 / 0.5)', 1)).toBe('color(display-p3 1 0 0)')
  })
})

describe('a picked colour is written in the authored format', () => {
  it.each([
    ['#1a73e8', '#ff0000', '#ff0000'],
    ['#1a73e880', '#ff0000', '#ff000080'],
    ['hsl(210 50% 40%)', '#ff0000', 'hsl(0 100% 50%)'],
    ['hsl(210 50% 40% / 0.5)', '#00ff00', 'hsl(120 100% 50% / 0.5)'],
    ['rgb(10 20 30)', '#0000ff', 'rgb(0 0 255)'],
  ])('over %s, picking %s writes %s', (authored, picked, written) => {
    expect(inAuthoredColorFormat(authored, picked)).toBe(written)
  })

  it('never clamps a wide-gamut pick to sRGB', () => {
    expect(inAuthoredColorFormat('#1a73e8', 'color(display-p3 1 0 0)')).toBe('color(display-p3 1 0 0)')
    expect(inAuthoredColorFormat('oklch(0.7 0.15 30)', 'oklch(0.8 0.3 140)')).toBe('oklch(0.8 0.3 140)')
  })

  it('writes the pick itself over a token, which detaches it', () => {
    expect(inAuthoredColorFormat('var(--brand)', '#ff0000')).toBe('#ff0000')
  })
})
