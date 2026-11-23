/// <reference types="vite/client" />
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { EditorState, ProbeToEditor, Rect, ResolvedValues } from '../../shared/protocol'
import type { Board, CanvasLayout, EdId, EditOp, ProjectPath, TemplateNode } from '../../shared/types'
import type { Platform } from '../actions/registry'
import type { CanvasPointer, CanvasTool, EditorContext, PointerHandler, Viewport } from '../plugin-api'
import { createProbeClient, type ProbeClient } from '../probe-client'
import type { EditorStore } from '../store'
import type { WsClient } from '../ws-client'
import { boundsOf, screenBoxOf, type ScreenBox } from './overlay'
import {
  childSelection,
  clickSelection,
  doubleClickSelection,
  findNode,
  parentSelection,
  selectableHit,
  siblingSelection,
} from './selection'
import { fitRect, panBy, screenToBoard, viewportTransform, wheelZoomFactor, zoomAt, type Point } from './viewport'

export interface ToolModule {
  readonly tool: CanvasTool
}

const byDescendingPriority = (a: CanvasTool, b: CanvasTool) => b.priority - a.priority

export function loadCanvasTools(modules: Record<string, ToolModule>): CanvasTool[] {
  return Object.values(modules)
    .map((module) => module.tool)
    .sort(byDescendingPriority)
}

export function defaultCanvasTools(): CanvasTool[] {
  return loadCanvasTools(import.meta.glob<ToolModule>('./tools/*.tool.ts', { eager: true }))
}

const DEFAULT_TOOLS = defaultCanvasTools()

export interface CanvasViewProps {
  readonly store: EditorStore
  readonly ws: WsClient
  readonly layout: CanvasLayout
  readonly editorState: EditorState
  readonly platform: Platform
  readonly tools?: readonly CanvasTool[]
  /** Hands the shell the probe of the mounted artboard, null while none is loaded. */
  readonly onProbe?: (probe: ProbeClient | null) => void
}

type ToolHandler = 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onDoubleClick' | 'onHover'

type Gesture = { readonly kind: 'pan'; last: Point } | { readonly kind: 'tool'; readonly tool: CanvasTool }

interface TextEdit {
  readonly session: string
  readonly edId: EdId
}

const PAGE_RESET = 'Page reset to its first state'
const PAGE_REDREW = 'Page redrew, edit cancelled'
const LIVE_VALUE = 'Contains a live value; edit in source or Tweaks'
const EDIT_IN_SOURCE = 'Edit in source: only an element holding a single run of text is edited in place'

function fileName(path: ProjectPath): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function textEditRefusal(node: TemplateNode): string | null {
  if (node.readOnly === 'hole') return LIVE_VALUE
  if (node.readOnly || node.children.length > 0) return EDIT_IN_SOURCE
  return null
}

function isZoomWheel(event: WheelEvent, platform: Platform): boolean {
  // Chrome and Safari deliver a trackpad pinch as a wheel event with ctrlKey set.
  return event.ctrlKey || (platform === 'mac' && event.metaKey)
}

function previewedValues(probe: ProbeClient | null, op: EditOp): ResolvedValues {
  if (op.kind === 'setDecl') {
    probe?.previewDecl(op.target, op.payload.prop, op.payload.value)
    return Object.fromEntries(op.target.map((edId) => [edId, op.payload.value]))
  }
  if (op.kind === 'removeDecl') probe?.previewDecl(op.target, op.payload.prop, null)
  return {}
}

export function canvasContext(store: EditorStore, ws: WsClient, probe: ProbeClient | null, editorState: EditorState): EditorContext {
  return {
    index: () => store.getState().index,
    selection: () => {
      const { board, view } = store.getState()
      return board ? { board, edIds: view.selection } : null
    },
    viewport: () => store.getState().view.viewport,
    editorState: () => editorState,
    readOnly: () => store.getState().readOnly,
    select: (edIds) => store.select(edIds),
    setViewport: (viewport) => store.setViewport(viewport),
    apply: (op) => ws.sendOp(op, previewedValues(probe, op)),
    undo: () => ws.undo(),
    redo: () => ws.redo(),
    read: (read) => (probe ? probe.read(read) : Promise.reject(new Error('No artboard is loaded'))),
    records: () => store.getState().records,
    toast: (toast) => {
      store.toast(toast)
    },
    onChange: (listener) => store.subscribe(listener),
  }
}

