import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeSource, dominantEol, encodeSource, eolStyle, readSource } from '../../../src/server/source/bytes'
import { SourceIndex } from '../../../src/server/source/source-index'
import type { EdId, ElementLocation, ProjectPath, SourceRange, TemplateNode } from '../../../src/shared/types'

type IndexedFile = ReturnType<SourceIndex['indexFile']>

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url))
const HOME_FILE = path.join(FIXTURES, 'canvas', 'project', 'home.dc.html')
const VARIANTS = ['lf', 'crlf', 'mixed', 'bom', 'nonl'] as const
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

const HOME = 'project/home.dc.html' as ProjectPath
const EDGE = 'project/edge.dc.html' as ProjectPath
const SNIPPET = 'project/snippet.dc.html' as ProjectPath

const edgeFile = (variant: string) => path.join(FIXTURES, 'endings', `edge.${variant}.dc.html`)

function readFixtureText(file: string): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(readFileSync(file))
}

function slice(text: string, range: SourceRange): string {
  return text.slice(range.start, range.end)
}

function locationOf(indexed: IndexedFile, id: EdId): ElementLocation {
  const location = indexed.locate(id)
  if (!location) throw new Error(`no location for ${id}`)
  return location
}

function tagOf(text: string, indexed: IndexedFile, id: EdId): string {
  const startTag = slice(text, locationOf(indexed, id).startTag)
  return /^<([^\s/>]+)/.exec(startTag)?.[1]?.toLowerCase() ?? ''
}

function idsByTag(text: string, indexed: IndexedFile, tag: string): EdId[] {
  return indexed.ids.filter((id) => tagOf(text, indexed, id) === tag)
}

function idOf(text: string, indexed: IndexedFile, tag: string, nth = 0): EdId {
  const id = idsByTag(text, indexed, tag)[nth]
  if (!id) throw new Error(`no <${tag}> #${nth}`)
  return id
}

function outline(node: TemplateNode): string {
  if (node.children.length === 0) return node.tag
  return `${node.tag}(${node.children.map(outline).join(' ')})`
}

function rowsOf(node: TemplateNode): TemplateNode[] {
  return [node, ...node.children.flatMap(rowsOf)]
}

function treeOf(indexed: IndexedFile): TemplateNode {
  if (!indexed.tree) throw new Error('no template tree')
  return indexed.tree
}

function rowFor(indexed: IndexedFile, id: EdId): TemplateNode {
  const row = rowsOf(treeOf(indexed)).find((node) => node.edId === id)
  if (!row) throw new Error(`no row for ${id}`)
  return row
}

function indexText(text: string, file = SNIPPET) {
  const indexed = new SourceIndex().indexFile(file, text)
  return { text, indexed }
}

function indexHome() {
  const text = readFixtureText(HOME_FILE)
  return { text, indexed: new SourceIndex().indexFile(HOME, text) }
}

describe('bytes', () => {
  it.each(VARIANTS)('%s decodes and re-encodes to the exact bytes on disk', (variant) => {
    const bytes = readFileSync(edgeFile(variant))
    expect(encodeSource(decodeSource(bytes)).equals(bytes)).toBe(true)
  })

  it('keeps the BOM in the decoded string and only there', () => {
    expect(decodeSource(readFileSync(edgeFile('bom'))).charCodeAt(0)).toBe(0xfeff)
    expect(decodeSource(readFileSync(edgeFile('lf'))).charCodeAt(0)).toBe('<'.charCodeAt(0))
  })

  it('encodes without adding a BOM', () => {
    const encoded = encodeSource('<p>hi</p>\n')
    expect(encoded.subarray(0, 3).equals(UTF8_BOM)).toBe(false)
    expect(encoded.equals(Buffer.from('<p>hi</p>\n', 'utf8'))).toBe(true)
  })

  it('keeps CR characters and the missing final newline', () => {
    expect(decodeSource(readFileSync(edgeFile('crlf')))).toContain('\r\n')
    expect(decodeSource(readFileSync(edgeFile('nonl'))).endsWith('</html>')).toBe(true)
    expect(decodeSource(Buffer.from('  <p>x</p>\r\n\r\n'))).toBe('  <p>x</p>\r\n\r\n')
  })

  it.each(VARIANTS)('readSource reads %s byte-exactly', async (variant) => {
    const text = await readSource(edgeFile(variant))
    expect(encodeSource(text).equals(readFileSync(edgeFile(variant)))).toBe(true)
  })

  it('reports the line-ending style of each fixture', () => {
    const styles = VARIANTS.map((variant) => eolStyle(readFixtureText(edgeFile(variant))))
    expect(styles).toEqual(['lf', 'crlf', 'mixed', 'lf', 'lf'])
  })

  it('reports LF or CRLF as the dominant ending', () => {
    expect(dominantEol(readFixtureText(edgeFile('lf')))).toBe('\n')
    expect(dominantEol(readFixtureText(edgeFile('crlf')))).toBe('\r\n')
    expect(dominantEol(readFixtureText(edgeFile('bom')))).toBe('\n')
  })

  it('takes the majority ending for mixed text', () => {
    expect(dominantEol('a\r\nb\r\nc\nd')).toBe('\r\n')
    expect(dominantEol('a\r\nb\nc\nd')).toBe('\n')
  })

  it('falls back to LF when the text has no line break', () => {
    expect(dominantEol('<p>one line</p>')).toBe('\n')
  })
})

