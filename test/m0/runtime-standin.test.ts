import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM, requestInterceptor, type DOMWindow } from 'jsdom'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { beforeAll, describe, expect, it } from 'vitest'

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode
type TextNode = DefaultTreeAdapterTypes.TextNode

type Vals = Record<string, unknown>
type ComponentClass = new () => { renderVals(): Vals }

interface StampedHome {
  html: string
  idOf: Map<Element, string>
  elements: Element[]
}

const CANVAS = fileURLToPath(new URL('../fixtures/canvas/', import.meta.url))
const PROJECT = path.join(CANVAS, 'project')
const FETCHED = path.join(CANVAS, 'fetched')
const PROJECT_ORIGIN = 'http://127.0.0.1:5301'
const PROJECT_PREFIX = '/project/fixture-prefix/'
const HOME_URL = `${PROJECT_ORIGIN}${PROJECT_PREFIX}home.dc.html`
const HOLE = /\{\{\s*([\w.$]+)\s*\}\}/
const CONTROL_TAGS = new Set(['sc-for', 'sc-if', 'dc-import', 'helmet', 'script'])
const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}
const QUIET_MS = 100

function readText(file: string): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(readFileSync(file))
}

function elementsOf(root: ParentNode): Element[] {
  return root.childNodes
    .filter((child): child is Element => 'tagName' in child)
    .flatMap((child) => [child, ...elementsOf(child)])
}

function attrOf(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value
}

function ancestorTags(element: Element): string[] {
  const tags: string[] = []
  for (let node = element.parentNode; node && 'tagName' in node; node = node.parentNode) tags.push(node.tagName)
  return tags
}

function isInside(element: Element, tagName: string): boolean {
  return ancestorTags(element).includes(tagName)
}

function holeNameIn(text: string | undefined): string | undefined {
  return HOLE.exec(text ?? '')?.[1]
}

function fillHoles(text: string, vals: Vals): string {
  return text.replace(new RegExp(HOLE.source, 'g'), (_hole, name: string) => String(vals[name]))
}

function stampEdIds(source: string): StampedHome {
  const elements = elementsOf(parse(source, { sourceCodeLocationInfo: true }))
  const stamped = elements.filter((element) => element.sourceCodeLocation && (element.tagName === 'x-dc' || isInside(element, 'x-dc')))
  const idOf = new Map(stamped.map((element, index) => [element, `ed${index + 1}`]))
  let html = source
  for (const element of [...stamped].reverse()) {
    const tagStart = element.sourceCodeLocation!.startOffset
    const rawName = /^<([^\s/>]+)/.exec(source.slice(tagStart))![1]!
    const insertAt = tagStart + 1 + rawName.length
    html = `${html.slice(0, insertAt)} data-ed-id="${idOf.get(element)}"${html.slice(insertAt)}`
  }
  return { html, idOf, elements }
}

function renderValsOf(script: string, props: unknown): Vals {
  const defineComponent = new Function('DCLogic', `${script}\nreturn Component`) as (base: unknown) => ComponentClass
  const Component = defineComponent(
    class {
      props = props
      state = {}
    },
  )
  return new Component().renderVals()
}

function blobFile(id: string): string | null {
  const name = readdirSync(FETCHED).find((file) => file.startsWith(`${id}.`))
  return name ? path.join(FETCHED, name) : null
}

function fixtureFileFor(url: URL): string | null {
  if (url.origin !== PROJECT_ORIGIN) return null
  const blob = /^\/_blob\/([0-9a-f]{32})$/.exec(url.pathname)
  if (blob) return blobFile(blob[1]!)
  if (!url.pathname.startsWith(PROJECT_PREFIX)) return null
  const relative = decodeURIComponent(url.pathname.slice(PROJECT_PREFIX.length))
  return relative === 'support.js' ? path.join(FETCHED, 'support.js') : path.join(PROJECT, relative)
}

function serveFixture(url: URL): Response {
  const file = fixtureFileFor(url)
  try {
    if (!file) throw new Error(`outside the fixture: ${url.href}`)
    const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream'
    return new Response(readFileSync(file), { headers: { 'content-type': type } })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function recordHostAccess(window: DOMWindow, log: string[]): void {
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) {
    Object.defineProperty(window, name, {
      configurable: true,
      get: () => {
        log.push(name)
        return undefined
      },
    })
  }
  Object.defineProperty(window.document, 'cookie', {
    configurable: true,
    get: () => {
      log.push('cookie')
      return ''
    },
    set: () => {
      log.push('cookie')
    },
  })
  window.postMessage = () => {
    log.push('postMessage')
  }
}

function loaded(window: DOMWindow): Promise<void> {
  if (window.document.readyState === 'complete') return Promise.resolve()
  return new Promise((resolve) => window.addEventListener('load', () => resolve(), { once: true }))
}

function quiet(window: DOMWindow): Promise<void> {
  return new Promise((resolve) => {
    const observer = new window.MutationObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(done, QUIET_MS)
    })
    let timer = window.setTimeout(done, QUIET_MS)
    function done() {
      observer.disconnect()
      resolve()
    }
    observer.observe(window.document, { subtree: true, childList: true, attributes: true, characterData: true })
  })
}

