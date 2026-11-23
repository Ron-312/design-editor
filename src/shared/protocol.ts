import type {
  CanvasLayout,
  EdId,
  EditOp,
  EditRecord,
  ElementLocation,
  ProjectPath,
  RuleId,
  StyleSource,
  TemplateNode,
} from './types'

export const DEFAULT_EDITOR_PORT = 5300
export const LOOPBACK_HOST = '127.0.0.1'

/** The project origin is always the editor port + 1. */
export function projectPortFor(editorPort: number): number {
  return editorPort + 1
}

export const WS_PATH = '/ws'
export const WS_TOKEN_PARAM = 'token'
export const TOKEN_HEADER = 'x-editor-token'
/** Project documents live under `/project/<secret>/`; the secret is per launch and distinct from the token. */
export const PROJECT_PATH_PREFIX = '/project/'
export const BLOB_PATH_PREFIX = '/_blob/'
export const SUPPORT_JS = 'support.js'
/** Inside `.editor/cache/`: names the type release whose `<release>/support.js` the canvas runs on. */
export const CURRENT_RELEASE_FILE = 'current-release'

export const EDITOR_DIR = '.editor'
export const EDITOR_FILES = {
  state: '.editor/state.json',
  server: '.editor/server.json',
  pushLock: '.editor/push.lock',
  base: '.editor/base.json',
  cache: '.editor/cache',
  shots: '.editor/shots',
  asks: '.editor/asks',
} as const

/** `.editor/server.json`: how `edsync` finds the one running editor. */
export interface ServerInfo {
  readonly port: number
  readonly token: string
  readonly pid: number
  readonly startedAt: number
}

/** A design-system token: `tokens.json` tokens are written as their literal value, `:root` variables as `var()`. */
export interface DesignToken {
  readonly name: string
  readonly value: string
  readonly source: 'tokens.json' | ':root'
}

export interface BoardView {
  readonly zoom: number
  readonly panX: number
  readonly panY: number
  readonly selection: readonly EdId[]
  /** View-only canvas width; the file is never written for it. */
  readonly previewWidth?: number
}

/** Editor-only state; never written into the source. */
export interface EditorState {
  readonly hidden: readonly EdId[]
  readonly locked: readonly EdId[]
  readonly collapsed: readonly EdId[]
  readonly boards: Readonly<Record<ProjectPath, BoardView>>
}

/** An outside edit re-ids the nodes it replaced; editor-only state follows them to the node now at each element path. */
export function withReplacedIds(state: EditorState, replaced: Readonly<Record<EdId, EdId>>): EditorState {
  const follow = (edIds: readonly EdId[]) => edIds.map((edId) => replaced[edId] ?? edId)
  const boards = Object.entries(state.boards).map(([board, view]) => [board, { ...view, selection: follow(view.selection) }])
  return { hidden: follow(state.hidden), locked: follow(state.locked), collapsed: follow(state.collapsed), boards: Object.fromEntries(boards) }
}

// ── HTTP API on the editor port (token-guarded) ───────────────────────────────

export const HTTP_ROUTES = {
  health: '/health',
  pushBegin: '/push/begin',
  pushEnd: '/push/end',
  shutdown: '/shutdown',
} as const

export interface HealthResponse {
  readonly ok: true
  readonly pid: number
}

/** The CLI picks the nonce, so a `/push/end` sent after it timed out cancels the begin it gave up on. */
export interface PushBeginRequest {
  readonly nonce?: string
}

/** Sent once the debounce is flushed to disk and the canvas is locked. */
export interface PushBeginResponse {
  readonly nonce: string
}

export interface PushEndRequest {
  readonly nonce: string
}

// ── WebSocket: editor UI ↔ server ─────────────────────────────────────────────

export type ClientMessage =
  | { readonly type: 'open'; readonly board: ProjectPath }
  | { readonly type: 'op'; readonly opId: string; readonly op: EditOp }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'resolvePending'; readonly file: ProjectPath; readonly keep: boolean }
  | { readonly type: 'revertFile'; readonly file: ProjectPath }
  | { readonly type: 'saveEditorState'; readonly state: EditorState }
  /** The user's answer to `pushStale`: the push stopped in Claude Code, so the editor releases its lock. */
  | { readonly type: 'unlockStalePush' }

export interface BoardIndex {
  readonly board: ProjectPath
  /** `/project/<secret>/<board>`; the only place the capability prefix appears. */
  readonly frameSrc: string
  readonly tree: TemplateNode
  readonly locations: Readonly<Record<EdId, ElementLocation>>
  /** The board's source exactly as indexed; every range in this message slices it. */
  readonly text: string
  /** Inline styles only; helmet rules are listed in `rules`, since the server has no selector matcher. */
  readonly styles: Readonly<Record<EdId, readonly StyleSource[]>>
  /** The `<helmet><style>` rules in source order. */
  readonly rules: readonly HelmetRuleSource[]
}

export interface HelmetRuleSource extends StyleSource {
  readonly target: RuleId
  readonly selector: string
  readonly media: string | null
}

/** The value the re-indexed source now resolves for each target, for the ack-vs-live check. */
export type ResolvedValues = Readonly<Record<EdId, string | null>>

/** One inline declaration as a restored file now holds it; null when the file has none. */
export interface RestoredDeclaration {
  readonly edId: EdId
  readonly prop: string
  readonly value: string | null
}

