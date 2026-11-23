import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { isVoidElement, nestingViolation } from '../../shared/content-model'
import { applyStructural } from '../actions/layer.actions'
import type { Platform } from '../actions/registry'
import type { EditorState } from '../../shared/protocol'
import type { EdId, TemplateNode } from '../../shared/types'
import type { EditorContext } from '../plugin-api'
import { Icon, type IconName } from './fields'

export interface LayersPanelProps {
  readonly ctx: EditorContext
  readonly platform: Platform
  /** Hide, lock and collapse are editor-only: they go to `.editor/state.json`, never into the source. */
  readonly onEditorStateChange: (state: EditorState) => void
}

interface LayerRow {
  readonly node: TemplateNode
  readonly depth: number
  readonly parent: LayerRow | null
}

type Zone = 'before' | 'inside' | 'after'

interface DropSpot {
  readonly row: LayerRow
  readonly zone: Zone
}

interface Drag {
  readonly source: LayerRow
  readonly spot: DropSpot | null
}

interface PendingDrag {
  readonly source: LayerRow
  readonly x: number
  readonly y: number
}

const DRAG_THRESHOLD = 4
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'label', 'li', 'strong', 'em', 'small'])

function visibleRows(tree: TemplateNode, collapsed: readonly EdId[]): LayerRow[] {
  const rows: LayerRow[] = []
  const visit = (node: TemplateNode, depth: number, parent: LayerRow | null) => {
    const row = { node, depth, parent }
    rows.push(row)
    if (collapsed.includes(node.edId)) return
    for (const child of node.children) visit(child, depth + 1, row)
  }
  visit(tree, 0, null)
  return rows
}

function matchesQuery(node: TemplateNode, query: string): boolean {
  return node.name.toLowerCase().includes(query) || node.tag.toLowerCase().includes(query)
}

/** Every layer whose name or tag holds `query`, under the ancestors that lead to it, whatever is collapsed. */
function foundRows(tree: TemplateNode, query: string): LayerRow[] {
  const rows: LayerRow[] = []
  const visit = (node: TemplateNode, depth: number, parent: LayerRow | null): boolean => {
    const row = { node, depth, parent }
    const at = rows.push(row) - 1
    const childFound = node.children.map((child) => visit(child, depth + 1, row)).some(Boolean)
    if (childFound || matchesQuery(node, query)) return true
    rows.splice(at, 1)
    return false
  }
  visit(tree, 0, null)
  return rows
}

const FIND_KEYS: Readonly<Record<Platform, string>> = { mac: '⌘F', windows: 'Ctrl+F' }

/** Elements and imports render live; `<sc-for>` / `<sc-if>` render away, so they are never dimmed. */
function renderedNodes(tree: TemplateNode): TemplateNode[] {
  const own = tree.kind === 'element' || tree.kind === 'dc-import' ? [tree] : []
  return [...own, ...tree.children.flatMap(renderedNodes)]
}

function isWithin(row: LayerRow | null, edId: EdId): boolean {
  for (let at = row; at; at = at.parent) if (at.node.edId === edId) return true
  return false
}

function tagsDownTo(row: LayerRow): string[] {
  return row.parent ? [...tagsDownTo(row.parent), row.node.tag] : [row.node.tag]
}

/** Why `source` cannot become a child of `parent`, as the one line the toast shows; null when it can. */
function parentRefusal(source: LayerRow, parent: LayerRow): string | null {
  if (isWithin(parent, source.node.edId)) return "a layer can't go inside itself"
  if (parent.node.kind === 'dc-import') return "an imported component can't hold other layers"
  if (isVoidElement(parent.node.tag)) return `<${parent.node.tag}> can't hold other layers`
  return nestingViolation(tagsDownTo(parent), source.node.tag)
}

function canDrag(row: LayerRow, state: EditorState, readOnly: boolean): boolean {
  return !readOnly && row.node.readOnly === undefined && !state.locked.includes(row.node.edId)
}

function zoneIn(element: Element, row: LayerRow, y: number): Zone {
  if (!row.parent) return 'inside'
  const rect = element.getBoundingClientRect()
  const edge = rect.height / 4
  if (y < rect.top + edge) return 'before'
  if (y > rect.bottom - edge) return 'after'
  return 'inside'
}

