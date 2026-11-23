import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PatchEngine } from '../../../src/server/edit/patch-engine'
import { STRUCTURAL_KINDS } from '../../../src/server/edit/structural-ops'
import { SourceIndex } from '../../../src/server/source/source-index'
import type { EdId, EditOp, EditPayloads, ProjectPath, RuleId, SourceRange } from '../../../src/shared/types'

type IndexedFile = ReturnType<SourceIndex['indexFile']>
type PatchOutcome = ReturnType<PatchEngine['apply']>
type AppliedOutcome = Extract<PatchOutcome, { ok: true }>

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url))
const HOME_FILE = path.join(FIXTURES, 'canvas', 'project', 'home.dc.html')
const EDGE_FILE = path.join(FIXTURES, 'endings', 'edge.lf.dc.html')

const HOME = 'project/home.dc.html' as ProjectPath
const EDGE = 'project/edge.dc.html' as ProjectPath
const SNIPPET = 'project/snippet.dc.html' as ProjectPath

function readFixtureText(file: string): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(readFileSync(file))
}

function canvas(body: string): string {
  return `<!doctype html>\n<html>\n<body>\n<x-dc>\n${body}\n</x-dc>\n</body>\n</html>\n`
}

function open(text: string, file = SNIPPET) {
  const index = new SourceIndex()
  const indexed = index.indexFile(file, text)
  let minted = 0
  const engine = new PatchEngine({ mintId: () => `minted${++minted}` as EdId })
  return { index, indexed, engine, text }
}

const openHome = () => open(readFixtureText(HOME_FILE), HOME)
const openEdge = () => open(readFixtureText(EDGE_FILE), EDGE)

function slice(text: string, range: SourceRange): string {
  return text.slice(range.start, range.end)
}

function startTagOf(indexed: IndexedFile, id: EdId): string {
  const location = indexed.locate(id)
  if (!location) throw new Error(`no location for ${id}`)
  return slice(indexed.text, location.startTag)
}

function findId(indexed: IndexedFile, startTag: RegExp, nth = 0): EdId {
  const id = indexed.ids.filter((candidate) => startTag.test(startTagOf(indexed, candidate)))[nth]
  if (!id) throw new Error(`no element whose start tag matches ${startTag} #${nth}`)
  return id
}

