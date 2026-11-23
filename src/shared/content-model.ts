const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
])

/** Template control elements render away, so they never parent anything in the live DOM. */
const RENDERED_AWAY = new Set(['sc-for', 'sc-if'])

/** Start tags that close an open `<p>` (HTML spec, "in body" insertion mode). */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup',
  'hr', 'li', 'listing', 'main', 'menu', 'nav', 'ol', 'p', 'plaintext', 'pre', 'search', 'section', 'summary',
  'table', 'ul', 'xmp',
])

/** Elements that end "button scope", so a `<p>` above them is not closed. */
const BUTTON_SCOPE_BOUNDARIES = new Set(['applet', 'button', 'caption', 'html', 'marquee', 'object', 'table', 'td', 'th', 'template'])

const PHRASING_ONLY = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button'])
const NEVER_NESTED = new Set(['a', 'button', 'form'])
const LIST_PARENTS = ['ul', 'ol', 'menu']

const TABLE_PART_PARENTS: Readonly<Record<string, readonly string[]>> = {
  td: ['tr'],
  th: ['tr'],
  tr: ['tbody', 'thead', 'tfoot', 'table'],
  tbody: ['table'],
  thead: ['table'],
  tfoot: ['table'],
  caption: ['table'],
  colgroup: ['table'],
  col: ['colgroup'],
}

const TABLE_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr'],
  thead: ['tr'],
  tbody: ['tr'],
  tfoot: ['tr'],
  tr: ['td', 'th'],
  colgroup: ['col'],
}

const ALLOWED_IN_TABLE_PARTS = new Set(['script', 'style', 'template'])

export function isVoidElement(tag: string): boolean {
  return VOID_ELEMENTS.has(tag)
}

function named(tag: string): string {
  return `${/^[aeiou]/.test(tag) ? 'an' : 'a'} <${tag}>`
}

function listOf(tags: readonly string[]): string {
  const spelled = tags.map((tag) => `<${tag}>`)
  return spelled.length === 1 ? spelled[0]! : `${spelled.slice(0, -1).join(', ')} or ${spelled.at(-1)}`
}

function inside(parent: string | undefined): string {
  return parent === undefined ? 'the top level' : named(parent)
}

function nestedViolation(chain: readonly string[], tag: string): string | null {
  if (!NEVER_NESTED.has(tag) || !chain.includes(tag)) return null
  return `${named(tag)} can't go inside another <${tag}>`
}

function listItemViolation(parent: string | undefined, tag: string): string | null {
  if (tag !== 'li' || (parent !== undefined && LIST_PARENTS.includes(parent))) return null
  return `${named(tag)} can't go inside ${inside(parent)}; it belongs in a ${listOf(LIST_PARENTS)}`
}

function tablePartViolation(parent: string | undefined, tag: string): string | null {
  const parents = TABLE_PART_PARENTS[tag]
  if (parents && !(parent !== undefined && parents.includes(parent))) {
    return `${named(tag)} can't go inside ${inside(parent)}; it belongs in a ${listOf(parents)}`
  }
  const children = parent === undefined ? undefined : TABLE_CHILDREN[parent]
  if (children && !children.includes(tag) && !ALLOWED_IN_TABLE_PARTS.has(tag)) return `${named(tag)} can't go inside ${named(parent!)}`
  return null
}

function blockInPhrasingViolation(chain: readonly string[], tag: string): string | null {
  if (!CLOSES_P.has(tag)) return null
  for (const ancestor of [...chain].reverse()) {
    if (ancestor === 'p') return `${named(tag)} can't go inside a <p>`
    if (BUTTON_SCOPE_BOUNDARIES.has(ancestor)) break
  }
  const phrasingParent = chain.findLast((ancestor) => PHRASING_ONLY.has(ancestor))
  return phrasingParent ? `${named(tag)} can't go inside ${named(phrasingParent)}` : null
}

/**
 * Why a `<tag>` cannot sit under `ancestors` (outermost first, the parent last), as one line; null when it can.
 * Covers the HTML content-model and implied-end-tag rules a structural op can break.
 */
export function nestingViolation(ancestors: readonly string[], tag: string): string | null {
  const chain = ancestors.filter((ancestor) => !RENDERED_AWAY.has(ancestor))
  const parent = chain.at(-1)
  return (
    nestedViolation(chain, tag) ??
    listItemViolation(parent, tag) ??
    tablePartViolation(parent, tag) ??
    blockInPhrasingViolation(chain, tag)
  )
}
