import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Board, CanvasLayout, ProjectPath } from '../shared/types'
import type { CanvasCommands } from './canvas/CanvasView'
import { fileName } from './DiffPanel'
import { ShellIcon, type ShellIconName } from './shell-icons'

export type SyncStep = 'pulled' | 'edited' | 'pushing'

const SYNC_LABELS: Readonly<Record<SyncStep, string>> = {
  pulled: 'Sync status: pulled, no edits yet',
  edited: 'Sync status: edited, changes not pushed',
  pushing: 'Sync status: pushing',
}

export function SyncStrip({ step, edits }: { readonly step: SyncStep; readonly edits: number }) {
  const currentIf = (candidate: SyncStep) => (candidate === step ? ('step' as const) : undefined)
  return (
    <div className="sync" role="status" aria-label={SYNC_LABELS[step]}>
      <span className="step done" aria-current={currentIf('pulled')}>
        <ShellIcon name="check" />
        Pulled
      </span>
      <ShellIcon name="chev-r" className="i arrow" />
      <span className="step" aria-current={currentIf('edited')}>
        {edits > 0 && <span className="dot" />}
        Edited {edits > 0 && <span className="n">· {edits}</span>}
      </span>
      <ShellIcon name="chev-r" className="i arrow" />
      <span className="step" aria-current={currentIf('pushing')}>
        <ShellIcon name="push" />
        Pushing
      </span>
    </div>
  )
}

/** Open state for a popover that closes on Escape or a press anywhere outside `anchor`. */
function usePopover(anchor: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [anchor, open])
  return { open, toggle: () => setOpen(!open), close: () => setOpen(false) }
}

function deviceIcon(board: Board): ShellIconName {
  if (board.w >= 1024) return 'desktop'
  return board.w >= 600 ? 'tablet' : 'phone'
}

interface BoardSwitcherProps {
  readonly layout: CanvasLayout
  readonly current: ProjectPath | null
  readonly onOpen: (board: ProjectPath) => void
}

export function BoardSwitcher({ layout, current, onOpen }: BoardSwitcherProps) {
  const boards = layout.order.flatMap((path) => layout.boards.filter((board) => board.path === path))
  return (
    <div className="vp" data-board-switcher="" role="tablist" aria-label="Artboards">
      {boards.map((board) => {
        const isPage = layout.pages.includes(board.path)
        return (
          <button
            key={board.path}
            type="button"
            role="tab"
            aria-selected={board.path === current}
            aria-label={fileName(board.path)}
            data-board={board.path}
            {...(isPage ? { 'data-page': '' } : {})}
            title={`${fileName(board.path)} · ${board.w} × ${board.h}${isPage ? ' · page' : ''}`}
            onClick={() => onOpen(board.path)}
          >
            <ShellIcon name={deviceIcon(board)} />
            {board.w}
          </button>
        )
      })}
    </div>
  )
}

const ZOOM_PRESETS = [0.5, 1, 2] as const

function MenuItem({ label, kbd, onPick }: { readonly label: string; readonly kbd?: string; readonly onPick: () => void }) {
  return (
    <button type="button" role="menuitem" className="mi" onClick={onPick}>
      {label}
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  )
}

interface ZoomMenuProps {
  readonly zoom: number
  readonly canvas: RefObject<CanvasCommands | null>
}

export function ZoomMenu({ zoom, canvas }: ZoomMenuProps) {
  const anchor = useRef<HTMLDivElement>(null)
  const popover = usePopover(anchor)

  function pick(command: (commands: CanvasCommands) => void) {
    return () => {
      popover.close()
      if (canvas.current) command(canvas.current)
    }
  }

  return (
    <div className="anchor" ref={anchor}>
      <button type="button" className="zoom" aria-label="Zoom" aria-haspopup="menu" aria-expanded={popover.open} onClick={popover.toggle}>
        <span data-zoom-percent="">{Math.round(zoom * 100)}%</span>
        <ShellIcon name="chev-d" />
      </button>
      {popover.open && (
        <div className="menu" role="menu" aria-label="Zoom">
          <MenuItem label="Zoom in" onPick={pick((commands) => commands.zoomTo(zoom * 2))} />
          <MenuItem label="Zoom out" onPick={pick((commands) => commands.zoomTo(zoom / 2))} />
          <div className="msep" />
          <MenuItem label="Zoom to fit" kbd="⇧1" onPick={pick((commands) => commands.fitBoard())} />
          <MenuItem label="Zoom to selection" kbd="⇧2" onPick={pick((commands) => commands.fitSelection())} />
          <div className="msep" />
          {ZOOM_PRESETS.map((preset) => (
            <MenuItem key={preset} label={`${preset * 100}%`} onPick={pick((commands) => commands.zoomTo(preset))} />
          ))}
        </div>
      )}
    </div>
  )
}

export function PreviewSwitch({ on, onToggle }: { readonly on: boolean; readonly onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={on ? 'btn ghost on' : 'btn ghost'}
      title="Preview: use the design's own links and controls  hold I"
      onClick={onToggle}
    >
      <ShellIcon name="play" />
      Preview
    </button>
  )
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function pushStatus(pending: number, pushing: boolean): ReactNode {
  if (pushing) return 'A push is running now; editing resumes when it finishes.'
  if (pending === 0) return 'No changes waiting to push yet.'
  return `${plural(pending, 'change')} waiting to push.`
}

export function PushButton({ pending, pushing }: { readonly pending: number; readonly pushing: boolean }) {
  const anchor = useRef<HTMLDivElement>(null)
  const popover = usePopover(anchor)
  return (
    <div className="anchor" ref={anchor}>
      <button type="button" className="btn primary" aria-haspopup="dialog" aria-expanded={popover.open} onClick={popover.toggle}>
        <ShellIcon name="push" />
        Push
        {pending > 0 && (
          <span className="cnt" aria-label={plural(pending, 'change')}>
            {pending}
          </span>
        )}
      </button>
      {popover.open && (
        <div className="menu push-pop" role="dialog" aria-label="Push">
          <strong>Push from Claude Code</strong>
          <p>
            Run <code className="mono">/design-push</code> in Claude Code to send your edits back to the canvas.
          </p>
          <p className="pending">{pushStatus(pending, pushing)}</p>
        </div>
      )}
    </div>
  )
}
