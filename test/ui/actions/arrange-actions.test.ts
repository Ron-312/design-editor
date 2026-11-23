// @vitest-environment jsdom
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest'
import type { ProbeRead } from '../../../src/shared/protocol'
import type { EditOp } from '../../../src/shared/types'
import { createDefaultRegistry, type Platform } from '../../../src/ui/actions/registry'
import { edId, fakeContext, node, rect, settle, type FakeContext, type Scene } from '../canvas/tool-context'

/**
 * stage (positioned block) holds absolutely positioned layers; row is a flex container, grid a grid one,
 * and flow a plain block whose children are static.
 */
const tree = node(
  'root',
  [
    node('stage', [node('p1'), node('label'), node('p2'), node('far'), node('p3'), node('p4')]),
    node('row', [node('f1'), node('f2'), node('f3')]),
    node('grid', [node('g1'), node('g2'), node('g3'), node('g4'), node('g5')]),
    node('flow', [node('s1'), node('s2')]),
  ],
  { readOnly: 'artboard-root' },
)

const absolute = (zIndex = 'auto') => ({ display: 'block', position: 'absolute', 'z-index': zIndex })
const inFlow = (zIndex = 'auto') => ({ display: 'block', position: 'static', 'z-index': zIndex })

const scene: Scene = {
  tree,
  computed: {
    root: { display: 'block', position: 'relative', 'z-index': 'auto' },
    stage: { display: 'block', position: 'relative', 'z-index': 'auto' },
    // label overlaps p1 but is static, and p2 overlaps it in another paint layer: a step passes neither.
    p1: absolute(),
    label: inFlow(),
    p2: absolute('5'),
    far: absolute(),
    p3: absolute(),
    p4: absolute(),
    row: { display: 'flex', position: 'static', 'z-index': 'auto' },
    f1: inFlow('2'),
    f2: inFlow('3'),
    f3: inFlow('7'),
    grid: { display: 'grid', position: 'static', 'z-index': 'auto' },
    g1: inFlow('1'),
    g2: inFlow('4'),
    g3: inFlow('6'),
    g4: inFlow('-3'),
    g5: inFlow('9'),
    flow: { display: 'block', position: 'static', 'z-index': 'auto' },
    s1: inFlow(),
    s2: inFlow(),
  },
  rects: {
    root: [rect(0, 0, 1280, 900)],
    stage: [rect(0, 0, 600, 600)],
    p1: [rect(0, 0, 100, 100)],
    label: [rect(10, 10, 50, 20)],
    p2: [rect(20, 20, 100, 100)],
    far: [rect(400, 400, 50, 50)],
    p3: [rect(50, 50, 100, 100)],
    p4: [rect(60, 60, 100, 100)],
    row: [rect(0, 600, 600, 50)],
    // f1 and f2 overlap; f3 overlaps neither.
    f1: [rect(0, 600, 100, 50)],
    f2: [rect(80, 600, 100, 50)],
    f3: [rect(300, 600, 100, 50)],
    grid: [rect(0, 700, 600, 600)],
    // g1, g2 and g3 overlap one another; g4 and g5 overlap nothing.
    g1: [rect(0, 700, 100, 100)],
    g2: [rect(50, 700, 100, 100)],
    g3: [rect(0, 750, 100, 100)],
    g4: [rect(400, 700, 50, 50)],
    g5: [rect(400, 1000, 50, 50)],
    flow: [rect(0, 1300, 600, 100)],
    s1: [rect(0, 1300, 600, 40)],
    s2: [rect(0, 1320, 600, 40)],
  },
}

type Modifiers = Partial<Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>>

interface Chord {
  readonly key: string
  readonly code: string
  readonly modifiers: Modifiers
}

/** What each z-order key sends as `key` and `code` per platform; Option and Shift change the character. */
const KEYS: Readonly<Record<Platform, Readonly<Record<'forward' | 'backward' | 'front' | 'back', Chord>>>> = {
  mac: {
    forward: { key: ']', code: 'BracketRight', modifiers: { metaKey: true } },
    backward: { key: '[', code: 'BracketLeft', modifiers: { metaKey: true } },
    front: { key: '‘', code: 'BracketRight', modifiers: { metaKey: true, altKey: true } },
    back: { key: '“', code: 'BracketLeft', modifiers: { metaKey: true, altKey: true } },
  },
  windows: {
    forward: { key: ']', code: 'BracketRight', modifiers: { ctrlKey: true } },
    backward: { key: '[', code: 'BracketLeft', modifiers: { ctrlKey: true } },
    front: { key: '}', code: 'BracketRight', modifiers: { ctrlKey: true, shiftKey: true } },
    back: { key: '{', code: 'BracketLeft', modifiers: { ctrlKey: true, shiftKey: true } },
  },
}

