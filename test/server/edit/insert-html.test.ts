import { describe, expect, it } from 'vitest'
import { PatchEngine } from '../../../src/server/edit/patch-engine'
import { SourceIndex } from '../../../src/server/source/source-index'
import type { EdId, EditOp, ProjectPath, SourceRange } from '../../../src/shared/types'

type IndexedFile = ReturnType<SourceIndex['indexFile']>
type PatchOutcome = ReturnType<PatchEngine['apply']>
type AppliedOutcome = Extract<PatchOutcome, { ok: true }>

const SNIPPET = 'project/snippet.dc.html' as ProjectPath
const ANCHOR = '  <p>a</p>'

function canvas(body: string): string {
  return `<!doctype html>\n<html>\n<body>\n<x-dc>\n${body}\n</x-dc>\n</body>\n</html>\n`
}

function open(text: string) {
  const index = new SourceIndex()
  const indexed = index.indexFile(SNIPPET, text)
  let minted = 0
  const engine = new PatchEngine({ mintId: () => `minted${++minted}` as EdId })
  return { indexed, engine, text }
}

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
  if (outcome.ok) throw new Error('expected the paste to be refused, but it applied')
  return outcome.reason
}

function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from)
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`"${from}" must occur exactly once`)
  return text.slice(0, at) + to + text.slice(at + from.length)
}

const insertHtml = (parent: EdId, before: EdId | null, html: string): EditOp => ({ kind: 'insertHtml', target: [parent], payload: { before, html } })

/** Pastes `html` into a `<section>` before its `<p>a</p>`. */
function paste(html: string) {
  const { indexed, engine, text } = open(canvas(`<section>\n${ANCHOR}\n</section>`))
  const outcome = engine.apply(indexed, [insertHtml(findId(indexed, /^<section/), findId(indexed, /^<p/), html)])
  return { outcome, text }
}

function pastedAs(html: string, written: string): void {
  const { outcome, text } = paste(html)
  expect(applied(outcome).text).toBe(replaceOnce(text, ANCHOR, `  ${written}\n${ANCHOR}`))
}

function idsIn(text: string): string[] {
  return [...text.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!)
}

describe('platform packaging', () => {
  it('keeps only the content between the StartFragment and EndFragment markers', () => {
    pastedAs('<html><body><!--StartFragment--><span>x</span><!--EndFragment--></body></html>', '<span>x</span>')
  })

  it('keeps only the marked fragment of a Windows CF_HTML clipboard', () => {
    const cfHtml =
      'Version:0.9\r\nStartHTML:0000000105\r\nEndHTML:0000000199\r\nStartFragment:0000000141\r\nEndFragment:0000000163\r\n' +
      '<html>\r\n<body>\r\n<!--StartFragment--><span>x</span><!--EndFragment-->\r\n</body>\r\n</html>'
    pastedAs(cfHtml, '<span>x</span>')
  })

  it('drops a leading <meta charset>', () => {
    pastedAs("<meta charset='utf-8'><span>x</span>", '<span>x</span>')
  })

  it('drops <html>, <head> and <body> wrappers', () => {
    pastedAs('<html><head></head><body><span>x</span></body></html>', '<span>x</span>')
  })

  it('drops a leading <meta charset> before the wrappers', () => {
    pastedAs('<meta charset="utf-8"><html><head></head><body><em>y</em></body></html>', '<em>y</em>')
  })
})

describe('ids in a pasted fragment', () => {
  it('drops an id nothing in the fragment references, with the whitespace before it', () => {
    pastedAs('<p class="a" id="lonely">x</p>', '<p class="a">x</p>')
  })

  it('renames a referenced id with a prefix and rewrites the href that points at it', () => {
    const { outcome, text } = paste('<p><a href="#note">see</a></p><p id="note">x</p>')
    const written = applied(outcome).text
    const [renamed] = idsIn(written) as [string]
    expect(renamed).not.toBe('note')
    expect(renamed).toMatch(/.note$/)
    expect(written).toBe(replaceOnce(text, ANCHOR, `  <p><a href="#${renamed}">see</a></p><p id="${renamed}">x</p>\n${ANCHOR}`))
  })

  it('rewrites a url(#id) reference in a style to the renamed id', () => {
    const { outcome, text } = paste('<span id="m">a</span><div style="mask: url(#m)"></div>')
    const written = applied(outcome).text
    const [renamed] = idsIn(written) as [string]
    expect(renamed).not.toBe('m')
    expect(written).toBe(replaceOnce(text, ANCHOR, `  <span id="${renamed}">a</span><div style="mask: url(#${renamed})"></div>\n${ANCHOR}`))
  })

  it('gives each paste its own prefix, distinct from the ids already in the board', () => {
    const { indexed, engine } = open(canvas('<section>\n  <p id="note">a</p>\n  <p>b</p>\n</section>'))
    const html = '<a href="#note">see</a><span id="note">x</span>'
    const section = findId(indexed, /^<section/)
    const outcome = applied(
      engine.apply(indexed, [insertHtml(section, findId(indexed, /^<p/, 0), html), insertHtml(section, findId(indexed, /^<p/, 1), html)]),
    )
    const pasted = idsIn(outcome.text).filter((id) => id !== 'note')
    expect(pasted).toHaveLength(2)
    expect(new Set(pasted).size).toBe(2)
  })
})