function moveFor(source: LayerRow, spot: DropSpot): { readonly parent: LayerRow; readonly before: EdId | null } {
  if (spot.zone === 'inside' || !spot.row.parent) return { parent: spot.row, before: null }
  const parent = spot.row.parent
  if (spot.zone === 'before') return { parent, before: spot.row.node.edId }
  const siblings = parent.node.children.filter((child) => child.edId !== source.node.edId)
  const after = siblings.findIndex((child) => child.edId === spot.row.node.edId)
  return { parent, before: siblings[after + 1]?.edId ?? null }
}

function toggled(edIds: readonly EdId[], edId: EdId): EdId[] {
  return edIds.includes(edId) ? edIds.filter((other) => other !== edId) : [...edIds, edId]
}

function iconFor(node: TemplateNode, depth: number): IconName {
  if (depth === 0) return 'frame'
  if (node.kind === 'sc-for') return 'grid'
  if (node.kind === 'sc-if') return 'code'
  if (node.kind === 'dc-import') return 'file'
  if (node.tag === 'img' || node.tag === 'picture' || node.tag === 'svg') return 'image'
  return TEXT_TAGS.has(node.tag) ? 'text' : 'box'
}

function useUnrendered(ctx: EditorContext, tree: TemplateNode | undefined): ReadonlySet<EdId> {
  const [unrendered, setUnrendered] = useState<ReadonlySet<EdId>>(new Set())
  useEffect(() => {
    if (!tree) return
    let current = true
    const counts = renderedNodes(tree).map(async (node) => ({ edId: node.edId, rects: (await ctx.read({ kind: 'rects', edId: node.edId })).rects }))
    Promise.all(counts)
      .then((nodes) => {
        if (current) setUnrendered(new Set(nodes.filter((node) => node.rects.length === 0).map((node) => node.edId)))
      })
      // A reload rejects reads in flight; the reload's new index reads again.
      .catch(() => {})
    return () => {
      current = false
    }
  }, [ctx, tree])
  return unrendered
}

