/// <reference types="vite/client" />
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type RefObject,
} from 'react'
import type { EditorState, ProbeToEditor, Rect, ResolvedValues } from '../../shared/protocol'
import type { Board, CanvasLayout, EdId, EditOp, ProjectPath, TemplateNode } from '../../shared/types'
import type { Platform } from '../actions/registry'
import type { CanvasPointer, CanvasTool, EditorContext, FitKind, PointerHandler, Viewport } from '../plugin-api'
import { createProbeClient, type ProbeClient } from '../probe-client'
import type { EditorStore } from '../store'
import type { WsClient } from '../ws-client'
import { boundsOf, screenBoxOf, type ScreenBox } from './overlay'
import { clickSelection, doubleClickSelection, findNode, selectableHit } from './selection'
import { fitRect, panBy, screenToBoard, viewportTransform, wheelZoomFactor, zoomAt, zoomTo, type Insets, type Point, type Size } from './viewport'

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

/** What the shell's zoom menu asks of the canvas. */
export interface CanvasCommands {
  readonly fitBoard: () => void
  readonly fitSelection: () => void
  readonly zoomTo: (zoom: number) => void
}

export interface CanvasViewProps {
  readonly ref?: Ref<CanvasCommands>
  readonly store: EditorStore
  readonly ws: WsClient
  readonly layout: CanvasLayout
  readonly editorState: EditorState
  readonly platform: Platform
  readonly tools?: readonly CanvasTool[]
  /** Hands the shell the probe of the mounted artboard, null while none is loaded. */
  readonly onProbe?: (probe: ProbeClient | null) => void
  /** Hands the shell the editor context, view setters included, each time it changes. */
  readonly onContext?: (ctx: EditorContext) => void
  readonly onEditorStateChange?: (next: EditorState) => void
}

/** What the context's view setters reach: the canvas's own fit and gesture, and the shell's editor state. */
export interface CanvasViewControls {
  readonly fit: (kind: FitKind) => void
  readonly cancelGesture: () => boolean
  readonly changeEditorState: (next: EditorState) => void
}

/** A context made outside a mounted canvas has no view to fit, no gesture to drop and no shell to tell. */
const DETACHED_VIEW: CanvasViewControls = { fit: () => {}, cancelGesture: () => false, changeEditorState: () => {} }

type ToolHandler = 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onDoubleClick' | 'onHover'

type Gesture = { readonly kind: 'pan'; last: Point } | { readonly kind: 'tool'; readonly tool: CanvasTool }

/** One load of the artboard in its frame; each `ready` is a new one. */
interface FrameLoad {
  readonly probe: ProbeClient
}

interface ContentHeight {
  readonly load: FrameLoad
  readonly previewWidth: number
  readonly height: number
}

interface TextEdit {
  readonly session: string
  readonly edId: EdId
}

const PAGE_RESET = 'Page reset to its first state'
const PAGE_REDREW = 'Page redrew, edit cancelled'
const LIVE_VALUE = 'Contains a live value; edit in source or Tweaks'
const EDIT_IN_SOURCE = 'Edit in source: only an element holding a single run of text is edited in place'

const RULER = 20
/** Room around a fitted board: the rulers, the board's label above it, and a margin. */
const BOARD_INSETS: Insets = { top: RULER + 48, right: 40, bottom: 40, left: RULER + 40 }
/** A preview width can make a board grow taller; past this many board heights it is cut off. */
const MAX_GROWTH = 4

function fileName(path: ProjectPath): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function sizeOf(element: HTMLElement | null): Size {
  return { width: element?.clientWidth ?? 0, height: element?.clientHeight ?? 0 }
}

function boardFit(frame: Size, container: Size) {
  return fitRect({ x: 0, y: 0, ...frame }, container, BOARD_INSETS)
}

function grownHeight(board: Board, scrollHeight: number): number {
  return Math.min(Math.max(board.h, scrollHeight), MAX_GROWTH * board.h)
}

/**
 * The content height at a preview width, measured once per frame load and width with the frame held at the
 * board's height: `vh` units resolve against the frame, so measuring a grown frame would grow it without end.
 */
function useContentHeight(load: FrameLoad | null, board: Board | undefined, previewWidth: number | undefined): number | undefined {
  const [measured, setMeasured] = useState<ContentHeight | null>(null)
  useLayoutEffect(() => {
    if (!load || !board || previewWidth === undefined) return
    let current = true
    load.probe
      .read({ kind: 'documentHeight' })
      .then(({ scrollHeight }) => {
        if (current) setMeasured({ load, previewWidth, height: grownHeight(board, scrollHeight) })
      })
      // A reload rejects reads in flight; its own `ready` measures again.
      .catch(() => {})
    return () => {
      current = false
    }
  }, [load, board, previewWidth])
  return measured?.load === load && measured.previewWidth === previewWidth ? measured.height : undefined
}

