import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode
type Template = DefaultTreeAdapterTypes.Template
type TextNode = DefaultTreeAdapterTypes.TextNode

interface BoardRect {
  x: number
  y: number
  w: number
  h: number
}

interface CanvasJson {
  boards: Record<string, BoardRect>
  order: string[]
  pages: string[]
  designSystems: Record<string, unknown>
}

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const PROJECT = path.join(FIXTURES, 'canvas', 'project')
const FETCHED = path.join(FIXTURES, 'canvas', 'fetched')
const ENDINGS = path.join(FIXTURES, 'endings')
const FORMAT_NOTE = fileURLToPath(new URL('../../plans/v1/research/06-project-format.md', import.meta.url))

const PROJECT_FILES = ['canvas.json', 'home.dc.html', 'card.dc.html', 'ds/core/tokens.json']
const BLOB_FILE_NAME = /^[0-9a-f]{32}\.[a-z0-9]+$/
const BLOB_REF = /\/_blob\/([0-9a-f]{32})/g
const HOLE = /\{\{\s*([\w.$]+)\s*\}\}/
const VARIANTS = ['lf', 'crlf', 'mixed', 'bom', 'nonl'] as const
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const PHRASING_TAGS = new Set(['a', 'b', 'br', 'code', 'em', 'i', 'small', 'span', 'strong', 'sub', 'sup', 'u'])
const SHORTHAND_PROPS = new Set(['margin', 'padding', 'border', 'font', 'background', 'inset', 'flex', 'border-radius'])
const DOCUMENT_ROOT_TAGS = new Set(['html', 'head', 'body'])

function decodeKeepingBom(bytes: Buffer): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
}

function readText(file: string): string {
  return decodeKeepingBom(readFileSync(file))
}

function readJson<T>(file: string): T {
  return JSON.parse(readText(file)) as T
}

function readCanvas(): CanvasJson {
  return readJson<CanvasJson>(path.join(PROJECT, 'canvas.json'))
}

function readHome(): { source: string; elements: Element[] } {
  const source = readText(path.join(PROJECT, 'home.dc.html'))
  return { source, elements: elementsOf(parseLocated(source)) }
}

function parseLocated(source: string) {
  return parse(source, { sourceCodeLocationInfo: true })
}

function childrenOf(node: ParentNode): ParentNode['childNodes'] {
  return node.nodeName === 'template' ? (node as Template).content.childNodes : node.childNodes
}

function elementsOf(root: ParentNode): Element[] {
  const found: Element[] = []
  for (const child of childrenOf(root)) {
    if (!('tagName' in child)) continue
    found.push(child, ...elementsOf(child))
  }
  return found
}

function childElements(element: Element): Element[] {
  return childrenOf(element).filter((child): child is Element => 'tagName' in child)
}

function textChildren(element: Element): string[] {
  return childrenOf(element)
    .filter((child): child is TextNode => child.nodeName === '#text')
    .map((child) => child.value)
}

function attrOf(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value
}

function hasAncestor(element: Element, tagName: string): boolean {
  for (let node = element.parentNode; node; node = 'parentNode' in node ? node.parentNode : null) {
    if (node.nodeName === tagName) return true
  }
  return false
}

function byTag(elements: Element[], tagName: string): Element[] {
  return elements.filter((element) => element.tagName === tagName)
}

function rawAttrText(source: string, element: Element, name: string): string {
  const location = element.sourceCodeLocation?.attrs?.[name]
  if (!location) throw new Error(`<${element.tagName}> has no located ${name} attribute`)
  return source.slice(location.startOffset, location.endOffset)
}

function styleTextOf(element: Element): string {
  return textChildren(element).join('')
}

function inlineDeclarations(style: string): Array<{ prop: string; value: string }> {
  return style
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.includes(':'))
    .map((part) => {
      const colon = part.indexOf(':')
      return { prop: part.slice(0, colon).trim().toLowerCase(), value: part.slice(colon + 1).trim() }
    })
}

function inlineValue(element: Element, prop: string): string | undefined {
  return inlineDeclarations(attrOf(element, 'style') ?? '').find((decl) => decl.prop === prop)?.value
}

function declarationsOf(css: string): Declaration[] {
  const found: Declaration[] = []
  postcss.parse(css).walkDecls((decl) => {
    found.push(decl)
  })
  return found
}

function helmetStyles(elements: Element[]): Element[] {
  return byTag(elements, 'style').filter((style) => hasAncestor(style, 'helmet'))
}