const PLATFORMS: readonly Platform[] = ['windows', 'mac']

function arranger(selection: readonly string[], platform: Platform = 'windows', options: { readOnly?: boolean } = {}) {
  const fake = fakeContext(scene, { selection, ...options })
  const registry = createDefaultRegistry(platform)
  const press = ({ key, code, modifiers }: Chord) => {
    const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...modifiers })
    let handled = false
    const listen = (dispatched: Event) => {
      handled = registry.handleKeyDown(dispatched as KeyboardEvent, fake.ctx)
    }
    document.addEventListener('keydown', listen)
    document.body.dispatchEvent(event)
    document.removeEventListener('keydown', listen)
    return { handled, prevented: event.defaultPrevented }
  }
  return { ...fake, registry, press, keys: KEYS[platform] }
}

/** Each op sent, without the action id the registry handed the run. */
function opsOf(fake: FakeContext): EditOp[] {
  return fake.ops().map((op) => ({ target: op.target, kind: op.kind, payload: op.payload }) as EditOp)
}

function moveOp(target: string, parent: string, before: string | null): EditOp {
  return { target: [edId(target)], kind: 'moveNode', payload: { parent: edId(parent), before: before === null ? null : edId(before) } }
}

function zIndexOp(target: string, value: string): EditOp {
  return { target: [edId(target)], kind: 'setDecl', payload: { prop: 'z-index', value } }
}

describe('z-order of an absolutely positioned layer: a DOM move among its siblings', () => {
  it.each(PLATFORMS)('Mod+] on %s moves it past the next overlapping sibling in its paint layer', async (platform) => {
    const editor = arranger(['p1'], platform)

    expect(editor.press(editor.keys.forward).handled).toBe(true)
    await settle()

    expect(opsOf(editor)).toEqual([moveOp('p1', 'stage', 'p4')])
  })

  it.each(PLATFORMS)('Mod+[ on %s moves it before the previous overlapping sibling in its paint layer', async (platform) => {
    const editor = arranger(['p3'], platform)

    editor.press(editor.keys.backward)
    await settle()

    expect(opsOf(editor)).toEqual([moveOp('p3', 'stage', 'p1')])
  })

  it.each(PLATFORMS)('bring to front on %s moves it past every overlapping sibling in its paint layer', async (platform) => {
    const editor = arranger(['p1'], platform)

    editor.press(editor.keys.front)
    await settle()

    expect(opsOf(editor)).toEqual([moveOp('p1', 'stage', null)])
  })

  it.each(PLATFORMS)('send to back on %s moves it before every overlapping sibling in its paint layer', async (platform) => {
    const editor = arranger(['p4'], platform)

    editor.press(editor.keys.back)
    await settle()

    expect(opsOf(editor)).toEqual([moveOp('p4', 'stage', 'p1')])
  })

  it('reads the siblings’ rects in one batch', async () => {
    const editor = arranger(['p1'])
    const answer = editor.ctx.read.getMockImplementation()!
    let rectsAnswered = 0
    const answeredBeforeEachRequest: number[] = []
    editor.ctx.read.mockImplementation(async (read: ProbeRead) => {
      if (read.kind === 'rects') answeredBeforeEachRequest.push(rectsAnswered)
      await new Promise((resolve) => setTimeout(resolve, 0))
      const result = await answer(read)
      if (read.kind === 'rects') rectsAnswered += 1
      return result
    })

    editor.press(editor.keys.forward)
    await settle()

    expect(opsOf(editor)).toEqual([moveOp('p1', 'stage', 'p4')])
    expect(answeredBeforeEachRequest.length).toBeGreaterThan(1)
    expect(answeredBeforeEachRequest.every((answered) => answered === 0)).toBe(true)
  })

  it('writes nothing and shows a toast when no sibling in its paint layer overlaps it in that direction', async () => {
    const editor = arranger(['far'])

    editor.press(editor.keys.forward)
    await settle()

    expect(editor.ctx.apply).not.toHaveBeenCalled()
    expect(editor.ctx.toast).toHaveBeenCalledTimes(1)
  })
})

