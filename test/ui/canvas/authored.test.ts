import { describe, expect, it } from 'vitest'
import { authoredDecl, readMatchedRules, removeDecl, writeDecl } from '../../../src/ui/canvas/authored'
import { helmetRule, withRules } from './matched-rules'
import { board, edId, fakeContext, inline, node, rect } from './tool-context'

const tree = node('root', [node('card'), node('other')])
const rects = { root: [rect(0, 0, 100, 100)], card: [rect(0, 0, 10, 10)] }

function editor(styles = {}) {
  return fakeContext({ tree, rects, styles })
}

const card = edId('card')

/** `style="width: 100px; width: 20rem"` */
const repeatedWidth = [{ ...inline({})[0]!, declarations: [...inline({ width: '100px' })[0]!.declarations, ...inline({ width: '20rem' })[0]!.declarations] }]

describe('the authored value an element renders with', () => {
  it('takes the last inline declaration, the one that renders', () => {
    const fake = editor({ card: repeatedWidth })

    expect(authoredDecl(fake.ctx, card, 'width')).toEqual({ value: '20rem', source: 'inline' })
  })

  it('falls back to the last matched rule and names it', async () => {
    const fake = editor()
    withRules(fake, [helmetRule('.card', { width: '10rem' }), helmetRule('.wide', { width: '30rem' }), helmetRule('.other', { width: '1px' })], {
      '.card': ['card'],
      '.wide': ['card'],
      '.other': ['other'],
    })

    const rules = await readMatchedRules(fake.ctx, card)

    expect(authoredDecl(fake.ctx, card, 'width', rules)).toEqual({ value: '30rem', source: '.wide#0' })
  })

  it('prefers the inline style over a rule', async () => {
    const fake = editor({ card: inline({ width: '50px' }) })
    withRules(fake, [helmetRule('.card', { width: '10rem' })], { '.card': ['card'] })

    expect(authoredDecl(fake.ctx, card, 'width', await readMatchedRules(fake.ctx, card))).toEqual({ value: '50px', source: 'inline' })
  })

  it('leaves out a rule under @media, whose condition is not known', async () => {
    const fake = editor()
    withRules(fake, [helmetRule('.card', { width: '10rem' }, '(min-width: 900px)')], { '.card': ['card'] })

    expect(await readMatchedRules(fake.ctx, card)).toEqual([])
  })

  it('asks the probe nothing when the board has no rules', async () => {
    const fake = editor()

    expect(await readMatchedRules(fake.ctx, card)).toEqual([])
    expect(fake.reads('matches')).toEqual([])
  })
})

describe('writes the index has not caught up with', () => {
  it('reads a write back until the next index arrives', () => {
    const fake = editor({ card: inline({ left: '100px' }) })

    writeDecl(fake.ctx, card, 'left', '40px', 'a1')
    expect(authoredDecl(fake.ctx, card, 'left')).toEqual({ value: '40px', source: 'inline' })

    fake.ctx.index.mockReturnValue({ ...fake.ctx.index(), board })
    expect(authoredDecl(fake.ctx, card, 'left')).toEqual({ value: '100px', source: 'inline' })
  })

  it('reads a removal as no inline value, so a matched rule shows through', async () => {
    const fake = editor({ card: inline({ scale: '-1 1' }) })
    withRules(fake, [helmetRule('.card', { scale: '2' })], { '.card': ['card'] })
    const rules = await readMatchedRules(fake.ctx, card)

    removeDecl(fake.ctx, card, 'scale', 'a1')

    expect(authoredDecl(fake.ctx, card, 'scale', rules)).toEqual({ value: '2', source: '.card#0' })
    expect(fake.ops()).toEqual([{ target: [card], kind: 'removeDecl', payload: { prop: 'scale' } }])
  })
})
