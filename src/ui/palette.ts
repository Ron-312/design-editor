import type { BoardIndex } from '../shared/protocol'
import type { EdId, TemplateNode } from '../shared/types'
import type { ActionRegistry, Platform } from './actions/registry'
import type { EditorAction, Unsubscribe } from './plugin-api'

export type PaletteItem =
  | { readonly kind: 'action'; readonly action: EditorAction }
  | {
      readonly kind: 'layer'
      readonly edId: EdId
      readonly name: string
      readonly tag: string
      readonly classes: readonly string[]
      readonly text: string
    }

/** What `navigator.keyboard.getLayoutMap()` resolves to: the character each key `code` prints. */
export type KeyboardLayout = Pick<ReadonlyMap<string, string>, 'get'>

/** The key `code` of each punctuation character on a US layout. */
const US_PUNCTUATION_CODES: Readonly<Record<string, string>> = {
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '`': 'Backquote',
}

/** Apple's modifier order. */
const MAC_GLYPHS: readonly (readonly [string, string])[] = [
  ['Ctrl', '⌃'],
  ['Alt', '⌥'],
  ['Shift', '⇧'],
  ['Mod', '⌘'],
]

const openRequests = new Set<() => void>()

export function requestPaletteOpen(): void {
  for (const open of openRequests) open()
}

export function onPaletteOpenRequest(open: () => void): Unsubscribe {
  openRequests.add(open)
  return () => {
    openRequests.delete(open)
  }
}

/** Shift or Alt changes the character a punctuation key types, so the registry reaches such a chord through the key's position. */
function punctuationLabel(key: string, modifiers: readonly string[], layout: KeyboardLayout | undefined): string {
  const reachedThroughCode = modifiers.includes('Shift') || modifiers.includes('Alt')
  const code = US_PUNCTUATION_CODES[key]
  if (!reachedThroughCode || !code) return key
  return layout?.get(code) ?? key
}

function keyLabel(key: string, modifiers: readonly string[], layout: KeyboardLayout | undefined): string {
  if (key.length > 1) return key
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase()
  return punctuationLabel(key, modifiers, layout)
}

/** `Mod+Shift+Z` as `⇧⌘Z` on macOS and `Ctrl+Shift+Z` on Windows. */
export function shortcutGlyphs(kbd: string, platform: Platform, layout?: KeyboardLayout): string {
  const key = kbd.endsWith('+') ? '+' : kbd.slice(kbd.lastIndexOf('+') + 1)
  const modifiers = kbd.slice(0, kbd.length - key.length).split('+')
  const label = keyLabel(key, modifiers, layout)
  if (platform === 'mac') {
    return MAC_GLYPHS.filter(([modifier]) => modifiers.includes(modifier)).map(([, glyph]) => glyph).join('') + label
  }
  const ctrl = modifiers.includes('Mod') || modifiers.includes('Ctrl') ? ['Ctrl'] : []
  return [...ctrl, ...['Alt', 'Shift'].filter((modifier) => modifiers.includes(modifier)), label].join('+')
}

function classesOf(node: TemplateNode, index: BoardIndex): string[] {
  const range = index.locations[node.edId]?.attrs['class']
  if (!range) return []
  const attribute = index.text.slice(range.start, range.end)
  const value = attribute.slice(attribute.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')
  return value.split(/\s+/).filter(Boolean)
}

/** The text directly inside the element, its child elements cut out. */
function ownTextOf(node: TemplateNode, index: BoardIndex): string {
  const location = index.locations[node.edId]
  if (!location) return ''
  let text = ''
  let from = location.startTag.end
  for (const child of node.children) {
    const range = index.locations[child.edId]?.element
    if (!range) continue
    text += index.text.slice(from, range.start)
    from = range.end
  }
  text += index.text.slice(from, location.element.end)
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function layerItemsOf(node: TemplateNode, index: BoardIndex): PaletteItem[] {
  const item: PaletteItem = {
    kind: 'layer',
    edId: node.edId,
    name: node.name,
    tag: node.tag,
    classes: classesOf(node, index),
    text: ownTextOf(node, index),
  }
  return [item, ...node.children.flatMap((child) => layerItemsOf(child, index))]
}

/** The registry's actions in registry order, then the board's layers in tree order. */
export function paletteItems(registry: ActionRegistry, index: BoardIndex | null): PaletteItem[] {
  const actions = registry.all().map((action): PaletteItem => ({ kind: 'action', action }))
  return index ? [...actions, ...layerItemsOf(index.tree, index)] : actions
}

function isSubsequence(query: string, text: string): boolean {
  let at = 0
  for (const character of text) {
    if (character === query[at]) at++
    if (at === query.length) return true
  }
  return false
}

/** Lower is closer: exact, prefix, word start, anywhere, then (when fuzzy) letters in order. */
function matchRank(query: string, candidate: string, fuzzy: boolean): number | null {
  const text = candidate.toLowerCase()
  if (text === query) return 0
  if (text.startsWith(query)) return 1
  const at = text.indexOf(query)
  if (at > 0 && !/[a-z0-9]/.test(text[at - 1]!)) return 2
  if (at >= 0) return 3
  return fuzzy && isSubsequence(query, text) ? 4 : null
}

function bestRank(query: string, item: PaletteItem): number | null {
  const ranks =
    item.kind === 'action'
      ? [matchRank(query, item.action.label, true)]
      : [
          matchRank(query, item.name, true),
          matchRank(query, item.tag, false),
          ...item.classes.map((name) => matchRank(query, name, false)),
          matchRank(query, item.text, false),
        ]
  const found = ranks.filter((rank) => rank !== null)
  return found.length > 0 ? Math.min(...found) : null
}

/** The items that match `query`, closest first; equally close items keep their order. */
export function filterPalette(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...items]
  return items
    .map((item) => ({ item, rank: bestRank(needle, item) }))
    .filter((ranked): ranked is { item: PaletteItem; rank: number } => ranked.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item)
}
