// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActionRegistry, type ActionModule, type ActionRegistry } from '../../../src/ui/actions/registry'
import { edId, fakeContext, inline, mountViewport, node, rect, settle, type FakeContext } from '../canvas/tool-context'

// root > card and card2 (absolute, left/top), plain (static), row (flex) > a
const tree = node('root', [node('card'), node('card2'), node('plain'), node('row', [node('a')])])

const rects = {
  root: [rect(0, 0, 1280, 900)],
  card: [rect(100, 50, 200, 100)],
  card2: [rect(350, 200, 100, 50)],
  plain: [rect(900, 600, 100, 100)],
  row: [rect(0, 290, 400, 70)],
  a: [rect(0, 300, 100, 50)],
}

const IN_FLOW = { position: 'static', transform: 'none' }

const computed = {
  root: { display: 'block' },
  row: { display: 'flex', 'flex-direction': 'row' },
  card: { position: 'absolute', transform: 'none', left: '100px', top: '50px', right: '980px', bottom: '750px' },
  card2: { position: 'absolute', transform: 'none', left: '350px', top: '200px', right: '830px', bottom: '650px' },
  plain: IN_FLOW,
  a: IN_FLOW,
}

const styles = {
  card: inline({ left: '100px', top: '50px' }),
  card2: inline({ left: '350px', top: '200px' }),
}

let registry: ActionRegistry
let trackSelection: (ctx: FakeContext['ctx']) => void
let viewport: HTMLElement
let fake: FakeContext

beforeEach(async () => {
  vi.resetModules()
  const nudge = (await import('../../../src/ui/actions/nudge.actions')) as ActionModule
  trackSelection = (await import('../../../src/ui/canvas/tools/move.tool')).trackSelection
  registry = createActionRegistry({ nudge }, 'mac')
  viewport = mountViewport()
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function selected(ids: readonly string[], options: { readOnly?: boolean } = {}): Promise<void> {
  fake = fakeContext({ tree, rects, computed, styles }, { selection: ids, readOnly: options.readOnly ?? false })
  trackSelection(fake.ctx)
  await settle()
}

/** Dispatches a real keydown at `target` and hands it to the registry the way the app's document listener does. */
function keydown(key: string, init: KeyboardEventInit = {}, target: EventTarget = viewport): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, ...init })
  const listen = (dispatched: Event) => registry.handleKeyDown(dispatched as KeyboardEvent, fake.ctx)
  document.addEventListener('keydown', listen)
  target.dispatchEvent(event)
  document.removeEventListener('keydown', listen)
  return event
}

function keyup(key: string, target: EventTarget = viewport): void {
  const event = new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true })
  const listen = (dispatched: Event) => registry.handleKeyUp(dispatched as KeyboardEvent)
  document.addEventListener('keyup', listen)
  target.dispatchEvent(event)
  document.removeEventListener('keyup', listen)
}

describe('nudging the selection with the arrow keys', () => {
  it.each([
    ['ArrowRight', {}, 'left: 101px'],
    ['ArrowLeft', {}, 'left: 99px'],
    ['ArrowDown', {}, 'top: 51px'],
    ['ArrowUp', {}, 'top: 49px'],
    ['ArrowRight', { shiftKey: true }, 'left: 110px'],
    ['ArrowLeft', { shiftKey: true }, 'left: 90px'],
    ['ArrowDown', { shiftKey: true }, 'top: 60px'],
    ['ArrowUp', { shiftKey: true }, 'top: 40px'],
  ])('%s %o writes %s', async (key, init, write) => {
    await selected(['card'])

    const event = keydown(key, init)
    await settle()

    expect(event.defaultPrevented).toBe(true)
    expect(fake.writes()).toEqual([write])
  })

  it('moves every selected absolute element by the same step, under one action', async () => {
    await selected(['card', 'card2'])

    keydown('ArrowRight')
    await settle()

    expect(fake.ops()).toHaveLength(2)
    expect(fake.ops()).toEqual(
      expect.arrayContaining([
        { target: [edId('card')], kind: 'setDecl', payload: { prop: 'left', value: '101px' } },
        { target: [edId('card2')], kind: 'setDecl', payload: { prop: 'left', value: '351px' } },
      ]),
    )
    expect(fake.actionIds()).toEqual([expect.any(String), expect.any(String)])
    expect(fake.undoEntries()).toBe(1)
  })

  it('makes a held arrow key one undo entry from keydown to keyup, and the next press another', async () => {
    await selected(['card', 'card2'])

    keydown('ArrowRight')
    await settle()
    for (let i = 0; i < 2; i++) {
      keydown('ArrowRight', { repeat: true })
      await settle()
    }
    keyup('ArrowRight')

    expect([...fake.writes()].sort()).toEqual(['left: 101px', 'left: 102px', 'left: 103px', 'left: 351px', 'left: 352px', 'left: 353px'])
    expect(fake.undoEntries()).toBe(1)

    keydown('ArrowRight')
    await settle()

    expect(fake.undoEntries()).toBe(2)
  })

  it('refuses a selection with an element that is not absolutely positioned, with a toast', async () => {
    await selected(['card', 'plain'])

    keydown('ArrowRight')
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
    expect(fake.ctx.toast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }))
  })

  it('does not nudge a flex child, whose place is its order', async () => {
    await selected(['a'])

    keydown('ArrowRight')
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('stays silent with nothing selected', async () => {
    await selected([])

    keydown('ArrowRight')
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
    expect(fake.ctx.toast).not.toHaveBeenCalled()
  })

  it('does nothing while the canvas is read-only', async () => {
    await selected(['card'], { readOnly: true })

    keydown('ArrowRight')
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('drops the nudge when a reload rejects the read', async () => {
    await selected(['card'])
    fake.failReads('computed')

    keydown('ArrowRight')
    await settle()

    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it.each([
    ['with Cmd', { metaKey: true }],
    ['with Ctrl', { ctrlKey: true }],
    ['with Alt', { altKey: true }],
  ])('leaves an arrow %s alone', async (_name, init) => {
    await selected(['card'])

    const event = keydown('ArrowRight', init)
    await settle()

    expect(event.defaultPrevented).toBe(false)
    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })

  it('leaves an arrow pressed on a focused button outside the canvas to the button', async () => {
    await selected(['card'])
    const button = document.createElement('button')
    document.body.append(button)

    const event = keydown('ArrowRight', {}, button)
    await settle()

    expect(event.defaultPrevented).toBe(false)
    expect(fake.ctx.apply).not.toHaveBeenCalled()
  })
})
