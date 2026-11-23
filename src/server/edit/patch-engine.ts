import MagicString from 'magic-string'
import type { DefaultTreeAdapterTypes } from 'parse5'
import type { EdId, EditOp, EditRecord, EditScope, OpOf, ReadOnlyReason, RuleId, TemplateNode } from '../../shared/types'
import { dominantEol, lineLocator } from '../source/bytes'
import type { IndexedFile } from '../source/source-index'
import { hasHole, indexHelmetRules, parsesAsOneDeclaration, type HelmetRule, type IndexedDeclaration } from '../source/style-index'
import { attrValue } from '../source/template-tree'
import { ParsedSource, shapeMismatch, type Shape } from './shape-check'
import { planStructuralOp, STRUCTURAL_KINDS, type StructuralContext, type StructuralKind } from './structural-ops'
import {
  appendDeclarationSplice,
  attrValueOf,
  lastDeclaration,
  LIVE_VALUE,
  refuse,
  Refusal,
  removeDeclarationSplice,
  replaceValueSplice,
  setAttrSplice,
  setTextSplice,
  type Splice,
} from './text-splice'

type TextNode = DefaultTreeAdapterTypes.TextNode

export interface PatchEngineOptions {
  readonly mintId: () => EdId
  /** How many times the live page repeats an `<sc-for>` child; only the probe can count it. */
  readonly repeatCount?: (id: EdId) => number
}

export type PatchOutcome =
  | {
      readonly ok: true
      readonly text: string
      readonly records: EditRecord[]
      /** `edId -> start offset` in `text`, for the re-index to bind by; retired ids are absent. */
      readonly offsets: Map<EdId, number>
      readonly minted: EdId[]
      readonly warnings: string[]
    }
  | { readonly ok: false; readonly reason: string }

const READ_ONLY: Readonly<Record<ReadOnlyReason, string>> = {
  hole: LIVE_VALUE,
  'dc-import': 'this layer comes from a <dc-import>; edit it in its own file',
  'script-made': 'a script makes this layer; edit in source',
  'artboard-root': "the artboard root can't be restructured",
}

const INLINE_CHILDREN = 'this text has inline children; edit in source'

const CSS_PROPERTY_NAME = /^(?:--[\w-]+|-?[a-z][a-z0-9-]*)$/i
const RULE_VALUE_BREAKOUT = /[;{}]|<\/style/i

function requireCssPropertyName(prop: string): void {
  if (!CSS_PROPERTY_NAME.test(prop)) refuse(`${JSON.stringify(prop)} is not a CSS property name`)
}

function requireSingleDeclaration(prop: string, value: string): void {
  if (!parsesAsOneDeclaration(prop, value)) refuse(`${JSON.stringify(value)} is not a single ${prop} value; edit in source`)
}

/** The value as it can sit inside a style attribute: CSS strings take the other quote, and no character reference may appear, since the style index reads the raw attribute. */
function inlineStyleValue(value: string, quote: '"' | "'" | ''): string {
  const attrQuote = quote || '"'
  const otherQuote = attrQuote === '"' ? "'" : '"'
  const written = value.includes(otherQuote) ? value : value.replaceAll(attrQuote, otherQuote)
  if (written.includes(attrQuote) || written.includes('&')) refuse('this value has characters a style attribute cannot hold; edit in source')
  return written
}

type DeclarationOp = OpOf<'setDecl'> | OpOf<'removeDecl'>

function isStructural(op: EditOp): op is OpOf<StructuralKind> {
  return STRUCTURAL_KINDS.has(op.kind)
}

function rowIds(tree: TemplateNode | null): Set<EdId> {
  const rows = (node: TemplateNode): EdId[] => [node.edId, ...node.children.flatMap(rows)]
  return new Set(tree ? rows(tree) : [])
}

function sharedValue(values: readonly (string | null)[]): string | null {
  return values.every((value) => value === values[0]) ? (values[0] ?? null) : null
}

/** Sorted by position, insertions before a replacement that starts at the same offset; patches may touch but never overlap. */
function orderedSplices(splices: readonly Splice[]): Splice[] {
  const ordered = [...splices].sort((a, b) => a.start - b.start || a.end - b.end)
  let reach = 0
  for (const splice of ordered) {
    if (splice.start < reach) throw new Error(`overlapping patches at offset ${splice.start} in one flush`)
    reach = Math.max(reach, splice.end)
  }
  return ordered
}

/** One magic-string pass over the original text; `update` keeps content appended at a chunk's edge. */
function applySplices(text: string, ordered: readonly Splice[]): string {
  const magic = new MagicString(text)
  for (const splice of ordered) {
    if (splice.start === splice.end) magic.appendLeft(splice.start, splice.content)
    else magic.update(splice.start, splice.end, splice.content)
  }
  return magic.toString()
}

