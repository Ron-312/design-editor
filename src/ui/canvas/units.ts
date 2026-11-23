/** What a px length is measured against in each unit resize can keep. */
export interface UnitBasis {
  readonly rootFontSize: number
  readonly fontSize: number
  readonly containingSize: number
}

const LENGTH = /^-?\d*\.?\d+(px|rem|em|%)?$/
const KEYWORD = /^[a-z-]+$/i

/** Two decimals, as the plan's unit-drift rule asks. */
function formatted(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** `px` written in the unit `authored` uses, or null when that unit cannot be converted (calc(), viewport units). */
export function toAuthoredUnit(px: number, authored: string | null, basis: UnitBasis): string | null {
  const value = authored?.trim() ?? null
  if (value === null || KEYWORD.test(value)) return `${Math.round(px)}px`
  const match = LENGTH.exec(value)
  if (!match) return null
  switch (match[1]) {
    case 'rem':
      return `${formatted(px / basis.rootFontSize)}rem`
    case 'em':
      return `${formatted(px / basis.fontSize)}em`
    case '%':
      return `${formatted((px / basis.containingSize) * 100)}%`
    default:
      return `${Math.round(px)}px`
  }
}
