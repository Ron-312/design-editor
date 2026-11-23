import { splitTopLevel } from './shadows'

const BLUR = /^blur\((.*)\)$/

function filterFunctions(filter: string | null): string[] {
  return filter === null || filter.trim() === 'none' ? [] : splitTopLevel(filter, ' ')
}

/** The radius inside the list's `blur()`; null when the list has none. */
export function blurRadiusOf(filter: string | null): string | null {
  for (const fn of filterFunctions(filter)) {
    const radius = fn.match(BLUR)?.[1]
    if (radius !== undefined) return radius.trim()
  }
  return null
}

/**
 * The filter list with its `blur()` set to `radius`, or taken out when `radius` is null; every other
 * function is kept as authored. Null when nothing is left to write.
 */
export function withBlurRadius(filter: string | null, radius: string | null): string | null {
  const functions = filterFunctions(filter)
  const at = functions.findIndex((fn) => BLUR.test(fn))
  const blur = radius === null ? [] : [`blur(${radius})`]
  const next = at === -1 ? [...functions, ...blur] : [...functions.slice(0, at), ...blur, ...functions.slice(at + 1)]
  return next.length === 0 ? null : next.join(' ')
}