function literalAroundHole(text: string): { before: string; hole: string; after: string } | null {
  const match = HOLE.exec(text)
  if (!match) return null
  return { before: text.slice(0, match.index), hole: match[1] ?? '', after: text.slice(match.index + match[0].length) }
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'number') return [String(value)]
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringLeaves)
  return []
}

function blobIdsIn(text: string): string[] {
  return [...text.matchAll(BLOB_REF)].map((match) => match[1] ?? '')
}

function fetchedBlobs(): string[] {
  return readdirSync(FETCHED).filter((name) => name !== 'support.js')
}

function fetchedBlobId(extension: string): string {
  const name = fetchedBlobs().find((blob) => path.extname(blob) === extension)
  if (!name) throw new Error(`no fetched ${extension} blob`)
  return path.basename(name, extension)
}

function boardKeyFor(canvas: CanvasJson, artboard: string): string {
  const key = Object.keys(canvas.boards).find((board) => path.resolve(PROJECT, board) === path.resolve(PROJECT, artboard))
  if (!key) throw new Error(`canvas.json has no board for ${artboard}`)
  return key
}

describe('canvas fixture snapshot', () => {
  it('holds the project files an Artifact read returns', () => {
    const missing = PROJECT_FILES.filter((file) => !existsSync(path.join(PROJECT, file)))
    expect(missing).toEqual([])
  })

  it('holds support.js and one css and one svg blob saved as <32-hex id>.<ext>', () => {
    expect(readdirSync(FETCHED)).toContain('support.js')
    const blobs = fetchedBlobs()
    expect(blobs.filter((name) => !BLOB_FILE_NAME.test(name))).toEqual([])
    expect(blobs.map((name) => path.extname(name)).sort()).toEqual(['.css', '.svg'])
  })

  it('has the blob CSS reference the SVG blob through url(/_blob/<id>)', () => {
    const svgId = fetchedBlobId('.svg')
    const css = readText(path.join(FETCHED, `${fetchedBlobId('.css')}.css`))
    expect(css).toMatch(new RegExp(`url\\(\\s*['"]?/_blob/${svgId}['"]?\\s*\\)`))
  })

  it('has every /_blob id referenced by the project and the blob CSS saved under fetched/', () => {
    const referencing = [
      ...PROJECT_FILES.map((file) => path.join(PROJECT, file)),
      path.join(FETCHED, `${fetchedBlobId('.css')}.css`),
    ]
    const referenced = new Set(referencing.flatMap((file) => blobIdsIn(readText(file))))
    const saved = new Set(fetchedBlobs().map((name) => name.split('.')[0]))
    expect(referenced.size).toBeGreaterThan(0)
    expect([...referenced].filter((id) => !saved.has(id))).toEqual([])
  })
})

describe('canvas.json', () => {
  it('keys boards by artboard path relative to canvas.json, each with a numeric {x,y,w,h}', () => {
    const canvas = readCanvas()
    expect(() => boardKeyFor(canvas, 'home.dc.html')).not.toThrow()
    const { boards } = canvas
    for (const [key, rect] of Object.entries(boards)) {
      expect(key).toMatch(/\.dc\.html$/)
      expect(existsSync(path.join(PROJECT, key)), key).toBe(true)
      expect([rect.x, rect.y, rect.w, rect.h].every(Number.isFinite), key).toBe(true)
      expect(rect.w, key).toBeGreaterThan(0)
      expect(rect.h, key).toBeGreaterThan(0)
    }
  })

  it('orders every board exactly once', () => {
    const { boards, order } = readCanvas()
    expect([...order].sort()).toEqual(Object.keys(boards).sort())
  })

  it('lists pages as board keys', () => {
    const { boards, pages } = readCanvas()
    expect(Array.isArray(pages)).toBe(true)
    expect(pages.filter((page) => !(page in boards))).toEqual([])
  })

  it('has a designSystems record pointing at ds/core', () => {
    const { designSystems } = readCanvas()
    const targets = stringLeaves(designSystems).map((target) => path.resolve(PROJECT, target))
    const core = path.resolve(PROJECT, 'ds', 'core')
    expect(targets.some((target) => target === core || target === path.join(core, 'tokens.json'))).toBe(true)
  })
})