function applied(outcome: PatchOutcome): AppliedOutcome {
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`)
  return outcome
}

function refusalOf(outcome: PatchOutcome): string {
  if (outcome.ok) throw new Error('expected the flush to be refused, but it applied')
  return outcome.reason
}

function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from)
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`"${from}" must occur exactly once`)
  return text.slice(0, at) + to + text.slice(at + from.length)
}

function op<K extends keyof EditPayloads>(kind: K, target: readonly EdId[], payload: EditPayloads[K]): EditOp {
  return { kind, target, payload } as EditOp
}

const setDecl = (target: EdId, prop: string, value: string) => op('setDecl', [target], { prop, value })
const setRuleDecl = (target: EdId, rule: RuleId, prop: string, value: string) => op('setDecl', [target], { prop, value, rule })
const removeDecl = (target: EdId, prop: string) => op('removeDecl', [target], { prop })
const setAttr = (target: EdId, name: string, value: string) => op('setAttr', [target], { name, value })
const removeAttr = (target: EdId, name: string) => op('removeAttr', [target], { name })
const removeRuleDecl = (target: EdId, rule: RuleId, prop: string) => op('removeDecl', [target], { prop, rule })
const setText = (target: EdId, text: string) => op('setText', [target], { text })

describe('setDecl on an inline style', () => {
  it('replaces only the value span of an existing declaration', () => {
    const { indexed, engine, text } = openHome()
    const h1 = findId(indexed, /^<h1/)
    const outcome = applied(engine.apply(indexed, [setDecl(h1, 'font-size', '56px')]))
    expect(outcome.text).toBe(replaceOnce(text, 'style="margin: 0; font-size: 48px"', 'style="margin: 0; font-size: 56px"'))
  })

  it('keeps the spacing around an existing value as authored', () => {
    const { indexed, engine, text } = open(canvas('<div style="color :  red ;width:1px">x</div>'))
    const outcome = applied(engine.apply(indexed, [setDecl(findId(indexed, /^<div/), 'color', 'blue')]))
    expect(outcome.text).toBe(replaceOnce(text, 'color :  red ;width:1px', 'color :  blue ;width:1px'))
  })

  it('keeps an existing !important', () => {
    const { indexed, engine, text } = open(canvas('<table><tr><td style="padding: 4px 8px !important">a</td></tr></table>'))
    const outcome = applied(engine.apply(indexed, [setDecl(findId(indexed, /^<td/), 'padding', '2px')]))
    expect(outcome.text).toBe(replaceOnce(text, 'padding: 4px 8px !important', 'padding: 2px !important'))
  })

  it('appends a new declaration with the style\'s "; " separator', () => {
    const { indexed, engine, text } = openHome()
    const outcome = applied(engine.apply(indexed, [setDecl(findId(indexed, /^<h1/), 'font-weight', '800')]))
    expect(outcome.text).toBe(
      replaceOnce(text, 'style="margin: 0; font-size: 48px"', 'style="margin: 0; font-size: 48px; font-weight: 800"'),
    )
  })

  it('appends after a trailing semicolon and keeps the trailing semicolon', () => {
    const { indexed, engine, text } = open(canvas('<div style="color: red; width: 10px;">x</div>'))
    const outcome = applied(engine.apply(indexed, [setDecl(findId(indexed, /^<div/), 'height', '5px')]))
    expect(outcome.text).toBe(replaceOnce(text, 'color: red; width: 10px;"', 'color: red; width: 10px; height: 5px;"'))
  })

  it('appends to a compact style in the compact form', () => {
    const { indexed, engine, text } = open(canvas('<div style="color:red;width:10px">x</div>'))
    const outcome = applied(engine.apply(indexed, [setDecl(findId(indexed, /^<div/), 'height', '5px')]))
    expect(outcome.text).toBe(replaceOnce(text, 'style="color:red;width:10px"', 'style="color:red;width:10px;height:5px"'))
  })

  it('adds a style attribute to an element that has none', () => {
    const { indexed, engine, text } = open(canvas('<p class="a">x</p>'))
    const outcome = applied(engine.apply(indexed, [setDecl(findId(indexed, /^<p/), 'color', 'red')]))
    expect(outcome.text).toBe(replaceOnce(text, '<p class="a">', '<p class="a" style="color: red">'))
  })

  it('records the prop with its before and after values on the element', () => {
    const { indexed, engine } = openHome()
    const h1 = findId(indexed, /^<h1/)
    const outcome = applied(engine.apply(indexed, [setDecl(h1, 'font-size', '56px')]))
    expect(outcome.records).toEqual([
      { target: [h1], kind: 'setDecl', prop: 'font-size', before: '48px', after: '56px', scope: { kind: 'element' }, files: [HOME] },
    ])
  })

  it('records a new declaration with no before value', () => {
    const { indexed, engine } = openHome()
    const h1 = findId(indexed, /^<h1/)
    const [record] = applied(engine.apply(indexed, [setDecl(h1, 'font-weight', '800')])).records
    expect(record).toMatchObject({ prop: 'font-weight', before: null, after: '800' })
  })
})

describe('values a style attribute must hold verbatim', () => {
  it('writes the CSS strings of a value in single quotes inside a double-quoted style, so the re-index reads the same declaration', () => {
    const { index, indexed, engine, text } = openHome()
    const h1 = findId(indexed, /^<h1/)
    const outcome = applied(engine.apply(indexed, [setDecl(h1, 'font-family', '"Inter", "Helvetica Neue", sans-serif')]))
    expect(outcome.text).toBe(
      replaceOnce(text, 'style="margin: 0; font-size: 48px"', 'style="margin: 0; font-size: 48px; font-family: \'Inter\', \'Helvetica Neue\', sans-serif"'),
    )
    const declarations = index.indexFile(HOME, outcome.text, outcome.offsets).inlineStyle(h1)!.declarations
    expect(declarations.map(({ prop, value }) => [prop, value])).toEqual([
      ['margin', '0'],
      ['font-size', '48px'],
      ['font-family', "'Inter', 'Helvetica Neue', sans-serif"],
    ])
  })

  it('writes double-quoted CSS strings into a new style attribute without character references', () => {
    const { indexed, engine, text } = open(canvas('<p class="a">x</p>'))
    const outcome = applied(engine.apply(indexed, [setDecl(findId(indexed, /^<p/), 'font-family', '"Inter"')]))
    expect(outcome.text).toBe(replaceOnce(text, '<p class="a">', '<p class="a" style="font-family: \'Inter\'">'))
  })

  it('refuses a value that holds both quote kinds or a character reference', () => {
    const { indexed, engine } = openHome()
    const h1 = findId(indexed, /^<h1/)
    expect(engine.apply(indexed, [setDecl(h1, 'content', `"it's"`)]).ok).toBe(false)
    expect(engine.apply(indexed, [setDecl(h1, 'content', '"a&amp;b"')]).ok).toBe(false)
  })

  it('refuses a value that would add a second declaration', () => {
    const { indexed, engine } = openHome()
    expect(engine.apply(indexed, [setDecl(findId(indexed, /^<h1/), 'color', 'red; background: blue')]).ok).toBe(false)
  })
})

describe('several declarations for one element in one flush', () => {
  it.each([
    ['no style attribute', '<div class="a">x</div>', '<div class="a" style="width: 10px; height: 20px">x</div>'],
    ['an empty style attribute', '<div style="">x</div>', '<div style="width: 10px; height: 20px">x</div>'],
    ['a style without a trailing semicolon', '<div style="color: red">x</div>', '<div style="color: red; width: 10px; height: 20px">x</div>'],
    ['a style with a trailing semicolon', '<div style="color: red;">x</div>', '<div style="color: red; width: 10px; height: 20px;">x</div>'],
  ])('writes width and height into %s as one valid style', (_, before, after) => {
    const { index, indexed, engine, text } = open(canvas(before))
    const div = findId(indexed, /^<div/)
    const outcome = applied(engine.apply(indexed, [setDecl(div, 'width', '10px'), setDecl(div, 'height', '20px')]))
    expect(outcome.text).toBe(replaceOnce(text, before, after))
    const declarations = index.indexFile(SNIPPET, outcome.text, outcome.offsets).inlineStyle(div)!.declarations
    expect(declarations.map(({ prop }) => prop).slice(-2)).toEqual(['width', 'height'])
  })
})

describe('removeDecl on an inline style', () => {
  it('removes a middle declaration and its separator only', () => {
    const { indexed, engine, text } = openHome()
    const outcome = applied(engine.apply(indexed, [removeDecl(findId(indexed, /^<header/), 'padding')]))
    expect(outcome.text).toBe(
      replaceOnce(text, 'color: #fff7ed; padding: 24px 32px; border-radius: 12px', 'color: #fff7ed; border-radius: 12px'),
    )
  })

  it('removes the first declaration and the separator after it', () => {
    const { indexed, engine, text } = openHome()
    const outcome = applied(engine.apply(indexed, [removeDecl(findId(indexed, /^<h1/), 'margin')]))
    expect(outcome.text).toBe(replaceOnce(text, 'style="margin: 0; font-size: 48px"', 'style="font-size: 48px"'))
  })

  it('removes the last declaration and the separator before it', () => {
    const { indexed, engine, text } = openHome()
    const outcome = applied(engine.apply(indexed, [removeDecl(findId(indexed, /^<h1/), 'font-size')]))
    expect(outcome.text).toBe(replaceOnce(text, 'style="margin: 0; font-size: 48px"', 'style="margin: 0"'))
  })

  it('records the removed value with no after value', () => {
    const { indexed, engine } = openHome()
    const h1 = findId(indexed, /^<h1/)
    const [record] = applied(engine.apply(indexed, [removeDecl(h1, 'margin')])).records
    expect(record).toMatchObject({ target: [h1], kind: 'removeDecl', prop: 'margin', before: '0', after: null })
  })
})

describe('{{ holes }} and <dc-import>', () => {
  it('edits a non-hole declaration in a style that also holds a hole and changes nothing else', () => {
    const { indexed, engine, text } = openHome()
    const outcome = applied(engine.apply(indexed, [setDecl(findId(indexed, /^<header/), 'color', '#000000')]))
    expect(outcome.text).toBe(replaceOnce(text, '; color: #fff7ed;', '; color: #000000;'))
  })

  it('refuses to set a declaration whose value is a hole, with the live-value hint', () => {
    const { indexed, engine } = openHome()
    const reason = refusalOf(engine.apply(indexed, [setDecl(findId(indexed, /^<header/), 'background-color', '#000000')]))
    expect(reason).toMatch(/live value/)
  })

  it('refuses to remove a declaration whose value is a hole', () => {
    const { indexed, engine } = openHome()
    expect(refusalOf(engine.apply(indexed, [removeDecl(findId(indexed, /^<header/), 'background-color')]))).toMatch(/live value/)
  })

  it('refuses setText on text that mixes literal text with a hole', () => {
    const { indexed, engine } = open(canvas('<p x="a {{p}} b">Hello {{name}}</p>'))
    expect(refusalOf(engine.apply(indexed, [setText(findId(indexed, /^<p/), 'Hello Ron')]))).toMatch(/live value/)
  })

  it('refuses setAttr on a value that mixes literal text with a hole', () => {
    const { indexed, engine } = open(canvas('<p x="a {{p}} b">Hello {{name}}</p>'))
    expect(refusalOf(engine.apply(indexed, [setAttr(findId(indexed, /^<p/), 'x', 'a b')]))).toMatch(/live value/)
  })

  it('refuses setAttr on the canvas aria-label that holds a hole', () => {
    const { indexed, engine } = openHome()
    const p = findId(indexed, /^<p aria-label/)
    expect(refusalOf(engine.apply(indexed, [setAttr(p, 'aria-label', 'Issue 1')]))).toMatch(/live value/)
  })

  it('refuses any edit on a <dc-import> or inside it', () => {
    const { indexed, engine } = open(canvas('<dc-import src="./card.dc.html"><div style="color: red">x</div></dc-import>'))
    const dcImport = findId(indexed, /^<dc-import/)
    const inner = findId(indexed, /^<div/)
    expect(engine.apply(indexed, [setAttr(dcImport, 'src', './other.dc.html')]).ok).toBe(false)
    expect(engine.apply(indexed, [setDecl(dcImport, 'color', 'blue')]).ok).toBe(false)
    expect(engine.apply(indexed, [setDecl(inner, 'color', 'blue')]).ok).toBe(false)
    expect(engine.apply(indexed, [setText(inner, 'y')]).ok).toBe(false)
  })

  it('applies none of a flush when one of its ops is refused', () => {
    const { indexed, engine } = openHome()
    const outcome = engine.apply(indexed, [
      setDecl(findId(indexed, /^<main/), 'color', '#000000'),
      setText(findId(indexed, /^<p aria-label/), 'Hello Ron'),
    ])
    expect(outcome.ok).toBe(false)
    expect('text' in outcome).toBe(false)
  })
})

describe('<sc-for> template children', () => {
  it('writes an edit to a repeated child on the template node and scopes the record to its repeats', () => {
    const { indexed, engine, text } = openHome()
    const li = findId(indexed, /^<li\b/)
    const outcome = applied(engine.apply(indexed, [setDecl(li, 'padding', '4px 0')]))
    expect(outcome.text).toBe(replaceOnce(text, 'style="padding: 8px 0;', 'style="padding: 4px 0;'))
    expect(outcome.records[0]?.scope.kind).toBe('repeats')
  })

  it('scopes an edit outside any <sc-for> to the element', () => {
    const { indexed, engine } = openHome()
    const outcome = applied(engine.apply(indexed, [setDecl(findId(indexed, /^<ul/), 'padding', '4px')]))
    expect(outcome.records[0]?.scope).toEqual({ kind: 'element' })
  })
})

describe('<helmet><style> rule target', () => {
  it('writes into the rule picked by selectorText and order, not the inline style', () => {
    const { indexed, engine, text } = openHome()
    const rule = indexed.findRule('.page', 0)!.id
    const outcome = applied(engine.apply(indexed, [setRuleDecl(findId(indexed, /^<main/), rule, 'padding', '40px')]))
    expect(outcome.text).toBe(replaceOnce(text, 'min-height: 900px; padding: 48px;', 'min-height: 900px; padding: 40px;'))
  })

  it('writes into the @media rule when that order is picked', () => {
    const { indexed, engine, text } = openHome()
    const rule = indexed.findRule('.page', 1)!.id
    const outcome = applied(engine.apply(indexed, [setRuleDecl(findId(indexed, /^<main/), rule, 'padding', '12px')]))
    expect(outcome.text).toBe(replaceOnce(text, '.page { padding: 24px; }', '.page { padding: 12px; }'))
  })

  it('scopes the record to the rule', () => {
    const { indexed, engine } = openHome()
    const rule = indexed.findRule('.page', 0)!.id
    const main = findId(indexed, /^<main/)
    const [record] = applied(engine.apply(indexed, [setRuleDecl(main, rule, 'padding', '40px')])).records
    expect(record).toMatchObject({ target: [main], prop: 'padding', before: '48px', after: '40px', scope: { kind: 'rule', rule } })
  })

  it('refuses a rule that is not in the file\'s <helmet><style>, as /_blob CSS never is', () => {
    const { indexed, engine } = openHome()
    const outcome = engine.apply(indexed, [setRuleDecl(findId(indexed, /^<main/), 'r-blob' as RuleId, 'padding', '40px')])
    expect(outcome.ok).toBe(false)
  })
})

describe('injection into a <helmet><style> rule', () => {
  const ruleOf = (indexed: IndexedFile) => indexed.findRule('.page', 0)!.id

  it.each(['padding;color', 'padding:1px;color', 'pad ding', '}body{color'])('refuses the property name %j', (prop) => {
    const { indexed, engine } = openHome()
    expect(engine.apply(indexed, [setRuleDecl(findId(indexed, /^<main/), ruleOf(indexed), prop, '1px')]).ok).toBe(false)
  })

  it.each(['1px; color: red', '1px } body { color: red', '1px {', '"</StYlE><script>x()</script>"'])('refuses the value %j', (value) => {
    const { indexed, engine } = openHome()
    expect(engine.apply(indexed, [setRuleDecl(findId(indexed, /^<main/), ruleOf(indexed), 'padding', value)]).ok).toBe(false)
  })

  it('takes a custom property name', () => {
    const { indexed, engine, text } = openHome()
    const outcome = applied(engine.apply(indexed, [setRuleDecl(findId(indexed, /^<main/), ruleOf(indexed), '--gap', '4px')]))
    expect(outcome.text).toContain('--gap: 4px')
    expect(outcome.text.length).toBe(text.length + '; --gap: 4px'.length)
  })
})

describe('multi-target setDecl', () => {
  it('writes each target\'s own inline style and yields one record for all of them', () => {
    const { indexed, engine, text } = openHome()
    const cols = [0, 1, 2].map((nth) => findId(indexed, /^<div class="col"/, nth))
    const outcome = applied(engine.apply(indexed, [op('setDecl', cols, { prop: 'width', value: '200px' })]))
    let expected = text
    for (const width of ['240px', '360px', '480px']) expected = replaceOnce(expected, `width: ${width}`, 'width: 200px')
    expect(outcome.text).toBe(expected)
    expect(outcome.records).toHaveLength(1)
    expect(outcome.records[0]).toMatchObject({ target: cols, kind: 'setDecl', prop: 'width', after: '200px' })
  })
})

describe('setAttr', () => {
  it('replaces an existing attribute value and records it', () => {
    const { indexed, engine, text } = openHome()
    const img = findId(indexed, /^<img/)
    const outcome = applied(engine.apply(indexed, [setAttr(img, 'alt', 'Logo')]))
    expect(outcome.text).toBe(replaceOnce(text, 'alt="Studio mark"', 'alt="Logo"'))
    expect(outcome.records[0]).toMatchObject({ target: [img], kind: 'setAttr', prop: 'alt', before: 'Studio mark', after: 'Logo' })
  })

  it.each(['onclick="x()" title', 'a b', 'x>', '"', "it's", 'a=b', 'a/b', ''])('refuses the attribute name %j', (name) => {
    const { indexed, engine } = open(canvas('<p class="a">x</p>'))
    expect(refusalOf(engine.apply(indexed, [setAttr(findId(indexed, /^<p/), name, 'v')]))).toMatch(/not an attribute name/)
  })

  it('takes data- and aria- attribute names', () => {
    const { indexed, engine, text } = open(canvas('<p class="a">x</p>'))
    const outcome = applied(engine.apply(indexed, [setAttr(findId(indexed, /^<p/), 'data-x:y.z', 'v')]))
    expect(outcome.text).toBe(replaceOnce(text, '<p class="a">', '<p class="a" data-x:y.z="v">'))
  })

  it('adds an attribute the element does not have', () => {
    const { indexed, engine, text } = open(canvas('<p class="a">x</p>'))
    const outcome = applied(engine.apply(indexed, [setAttr(findId(indexed, /^<p/), 'title', 'Note')]))
    expect(outcome.text).toBe(replaceOnce(text, '<p class="a">', '<p class="a" title="Note">'))
  })
})

describe('setText', () => {
  it('splices only the changed span and keeps an untouched entity spelling', () => {
    const { indexed, engine, text } = openEdge()
    const h2 = findId(indexed, /^<h2/)
    const outcome = applied(engine.apply(indexed, [setText(h2, 'Tom\u2019s field notes')]))
    expect(outcome.text).toBe(replaceOnce(text, '>Tom&#8217;s notes<', '>Tom&#8217;s field notes<'))
  })

  it('replaces a whole entity when the character it spells changes', () => {
    const { indexed, engine, text } = openEdge()
    const outcome = applied(engine.apply(indexed, [setText(findId(indexed, /^<h2/), "Tom's notes")]))
    expect(outcome.text).toBe(replaceOnce(text, '>Tom&#8217;s notes<', ">Tom's notes<"))
  })

  it('keeps &amp; and &#38; spellings outside the changed span', () => {
    const { indexed, engine, text } = open(canvas('<p>Salt &amp; pepper</p>\n<h3>A &#38; B</h3>'))
    const outcome = applied(
      engine.apply(indexed, [setText(findId(indexed, /^<p/), 'Salt & pepper, please'), setText(findId(indexed, /^<h3/), 'A & B!')]),
    )
    expect(outcome.text).toBe(replaceOnce(replaceOnce(text, 'pepper</p>', 'pepper, please</p>'), 'B</h3>', 'B!</h3>'))
  })

  it('encodes only &, < and non-breaking spaces in the new characters', () => {
    const { indexed, engine, text } = open(canvas('<p>old</p>'))
    const outcome = applied(engine.apply(indexed, [setText(findId(indexed, /^<p/), 'Salt & <b>\u00a0"x" > y\'s')]))
    expect(outcome.text).toBe(replaceOnce(text, '<p>old</p>', '<p>Salt &amp; &lt;b>&nbsp;"x" > y\'s</p>'))
  })

  it('keeps the CRLF line breaks of a multi-line text in a CRLF file and writes new ones as CRLF', () => {
    const { indexed, engine, text } = open(canvas('<p>first line\nsecond line</p>').replace(/\n/g, '\r\n'))
    const outcome = applied(engine.apply(indexed, [setText(findId(indexed, /^<p/), 'first line\nsecond line\nthird line')]))
    expect(outcome.text).toBe(replaceOnce(text, 'second line</p>', 'second line\r\nthird line</p>'))
  })

  it('leaves a CRLF file byte-identical when the text does not change', () => {
    const { indexed, engine, text } = open(canvas('<p>first line\nsecond line</p>').replace(/\n/g, '\r\n'))
    const outcome = applied(engine.apply(indexed, [setText(findId(indexed, /^<p/), 'first line\nsecond line')]))
    expect(outcome.text).toBe(text)
    expect(outcome.offsets).toEqual(indexed.startOffsets())
  })

  it('records the source text before and the new text after', () => {
    const { indexed, engine } = openEdge()
    const h2 = findId(indexed, /^<h2/)
    const [record] = applied(engine.apply(indexed, [setText(h2, 'Tom\u2019s field notes')])).records
    expect(record).toMatchObject({ target: [h2], kind: 'setText', before: 'Tom\u2019s notes', after: 'Tom\u2019s field notes' })
  })

  it('refuses an element with inline children with the edit-in-source hint', () => {
    const { indexed, engine } = openHome()
    expect(refusalOf(engine.apply(indexed, [setText(findId(indexed, /^<p class="lede"/), 'Plain')]))).toMatch(/edit in source/)
  })

  it('refuses an element with a <br> among its children', () => {
    const { indexed, engine } = openEdge()
    expect(refusalOf(engine.apply(indexed, [setText(findId(indexed, /^<p/), 'Plain')]))).toMatch(/edit in source/)
  })
})

describe('one flush', () => {
  it('applies every op of a flush against the original offsets', () => {
    const { indexed, engine, text } = openHome()
    const h1 = findId(indexed, /^<h1/)
    const outcome = applied(
      engine.apply(indexed, [
        setDecl(findId(indexed, /^<main/), 'color', '#000000'),
        setText(h1, 'Studio Daily'),
        removeDecl(h1, 'margin'),
        setAttr(findId(indexed, /^<img/), 'alt', 'Logo'),
      ]),
    )
    let expected = replaceOnce(text, '<main class="page" style="color: #1c1917">', '<main class="page" style="color: #000000">')
    expected = replaceOnce(expected, '<h1 style="margin: 0; font-size: 48px">Studio Weekly</h1>', '<h1 style="font-size: 48px">Studio Daily</h1>')
    expected = replaceOnce(expected, 'alt="Studio mark"', 'alt="Logo"')
    expect(outcome.text).toBe(expected)
    expect(outcome.records.map((record) => record.kind)).toEqual(['setDecl', 'setText', 'removeDecl', 'setAttr'])
  })

  it('treats two patches over the same source span as an error', () => {
    const { indexed, engine } = openHome()
    const flush = [op('deleteNode', [findId(indexed, /^<header/)], {}), setDecl(findId(indexed, /^<h1/), 'color', 'red')]
    expect(() => engine.apply(indexed, flush)).toThrow(/overlap/i)
  })

  it('returns the original text for an empty flush', () => {
    const { indexed, engine, text } = openHome()
    const outcome = applied(engine.apply(indexed, []))
    expect(outcome.text).toBe(text)
    expect(outcome.records).toEqual([])
  })
})

describe('edId -> start offset map', () => {
  it('shifts the offsets after an edit by its delta and leaves earlier offsets alone', () => {
    const { indexed, engine } = openHome()
    const h1 = findId(indexed, /^<h1/)
    const outcome = applied(engine.apply(indexed, [setDecl(h1, 'font-size', '128px')]))
    const before = indexed.startOffsets()
    const h1Start = before.get(h1)!
    for (const [id, offset] of before) {
      expect(outcome.offsets.get(id)).toBe(offset > h1Start ? offset + 1 : offset)
    }
  })

  it('binds every id to the same element when the result is re-indexed with the map', () => {
    const { index, indexed, engine } = openHome()
    const main = findId(indexed, /^<main/)
    const outcome = applied(engine.apply(indexed, [setDecl(main, 'color', '#0a0a0a0a'), setText(findId(indexed, /^<h1/), 'Hi')]))
    const reindexed = index.indexFile(HOME, outcome.text, outcome.offsets)
    expect([...reindexed.ids].sort()).toEqual([...indexed.ids].sort())
    for (const id of indexed.ids) {
      if (id === main) continue
      expect(startTagOf(reindexed, id)).toBe(startTagOf(indexed, id))
    }
    expect(startTagOf(reindexed, main)).toBe('<main class="page" style="color: #0a0a0a0a">')
  })

  it('mints no ids and warns about nothing for a style edit', () => {
    const { indexed, engine } = openHome()
    const outcome = applied(engine.apply(indexed, [setDecl(findId(indexed, /^<h1/), 'font-size', '56px')]))
    expect(outcome.minted).toEqual([])
    expect(outcome.warnings).toEqual([])
  })
})

describe('removeAttr', () => {
  it('deletes the attribute with the whitespace before it', () => {
    const { indexed, engine, text } = open(canvas('<p class="a" title="Note">x</p>'))
    const outcome = applied(engine.apply(indexed, [removeAttr(findId(indexed, /^<p/), 'title')]))
    expect(outcome.text).toBe(replaceOnce(text, '<p class="a" title="Note">', '<p class="a">'))
  })

  it('takes a line break before the attribute with it', () => {
    const { indexed, engine, text } = open(canvas('<p class="a"\n   title="Note">x</p>'))
    const outcome = applied(engine.apply(indexed, [removeAttr(findId(indexed, /^<p/), 'title')]))
    expect(outcome.text).toBe(replaceOnce(text, '<p class="a"\n   title="Note">', '<p class="a">'))
  })

  it('deletes a bare attribute', () => {
    const { indexed, engine, text } = open(canvas('<button class="b" disabled>Go</button>'))
    const outcome = applied(engine.apply(indexed, [removeAttr(findId(indexed, /^<button/), 'disabled')]))
    expect(outcome.text).toBe(replaceOnce(text, '<button class="b" disabled>', '<button class="b">'))
  })

  it('restores the file byte-for-byte after removing what setAttr added', () => {
    const { index, indexed, engine, text } = open(canvas('<p class="a">x</p>'))
    const p = findId(indexed, /^<p/)
    const added = applied(engine.apply(indexed, [setAttr(p, 'data-layer-name', 'Intro')]))
    const reindexed = index.indexFile(SNIPPET, added.text, added.offsets)
    expect(applied(engine.apply(reindexed, [removeAttr(p, 'data-layer-name')])).text).toBe(text)
  })

  it('leaves the file as it is when the attribute is absent', () => {
    const { indexed, engine, text } = open(canvas('<p class="a">x</p>'))
    expect(applied(engine.apply(indexed, [removeAttr(findId(indexed, /^<p/), 'title')])).text).toBe(text)
  })

  it('records the removed value with no after value', () => {
    const { indexed, engine } = openHome()
    const img = findId(indexed, /^<img/)
    const [record] = applied(engine.apply(indexed, [removeAttr(img, 'alt')])).records
    expect(record).toMatchObject({ target: [img], kind: 'removeAttr', prop: 'alt', before: 'Studio mark', after: null })
  })

  it('clears the artboard root\'s layer name', () => {
    const text = '<!doctype html>\n<html>\n<body>\n<x-dc data-layer-name="Home">\n<section>s</section>\n</x-dc>\n</body>\n</html>\n'
    const { indexed, engine } = open(text)
    const outcome = applied(engine.apply(indexed, [removeAttr(indexed.tree!.edId, 'data-layer-name')]))
    expect(outcome.text).toBe(replaceOnce(text, '<x-dc data-layer-name="Home">', '<x-dc>'))
  })

  it('is not a structural kind', () => {
    expect(STRUCTURAL_KINDS.has('removeAttr')).toBe(false)
  })

  it('refuses an attribute that holds a hole, with the live-value hint', () => {
    const { indexed, engine } = open(canvas('<p x="a {{p}} b">Hello</p>'))
    expect(refusalOf(engine.apply(indexed, [removeAttr(findId(indexed, /^<p/), 'x')]))).toMatch(/live value/)
  })

  it('refuses a layer inside a <dc-import>', () => {
    const { indexed, engine } = open(canvas('<dc-import src="./card.dc.html"><div title="t">x</div></dc-import>'))
    expect(engine.apply(indexed, [removeAttr(findId(indexed, /^<div/), 'title')]).ok).toBe(false)
  })

  it('refuses a layer that is gone', () => {
    const { indexed, engine } = open(canvas('<p class="a">x</p>'))
    expect(refusalOf(engine.apply(indexed, [removeAttr('e9999' as EdId, 'class')]))).toMatch(/gone/)
  })
})

describe('several declaration ops on one inline style in one flush', () => {
  const THREE = '<div style="width: 10px; height: 20px; color: red">x</div>'

  function flush(before: string, ops: (div: EdId) => EditOp[]) {
    const { indexed, engine, text } = open(canvas(before))
    const outcome = applied(engine.apply(indexed, ops(findId(indexed, /^<div/))))
    return { outcome, text }
  }

  it('removes the last two of three', () => {
    const { outcome, text } = flush(THREE, (div) => [removeDecl(div, 'height'), removeDecl(div, 'color')])
    expect(outcome.text).toBe(replaceOnce(text, THREE, '<div style="width: 10px">x</div>'))
  })

  it('removes all of two', () => {
    const before = '<div style="width: 10px; height: 20px">x</div>'
    const { outcome, text } = flush(before, (div) => [removeDecl(div, 'width'), removeDecl(div, 'height')])
    expect(outcome.text).toBe(replaceOnce(text, before, '<div style="">x</div>'))
  })

  it('removes the only declaration and sets the four corner longhands with no leading separator', () => {
    const before = '<div style="border-radius: 4px">x</div>'
    const { outcome, text } = flush(before, (div) => [
      removeDecl(div, 'border-radius'),
      setDecl(div, 'border-top-left-radius', '1px'),
      setDecl(div, 'border-top-right-radius', '2px'),
      setDecl(div, 'border-bottom-right-radius', '3px'),
      setDecl(div, 'border-bottom-left-radius', '4px'),
    ])
    expect(outcome.text).toBe(
      replaceOnce(
        text,
        before,
        '<div style="border-top-left-radius: 1px; border-top-right-radius: 2px; border-bottom-right-radius: 3px; border-bottom-left-radius: 4px">x</div>',
      ),
    )
  })

  it('starts a compact list afresh in its compact form', () => {
    const before = '<div style="border-radius:4px">x</div>'
    const { outcome, text } = flush(before, (div) => [
      removeDecl(div, 'border-radius'),
      setDecl(div, 'border-top-left-radius', '1px'),
      setDecl(div, 'border-bottom-left-radius', '2px'),
    ])
    expect(outcome.text).toBe(replaceOnce(text, before, '<div style="border-top-left-radius:1px;border-bottom-left-radius:2px">x</div>'))
  })

  it('removes all of two and sets two new declarations', () => {
    const before = '<div style="width: 10px; height: 20px">x</div>'
    const { outcome, text } = flush(before, (div) => [
      removeDecl(div, 'width'),
      removeDecl(div, 'height'),
      setDecl(div, 'flex-grow', '1'),
      setDecl(div, 'align-self', 'stretch'),
    ])
    expect(outcome.text).toBe(replaceOnce(text, before, '<div style="flex-grow: 1; align-self: stretch">x</div>'))
  })

  it('removes one declaration while setting another', () => {
    const { outcome, text } = flush(THREE, (div) => [removeDecl(div, 'width'), setDecl(div, 'color', 'blue')])
    expect(outcome.text).toBe(replaceOnce(text, THREE, '<div style="height: 20px; color: blue">x</div>'))
  })

  it('removes the last declaration while appending a new one', () => {
    const { outcome, text } = flush(THREE, (div) => [removeDecl(div, 'color'), setDecl(div, 'opacity', '0.5')])
    expect(outcome.text).toBe(replaceOnce(text, THREE, '<div style="width: 10px; height: 20px; opacity: 0.5">x</div>'))
  })

  it('removes the first and last of three while setting the middle one', () => {
    const { outcome, text } = flush(THREE, (div) => [removeDecl(div, 'width'), removeDecl(div, 'color'), setDecl(div, 'height', '30px')])
    expect(outcome.text).toBe(replaceOnce(text, THREE, '<div style="height: 30px">x</div>'))
  })

  it('keeps the bytes of an untouched declaration and the trailing semicolon', () => {
    const before = '<div style="width:10px;height : 20px;color:red;">x</div>'
    const { outcome, text } = flush(before, (div) => [removeDecl(div, 'width'), removeDecl(div, 'color')])
    expect(outcome.text).toBe(replaceOnce(text, before, '<div style="height : 20px;">x</div>'))
  })

  it('sets one value and appends another', () => {
    const before = '<div style="width: 10px; height: 20px">x</div>'
    const { outcome, text } = flush(before, (div) => [setDecl(div, 'width', '5px'), setDecl(div, 'color', 'red')])
    expect(outcome.text).toBe(replaceOnce(text, before, '<div style="width: 5px; height: 20px; color: red">x</div>'))
  })

  it('records each op with the value it had', () => {
    const { outcome } = flush(THREE, (div) => [removeDecl(div, 'height'), removeDecl(div, 'color')])
    expect(outcome.records.map(({ kind, prop, before, after }) => ({ kind, prop, before, after }))).toEqual([
      { kind: 'removeDecl', prop: 'height', before: '20px', after: null },
      { kind: 'removeDecl', prop: 'color', before: 'red', after: null },
    ])
  })

  it('binds every id to the same element after a coalesced splice', () => {
    const { index, indexed, engine } = open(canvas(`${THREE}\n<p style="margin: 0">y</p>`))
    const div = findId(indexed, /^<div/)
    const outcome = applied(engine.apply(indexed, [removeDecl(div, 'height'), removeDecl(div, 'color')]))
    const reindexed = index.indexFile(SNIPPET, outcome.text, outcome.offsets)
    expect(startTagOf(reindexed, div)).toBe('<div style="width: 10px">')
    expect(startTagOf(reindexed, findId(indexed, /^<p/))).toBe('<p style="margin: 0">')
  })
})

describe('removeAttr and coalesced declaration lists in CRLF and BOM files', () => {
  const MULTI_LINE = [
    '<helmet><style>',
    '.box {',
    '  width: 1px;',
    '  height: 2px;',
    '  color: red;',
    '}',
    '</style></helmet>',
    '<div class="box" style="width: 10px;',
    '  height: 20px;',
    '  color: red">x</div>',
  ].join('\n')

  interface Ending {
    readonly eol: string
    readonly bom: boolean
  }

  /** Opens `body` in a file with `ending`; `expected` is the LF body after the edit, compared in the same ending. */
  function edited({ eol, bom }: Ending, body: string, ops: (indexed: IndexedFile) => EditOp[], expected: string) {
    const withEol = (lf: string) => lf.replace(/\n/g, eol)
    const { indexed, engine, text } = open(`${bom ? '\uFEFF' : ''}${withEol(canvas(body))}`)
    const outcome = applied(engine.apply(indexed, ops(indexed)))
    expect(outcome.text).toBe(replaceOnce(text, withEol(body), withEol(expected)))
  }

  const ENDINGS: readonly (readonly [string, Ending])[] = [
    ['CRLF', { eol: '\r\n', bom: false }],
    ['BOM', { eol: '\n', bom: true }],
  ]

  it.each(ENDINGS)('removeAttr deletes the attribute with the whitespace before it (%s)', (_case, ending) => {
    edited(ending, '<p class="a" title="Note">x</p>', (indexed) => [removeAttr(findId(indexed, /^<p/), 'title')], '<p class="a">x</p>')
  })

  it.each(ENDINGS)('removeAttr takes the line break before the attribute with it (%s)', (_case, ending) => {
    edited(ending, '<p class="a"\n   title="Note">x</p>', (indexed) => [removeAttr(findId(indexed, /^<p/), 'title')], '<p class="a">x</p>')
  })

  it.each(ENDINGS)('removes two of three inline declarations in one splice (%s)', (_case, ending) => {
    const three = '<div style="width: 10px; height: 20px; color: red">x</div>'
    const div = (indexed: IndexedFile) => findId(indexed, /^<div/)
    edited(ending, three, (indexed) => [removeDecl(div(indexed), 'height'), removeDecl(div(indexed), 'color')], '<div style="width: 10px">x</div>')
  })

  it.each(ENDINGS)('removes and appends declarations across lines of a rule and an inline style (%s)', (_case, ending) => {
    edited(
      ending,
      MULTI_LINE,
      (indexed) => {
        const div = findId(indexed, /^<div/)
        const rule = indexed.findRule('.box', 0)!.id
        return [
          removeRuleDecl(div, rule, 'height'),
          removeRuleDecl(div, rule, 'color'),
          setRuleDecl(div, rule, 'opacity', '0.5'),
          removeDecl(div, 'height'),
          setDecl(div, 'opacity', '0.5'),
        ]
      },
      MULTI_LINE.replace('  height: 2px;\n  color: red;\n', '  opacity: 0.5;\n').replace(
        'width: 10px;\n  height: 20px;\n  color: red"',
        'width: 10px;\n  color: red;\n  opacity: 0.5"',
      ),
    )
  })

  it.each(ENDINGS)('replaces every declaration of a multi-line rule with two new ones (%s)', (_case, ending) => {
    edited(
      ending,
      MULTI_LINE,
      (indexed) => {
        const div = findId(indexed, /^<div/)
        const rule = indexed.findRule('.box', 0)!.id
        return [
          removeRuleDecl(div, rule, 'width'),
          removeRuleDecl(div, rule, 'height'),
          removeRuleDecl(div, rule, 'color'),
          setRuleDecl(div, rule, 'flex-grow', '1'),
          setRuleDecl(div, rule, 'align-self', 'stretch'),
        ]
      },
      MULTI_LINE.replace('  width: 1px;\n  height: 2px;\n  color: red;\n', '  flex-grow: 1;\n  align-self: stretch;\n'),
    )
  })
})

describe('several declaration ops on one rule in one flush', () => {
  it('removes the last two of three declarations of a rule and keeps its trailing semicolon', () => {
    const { indexed, engine, text } = openHome()
    const rule = indexed.findRule('.page', 0)!.id
    const main = findId(indexed, /^<main/)
    const outcome = applied(engine.apply(indexed, [removeRuleDecl(main, rule, 'min-height'), removeRuleDecl(main, rule, 'padding')]))
    expect(outcome.text).toBe(
      replaceOnce(text, '.page { position: relative; min-height: 900px; padding: 48px; }', '.page { position: relative; }'),
    )
  })

  it('replaces a rule\'s only declaration with the four corner longhands', () => {
    const { indexed, engine, text } = open(canvas('<helmet><style>.box { border-radius: 4px; }</style></helmet>\n<div class="box">x</div>'))
    const rule = indexed.findRule('.box', 0)!.id
    const div = findId(indexed, /^<div/)
    const outcome = applied(
      engine.apply(indexed, [
        removeRuleDecl(div, rule, 'border-radius'),
        setRuleDecl(div, rule, 'border-top-left-radius', '1px'),
        setRuleDecl(div, rule, 'border-top-right-radius', '2px'),
        setRuleDecl(div, rule, 'border-bottom-right-radius', '3px'),
        setRuleDecl(div, rule, 'border-bottom-left-radius', '4px'),
      ]),
    )
    expect(outcome.text).toBe(
      replaceOnce(
        text,
        '.box { border-radius: 4px; }',
        '.box { border-top-left-radius: 1px; border-top-right-radius: 2px; border-bottom-right-radius: 3px; border-bottom-left-radius: 4px; }',
      ),
    )
  })

  it('folds a rule and an inline style of the same element as two separate lists', () => {
    const { indexed, engine, text } = openHome()
    const rule = indexed.findRule('.page', 0)!.id
    const main = findId(indexed, /^<main/)
    const outcome = applied(
      engine.apply(indexed, [removeRuleDecl(main, rule, 'min-height'), removeRuleDecl(main, rule, 'padding'), setDecl(main, 'color', '#000000')]),
    )
    let expected = replaceOnce(text, '.page { position: relative; min-height: 900px; padding: 48px; }', '.page { position: relative; }')
    expected = replaceOnce(expected, 'style="color: #1c1917"', 'style="color: #000000"')
    expect(outcome.text).toBe(expected)
  })
})
