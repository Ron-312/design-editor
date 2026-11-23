import type { ProbeReadResult, ProbeToEditor, Rect, TextCancelReason } from './protocol'

type Fields = Record<string, unknown>

const TEXT_CANCEL_REASONS: readonly string[] = ['redrawn', 'detached', 'escape'] satisfies readonly TextCancelReason[]

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isArrayOf<T>(value: unknown, isItem: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(isItem)
}

function isRect(value: unknown): value is Rect {
  return isFields(value) && isNumber(value.x) && isNumber(value.y) && isNumber(value.width) && isNumber(value.height)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isFields(value) && Object.values(value).every(isString)
}

function isReadResult(value: unknown): value is ProbeReadResult {
  if (!isFields(value)) return false
  switch (value.kind) {
    case 'rects':
      return isArrayOf(value.rects, isRect)
    case 'computed':
      return isStringRecord(value.values)
    case 'hitTest':
      return value.edId === null || isString(value.edId)
    case 'snapRects':
      return isRect(value.self) && (value.parent === null || isRect(value.parent)) && isArrayOf(value.siblings, isRect)
    case 'supports':
      return isBoolean(value.supported)
    case 'matches':
      return isArrayOf(value.matched, isBoolean)
    case 'documentHeight':
      return isNumber(value.scrollHeight)
    default:
      return false
  }
}

function isProbeToEditor(value: unknown): value is ProbeToEditor {
  if (!isFields(value)) return false
  switch (value.type) {
    case 'ready':
    case 'scrolled':
      return isNumber(value.scrollX) && isNumber(value.scrollY)
    case 'readResult':
      return Number.isInteger(value.id) && isArrayOf(value.results, isReadResult)
    case 'textCommit':
      return isString(value.session) && isString(value.edId) && isString(value.text)
    case 'textCancelled':
      return isString(value.session) && isString(value.reason) && TEXT_CANCEL_REASONS.includes(value.reason)
    case 'fontsFailed':
      return isArrayOf(value.families, isString)
    default:
      return false
  }
}

/** Project scripts share the probe's window, so every port payload is untrusted until it matches the schema. */
export function parseProbeToEditor(data: unknown): ProbeToEditor | null {
  return isProbeToEditor(data) ? data : null
}