describe('SourceIndex ids', () => {
  it('gives every source element an id, in document order', () => {
    const text = readFixtureText(edgeFile('lf'))
    const indexed = new SourceIndex().indexFile(EDGE, text)
    expect(indexed.ids.map((id) => tagOf(text, indexed, id))).toEqual([
      'html', 'head', 'meta', 'script', 'body', 'x-dc', 'helmet', 'style', 'section', 'h2', 'p', 'em', 'br',
      'hr', 'img', 'table', 'tr', 'td', 'td', 'tr', 'td', 'td',
    ])
  })

  it('gives implicit html, head, body and tbody no id', () => {
    const { text, indexed } = indexText('<x-dc><table><tr><td>a</td></tr></table></x-dc>')
    expect(indexed.ids.map((id) => tagOf(text, indexed, id))).toEqual(['x-dc', 'table', 'tr', 'td'])
  })

  it('hands out distinct ids across files from one per-session counter', () => {
    const index = new SourceIndex()
    const home = index.indexFile(HOME, readFixtureText(HOME_FILE))
    const edge = index.indexFile(EDGE, readFixtureText(edgeFile('lf')))
    const all = [...home.ids, ...edge.ids]
    expect(new Set(all).size).toBe(all.length)
  })

  it('reports each id with the file it was indexed under', () => {
    const { indexed } = indexHome()
    expect(indexed.ids.every((id) => locationOf(indexed, id).file === HOME)).toBe(true)
  })

  it('locates no id it did not hand out', () => {
    const { indexed } = indexHome()
    expect(indexed.locate('not-an-id' as EdId)).toBeUndefined()
  })
})

describe.each(VARIANTS)('SourceIndex ranges on edge.%s.dc.html', (variant) => {
  const text = readFixtureText(edgeFile(variant))
  const indexed = new SourceIndex().indexFile(EDGE, text)
  const lfText = readFixtureText(edgeFile('lf'))

  it('slices the element, start tag and attributes of a text element', () => {
    const location = locationOf(indexed, idOf(text, indexed, 'h2'))
    expect(slice(text, location.element)).toBe('<h2 class="note">Tom&#8217;s notes</h2>')
    expect(slice(text, location.startTag)).toBe('<h2 class="note">')
    expect(slice(text, location.attrs['class']!)).toBe('class="note"')
  })

  it('slices a void element to its start tag', () => {
    const location = locationOf(indexed, idOf(text, indexed, 'img'))
    const tag = '<img src="/_blob/0f1e2d3c4b5a69788796a5b4c3d2e1f0" alt="mark">'
    expect(slice(text, location.element)).toBe(tag)
    expect(slice(text, location.startTag)).toBe(tag)
    expect(slice(text, location.attrs['src']!)).toBe('src="/_blob/0f1e2d3c4b5a69788796a5b4c3d2e1f0"')
    expect(slice(text, location.attrs['alt']!)).toBe('alt="mark"')
  })

  it('slices single-quoted and style attributes', () => {
    const root = locationOf(indexed, idOf(text, indexed, 'x-dc'))
    expect(slice(text, root.attrs['data-props']!)).toBe(`data-props='{"$preview":{"w":800,"h":600}}'`)
    const cell = locationOf(indexed, idOf(text, indexed, 'td'))
    expect(slice(text, cell.attrs['style']!)).toBe('style="padding: 4px 8px !important"')
  })

  it('slices a multi-line element with its own line endings', () => {
    const section = slice(text, locationOf(indexed, idOf(text, indexed, 'section')).element)
    const lfSection = lfText.slice(lfText.indexOf('<section'), lfText.indexOf('</section>') + '</section>'.length)
    expect(section.replace(/\r\n/g, '\n')).toBe(lfSection)
    expect(section.includes('\r')).toBe(variant === 'crlf' || variant === 'mixed')
  })

  it('slices every start tag inside its element', () => {
    for (const id of indexed.ids) {
      const location = locationOf(indexed, id)
      const startTag = slice(text, location.startTag)
      expect(startTag).toMatch(/^<[\w-]+[\s\S]*>$/)
      expect(slice(text, location.element).startsWith(startTag)).toBe(true)
    }
  })

  it('offsets index the decoded string, BOM and CR included', () => {
    expect(locationOf(indexed, idOf(text, indexed, 'h2')).element.start).toBe(text.indexOf('<h2'))
    expect(locationOf(indexed, idOf(text, indexed, 'img')).element.start).toBe(text.indexOf('<img'))
  })
})