async function renderedRects(probe: ProbeClient, edIds: readonly EdId[]): Promise<Rect[][]> {
  const results = await Promise.all(edIds.map((edId) => probe.read({ kind: 'rects', edId })))
  return results.map((result) => [...result.rects])
}

/** The rects every rendered node of `edIds` occupies, in board coordinates. */
function useRenderedRects(probe: ProbeClient | null, edIds: readonly EdId[], renderCount: number): Rect[] {
  const [rects, setRects] = useState<Rect[]>([])
  useEffect(() => {
    if (!probe) return
    let current = true
    renderedRects(probe, edIds)
      .then((perElement) => {
        if (current) setRects(perElement.flat())
      })
      // A reload rejects reads in flight; the probe's next `ready` reads again.
      .catch(() => {})
    return () => {
      current = false
    }
  }, [probe, edIds, renderCount])
  return probe && edIds.length > 0 ? rects : []
}

async function restoreAfterLoad(probe: ProbeClient, store: EditorStore): Promise<void> {
  const { scroll, selection } = store.getState().view
  probe.scrollTo(scroll.x, scroll.y)
  const perElement = await renderedRects(probe, selection)
  if (perElement.some((rects) => rects.length === 0)) store.toast({ message: PAGE_RESET, tone: 'info' })
}

