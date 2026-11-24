import { describe, expect, it } from 'vitest'
import { parseProbeToEditor } from '../../src/shared/probe-schema'
import type { ProbeToEditor } from '../../src/shared/protocol'
import type { EdId } from '../../src/shared/types'

const edId = (id: string) => id as EdId
const RECT = { x: 1, y: 2, width: 3, height: 4 }

function readResult(...results: unknown[]): unknown {
  return { type: 'readResult', id: 1, results }
}

describe('parseProbeToEditor', () => {
  it.each<ProbeToEditor>([
    { type: 'ready', scrollX: 0, scrollY: 12.5 },
    { type: 'scrolled', scrollX: 3, scrollY: 4 },
    { type: 'textCommit', session: 's1', edId: edId('e1'), text: '' },
    { type: 'textCancelled', session: 's1', reason: 'escape' },
    { type: 'fontsFailed', families: ['Inter'] },
    { type: 'runtimeDrawn' },
    {
      type: 'readResult',
      id: 7,
      results: [
        { kind: 'rects', rects: [RECT] },
        { kind: 'computed', values: { color: 'red' } },
        { kind: 'hitTest', edId: edId('e1') },
        { kind: 'hitTest', edId: null },
        { kind: 'snapRects', self: RECT, parent: RECT, siblings: [RECT] },
        { kind: 'snapRects', self: RECT, parent: null, siblings: [] },
        { kind: 'supports', supported: false },
        { kind: 'matches', matched: [true, false] },
        { kind: 'matches', matched: [] },
        { kind: 'documentHeight', scrollHeight: 1460.5 },
        { kind: 'rootFontSize', fontSize: 12 },
      ],
    },
  ])('accepts a well-formed $type message as is', (message) => {
    expect(parseProbeToEditor(message)).toBe(message)
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['an array', [{ type: 'ready', scrollX: 0, scrollY: 0 }]],
    ['an unknown type', { type: 'hello' }],
    ['a non-finite scroll', { type: 'ready', scrollX: Infinity, scrollY: 0 }],
    ['a fractional read id', { type: 'readResult', id: 1.5, results: [] }],
    ['a commit without text', { type: 'textCommit', session: 's1', edId: 'e1' }],
    ['an unknown cancel reason', { type: 'textCancelled', session: 's1', reason: 'bored' }],
    ['a non-string cancel reason', { type: 'textCancelled', session: 's1', reason: 1 }],
    ['a result that is not an object', readResult('rects')],
    ['a result of unknown kind', readResult({ kind: 'layout' })],
    ['rects that are not rects', readResult({ kind: 'rects', rects: [{ ...RECT, width: '3' }] })],
    ['computed values that are not strings', readResult({ kind: 'computed', values: { color: 1 } })],
    ['computed values that are an array', readResult({ kind: 'computed', values: ['red'] })],
    ['a hit that is a number', readResult({ kind: 'hitTest', edId: 1 })],
    ['snap rects with a bad self', readResult({ kind: 'snapRects', self: null, parent: null, siblings: [] })],
    ['snap rects with a bad parent', readResult({ kind: 'snapRects', self: RECT, parent: {}, siblings: [] })],
    ['snap rects with bad siblings', readResult({ kind: 'snapRects', self: RECT, parent: null, siblings: [null] })],
    ['supports that is not a boolean', readResult({ kind: 'supports', supported: 'yes' })],
    ['matches that are not booleans', readResult({ kind: 'matches', matched: [true, 'yes'] })],
    ['matches that are not a list', readResult({ kind: 'matches', matched: true })],
    ['matches with no list', readResult({ kind: 'matches' })],
    ['a document height that is a string', readResult({ kind: 'documentHeight', scrollHeight: '900' })],
    ['a document height that is not finite', readResult({ kind: 'documentHeight', scrollHeight: Infinity })],
    ['a root font size that is a string', readResult({ kind: 'rootFontSize', fontSize: '16px' })],
    ['a document height with no value', readResult({ kind: 'documentHeight' })],
  ])('rejects %s', (_case, payload) => {
    expect(parseProbeToEditor(payload)).toBeNull()
  })
})