function shiftedOffset(offset: number, ordered: readonly Splice[]): number | null {
  let delta = 0
  for (const splice of ordered) {
    if (splice.start > offset) break
    if (offset < splice.end) return null
    delta += splice.content.length - (splice.end - splice.start)
  }
  return offset + delta
}

/** Untouched ids shift by the deltas before them, ids inside a removed span retire, carried ids land inside their splice. */
function shiftedOffsets(original: ReadonlyMap<EdId, number>, ordered: readonly Splice[]): Map<EdId, number> {
  const offsets = new Map<EdId, number>()
  for (const [id, offset] of original) {
    const shifted = shiftedOffset(offset, ordered)
    if (shifted !== null) offsets.set(id, shifted)
  }
  let delta = 0
  for (const splice of ordered) {
    for (const { id, at } of splice.carried ?? []) offsets.set(id, splice.start + delta + at)
    delta += splice.content.length - (splice.end - splice.start)
  }
  return offsets
}

/** One flush: every op is planned against the original text, then spliced in a single pass. */
class Flush {
  private readonly text: string
  private readonly source: ParsedSource
  private readonly shape: Shape
  private readonly rows: Set<EdId>
  private readonly splices: Splice[] = []
  private readonly records: EditRecord[] = []
  private readonly minted: EdId[] = []
  private readonly warnings: string[] = []
  private restructured = false
  private rules: HelmetRule[] | undefined

  constructor(
    private readonly indexed: IndexedFile,
    private readonly options: PatchEngineOptions,
  ) {
    this.text = indexed.text
    this.source = ParsedSource.parse(indexed.text, indexed.startOffsets())
    this.shape = this.source.shape()
    this.rows = rowIds(indexed.tree)
  }

  plan(op: EditOp): void {
    if (isStructural(op)) return this.planStructural(op)
    for (const id of op.target) this.requireEditable(id)
    switch (op.kind) {
      case 'setDecl':
      case 'removeDecl':
        return this.planDeclaration(op)
      case 'setAttr':
        return this.planAttr(op)
      case 'setText':
        return this.planText(op)
    }
  }

  finish(): PatchOutcome {
    const ordered = orderedSplices(this.splices)
    const text = applySplices(this.text, ordered)
    const offsets = shiftedOffsets(this.indexed.startOffsets(), ordered)
    const mismatch = this.restructured ? shapeMismatch(this.shape, ParsedSource.parse(text, offsets)) : null
    if (mismatch) return { ok: false, reason: mismatch }
    return { ok: true, text, records: this.records, offsets, minted: this.minted, warnings: this.warnings }
  }

  private requireEditable(id: EdId): void {
    if (!this.indexed.locate(id)) refuse('that layer is gone; reload the canvas')
    const reason = this.indexed.flagsOf(id).readOnly
    if (reason) refuse(READ_ONLY[reason])
  }

  private requireRow(id: EdId): void {
    this.requireEditable(id)
    if (!this.rows.has(id)) refuse('only layers in the Layers panel can be restructured')
  }

  private record(op: EditOp, prop: string | null, before: string | null, after: string | null, scope: EditScope): void {
    this.records.push({ target: op.target, kind: op.kind, prop, before, after, scope, files: [this.indexed.file] })
  }

  private elementScope(targets: readonly EdId[]): EditScope {
    const repeated = targets.find((id) => this.indexed.flagsOf(id).inRepeat)
    if (!repeated) return { kind: 'element' }
    return { kind: 'repeats', count: this.options.repeatCount?.(repeated) ?? 0 }
  }

  private planDeclaration(op: DeclarationOp): void {
    const { prop, rule } = op.payload
    const after = op.kind === 'setDecl' ? op.payload.value : null
    requireCssPropertyName(prop)
    if (after !== null) requireSingleDeclaration(prop, after)
    if (rule) {
      if (after !== null && RULE_VALUE_BREAKOUT.test(after)) refuse(`${JSON.stringify(after)} cannot be written into a rule; edit in source`)
      const before = this.patchDeclarations(op, this.ruleById(rule).declarations, null, (value) => value)
      return this.record(op, prop, before, after, { kind: 'rule', rule })
    }
    const before = op.target.map((id) => this.patchInlineStyle(op, id))
    this.record(op, prop, sharedValue(before), after, this.elementScope(op.target))
  }

  private patchInlineStyle(op: DeclarationOp, id: EdId): string | null {
    const location = this.indexed.locate(id)!
    const style = this.indexed.inlineStyle(id)
    const attr = location.attrs['style']
    if (!style || !attr) {
      if (op.kind === 'removeDecl') refuse(`there is no ${op.payload.prop} declaration to remove`)
      const { prop, value, important } = op.payload
      const declaration = `${prop}: ${inlineStyleValue(value, '"')}${important ? ' !important' : ''}`
      this.splices.push(setAttrSplice(this.text, location.startTag, undefined, 'style', declaration))
      return null
    }
    const styleValue = attrValueOf(this.text, attr)!
    const emptyAt = this.text.slice(styleValue.range.start, styleValue.range.end).trim() === '' ? styleValue.range.start : null
    return this.patchDeclarations(op, style.declarations, emptyAt, (value) => inlineStyleValue(value, styleValue.quote))
  }

