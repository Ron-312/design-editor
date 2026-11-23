import { describe, expect, it } from 'vitest'
import type { Rect } from '../../../src/shared/protocol'
import type { EdId, TemplateNode } from '../../../src/shared/types'
import {
  childSelection,
  clickSelection,
  doubleClickSelection,
  isMarqueeContainer,
  marqueeSelection,
  parentSelection,
  selectableHit,
  siblingSelection,
} from '../../../src/ui/canvas/selection'

const edId = (id: string) => id as EdId
const ids = (...names: string[]) => names.map(edId)

function node(id: string, children: TemplateNode[] = [], extra: Partial<TemplateNode> = {}): TemplateNode {
  return { edId: edId(id), kind: 'element', tag: 'div', name: id, children, ...extra }
}

// root > card > (title, button > label), root > list > item (an <sc-for> repeat), root > aside
const tree = node(
  'root',
  [
    node('card', [node('title', [], { tag: 'h1' }), node('button', [node('label', [], { tag: 'span' })], { tag: 'button' })]),
    node('list', [node('item', [], { tag: 'li', readOnly: 'hole' })], { tag: 'ul' }),
    node('aside'),
  ],
  { readOnly: 'artboard-root' },
)

describe('the shared hit-test', () => {
  it('returns the deepest element under the point when nothing is locked', () => {
    expect(selectableHit(tree, edId('label'), [])).toBe(edId('label'))
  })

  it('skips a locked layer and lands on the element beneath it', () => {
    expect(selectableHit(tree, edId('title'), ids('title'))).toBe(edId('card'))
  })

  it('skips the children of a locked layer too', () => {
    expect(selectableHit(tree, edId('label'), ids('button'))).toBe(edId('card'))
  })

  it('hits nothing selectable through a locked top-level layer', () => {
    const hit = selectableHit(tree, edId('aside'), ids('aside'))

    expect(clickSelection(tree, ids('card'), hit)).toEqual([])
  })
})

describe('click', () => {
  it('selects the top-level element when nothing is selected', () => {
    expect(clickSelection(tree, [], edId('label'))).toEqual(ids('card'))
    expect(clickSelection(tree, [], edId('aside'))).toEqual(ids('aside'))
  })

  it('keeps the selected element when clicking inside it', () => {
    expect(clickSelection(tree, ids('card'), edId('label'))).toEqual(ids('card'))
  })

  it('selects within the current scope, the parent of the selection', () => {
    expect(clickSelection(tree, ids('title'), edId('label'))).toEqual(ids('button'))
  })

  it('falls back to the top level for a hit outside the current scope', () => {
    expect(clickSelection(tree, ids('title'), edId('aside'))).toEqual(ids('aside'))
  })

  it('clears the selection on a click on the empty artboard or outside it', () => {
    expect(clickSelection(tree, ids('card'), edId('root'))).toEqual([])
    expect(clickSelection(tree, ids('card'), null)).toEqual([])
  })

  it('selects the deepest element with Cmd/Ctrl', () => {
    expect(clickSelection(tree, [], edId('label'), { mod: true })).toEqual(ids('label'))
    expect(clickSelection(tree, ids('aside'), edId('label'), { mod: true })).toEqual(ids('label'))
  })

  it('adds with Shift and removes an element that is already selected', () => {
    const added = clickSelection(tree, ids('card'), edId('aside'), { shift: true })
    expect(added).toEqual(ids('card', 'aside'))

    expect(clickSelection(tree, added, edId('label'), { shift: true })).toEqual(ids('aside'))
  })

  it('keeps the selection on a Shift-click on the empty artboard', () => {
    expect(clickSelection(tree, ids('card', 'aside'), edId('root'), { shift: true })).toEqual(ids('card', 'aside'))
  })

  it('selects an <sc-for> repeat like any element, though its text is a live value', () => {
    expect(clickSelection(tree, ids('list'), edId('item'))).toEqual(ids('list'))
    expect(doubleClickSelection(tree, ids('list'), edId('item'))).toEqual(ids('item'))
  })
})

describe('double-click', () => {
  it('goes one level deeper toward the hit', () => {
    expect(doubleClickSelection(tree, ids('card'), edId('label'))).toEqual(ids('button'))
    expect(doubleClickSelection(tree, ids('button'), edId('label'))).toEqual(ids('label'))
  })

  it('goes one level below what a click would select when nothing is selected', () => {
    expect(doubleClickSelection(tree, [], edId('label'))).toEqual(ids('button'))
  })

  it('stays on a leaf, where there is nothing deeper', () => {
    expect(doubleClickSelection(tree, ids('title'), edId('title'))).toEqual(ids('title'))
  })
})

