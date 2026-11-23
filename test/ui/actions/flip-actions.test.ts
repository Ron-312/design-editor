// @vitest-environment jsdom
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EditOp, StyleSource } from '../../../src/shared/types'
import { createDefaultRegistry } from '../../../src/ui/actions/registry'
import { helmetRule, withRules } from '../canvas/matched-rules'
import { edId, fakeContext, inline, node, rect, settle, type FakeContext } from '../canvas/tool-context'

const tree = node('root', [node('logo')])
const rects = { root: [rect(0, 0, 1280, 900)], logo: [rect(100, 100, 80, 40)] }
const computed = { logo: { position: 'static', display: 'block', transform: 'none' } }

/** The editor's shell as the registry sees it: the layers panel, the canvas and the properties panel. */
function mountShell() {
  document.body.innerHTML = `
    <nav class="layers" aria-label="Layers">
      <div role="tree" aria-label="Layers">
        <div role="treeitem" tabindex="0" id="layer-row" data-layer-id="logo"><span>logo</span></div>
      </div>
    </nav>
    <main class="center">
      <div data-canvas-viewport="" tabindex="0" id="canvas"></div>
    </main>
    <aside class="props" aria-label="Properties">
      <button type="button" id="props-button">Fill</button>
      <input id="width-field" aria-label="Width" />
    </aside>
  `
  const byId = (id: string) => document.getElementById(id)!
  return { layerRow: byId('layer-row'), canvas: byId('canvas'), button: byId('props-button'), field: byId('width-field') }
}

let shell = mountShell()

beforeEach(() => {
  shell = mountShell()
})

afterEach(() => {
  document.body.innerHTML = ''
})

interface Editor {
  readonly fake: FakeContext
  /** The styles the index holds, replaced to stand in for the server re-indexing after a write. */
  readonly styles: Record<string, readonly StyleSource[]>
  /** Presses Shift and `letter` at `target`, the way the app's document listener hands it on; returns whether an action ran. */
  readonly flip: (letter: 'H' | 'V', target?: EventTarget) => boolean
}

function editor(authoredScale: string | null, options: { selection?: readonly string[] } = {}): Editor {
  const styles: Record<string, readonly StyleSource[]> = { logo: inline(authoredScale === null ? { width: '80px' } : { width: '80px', scale: authoredScale }) }
  const fake = fakeContext({ tree, rects, computed, styles }, { selection: options.selection ?? ['logo'] })
  const registry = createDefaultRegistry('windows')
  const flip = (letter: 'H' | 'V', target: EventTarget = shell.canvas) => {
    const event = new KeyboardEvent('keydown', { key: letter, code: `Key${letter}`, shiftKey: true, bubbles: true, cancelable: true })
    let handled = false
    const listen = (dispatched: Event) => {
      handled = registry.handleKeyDown(dispatched as KeyboardEvent, fake.ctx)
    }
    document.addEventListener('keydown', listen)
    target.dispatchEvent(event)
    document.removeEventListener('keydown', listen)
    return handled
  }
  return { fake, styles, flip }
}

function scaleOps(fake: FakeContext): Array<Pick<EditOp, 'target' | 'kind' | 'payload'>> {
  return fake.ops().map(({ target, kind, payload }) => ({ target, kind, payload }))
}

const setScale = (value: string) => ({ target: [edId('logo')], kind: 'setDecl', payload: { prop: 'scale', value } })
const removeScale = { target: [edId('logo')], kind: 'removeDecl', payload: { prop: 'scale' } }