describe('fetched/support.js stand-in runtime on home.dc.html', () => {
  let home: StampedHome
  let vals: Vals
  let page: DOMWindow['document']
  const requests: string[] = []
  const hostAccess: string[] = []
  let hostAccessWhileRendering: string[]

  const idOf = (element: Element) => home.idOf.get(element)!
  const rendered = (element: Element) => [...page.querySelectorAll(`[data-ed-id="${idOf(element)}"]`)]
  const sourceByTag = (tagName: string) => home.elements.filter((element) => element.tagName === tagName)
  const stampedOutside = (...tags: string[]) =>
    [...home.idOf.keys()].filter((element) => !tags.some((tag) => element.tagName === tag || isInside(element, tag)))

  beforeAll(async () => {
    home = stampEdIds(readText(path.join(PROJECT, 'home.dc.html')))
    const root = home.elements.find((element) => element.tagName === 'x-dc')!
    const script = home.elements.find((element) => element.attrs.some((attr) => attr.name === 'data-dc-script'))!
    const scriptText = (script.childNodes[0] as TextNode).value
    vals = renderValsOf(scriptText, JSON.parse(attrOf(root, 'data-props') ?? '{}'))

    const dom = new JSDOM(home.html, {
      url: HOME_URL,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      resources: {
        interceptors: [
          requestInterceptor((request) => {
            requests.push(request.url)
            return serveFixture(new URL(request.url))
          }),
        ],
      },
      beforeParse(window) {
        recordHostAccess(window, hostAccess)
        window.fetch = async (input: RequestInfo | URL) => {
          const url = new URL(String(input), window.location.href)
          requests.push(url.href)
          return serveFixture(url)
        }
      },
    })
    page = dom.window.document
    await loaded(dom.window)
    await quiet(dom.window)
    hostAccessWhileRendering = [...hostAccess]
  }, 10_000)

  it('renders every <sc-for> repeat with the template node data-ed-id', () => {
    const loops = sourceByTag('sc-for')
    expect(loops.length).toBeGreaterThan(0)
    for (const loop of loops) {
      const items = vals[holeNameIn(attrOf(loop, 'list'))!]
      expect(Array.isArray(items)).toBe(true)
      expect((items as unknown[]).length).toBeGreaterThan(1)
      const templates = loop.childNodes.filter((child): child is Element => 'tagName' in child)
      for (const template of templates) expect(rendered(template).length).toBe((items as unknown[]).length)
    }
  })

  it('fills a text node hole from renderVals()', () => {
    const owner = stampedOutside('sc-for', 'sc-if').find((element) =>
      element.childNodes.some((child) => child.nodeName === '#text' && HOLE.test((child as TextNode).value)),
    )!
    const text = owner.childNodes.find((child) => child.nodeName === '#text' && HOLE.test((child as TextNode).value)) as TextNode
    const name = holeNameIn(text.value)!
    expect(vals[name]).toBeDefined()
    expect(rendered(owner)[0]?.textContent).toContain(fillHoles(text.value, vals).trim())
  })

  it('fills an attribute hole between literal text from renderVals()', () => {
    const owner = stampedOutside('sc-for', 'sc-if').find((element) =>
      element.attrs.some((attr) => attr.name !== 'style' && HOLE.test(attr.value)),
    )!
    const attr = owner.attrs.find((candidate) => candidate.name !== 'style' && HOLE.test(candidate.value))!
    expect(vals[holeNameIn(attr.value)!]).toBeDefined()
    expect(rendered(owner)[0]?.getAttribute(attr.name)).toBe(fillHoles(attr.value, vals))
  })

  it('fills an inline style hole and keeps the literal declarations', () => {
    const owner = stampedOutside('sc-for', 'sc-if').find((element) => HOLE.test(attrOf(element, 'style') ?? ''))!
    const props = (attrOf(owner, 'style') ?? '')
      .split(';')
      .filter((part) => part.includes(':'))
      .map((part) => part.slice(0, part.indexOf(':')).trim())
    const live = rendered(owner)[0] as HTMLElement
    expect(live.getAttribute('style')).not.toMatch(/\{\{/)
    for (const prop of props) expect(live.style.getPropertyValue(prop), prop).not.toBe('')
  })

  it('leaves out the false <sc-if> branch', () => {
    const branches = sourceByTag('sc-if')
    expect(branches.length).toBeGreaterThan(0)
    for (const branch of branches) {
      const condition = branch.attrs.map((attr) => holeNameIn(attr.value)).find(Boolean)!
      expect(vals[condition]).toBeFalsy()
      const inside = elementsOf(branch).filter((element) => home.idOf.has(element))
      expect(inside.length).toBeGreaterThan(0)
      expect(inside.filter((element) => rendered(element).length > 0).map(idOf)).toEqual([])
    }
  })

  it('mounts the <dc-import> content fetched from its relative src', () => {
    const imports = sourceByTag('dc-import')
    expect(imports.length).toBeGreaterThan(0)
    const homeSource = readText(path.join(PROJECT, 'home.dc.html'))
    for (const element of imports) {
      const src = attrOf(element, 'src')!
      expect(requests).toContain(new URL(src, HOME_URL).href)
      const imported = elementsOf(parse(readText(path.join(PROJECT, src))))
        .filter((candidate) => !['script', 'style'].includes(candidate.tagName))
        .flatMap((candidate) => candidate.childNodes)
        .filter((child): child is TextNode => child.nodeName === '#text')
        .map((child) => child.value.trim())
        .filter((text) => text && !HOLE.test(text) && !homeSource.includes(text))
      expect(imported.length).toBeGreaterThan(0)
      for (const text of imported) expect(page.body.textContent).toContain(text)
    }
  })

  it('keeps data-ed-id on every other source element, rendered once', () => {
    const others = stampedOutside(...CONTROL_TAGS)
    expect(others.length).toBeGreaterThan(0)
    const counts = others.map((element) => [`<${element.tagName}> ${idOf(element)}`, rendered(element).length])
    expect(counts.filter(([, count]) => count !== 1)).toEqual([])
  })

  it('never touches storage or posts to its parent', () => {
    expect(hostAccessWhileRendering).toEqual([])
  })
})