export function LayersPanel({ ctx, platform, onEditorStateChange }: LayersPanelProps) {
  const index = useSyncExternalStore(ctx.onChange, ctx.index)
  const selectionKey = useSyncExternalStore(ctx.onChange, () => ctx.selection()?.edIds.join(' ') ?? '')
  const readOnly = useSyncExternalStore(ctx.onChange, ctx.readOnly)
  const unrendered = useUnrendered(ctx, index?.tree)
  const [drag, setDrag] = useState<Drag | null>(null)
  const pending = useRef<PendingDrag | null>(null)
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const editorState = ctx.editorState()
  const selected = new Set(selectionKey.split(' '))
  const finding = query.trim().toLowerCase()
  const rows = !index ? [] : finding ? foundRows(index.tree, finding) : visibleRows(index.tree, editorState.collapsed)

  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent) => {
      const mod = platform === 'mac' ? event.metaKey : event.ctrlKey
      if (!mod || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      search.current?.focus()
      search.current?.select()
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [platform])

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape') return
    setQuery('')
    event.currentTarget.blur()
  }

  function rowAtPoint(x: number, y: number): DropSpot | null {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[role="treeitem"]')
    const row = rows.find((candidate) => candidate.node.edId === element?.dataset.layerId)
    return element && row ? { row, zone: zoneIn(element, row, y) } : null
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as Element
    if (event.button !== 0 || target.closest('button')) return
    const id = target.closest<HTMLElement>('[role="treeitem"]')?.dataset.layerId
    const source = rows.find((row) => row.node.edId === id)
    if (!source || !canDrag(source, editorState, readOnly)) return
    pending.current = { source, x: event.clientX, y: event.clientY }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = pending.current
    if (!start) return
    if (!drag && Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return
    // Capturing on pointerdown would retarget the click to the tree and a plain click would not select its row.
    if (!drag) event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ source: start.source, spot: rowAtPoint(event.clientX, event.clientY) })
  }

  function endDrag() {
    pending.current = null
    setDrag(null)
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const spot = drag ? rowAtPoint(event.clientX, event.clientY) : null
    if (drag && spot) dropOn(drag.source, spot)
    endDrag()
  }

  function dropOn(source: LayerRow, spot: DropSpot) {
    if (spot.row === source) return
    const { parent, before } = moveFor(source, spot)
    const refusal = parentRefusal(source, parent)
    if (refusal) return ctx.toast({ message: refusal, tone: 'warning' })
    void applyStructural(ctx, { target: [source.node.edId], kind: 'moveNode', payload: { parent: parent.node.edId, before } })
  }

  function select(edId: EdId, additive: boolean) {
    const current = ctx.selection()?.edIds ?? []
    ctx.select(additive ? toggled(current, edId) : [edId])
  }

  function toggleIn(key: 'hidden' | 'locked' | 'collapsed', edId: EdId) {
    const state = ctx.editorState()
    onEditorStateChange({ ...state, [key]: toggled(state[key], edId) })
  }

  return (
    <nav className="layers" aria-label="Layers">
      <style>{PANEL_CSS}</style>
      <h3 className="lhead">Layers</h3>
      <label className="search">
        <Icon name="search" />
        <input
          ref={search}
          type="search"
          aria-label="Find layer"
          placeholder="Find layer"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKey}
        />
        <kbd>{FIND_KEYS[platform]}</kbd>
      </label>
      {finding && rows.length === 0 && <p className="none">No layers match “{query.trim()}”</p>}
      <div
        className="tree"
        role="tree"
        aria-label="Layers"
        aria-multiselectable="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
      >
        {rows.map((row) => (
          <LayerRowView
            key={row.node.edId}
            row={row}
            selected={selected.has(row.node.edId)}
            dimmed={unrendered.has(row.node.edId)}
            hidden={editorState.hidden.includes(row.node.edId)}
            locked={editorState.locked.includes(row.node.edId)}
            collapsed={!finding && editorState.collapsed.includes(row.node.edId)}
            dropInvalid={drag !== null && parentRefusal(drag.source, row) !== null}
            dropZone={drag?.spot?.row === row ? drag.spot.zone : null}
            onSelect={select}
            onToggle={toggleIn}
          />
        ))}
      </div>
    </nav>
  )
}

interface LayerRowViewProps {
  readonly row: LayerRow
  readonly selected: boolean
  readonly dimmed: boolean
  readonly hidden: boolean
  readonly locked: boolean
  readonly collapsed: boolean
  readonly dropInvalid: boolean
  readonly dropZone: Zone | null
  readonly onSelect: (edId: EdId, additive: boolean) => void
  readonly onToggle: (key: 'hidden' | 'locked' | 'collapsed', edId: EdId) => void
}