/** The element's size, kept current as the window or the panels around it change. */
function useSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setSize(sizeOf(element))
    const observer = new ResizeObserver(() => setSize(sizeOf(element)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

export function openBoard(store: EditorStore, ws: WsClient, board: ProjectPath): void {
  store.setBoard(board)
  ws.send({ type: 'open', board })
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

const mintActionId = () => crypto.randomUUID()

function previewedValues(probe: ProbeClient | null, op: EditOp): ResolvedValues {
  if (op.kind === 'setDecl') {
    probe?.previewDecl(op.target, op.payload.prop, op.payload.value)
    return Object.fromEntries(op.target.map((edId) => [edId, op.payload.value]))
  }
  if (op.kind === 'removeDecl') probe?.previewDecl(op.target, op.payload.prop, null)
  return {}
}

export function canvasContext(
  store: EditorStore,
  ws: WsClient,
  probe: ProbeClient | null,
  editorState: EditorState,
  view: CanvasViewControls = DETACHED_VIEW,
): EditorContext {
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
    setMode: (mode) => store.setMode(mode),
    fit: (kind) => view.fit(kind),
    cancelGesture: () => view.cancelGesture(),
    setEditorState: (patch) => view.changeEditorState({ ...editorState, ...patch }),
    beginAction: mintActionId,
    apply: (op, actionId = mintActionId()) => ws.sendOp({ ...op, actionId }, previewedValues(probe, op)),
    preview: (op) => {
      previewedValues(probe, op)
    },
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

/** Controls that stay the same object while the canvas behind them re-renders, so the context need not change. */
function forwardingControls() {
  let target = DETACHED_VIEW
  const view: CanvasViewControls = {
    fit: (kind) => target.fit(kind),
    cancelGesture: () => target.cancelGesture(),
    changeEditorState: (next) => target.changeEditorState(next),
  }
  return {
    view,
    forwardTo(next: CanvasViewControls) {
      target = next
    },
  }
}

export function CanvasView({
  ref,
  store,
  ws,
  layout,
  editorState,
  platform,
  tools = DEFAULT_TOOLS,
  onProbe,
  onContext,
  onEditorStateChange,
}: CanvasViewProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [probe, setProbe] = useState<ProbeClient | null>(null)
  const [load, setLoad] = useState<FrameLoad | null>(null)
  const [renderCount, setRenderCount] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const shieldRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const textEdit = useRef<TextEdit | null>(null)
  const spaceHeld = useRef(false)
  const interactHeld = useRef(false)
  const [controls] = useState(forwardingControls)

  const orderedTools = useMemo(() => [...tools].sort(byDescendingPriority), [tools])
  const ctx = useMemo(() => canvasContext(store, ws, probe, editorState, controls.view), [store, ws, probe, editorState, controls])
  const hovered = useMemo(() => (state.hover ? [state.hover] : []), [state.hover])
  const selectionRects = useRenderedRects(probe, state.view.selection, renderCount)
  const hoverRects = useRenderedRects(probe, hovered, renderCount)

  const viewportSize = useSize(viewportRef)
  const board = layout.boards.find((entry) => entry.path === state.board)
  const viewport = state.view.viewport
  const previewWidth = board && editorState.boards[board.path]?.previewWidth
  const contentHeight = useContentHeight(load, board, previewWidth)
  const frameWidth = previewWidth ?? board?.w ?? 0
  const frameHeight = contentHeight ?? board?.h ?? 0

  useEffect(() => {
    onContext?.(ctx)
  }, [ctx, onContext])

  useEffect(() => {
    const current = store.getState().board
    const first = current && layout.order.includes(current) ? current : layout.order[0]
    if (first) openBoard(store, ws, first)
  }, [store, ws, layout])

  useLayoutEffect(() => {
    const container = sizeOf(viewportRef.current)
    const laidOut = container.width > 0 && container.height > 0
    if (board && laidOut && !store.hasView(board.path)) store.setViewport(boardFit({ width: frameWidth, height: frameHeight }, container))
  }, [store, board, frameWidth, frameHeight])

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
            setLoad({ probe: client })
            rendered()
            break
          case 'scrolled':
            store.setScroll({ x: message.scrollX, y: message.scrollY })
            rendered()
            break
          case 'textCommit':
            textEdit.current = null
            // The ws client reports a refused op with its own toast.
            ws.sendOp({ target: [message.edId], kind: 'setText', payload: { text: message.text }, actionId: mintActionId() }, {}).catch(() => {})
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
        setLoad(null)
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
    if (spaceHeld.current || store.getState().mode === 'hand') {
      gesture.current = { kind: 'pan', last: { x: pointer.x, y: pointer.y } }
      return
    }
    const tool = claimingTool('onPointerDown', pointer)
    gesture.current = tool ? { kind: 'tool', tool } : null
    if (!tool) void selectAt(pointer).catch(() => {})
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
    if (event.buttons === 0 && store.getState().mode === 'select' && !claimingTool('onHover', pointer)) void hoverAt(pointer).catch(() => {})
  }

  /** A tool that claimed the press but turns down its release never dragged, so the press is a click. */
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = gesture.current
    gesture.current = null
    if (current?.kind !== 'tool') return
    const pointer = pointerAt(event)
    const used = current.tool.onPointerUp?.(ctx, pointer) ?? true
    if (!used) void selectAt(pointer).catch(() => {})
  }

  function cancelGesture(): boolean {
    const current = gesture.current
    gesture.current = null
    if (current?.kind === 'tool') current.tool.onCancel?.(ctx)
    return current !== null
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (store.getState().interact || spaceHeld.current) return
    const pointer = pointerAt(event)
    if (!claimingTool('onDoubleClick', pointer)) void doubleClickAt(pointer).catch(() => {})
  }

  function fitBoard(): void {
    if (board) store.setViewport(boardFit({ width: frameWidth, height: frameHeight }, sizeOf(viewportRef.current)))
  }

  function fitSelection(): void {
    const bounds = boundsOf(selectionRects)
    if (bounds) store.setViewport(fitRect(bounds, sizeOf(viewportRef.current)))
  }

  function zoomToLevel(zoom: number): void {
    store.setViewport(zoomTo(store.getState().view.viewport, zoom, sizeOf(viewportRef.current)))
  }

  function fit(kind: FitKind): void {
    if (kind === 'board') fitBoard()
    else if (kind === 'selection') fitSelection()
    else zoomToLevel(1)
  }

  useImperativeHandle(ref, () => ({ fitBoard, fitSelection, zoomTo: zoomToLevel }))

  useLayoutEffect(() => {
    controls.forwardTo({ fit, cancelGesture, changeEditorState: (next) => onEditorStateChange?.(next) })
  })

  /** Space and I act while held, so they stay here; every pressed shortcut is an action in the registry. */
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
    }
  }

  function onKeyUp(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === ' ') spaceHeld.current = false
    if (event.code === 'KeyI' && interactHeld.current) {
      interactHeld.current = false
      store.setInteract(false)
    }
  }

  const selectionBounds = boundsOf(selectionRects)
  const panning = state.mode === 'hand'

  return (
    <div className="canvas-view" style={styles.view}>
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
            <ArtboardFrame
              key={board.path}
              board={board}
              size={{ width: frameWidth, height: frameHeight }}
              src={state.index.frameSrc}
              onFrame={attachFrame}
            />
          )}
        </div>
        <div
          ref={shieldRef}
          data-canvas-shield=""
          style={{ ...styles.shield, pointerEvents: state.interact ? 'none' : 'auto', cursor: panning ? 'grab' : 'default' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelGesture}
          onLostPointerCapture={cancelGesture}
          onPointerLeave={() => store.setHover(null)}
          onDoubleClick={onDoubleClick}
        />
        <div style={styles.overlay}>
          {board && (
            <BoardLabel board={board} size={{ width: frameWidth, height: frameHeight }} preview={previewWidth !== undefined} viewport={viewport} />
          )}
          {hoverRects.map((rect, i) => (
            <Outline key={`hover-${i}`} kind="hover" box={screenBoxOf(viewport, rect)} />
          ))}
          {selectionRects.map((rect, i) => (
            <Outline key={`selection-${i}`} kind="selection" box={screenBoxOf(viewport, rect)} />
          ))}
          {selectionBounds && <SizeTag bounds={selectionBounds} viewport={viewport} />}
        </div>
        <Rulers viewport={viewport} size={viewportSize} selection={selectionBounds} />
      </div>
    </div>
  )
}