  /** Splices one declaration list and returns the value it had. */
  private patchDeclarations(
    op: DeclarationOp,
    declarations: readonly IndexedDeclaration[],
    emptyAt: number | null,
    escape: (value: string) => string,
  ): string | null {
    const existing = lastDeclaration(declarations, op.payload.prop)
    if (existing?.hasHole) refuse(LIVE_VALUE)
    if (op.kind === 'removeDecl') {
      if (!existing) refuse(`there is no ${op.payload.prop} declaration to remove`)
      this.splices.push(removeDeclarationSplice(this.text, declarations, existing))
      return existing.value
    }
    const { prop, value, important } = op.payload
    if (existing) {
      this.splices.push(replaceValueSplice(this.text, existing, escape(value), important))
      return existing.value
    }
    this.splices.push(appendDeclarationSplice(this.text, declarations, emptyAt, { prop, value: escape(value), ...(important ? { important } : {}) }))
    return null
  }

  private helmetRules(): HelmetRule[] {
    this.rules ??= indexHelmetRules(
      { file: this.indexed.file, text: this.text, lineOf: lineLocator(this.text) },
      [...this.source.elements()]
        .filter((element) => element.tagName === 'style' && this.source.ancestorTags(element).includes('helmet'))
        .map((element) => {
          const location = element.sourceCodeLocation!
          return { start: location.startTag!.endOffset, end: location.endTag?.startOffset ?? location.endOffset }
        }),
      () => '' as RuleId,
    )
    return this.rules
  }

  /** IndexedFile looks rules up by selectorText and order, so each rule is asked for by its own pair. */
  private ruleById(id: RuleId): HelmetRule {
    const seen = new Map<string, number>()
    for (const { selector } of this.helmetRules()) {
      const order = seen.get(selector) ?? 0
      seen.set(selector, order + 1)
      const rule = this.indexed.findRule(selector, order)
      if (rule?.id === id) return rule
    }
    return refuse("only rules in this file's <helmet><style> can be edited")
  }

  private planAttr(op: OpOf<'setAttr'>): void {
    const name = op.payload.name.toLowerCase()
    const before = op.target.map((id) => {
      if (!this.indexed.isAttrEditable(id, name)) refuse(LIVE_VALUE)
      const location = this.indexed.locate(id)!
      this.splices.push(setAttrSplice(this.text, location.startTag, location.attrs[name], name, op.payload.value))
      return attrValue(this.source.element(id), name) ?? null
    })
    this.record(op, name, sharedValue(before), op.payload.value, this.elementScope(op.target))
  }

  private planText(op: OpOf<'setText'>): void {
    const before = op.target.map((id) => {
      const element = this.source.element(id)
      if (!this.indexed.flagsOf(id).textEditable) {
        refuse(element.childNodes.some((node) => 'value' in node && hasHole(node.value)) ? LIVE_VALUE : INLINE_CHILDREN)
      }
      const node = element.childNodes[0] as TextNode
      const splice = setTextSplice(this.text, node, op.payload.text.replace(/\r\n?/g, '\n'), dominantEol(this.text))
      if (splice) this.splices.push(splice)
      return node.value
    })
    this.record(op, null, sharedValue(before), op.payload.text, this.elementScope(op.target))
  }

  private planStructural(op: OpOf<StructuralKind>): void {
    for (const id of op.target) {
      this.requireRow(id)
      if (id === this.indexed.tree?.edId) refuse(READ_ONLY['artboard-root'])
    }
    if (op.kind === 'moveNode') this.requireRow(op.payload.parent)
    const plan = planStructuralOp(this.structuralContext(), op)
    this.splices.push(...plan.splices)
    this.minted.push(...plan.minted)
    this.warnings.push(...plan.warnings)
    this.restructured = true
    this.record(op, null, null, op.kind === 'wrapNode' ? op.payload.tag : null, this.elementScope(op.target))
  }

  private structuralContext(): StructuralContext {
    return {
      text: this.text,
      source: this.source,
      shape: this.shape,
      eol: dominantEol(this.text),
      mintId: this.options.mintId,
      selectors: () => this.helmetRules().map((rule) => rule.selector),
    }
  }
}

/** Turns edit ops into non-overlapping splices of the original text, with edit records and shifted id offsets. */
export class PatchEngine {
  constructor(private readonly options: PatchEngineOptions) {}

  apply(indexed: IndexedFile, ops: readonly EditOp[]): PatchOutcome {
    const flush = new Flush(indexed, this.options)
    try {
      for (const op of ops) flush.plan(op)
    } catch (error) {
      if (error instanceof Refusal) return { ok: false, reason: error.message }
      throw error
    }
    return flush.finish()
  }
}
