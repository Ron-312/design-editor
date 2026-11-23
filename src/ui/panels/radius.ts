import { splitTopLevel } from './shadows'

export const CORNERS = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] as const
export const SIDE_WIDTHS = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'] as const

export type BoxValues<P extends string> = Record<P, string | null>

/** A one-to-four value shorthand spread over its longhands as CSS does, each value as authored; null past four values. */
export function splitBox<P extends string>(shorthand: string, longhands: readonly [P, P, P, P]): Record<P, string> | null {
  const values = splitTopLevel(shorthand, ' ')
  if (values.length === 0 || values.length > 4) return null
  const [first, second = first, third = first, fourth = second] = values
  const spread = [first!, second!, third!, fourth!]
  return Object.fromEntries(longhands.map((longhand, at) => [longhand, spread[at]])) as Record<P, string>
}

/** The one value all four longhands share, compared as authored text; null when any differs or is missing. */
export function joinBox<P extends string>(values: BoxValues<P>): string | null {
  const [first, ...rest] = Object.values<string | null>(values)
  return first != null && rest.every((value) => value === first) ? first : null
}

/** Null for an elliptical radius (`a / b`), which the corner fields cannot show. */
export function splitRadius(shorthand: string): BoxValues<(typeof CORNERS)[number]> | null {
  return shorthand.includes('/') ? null : splitBox(shorthand, CORNERS)
}

export function joinRadius(corners: BoxValues<(typeof CORNERS)[number]>): string | null {
  return joinBox(corners)
}
