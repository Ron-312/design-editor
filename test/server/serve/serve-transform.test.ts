import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { describe, expect, it } from 'vitest'
import { transformServedDocument } from '../../../src/server/serve/serve-transform'
import { SourceIndex, type IndexedFile } from '../../../src/server/source/source-index'
import type { EdId, ProjectPath } from '../../../src/shared/types'

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url))
const HOME_FILE = path.join(FIXTURES, 'canvas', 'project', 'home.dc.html')
const VARIANTS = ['lf', 'crlf', 'mixed', 'bom', 'nonl'] as const
const HOME = 'project/home.dc.html' as ProjectPath
const PROBE_MARKER = '/* probe-under-test */'
const PROBE_SCRIPT = `${PROBE_MARKER}(() => {})()`
const NONCE_SOURCE = /^[A-Za-z0-9+/_-]{22,}={0,2}$/
const PLANTED_NONCE = 'planted-nonce'

const edgeFile = (variant: string) => path.join(FIXTURES, 'endings', `edge.${variant}.dc.html`)

function readFixtureText(file: string): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(readFileSync(file))
}

function indexText(text: string, file: ProjectPath = HOME): IndexedFile {
  return new SourceIndex().indexFile(file, text)
}

function serve(indexed: IndexedFile) {
  return transformServedDocument(indexed, { probeScript: PROBE_SCRIPT, hidden: [], locked: [] })
}

function elementsOf(root: ParentNode): Element[] {
  return root.childNodes
    .filter((child): child is Element => 'tagName' in child)
    .flatMap((child) => [child, ...elementsOf(child)])
}

function parsed(html: string): Element[] {
  return elementsOf(parse(html, { sourceCodeLocationInfo: true }))
}

function attrOf(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value
}

function scriptsOf(html: string): Element[] {
  return parsed(html).filter((element) => element.tagName === 'script')
}

function probeScriptOf(html: string, nonce: string): Element {
  const probe = scriptsOf(html).find((script) => attrOf(script, 'nonce') === nonce)
  if (!probe) throw new Error('no script carries the response nonce')
  return probe
}

function textOf(element: Element): string {
  return element.childNodes.map((child) => ('value' in child ? child.value : '')).join('')
}

function tagAt(text: string, indexed: IndexedFile, id: EdId): string {
  const range = indexed.locate(id)!.startTag
  return /^<([^\s/>]+)/.exec(text.slice(range.start, range.end))![1]!.toLowerCase()
}

/** The served bytes minus the probe element and the stamped ids, which is what the file on disk must equal. */
function withoutInjections(html: string, nonce: string): string {
  const location = probeScriptOf(html, nonce).sourceCodeLocation!
  const withoutProbe = html.slice(0, location.startOffset) + html.slice(location.endOffset)
  return withoutProbe.replace(/\sdata-ed-id=("[^"]*"|'[^']*'|[^\s>]+)/g, '')
}

function withPlantedNonces(text: string): string {
  return text
    .replace('<script src="./support.js">', `<script nonce="${PLANTED_NONCE}" src="./support.js">`)
    .replace('    <style>', `    <style Nonce="${PLANTED_NONCE}">`)
}

describe('transformServedDocument stamps data-ed-id in the served bytes only', () => {
  const text = readFixtureText(HOME_FILE)
  const indexed = indexText(text)

  it('stamps every indexed element with its own id, in document order', () => {
    const { html } = serve(indexed)
    const stamped = parsed(html).filter((element) => attrOf(element, 'data-ed-id') !== undefined)
    expect(stamped.map((element) => attrOf(element, 'data-ed-id'))).toEqual(indexed.ids)
  })

  it('puts each id on the element the index located for it', () => {
    const { html } = serve(indexed)
    const stamped = parsed(html).filter((element) => attrOf(element, 'data-ed-id') !== undefined)
    expect(stamped.length).toBeGreaterThan(20)
    for (const element of stamped) {
      const id = attrOf(element, 'data-ed-id') as EdId
      expect(element.tagName, id).toBe(tagAt(text, indexed, id))
    }
  })

  it.each(VARIANTS)('changes nothing else in the %s edge fixture', (variant) => {
    const edgeText = readFixtureText(edgeFile(variant))
    const { html, nonce } = serve(indexText(edgeText, 'project/edge.dc.html' as ProjectPath))
    expect(html).not.toBe(edgeText)
    expect(withoutInjections(html, nonce)).toBe(edgeText)
  })

  it('changes nothing else in home.dc.html', () => {
    const { html, nonce } = serve(indexed)
    expect(withoutInjections(html, nonce)).toBe(text)
  })
})

describe('transformServedDocument injects the nonce probe', () => {
  const text = readFixtureText(HOME_FILE)
  const indexed = indexText(text)

  it('injects the probe as the first script, inside <head>, ahead of support.js', () => {
    const { html, nonce } = serve(indexed)
    const [first, ...rest] = scriptsOf(html)
    expect(attrOf(first!, 'nonce')).toBe(nonce)
    expect((first!.parentNode as Element).tagName).toBe('head')
    expect(rest.map((script) => attrOf(script, 'src'))).toContain('./support.js')
  })

  it('carries the bundled probe source in the injected script', () => {
    const { html, nonce } = serve(indexed)
    expect(textOf(probeScriptOf(html, nonce))).toContain(PROBE_MARKER)
  })

  it('injects the probe into the implied <head> of a page that writes none', () => {
    const headless = '<!doctype html>\n<script src="./support.js"></script>\n<x-dc data-props=\'{}\'>\n  <p>Hi</p>\n</x-dc>\n'
    const { html, nonce } = serve(indexText(headless))
    const [first] = scriptsOf(html)
    expect(attrOf(first!, 'nonce')).toBe(nonce)
    expect((first!.parentNode as Element).tagName).toBe('head')
  })

  it('injects the probe ahead of an inline project script that opens <head>', () => {
    const inlineFirst = text.replace('<head>\n', '<head>\n<script>window.projectFirst = true</script>\n')
    const { html, nonce } = serve(indexText(inlineFirst))
    const [first, second] = scriptsOf(html)
    expect(attrOf(first!, 'nonce')).toBe(nonce)
    expect(textOf(second!)).toContain('projectFirst')
  })

  it('uses a fresh CSP nonce for every response', () => {
    const nonces = Array.from({ length: 50 }, () => serve(indexed).nonce)
    expect(new Set(nonces).size).toBe(nonces.length)
    for (const nonce of nonces) expect(nonce).toMatch(NONCE_SOURCE)
  })

  it('strips every nonce already in the markup, whatever its case', () => {
    const planted = withPlantedNonces(text)
    expect(planted.match(new RegExp(PLANTED_NONCE, 'g'))).toHaveLength(2)
    const { html, nonce } = serve(indexText(planted))
    expect(html).not.toContain(PLANTED_NONCE)
    const withNonce = parsed(html).filter((element) => attrOf(element, 'nonce') !== undefined)
    expect(withNonce.map((element) => attrOf(element, 'nonce'))).toEqual([nonce])
  })

  it('still stamps the element whose nonce it stripped', () => {
    const planted = withPlantedNonces(text)
    const plantedIndex = indexText(planted)
    const { html } = serve(plantedIndex)
    const support = scriptsOf(html).find((script) => attrOf(script, 'src') === './support.js')!
    expect(plantedIndex.ids).toContain(attrOf(support, 'data-ed-id'))
  })
})