interface ArtboardFrameProps {
  readonly board: Board
  readonly size: Size
  readonly src: string
  readonly onFrame: (frame: HTMLIFrameElement) => () => void
}

function ArtboardFrame({ board, size, src, onFrame }: ArtboardFrameProps) {
  return (
    <iframe
      ref={onFrame}
      src={src}
      sandbox="allow-scripts"
      title={fileName(board.path)}
      style={{ ...styles.frame, ...size }}
    />
  )
}

function Outline({ kind, box }: { readonly kind: 'hover' | 'selection'; readonly box: ScreenBox }) {
  return <div data-outline={kind} style={{ ...(kind === 'hover' ? styles.hover : styles.selection), ...box }} />
}

interface BoardLabelProps {
  readonly board: Board
  readonly size: Size
  /** Names the width a preview, so a restored preview width is never taken for the authored one. */
  readonly preview: boolean
  readonly viewport: Viewport
}

function BoardLabel({ board, size, preview, viewport }: BoardLabelProps) {
  const box = screenBoxOf(viewport, { x: 0, y: 0, ...size })
  return (
    <div className="ablabel" data-board-label="" style={{ left: box.left, top: box.top - 24, width: box.width }}>
      <span>{fileName(board.path)}</span>
      <span className="dims">
        {preview ? `${size.width} preview` : size.width} × {size.height}
      </span>
    </div>
  )
}