describe('z-order of a flex or grid item: a z-index write', () => {
  it.each(PLATFORMS)('Mod+] on %s writes the next overlapping sibling’s z-index + 1', async (platform) => {
    const editor = arranger(['f1'], platform)

    editor.press(editor.keys.forward)
    await settle()

    expect(opsOf(editor)).toEqual([zIndexOp('f1', '4')])
  })

  it.each(PLATFORMS)('Mod+[ on %s writes the previous overlapping sibling’s z-index − 1', async (platform) => {
    const editor = arranger(['f2'], platform)

    editor.press(editor.keys.backward)
    await settle()

    expect(opsOf(editor)).toEqual([zIndexOp('f2', '1')])
  })

  it.each(PLATFORMS)('bring to front on %s writes the overlapping siblings’ max + 1, ignoring siblings it does not overlap', async (platform) => {
    const editor = arranger(['g1'], platform)

    editor.press(editor.keys.front)
    await settle()

    expect(opsOf(editor)).toEqual([zIndexOp('g1', '7')])
  })

  it.each(PLATFORMS)('send to back on %s writes the overlapping siblings’ min − 1, ignoring siblings it does not overlap', async (platform) => {
    const editor = arranger(['g3'], platform)

    editor.press(editor.keys.back)
    await settle()

    expect(opsOf(editor)).toEqual([zIndexOp('g3', '0')])
  })

  it('writes nothing and shows a toast when no sibling overlaps it in that direction', async () => {
    const editor = arranger(['f2'])

    editor.press(editor.keys.forward)
    await settle()

    expect(editor.ctx.apply).not.toHaveBeenCalled()
    expect(editor.ctx.toast).toHaveBeenCalledTimes(1)
  })
})

describe('z-order refusals and keys', () => {
  it('refuses a layer in plain block flow with the action’s tooltip text and writes nothing', async () => {
    const editor = arranger(['s1'])
    const tooltips = editor.registry.all().flatMap((action) => (action.disabledReason ? [action.disabledReason] : []))

    expect(editor.press(editor.keys.forward).prevented).toBe(true)
    await settle()

    expect(editor.ctx.apply).not.toHaveBeenCalled()
    expect(editor.ctx.toast).toHaveBeenCalledTimes(1)
    expect(tooltips).toContain(editor.ctx.toast.mock.calls[0]![0].message)
  })

  it('keeps Mod+[ and Mod+] from the browser even with nothing selected, and writes nothing', async () => {
    const editor = arranger([])

    expect(editor.press(editor.keys.forward).prevented).toBe(true)
    expect(editor.press(editor.keys.backward).prevented).toBe(true)
    await settle()

    expect(editor.ctx.apply).not.toHaveBeenCalled()
  })

  it('drops the command quietly when a reload rejects the reads', async () => {
    const editor = arranger(['p1'])
    editor.failReads('computed', 'rects')
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)

    editor.press(editor.keys.forward)
    await settle()
    process.off('unhandledRejection', unhandled)

    expect(unhandled).not.toHaveBeenCalled()
    expect(editor.ctx.apply).not.toHaveBeenCalled()
  })

  it('writes nothing while a push holds the lock', async () => {
    const editor = arranger(['f1'], 'windows', { readOnly: true })

    editor.press(editor.keys.forward)
    editor.press(editor.keys.front)
    await settle()

    expect(editor.ctx.apply).not.toHaveBeenCalled()
  })

  it('leaves Cmd+Shift+] to the browser’s tab switch on macOS', async () => {
    const editor = arranger(['g1'], 'mac')

    const { handled, prevented } = editor.press({ key: '}', code: 'BracketRight', modifiers: { metaKey: true, shiftKey: true } })
    await settle()

    expect(handled).toBe(false)
    expect(prevented).toBe(false)
    expect(editor.ctx.apply).not.toHaveBeenCalled()
  })

  it('binds a per-platform shortcut: Ctrl+Alt+] is not bring to front on Windows', async () => {
    const editor = arranger(['g1'], 'windows')

    editor.press({ key: ']', code: 'BracketRight', modifiers: { ctrlKey: true, altKey: true } })
    await settle()
    expect(editor.ctx.apply).not.toHaveBeenCalled()

    editor.press(editor.keys.front)
    await settle()
    expect(opsOf(editor)).toEqual([zIndexOp('g1', '7')])
  })
})
