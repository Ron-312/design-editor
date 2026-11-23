declare const brand: unique symbol
type Brand<T, B extends string> = T & { readonly [brand]: B }

/** Server-owned element id, allocated once per session and never reused. Never written to disk. */
export type EdId = Brand<string, 'EdId'>

const ED_ID_FORMAT = /^[a-z][a-z0-9]*$/i

export function isEdId(value: unknown): value is EdId {
  return typeof value === 'string' && ED_ID_FORMAT.test(value)
}

/** A rule inside a `<helmet><style>` block (or a stylesheet on the plain-HTML branch). */
export type RuleId = Brand<string, 'RuleId'>

/** Project-relative POSIX path (`project/hero.dc.html`); native paths exist only at the fs boundary. */
export type ProjectPath = Brand<string, 'ProjectPath'>

/** UTF-16 offsets into the file's decoded text, BOM and CR included. `end` is exclusive. */
export interface SourceRange {
  readonly start: number
  readonly end: number
}

export interface ElementLocation {
  readonly file: ProjectPath
  readonly element: SourceRange
  readonly startTag: SourceRange
  readonly attrs: Readonly<Record<string, SourceRange>>
}

export interface RuleLocation {
  readonly file: ProjectPath
  readonly selector: string
  readonly declarations: Readonly<Record<string, SourceRange>>
  readonly media: string | null
}

export type EolStyle = 'lf' | 'crlf' | 'mixed'

export interface AuthoredDeclaration {
  readonly prop: string
  readonly value: string
  readonly important: boolean
  /** The value contains a `{{hole}}`, so it is read-only. */
  readonly hasHole: boolean
}

/** Where the selector chip says a declaration lives: `style · hero.dc.html:42`. */
export interface StyleSource {
  readonly target: 'inline' | RuleId
  readonly file: ProjectPath
  readonly line: number
  readonly declarations: readonly AuthoredDeclaration[]
}

export type TemplateNodeKind = 'element' | 'sc-for' | 'sc-if' | 'dc-import'

/** Why a node refuses edits; absent when it is editable. */
export type ReadOnlyReason = 'hole' | 'dc-import' | 'script-made' | 'artboard-root'

/** One row of the Layers panel: a template node inside `<x-dc>`, not a live DOM node. */
export interface TemplateNode {
  readonly edId: EdId
  readonly kind: TemplateNodeKind
  readonly tag: string
  readonly name: string
  readonly readOnly?: ReadOnlyReason
  readonly children: readonly TemplateNode[]
}

/** One artboard as `canvas.json` describes it. */
export interface Board {
  readonly path: ProjectPath
  readonly w: number
  readonly h: number
  readonly page: boolean
}

export interface CanvasLayout {
  readonly boards: readonly Board[]
  readonly order: readonly ProjectPath[]
  readonly pages: readonly ProjectPath[]
}

export type EditKind =
  | 'setDecl'
  | 'removeDecl'
  | 'setAttr'
  | 'setText'
  | 'moveNode'
  | 'wrapNode'
  | 'unwrapNode'
  | 'duplicateNode'
  | 'deleteNode'

export interface EditPayloads {
  /** `rule` is set only when the user picked a `<helmet><style>` rule in the selector chip. */
  setDecl: { readonly prop: string; readonly value: string; readonly important?: boolean; readonly rule?: RuleId }
  removeDecl: { readonly prop: string; readonly rule?: RuleId }
  setAttr: { readonly name: string; readonly value: string }
  setText: { readonly text: string }
  /** `before: null` appends to `parent`. */
  moveNode: { readonly parent: EdId; readonly before: EdId | null }
  wrapNode: { readonly tag: string }
  unwrapNode: Record<string, never>
  duplicateNode: Record<string, never>
  deleteNode: Record<string, never>
}

/** UI → server. A multi-element edit is one op with several targets. */
export type EditOp = {
  [K in EditKind]: { readonly target: readonly EdId[]; readonly kind: K; readonly payload: EditPayloads[K] }
}[EditKind]

export type OpOf<K extends EditKind> = Extract<EditOp, { kind: K }>

/** Kinds the canvas previews in the live iframe; every other kind writes the file and reloads. */
export const PREVIEWABLE_KINDS = ['setDecl', 'removeDecl'] as const satisfies readonly EditKind[]

export type EditScope =
  | { readonly kind: 'element' }
  | { readonly kind: 'repeats'; readonly count: number }
  | { readonly kind: 'rule'; readonly rule: RuleId }

/**
 * The one format for undo labels, the per-file diff panel, multi-edit and the Ask-Claude payload.
 * Undo restores file snapshots and never replays a record.
 */
export interface EditRecord {
  readonly target: readonly EdId[]
  readonly kind: EditKind
  readonly prop: string | null
  readonly before: string | null
  readonly after: string | null
  readonly scope: EditScope
  readonly files: readonly ProjectPath[]
}
