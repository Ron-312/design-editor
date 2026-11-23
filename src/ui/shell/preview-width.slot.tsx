import { useRef, type CSSProperties, type KeyboardEvent } from 'react'
import type { EditorContext, ShellSlot, ShellSlotProps } from '../plugin-api'
import { MENU_FIELD, MenuItem, boardWidthOf, usePopover } from '../TopBar'
import { ShellIcon } from '../shell-icons'

const PRESETS = [375, 768, 1280, 1440] as const

const BAR: CSSProperties = {
  position: 'fixed',
  top: 56,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 10,
  borderRadius: 'var(--r-sm)',
  pointerEvents: 'none',
}

function previewWidthOf(ctx: EditorContext): number | undefined {
  const index = ctx.index()
  return index ? ctx.editorState().boards[index.board]?.previewWidth : undefined
}

/** Sets the open board's preview width, or clears it for `undefined` or the board's own width; the view is saved with it. */
function setPreviewWidth(ctx: EditorContext, width: number | undefined): void {
  const index = ctx.index()
  if (!index) return
  const view = { ...ctx.viewport(), selection: ctx.selection()?.edIds ?? [] }
  const shown = width === boardWidthOf(index.board) ? view : { ...view, previewWidth: width }
  ctx.setEditorState({ boards: { ...ctx.editorState().boards, [index.board]: shown } })
}

/** A positive whole width; undefined for an empty field, null for anything else. */
function parseWidth(typed: string): number | undefined | null {
  const text = typed.trim()
  if (text === '') return undefined
  const width = Number(text)
  return Number.isInteger(width) && width > 0 ? width : null
}

function PreviewWidthControl({ ctx }: ShellSlotProps) {
  const anchor = useRef<HTMLDivElement>(null)
  const popover = usePopover(anchor)
  const previewWidth = previewWidthOf(ctx)

  function choose(width: number | undefined) {
    popover.close()
    setPreviewWidth(ctx, width)
  }

  function chooseTyped(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    const width = parseWidth(event.currentTarget.value)
    if (width !== null) choose(width)
  }

  return (
    <div className="anchor" ref={anchor}>
      <button type="button" className="zoom" aria-label="Preview width" aria-haspopup="menu" aria-expanded={popover.open} onClick={popover.toggle}>
        <span>{previewWidth === undefined ? 'Width' : `${previewWidth} preview`}</span>
        <ShellIcon name="chev-d" />
      </button>
      {popover.open && (
        <div className="menu" role="menu" aria-label="Preview width">
          <input style={MENU_FIELD} aria-label="Custom width" placeholder="Custom width" defaultValue={previewWidth ?? ''} onKeyDown={chooseTyped} />
          {PRESETS.map((width) => (
            <MenuItem key={width} label={String(width)} onPick={() => choose(width)} />
          ))}
        </div>
      )}
    </div>
  )
}

/** v2 writes no `@media`, so while a preview width is set every style edit still lands in the base declaration. */
function AllWidthsBar({ ctx }: ShellSlotProps) {
  if (previewWidthOf(ctx) === undefined) return null
  return (
    <p className="banner" role="status" style={BAR}>
      <ShellIcon name="warn" />
      Edits apply to all widths
    </p>
  )
}

export const slots: ShellSlot[] = [
  { id: 'preview-width', place: 'top-bar', component: PreviewWidthControl },
  { id: 'all-widths-bar', place: 'overlay', component: AllWidthsBar },
]