describe('SourceIndex re-indexing', () => {
  const insertAfterHeading = (text: string, insert: string) => {
    const at = text.indexOf('</h1>') + '</h1>'.length
    return { at, text: text.slice(0, at) + insert + text.slice(at) }
  }

  it('binds each stored id to the node at its start offset', () => {
    const text = readFixtureText(HOME_FILE)
    const index = new SourceIndex()
    const first = index.indexFile(HOME, text)
    const firstIds = [...first.ids]
    const firstLocations = firstIds.map((id) => first.locate(id))
    const again = index.indexFile(HOME, text, first.startOffsets())
    expect(again.ids).toEqual(firstIds)
    expect(firstIds.map((id) => again.locate(id))).toEqual(firstLocations)
  })

  it('keeps shifted ids, refreshes ranges and gives unmatched nodes fresh ids', () => {
    const text = readFixtureText(HOME_FILE)
    const index = new SourceIndex()
    const first = index.indexFile(HOME, text)
    const startTags = new Map(first.ids.map((id) => [id, slice(text, locationOf(first, id).startTag)] as const))
    const insert = '<span class="new">x</span>'
    const edited = insertAfterHeading(text, insert)
    const shifted = new Map(
      [...first.startOffsets()].map(([id, offset]) => [id, offset >= edited.at ? offset + insert.length : offset] as const),
    )
    const second = index.indexFile(HOME, edited.text, shifted)

    for (const [id, startTag] of startTags) expect(slice(edited.text, locationOf(second, id).startTag)).toBe(startTag)
    const header = locationOf(second, idOf(edited.text, second, 'header'))
    expect(slice(edited.text, header.element)).toContain(insert)
    expect(slice(edited.text, header.element).endsWith('</header>')).toBe(true)
    const span = idOf(edited.text, second, 'span')
    expect(startTags.has(span)).toBe(false)
    expect(second.ids).toHaveLength(startTags.size + 1)
  })

  it('drops a stored id whose offset no longer starts a node', () => {
    const text = readFixtureText(HOME_FILE)
    const index = new SourceIndex()
    const first = index.indexFile(HOME, text)
    const stale = first.ids[0]!
    const second = index.indexFile(HOME, text, new Map([[stale, text.length + 10]]))
    expect(second.ids).not.toContain(stale)
    expect(second.locate(stale)).toBeUndefined()
  })

  it('never rewinds the counter or hands out a retired id again', () => {
    const text = readFixtureText(HOME_FILE)
    const index = new SourceIndex()
    const first = index.indexFile(HOME, text)
    const firstIds = [...first.ids]
    const firstOffsets = first.startOffsets()
    const heading = idOf(text, first, 'h1')
    const withoutHeading = new Map([...firstOffsets].filter(([id]) => id !== heading))

    const second = index.indexFile(HOME, text, withoutHeading)
    expect(second.ids).not.toContain(heading)
    expect(firstIds).not.toContain(idOf(text, second, 'h1'))

    const fresh = index.indexFile(HOME, text)
    const restored = index.indexFile(HOME, text, firstOffsets)
    const later = index.indexFile(EDGE, readFixtureText(edgeFile('lf')))
    expect(restored.ids).toEqual(firstIds)
    const handedOut = [...firstIds, idOf(text, second, 'h1'), ...fresh.ids, ...later.ids]
    expect(new Set(handedOut).size).toBe(handedOut.length)
  })
})