describe('allow-list: clean fragments', () => {
  it.each([
    ['phrasing with global attributes', '<span class="tag" style="color: red" title="t" lang="en" dir="ltr" aria-label="Tag" data-kind="x">Hi <strong>bold</strong> <em>it</em></span>'],
    ['blocks', '<div class="card"><h2>Title</h2><p>Body</p></div>'],
    ['an https link', '<a href="https://example.com/a?b=1">link</a>'],
    ['an http link', '<a href="http://example.com/">link</a>'],
    ['a mailto link', '<a href="mailto:ron@example.com">mail</a>'],
    ['a fragment link', '<a href="#top">top</a>'],
    ['a relative link', '<a href="../other.html">other</a>'],
    ['an image with its attributes', '<img src="https://example.com/a.png" alt="A" width="10" height="10">'],
    ['a relative image', '<img src="/_blob/0f1e2d3c4b5a69788796a5b4c3d2e1f0" alt="">'],
    ['a data:image src', '<img src="data:image/png;base64,AAAA" alt="">'],
    ['a data:image url() in a style', '<div style="background-image: url(data:image/png;base64,AAAA)"></div>'],
    ['an https url() in a style', '<div style="background-image: url(https://example.com/a.png)"></div>'],
    ['a data-layer-name', '<div data-layer-name="Card"></div>'],
    [
      'basic inline SVG shapes',
      '<svg viewBox="0 0 10 10" width="10" height="10"><rect x="1" y="1" width="8" height="8" fill="red"></rect><circle cx="5" cy="5" r="2"></circle><path d="M0 0L10 10" stroke="blue"></path></svg>',
    ],
  ])('pastes %s verbatim', (_case, html) => {
    pastedAs(html, html)
  })
})

describe('allow-list: refused constructs', () => {
  it.each([
    ['<script>', '<script>alert(1)</script>'],
    ['<style>', '<style>p { color: red; }</style>'],
    ['<template>', '<template><p>x</p></template>'],
    ['<iframe>', '<iframe src="https://example.com/"></iframe>'],
    ['<object>', '<object data="x.swf"></object>'],
    ['<embed>', '<embed src="x.swf">'],
    ['<base>', '<base href="https://example.com/">'],
    ['<link>', '<link rel="stylesheet" href="x.css">'],
    ['<form>', '<form><input name="q"></form>'],
    ['<math>', '<math><mi>x</mi></math>'],
    ['a <meta> that is not a leading charset', '<span>x</span><meta http-equiv="refresh" content="0;url=https://example.com/">'],
    ['an onclick attribute', '<p onclick="alert(1)">x</p>'],
    ['an onerror attribute', '<img src="a.png" alt="" onerror="alert(1)">'],
    ['an on* attribute on SVG', '<svg onload="alert(1)"></svg>'],
    ['a <script> inside SVG', '<svg><script>alert(1)</script></svg>'],
    ['srcset', '<img src="a.png" alt="" srcset="b.png 2x">'],
    ['action', '<div action="/x">x</div>'],
    ['formaction', '<button formaction="/x">Go</button>'],
    ['xlink:href', '<svg><rect width="1" height="1" xlink:href="#a"></rect></svg>'],
    ['data-ed-id', '<p data-ed-id="e1">x</p>'],
    ['a javascript: href', '<a href="javascript:alert(1)">x</a>'],
    ['a mixed-case javascript: href', '<a href="JaVaScRiPt:alert(1)">x</a>'],
    ['a javascript: href behind leading spaces', '<a href="  javascript:alert(1)">x</a>'],
    ['a javascript: href split by a tab', '<a href="java\tscript:alert(1)">x</a>'],
    ['a file: href', '<a href="file:///etc/passwd">x</a>'],
    ['a data: href', '<a href="data:image/png;base64,AAAA">x</a>'],
    ['a data:text/html src', '<img src="data:text/html,<b>x</b>" alt="">'],
    ['a javascript: src', '<img src="javascript:alert(1)" alt="">'],
    ['a javascript: url() in a style', '<div style="background: url(javascript:alert(1))"></div>'],
    ['a data:text/html url() in a style', "<div style=\"background-image: url('data:text/html,x')\"></div>"],
  ])('refuses %s', (_case, html) => {
    expect(paste(html).outcome.ok).toBe(false)
  })
})

describe('allow-list: data-bound content', () => {
  it.each([
    ['<helmet>', '<helmet></helmet>'],
    ['<sc-for>', '<sc-for><span>x</span></sc-for>'],
    ['<sc-if>', '<sc-if><span>x</span></sc-if>'],
    ['<dc-import>', '<dc-import src="./card.dc.html"></dc-import>'],
    ['a {{…}} hole in text', '<p>Hello {{ name }}</p>'],
    ['a {{…}} hole in an attribute', '<p title="{{ title }}">x</p>'],
    ['a {{…}} hole in a style', '<p style="color: {{ accent }}">x</p>'],
  ])('refuses %s', (_case, html) => {
    expect(paste(html).outcome.ok).toBe(false)
  })

  it.each([
    ['<sc-for>', '<sc-for><span>x</span></sc-for>'],
    ['<sc-if>', '<sc-if><span>x</span></sc-if>'],
    ['<dc-import>', '<dc-import src="./card.dc.html"></dc-import>'],
    ['a {{…}} hole', '<p>Hello {{ name }}</p>'],
  ])('names Duplicate and drag-reorder in the layers panel when refusing %s', (_case, html) => {
    const reason = refusalOf(paste(html).outcome)
    expect(reason).toMatch(/Duplicate \(Mod-D\)/)
    expect(reason).toMatch(/drag/i)
    expect(reason).toMatch(/layers panel/i)
  })
})
