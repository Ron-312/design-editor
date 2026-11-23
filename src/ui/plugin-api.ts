import type { ComponentType } from 'react'
import type { BoardIndex, EditorState, ProbeRead, ProbeReadResult, ServerMessage } from '../shared/protocol'
import type { EdId, EditOp, EditRecord, ProjectPath } from '../shared/types'
import type { ActionRegistry, Platform } from './actions/registry'
import type { ProbeClient } from './probe-client'

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

/** `'100'` zooms to 100% around the centre of the view. */
export type FitKind = 'board' | 'selection' | '100'

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
  readonly setMode: (mode: 'select' | 'hand') => void
  readonly fit: (kind: FitKind) => void
  /** Drops the gesture a tool claimed, through its `onCancel`; returns whether there was one. */
  readonly cancelGesture: () => boolean
  /** Editor-only state (collapsed, hidden, locked, preview width); never written into the source. */
  readonly setEditorState: (patch: Partial<EditorState>) => void
  /** A fresh id that every op of one user action carries, so the action is one undo entry. */
  readonly beginAction: () => string
  /**
   * Previews a `setDecl` / `removeDecl` in the iframe, then resolves with the server's ack.
   * Without an `actionId` the op is an action of its own.
   */
  readonly apply: (op: EditOp, actionId?: string) => Promise<AckMessage>
  /** Shows a `setDecl` / `removeDecl` in the iframe and writes nothing. */
  readonly preview: (op: EditOp) => void
  readonly undo: () => void
  readonly redo: () => void
  /** Batched by the probe once per frame. */
  readonly read: <R extends ProbeRead>(read: R) => Promise<Extract<ProbeReadResult, { kind: R['kind'] }>>
  readonly records: () => readonly EditRecord[]
  readonly toast: (toast: Toast) => void
  readonly onChange: (listener: () => void) => Unsubscribe
}

/**
 * Where a shortcut's keydown may come from: `'canvas'` is the canvas viewport or nothing focused,
 * `'layers'` the layers panel, `'global'` anywhere. None of them is a text field.
 */
export type ActionScope = 'canvas' | 'layers' | 'global'

/** One entry in the action registry that menus, shortcuts and the command palette all read. */
export interface EditorAction {
  readonly id: string
  readonly label: string
  /** `Mod` is Cmd on macOS and Ctrl on Windows, e.g. `Mod+Shift+'`; every alias binds, menus show the first. */
  readonly kbd?: string | readonly string[]
  /** Replaces `kbd` on a platform it names, for a chord that differs between macOS and Windows. */
  readonly kbdByPlatform?: Readonly<Partial<Record<Platform, string | readonly string[]>>>
  /** Defaults to `'global'`; a list applies wherever any of its scopes does. */
  readonly scope?: ActionScope | readonly ActionScope[]
  /** Also fires from a text field. */
  readonly inTextEntry?: boolean
  /** Repeats of a held key run under the first press's action id until the key is released. */
  readonly hold?: boolean
  /** Shown as a toast when the shortcut is pressed while `when` fails. */
  readonly disabledReason?: string
  readonly run: (ctx: EditorContext, actionId: string) => void
  readonly when?: ((ctx: EditorContext) => boolean) | undefined
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
  /** A muted aside after the title, such as "in auto layout". */
  readonly note?: ComponentType<PanelSectionProps>
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
  /** The claimed gesture ended without a release (pointercancel, lost capture, Escape): drop it and write nothing. */
  readonly onCancel?: (ctx: EditorContext) => void
}

export interface ShellSlotProps {
  readonly ctx: EditorContext
  readonly registry: ActionRegistry
  readonly platform: Platform
  readonly probe: ProbeClient | null
}

/** UI the shell mounts in the top bar or above the whole editor, such as the command palette. */
export interface ShellSlot {
  readonly id: string
  readonly place: 'top-bar' | 'overlay'
  readonly component: ComponentType<ShellSlotProps>
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
