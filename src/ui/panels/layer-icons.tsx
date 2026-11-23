import type { ReactNode } from 'react'
import type { TemplateNode } from '../../shared/types'
import { Icon } from './fields'

export type Layout = 'flex-row' | 'flex-column' | 'grid'
export type LayerType = Layout | 'board' | 'text' | 'image' | 'repeat' | 'condition' | 'import' | 'box'

/** The computed properties `layoutOf` reads from the live page. */
export const LAYOUT_PROPS = ['display', 'flex-direction'] as const

const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'label', 'li', 'strong', 'em', 'small'])
const IMAGE_TAGS = new Set(['img', 'picture', 'svg'])

/** `inline-flex`, `inline-grid` and two-keyword values such as `block flex` lay out their children the same way. */
export function layoutOf(computed: Readonly<Record<string, string>>): Layout | null {
  const display = computed['display'] ?? ''
  if (display.endsWith('grid')) return 'grid'
  if (!display.endsWith('flex')) return null
  return computed['flex-direction']?.startsWith('column') ? 'flex-column' : 'flex-row'
}

export function layerTypeOf(node: TemplateNode, isBoard: boolean, layout: Layout | null): LayerType {
  if (isBoard) return 'board'
  if (node.kind === 'sc-for') return 'repeat'
  if (node.kind === 'sc-if') return 'condition'
  if (node.kind === 'dc-import') return 'import'
  if (layout) return layout
  if (IMAGE_TAGS.has(node.tag)) return 'image'
  return TEXT_TAGS.has(node.tag) ? 'text' : 'box'
}

function Glyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  )
}

const LAYER_ICONS: Readonly<Record<LayerType, ReactNode>> = {
  board: <Icon name="frame" />,
  'flex-row': (
    <Glyph>
      <rect x="2" y="4" width="3" height="8" rx="1" />
      <rect x="6.5" y="4" width="3" height="8" rx="1" />
      <rect x="11" y="4" width="3" height="8" rx="1" />
    </Glyph>
  ),
  'flex-column': (
    <Glyph>
      <rect x="4" y="2" width="8" height="3" rx="1" />
      <rect x="4" y="6.5" width="8" height="3" rx="1" />
      <rect x="4" y="11" width="8" height="3" rx="1" />
    </Glyph>
  ),
  grid: <Icon name="grid" />,
  text: <Icon name="text" />,
  image: <Icon name="image" />,
  repeat: (
    <Glyph>
      <path d="M2.5 7.5V6.5A2.5 2.5 0 0 1 5 4h8.5M11.5 2l2 2-2 2M13.5 8.5v1A2.5 2.5 0 0 1 11 12H2.5M4.5 14l-2-2 2-2" />
    </Glyph>
  ),
  condition: (
    <Glyph>
      <path d="M8 2l6 6-6 6-6-6z" />
    </Glyph>
  ),
  import: (
    <Glyph>
      <path d="M8 2v7M5 6l3 3 3-3M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </Glyph>
  ),
  box: <Icon name="box" />,
}

export function LayerTypeIcon({ type }: { readonly type: LayerType }) {
  return (
    <span className="ic" data-layer-type={type}>
      {LAYER_ICONS[type]}
    </span>
  )
}
