import { parse, type DefaultTreeAdapterTypes, type Token } from 'parse5'
import type { EdId, ElementLocation, ProjectPath, RuleId, SourceRange, TemplateNode } from '../../shared/types'
import { lineLocator } from './bytes'
import { findHelmetRule, hasHole, indexHelmetRules, indexInlineStyle, type HelmetRule, type InlineStyle } from './style-index'
import {
  attrValue,
  buildTemplateTree,
  elementChildren,
  flagsFor,
  TEMPLATE_ROOT,
  type ElementFlags,
  type ParentContext,
} from './template-tree'

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode

interface IndexedElement {
  readonly element: Element
  readonly location: ElementLocation
  readonly flags: ElementFlags
}

function rangeOf(location: Token.Location): SourceRange {
  return { start: location.startOffset, end: location.endOffset }
}

function locationOf(file: ProjectPath, location: Token.ElementLocation): ElementLocation {
  const attrs = Object.fromEntries(Object.entries(location.attrs ?? {}).map(([name, attr]) => [name, rangeOf(attr)]))
  return { file, element: rangeOf(location), startTag: rangeOf(location.startTag ?? location), attrs }
}

function styleTextRange(location: Token.ElementLocation): SourceRange {
  return { start: location.startTag?.endOffset ?? location.endOffset, end: location.endTag?.startOffset ?? location.endOffset }
}

export class IndexedFile {
  readonly ids: readonly EdId[]
  private readonly lineOf: (offset: number) => number

  constructor(
    readonly file: ProjectPath,
    readonly text: string,
    private readonly elements: ReadonlyMap<EdId, IndexedElement>,
    readonly tree: TemplateNode | null,
    private readonly rules: readonly HelmetRule[],
  ) {
    this.ids = [...elements.keys()]
    this.lineOf = lineLocator(text)
  }

  locate(id: EdId): ElementLocation | undefined {
    return this.elements.get(id)?.location
  }

  /** The `edId -> start offset` map that UndoLog stores and a later re-index binds by. */
  startOffsets(): Map<EdId, number> {
    return new Map([...this.elements].map(([id, { location }]) => [id, location.element.start]))
  }

  flagsOf(id: EdId): ElementFlags {
    return this.indexed(id).flags
  }

  isAttrEditable(id: EdId, name: string): boolean {
    const indexed = this.elements.get(id)
    if (!indexed || indexed.flags.readOnly) return false
    return !hasHole(attrValue(indexed.element, name) ?? '')
  }

  inlineStyle(id: EdId): InlineStyle | null {
    const attr = this.elements.get(id)?.location.attrs['style']
    if (!attr) return null
    return indexInlineStyle({ file: this.file, text: this.text, lineOf: this.lineOf }, attr)
  }

  /** A `<helmet><style>` rule by selectorText and its order among same-selector rules, with no cascade sorting. */
  findRule(selector: string, order: number): HelmetRule | null {
    return findHelmetRule(this.rules, selector, order)
  }

  private indexed(id: EdId): IndexedElement {
    const indexed = this.elements.get(id)
    if (!indexed) throw new Error(`unknown edId ${id} in ${this.file}`)
    return indexed
  }
}

/** Allocates ids from one per-session counter that never rewinds, so no id is handed out twice. */
export class SourceIndex {
  private elementCounter = 0
  private ruleCounter = 0

  /** With `storedOffsets`, each stored id binds to the element starting at that offset; the rest get fresh ids. */
  indexFile(file: ProjectPath, text: string, storedOffsets?: ReadonlyMap<EdId, number>): IndexedFile {
    const storedIdAt = new Map([...(storedOffsets ?? [])].map(([id, offset]) => [offset, id]))
    const elements = new Map<EdId, IndexedElement>()
    const idByElement = new Map<Element, EdId>()
    const styleBlocks: SourceRange[] = []
    let templateRoot: Element | undefined

    const visit = (node: ParentNode, parent: ParentContext | undefined, inHelmet: boolean) => {
      for (const element of elementChildren(node)) {
        const flags = flagsFor(element, parent)
        const source = element.sourceCodeLocation
        if (source) {
          const id = storedIdAt.get(source.startOffset) ?? this.mintElementId()
          elements.set(id, { element, location: locationOf(file, source), flags })
          idByElement.set(element, id)
          if (inHelmet && element.tagName === 'style') styleBlocks.push(styleTextRange(source))
        }
        if (element.tagName === TEMPLATE_ROOT) templateRoot ??= element
        visit(element, { element, flags }, inHelmet || element.tagName === 'helmet')
      }
    }
    visit(parse(text, { sourceCodeLocationInfo: true }), undefined, false)

    const tree = templateRoot ? buildTemplateTree(templateRoot, (element) => idByElement.get(element)) : null
    const rules = indexHelmetRules({ file, text, lineOf: lineLocator(text) }, styleBlocks, () => this.mintRuleId())
    return new IndexedFile(file, text, elements, tree, rules)
  }

  private mintElementId(): EdId {
    return `e${++this.elementCounter}` as EdId
  }

  private mintRuleId(): RuleId {
    return `r${++this.ruleCounter}` as RuleId
  }
}
