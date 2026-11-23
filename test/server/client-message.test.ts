import { describe, expect, it } from 'vitest'
import { isEditorState, parseClientMessage } from '../../src/server/client-message'

const raw = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
const op = (kind: string, payload: unknown, target: unknown = ['e1']) => ({ type: 'op', opId: 'op-1', op: { kind, target, payload } })
const inAction = (actionId: unknown) => ({ type: 'op', opId: 'op-1', op: { kind: 'deleteNode', target: ['e1'], payload: {}, actionId } })
const view = { zoom: 1, panX: 0, panY: -20, selection: ['e1'] }
const state = { hidden: ['e1'], locked: [], collapsed: ['e2'], boards: { 'project/home.dc.html': view } }

describe('parseClientMessage: edit ops', () => {
  it.each([
    ['setDecl', { prop: 'color', value: 'red' }],
    ['setDecl with important and a rule', { prop: 'color', value: 'red', important: true, rule: '.card' }],
    ['removeDecl', { prop: 'color' }],
    ['removeDecl in a rule', { prop: 'color', rule: '.card' }],
    ['setAttr', { name: 'alt', value: 'A card' }],
    ['setText', { text: 'Hello' }],
    ['moveNode to the end', { parent: 'e2', before: null }],
    ['moveNode before a sibling', { parent: 'e2', before: 'e3' }],
    ['wrapNode', { tag: 'div' }],
    ['wrapNode with a style', { tag: 'div', style: [{ prop: 'display', value: 'flex' }, { prop: 'gap', value: '8px' }] }],
    ['insertHtml at the end', { before: null, html: '<p>Hi</p>' }],
    ['insertHtml before a sibling', { before: 'e3', html: '<p>Hi</p>' }],
    ['removeAttr', { name: 'data-layer-name' }],
    ['unwrapNode', {}],
    ['duplicateNode', {}],
    ['deleteNode', {}],
  ])('accepts %s with the fields it needs', (label, payload) => {
    const message = op(label.split(' ')[0]!, payload)

    expect(parseClientMessage(raw(message))).toEqual(message)
  })

  it.each([
    ['setDecl without a value', 'setDecl', { prop: 'color' }],
    ['setDecl with a non-boolean important', 'setDecl', { prop: 'color', value: 'red', important: 'yes' }],
    ['setDecl with a non-string rule', 'setDecl', { prop: 'color', value: 'red', rule: 3 }],
    ['removeDecl without a prop', 'removeDecl', {}],
    ['removeDecl with a non-string rule', 'removeDecl', { prop: 'color', rule: null }],
    ['setAttr without a name', 'setAttr', { value: 'x' }],
    ['setAttr with a numeric value', 'setAttr', { name: 'width', value: 3 }],
    ['setText without text', 'setText', {}],
    ['moveNode into a parent that is not an id', 'moveNode', { parent: '../etc', before: null }],
    ['moveNode with before left out', 'moveNode', { parent: 'e2' }],
    ['moveNode before a non-id', 'moveNode', { parent: 'e2', before: 'not an id' }],
    ['wrapNode without a tag', 'wrapNode', {}],
    ['wrapNode with a style that is not a list', 'wrapNode', { tag: 'div', style: { display: 'flex' } }],
    ['wrapNode with a style entry that is not an object', 'wrapNode', { tag: 'div', style: ['display: flex'] }],
    ['wrapNode with a style entry missing its value', 'wrapNode', { tag: 'div', style: [{ prop: 'display' }] }],
    ['wrapNode with a non-string style prop', 'wrapNode', { tag: 'div', style: [{ prop: 1, value: 'flex' }] }],
    ['insertHtml without html', 'insertHtml', { before: null }],
    ['insertHtml with html that is not a string', 'insertHtml', { before: null, html: 3 }],
    ['insertHtml with before left out', 'insertHtml', { html: '<p>Hi</p>' }],
    ['insertHtml before a non-id', 'insertHtml', { before: 'not an id', html: '<p>Hi</p>' }],
    ['removeAttr without a name', 'removeAttr', {}],
    ['removeAttr with a numeric name', 'removeAttr', { name: 3 }],
  ])('drops %s', (_label, kind, payload) => {
    expect(parseClientMessage(raw(op(kind, payload)))).toBeNull()
  })

  it.each([
    ['an unknown kind', op('eval', {})],
    ['an inherited property name as kind', op('toString', {})],
    ['an empty target', op('deleteNode', {}, [])],
    ['a target that is not a list', op('deleteNode', {}, 'e1')],
    ['a target holding a non-id', op('deleteNode', {}, ['e1', '<script>'])],
    ['a payload that is a list', op('deleteNode', [])],
    ['a missing payload', { type: 'op', opId: 'op-1', op: { kind: 'deleteNode', target: ['e1'] } }],
    ['a missing opId', { type: 'op', op: { kind: 'deleteNode', target: ['e1'], payload: {} } }],
    ['an op that is not an object', { type: 'op', opId: 'op-1', op: 'deleteNode' }],
    ['a numeric actionId', inAction(7)],
    ['a null actionId', inAction(null)],
  ])('drops an op with %s', (_label, message) => {
    expect(parseClientMessage(raw(message))).toBeNull()
  })

  it('accepts an op that carries the actionId of the user action it belongs to', () => {
    const message = inAction('act-1')

    expect(parseClientMessage(raw(message))).toEqual(message)
  })
})

