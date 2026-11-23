const UNITLESS = new Set([
  'line-height',
  'opacity',
  'z-index',
  'flex',
  'flex-grow',
  'flex-shrink',
  'font-weight',
  'order',
  'orphans',
  'widows',
  'zoom',
  'aspect-ratio',
  'fill-opacity',
  'stroke-opacity',
])

/** The unit a typed bare number takes when nothing is authored yet. */
const DEFAULT_UNITS: Readonly<Record<string, string>> = { rotate: 'deg' }

const BARE_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/
const NUMBER_WITH_UNIT = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i

/** Properties whose bare numbers are valid CSS, so the panel never appends `px`. */
export function isUnitless(prop: string): boolean {
  return UNITLESS.has(prop)
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)))
}

function unitOf(authored: string | null): string | null {
  const match = authored?.trim().match(NUMBER_WITH_UNIT)
  return match?.[2] || null
}

/** A typed bare number takes the authored unit (px when nothing was authored); anything else is written as typed. */
export function withAuthoredUnit(prop: string, typed: string, authored: string | null): string {
  const value = typed.trim()
  if (!BARE_NUMBER.test(value) || isUnitless(prop)) return value
  return `${value}${unitOf(authored) ?? DEFAULT_UNITS[prop] ?? 'px'}`
}

const COMPUTED_LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(px|deg)$/
const COMPUTED_RGB = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/

const UNSET_SHOWN_AS: Readonly<Record<string, string>> = { rotate: '0°' }

/** A computed value as a field shows it: px dropped, degrees as °, numbers to a tenth. */
export function shownComputed(prop: string, value: string): string {
  if (value === 'none' && UNSET_SHOWN_AS[prop]) return UNSET_SHOWN_AS[prop]
  const match = value.trim().match(COMPUTED_LENGTH)
  if (!match) return value.trim()
  const number = String(Number(Number(match[1]).toFixed(1)))
  return match[2] === 'deg' ? `${number}°` : number
}

/** A computed `rgb()` as hex with its alpha from 0 to 1; null for anything else. */
export function computedColour(value: string): { readonly hex: string; readonly alpha: number } | null {
  const match = value.trim().match(COMPUTED_RGB)
  if (!match) return null
  const rgb = [match[1], match[2], match[3]].map(Number)
  return { hex: `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`, alpha: match[4] === undefined ? 1 : Number(match[4]) }
}

/** The value moved by `delta` in its own unit; null when it is not a single number. */
export function stepNumber(value: string, delta: number): string | null {
  const match = value.trim().match(NUMBER_WITH_UNIT)
  if (!match) return null
  return `${formatNumber(Number(match[1]) + delta)}${match[2]}`
}

interface HexColour {
  readonly format: 'hex'
  readonly rgb: readonly [number, number, number]
  readonly alpha: number
  readonly hasAlpha: boolean
}

interface FunctionColour {
  readonly format: 'function'
  readonly name: string
  /** The channels before the alpha, as authored. */
  readonly channels: readonly string[]
  readonly legacyCommas: boolean
  readonly alpha: number
}

type Colour = HexColour | FunctionColour

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const COLOUR_FUNCTION = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/i

function parseHex(value: string): HexColour | null {
  const digits = value.trim().match(HEX)?.[1]
  if (!digits) return null
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits
  const byte = (at: number) => parseInt(full.slice(at, at + 2), 16)
  const hasAlpha = full.length === 8
  return { format: 'hex', rgb: [byte(0), byte(2), byte(4)], alpha: hasAlpha ? byte(6) / 255 : 1, hasAlpha }
}

function parseAlpha(text: string): number {
  const trimmed = text.trim()
  return trimmed.endsWith('%') ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed)
}

function parseFunction(value: string): FunctionColour | null {
  const match = value.trim().match(COLOUR_FUNCTION)
  if (!match) return null
  const name = match[1]!.toLowerCase()
  const body = match[2]!.trim()
  if (body.includes(',')) {
    const args = body.split(',').map((arg) => arg.trim())
    const alpha = args.length > 3 ? parseAlpha(args[3]!) : 1
    return { format: 'function', name, channels: args.slice(0, 3), legacyCommas: true, alpha }
  }
  const [channels, alphaText] = body.split('/')
  return {
    format: 'function',
    name,
    channels: channels!.trim().split(/\s+/),
    legacyCommas: false,
    alpha: alphaText === undefined ? 1 : parseAlpha(alphaText),
  }
}

function parseColour(value: string): Colour | null {
  return parseHex(value) ?? parseFunction(value)
}

/** The authored alpha from 0 to 1; null for a value the panel cannot read as a colour, such as `var()`. */
export function colorAlpha(value: string): number | null {
  return parseColour(value)?.alpha ?? null
}

function hexByte(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0')
}

function hexWithAlpha(rgb: readonly number[], alpha: number): string {
  return `#${rgb.map(hexByte).join('')}${alpha < 1 ? hexByte(alpha * 255) : ''}`
}

function functionWithAlpha(colour: FunctionColour, alpha: number): string {
  const shownAlpha = formatNumber(alpha)
  if (colour.legacyCommas) {
    const args = alpha < 1 ? [...colour.channels, shownAlpha] : colour.channels
    return `${colour.name}(${args.join(', ')})`
  }
  const channels = colour.channels.join(' ')
  return alpha < 1 ? `${colour.name}(${channels} / ${shownAlpha})` : `${colour.name}(${channels})`
}

function withAlpha(colour: Colour, alpha: number): string {
  return colour.format === 'hex' ? hexWithAlpha(colour.rgb, alpha) : functionWithAlpha(colour, alpha)
}

/** The same colour in the same format with a new alpha; channels are never converted, so wide-gamut values survive. */
export function withColorAlpha(authored: string, alpha: number): string | null {
  const colour = parseColour(authored)
  return colour ? withAlpha(colour, alpha) : null
}

function hslOf([red, green, blue]: readonly [number, number, number]): string {
  const [r, g, b] = [red / 255, green / 255, blue / 255]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const chroma = max - min
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1))
  const hue =
    chroma === 0 ? 0 : max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
  const tenth = (value: number) => String(Number(value.toFixed(1)))
  return `${tenth(hue * 60)} ${tenth(saturation * 100)}% ${tenth(lightness * 100)}%`
}

function sRgbFunction(name: 'rgb' | 'hsl', pick: HexColour, alpha: number): string {
  const channels = name === 'rgb' ? pick.rgb.join(' ') : hslOf(pick.rgb)
  return functionWithAlpha({ format: 'function', name, channels: [channels], legacyCommas: false, alpha }, alpha)
}

/**
 * A picked sRGB hex rewritten in the authored colour's format and alpha. A pick that is not a hex
 * (a wide-gamut colour, a keyword) is written as picked, so it is never clamped to sRGB.
 */
export function inAuthoredColorFormat(authored: string, picked: string): string {
  const pick = parseHex(picked)
  const colour = parseColour(authored)
  if (!pick || !colour) return picked.trim()
  const alpha = pick.hasAlpha ? pick.alpha : colour.alpha
  if (colour.format === 'hex') return hexWithAlpha(pick.rgb, alpha)
  if (colour.name.startsWith('rgb')) return sRgbFunction('rgb', pick, alpha)
  if (colour.name.startsWith('hsl')) return sRgbFunction('hsl', pick, alpha)
  return hexWithAlpha(pick.rgb, alpha)
}
