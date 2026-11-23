import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PatchEngine } from '../../../src/server/edit/patch-engine'
import { SourceIndex } from '../../../src/server/source/source-index'
import { nestingViolation } from '../../../src/shared/content-model'
import type { EdId, EditOp, EditPayloads, InlineDeclaration, ProjectPath, SourceRange, TemplateNode } from '../../../src/shared/types'

type IndexedFile = ReturnType<SourceIndex['indexFile']>
type PatchOutcome = ReturnType<PatchEngine['apply']>
type AppliedOutcome = Extract<PatchOutcome, { ok: true }>

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url))
const HOME_FILE = path.join(FIXTURES, 'canvas', 'project', 'home.dc.html')
const EDGE_FILE = (ending: 'lf' | 'crlf' | 'bom') => path.join(FIXTURES, 'endings', `edge.${ending}.dc.html`)

const HOME = 'project/home.dc.html' as ProjectPath
const SNIPPET = 'project/snippet.dc.html' as ProjectPath

const COL_BRIEF = '      <div class="col" style="width: 240px; padding: 16px">Brief</div>\n'
const COL_SKETCHES = '      <div class="col" style="width: 360px; padding: 16px">Sketches</div>\n'
const COL_FINAL = '      <div class="col" style="width: 480px; padding: 16px; transform: rotate(-2deg)">Final boards</div>\n'

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
  const reindex = (outcome: AppliedOutcome) => index.indexFile(file, outcome.text, outcome.offsets)
  return { indexed, engine, text, reindex }
}

const openHome = () => open(readFixtureText(HOME_FILE), HOME)

function slice(text: string, range: SourceRange): string {
  return text.slice(range.start, range.end)
}