describe('flip horizontal (Shift-H)', () => {
  it('writes scale: -1 1 when no scale is authored', async () => {
    const { fake, flip } = editor(null)

    expect(flip('H')).toBe(true)
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('-1 1')])
  })

  it('reads a single scale value as both axes', async () => {
    const { fake, flip } = editor('1.2')

    flip('H')
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('-1.2 1.2')])
  })

  it('negates only the x factor of a two-value scale', async () => {
    const { fake, flip } = editor('-2 0.5')

    flip('H')
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('2 0.5')])
  })

  it('removes the property when the result is 1 1', async () => {
    const { fake, flip } = editor('-1 1')

    flip('H')
    await settle()

    expect(scaleOps(fake)).toEqual([removeScale])
  })

  it('keeps the property when only the x factor comes back to 1', async () => {
    const { fake, flip } = editor('-1 -1')

    flip('H')
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('1 -1')])
  })
})

describe('flip vertical (Shift-V)', () => {
  it('writes scale: 1 -1 when no scale is authored', async () => {
    const { fake, flip } = editor(null)

    expect(flip('V')).toBe(true)
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('1 -1')])
  })

  it('reads a single scale value as both axes', async () => {
    const { fake, flip } = editor('1.2')

    flip('V')
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('1.2 -1.2')])
  })

  it('negates only the y factor of a two-value scale', async () => {
    const { fake, flip } = editor('-1 1')

    flip('V')
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('-1 -1')])
  })

  it('removes the property when the result is 1 1', async () => {
    const { fake, flip } = editor('1 -1')

    flip('V')
    await settle()

    expect(scaleOps(fake)).toEqual([removeScale])
  })
})

describe('flipping twice', () => {
  it('restores an element with no authored scale to having none', async () => {
    const { fake, styles, flip } = editor(null)

    flip('H')
    await settle()
    styles.logo = inline({ width: '80px', scale: '-1 1' })
    flip('H')
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('-1 1'), removeScale])
  })
})

describe('flipping again before the index catches up', () => {
  it('builds Shift-V on the Shift-H still in flight', async () => {
    const { fake, flip } = editor(null)

    flip('H')
    await settle()
    flip('V')
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('-1 1'), setScale('-1 -1')])
  })

  it('takes a second Shift-H back to no scale', async () => {
    const { fake, flip } = editor(null)

    flip('H')
    await settle()
    flip('H')
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('-1 1'), removeScale])
  })
})

describe('a scale set by a stylesheet rule', () => {
  const mirrored = helmetRule('.mirrored', { scale: '-1 1' })

  it('overrides the rule inline when flipping back to 1 1, since there is no inline scale to remove', async () => {
    const { fake, flip } = editor(null)
    withRules(fake, [mirrored], { '.mirrored': ['logo'] })

    flip('H')
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('1 1')])
  })

  it('flips the rule value when no inline scale overrides it', async () => {
    const { fake, flip } = editor(null)
    withRules(fake, [mirrored], { '.mirrored': ['logo'] })

    flip('V')
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('-1 -1')])
  })

  it('keeps an inline 1 1 over the rule rather than removing it, which would bring the rule back', async () => {
    const { fake, flip } = editor('-1 1')
    withRules(fake, [mirrored], { '.mirrored': ['logo'] })

    flip('H')
    await settle()

    expect(scaleOps(fake)).toEqual([setScale('1 1')])
  })
})

describe('where flip listens', () => {
  it('fires from the canvas and from a focused layer row', async () => {
    const { fake, flip } = editor(null)

    expect(flip('H', shell.canvas)).toBe(true)
    expect(flip('V', shell.layerRow)).toBe(true)
    await settle()

    expect(fake.ops().map((op) => op.kind)).toEqual(['setDecl', 'setDecl'])
  })

  it('leaves Shift-H to a focused button or text field elsewhere', async () => {
    const { fake, flip } = editor(null)

    expect(flip('H', shell.button)).toBe(false)
    expect(flip('H', shell.field)).toBe(false)
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })
})

describe('when flip does nothing', () => {
  it('writes nothing with an empty selection', async () => {
    const { fake, flip } = editor(null, { selection: [] })

    flip('H')
    flip('V')
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('writes nothing while a push holds the lock', async () => {
    const { fake, flip } = editor(null)
    fake.setReadOnly(true)

    flip('H')
    flip('V')
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })
})
