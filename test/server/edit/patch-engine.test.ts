import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PatchEngine } from '../../../src/server/edit/patch-engine'
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