describe('parseClientMessage: other messages', () => {
  it.each([
    { type: 'open', board: 'project/home.dc.html' },
    { type: 'undo' },
    { type: 'redo' },
    { type: 'unlockStalePush' },
    { type: 'resolvePending', file: 'project/home.dc.html', keep: false },
    { type: 'revertFile', file: 'project/home.dc.html' },
    { type: 'saveEditorState', state },
  ])('accepts $type', (message) => {
    expect(parseClientMessage(raw(message))).toEqual(message)
  })

  it.each([
    ['open without a board', { type: 'open' }],
    ['resolvePending with a string keep', { type: 'resolvePending', file: 'project/home.dc.html', keep: 'true' }],
    ['revertFile without a file', { type: 'revertFile' }],
    ['saveEditorState with a broken state', { type: 'saveEditorState', state: { ...state, hidden: 'e1' } }],
    ['an unknown type', { type: 'shutdown' }],
    ['a list', [{ type: 'undo' }]],
    ['null', null],
  ])('drops %s', (_label, message) => {
    expect(parseClientMessage(raw(message))).toBeNull()
  })

  it('drops bytes that are not JSON', () => {
    expect(parseClientMessage(raw('{"type": "undo"'))).toBeNull()
  })
})

describe('isEditorState', () => {
  it('accepts hidden, locked and collapsed id lists with a valid view per board', () => {
    expect(isEditorState(state)).toBe(true)
    expect(isEditorState({ hidden: [], locked: [], collapsed: [], boards: {} })).toBe(true)
  })

  it('accepts a board view with a preview width', () => {
    expect(isEditorState({ ...state, boards: { b: { ...view, previewWidth: 375 } } })).toBe(true)
  })

  it.each([
    ['a non-id in locked', { ...state, locked: ['a b'] }],
    ['collapsed left out', { hidden: [], locked: [], boards: {} }],
    ['boards that is not an object', { ...state, boards: [] }],
    ['a zero zoom', { ...state, boards: { b: { ...view, zoom: 0 } } }],
    ['a pan that is not finite', { ...state, boards: { b: { ...view, panX: Number.POSITIVE_INFINITY } } }],
    ['a missing panY', { ...state, boards: { b: { zoom: 1, panX: 0, selection: [] } } }],
    ['a selection holding a non-id', { ...state, boards: { b: { ...view, selection: [7] } } }],
    ['a zero preview width', { ...state, boards: { b: { ...view, previewWidth: 0 } } }],
    ['a negative preview width', { ...state, boards: { b: { ...view, previewWidth: -375 } } }],
    ['a preview width that is not finite', { ...state, boards: { b: { ...view, previewWidth: Number.POSITIVE_INFINITY } } }],
    ['a preview width that is NaN', { ...state, boards: { b: { ...view, previewWidth: Number.NaN } } }],
    ['a preview width given as a string', { ...state, boards: { b: { ...view, previewWidth: '375' } } }],
  ])('refuses %s', (_label, value) => {
    expect(isEditorState(value)).toBe(false)
  })
})
