import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'
import { isCancellable, type PushFailure, type PushOutcome, type PushState, type PushStep } from '../shared/push'
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
export function usePopover(anchor: RefObject<HTMLElement | null>) {
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
            data-board-width={board.w}
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

/** The authored width of `board`, as the board switcher shows it. */
export function boardWidthOf(board: ProjectPath): number | undefined {
  const tab = [...document.querySelectorAll<HTMLElement>('[data-board-switcher] [data-board]')].find((candidate) => candidate.dataset.board === board)
  return tab ? Number(tab.dataset.boardWidth) : undefined
}

const ZOOM_PRESETS = [0.5, 1, 2] as const

/** A text field at the top of a menu. */
export const MENU_FIELD: CSSProperties = { height: 28, marginBottom: 4, padding: '0 8px', borderRadius: 'var(--r-sm)', background: 'var(--field)', color: 'var(--text)' }

/** `150`, `150%` and ` 75 % ` as a zoom factor; null for anything that is not a positive percentage. */
function parseZoomPercent(typed: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(typed)
  const percent = match ? Number(match[1]) : 0
  return percent > 0 ? percent / 100 : null
}

export function MenuItem({ label, kbd, onPick }: { readonly label: string; readonly kbd?: string; readonly onPick: () => void }) {
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

  function zoomToTyped(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    const typed = parseZoomPercent(event.currentTarget.value)
    if (typed !== null) pick((commands) => commands.zoomTo(typed))()
  }

  return (
    <div className="anchor" ref={anchor}>
      <button type="button" className="zoom" aria-label="Zoom" aria-haspopup="menu" aria-expanded={popover.open} onClick={popover.toggle}>
        <span data-zoom-percent="">{Math.round(zoom * 100)}%</span>
        <ShellIcon name="chev-d" />
      </button>
      {popover.open && (
        <div className="menu" role="menu" aria-label="Zoom">
          <input style={MENU_FIELD} aria-label="Zoom percentage" defaultValue={`${Math.round(zoom * 100)}%`} onKeyDown={zoomToTyped} />
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

const STEP_LABELS: Readonly<Record<PushStep, string>> = {
  starting: 'Starting…',
  opening: 'Waiting for the Claude Code window…',
  checking: 'Reading the canvas from Claude Design…',
  merging: 'Merging…',
  sending: 'Sending your edits…',
  confirming: 'Checking they arrived…',
}

const FAILURE_TITLES: Readonly<Record<PushFailure, string>> = {
  noClaude: 'Claude Code not found',
  signedOut: 'Sign in to Claude Code',
  noCanvas: 'Which canvas?',
  wrongCanvas: 'Not the same canvas',
  conflict: 'Changed on both sides',
  artboards: 'Artboards changed here',
  cancelled: 'Push cancelled',
  error: 'Push failed',
}

type PushedOutcome = Extract<PushOutcome, { kind: 'pushed' }>
type FailedOutcome = Extract<PushOutcome, { kind: 'failed' }>

function PushedReport({ outcome }: { readonly outcome: PushedOutcome }) {
  const { title, sent, received } = outcome
  return (
    <>
      <strong>{sent.length > 0 ? `Pushed to ${title}` : 'Up to date'}</strong>
      {sent.length > 0 && <p>Sent {sent.map(fileName).join(', ')}.</p>}
      {sent.length + received.length === 0 && <p>{title} already has everything here.</p>}
      {received.length > 0 && <p>Brought in from Claude Design: {received.map(fileName).join(', ')}.</p>}
    </>
  )
}

function FailedReport({ outcome }: { readonly outcome: FailedOutcome }) {
  return (
    <>
      <strong>{FAILURE_TITLES[outcome.reason]}</strong>
      <p>{outcome.message}</p>
      {outcome.reason === 'signedOut' && (
        <p>
          Run <code className="mono">claude auth login</code> in a terminal, then push again.
        </p>
      )}
      {outcome.reason === 'conflict' && (
        <p>
          Run <code className="mono">/design-push</code> in Claude Code to choose which side to keep.
        </p>
      )}
      {outcome.files.length > 0 && <p className="pending">{outcome.files.map(fileName).join(', ')}</p>}
    </>
  )
}

interface PushButtonProps {
  readonly pending: number
  /** Another program's push holds the canvas, or this one does. */
  readonly locked: boolean
  readonly push: PushState
  readonly onStart: (canvas?: string) => void
  readonly onCancel: () => void
}

/** One press pushes and shows how it goes; it only asks first when the project does not know its canvas. */
export function PushButton({ pending, locked, push, onStart, onCancel }: PushButtonProps) {
  const anchor = useRef<HTMLDivElement>(null)
  const popover = usePopover(anchor)
  const [link, setLink] = useState('')
  const running = push.step !== null
  const needsLink = push.canvas === null && !running

  function press() {
    popover.toggle()
    if (!popover.open && !running && !locked && !needsLink) onStart()
  }

  function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (link.trim()) onStart(link.trim())
  }

  return (
    <div className="anchor" ref={anchor}>
      <button type="button" className="btn primary" aria-haspopup="dialog" aria-expanded={popover.open} aria-busy={running} onClick={press}>
        <ShellIcon name="push" />
        {running ? 'Pushing…' : 'Push'}
        {pending > 0 && !running && (
          <span className="cnt" aria-label={plural(pending, 'change')}>
            {pending}
          </span>
        )}
      </button>
      {popover.open && (
        <div className="menu push-pop" role="dialog" aria-label="Push">
          <div role="status">
            {push.step && <strong>{STEP_LABELS[push.step]}</strong>}
            {push.step === 'opening' && <p>A terminal window opens. The first time, it asks you to trust this folder: choose Yes.</p>}
            {!running && push.outcome?.kind === 'pushed' && <PushedReport outcome={push.outcome} />}
            {!running && push.outcome?.kind === 'failed' && <FailedReport outcome={push.outcome} />}
            {!running && locked && <p>Another push is running. Editing resumes when it finishes.</p>}
            {needsLink && !push.outcome && <p>Paste the claude.ai link of the canvas this project came from. It is asked once.</p>}
          </div>
          {isCancellable(push.step) && (
            <button type="button" className="btn ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
          {needsLink && !locked && (
            <form onSubmit={submitLink}>
              <input style={MENU_FIELD} name="canvas" aria-label="Canvas link" placeholder="https://claude.ai/artifact/…" autoFocus value={link} onChange={(event) => setLink(event.currentTarget.value)} />
              <button type="submit" className="btn primary">
                Push
              </button>
            </form>
          )}
          {!running && !needsLink && !locked && push.outcome?.kind === 'failed' && (
            <button type="button" className="btn primary" onClick={() => onStart()}>
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  )
}
