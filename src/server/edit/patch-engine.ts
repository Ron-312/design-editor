import MagicString from 'magic-string'
import type { DefaultTreeAdapterTypes } from 'parse5'
import type { EdId, EditOp, EditRecord, EditScope, OpOf, ReadOnlyReason, RuleId, TemplateNode } from '../../shared/types'
import { dominantEol, lineLocator } from '../source/bytes'
import type { IndexedFile } from '../source/source-index'
import { hasHole, indexHelmetRules, type HelmetRule, type IndexedDeclaration } from '../source/style-index'
import { attrValue } from '../source/template-tree'
import { ParsedSource, shapeMismatch, type Shape } from './shape-check'
import { planInsertHtml, planStructuralOp, STRUCTURAL_KINDS, type StructuralContext, type StructuralKind, type StructuralPlan } from './structural-ops'
import {
  appendDeclarationSplice,
  attrValueOf,
  inlineStyleValue,
  lastDeclaration,
  LIVE_VALUE,
  refuse,
  Refusal,
  removeAttrSplice,
  removeDeclarationSplice,
  replaceValueSplice,
  requireCssPropertyName,
  requireSingleDeclaration,
  rewriteDeclarationsSplice,
  setAttrSplice,
  setTextSplice,
  type DeclarationListEdits,
  type NewDeclaration,
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

const RULE_VALUE_BREAKOUT = /[;{}]|<\/style/i

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

/** One inline style or rule as the flush edits it: its declaration ops fold here and are written as one splice. */
class DeclarationList implements DeclarationListEdits {
  readonly removed = new Set<IndexedDeclaration>()
  readonly replaced = new Map<IndexedDeclaration, { readonly value: string; readonly important: boolean | undefined }>()
  readonly appended: NewDeclaration[] = []

  constructor(
    private readonly text: string,
    private readonly declarations: readonly IndexedDeclaration[],
    /** Where a declaration goes while the list has none; null when it cannot take one. */
    private readonly emptyAt: number | null,
    private readonly wrap: (list: string) => string,
    private readonly escape: (value: string) => string,
  ) {}

  /** Folds the op in and returns the value the property had. */
  edit(op: DeclarationOp): string | null {
    const { prop } = op.payload
    const existing = lastDeclaration(this.declarations.filter((declaration) => !this.removed.has(declaration)), prop)
    if (existing?.hasHole) refuse(LIVE_VALUE)
    if (op.kind === 'removeDecl') {
      if (!existing) refuse(`there is no ${prop} declaration to remove`)
      this.removed.add(existing)
      this.replaced.delete(existing)
      return existing.value
    }
    const { value, important } = op.payload
    if (existing) this.replaced.set(existing, { value: this.escape(value), important })
    else this.appended.push({ prop, value: this.escape(value), ...(important ? { important } : {}) })
    return existing?.value ?? null
  }

  splice(): Splice {
    const changes = this.removed.size + this.replaced.size + this.appended.length
    const splice = changes === 1 ? this.singleSplice() : rewriteDeclarationsSplice(this.text, this.declarations, this.emptyAt, this)
    return { ...splice, content: this.wrap(splice.content) }
  }

  private singleSplice(): Splice {
    const [removed] = this.removed
    if (removed) return removeDeclarationSplice(this.text, this.declarations, removed)
    const [replaced] = this.replaced
    if (replaced) return replaceValueSplice(this.text, replaced[0], replaced[1].value, replaced[1].important)
    return appendDeclarationSplice(this.text, this.declarations, this.emptyAt, this.appended[0]!)
  }
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
  private readonly lists = new Map<string, DeclarationList>()

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
      case 'removeAttr':
        return this.planAttr(op)
      case 'setText':
        return this.planText(op)
      case 'insertHtml':
        return this.planInsertHtml(op)
    }
  }

  finish(): PatchOutcome {
    for (const list of this.lists.values()) this.splices.push(list.splice())
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
      const before = this.ruleList(rule).edit(op)
      return this.record(op, prop, before, after, { kind: 'rule', rule })
    }
    const before = op.target.map((id) => this.inlineList(id).edit(op))
    this.record(op, prop, sharedValue(before), after, this.elementScope(op.target))
  }

  private declarationList(key: string, create: () => DeclarationList): DeclarationList {
    const list = this.lists.get(key) ?? create()
    this.lists.set(key, list)
    return list
  }

  private ruleList(rule: RuleId): DeclarationList {
    return this.declarationList(`rule ${rule}`, () => new DeclarationList(this.text, this.ruleById(rule).declarations, null, (list) => list, (value) => value))
  }

  private inlineList(id: EdId): DeclarationList {
    return this.declarationList(`inline ${id}`, () => {
      const location = this.indexed.locate(id)!
      const style = this.indexed.inlineStyle(id)
      const attr = location.attrs['style']
      if (!style || !attr) {
        const { start } = setAttrSplice(this.text, location.startTag, undefined, 'style', '')
        return new DeclarationList(this.text, [], start, (list) => ` style="${list}"`, (value) => inlineStyleValue(value, '"'))
      }
      const styleValue = attrValueOf(this.text, attr)!
      const emptyAt = this.text.slice(styleValue.range.start, styleValue.range.end).trim() === '' ? styleValue.range.start : null
      return new DeclarationList(this.text, style.declarations, emptyAt, (list) => list, (value) => inlineStyleValue(value, styleValue.quote))
    })
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

  private planAttr(op: OpOf<'setAttr'> | OpOf<'removeAttr'>): void {
    const name = op.payload.name.toLowerCase()
    const after = op.kind === 'setAttr' ? op.payload.value : null
    const before = op.target.map((id) => {
      if (!this.indexed.isAttrEditable(id, name)) refuse(LIVE_VALUE)
      const location = this.indexed.locate(id)!
      const attr = location.attrs[name]
      if (after !== null) this.splices.push(setAttrSplice(this.text, location.startTag, attr, name, after))
      else if (attr) this.splices.push(removeAttrSplice(this.text, attr))
      return attrValue(this.source.element(id), name) ?? null
    })
    this.record(op, name, sharedValue(before), after, this.elementScope(op.target))
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
    this.restructure(planStructuralOp(this.structuralContext(), op))
    this.record(op, null, null, op.kind === 'wrapNode' ? op.payload.tag : null, this.elementScope(op.target))
  }

  /** The artboard root is the default paste parent, so unlike the other structural ops this one takes it. */
  private planInsertHtml(op: OpOf<'insertHtml'>): void {
    const parent = op.target[0]!
    this.requireRow(parent)
    this.restructure(planInsertHtml(this.structuralContext(), parent, op.payload))
    this.record(op, null, null, null, this.elementScope(op.target))
  }

  private restructure(plan: StructuralPlan): void {
    this.splices.push(...plan.splices)
    this.minted.push(...plan.minted)
    this.warnings.push(...plan.warnings)
    this.restructured = true
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
      return flush.finish()
    } catch (error) {
      if (error instanceof Refusal) return { ok: false, reason: error.message }
      throw error
    }
  }
}