export function CanvasView({ store, ws, layout, editorState, platform, tools = DEFAULT_TOOLS, onProbe }: CanvasViewProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [probe, setProbe] = useState<ProbeClient | null>(null)
  const [renderCount, setRenderCount] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const shieldRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const textEdit = useRef<TextEdit | null>(null)
  const spaceHeld = useRef(false)
  const interactHeld = useRef(false)

  const orderedTools = useMemo(() => [...tools].sort(byDescendingPriority), [tools])
  const ctx = useMemo(() => canvasContext(store, ws, probe, editorState), [store, ws, probe, editorState])
  const hovered = useMemo(() => (state.hover ? [state.hover] : []), [state.hover])
  const selectionRects = useRenderedRects(probe, state.view.selection, renderCount)
  const hoverRects = useRenderedRects(probe, hovered, renderCount)

  const board = layout.boards.find((entry) => entry.path === state.board)
  const viewport = state.view.viewport

  function openBoard(path: ProjectPath): void {
    store.setBoard(path)
    ws.send({ type: 'open', board: path })
  }

  useEffect(() => {
    const first = store.getState().board ?? layout.order[0]
    if (!first) return
    store.setBoard(first)
    ws.send({ type: 'open', board: first })
  }, [store, ws, layout])

  const attachFrame = useCallback(
    (frame: HTMLIFrameElement) => {
      const client = createProbeClient(frame)
      const rendered = () => setRenderCount((count) => count + 1)
      const stop = client.onMessage((message: ProbeToEditor) => {
        switch (message.type) {
          case 'ready':
            textEdit.current = null
            // A read rejected by another reload is answered by that reload's own `ready`.
            restoreAfterLoad(client, store).catch(() => {})
            rendered()
            break
          case 'scrolled':
            store.setScroll({ x: message.scrollX, y: message.scrollY })
            rendered()
            break
          case 'textCommit':
            textEdit.current = null
            // The ws client reports a refused op with its own toast.
            ws.sendOp({ target: [message.edId], kind: 'setText', payload: { text: message.text } }, {}).catch(() => {})
            break
          case 'textCancelled':
            textEdit.current = null
            if (message.reason !== 'escape') store.toast({ message: PAGE_REDREW, tone: 'warning' })
            break
        }
      })
      setProbe(client)
      onProbe?.(client)
      return () => {
        stop()
        client.dispose()
        setProbe(null)
        onProbe?.(null)
      }
    },
    [store, ws, onProbe],
  )

  useEffect(() => {
    const shield = shieldRef.current
    if (!shield) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = shield.getBoundingClientRect()
      const cursor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
      const current = store.getState().view.viewport
      store.setViewport(
        isZoomWheel(event, platform)
          ? zoomAt(current, wheelZoomFactor(event.deltaY), cursor)
          : panBy(current, -event.deltaX, -event.deltaY),
      )
    }
    // React registers wheel listeners as passive, so preventDefault needs a native listener.
    shield.addEventListener('wheel', onWheel, { passive: false })
    return () => shield.removeEventListener('wheel', onWheel)
  }, [store, platform])

  function pointerAt(event: ReactMouseEvent<HTMLElement>): CanvasPointer {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    const onBoard = screenToBoard(store.getState().view.viewport, { x, y })
    return {
      x,
      y,
      boardX: onBoard.x,
      boardY: onBoard.y,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      modKey: platform === 'mac' ? event.metaKey : event.ctrlKey,
      ctrlKey: event.ctrlKey,
    }
  }

  function claimingTool(handler: ToolHandler, pointer: CanvasPointer): CanvasTool | undefined {
    return orderedTools.find((tool) => (tool[handler] as PointerHandler | undefined)?.(ctx, pointer) ?? false)
  }

  async function selectableAt(pointer: CanvasPointer): Promise<EdId | null> {
    const { index } = store.getState()
    if (!probe || !index) return null
    const { edId } = await probe.read({ kind: 'hitTest', x: pointer.boardX, y: pointer.boardY, depth: 'deepest', within: null })
    return selectableHit(index.tree, edId, editorState.locked)
  }

  async function selectAt(pointer: CanvasPointer): Promise<void> {
    const hit = await selectableAt(pointer)
    const { index, view } = store.getState()
    if (!index) return
    store.select(clickSelection(index.tree, view.selection, hit, { mod: pointer.modKey, shift: pointer.shiftKey }))
  }

  async function hoverAt(pointer: CanvasPointer): Promise<void> {
    const hit = await selectableAt(pointer)
    const { index, view } = store.getState()
    if (!index) return
    const [target] = clickSelection(index.tree, view.selection, hit)
    store.setHover(target ?? null)
  }

  function beginTextEdit(tree: TemplateNode, edId: EdId): void {
    const node = findNode(tree, edId)
    if (!node || !probe) return
    const refusal = textEditRefusal(node)
    if (refusal) {
      store.toast({ message: refusal, tone: 'info' })
      return
    }
    textEdit.current = { session: probe.beginTextEdit(edId), edId }
  }

  async function doubleClickAt(pointer: CanvasPointer): Promise<void> {
    const hit = await selectableAt(pointer)
    const { index, view } = store.getState()
    if (!index) return
    const next = doubleClickSelection(index.tree, view.selection, hit)
    const alreadyOnHit = hit !== null && view.selection.length === 1 && view.selection[0] === hit && next[0] === hit
    if (alreadyOnHit) beginTextEdit(index.tree, hit)
    else store.select(next)
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (store.getState().interact) return
    const pointer = pointerAt(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (spaceHeld.current) {
      gesture.current = { kind: 'pan', last: { x: pointer.x, y: pointer.y } }
      return
    }
    const tool = claimingTool('onPointerDown', pointer)
    gesture.current = tool ? { kind: 'tool', tool } : null
    if (!tool) void selectAt(pointer)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (store.getState().interact) return
    const pointer = pointerAt(event)
    const current = gesture.current
    if (current?.kind === 'pan') {
      store.setViewport(panBy(store.getState().view.viewport, pointer.x - current.last.x, pointer.y - current.last.y))
      current.last = { x: pointer.x, y: pointer.y }
      return
    }
    if (current?.kind === 'tool') {
      current.tool.onPointerMove?.(ctx, pointer)
      return
    }
    if (event.buttons === 0 && !claimingTool('onHover', pointer)) void hoverAt(pointer)
  }

  /** A tool that claimed the press but turns down its release never dragged, so the press is a click. */
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = gesture.current
    gesture.current = null
    if (current?.kind !== 'tool') return
    const pointer = pointerAt(event)
    const used = current.tool.onPointerUp?.(ctx, pointer) ?? true
    if (!used) void selectAt(pointer)
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (store.getState().interact || spaceHeld.current) return
    const pointer = pointerAt(event)
    if (!claimingTool('onDoubleClick', pointer)) void doubleClickAt(pointer)
  }

  function containerSize() {
    const element = viewportRef.current
    return { width: element?.clientWidth ?? 0, height: element?.clientHeight ?? 0 }
  }

  function fitBoard(): void {
    if (board) store.setViewport(fitRect({ x: 0, y: 0, width: board.w, height: board.h }, containerSize()))
  }

  function fitSelection(): void {
    const bounds = boundsOf(selectionRects)
    if (bounds) store.setViewport(fitRect(bounds, containerSize()))
  }

  function selectWith(next: (tree: TemplateNode, selection: readonly EdId[]) => EdId[]): void {
    const { index, view } = store.getState()
    if (index) store.select(next(index.tree, view.selection))
  }

  function keyCommand(event: ReactKeyboardEvent): (() => void) | null {
    if (event.metaKey || event.ctrlKey || event.altKey) return null
    if (event.shiftKey && event.code === 'Digit1') return fitBoard
    if (event.shiftKey && event.code === 'Digit2') return fitSelection
    switch (event.key) {
      case 'Enter':
        return () => selectWith(event.shiftKey ? parentSelection : childSelection)
      case 'Tab':
        return () => selectWith((tree, selection) => siblingSelection(tree, selection, event.shiftKey ? -1 : 1))
      case 'Escape':
        return () => store.select([])
    }
    return null
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (textEdit.current) return
    if (event.key === ' ') {
      event.preventDefault()
      spaceHeld.current = true
      return
    }
    if (event.code === 'KeyI' && !event.repeat && !event.metaKey && !event.ctrlKey) {
      interactHeld.current = true
      store.setInteract(true)
      return
    }
    const command = keyCommand(event)
    if (!command) return
    event.preventDefault()
    command()
  }

  function onKeyUp(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === ' ') spaceHeld.current = false
    if (event.code === 'KeyI' && interactHeld.current) {
      interactHeld.current = false
      store.setInteract(false)
    }
  }

  const selectionBounds = boundsOf(selectionRects)

  return (
    <div className="canvas-view" style={styles.view}>
      <CanvasBar
        layout={layout}
        current={state.board}
        interact={state.interact}
        onOpen={openBoard}
        onInteract={() => store.setInteract(!store.getState().interact)}
      />
      <div
        ref={viewportRef}
        data-canvas-viewport=""
        className="canvas"
        tabIndex={0}
        aria-label="Canvas"
        style={styles.viewport}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <div data-canvas-board="" style={{ ...styles.board, transform: viewportTransform(viewport) }}>
          {board && state.index?.board === board.path && (
            <ArtboardFrame key={board.path} board={board} src={state.index.frameSrc} onFrame={attachFrame} />
          )}
        </div>
        <div
          ref={shieldRef}
          data-canvas-shield=""
          style={{ ...styles.shield, pointerEvents: state.interact ? 'none' : 'auto' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => store.setHover(null)}
          onDoubleClick={onDoubleClick}
        />
        <div style={styles.overlay}>
          {hoverRects.map((rect, i) => (
            <Outline key={`hover-${i}`} kind="hover" box={screenBoxOf(viewport, rect)} />
          ))}
          {selectionRects.map((rect, i) => (
            <Outline key={`selection-${i}`} kind="selection" box={screenBoxOf(viewport, rect)} />
          ))}
        </div>
        <Rulers viewport={viewport} range={selectionBounds && screenBoxOf(viewport, selectionBounds)} />
      </div>
    </div>
  )
}

