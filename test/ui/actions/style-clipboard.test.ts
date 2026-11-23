import { describe, expect, it } from 'vitest'
import { actions } from '../../../src/ui/actions/style-clipboard.actions'
import { ackFor, fakeContext, inline, node, settle } from '../canvas/tool-context'

const tree = node('root', [node('source'), node('target')])
const styles = { source: inline({ color: 'red', padding: '8px', 'border-radius': '4px' }) }

const copy = actions.find((action) => action.id === 'style.copy')!
const paste = actions.find((action) => action.id === 'style.paste')!

function copiedFromSource() {
  const fake = fakeContext({ tree, rects: {}, styles }, { selection: ['source'] })
  copy.run(fake.ctx, 'action-copy')
  fake.select('target')
  return fake
}

describe('Paste style', () => {
  it('sends every declaration under the run action id without waiting for each ack', async () => {
    const fake = copiedFromSource()
    fake.ctx.apply.mockImplementation(() => new Promise(() => {}))

    paste.run(fake.ctx, 'action-paste')
    await settle()

    expect(fake.writes()).toEqual(['color: red', 'padding: 8px', 'border-radius: 4px'])
    expect(fake.actionIds()).toEqual(['action-paste', 'action-paste', 'action-paste'])
    expect(fake.undoEntries()).toBe(1)
  })

  it('lists only the declarations the server accepted', async () => {
    const fake = copiedFromSource()
    fake.ctx.apply.mockImplementation(async (op) => {
      if (op.kind === 'setDecl' && op.payload.prop === 'padding') throw new Error('rejected')
      return ackFor(op)
    })

    paste.run(fake.ctx, 'action-paste')
    await settle()

    expect(fake.ctx.toast).toHaveBeenCalledWith({ message: 'Pasted style: color, border-radius', tone: 'info' })
  })
})