function LayerRowView({ row, selected, dimmed, hidden, locked, collapsed, dropInvalid, dropZone, onSelect, onToggle }: LayerRowViewProps) {
  const { node, depth } = row
  const expandable = node.kind !== 'dc-import' && node.children.length > 0
  const isRoot = depth === 0

  function toggle(key: 'hidden' | 'locked' | 'collapsed') {
    return (event: MouseEvent) => {
      event.stopPropagation()
      onToggle(key, node.edId)
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onSelect(node.edId, event.shiftKey)
  }

  return (
    <div
      role="treeitem"
      tabIndex={selected ? 0 : -1}
      data-layer-id={node.edId}
      aria-label={node.name}
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={expandable ? !collapsed : undefined}
      aria-readonly={node.readOnly ? true : undefined}
      data-dimmed={dimmed ? '' : undefined}
      data-hidden={hidden ? '' : undefined}
      data-drop-invalid={dropInvalid ? '' : undefined}
      data-drop={dropZone ?? undefined}
      className={isRoot ? 'row ab' : 'row'}
      style={{ '--d': depth } as CSSProperties}
      onClick={(event) => onSelect(node.edId, event.shiftKey)}
      onKeyDown={onKeyDown}
    >
      <span className="tw">
        {expandable && (
          <button type="button" aria-label={collapsed ? 'Expand' : 'Collapse'} onClick={toggle('collapsed')}>
            <Icon name={collapsed ? 'chev-r' : 'chev-d'} />
          </button>
        )}
      </span>
      <span className="ic">
        <Icon name={iconFor(node, depth)} />
      </span>
      <span className="nm">{node.name}</span>
      <span className="tg">{node.tag}</span>
      {!isRoot && (
        <span className="acts">
          <button type="button" className={locked ? 'on' : undefined} aria-label={locked ? 'Unlock' : 'Lock'} onClick={toggle('locked')}>
            <Icon name={locked ? 'lock' : 'unlock'} />
          </button>
          <button type="button" className={hidden ? 'on' : undefined} aria-label={hidden ? 'Show' : 'Hide'} onClick={toggle('hidden')}>
            <Icon name={hidden ? 'eye-off' : 'eye'} />
          </button>
        </span>
      )}
    </div>
  )
}

const PANEL_CSS = `
.layers{background:var(--panel);color:var(--text-2);display:flex;flex-direction:column;min-height:0}
.layers button{font:inherit;color:inherit;background:none;border:0;padding:0}
.layers svg.i{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.layers .lhead{height:24px;flex:none;display:flex;align-items:center;margin-top:8px;padding:0 8px 0 12px;font-size:12px;font-weight:600;color:var(--text-2)}
.layers .search{margin:4px 8px;height:28px;flex:none;border-radius:var(--r-sm);background:var(--field);display:flex;align-items:center;gap:8px;padding:0 8px;color:var(--text-3);border:1px solid transparent}
.layers .search:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.layers .search input{flex:1;min-width:0;background:none;border:0;outline:none;font:inherit;color:var(--text)}
.layers .search input::placeholder{color:var(--text-3)}
.layers .search input::-webkit-search-cancel-button{display:none}
.layers .search kbd{font:500 11px/16px "Instrument Sans",system-ui,sans-serif;color:var(--text-3);border:1px solid var(--line-strong);border-radius:var(--r-xs);padding:0 4px}
.layers .none{padding:8px 12px;color:var(--text-3)}
.layers .tree{flex:1;overflow:auto;padding:4px 0 8px;user-select:none;touch-action:none}
.layers .row{height:28px;display:flex;align-items:center;gap:6px;padding-left:calc(8px + var(--d,0)*12px);padding-right:8px;margin:0 4px;border-radius:var(--r-sm);position:relative;outline:none}
.layers .row:hover{background:var(--field)}
.layers .row:focus-visible{box-shadow:inset 0 0 0 1px var(--accent)}
.layers .row[aria-selected="true"]{background:var(--accent-soft);color:var(--text);font-weight:500}
.layers .row[aria-selected="true"] .ic{color:var(--accent-text)}
.layers .row.ab{color:var(--text);font-weight:600}
.layers .tw{width:12px;height:12px;display:grid;place-items:center;color:var(--text-3)}
.layers .tw svg.i{width:12px;height:12px}
.layers .ic{display:grid;color:var(--text-3)}
.layers .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.layers .tg{margin-left:4px;color:var(--text-3);font:10px/16px "JetBrains Mono",ui-monospace,monospace}
.layers .acts{margin-left:auto;display:flex;gap:2px;color:var(--text-3)}
.layers .acts button{width:20px;height:20px;display:grid;place-items:center;border-radius:var(--r-xs);opacity:0}
.layers .row:hover .acts button,.layers .acts button:focus-visible,.layers .acts button.on{opacity:1}
.layers .acts button:hover{color:var(--text)}
.layers .row[data-dimmed] .nm{color:var(--text-3)}
.layers .row[data-dimmed] .ic{opacity:.62}
.layers .row[data-hidden] .nm,.layers .row[data-hidden] .ic{opacity:.5}
.layers .row[data-drop-invalid]{opacity:.4}
.layers .row[data-drop="inside"]{box-shadow:inset 0 0 0 1px var(--sel)}
.layers .row[data-drop="before"]{box-shadow:inset 0 2px 0 var(--sel)}
.layers .row[data-drop="after"]{box-shadow:inset 0 -2px 0 var(--sel)}
`
