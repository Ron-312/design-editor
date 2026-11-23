import type { HelmetRuleSource } from '../../shared/protocol'
import type { EdId, RuleId } from '../../shared/types'
import type { EditorContext } from '../plugin-api'

/** The `<helmet><style>` rules that match an element, in source order. */
export type MatchedRules = readonly HelmetRuleSource[]

export interface AuthoredDecl {
  readonly value: string
  /** The declaration list it was read from, so a writer can target that list. */
  readonly source: 'inline' | RuleId
}

const NO_RULES: MatchedRules = []

/**
 * The probe decides which rules match. A rule under `@media` is left out, since whether its condition
 * holds is not known here; the element then reads as having no rule value.
 */
export async function readMatchedRules(ctx: EditorContext, edId: EdId): Promise<MatchedRules> {
  const rules = ctx.index()?.rules.filter((rule) => rule.media === null) ?? []
  if (rules.length === 0) return NO_RULES
  const result = await ctx.read({ kind: 'matches', edId, selectors: rules.map((rule) => rule.selector) })
  return result.kind === 'matches' ? rules.filter((_, i) => result.matched[i]) : NO_RULES
}

// ── Writes ahead of the index ─────────────────────────────────────────────────
// The index only follows the Writer's debounced flush, so a command run before then would build on the
// value its predecessor just replaced. Every inline write is kept here until the next index arrives;
// null records a removal.

const unflushed = new Map<string, string | null>()
let unflushedIndex: unknown = null

function pendingOf(ctx: EditorContext): Map<string, string | null> {
  const index = ctx.index()
  if (index !== unflushedIndex) {
    unflushed.clear()
    unflushedIndex = index
  }
  return unflushed
}

const keyOf = (edId: EdId, prop: string) => `${edId} ${prop}`

/** The last declaration of `prop` in the rules, which is the one a later rule of equal weight lets render. */
export function ruleDecl(rules: MatchedRules, prop: string): AuthoredDecl | null {
  for (const rule of [...rules].reverse()) {
    const declaration = rule.declarations.findLast((entry) => entry.prop === prop)
    if (declaration) return { value: declaration.value, source: rule.target }
  }
  return null
}

function inlineDecl(ctx: EditorContext, edId: EdId, prop: string): AuthoredDecl | null {
  const pending = pendingOf(ctx)
  const key = keyOf(edId, prop)
  if (pending.has(key)) {
    const value = pending.get(key)!
    return value === null ? null : { value, source: 'inline' }
  }
  const inline = ctx.index()?.styles[edId]?.find((source) => source.target === 'inline')
  // The last declaration renders, and it is the one PatchEngine's setDecl replaces.
  const declaration = inline?.declarations.findLast((entry) => entry.prop === prop)
  return declaration ? { value: declaration.value, source: 'inline' } : null
}

/** The declared value the element renders with: its own writes still in flight, then its inline style, then the last matched rule. */
export function authoredDecl(ctx: EditorContext, edId: EdId, prop: string, rules: MatchedRules = NO_RULES): AuthoredDecl | null {
  return inlineDecl(ctx, edId, prop) ?? ruleDecl(rules, prop)
}

export function authoredValue(ctx: EditorContext, edId: EdId, prop: string, rules: MatchedRules = NO_RULES): string | null {
  return authoredDecl(ctx, edId, prop, rules)?.value ?? null
}

export function writeDecl(ctx: EditorContext, edId: EdId, prop: string, value: string, actionId: string): void {
  pendingOf(ctx).set(keyOf(edId, prop), value)
  // The ws client reports a refused op with its own toast.
  ctx.apply({ target: [edId], kind: 'setDecl', payload: { prop, value } }, actionId).catch(() => {})
}

export function removeDecl(ctx: EditorContext, edId: EdId, prop: string, actionId: string): void {
  pendingOf(ctx).set(keyOf(edId, prop), null)
  ctx.apply({ target: [edId], kind: 'removeDecl', payload: { prop } }, actionId).catch(() => {})
}