function SizeTag({ bounds, viewport }: { readonly bounds: Rect; readonly viewport: Viewport }) {
  const box = screenBoxOf(viewport, bounds)
  return (
    <div className="tag size" data-size-tag="" style={{ left: box.left + box.width / 2, top: box.top + box.height + 8 }}>
      {Math.round(bounds.width)} × {Math.round(bounds.height)}
    </div>
  )
}

/** Board units between numbered ticks: the smallest that keeps the numbers this far apart on screen. */
const RULER_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
const RULER_LABEL_GAP = 48
/** Numbers this close to a selection edge give way to the edge's own number. */
const RULER_EDGE_CLEARANCE = 32

function rulerStep(zoom: number): number {
  return RULER_STEPS.find((step) => step * zoom >= RULER_LABEL_GAP) ?? RULER_STEPS.at(-1)!
}

function tickValues(pan: number, zoom: number, length: number, step: number): number[] {
  const values: number[] = []
  for (let value = Math.ceil(-pan / zoom / step) * step; pan + value * zoom < length; value += step) values.push(value)
  return values
}

interface RulerProps {
  readonly axis: 'x' | 'y'
  readonly pan: number
  readonly zoom: number
  readonly length: number
  /** The selection's start and end in board units. */
  readonly range: readonly [number, number] | null
}

function Ruler({ axis, pan, zoom, length, range }: RulerProps) {
  const step = rulerStep(zoom)
  const major = step * zoom
  const toScreen = (value: number) => pan + value * zoom
  const edges = range?.map(toScreen) ?? []
  const ticks = tickValues(pan, zoom, length, step).filter((value) => edges.every((edge) => Math.abs(toScreen(value) - edge) > RULER_EDGE_CLEARANCE))
  const along = axis === 'x' ? 'left' : 'top'
  const extent = axis === 'x' ? 'width' : 'height'
  const background =
    axis === 'x'
      ? { backgroundSize: `${major / 5}px 4px, ${major}px ${RULER}px`, backgroundPosition: `${pan}px 100%, ${pan}px 0` }
      : { backgroundSize: `4px ${major / 5}px, ${RULER}px ${major}px`, backgroundPosition: `100% ${pan}px, 0 ${pan}px` }

  return (
    <div data-ruler={axis} className={`ruler ${axis}`} style={background}>
      {range && <div data-ruler-range="" className="band" style={{ [along]: edges[0], [extent]: edges[1]! - edges[0]! }} />}
      {ticks.map((value) => (
        <span key={value} style={{ [along]: toScreen(value) }}>
          {value}
        </span>
      ))}
      {range?.map((value, at) => (
        <span key={`edge-${at}`} className={at === 0 ? 'edge' : 'edge end'} style={{ [along]: edges[at] }}>
          {Math.round(value)}
        </span>
      ))}
    </div>
  )
}

function Rulers({ viewport, size, selection }: { readonly viewport: Viewport; readonly size: Size; readonly selection: Rect | null }) {
  const { zoom, panX, panY } = viewport
  return (
    <>
      <Ruler axis="x" pan={panX} zoom={zoom} length={size.width} range={selection && [selection.x, selection.x + selection.width]} />
      <Ruler axis="y" pan={panY} zoom={zoom} length={size.height} range={selection && [selection.y, selection.y + selection.height]} />
      <div className="ruler corner" />
    </>
  )
}

const styles = {
  view: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
  viewport: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    outline: 'none',
    backgroundColor: 'var(--canvas)',
    backgroundImage: 'radial-gradient(var(--canvas-dot) 1px, transparent 1.2px)',
    backgroundSize: '16px 16px',
    backgroundPosition: '4px 4px',
  },
  board: { position: 'absolute', left: 0, top: 0, transformOrigin: '0 0' },
  frame: { display: 'block', border: 0, background: '#fff', boxShadow: 'var(--ab-shadow)' },
  shield: { position: 'absolute', inset: 0 },
  overlay: { position: 'absolute', inset: 0, pointerEvents: 'none' },
  hover: { position: 'absolute', boxSizing: 'border-box', border: '1px solid color-mix(in srgb, var(--sel) 70%, transparent)' },
  selection: { position: 'absolute', boxSizing: 'border-box', border: '1px solid var(--sel)' },
} satisfies Record<string, CSSProperties>
