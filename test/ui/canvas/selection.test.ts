import { describe, expect, it } from 'vitest'
import type { Rect } from '../../../src/shared/protocol'
import type { EdId, TemplateNode } from '../../../src/shared/types'
import {
  childSelection,
  clickSelection,
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

// root > toolbar > (icon (svg) > (glyph > stroke, badge (svg) > dot), caption)
const iconTree = node(
  'root',
  [
    node('toolbar', [
      node(
        'icon',
        [
          node('glyph', [node('stroke', [], { tag: 'path' })], { tag: 'g' }),
          node('badge', [node('dot', [], { tag: 'circle' })], { tag: 'svg' }),
        ],
        { tag: 'svg' },
      ),
      node('caption', [], { tag: 'span' }),
    ]),
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

  it('moves out of the outermost of two nested locked layers', () => {
    expect(selectableHit(tree, edId('label'), ids('label', 'button'))).toBe(edId('card'))
  })

  it('hits nothing selectable through a locked top-level layer', () => {
    const hit = selectableHit(tree, edId('aside'), ids('aside'))

    expect(clickSelection(tree, ids('card'), hit)).toEqual([])
  })

  it('hits nothing when the artboard itself is locked', () => {
    expect(selectableHit(tree, edId('label'), ids('root'))).toBeNull()
  })

  it('passes on a miss, and a hit the tree does not hold', () => {
    expect(selectableHit(tree, null, [])).toBeNull()
    expect(selectableHit(tree, edId('gone'), [])).toBe(edId('gone'))
  })

  it('moves a hit inside an icon out to the icon', () => {
    expect(selectableHit(iconTree, edId('stroke'), [])).toBe(edId('icon'))
    expect(selectableHit(iconTree, edId('glyph'), [])).toBe(edId('icon'))
    expect(selectableHit(iconTree, edId('icon'), [])).toBe(edId('icon'))
  })

  it('moves a hit inside nested svgs out to the outermost one', () => {
    expect(selectableHit(iconTree, edId('dot'), [])).toBe(edId('icon'))
  })

  it('leaves a hit beside an icon where it is', () => {
    expect(selectableHit(iconTree, edId('caption'), [])).toBe(edId('caption'))
    expect(selectableHit(iconTree, edId('toolbar'), [])).toBe(edId('toolbar'))
  })

  it('skips a locked icon, whichever of its paths is hit', () => {
    expect(selectableHit(iconTree, edId('stroke'), ids('icon'))).toBe(edId('toolbar'))
    expect(selectableHit(iconTree, edId('icon'), ids('icon'))).toBe(edId('toolbar'))
  })

  it('still hits an icon through a locked layer inside it', () => {
    expect(selectableHit(iconTree, edId('stroke'), ids('stroke'))).toBe(edId('icon'))
    expect(selectableHit(iconTree, edId('dot'), ids('badge'))).toBe(edId('icon'))
  })

  it('hits nothing selectable in an icon inside a locked top-level layer', () => {
    const hit = selectableHit(iconTree, edId('stroke'), ids('toolbar'))

    expect(clickSelection(iconTree, [], hit)).toEqual([])
  })
})

describe('click', () => {
  it('selects the smallest element under the pointer, whatever is selected', () => {
    expect(clickSelection(tree, [], edId('label'))).toEqual(ids('label'))
    expect(clickSelection(tree, ids('card'), edId('label'))).toEqual(ids('label'))
    expect(clickSelection(tree, ids('title'), edId('label'))).toEqual(ids('label'))
    expect(clickSelection(tree, ids('aside'), edId('label'))).toEqual(ids('label'))
  })

  it('selects a top-level element hit on its own background', () => {
    expect(clickSelection(tree, [], edId('card'))).toEqual(ids('card'))
    expect(clickSelection(tree, ids('label'), edId('card'))).toEqual(ids('card'))
    expect(clickSelection(tree, ids('title'), edId('aside'))).toEqual(ids('aside'))
  })

  it('keeps the only selected element when it is clicked again', () => {
    expect(clickSelection(tree, ids('label'), edId('label'))).toEqual(ids('label'))
  })

  it('narrows a multiple selection to the element clicked', () => {
    expect(clickSelection(tree, ids('title', 'label'), edId('label'))).toEqual(ids('label'))
  })

  it('clears the selection on a click on the empty artboard or outside it', () => {
    expect(clickSelection(tree, ids('card'), edId('root'))).toEqual([])
    expect(clickSelection(tree, ids('card'), null)).toEqual([])
  })

  it('selects nothing for a hit the tree does not hold', () => {
    expect(clickSelection(tree, ids('card'), edId('gone'))).toEqual([])
  })

  it('selects an <sc-for> repeat like any element, though its text is a live value', () => {
    expect(clickSelection(tree, [], edId('item'))).toEqual(ids('item'))
    expect(clickSelection(tree, ids('list'), edId('item'))).toEqual(ids('item'))
  })
})

describe('Cmd/Ctrl-click', () => {
  const mod = { mod: true }

  it('selects the layer around the hit, whatever else is selected', () => {
    expect(clickSelection(tree, [], edId('label'), mod)).toEqual(ids('button'))
    expect(clickSelection(tree, ids('aside'), edId('label'), mod)).toEqual(ids('button'))
    expect(clickSelection(tree, ids('title'), edId('label'), mod)).toEqual(ids('button'))
  })

  it('climbs one layer out with each click on the same spot', () => {
    expect(clickSelection(tree, ids('label'), edId('label'), mod)).toEqual(ids('button'))
    expect(clickSelection(tree, ids('button'), edId('label'), mod)).toEqual(ids('card'))
  })

  it('stays on a top-level layer, never on the artboard root', () => {
    expect(clickSelection(tree, ids('card'), edId('label'), mod)).toEqual(ids('card'))
    expect(clickSelection(tree, [], edId('aside'), mod)).toEqual(ids('aside'))
  })

  it('climbs from the hit when several layers are selected', () => {
    expect(clickSelection(tree, ids('button', 'aside'), edId('label'), mod)).toEqual(ids('button'))
  })

  it('clears the selection on a click on the empty artboard or outside it', () => {
    expect(clickSelection(tree, ids('card'), edId('root'), mod)).toEqual([])
    expect(clickSelection(tree, ids('card'), null, mod)).toEqual([])
  })

  it('selects the element that encloses an icon', () => {
    const hit = selectableHit(iconTree, edId('stroke'), [])

    expect(clickSelection(iconTree, [], hit)).toEqual(ids('icon'))
    expect(clickSelection(iconTree, [], hit, mod)).toEqual(ids('toolbar'))
    expect(clickSelection(iconTree, ids('stroke'), hit, mod)).toEqual(ids('toolbar'))
  })
})

describe('Shift-click', () => {
  it('adds the smallest element and removes it when it is already selected', () => {
    const added = clickSelection(tree, ids('title'), edId('label'), { shift: true })
    expect(added).toEqual(ids('title', 'label'))

    expect(clickSelection(tree, added, edId('title'), { shift: true })).toEqual(ids('label'))
  })

  it('removes the last selected element', () => {
    expect(clickSelection(tree, ids('label'), edId('label'), { shift: true })).toEqual([])
  })

  it('adds and removes the enclosing element with Cmd/Ctrl', () => {
    const added = clickSelection(tree, ids('card'), edId('aside'), { shift: true, mod: true })
    expect(added).toEqual(ids('card', 'aside'))

    expect(clickSelection(tree, added, edId('title'), { shift: true, mod: true })).toEqual(ids('aside'))
  })

  it('keeps the selection on the empty artboard', () => {
    expect(clickSelection(tree, ids('card', 'aside'), edId('root'), { shift: true })).toEqual(ids('card', 'aside'))
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

  it('counts an icon as a leaf, though its text lays out as a block', () => {
    expect(isMarqueeContainer(iconTree, edId('icon'), ['block'])).toBe(false)
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
