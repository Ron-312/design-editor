import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SourceIndex } from '../../../src/server/source/source-index'
import type { EdId, ProjectPath, SourceRange } from '../../../src/shared/types'

type IndexedFile = ReturnType<SourceIndex['indexFile']>
type InlineStyle = NonNullable<ReturnType<IndexedFile['inlineStyle']>>
type HelmetRule = NonNullable<ReturnType<IndexedFile['findRule']>>

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url))
const HOME_FILE = path.join(FIXTURES, 'canvas', 'project', 'home.dc.html')
const VARIANTS = ['lf', 'crlf', 'mixed', 'bom', 'nonl'] as const

const HOME = 'project/home.dc.html' as ProjectPath
const EDGE = 'project/edge.dc.html' as ProjectPath

const edgeFile = (variant: string) => path.join(FIXTURES, 'endings', `edge.${variant}.dc.html`)

function readFixtureText(file: string): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(readFileSync(file))
}

function slice(text: string, range: SourceRange): string {
  return text.slice(range.start, range.end)
}

function idOf(text: string, indexed: IndexedFile, tag: string, nth = 0): EdId {
  const ids = indexed.ids.filter((id) => {
    const location = indexed.locate(id)
    return location !== undefined && new RegExp(`^<${tag}[\\s>/]`, 'i').test(slice(text, location.startTag))
  })
  const id = ids[nth]
  if (!id) throw new Error(`no <${tag}> #${nth}`)
  return id
}

function inlineStyleOf(indexed: IndexedFile, id: EdId): InlineStyle {
  const style = indexed.inlineStyle(id)
  if (!style) throw new Error(`no inline style on ${id}`)
  return style
}

function ruleOf(indexed: IndexedFile, selector: string, order = 0): HelmetRule {
  const rule = indexed.findRule(selector, order)
  if (!rule) throw new Error(`no helmet rule ${selector} #${order}`)
  return rule
}

function authored(declarations: InlineStyle['declarations']) {
  return declarations.map(({ prop, value, important, hasHole }) => ({ prop, value, important, hasHole }))
}

function declarationTexts(text: string, declarations: InlineStyle['declarations']): string[] {
  return declarations.map((declaration) => slice(text, declaration.range))
}

function indexHome() {
  const text = readFixtureText(HOME_FILE)
  return { text, indexed: new SourceIndex().indexFile(HOME, text) }
}

describe('inline style index', () => {
  it('indexes prop, value and !important for each declaration', () => {
    const { text, indexed } = indexHome()
    const style = inlineStyleOf(indexed, idOf(text, indexed, 'header'))
    expect(authored(style.declarations)).toEqual([
      { prop: 'background-color', value: '{{ accent }}', important: false, hasHole: true },
      { prop: 'color', value: '#fff7ed', important: false, hasHole: false },
      { prop: 'padding', value: '24px 32px', important: false, hasHole: false },
      { prop: 'border-radius', value: '12px', important: false, hasHole: false },
    ])
  })

  it('marks only the {{ hole }} declaration read-only and still ranges the others', () => {
    const { text, indexed } = indexHome()
    const style = inlineStyleOf(indexed, idOf(text, indexed, 'header'))
    expect(style.declarations.filter((declaration) => declaration.hasHole).map((declaration) => declaration.prop)).toEqual([
      'background-color',
    ])
    expect(declarationTexts(text, style.declarations)).toEqual([
      'background-color: {{ accent }}',
      'color: #fff7ed',
      'padding: 24px 32px',
      'border-radius: 12px',
    ])
  })

  it('targets the inline style in the indexed file', () => {
    const { text, indexed } = indexHome()
    const style = inlineStyleOf(indexed, idOf(text, indexed, 'header'))
    expect(style.target).toBe('inline')
    expect(style.file).toBe(HOME)
  })

  it('reports the 1-based line of the style attribute for the selector chip', () => {
    const { text, indexed } = indexHome()
    expect(inlineStyleOf(indexed, idOf(text, indexed, 'main')).line).toBe(20)
    expect(inlineStyleOf(indexed, idOf(text, indexed, 'header')).line).toBe(21)
    expect(inlineStyleOf(indexed, idOf(text, indexed, 'li')).line).toBe(34)
  })

  it('has no inline style for an element without a style attribute', () => {
    const { text, indexed } = indexHome()
    expect(indexed.inlineStyle(idOf(text, indexed, 'p', 0))).toBeNull()
  })
})

