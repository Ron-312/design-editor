import { formatNumber, hexWithAlpha, parseColour } from './css-values'

export type Notation = 'hex' | 'rgb' | 'hsl' | 'oklch'

export const NOTATIONS: readonly Notation[] = ['hex', 'rgb', 'hsl', 'oklch']

/** A point on the picker: hue in degrees, saturation, value and alpha from 0 to 1, all in sRGB. */
export interface Hsva {
  readonly h: number
  readonly s: number
  readonly v: number
  readonly a: number
}

/** sRGB channels from 0 to 1; a wide-gamut colour falls outside that range. */
type Rgb = readonly [number, number, number]

interface Oklch {
  readonly l: number
  readonly c: number
  readonly h: number
}

function eachChannel([r, g, b]: Rgb, map: (channel: number) => number): Rgb {
  return [map(r), map(g), map(b)]
}

const FUNCTION_NOTATIONS: Readonly<Record<string, Notation>> = { rgb: 'rgb', rgba: 'rgb', hsl: 'hsl', hsla: 'hsl', oklch: 'oklch' }

/** Rounding to the four decimals oklch is written with can step this far past an sRGB edge. */
const GAMUT_TOLERANCE = 0.001

export function notationOf(value: string): Notation | null {
  const colour = parseColour(value)
  if (!colour) return null
  return colour.format === 'hex' ? 'hex' : (FUNCTION_NOTATIONS[colour.name] ?? null)
}

function component(text: string, hundredPercent: number): number {
  return text.endsWith('%') ? (Number(text.slice(0, -1)) / 100) * hundredPercent : Number(text)
}

function degrees(text: string): number {
  return Number(text.replace(/deg$/i, ''))
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [channel(0), channel(8), channel(4)]
}

function hsvToRgb({ h, s, v }: Hsva): Rgb {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [channel(5), channel(3), channel(1)]
}

function rgbToHsv([r, g, b]: Rgb, a: number): Hsva {
  const max = Math.max(r, g, b)
  const chroma = max - Math.min(r, g, b)
  const hue = chroma === 0 ? 0 : max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4
  return { h: hue * 60, s: max === 0 ? 0 : chroma / max, v: max, a }
}

function toLinear(channel: number): number {
  const magnitude = Math.abs(channel)
  const linear = magnitude <= 0.04045 ? magnitude / 12.92 : ((magnitude + 0.055) / 1.055) ** 2.4
  return Math.sign(channel) * linear
}

function fromLinear(channel: number): number {
  const magnitude = Math.abs(channel)
  const encoded = magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * magnitude ** (1 / 2.4) - 0.055
  return Math.sign(channel) * encoded
}

/** Björn Ottosson's Oklab matrices, https://bottosson.github.io/posts/oklab/ */
function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const radians = (h * Math.PI) / 180
  const a = c * Math.cos(radians)
  const b = c * Math.sin(radians)
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    fromLinear(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    fromLinear(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    fromLinear(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
  ]
}

function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = eachChannel(rgb, toLinear)
  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const medium = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const lightness = 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short
  const greenRed = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short
  const blueYellow = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short
  const hue = (Math.atan2(blueYellow, greenRed) * 180) / Math.PI
  return { l: lightness, c: Math.hypot(greenRed, blueYellow), h: (hue + 360) % 360 }
}

function inSrgb(rgb: Rgb): boolean {
  return rgb.every((channel) => channel >= -GAMUT_TOLERANCE && channel <= 1 + GAMUT_TOLERANCE)
}

/** The most chroma that keeps the lightness and hue inside sRGB, found by bisection. */
function mappedOklch(colour: Oklch): Oklch {
  if (inSrgb(oklchToRgb(colour))) return colour
  let inside = 0
  let outside = colour.c
  for (let step = 0; step < 24; step++) {
    const middle = (inside + outside) / 2
    if (inSrgb(oklchToRgb({ ...colour, c: middle }))) inside = middle
    else outside = middle
  }
  return { ...colour, c: inside }
}

interface Parsed {
  readonly notation: Notation
  readonly alpha: number
  readonly rgb: Rgb
  /** Set for an oklch value, whose rgb may lie outside sRGB. */
  readonly oklch?: Oklch
}

function parsed(value: string): Parsed | null {
  const colour = parseColour(value)
  const notation = notationOf(value)
  if (!colour || !notation) return null
  const { alpha } = colour
  if (colour.format === 'hex') return { notation, alpha, rgb: eachChannel(colour.rgb, (byte) => byte / 255) }
  const [first = '', second = '', third = ''] = colour.channels
  if (notation === 'rgb') return { notation, alpha, rgb: [component(first, 255) / 255, component(second, 255) / 255, component(third, 255) / 255] }
  if (notation === 'hsl') return { notation, alpha, rgb: hslToRgb(degrees(first), component(second, 100) / 100, component(third, 100) / 100) }
  const oklch = { l: component(first, 1), c: component(second, 0.4), h: degrees(third) }
  return { notation, alpha, rgb: oklchToRgb(oklch), oklch }
}

function readable(value: string): Parsed | null {
  const colour = parsed(value)
  return colour && colour.rgb.every(Number.isFinite) ? colour : null
}

/** The colour as a point on the picker; an oklch value outside sRGB lands on its gamut-mapped point. */
export function toHsva(value: string): Hsva | null {
  const colour = readable(value)
  if (!colour) return null
  const rgb = colour.oklch ? oklchToRgb(mappedOklch(colour.oklch)) : colour.rgb
  return rgbToHsv(eachChannel(rgb, (channel) => Math.min(Math.max(channel, 0), 1)), colour.alpha)
}

export function isOutsideSrgb(value: string): boolean {
  const colour = readable(value)
  return colour !== null && !inSrgb(colour.rgb)
}

function decimals(value: number, places: number): string {
  return String(Number(value.toFixed(places)))
}

function alphaSuffix(alpha: number): string {
  return alpha < 1 ? ` / ${formatNumber(alpha)}` : ''
}

function formatOklch({ l, c, h }: Oklch, alpha: number): string {
  return `oklch(${decimals(l, 4)} ${decimals(c, 4)} ${decimals(h, 2)}${alphaSuffix(alpha)})`
}

function formatHsl({ h, s, v, a }: Hsva): string {
  const lightness = v * (1 - s / 2)
  const saturation = lightness === 0 || lightness === 1 ? 0 : (v - lightness) / Math.min(lightness, 1 - lightness)
  return `hsl(${decimals(h % 360, 1)} ${decimals(saturation * 100, 1)}% ${decimals(lightness * 100, 1)}%${alphaSuffix(a)})`
}

export function formatColour(hsva: Hsva, notation: Notation): string {
  const rgb = hsvToRgb(hsva)
  const bytes = rgb.map((channel) => Math.round(channel * 255))
  switch (notation) {
    case 'hex':
      return hexWithAlpha(bytes, hsva.a)
    case 'rgb':
      return `rgb(${bytes.join(' ')}${alphaSuffix(hsva.a)})`
    case 'hsl':
      return formatHsl(hsva)
    case 'oklch':
      return formatOklch(rgbToOklch(rgb), hsva.a)
  }
}

/** An oklch value brought inside sRGB by reducing its chroma; anything else is returned as it is. */
export function gamutMapped(value: string): string {
  const colour = readable(value)
  return colour?.oklch ? formatOklch(mappedOklch(colour.oklch), colour.alpha) : value
}