describe('ds/core/tokens.json', () => {
  const tokenValues = () => stringLeaves(readJson(path.join(PROJECT, 'ds', 'core', 'tokens.json')))

  it('holds colour and spacing tokens', () => {
    const values = tokenValues()
    expect(values.some((value) => /^(#[0-9a-f]{3,8}|(rgb|hsl|oklch)a?\(.+\))$/i.test(value))).toBe(true)
    expect(values.some((value) => /^\d*\.?\d+(px|rem|em)$/.test(value))).toBe(true)
  })

  it('has a token whose value is a literal used in home.dc.html', () => {
    const { elements } = readHome()
    const inline = elements.flatMap((element) => inlineDeclarations(attrOf(element, 'style') ?? ''))
    const helmet = helmetStyles(elements).flatMap((style) => declarationsOf(styleTextOf(style)))
    const used = new Set(
      [...inline, ...helmet].flatMap((decl) => [decl.value, ...decl.value.split(/\s+/)]).map((value) => value.toLowerCase()),
    )
    expect(tokenValues().filter((value) => used.has(value.toLowerCase()))).not.toEqual([])
  })
})

describe('home.dc.html', () => {
  it('loads the runtime with <script src="./support.js">', () => {
    const scripts = byTag(readHome().elements, 'script')
    expect(scripts.map((script) => attrOf(script, 'src'))).toContain('./support.js')
  })

  it('has one <x-dc> root whose single-quoted data-props $preview equals its canvas.json board size', () => {
    const { source, elements } = readHome()
    const roots = byTag(elements, 'x-dc')
    expect(roots).toHaveLength(1)
    const root = roots[0] as Element
    expect(rawAttrText(source, root, 'data-props')).toMatch(/^data-props\s*=\s*'/)
    const props = JSON.parse(attrOf(root, 'data-props') ?? '') as { $preview: unknown }
    const canvas = readCanvas()
    const board = canvas.boards[boardKeyFor(canvas, 'home.dc.html')] as BoardRect
    expect(props.$preview).toEqual({ w: board.w, h: board.h })
  })

  it('has a <helmet><style> with at least two rules, one inside @media', () => {
    const styles = helmetStyles(readHome().elements)
    expect(styles.length).toBeGreaterThan(0)
    const rules: Rule[] = []
    for (const style of styles) postcss.parse(styleTextOf(style)).walkRules((rule) => {
      rules.push(rule)
    })
    expect(rules.length).toBeGreaterThanOrEqual(2)
    expect(rules.some((rule) => rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'media')).toBe(true)
  })

  it('has a Google Fonts css2 <link> inside <helmet>', () => {
    const links = byTag(readHome().elements, 'link').filter((link) => hasAncestor(link, 'helmet'))
    expect(links.some((link) => (attrOf(link, 'href') ?? '').startsWith('https://fonts.googleapis.com/css2?'))).toBe(true)
  })

  it('has an inline style that mixes a {{ hole }} value with literal declarations', () => {
    const mixed = readHome().elements.filter((element) => {
      const values = inlineDeclarations(attrOf(element, 'style') ?? '').map((decl) => decl.value)
      return values.some((value) => HOLE.test(value)) && values.some((value) => !HOLE.test(value))
    })
    expect(mixed).not.toEqual([])
  })

  it('has a text node with literal text before a {{ hole }}', () => {
    const texts = readHome().elements.flatMap(textChildren)
    expect(texts.some((text) => literalAroundHole(text)?.before.trim())).toBe(true)
  })

  it('has a plain attribute with literal text on both sides of a {{ hole }}', () => {
    const attrs = readHome().elements.flatMap((element) => element.attrs)
    const mixed = attrs.filter((attr) => {
      const parts = literalAroundHole(attr.value)
      return attr.name !== 'style' && parts?.before.trim() && parts.after.trim()
    })
    expect(mixed).not.toEqual([])
  })

  it('has an <sc-for list="{{ items }}"> with a template element', () => {
    const loops = byTag(readHome().elements, 'sc-for')
    expect(loops.length).toBeGreaterThan(0)
    for (const loop of loops) {
      expect(attrOf(loop, 'list')).toMatch(new RegExp(`^${HOLE.source}$`))
      expect(childElements(loop).length).toBeGreaterThan(0)
    }
  })

  it('has an <sc-if> with a branch element', () => {
    const branches = byTag(readHome().elements, 'sc-if')
    expect(branches.length).toBeGreaterThan(0)
    expect(branches.every((branch) => childElements(branch).length > 0)).toBe(true)
  })

  it('imports ./card.dc.html with <dc-import>', () => {
    const imports = byTag(readHome().elements, 'dc-import')
    expect(imports.map((element) => attrOf(element, 'src'))).toContain('./card.dc.html')
  })

  it('has a flex row with three children of different inline widths', () => {
    const rows = readHome().elements.filter((element) => {
      if (inlineValue(element, 'display') !== 'flex') return false
      if (!['row', undefined].includes(inlineValue(element, 'flex-direction'))) return false
      const widths = childElements(element).map((child) => inlineValue(child, 'width'))
      return widths.length === 3 && widths.every(Boolean) && new Set(widths).size === 3
    })
    expect(rows).not.toEqual([])
  })

  it('has an absolutely positioned element and a transformed element', () => {
    const { elements } = readHome()
    expect(elements.some((element) => inlineValue(element, 'position') === 'absolute')).toBe(true)
    expect(elements.some((element) => inlineValue(element, 'transform'))).toBe(true)
  })

  it('has a heading whose only child is one text node', () => {
    const headings = readHome().elements.filter((element) => /^h[1-6]$/.test(element.tagName))
    const single = headings.filter((heading) => {
      const [only, ...rest] = childrenOf(heading)
      return rest.length === 0 && only?.nodeName === '#text' && (only as TextNode).value.trim() !== ''
    })
    expect(single).not.toEqual([])
  })

  it('has an element with text and inline element children', () => {
    const mixed = readHome().elements.filter(
      (element) =>
        textChildren(element).some((text) => text.trim()) &&
        childElements(element).some((child) => PHRASING_TAGS.has(child.tagName)),
    )
    expect(mixed).not.toEqual([])
  })

  it('references a /_blob image and the blob stylesheet', () => {
    const { elements } = readHome()
    const images = byTag(elements, 'img').map((img) => attrOf(img, 'src') ?? '')
    expect(images.some((src) => /^\/_blob\/[0-9a-f]{32}$/.test(src))).toBe(true)
    const sheets = byTag(elements, 'link')
      .filter((link) => attrOf(link, 'rel') === 'stylesheet')
      .map((link) => attrOf(link, 'href'))
    expect(sheets).toContain(`/_blob/${fetchedBlobId('.css')}`)
  })

  it('has a <script data-dc-script> with class Component extends DCLogic and renderVals()', () => {
    const scripts = byTag(readHome().elements, 'script').filter((script) =>
      script.attrs.some((attr) => attr.name === 'data-dc-script'),
    )
    expect(scripts).toHaveLength(1)
    const body = textChildren(scripts[0] as Element).join('')
    expect(body).toMatch(/class\s+Component\s+extends\s+DCLogic\b/)
    expect(body).toMatch(/\brenderVals\s*\(\s*\)\s*\{/)
  })
})

describe('line-ending fixtures', () => {
  const bytesOf = (variant: string) => readFileSync(path.join(ENDINGS, `edge.${variant}.dc.html`))
  const textOf = (variant: string) => decodeKeepingBom(bytesOf(variant))
  const lfWithCrlf = (text: string) => text.replace(/\r\n/g, '\n')
  const startsWithBom = (bytes: Buffer) => bytes.subarray(0, 3).equals(UTF8_BOM)

  it('lf has only LF endings, no BOM and a final newline', () => {
    const bytes = bytesOf('lf')
    expect(bytes.includes(0x0d)).toBe(false)
    expect(startsWithBom(bytes)).toBe(false)
    expect(bytes.at(-1)).toBe(0x0a)
  })

  it('crlf is lf with every LF written as CRLF', () => {
    const text = textOf('crlf')
    expect(text).toMatch(/\r\n/)
    expect(text).not.toMatch(/(^|[^\r])\n/)
    expect(lfWithCrlf(text)).toBe(textOf('lf'))
  })

  it('mixed is lf with some lines ending CRLF and some LF', () => {
    const text = textOf('mixed')
    expect(text).toMatch(/\r\n/)
    expect(text).toMatch(/(^|[^\r])\n/)
    expect(lfWithCrlf(text)).toBe(textOf('lf'))
  })

  it('bom is lf prefixed with EF BB BF', () => {
    const bytes = bytesOf('bom')
    expect(startsWithBom(bytes)).toBe(true)
    expect(bytes.subarray(3).equals(bytesOf('lf'))).toBe(true)
  })

  it('nonl is lf without its final newline', () => {
    const bytes = bytesOf('nonl')
    expect(bytes.at(-1)).not.toBe(0x0a)
    expect(Buffer.concat([bytes, Buffer.from('\n')]).equals(bytesOf('lf'))).toBe(true)
  })

  it('only bom carries a BOM', () => {
    expect(VARIANTS.filter((variant) => startsWithBom(bytesOf(variant)))).toEqual(['bom'])
  })

  it.each(VARIANTS.filter((variant) => variant !== 'lf'))('%s locates the same source elements as lf', (variant) => {
    const locatedTags = (text: string) =>
      elementsOf(parseLocated(text))
        .filter((element) => element.sourceCodeLocation && !DOCUMENT_ROOT_TAGS.has(element.tagName))
        .map((element) => element.tagName)
    expect(locatedTags(textOf(variant))).toEqual(locatedTags(textOf('lf')))
  })

  describe('covers the golden edge cases', () => {
    const source = () => textOf('lf')
    const elements = () => elementsOf(parseLocated(source()))
    const allDeclarations = () => {
      const all = elements()
      return [
        ...helmetStyles(all).flatMap((style) => declarationsOf(styleTextOf(style))),
        ...all.flatMap((element) => declarationsOf(attrOf(element, 'style') ?? '')),
      ]
    }

    it('HTML and CSS comments', () => {
      expect(source()).toMatch(/<!--[\s\S]*?-->/)
      const css = helmetStyles(elements()).map(styleTextOf).join('\n')
      expect(css).toMatch(/\/\*[\s\S]*?\*\//)
    })

    it('odd indentation: tab-indented and space-indented lines', () => {
      expect(source()).toMatch(/^\t+\S/m)
      expect(source()).toMatch(/^ +\S/m)
    })

    it('a shorthand with several values', () => {
      const shorthands = allDeclarations().filter((decl) => SHORTHAND_PROPS.has(decl.prop) && /\s/.test(decl.value.trim()))
      expect(shorthands).not.toEqual([])
    })

    it('!important', () => {
      expect(allDeclarations().some((decl) => decl.important)).toBe(true)
    })

    it('var() with a fallback and a mixed-case name', () => {
      const values = allDeclarations().map((decl) => decl.value)
      expect(values.some((value) => /var\(\s*--[\w-]*[A-Z][\w-]*\s*,/.test(value))).toBe(true)
    })

    it('a <helmet><style> and inline styles', () => {
      expect(helmetStyles(elements()).length).toBeGreaterThan(0)
      expect(elements().some((element) => attrOf(element, 'style'))).toBe(true)
    })

    it('void elements', () => {
      const located = elements().filter((element) => element.sourceCodeLocation)
      expect(located.some((element) => VOID_TAGS.has(element.tagName) && element.tagName !== 'meta')).toBe(true)
    })

    it('a table whose <tbody> is implicit', () => {
      expect(source()).not.toMatch(/<tbody/i)
      const tbodies = byTag(elements(), 'tbody')
      expect(tbodies.length).toBeGreaterThan(0)
      expect(tbodies.every((tbody) => !tbody.sourceCodeLocation)).toBe(true)
    })

    it('the entities &amp; &nbsp; &#8217;', () => {
      for (const entity of ['&amp;', '&nbsp;', '&#8217;']) expect(source()).toContain(entity)
    })

    it('an element with text and inline element children', () => {
      const mixed = elements().filter(
        (element) =>
          textChildren(element).some((text) => text.trim()) &&
          childElements(element).some((child) => PHRASING_TAGS.has(child.tagName)),
      )
      expect(mixed).not.toEqual([])
    })
  })

  describe.each(VARIANTS)('edge.%s.dc.html offsets', (variant) => {
    const source = () => textOf(variant)
    const located = () => elementsOf(parseLocated(source())).filter((element) => element.sourceCodeLocation)

    it('decodes with the BOM kept only for bom', () => {
      expect(source().charCodeAt(0) === 0xfeff).toBe(variant === 'bom')
    })

    it('slices every parse5 startOffset to the element own start tag', () => {
      const text = source()
      expect(located().length).toBeGreaterThan(0)
      for (const element of located()) {
        const location = element.sourceCodeLocation!
        expect(location.startOffset).toBe(location.startTag?.startOffset)
        const startTag = text.slice(location.startOffset, location.startTag?.endOffset)
        expect(startTag.toLowerCase().startsWith(`<${element.tagName.toLowerCase()}`)).toBe(true)
        expect(startTag).toMatch(/>$/)
        expect(startTag.slice(1)).not.toMatch(/</)
      }
    })

    it('slices every attribute location to name="value"', () => {
      const text = source()
      const attrs = located().flatMap((element) =>
        Object.entries(element.sourceCodeLocation?.attrs ?? {}).map(([name, location]) => ({
          name,
          value: attrOf(element, name),
          slice: text.slice(location.startOffset, location.endOffset),
        })),
      )
      expect(attrs.length).toBeGreaterThan(0)
      for (const { name, value, slice } of attrs) {
        expect(slice.toLowerCase().startsWith(name.toLowerCase())).toBe(true)
        expect(slice.slice(name.length)).toMatch(/^(\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?$/)
        if (value && !slice.includes('&')) expect(slice).toContain(value)
      }
    })

    it('slices PostCSS decl offsets to the declaration text in the helmet <style>', () => {
      const text = source()
      const styles = helmetStyles(elementsOf(parseLocated(text)))
      let checked = 0
      for (const style of styles) {
        const body = childrenOf(style)[0] as TextNode
        const start = body.sourceCodeLocation!.startOffset
        for (const decl of declarationsOf(text.slice(start, body.sourceCodeLocation!.endOffset))) {
          const slice = text.slice(start + decl.source!.start!.offset, start + decl.source!.end!.offset)
          expect(slice.replace(/;$/, '')).toBe(decl.toString())
          checked += 1
        }
      }
      expect(checked).toBeGreaterThan(0)
    })

    it('slices PostCSS decl offsets to the declaration text in inline style values', () => {
      const text = source()
      let checked = 0
      for (const element of located().filter((candidate) => attrOf(candidate, 'style'))) {
        const location = element.sourceCodeLocation!.attrs!.style!
        const opening = /^style\s*=\s*["']/i.exec(text.slice(location.startOffset, location.endOffset))
        expect(opening).not.toBeNull()
        const valueStart = location.startOffset + opening![0].length
        for (const decl of declarationsOf(text.slice(valueStart, location.endOffset - 1))) {
          const slice = text.slice(valueStart + decl.source!.start!.offset, valueStart + decl.source!.end!.offset)
          expect(slice.replace(/;$/, '')).toBe(decl.toString())
          checked += 1
        }
      }
      expect(checked).toBeGreaterThan(0)
    })
  })
})

describe('research/06-project-format.md', () => {
  const note = () => readText(FORMAT_NOTE)
  const paragraphs = () => note().split(/\n\s*\n/)
  const someParagraph = (...patterns: RegExp[]) =>
    paragraphs().some((paragraph) => patterns.every((pattern) => pattern.test(paragraph)))

  it('records the format as fixtured', () => {
    for (const term of ['canvas.json', '.dc.html', '<x-dc>', '<helmet>', 'support.js', '/_blob/', 'ds/core/tokens.json']) {
      expect(note()).toContain(term)
    }
  })

  it('marks the sc-for, sc-if and dc-import attribute names and data-props placement as assumptions', () => {
    for (const term of [/sc-for/, /sc-if/, /dc-import/, /data-props/]) {
      expect(someParagraph(/assum/i, term), String(term)).toBe(true)
    }
  })

  it('says each live M0 check was not run, per the adjustment from Ron', () => {
    expect(someParagraph(/not (been )?run/i, /adjustment/i)).toBe(true)
    const checks = [/pull/i, /round[- ]trip/i, /save footprint/i, /theme[- ]menu/i, /partial publish/i, /version history/i, /design[- ]system/i]
    for (const check of checks) expect(note(), String(check)).toMatch(check)
  })

  it('applies the kill bar as go ahead with every differentiator kept', () => {
    expect(someParagraph(/kill bar/i, /go ahead/i)).toBe(true)
    for (const feature of [/snapping/i, /alt-measure/i, /auto layout handles/i, /hug \/ fill \/ fixed/i, /token binding/i]) {
      expect(note(), String(feature)).toMatch(feature)
    }
  })

  it('keeps the line-level merge with no node-diff3 retry', () => {
    expect(someParagraph(/line-level merge|git merge-file/i, /node-diff3/)).toBe(true)
  })

  it('decides the token write form: tokens.json picks write the literal, :root --* picks write var(--x)', () => {
    expect(someParagraph(/tokens\.json/, /literal/i)).toBe(true)
    expect(someParagraph(/:root/, /var\(--/)).toBe(true)
  })

  it('leaves the copy recipe for a live run', () => {
    expect(someParagraph(/copy recipe/i, /live/i)).toBe(true)
  })
})
