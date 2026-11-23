import { describe, expect, it } from 'vitest'
import { lineClampRemovals, lineClampWarning, lineClampWrites, resizingModeOf, resizingWrites } from '../../../src/ui/panels/text-layout'

type Write = { readonly prop: string; readonly value: string | null }

function authoredFrom(declarations: Readonly<Record<string, string>>) {
  return (prop: string): string | null => declarations[prop] ?? null
}

/** Writes keyed by property, so the order they are sent in does not matter. */
function byProp(writes: readonly Write[]): Record<string, string | null> {
  return Object.fromEntries(writes.map(({ prop, value }) => [prop, value]))
}

const LINE_CLAMP_BLOCK = {
  display: '-webkit-box',
  '-webkit-line-clamp': '3',
  '-webkit-box-orient': 'vertical',
  overflow: 'hidden',
}

describe('the line-clamp block', () => {
  it('writes display:-webkit-box, -webkit-line-clamp, -webkit-box-orient: vertical and overflow:hidden', () => {
    const writes = lineClampWrites(3)

    expect(writes).toHaveLength(4)
    expect(byProp(writes)).toEqual(LINE_CLAMP_BLOCK)
  })

  it('carries the number of lines into -webkit-line-clamp', () => {
    expect(byProp(lineClampWrites(1))['-webkit-line-clamp']).toBe('1')
    expect(byProp(lineClampWrites(12))['-webkit-line-clamp']).toBe('12')
  })

  it('removes every declaration of the block that is authored', () => {
    const writes = lineClampRemovals(authoredFrom({ ...LINE_CLAMP_BLOCK, color: '#111111' }))

    expect(byProp(writes)).toEqual({ display: null, '-webkit-line-clamp': null, '-webkit-box-orient': null, overflow: null })
  })

  it('removes nothing that is not authored', () => {
    const writes = lineClampRemovals(authoredFrom({ '-webkit-line-clamp': '2', '-webkit-box-orient': 'vertical' }))

    expect(byProp(writes)).toEqual({ '-webkit-line-clamp': null, '-webkit-box-orient': null })
  })
})

describe('the line-clamp warning', () => {
  it.each(['flex', 'inline-flex', 'grid', 'inline-grid'])('warns that the block would replace display: %s', (display) => {
    const warning = lineClampWarning(display)

    expect(warning).not.toBeNull()
    expect(warning).toContain(display)
  })

  it.each(['block', 'inline-block', '-webkit-box', ''])('says nothing for display: %s', (display) => {
    expect(lineClampWarning(display)).toBeNull()
  })
})

describe('text resizing mode', () => {
  it('reads white-space: nowrap with no width as auto width', () => {
    expect(resizingModeOf(authoredFrom({ 'white-space': 'nowrap' }))).toBe('auto-width')
  })

  it('reads a width with no height as auto height', () => {
    expect(resizingModeOf(authoredFrom({ width: '240px' }))).toBe('auto-height')
  })

  it('reads a width and a height as fixed', () => {
    expect(resizingModeOf(authoredFrom({ width: '240px', height: '80px' }))).toBe('fixed')
  })

  it('auto width writes white-space: nowrap and removes the width', () => {
    const writes = byProp(resizingWrites('auto-width', authoredFrom({ width: '240px', height: '80px' }), { width: 240, height: 80 }))

    expect(writes).toMatchObject({ 'white-space': 'nowrap', width: null })
  })

  it('auto height fixes the measured width, removes the height and lets the text wrap', () => {
    const writes = byProp(resizingWrites('auto-height', authoredFrom({ 'white-space': 'nowrap', height: '20px' }), { width: 312, height: 20 }))

    expect(writes).toEqual({ width: '312px', height: null, 'white-space': null })
  })

  it('auto height keeps an authored width', () => {
    const writes = byProp(resizingWrites('auto-height', authoredFrom({ width: '240px', height: '80px' }), { width: 240, height: 80 }))

    expect(writes).toEqual({ height: null })
  })

  it('fixed writes the measured width and height and lets the text wrap', () => {
    const writes = byProp(resizingWrites('fixed', authoredFrom({ 'white-space': 'nowrap' }), { width: 181, height: 24 }))

    expect(writes).toEqual({ width: '181px', height: '24px', 'white-space': null })
  })

  it('fixed keeps an authored width and adds the measured height', () => {
    const writes = byProp(resizingWrites('fixed', authoredFrom({ width: '240px' }), { width: 240, height: 48 }))

    expect(writes).toEqual({ height: '48px' })
  })
})
