import type { ComponentType } from 'react'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult, ServerMessage } from '../shared/protocol'
import type { EdId, EditOp, EditRecord, ProjectPath } from '../shared/types'

export type AckMessage = Extract<ServerMessage, { type: 'ack' }>

export interface Selection {
  readonly board: ProjectPath
  /** Ancestors of other selected elements are already dropped. */
  readonly edIds: readonly EdId[]
}

export interface Viewport {
  readonly zoom: number
  readonly panX: number
  readonly panY: number
}

export interface ToastAction {
  readonly label: string
  readonly run: () => void
}

export interface Toast {
  readonly message: string
  readonly tone?: 'info' | 'warning' | 'error'
  readonly actions?: readonly ToastAction[]
}

export type Unsubscribe = () => void

/** What every plugin sees of the editor; the only way plugins read state or change the source. */
export interface EditorContext {
  readonly index: () => BoardIndex | null
  readonly selection: () => Selection | null
  readonly viewport: () => Viewport
  readonly editorState: () => EditorState
  /** True while a push holds `.editor/push.lock` or the editor opened read-only. */
  readonly readOnly: () => boolean
  readonly select: (edIds: readonly EdId[]) => void
  readonly setViewport: (viewport: Viewport) => void
  /** Previews a `setDecl` / `removeDecl` in the iframe, then resolves with the server's ack. */
  readonly apply: (op: EditOp) => Promise<AckMessage>
  readonly undo: () => void
  readonly redo: () => void
  /** Batched by the probe once per frame. */
  readonly read: <R extends ProbeRead>(read: R) => Promise<Extract<ProbeReadResult, { kind: R['kind'] }>>
  readonly records: () => readonly EditRecord[]
  readonly toast: (toast: Toast) => void
  readonly onChange: (listener: () => void) => Unsubscribe
}

/** One entry in the action registry that menus, shortcuts and the command palette all read. */
export interface EditorAction {
  readonly id: string
  readonly label: string
  /** `Mod` is Cmd on macOS and Ctrl on Windows, e.g. `Mod+Shift+'`. */
  readonly kbd?: string
  readonly run: (ctx: EditorContext) => void
  readonly when?: (ctx: EditorContext) => boolean
}

export interface PanelSectionProps {
  readonly ctx: EditorContext
  readonly selection: Selection
}

/** A section of the properties panel; sections render in ascending `order`. */
export interface PanelSection {
  readonly id: string
  readonly title: string
  readonly order: number
  readonly appliesTo: (ctx: EditorContext, selection: Selection) => boolean
  readonly component: ComponentType<PanelSectionProps>
}

export interface OverlayLayerProps {
  readonly ctx: EditorContext
}

/** Plain DOM/SVG drawn above the iframe in viewport space (handles, guides, measure lines). */
export interface OverlayLayer {
  readonly id: string
  readonly order: number
  readonly component: ComponentType<OverlayLayerProps>
}

export interface CanvasPointer {
  /** Viewport (screen) coordinates. */
  readonly x: number
  readonly y: number
  /** The same point in artboard coordinates, zoom and pan removed. */
  readonly boardX: number
  readonly boardY: number
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly modKey: boolean
  readonly ctrlKey: boolean
}

/** Returning true claims the gesture, so lower-priority tools do not see it. */
export type PointerHandler = (ctx: EditorContext, pointer: CanvasPointer) => boolean

/** Gestures on the event shield; tools are consulted in descending `priority`. */
export interface CanvasTool {
  readonly id: string
  readonly priority: number
  readonly onPointerDown?: PointerHandler
  readonly onPointerMove?: PointerHandler
  readonly onPointerUp?: PointerHandler
  readonly onDoubleClick?: PointerHandler
  readonly onHover?: PointerHandler
}

export interface EditorPlugin {
  readonly id: string
  readonly actions?: readonly EditorAction[]
  readonly panelSections?: readonly PanelSection[]
  readonly overlayLayers?: readonly OverlayLayer[]
  readonly tools?: readonly CanvasTool[]
  /** Runs once when the editor starts; the returned function runs on shutdown. */
  readonly activate?: (ctx: EditorContext) => Unsubscribe | void
}