function rangeOf(indexed: IndexedFile, id: EdId): SourceRange {
  const location = indexed.locate(id)
  if (!location) throw new Error(`no location for ${id}`)
  return location.element
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

function rowOf(indexed: IndexedFile, id: EdId): TemplateNode {
  const rows = (node: TemplateNode): TemplateNode[] => [node, ...node.children.flatMap(rows)]
  if (!indexed.tree) throw new Error('no template tree')
  const row = rows(indexed.tree).find((node) => node.edId === id)
  if (!row) throw new Error(`no row for ${id}`)
  return row
}

function childIdsOf(indexed: IndexedFile, id: EdId): EdId[] {
  return rowOf(indexed, id).children.map((child) => child.edId)
}

function applied(outcome: PatchOutcome): AppliedOutcome {
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`)
  return outcome
}

function refusalOf(outcome: PatchOutcome): string {
  if (outcome.ok) throw new Error('expected the op to be refused, but it applied')
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

const moveNode = (target: EdId, parent: EdId, before: EdId | null) => op('moveNode', [target], { parent, before })
const wrapNode = (target: readonly EdId[], tag: string, style?: readonly InlineDeclaration[]) =>
  op('wrapNode', target, style ? { tag, style } : { tag })
const insertHtml = (parent: EdId, before: EdId | null, html: string) => op('insertHtml', [parent], { before, html })
const unwrapNode = (target: EdId) => op('unwrapNode', [target], {})
const duplicateNode = (target: EdId) => op('duplicateNode', [target], {})
const deleteNode = (target: EdId) => op('deleteNode', [target], {})

function expectOneLineReason(reason: string, ...mentions: string[]): void {
  expect(reason).not.toMatch(/\n/)
  for (const mention of mentions) expect(reason).toContain(mention)
}

describe('moveNode', () => {
  it('moves an element that sits alone on its line as a whole line', () => {
    const { indexed, engine, text } = openHome()
    const final = findId(indexed, /^<div class="col"/, 2)
    const outcome = applied(engine.apply(indexed, [moveNode(final, findId(indexed, /^<section/), findId(indexed, /^<div class="col"/, 0))]))
    expect(outcome.text).toBe(replaceOnce(text, COL_BRIEF + COL_SKETCHES + COL_FINAL, COL_FINAL + COL_BRIEF + COL_SKETCHES))
  })

  it('keeps the moved id and the ids of its siblings', () => {
    const { indexed, engine, reindex } = openHome()
    const section = findId(indexed, /^<section/)
    const [brief, sketches, final] = childIdsOf(indexed, section) as [EdId, EdId, EdId]
    const outcome = applied(engine.apply(indexed, [moveNode(final, section, brief)]))
    expect(childIdsOf(reindex(outcome), section)).toEqual([final, brief, sketches])
    expect(startTagOf(reindex(outcome), final)).toContain('width: 480px')
  })

  it('reparents an element with its descendants and their ids', () => {
    const { indexed, engine, text, reindex } = openHome()
    const header = findId(indexed, /^<header/)
    const main = findId(indexed, /^<main/)
    const headerChildren = childIdsOf(indexed, header)
    const outcome = applied(engine.apply(indexed, [moveNode(header, main, null)]))
    const block = text.slice(text.indexOf('    <header'), text.indexOf('    <p class="lede"'))
    expect(outcome.text).toBe(replaceOnce(replaceOnce(text, block, ''), '  </main>', `${block}  </main>`))
    const after = reindex(outcome)
    expect(childIdsOf(after, main).at(-1)).toBe(header)
    expect(childIdsOf(after, header)).toEqual(headerChildren)
    expect(slice(after.text, rangeOf(after, header))).toBe(slice(text, rangeOf(indexed, header)))
  })

  it('gives a moved node and its descendants the destination offset plus their offset inside the block', () => {
    const { indexed, engine } = openHome()
    const header = findId(indexed, /^<header/)
    const h1 = findId(indexed, /^<h1/)
    const outcome = applied(engine.apply(indexed, [moveNode(header, findId(indexed, /^<main/), null)]))
    const headerAt = outcome.text.indexOf('<header')
    expect(outcome.offsets.get(header)).toBe(headerAt)
    expect(outcome.offsets.get(h1)).toBe(headerAt + rangeOf(indexed, h1).start - rangeOf(indexed, header).start)
  })

  it('records the move on the element and mints nothing', () => {
    const { indexed, engine } = openHome()
    const final = findId(indexed, /^<div class="col"/, 2)
    const outcome = applied(engine.apply(indexed, [moveNode(final, findId(indexed, /^<section/), null)]))
    expect(outcome.records).toHaveLength(1)
    expect(outcome.records[0]).toMatchObject({ target: [final], kind: 'moveNode', scope: { kind: 'element' }, files: [HOME] })
    expect(outcome.minted).toEqual([])
  })

  it('refuses a move into the node itself or one of its descendants', () => {
    const { indexed, engine } = openHome()
    const header = findId(indexed, /^<header/)
    expect(engine.apply(indexed, [moveNode(header, header, null)]).ok).toBe(false)
    expect(engine.apply(indexed, [moveNode(header, findId(indexed, /^<h1/), null)]).ok).toBe(false)
  })

  it('refuses a move into a void element', () => {
    const { indexed, engine } = open(canvas('<section>\n  <img src="a.png" alt="">\n  <hr>\n  <span>x</span>\n</section>'))
    const span = findId(indexed, /^<span/)
    expect(engine.apply(indexed, [moveNode(span, findId(indexed, /^<img/), null)]).ok).toBe(false)
    expect(engine.apply(indexed, [moveNode(span, findId(indexed, /^<hr/), null)]).ok).toBe(false)
  })
})

describe('moveNode selector warning', () => {
  const rows = (style: string) =>
    canvas(
      `<helmet><style>${style}</style></helmet>\n` +
        '<section class="one">\n  <div class="a">a</div>\n  <div class="b">b</div>\n</section>\n' +
        '<section class="two">\n  <div class="c">c</div>\n</section>',
    )

  function warningsForMovingA(style: string): readonly string[] {
    const { indexed, engine } = open(rows(style))
    return applied(engine.apply(indexed, [moveNode(findId(indexed, /^<div class="a"/), findId(indexed, /^<section class="two"/), null)]))
      .warnings
  }

  it.each([
    ['the moved node', '.a:first-child { color: red; }'],
    ['an old sibling', '.b:first-child { color: red; }'],
    ['a new sibling', '.c:last-child { color: red; }'],
    [':nth-child on the tag', 'div:nth-child(2) { color: red; }'],
    [':only-child', '.c:only-child { color: red; }'],
    ['a + combinator', '.a + .b { color: red; }'],
    ['a ~ combinator', '.c ~ .a { color: red; }'],
  ])('warns when %s can match a positional selector', (_case, style) => {
    const warnings = warningsForMovingA(style)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/selector/i)
  })

  it('does not warn for selectors that ignore position', () => {
    expect(warningsForMovingA('.a { color: red; } section div { margin: 0; }')).toEqual([])
  })

  it('does not warn for a positional selector none of the nodes can match', () => {
    expect(warningsForMovingA('.other:first-child { color: red; } li + li { margin: 0; }')).toEqual([])
  })
})

describe('moveNode selector warning for id selectors', () => {
  function warningsForMovingLead(style: string): readonly string[] {
    const { indexed, engine } = open(
      canvas(
        `<helmet><style>${style}</style></helmet>\n` +
          '<section class="one">\n  <div id="lead" class="a">a</div>\n  <div class="b">b</div>\n</section>\n<section class="two"></section>',
      ),
    )
    return applied(engine.apply(indexed, [moveNode(findId(indexed, /^<div id="lead"/), findId(indexed, /^<section class="two"/), null)]))
      .warnings
  }

  it('warns when the moved node’s id can match a positional selector', () => {
    expect(warningsForMovingLead('#lead:first-child { color: red; }')).toEqual([expect.stringContaining('#lead:first-child')])
  })

  it('does not warn when the positional selector names another id', () => {
    expect(warningsForMovingLead('#other:first-child { color: red; } div#other.a:first-child { margin: 0; }')).toEqual([])
  })
})

describe('duplicateNode', () => {
  it('puts the copy on the next line with the same indentation', () => {
    const { indexed, engine, text } = openHome()
    const outcome = applied(engine.apply(indexed, [duplicateNode(findId(indexed, /^<div class="col"/, 1))]))
    expect(outcome.text).toBe(replaceOnce(text, COL_SKETCHES, COL_SKETCHES + COL_SKETCHES))
  })

  it('inserts the file\'s dominant line ending', () => {
    const { indexed, engine, text } = open(readFixtureText(HOME_FILE).replace(/\n/g, '\r\n'), HOME)
    const outcome = applied(engine.apply(indexed, [duplicateNode(findId(indexed, /^<div class="col"/, 1))]))
    const line = COL_SKETCHES.replace('\n', '\r\n')
    expect(outcome.text).toBe(replaceOnce(text, line, line + line))
  })

  it('strips id attributes from the copy and its descendants', () => {
    const { indexed, engine, text } = open(canvas('<section>\n  <div id="hero" class="a"><span id="t">x</span></div>\n</section>'))
    const outcome = applied(engine.apply(indexed, [duplicateNode(findId(indexed, /^<div/))]))
    expect(outcome.text).toBe(
      replaceOnce(
        text,
        '  <div id="hero" class="a"><span id="t">x</span></div>\n',
        '  <div id="hero" class="a"><span id="t">x</span></div>\n  <div class="a"><span>x</span></div>\n',
      ),
    )
  })

  it('mints new ids for the copy and its descendants and keeps the original\'s', () => {
    const { indexed, engine, reindex } = open(canvas('<section>\n  <div class="a"><span>x</span></div>\n</section>'))
    const section = findId(indexed, /^<section/)
    const div = findId(indexed, /^<div/)
    const outcome = applied(engine.apply(indexed, [duplicateNode(div)]))
    const after = reindex(outcome)
    const [original, copy] = childIdsOf(after, section) as [EdId, EdId]
    expect(original).toBe(div)
    expect(new Set([copy, ...childIdsOf(after, copy)])).toEqual(new Set(outcome.minted))
    expect(outcome.minted).toHaveLength(2)
    for (const id of outcome.minted) expect(indexed.ids).not.toContain(id)
  })
})

describe('wrapNode', () => {
  it('wraps sibling targets in a new element with a minted id', () => {
    const { indexed, engine, reindex } = openHome()
    const section = findId(indexed, /^<section/)
    const [brief, sketches, final] = childIdsOf(indexed, section) as [EdId, EdId, EdId]
    const outcome = applied(engine.apply(indexed, [wrapNode([brief, sketches], 'div')]))
    const after = reindex(outcome)
    expect(outcome.minted).toHaveLength(1)
    const wrapper = outcome.minted[0]!
    expect(childIdsOf(after, section)).toEqual([wrapper, final])
    expect(childIdsOf(after, wrapper)).toEqual([brief, sketches])
    expect(startTagOf(after, wrapper)).toBe('<div>')
  })

  it('refuses a void wrapper tag', () => {
    const { indexed, engine } = openHome()
    expect(engine.apply(indexed, [wrapNode([findId(indexed, /^<h1/)], 'br')]).ok).toBe(false)
  })

  it('refuses a wrapper that takes an <li> out of its list', () => {
    const { indexed, engine } = open(canvas('<ul>\n  <li>a</li>\n</ul>'))
    expectOneLineReason(refusalOf(engine.apply(indexed, [wrapNode([findId(indexed, /^<li/)], 'div')])), '<li>')
  })

  it('refuses a wrapper around a table cell', () => {
    const { indexed, engine } = open(canvas('<table>\n  <tr><td>a</td></tr>\n</table>'))
    expectOneLineReason(refusalOf(engine.apply(indexed, [wrapNode([findId(indexed, /^<td/)], 'div')])), '<div>')
  })
})

describe('wrapNode with a style', () => {
  const FLEX_ROW = [
    { prop: 'display', value: 'flex' },
    { prop: 'gap', value: '8px' },
  ]

  it('writes the declarations on the new wrapper in the wrap splice', () => {
    const { indexed, engine, text } = openHome()
    const [brief, sketches] = childIdsOf(indexed, findId(indexed, /^<section/)) as [EdId, EdId]
    const outcome = applied(engine.apply(indexed, [wrapNode([brief, sketches], 'div', FLEX_ROW)]))
    expect(outcome.text).toBe(
      replaceOnce(
        text,
        COL_BRIEF + COL_SKETCHES,
        `      <div style="display: flex; gap: 8px">\n${COL_BRIEF}${COL_SKETCHES}      </div>\n`,
      ),
    )
  })

  it('binds the minted wrapper id to the styled start tag and records one op', () => {
    const { indexed, engine, reindex } = openHome()
    const section = findId(indexed, /^<section/)
    const [brief, sketches, final] = childIdsOf(indexed, section) as [EdId, EdId, EdId]
    const outcome = applied(engine.apply(indexed, [wrapNode([brief, sketches], 'div', FLEX_ROW)]))
    const after = reindex(outcome)
    const [wrapper] = outcome.minted as [EdId]
    expect(outcome.minted).toHaveLength(1)
    expect(startTagOf(after, wrapper)).toBe('<div style="display: flex; gap: 8px">')
    expect(childIdsOf(after, section)).toEqual([wrapper, final])
    expect(childIdsOf(after, wrapper)).toEqual([brief, sketches])
    expect(outcome.records).toHaveLength(1)
    expect(outcome.records[0]).toMatchObject({ kind: 'wrapNode', target: [brief, sketches] })
  })

  it('writes the styled start tag inline when the wrapped element shares its line', () => {
    const { indexed, engine, text } = open(canvas('<p><span>a</span></p>'))
    const outcome = applied(engine.apply(indexed, [wrapNode([findId(indexed, /^<span/)], 'em', [{ prop: 'color', value: 'red' }])]))
    expect(outcome.text).toBe(replaceOnce(text, '<p><span>a</span></p>', '<p><em style="color: red"><span>a</span></em></p>'))
  })

  it('leaves the wrapper unstyled when no style is given', () => {
    const { indexed, engine, text } = open(canvas('<p><span>a</span></p>'))
    const outcome = applied(engine.apply(indexed, [wrapNode([findId(indexed, /^<span/)], 'em')]))
    expect(outcome.text).toBe(replaceOnce(text, '<p><span>a</span></p>', '<p><em><span>a</span></em></p>'))
  })

  it('refuses a style declaration whose property is not a CSS property name', () => {
    const { indexed, engine } = open(canvas('<p><span>a</span></p>'))
    const style = [{ prop: 'color" onclick="x()', value: 'red' }]
    expect(engine.apply(indexed, [wrapNode([findId(indexed, /^<span/)], 'em', style)]).ok).toBe(false)
  })
})

describe('insertHtml parent', () => {
  it('appends to the artboard root, the default paste parent', () => {
    const { indexed, engine, text } = open(canvas('<section>s</section>'))
    const outcome = applied(engine.apply(indexed, [insertHtml(indexed.tree!.edId, null, '<span>x</span>')]))
    expect(outcome.text).toBe(replaceOnce(text, '<section>s</section>\n</x-dc>', '<section>s</section>\n<span>x</span>\n</x-dc>'))
  })

  it.each([
    ['wrapNode', (root: EdId) => wrapNode([root], 'div')],
    ['unwrapNode', (root: EdId) => unwrapNode(root)],
    ['duplicateNode', (root: EdId) => duplicateNode(root)],
    ['deleteNode', (root: EdId) => deleteNode(root)],
  ])('still refuses %s on the artboard root', (_kind, opOn) => {
    const { indexed, engine } = open(canvas('<section>s</section>'))
    expect(refusalOf(engine.apply(indexed, [opOn(indexed.tree!.edId)]))).toMatch(/artboard root/)
  })

  it('refuses a parent that is gone with a reason', () => {
    const { indexed, engine } = open(canvas('<section>s</section>'))
    expect(refusalOf(engine.apply(indexed, [insertHtml('e9999' as EdId, null, '<span>x</span>')]))).toMatch(/gone/)
  })

  it('refuses a parent that is not a layer in the Layers panel', () => {
    const { indexed, engine } = open(canvas('<helmet><style>.a { color: red; }</style></helmet>\n<section>s</section>'))
    const helmet = findId(indexed, /^<helmet/)
    expect(refusalOf(engine.apply(indexed, [insertHtml(helmet, null, '<span>x</span>')]))).toMatch(/Layers panel/)
  })

  it('refuses a parent inside a <dc-import>', () => {
    const { indexed, engine } = open(canvas('<dc-import src="./card.dc.html"><div>x</div></dc-import>'))
    expect(engine.apply(indexed, [insertHtml(findId(indexed, /^<div/), null, '<span>x</span>')]).ok).toBe(false)
  })

  it('refuses a void parent', () => {
    const { indexed, engine } = open(canvas('<section>\n  <img src="a.png" alt="">\n</section>'))
    expect(engine.apply(indexed, [insertHtml(findId(indexed, /^<img/), null, '<span>x</span>')]).ok).toBe(false)
  })
})

describe('insertHtml splice', () => {
  it('puts the fragment on its own line before `before`, indented like it', () => {
    const { indexed, engine, text } = openHome()
    const section = findId(indexed, /^<section/)
    const sketches = childIdsOf(indexed, section)[1]!
    const outcome = applied(engine.apply(indexed, [insertHtml(section, sketches, '<div class="col">New</div>')]))
    expect(outcome.text).toBe(replaceOnce(text, COL_SKETCHES, `      <div class="col">New</div>\n${COL_SKETCHES}`))
  })

  it('splices inline before `before` when it shares its line with other content', () => {
    const { indexed, engine, text } = open(canvas('<p><span>a</span><em>b</em></p>'))
    const outcome = applied(engine.apply(indexed, [insertHtml(findId(indexed, /^<p/), findId(indexed, /^<em/), '<strong>x</strong>')]))
    expect(outcome.text).toBe(replaceOnce(text, '<span>a</span><em>b</em>', '<span>a</span><strong>x</strong><em>b</em>'))
  })

  it('keeps an LF file in LF with tab indentation', () => {
    const { indexed, engine, text } = open(readFixtureText(EDGE_FILE('lf')))
    const outcome = applied(engine.apply(indexed, [insertHtml(findId(indexed, /^<section/), findId(indexed, /^<h2/), '<span>x</span>')]))
    expect(outcome.text).toBe(replaceOnce(text, '\t\t<h2 class="note">', '\t\t<span>x</span>\n\t\t<h2 class="note">'))
  })

  it('writes the file\'s CRLF line ending', () => {
    const { indexed, engine, text } = open(readFixtureText(EDGE_FILE('crlf')))
    const outcome = applied(engine.apply(indexed, [insertHtml(findId(indexed, /^<section/), findId(indexed, /^<hr/), '<span>x</span>')]))
    expect(outcome.text).toBe(replaceOnce(text, '   <hr style=', '   <span>x</span>\r\n   <hr style='))
  })

  it('keeps the byte order mark of a BOM file', () => {
    const { indexed, engine, text } = open(readFixtureText(EDGE_FILE('bom')))
    const outcome = applied(engine.apply(indexed, [insertHtml(findId(indexed, /^<section/), findId(indexed, /^<img/), '<span>x</span>')]))
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(outcome.text).toBe(replaceOnce(text, '\t<img src=', '\t<span>x</span>\n\t<img src='))
  })
})

describe('insertHtml ids', () => {
  it('mints an id for every element of the fragment and binds each to its start tag', () => {
    const { indexed, engine, reindex } = openHome()
    const section = findId(indexed, /^<section/)
    const outcome = applied(engine.apply(indexed, [insertHtml(section, null, '<div class="new"><span>a</span><em>b</em></div>')]))
    const after = reindex(outcome)
    expect(outcome.minted).toHaveLength(3)
    for (const id of outcome.minted) expect(indexed.ids).not.toContain(id)
    expect(outcome.minted.map((id) => startTagOf(after, id)).sort()).toEqual(['<div class="new">', '<em>', '<span>'])
    const top = childIdsOf(after, section).at(-1)!
    expect(startTagOf(after, top)).toBe('<div class="new">')
    expect(new Set([top, ...childIdsOf(after, top)])).toEqual(new Set(outcome.minted))
  })

  it('attaches the top-level elements under the parent before `before` and keeps every existing id', () => {
    const { indexed, engine, reindex } = openHome()
    const section = findId(indexed, /^<section/)
    const [brief, sketches, final] = childIdsOf(indexed, section) as [EdId, EdId, EdId]
    const outcome = applied(engine.apply(indexed, [insertHtml(section, sketches, '<span>a</span><em>b</em>')]))
    const after = reindex(outcome)
    const children = childIdsOf(after, section)
    expect(children).toHaveLength(5)
    expect([children[0], ...children.slice(3)]).toEqual([brief, sketches, final])
    expect(new Set(children.slice(1, 3))).toEqual(new Set(outcome.minted))
    for (const id of indexed.ids) expect(startTagOf(after, id)).toBe(startTagOf(indexed, id))
  })

  it('records one insertHtml op on the parent', () => {
    const { indexed, engine } = openHome()
    const section = findId(indexed, /^<section/)
    const outcome = applied(engine.apply(indexed, [insertHtml(section, null, '<span>a</span>')]))
    expect(outcome.records).toHaveLength(1)
    expect(outcome.records[0]).toMatchObject({ target: [section], kind: 'insertHtml', scope: { kind: 'element' }, files: [HOME] })
  })
})

describe('insertHtml re-parse shape check', () => {
  it('refuses a fragment the parser would fix up and writes nothing', () => {
    const { indexed, engine } = open(canvas('<section>\n  <p>a</p>\n</section>'))
    const outcome = engine.apply(indexed, [insertHtml(findId(indexed, /^<section/), null, '<p><div></div></p>')])
    expectOneLineReason(refusalOf(outcome), '<p>')
    expect('text' in outcome).toBe(false)
  })
})

describe('unwrapNode', () => {
  it('replaces the element by its children, keeps their ids and retires its own', () => {
    const { indexed, engine, reindex } = open(canvas('<section>\n  <div class="w">\n    <p>a</p>\n    <p>b</p>\n  </div>\n</section>'))
    const section = findId(indexed, /^<section/)
    const wrapper = findId(indexed, /^<div/)
    const paragraphs = childIdsOf(indexed, wrapper)
    const outcome = applied(engine.apply(indexed, [unwrapNode(wrapper)]))
    expect(outcome.text).not.toContain('class="w"')
    expect(outcome.offsets.has(wrapper)).toBe(false)
    expect(childIdsOf(reindex(outcome), section)).toEqual(paragraphs)
  })

  it('refuses when the children would land somewhere they cannot go', () => {
    const { indexed, engine } = open(canvas('<div>\n  <ul class="list">\n    <li>a</li>\n  </ul>\n</div>'))
    expectOneLineReason(refusalOf(engine.apply(indexed, [unwrapNode(findId(indexed, /^<ul/))])), '<li>')
  })
})

describe('deleteNode', () => {
  it('removes the element\'s line and retires its id', () => {
    const { indexed, engine, text, reindex } = openHome()
    const section = findId(indexed, /^<section/)
    const [brief, sketches, final] = childIdsOf(indexed, section) as [EdId, EdId, EdId]
    const outcome = applied(engine.apply(indexed, [deleteNode(sketches)]))
    expect(outcome.text).toBe(replaceOnce(text, COL_SKETCHES, ''))
    expect(outcome.offsets.has(sketches)).toBe(false)
    expect(childIdsOf(reindex(outcome), section)).toEqual([brief, final])
  })
})

describe('HTML content-model guards', () => {
  it('refuses a block inside a <p> with a one-line reason', () => {
    const { indexed, engine } = openHome()
    const reason = refusalOf(engine.apply(indexed, [moveNode(findId(indexed, /^<div class="col"/), findId(indexed, /^<p class="lede"/), null)]))
    expectOneLineReason(reason, '<div>', '<p>')
  })

  it('refuses a <div> inside a heading', () => {
    const { indexed, engine } = openHome()
    const reason = refusalOf(engine.apply(indexed, [moveNode(findId(indexed, /^<div class="col"/), findId(indexed, /^<h1/), null)]))
    expectOneLineReason(reason, '<div>', '<h1>')
  })

  it('refuses a <div> inside a <button>', () => {
    const { indexed, engine } = open(canvas('<button>Go</button>\n<div>x</div>'))
    const reason = refusalOf(engine.apply(indexed, [moveNode(findId(indexed, /^<div/), findId(indexed, /^<button/), null)]))
    expectOneLineReason(reason, '<div>', '<button>')
  })

  it('refuses an <li> outside a list and allows it into another list', () => {
    const { indexed, engine } = open(canvas('<ul>\n  <li>a</li>\n</ul>\n<ol>\n  <li>b</li>\n</ol>\n<section>s</section>'))
    const li = findId(indexed, /^<li/)
    expectOneLineReason(refusalOf(engine.apply(indexed, [moveNode(li, findId(indexed, /^<section/), null)])), '<li>')
    expect(engine.apply(indexed, [moveNode(li, findId(indexed, /^<ol/), null)]).ok).toBe(true)
  })

  it('refuses table parts out of place and allows a cell into another row', () => {
    const { indexed, engine } = open(canvas('<table>\n  <tr><td>a</td></tr>\n  <tr><td>b</td></tr>\n</table>\n<div>x</div>'))
    const td = findId(indexed, /^<td/)
    const div = findId(indexed, /^<div/)
    expect(engine.apply(indexed, [moveNode(td, div, null)]).ok).toBe(false)
    expect(engine.apply(indexed, [moveNode(findId(indexed, /^<tr/), div, null)]).ok).toBe(false)
    expect(engine.apply(indexed, [moveNode(div, findId(indexed, /^<tr/), null)]).ok).toBe(false)
    expect(engine.apply(indexed, [moveNode(td, findId(indexed, /^<tr/, 1), null)]).ok).toBe(true)
  })

  it('refuses a nested <a>', () => {
    const { indexed, engine } = open(canvas('<a href="#1"><span>x</span></a>\n<a href="#2">y</a>'))
    const reason = refusalOf(engine.apply(indexed, [moveNode(findId(indexed, /^<a href="#2"/), findId(indexed, /^<span/), null)]))
    expectOneLineReason(reason, '<a>')
  })

  it('refuses a nested <form>', () => {
    const { indexed, engine } = open(canvas('<form><div>x</div></form>\n<form class="b"></form>'))
    const reason = refusalOf(engine.apply(indexed, [moveNode(findId(indexed, /^<form class="b"/), findId(indexed, /^<div/), null)]))
    expectOneLineReason(reason, '<form>')
  })

  it('allows a valid move', () => {
    const { indexed, engine } = openHome()
    expect(engine.apply(indexed, [moveNode(findId(indexed, /^<img/), findId(indexed, /^<section/), null)]).ok).toBe(true)
  })
})

describe('re-parse shape check', () => {
  it('refuses a subtree whose descendant block would close the <p> it lands in', () => {
    const { indexed, engine } = open(canvas('<p class="target">t</p>\n<span class="s"><div>x</div></span>'))
    const outcome = engine.apply(indexed, [moveNode(findId(indexed, /^<span/), findId(indexed, /^<p/), null)])
    expectOneLineReason(refusalOf(outcome), '<p>')
  })

  it('refuses a subtree whose descendant <a> would land inside another <a>', () => {
    const { indexed, engine } = open(canvas('<a href="#1">x</a>\n<span class="s"><a href="#2">y</a></span>'))
    const outcome = engine.apply(indexed, [moveNode(findId(indexed, /^<span/), findId(indexed, /^<a href="#1"/), null)])
    expectOneLineReason(refusalOf(outcome), '<a>')
  })

  it('names the div-in-p case in plain words', () => {
    const { indexed, engine } = open(canvas('<p class="target">t</p>\n<div>x</div>'))
    const outcome = engine.apply(indexed, [moveNode(findId(indexed, /^<div/), findId(indexed, /^<p/), null)])
    expect(refusalOf(outcome)).toMatch(/a <div> can't go inside a <p>/)
  })
})

describe('content-model rules for drop targets', () => {
  it.each([
    [['section', 'p'], 'div', '<div>'],
    [['h2'], 'div', '<div>'],
    [['button'], 'div', '<div>'],
    [['section'], 'li', '<li>'],
    [['div'], 'td', '<td>'],
    [['div'], 'tr', '<tr>'],
    [['table', 'tbody', 'tr'], 'div', '<div>'],
    [['a', 'span'], 'a', '<a>'],
    [['form', 'div'], 'form', '<form>'],
  ] as const)('explains why %j cannot take a <%s>', (ancestors, tag, mention) => {
    const reason = nestingViolation(ancestors, tag)
    expect(reason).not.toBeNull()
    expectOneLineReason(reason!, mention)
  })

  it.each([
    [['ul'], 'li'],
    [['ol'], 'li'],
    [['table', 'tbody', 'tr'], 'td'],
    [['table', 'tbody'], 'tr'],
    [['section'], 'div'],
    [['p'], 'span'],
    [['a', 'span'], 'em'],
  ] as const)('allows %j to take a <%s>', (ancestors, tag) => {
    expect(nestingViolation(ancestors, tag)).toBeNull()
  })
})