interface ArtboardFrameProps {
  readonly board: Board
  readonly src: string
  readonly onFrame: (frame: HTMLIFrameElement) => () => void
}

function ArtboardFrame({ board, src, onFrame }: ArtboardFrameProps) {
  return (
    <iframe
      ref={onFrame}
      src={src}
      sandbox="allow-scripts"
      title={fileName(board.path)}
      style={{ ...styles.frame, width: board.w, height: board.h }}
    />
  )
}

interface CanvasBarProps {
  readonly layout: CanvasLayout
  readonly current: ProjectPath | null
  readonly interact: boolean
  readonly onOpen: (board: ProjectPath) => void
  readonly onInteract: () => void
}

function CanvasBar({ layout, current, interact, onOpen, onInteract }: CanvasBarProps) {
  return (
    <div className="canvas-bar" style={styles.bar}>
      <div data-board-switcher="" role="tablist" aria-label="Artboards" style={styles.switcher}>
        {layout.order.map((path) => {
          const isPage = layout.pages.includes(path)
          const on = path === current
          return (
            <button
              key={path}
              type="button"
              role="tab"
              aria-selected={on}
              data-board={path}
              {...(isPage ? { 'data-page': '' } : {})}
              title={isPage ? `${fileName(path)} · page` : fileName(path)}
              style={on ? { ...styles.boardButton, ...styles.boardButtonOn } : styles.boardButton}
              onClick={() => onOpen(path)}
            >
              {fileName(path)}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={interact}
        aria-label="Interact"
        title="Interact  hold I"
        style={interact ? { ...styles.interact, ...styles.interactOn } : styles.interact}
        onClick={onInteract}
      >
        Interact
      </button>
    </div>
  )
}

function Outline({ kind, box }: { readonly kind: 'hover' | 'selection'; readonly box: ScreenBox }) {
  return <div data-outline={kind} style={{ ...(kind === 'hover' ? styles.hover : styles.selection), ...box }} />
}

const RULER = 20
const RULER_TICK = 100

function Rulers({ viewport, range }: { readonly viewport: Viewport; readonly range: ScreenBox | null }) {
  const tick = RULER_TICK * viewport.zoom
  return (
    <>
      <div
        data-ruler="x"
        style={{ ...styles.rulerX, backgroundSize: `${tick}px 6px`, backgroundPosition: `${viewport.panX}px 100%` }}
      >
        {range && <div data-ruler-range="" style={{ ...styles.rulerRange, top: 0, height: RULER, left: range.left, width: range.width }} />}
      </div>
      <div
        data-ruler="y"
        style={{ ...styles.rulerY, backgroundSize: `6px ${tick}px`, backgroundPosition: `100% ${viewport.panY}px` }}
      >
        {range && <div data-ruler-range="" style={{ ...styles.rulerRange, left: 0, width: RULER, top: range.top, height: range.height }} />}
      </div>
      <div style={styles.rulerCorner} />
    </>
  )
}

const styles = {
  view: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 40,
    padding: '0 8px',
    background: 'var(--panel)',
    borderBottom: '1px solid var(--line)',
  },
  switcher: { display: 'flex', gap: 2, minWidth: 0, overflowX: 'auto' },
  boardButton: {
    height: 28,
    padding: '0 10px',
    borderRadius: 'var(--r-sm)',
    color: 'var(--text-2)',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  boardButtonOn: { background: 'var(--accent-soft)', color: 'var(--text)' },
  interact: {
    marginLeft: 'auto',
    height: 28,
    padding: '0 10px',
    borderRadius: 'var(--r-sm)',
    background: 'var(--field)',
    color: 'var(--text-2)',
    fontWeight: 600,
  },
  interactOn: { background: 'var(--accent)', color: 'var(--accent-ink)' },
  viewport: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    outline: 'none',
    backgroundColor: 'var(--canvas)',
    backgroundImage: 'radial-gradient(var(--canvas-dot) 1px, transparent 1.2px)',
    backgroundSize: '16px 16px',
  },
  board: { position: 'absolute', left: 0, top: 0, transformOrigin: '0 0' },
  frame: { display: 'block', border: 0, background: '#fff', boxShadow: 'var(--ab-shadow)' },
  shield: { position: 'absolute', inset: 0 },
  overlay: { position: 'absolute', inset: 0, pointerEvents: 'none' },
  hover: { position: 'absolute', boxSizing: 'border-box', border: '1px solid color-mix(in srgb, var(--sel) 70%, transparent)' },
  selection: { position: 'absolute', boxSizing: 'border-box', border: '1px solid var(--sel)' },
  rulerX: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    height: RULER,
    backgroundColor: 'var(--panel)',
    backgroundImage: 'linear-gradient(to right, var(--line-strong) 1px, transparent 1px)',
    backgroundRepeat: 'repeat-x',
    borderBottom: '1px solid var(--line)',
    pointerEvents: 'none',
  },
  rulerY: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: RULER,
    backgroundColor: 'var(--panel)',
    backgroundImage: 'linear-gradient(to bottom, var(--line-strong) 1px, transparent 1px)',
    backgroundRepeat: 'repeat-y',
    borderRight: '1px solid var(--line)',
    pointerEvents: 'none',
  },
  rulerRange: { position: 'absolute', background: 'var(--accent-soft)' },
  rulerCorner: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: RULER,
    height: RULER,
    background: 'var(--panel)',
    borderRight: '1px solid var(--line)',
    borderBottom: '1px solid var(--line)',
  },
} satisfies Record<string, CSSProperties>