export interface UndoState {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly undoLabel: string | null
  readonly redoLabel: string | null
}

export type ServerMessage =
  | { readonly type: 'hello'; readonly layout: CanvasLayout; readonly editorState: EditorState; readonly readOnly: boolean }
  | { readonly type: 'index'; readonly index: BoardIndex }
  /** canvas.json changed under a push: boards were added or removed. */
  | { readonly type: 'layout'; readonly layout: CanvasLayout }
  | {
      readonly type: 'ack'
      readonly opId: string
      readonly record: EditRecord
      readonly mintedIds: readonly EdId[]
      readonly locations: Readonly<Record<EdId, ElementLocation>>
      readonly resolved: ResolvedValues
      readonly reload: boolean
      /** One-line warnings about the op, such as a move that can change which selectors match (R04). */
      readonly warnings: readonly string[]
    }
  | { readonly type: 'rejected'; readonly opId: string; readonly reason: string }
  | { readonly type: 'undoState'; readonly state: UndoState }
  | {
      readonly type: 'restored'
      readonly record: EditRecord
      readonly locations: Readonly<Record<EdId, ElementLocation>>
      readonly resolved: ResolvedValues
      readonly reload: boolean
      /** Every declaration a style-only entry restored, so the preview covers all of them, not just the last record's. */
      readonly declarations: readonly RestoredDeclaration[]
    }
  | {
      readonly type: 'outsideChange'
      readonly file: ProjectPath
      readonly pendingOps: boolean
      /** Old id of a node that no longer matches -> the id of the node now at its element path, so selection survives the reload. */
      readonly replacedIds: Readonly<Record<EdId, EdId>>
    }
  | { readonly type: 'writeFailed'; readonly file: ProjectPath; readonly reason: 'locked' | 'error'; readonly message: string }
  | { readonly type: 'pushLock'; readonly held: boolean }
  | { readonly type: 'pushStale'; readonly heldForMs: number }
  /** The token picker's list; sent on connect and again whenever it changes. */
  | { readonly type: 'tokens'; readonly tokens: readonly DesignToken[] }

// ── Probe ↔ editor over the handshake MessagePort ─────────────────────────────

/** The only `window` message the editor sends; it transfers one port of a fresh MessageChannel. */
export const PROBE_HANDSHAKE = 'design-editor:handshake'

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type HitDepth = 'top' | 'deeper' | 'deepest'

export type ProbeRead =
  | { readonly kind: 'rects'; readonly edId: EdId }
  | { readonly kind: 'computed'; readonly edId: EdId; readonly props: readonly string[] }
  | { readonly kind: 'hitTest'; readonly x: number; readonly y: number; readonly depth: HitDepth; readonly within: EdId | null }
  | { readonly kind: 'snapRects'; readonly edId: EdId }
  | { readonly kind: 'supports'; readonly condition: string }
  /** Per selector, whether any rendered instance matches it once states and pseudo-elements are stripped. */
  | { readonly kind: 'matches'; readonly edId: EdId; readonly selectors: readonly string[] }
  | { readonly kind: 'documentHeight' }
  /** The computed font size of `<html>`, which `rem` is relative to. */
  | { readonly kind: 'rootFontSize' }

export type ProbeReadResult =
  | { readonly kind: 'rects'; readonly rects: readonly Rect[] }
  | { readonly kind: 'computed'; readonly values: Readonly<Record<string, string>> }
  | { readonly kind: 'hitTest'; readonly edId: EdId | null }
  | { readonly kind: 'snapRects'; readonly self: Rect; readonly parent: Rect | null; readonly siblings: readonly Rect[] }
  | { readonly kind: 'supports'; readonly supported: boolean }
  | { readonly kind: 'matches'; readonly matched: readonly boolean[] }
  | { readonly kind: 'documentHeight'; readonly scrollHeight: number }
  | { readonly kind: 'rootFontSize'; readonly fontSize: number }

export type EditorToProbe =
  | { readonly type: 'read'; readonly id: number; readonly reads: readonly ProbeRead[] }
  | { readonly type: 'previewDecl'; readonly edIds: readonly EdId[]; readonly prop: string; readonly value: string | null }
  | { readonly type: 'beginTextEdit'; readonly session: string; readonly edId: EdId }
  | { readonly type: 'endTextEdit'; readonly session: string }
  | { readonly type: 'scrollTo'; readonly x: number; readonly y: number }
  /** One editor-only stylesheet, replaced by `css` or removed on null; never serialised. */
  | { readonly type: 'setEditorStyles'; readonly css: string | null }

export type TextCancelReason = 'redrawn' | 'detached' | 'escape'

export type ProbeToEditor =
  | { readonly type: 'ready'; readonly scrollX: number; readonly scrollY: number }
  | { readonly type: 'readResult'; readonly id: number; readonly results: readonly ProbeReadResult[] }
  | { readonly type: 'textCommit'; readonly session: string; readonly edId: EdId; readonly text: string }
  | { readonly type: 'textCancelled'; readonly session: string; readonly reason: TextCancelReason }
  | { readonly type: 'fontsFailed'; readonly families: readonly string[] }
  | { readonly type: 'scrolled'; readonly scrollX: number; readonly scrollY: number }
