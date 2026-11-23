import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { filterPalette, onPaletteOpenRequest, paletteItems, shortcutGlyphs, type KeyboardLayout, type PaletteItem } from '../palette'
import type { ShellSlot, ShellSlotProps } from '../plugin-api'

/** The Keyboard Map API is Chromium-only, so it is missing from the DOM typings. */
interface NavigatorWithKeyboard {
  readonly keyboard?: { readonly getLayoutMap?: () => Promise<KeyboardLayout> }
}

const BACKDROP: CSSProperties = { position: 'fixed', inset: 0, zIndex: 30 }
const DIALOG: CSSProperties = {
  position: 'fixed',
  top: '15%',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(560px, calc(100vw - 32px))',
  maxHeight: '60vh',
  gridTemplateRows: 'auto minmax(0, 1fr)',
  gap: 4,
}
const SEARCH: CSSProperties = { height: 36, padding: '0 10px', borderRadius: 'var(--r)', background: 'var(--field)', color: 'var(--text)' }
const LIST: CSSProperties = { display: 'grid', alignContent: 'start', overflowY: 'auto' }
const ACTIVE: CSSProperties = { background: 'var(--accent-soft)' }
const MUTED: CSSProperties = { color: 'var(--text-3)' }

function useKeyboardLayout(open: boolean): KeyboardLayout | undefined {
  const [layout, setLayout] = useState<KeyboardLayout>()
  useEffect(() => {
    if (!open) return
    ;(navigator as NavigatorWithKeyboard).keyboard?.getLayoutMap?.().then(setLayout, () => {})
  }, [open])
  return layout
}

function itemKey(item: PaletteItem): string {
  return item.kind === 'action' ? `action:${item.action.id}` : `layer:${item.edId}`
}

function CommandPalette({ ctx, registry, platform }: ShellSlotProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const returnFocus = useRef<HTMLElement | null>(null)
  const listId = useId()
  const layout = useKeyboardLayout(open)

  useEffect(
    () =>
      onPaletteOpenRequest(() => {
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setQuery('')
        setActive(0)
        setOpen(true)
      }),
    [],
  )

  const items = useMemo(() => (open ? paletteItems(registry, ctx.index()) : []), [open, registry, ctx])
  const shown = useMemo(() => filterPalette(items, query), [items, query])

  if (!open) return null

  function close() {
    setOpen(false)
    returnFocus.current?.focus()
  }

  function choose(item: PaletteItem) {
    close()
    if (item.kind === 'layer') {
      ctx.select([item.edId])
      return
    }
    const { action } = item
    if (action.when?.(ctx) ?? true) {
      action.run(ctx, ctx.beginAction())
      return
    }
    if (action.disabledReason) ctx.toast({ message: action.disabledReason, tone: 'info' })
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = shown[active]
      if (chosen) choose(chosen)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) => Math.min(Math.max(current + step, 0), shown.length - 1))
    }
  }

  function optionContent(item: PaletteItem) {
    if (item.kind === 'layer') {
      return (
        <>
          {item.name}
          <span style={MUTED}>{item.tag}</span>
        </>
      )
    }
    const kbd = registry.shortcutOf(item.action.id)
    return (
      <>
        {item.action.label}
        {kbd && <kbd>{shortcutGlyphs(kbd, platform, layout)}</kbd>}
      </>
    )
  }

  return (
    <div style={BACKDROP} onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div className="menu" role="dialog" aria-modal="true" aria-label="Command palette" style={DIALOG}>
        <input
          autoFocus
          role="combobox"
          aria-label="Search commands and layers"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          placeholder="Search commands and layers"
          style={SEARCH}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onSearchKeyDown}
        />
        <div role="listbox" id={listId} aria-label="Commands and layers" style={LIST}>
          {shown.map((item, at) => (
            <div
              key={itemKey(item)}
              id={`${listId}-${at}`}
              role="option"
              aria-selected={at === active}
              aria-disabled={item.kind === 'action' && item.action.when?.(ctx) === false}
              className="mi"
              style={at === active ? ACTIVE : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
            >
              {optionContent(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export const slots: readonly ShellSlot[] = [{ id: 'command-palette', place: 'overlay', component: CommandPalette }]
