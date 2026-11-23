import { describe, expect, it } from 'vitest'
import { projectPortFor, withReplacedIds, type EditorState } from '../../src/shared/protocol'
import type { EdId, ProjectPath } from '../../src/shared/types'

const edId = (id: string) => id as EdId
const HOME = 'project/home.dc.html' as ProjectPath
const CARD = 'project/card.dc.html' as ProjectPath

describe('projectPortFor', () => {
  it('serves the project on the port after the editor port', () => {
    expect(projectPortFor(5300)).toBe(5301)
    expect(projectPortFor(8000)).toBe(8001)
  })
})

describe('withReplacedIds', () => {
  const state: EditorState = {
    hidden: [edId('a'), edId('keep')],
    locked: [edId('b')],
    collapsed: [edId('c'), edId('a')],
    boards: {
      [HOME]: { zoom: 2, panX: 10, panY: -20, selection: [edId('a'), edId('keep')] },
      [CARD]: { zoom: 1, panX: 0, panY: 0, selection: [] },
    },
  }

  it('follows every replaced id in hidden, locked, collapsed and each board selection', () => {
    const replaced = { [edId('a')]: edId('a2'), [edId('b')]: edId('b2'), [edId('c')]: edId('c2') }

    expect(withReplacedIds(state, replaced)).toEqual({
      hidden: ['a2', 'keep'],
      locked: ['b2'],
      collapsed: ['c2', 'a2'],
      boards: {
        [HOME]: { zoom: 2, panX: 10, panY: -20, selection: ['a2', 'keep'] },
        [CARD]: { zoom: 1, panX: 0, panY: 0, selection: [] },
      },
    })
  })

  it('leaves the state unchanged and unmutated when nothing was replaced', () => {
    const before = structuredClone(state)

    expect(withReplacedIds(state, {})).toEqual(before)
    expect(withReplacedIds(state, { [edId('a')]: edId('a2') })).not.toEqual(before)
    expect(state).toEqual(before)
  })
})