describe('keyboard', () => {
  it('Enter selects the first child', () => {
    expect(childSelection(tree, ids('card'))).toEqual(ids('title'))
    expect(childSelection(tree, ids('button'))).toEqual(ids('label'))
  })

  it('Enter on a leaf keeps it', () => {
    expect(childSelection(tree, ids('title'))).toEqual(ids('title'))
  })

  it('Shift-Enter selects the parent', () => {
    expect(parentSelection(tree, ids('label'))).toEqual(ids('button'))
    expect(parentSelection(tree, ids('button'))).toEqual(ids('card'))
  })

  it('Tab selects the next sibling and wraps at the last', () => {
    expect(siblingSelection(tree, ids('title'), 1)).toEqual(ids('button'))
    expect(siblingSelection(tree, ids('button'), 1)).toEqual(ids('title'))
    expect(siblingSelection(tree, ids('card'), 1)).toEqual(ids('list'))
    expect(siblingSelection(tree, ids('aside'), 1)).toEqual(ids('card'))
  })

  it('Shift-Tab selects the previous sibling and wraps at the first', () => {
    expect(siblingSelection(tree, ids('button'), -1)).toEqual(ids('title'))
    expect(siblingSelection(tree, ids('title'), -1)).toEqual(ids('button'))
    expect(siblingSelection(tree, ids('card'), -1)).toEqual(ids('aside'))
  })

  it('Tab with nothing selected selects the first top-level element', () => {
    expect(siblingSelection(tree, [], 1)).toEqual(ids('card'))
  })
})

describe('marquee hit set', () => {
  const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height })
  // Three columns side by side, and one below them.
  const candidates = [
    { edId: edId('a'), rect: rect(0, 0, 100, 100) },
    { edId: edId('b'), rect: rect(150, 0, 100, 100) },
    { edId: edId('c'), rect: rect(300, 0, 100, 100) },
    { edId: edId('d'), rect: rect(0, 200, 100, 100) },
  ]

  it('selects the candidates the rectangle intersects, in candidate order', () => {
    expect(marqueeSelection([], candidates, rect(50, 50, 200, 20))).toEqual(ids('a', 'b'))
  })

  it('counts a candidate the rectangle only clips', () => {
    expect(marqueeSelection([], candidates, rect(390, 90, 50, 50))).toEqual(ids('c'))
  })

  it('selects nothing when the rectangle misses every candidate', () => {
    expect(marqueeSelection([], candidates, rect(110, 110, 30, 30))).toEqual([])
  })

  it('replaces the selection it had at press without Shift', () => {
    expect(marqueeSelection(ids('d'), candidates, rect(120, 10, 200, 20))).toEqual(ids('b', 'c'))
  })

  it('adds to the selection it had at press with Shift, keeping each element once', () => {
    expect(marqueeSelection(ids('b', 'x'), candidates, rect(50, 10, 200, 20), { shift: true })).toEqual(ids('b', 'x', 'a'))
  })

  it('keeps the selection it had at press when a Shift marquee hits nothing', () => {
    expect(marqueeSelection(ids('d'), candidates, rect(110, 110, 30, 30), { shift: true })).toEqual(ids('d'))
  })
})

describe('marquee container', () => {
  it('counts the artboard root as a container, whatever its children are', () => {
    expect(isMarqueeContainer(tree, edId('root'), [])).toBe(true)
    expect(isMarqueeContainer(tree, edId('root'), ['inline'])).toBe(true)
  })

  it('counts an element with a block-level element child as a container', () => {
    expect(isMarqueeContainer(tree, edId('card'), ['block', 'inline-block'])).toBe(true)
    expect(isMarqueeContainer(tree, edId('list'), ['flex'])).toBe(true)
    expect(isMarqueeContainer(tree, edId('card'), ['inline', 'grid'])).toBe(true)
  })

  it('counts text with inline children as a leaf', () => {
    expect(isMarqueeContainer(tree, edId('button'), ['inline'])).toBe(false)
    expect(isMarqueeContainer(tree, edId('card'), ['inline', 'inline'])).toBe(false)
  })

  it('counts inline-block and contents children as inline-level', () => {
    expect(isMarqueeContainer(tree, edId('card'), ['inline-block'])).toBe(false)
    expect(isMarqueeContainer(tree, edId('card'), ['contents', 'inline'])).toBe(false)
  })

  it('counts an element with no element children as a leaf', () => {
    expect(isMarqueeContainer(tree, edId('aside'), [])).toBe(false)
  })
})