describe('SourceIndex template tree', () => {
  it('has one row per template node inside <x-dc>, without helmet or the data-dc-script block', () => {
    const { indexed } = indexHome()
    expect(outline(treeOf(indexed))).toBe(
      'x-dc(main(header(h1 p img) p(strong em) section(div div div) ul(sc-for(li)) sc-if(div) dc-import))',
    )
  })

  it('leaves implicit tbody out of the tree', () => {
    const text = readFixtureText(edgeFile('lf'))
    const indexed = new SourceIndex().indexFile(EDGE, text)
    expect(outline(treeOf(indexed))).toBe('x-dc(section(h2 p(em br) hr img table(tr(td td) tr(td td))))')
  })

  it('binds each row to the id of its source element', () => {
    const { text, indexed } = indexHome()
    const rows = rowsOf(treeOf(indexed))
    expect(rows.map((row) => tagOf(text, indexed, row.edId))).toEqual(rows.map((row) => row.tag))
    expect(treeOf(indexed).edId).toBe(idOf(text, indexed, 'x-dc'))
  })

  it('labels sc-for, sc-if and dc-import rows by kind', () => {
    const { indexed } = indexHome()
    const kinds = Object.fromEntries(rowsOf(treeOf(indexed)).map((row) => [row.tag, row.kind]))
    expect(kinds).toMatchObject({ 'sc-for': 'sc-for', 'sc-if': 'sc-if', 'dc-import': 'dc-import', li: 'element', main: 'element' })
  })

  it('makes a dc-import one read-only leaf even when it has source children', () => {
    const { text, indexed } = indexText('<x-dc><dc-import src="./card.dc.html"><div class="fallback">Loading</div></dc-import></x-dc>')
    const leaf = rowFor(indexed, idOf(text, indexed, 'dc-import'))
    expect(leaf.children).toEqual([])
    expect(leaf.readOnly).toBe('dc-import')
  })

  it('has no tree for a file without <x-dc>', () => {
    const { indexed } = indexText('<main><p>plain</p></main>')
    expect(indexed.tree).toBeNull()
  })

  it('names layers from the class, else the tag', () => {
    const { text, indexed } = indexHome()
    const nameOf = (tag: string, nth = 0) => rowFor(indexed, idOf(text, indexed, tag, nth)).name
    expect(nameOf('main')).toBe('page')
    expect(nameOf('header')).toBe('hero')
    expect(nameOf('li')).toBe('item')
    expect(nameOf('h1')).toBe('h1')
  })

  it('names layers from data-layer-name, then id, then class, then tag', () => {
    const { indexed } = indexText(
      [
        '<x-dc>',
        '<div data-layer-name="Hero banner" id="hero" class="banner">a</div>',
        '<div id="cta" class="button">b</div>',
        '<div class="card">c</div>',
        '<section></section>',
        '</x-dc>',
      ].join('\n'),
    )
    expect(treeOf(indexed).children.map((row) => row.name)).toEqual(['Hero banner', 'cta', 'card', 'section'])
  })
})

describe('SourceIndex flags', () => {
  it('marks <dc-import> descendants read-only', () => {
    const { text, indexed } = indexText('<x-dc><dc-import src="./card.dc.html"><div class="fallback">Loading</div></dc-import><p>own</p></x-dc>')
    expect(indexed.flagsOf(idOf(text, indexed, 'div')).readOnly).toBe('dc-import')
    expect(indexed.flagsOf(idOf(text, indexed, 'p')).readOnly).toBeUndefined()
  })

  it('marks every descendant of <sc-for> inRepeat', () => {
    const { text, indexed } = indexText(
      '<x-dc><ul><sc-for list="{{ rows }}" as="row"><li><span class="cell">{{ row.a }}</span></li></sc-for></ul><p>after</p></x-dc>',
    )
    expect(indexed.flagsOf(idOf(text, indexed, 'li')).inRepeat).toBe(true)
    expect(indexed.flagsOf(idOf(text, indexed, 'span')).inRepeat).toBe(true)
    expect(indexed.flagsOf(idOf(text, indexed, 'ul')).inRepeat).toBe(false)
    expect(indexed.flagsOf(idOf(text, indexed, 'p')).inRepeat).toBe(false)
  })

  it('makes an element text-editable only when its children are one text node with no {{', () => {
    const { text, indexed } = indexHome()
    const editable = (tag: string, nth = 0) => indexed.flagsOf(idOf(text, indexed, tag, nth)).textEditable
    expect(editable('h1')).toBe(true)
    expect(editable('div')).toBe(true)
    expect(editable('p', 0)).toBe(false)
    expect(editable('p', 1)).toBe(false)
    expect(editable('li')).toBe(false)
    expect(editable('section')).toBe(false)
    expect(editable('dc-import')).toBe(false)
  })

  it('keeps entity text editable as one text node', () => {
    const text = readFixtureText(edgeFile('lf'))
    const indexed = new SourceIndex().indexFile(EDGE, text)
    expect(indexed.flagsOf(idOf(text, indexed, 'h2')).textEditable).toBe(true)
    expect(indexed.flagsOf(idOf(text, indexed, 'p')).textEditable).toBe(false)
  })

  it('refuses to edit an attribute whose value contains {{', () => {
    const { text, indexed } = indexHome()
    const greeting = idOf(text, indexed, 'p', 0)
    expect(indexed.isAttrEditable(greeting, 'aria-label')).toBe(false)
    expect(indexed.isAttrEditable(idOf(text, indexed, 'p', 1), 'class')).toBe(true)
    expect(indexed.isAttrEditable(idOf(text, indexed, 'img'), 'src')).toBe(true)
    expect(indexed.isAttrEditable(idOf(text, indexed, 'sc-for'), 'list')).toBe(false)
  })
})
