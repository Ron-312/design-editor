import postcss, { CssSyntaxError, type AtRule, type Container, type Node, type Declaration, type Root, type Rule } from 'postcss'
import type { AuthoredDeclaration, ProjectPath, RuleId, SourceRange, StyleSource } from '../../shared/types'

export interface IndexedDeclaration extends AuthoredDeclaration {
  /** `prop: value !important`, without the closing `;`. */
  readonly range: SourceRange
}

export interface InlineStyle extends StyleSource {
  readonly target: 'inline'
  readonly declarations: readonly IndexedDeclaration[]
}

export interface HelmetRule extends StyleSource {
  readonly target: RuleId
  readonly id: RuleId
  readonly selector: string
  readonly media: string | null
  readonly declarations: readonly IndexedDeclaration[]
}

interface CssSource {
  readonly file: ProjectPath
  readonly text: string
  readonly lineOf: (offset: number) => number
}

const HOLE = /\{\{[\s\S]*?\}\}/g

export function hasHole(value: string): boolean {
  return value.includes('{{')
}

/** PostCSS reads `{{ x }}` as a block, so holes are blanked to same-length filler to keep offsets. */
function maskHoles(css: string): string {
  return css.replace(HOLE, (hole) => '_'.repeat(hole.length))
}

function parseCss(css: string): Root | null {
  try {
    return postcss.parse(maskHoles(css))
  } catch (error) {
    if (error instanceof CssSyntaxError) return null
    throw error
  }
}

/** True when `prop: value` reads back as exactly that one declaration. */
export function parsesAsOneDeclaration(prop: string, value: string): boolean {
  const root = parseCss(`${prop}: ${value}`)
  const [only, ...rest] = root?.nodes ?? []
  if (!only || rest.length > 0 || only.type !== 'decl') return false
  return only.prop === prop && (only.raws.value?.raw ?? only.value) === maskHoles(value).trim() && !only.important
}

function indexDeclaration(text: string, base: number, declaration: Declaration): IndexedDeclaration {
  const start = base + declaration.source!.start!.offset
  const valueStart = start + declaration.prop.length + declaration.raws.between!.length
  const valueEnd = valueStart + (declaration.raws.value?.raw ?? declaration.value).trimEnd().length
  const end = start + text.slice(start, base + declaration.source!.end!.offset).replace(/;$/, '').trimEnd().length
  const value = text.slice(valueStart, valueEnd)
  return { prop: declaration.prop, value, important: declaration.important === true, hasHole: hasHole(value), range: { start, end } }
}

function declarationsOf(text: string, base: number, container: Container): IndexedDeclaration[] {
  const declarations: IndexedDeclaration[] = []
  container.each((node) => {
    if (node.type === 'decl') declarations.push(indexDeclaration(text, base, node))
  })
  return declarations
}

function styleValueRange(text: string, attr: SourceRange): SourceRange {
  const prefix = /^[^=]*=\s*(["']?)/.exec(text.slice(attr.start, attr.end))
  if (!prefix) return { start: attr.end, end: attr.end }
  const quote = prefix[1]!
  return { start: attr.start + prefix[0].length, end: attr.end - quote.length }
}

export function indexInlineStyle(source: CssSource, attr: SourceRange): InlineStyle {
  const value = styleValueRange(source.text, attr)
  const root = parseCss(source.text.slice(value.start, value.end))
  return {
    target: 'inline',
    file: source.file,
    line: source.lineOf(attr.start),
    declarations: root ? declarationsOf(source.text, value.start, root) : [],
  }
}

function mediaOf(rule: Rule): string | null {
  let parent: Node | undefined = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && (parent as AtRule).name === 'media') return (parent as AtRule).params
    parent = parent.parent
  }
  return null
}

/** Rules of `<helmet><style>` blocks in source order; `/_blob` stylesheets are never indexed. */
export function indexHelmetRules(source: CssSource, blocks: readonly SourceRange[], mintRuleId: () => RuleId): HelmetRule[] {
  const rules: HelmetRule[] = []
  for (const block of blocks) {
    const root = parseCss(source.text.slice(block.start, block.end))
    root?.walkRules((rule) => {
      const id = mintRuleId()
      rules.push({
        target: id,
        id,
        file: source.file,
        selector: rule.selector,
        media: mediaOf(rule),
        line: source.lineOf(block.start + rule.source!.start!.offset),
        declarations: declarationsOf(source.text, block.start, rule),
      })
    })
  }
  return rules
}

export function findHelmetRule(rules: readonly HelmetRule[], selector: string, order: number): HelmetRule | null {
  return rules.filter((rule) => rule.selector === selector)[order] ?? null
}
