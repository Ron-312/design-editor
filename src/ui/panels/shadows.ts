export interface ShadowLayer {
  readonly inset: boolean
  readonly x: string
  readonly y: string
  readonly blur: string | null
  readonly spread: string | null
  /** Null where none is authored, so the shadow takes `currentColor`. */
  readonly colour: string | null
}

const LENGTH = /^-?(?:\d+\.?\d*|\.\d+)[a-z%]*$/i

/** Splits at `separator` outside parentheses only, so `rgba(0, 0, 0, .1)` stays one entry. */
export function splitTopLevel(list: string, separator: ',' | ' '): string[] {
  const entries: string[] = []
  let depth = 0
  let start = 0
  for (let at = 0; at < list.length; at++) {
    const char = list[at]!
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (depth === 0 && (separator === ',' ? char === ',' : /\s/.test(char))) {
      entries.push(list.slice(start, at))
      start = at + 1
    }
  }
  entries.push(list.slice(start))
  return entries.map((entry) => entry.trim()).filter(Boolean)
}

function parseLayer(text: string): ShadowLayer | null {
  const lengths: string[] = []
  let inset = false
  let colour: string | null = null
  for (const token of splitTopLevel(text, ' ')) {
    if (token === 'inset' && !inset) inset = true
    else if (LENGTH.test(token)) lengths.push(token)
    else if (colour === null) colour = token
    else return null
  }
  if (lengths.length < 2 || lengths.length > 4) return null
  const [x, y, blur, spread] = lengths
  return { inset, x: x!, y: y!, blur: blur ?? null, spread: spread ?? null, colour }
}

/** Every layer of a `box-shadow` list; null when any layer cannot be read, such as a lone `var()`. */
export function parseShadows(value: string): ShadowLayer[] | null {
  if (value.trim() === 'none') return []
  const layers = splitTopLevel(value, ',').map(parseLayer)
  return layers.every((layer) => layer !== null) ? (layers as ShadowLayer[]) : null
}

function formatLayer({ inset, x, y, blur, spread, colour }: ShadowLayer): string {
  const shownBlur = blur ?? (spread === null ? null : '0')
  return [inset ? 'inset' : null, x, y, shownBlur, spread, colour].filter((part) => part !== null).join(' ')
}

export function formatShadows(layers: readonly ShadowLayer[]): string {
  return layers.length === 0 ? 'none' : layers.map(formatLayer).join(', ')
}
