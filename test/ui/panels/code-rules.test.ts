import { describe, expect, it } from 'vitest'
import type { BoardIndex, HelmetRuleSource } from '../../../src/shared/protocol'
import type { AuthoredDeclaration, EdId, ProjectPath, RuleId, SourceRange, StyleSource, TemplateNode } from '../../../src/shared/types'
import { codeBlocksOf } from '../../../src/ui/panels/code-rules'

const edId = (id: string) => id as EdId
const ruleId = (id: string) => id as RuleId
const board = 'project/card.dc.html' as ProjectPath

const cardStyle = 'style="background: red;  padding:4px"'
const cardRule = '.card {\n  border-radius:8px ;\n}'
const hoverRule = '.card:hover{color : red}'
const focusRule = '.card:focus-visible { outline: 1px solid }'
const beforeRule = '.card::before { content: "" }'
const otherRule = '.other { margin: 0 }'
const narrowRule = '.card { padding: 2px }'

const text = [
  '<x-dc>',
  '<helmet><style>',
  cardRule,
  hoverRule,
  focusRule,
  beforeRule,
  otherRule,
  '@media (max-width: 600px) {',
  `  ${narrowRule}`,
  '}',
  '</style></helmet>',
  `<div ${cardStyle}>Card</div>`,
  '<div class="other">Other</div>',
  '</x-dc>',
].join('\n')

function rangeOf(snippet: string): SourceRange {
  const start = text.indexOf(snippet)
  if (start < 0) throw new Error(`the fixture has no ${snippet}`)
  return { start, end: start + snippet.length }
}

function decl(prop: string, value: string): AuthoredDeclaration {
  return { prop, value, important: false, hasHole: false }
}

function rule(id: string, source: string, line: number, selector: string, media: string | null = null): HelmetRuleSource {
  return { target: ruleId(id), file: board, line, range: rangeOf(source), declarations: [], selector, media }
}

const rules: HelmetRuleSource[] = [
  rule('card', cardRule, 3, '.card'),
  rule('hover', hoverRule, 6, '.card:hover'),
  rule('focus', focusRule, 7, '.card:focus-visible'),
  rule('before', beforeRule, 8, '.card::before'),
  rule('other', otherRule, 9, '.other'),
  rule('narrow', narrowRule, 11, '.card', '(max-width: 600px)'),
]

const cardInline: StyleSource = {
  target: 'inline',
  file: board,
  line: 14,
  range: rangeOf(cardStyle),
  declarations: [decl('background', 'red'), decl('padding', '4px')],
}

function node(id: string, tag: string, children: TemplateNode[] = []): TemplateNode {
  return { edId: edId(id), kind: 'element', tag, name: id, children }
}

const index: BoardIndex = {
  board,
  frameSrc: `/project/secret/${board}`,
  tree: node('root', 'x-dc', [node('card', 'div'), node('other', 'div')]),
  locations: {},
  text,
  styles: { [edId('card')]: [cardInline] },
  rules,
}

/** The probe's answer for `index.rules`, in order, naming the rules it matched. */
function matchedOnly(...ids: string[]): boolean[] {
  return rules.map((entry) => ids.includes(entry.target))
}

const everyCardRule = matchedOnly('card', 'hover', 'focus', 'before', 'narrow')

describe('code blocks of the selection', () => {
  it('lists the inline style first, then each matched rule in source order', () => {
    const blocks = codeBlocksOf(index, edId('card'), everyCardRule)

    expect(blocks.map((block) => block.target)).toEqual(['inline', 'card', 'hover', 'focus', 'before', 'narrow'])
  })

  it('leaves out the rules the probe did not match', () => {
    const blocks = codeBlocksOf(index, edId('card'), matchedOnly('hover'))

    expect(blocks.map((block) => block.target)).toEqual(['inline', 'hover'])
  })

  it('shows each block exactly as the board source writes it', () => {
    const blocks = codeBlocksOf(index, edId('card'), everyCardRule)

    expect(blocks.map((block) => block.text)).toEqual([cardStyle, cardRule, hoverRule, focusRule, beforeRule, narrowRule])
  })

  it('says which file and line each block starts on', () => {
    const blocks = codeBlocksOf(index, edId('card'), everyCardRule)

    expect(blocks.map((block) => [block.file, block.line])).toEqual([
      [board, 14],
      [board, 3],
      [board, 6],
      [board, 7],
      [board, 8],
      [board, 11],
    ])
  })

  it('has no inline block for an element without an inline style', () => {
    const blocks = codeBlocksOf(index, edId('other'), matchedOnly('other'))

    expect(blocks.map((block) => block.target)).toEqual(['other'])
  })

  it('lists nothing for an element with no inline style and no matched rule', () => {
    expect(codeBlocksOf(index, edId('other'), matchedOnly())).toEqual([])
  })
})

describe('rule labels', () => {
  function labelOf(id: string): string | null | undefined {
    return codeBlocksOf(index, edId('card'), everyCardRule).find((block) => block.target === id)?.label
  }

  it('labels a rule matched through a state pseudo-class with that state', () => {
    expect(labelOf('hover')).toBe('on :hover')
    expect(labelOf('focus')).toBe('on :focus-visible')
  })

  it('labels a rule matched through a pseudo-element with the pseudo-element', () => {
    expect(labelOf('before')).toBe('::before')
  })

  it('gives a rule that matches the element as it is no label', () => {
    expect(labelOf('card')).toBeNull()
    expect(labelOf('inline')).toBeNull()
  })
})

describe('@media rules', () => {
  function mediaOf(id: string): string | null | undefined {
    return codeBlocksOf(index, edId('card'), everyCardRule).find((block) => block.target === id)?.media
  }

  it('carries the condition of a rule inside @media', () => {
    expect(mediaOf('narrow')).toBe('(max-width: 600px)')
  })

  it('has no condition for a rule or inline style outside @media', () => {
    expect(mediaOf('card')).toBeNull()
    expect(mediaOf('inline')).toBeNull()
  })
})