describe.each(VARIANTS)('inline styles on edge.%s.dc.html', (variant) => {
  const text = readFixtureText(edgeFile(variant))
  const indexed = new SourceIndex().indexFile(EDGE, text)

  it('keeps !important apart from the value', () => {
    const style = inlineStyleOf(indexed, idOf(text, indexed, 'td'))
    expect(authored(style.declarations)).toEqual([{ prop: 'padding', value: '4px 8px', important: true, hasHole: false }])
    expect(declarationTexts(text, style.declarations)).toEqual(['padding: 4px 8px !important'])
  })

  it('ranges shorthand declarations to their exact source text', () => {
    const style = inlineStyleOf(indexed, idOf(text, indexed, 'section'))
    expect(declarationTexts(text, style.declarations)).toEqual(['font: 600 14px/1.4 Inter, sans-serif', 'background: #fff7ed'])
    expect(style.line).toBe(20)
  })

  it('ranges each declaration of a multi-declaration style', () => {
    const style = inlineStyleOf(indexed, idOf(text, indexed, 'hr'))
    expect(declarationTexts(text, style.declarations)).toEqual(['border: 0', 'border-top: 1px solid #e7e5e4'])
    expect(style.line).toBe(23)
  })
})

describe('<helmet><style> rules', () => {
  it('finds a rule by selectorText and its order in the block, with no cascade sorting', () => {
    const { text, indexed } = indexHome()
    const page = ruleOf(indexed, '.page', 0)
    const narrow = ruleOf(indexed, '.page', 1)
    expect(authored(page.declarations)).toEqual([
      { prop: 'position', value: 'relative', important: false, hasHole: false },
      { prop: 'min-height', value: '900px', important: false, hasHole: false },
      { prop: 'padding', value: '48px', important: false, hasHole: false },
    ])
    expect(page.media).toBeNull()
    expect(authored(narrow.declarations)).toEqual([{ prop: 'padding', value: '24px', important: false, hasHole: false }])
    expect(narrow.media).toBe('(max-width: 720px)')
    expect(declarationTexts(text, narrow.declarations)).toEqual(['padding: 24px'])
    expect(narrow.id).not.toBe(page.id)
  })

  it('reports the selector, file and 1-based line of each rule', () => {
    const { indexed } = indexHome()
    const body = ruleOf(indexed, 'body')
    expect(body.selector).toBe('body')
    expect(body.file).toBe(HOME)
    expect(body.line).toBe(13)
    expect(ruleOf(indexed, '.page', 0).line).toBe(14)
    expect(ruleOf(indexed, '.page', 1).line).toBe(16)
  })

  it('finds nothing past the last matching rule or for an absent selector', () => {
    const { indexed } = indexHome()
    expect(indexed.findRule('.page', 2)).toBeNull()
    expect(indexed.findRule('.missing', 0)).toBeNull()
  })

  it('never targets CSS from a /_blob stylesheet', () => {
    const { indexed } = indexHome()
    expect(indexed.findRule('.hero', 0)).toBeNull()
  })
})

describe.each(VARIANTS)('<helmet><style> rules on edge.%s.dc.html', (variant) => {
  const text = readFixtureText(edgeFile(variant))
  const indexed = new SourceIndex().indexFile(EDGE, text)

  it('keeps var() case and !important as authored', () => {
    const note = ruleOf(indexed, '.note')
    expect(authored(note.declarations)).toEqual([
      { prop: 'color', value: 'var(--brandInk, #1c1917)', important: true, hasHole: false },
    ])
    expect(declarationTexts(text, note.declarations)).toEqual(['color: var(--brandInk, #1c1917) !important'])
    expect(note.line).toBe(14)
  })

  it('ranges declarations of a top-level and an @media rule with the same selector', () => {
    const sheet = ruleOf(indexed, '.sheet', 0)
    const wide = ruleOf(indexed, '.sheet', 1)
    expect(declarationTexts(text, sheet.declarations)).toEqual(['margin: 0 auto', 'padding: 12px 16px 20px'])
    expect(declarationTexts(text, wide.declarations)).toEqual(['border: 1px dashed #a8a29e'])
    expect([sheet.line, wide.line]).toEqual([13, 16])
    expect([sheet.media, wide.media]).toEqual([null, '(min-width: 600px)'])
  })
})
