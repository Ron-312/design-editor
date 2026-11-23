import type WebSocket from 'ws'
import type { ClientMessage, EditorState } from '../shared/protocol'
import { isEdId, type EditKind, type EditOp } from '../shared/types'

type Fields = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isOptional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value)
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isEdIdList = (value: unknown) => Array.isArray(value) && value.every(isEdId)

const PAYLOAD_CHECKS: Readonly<Record<EditKind, (payload: Fields) => boolean>> = {
  setDecl: (payload) =>
    isString(payload.prop) &&
    isString(payload.value) &&
    isOptional(payload.important, (value) => typeof value === 'boolean') &&
    isOptional(payload.rule, isString),
  removeDecl: (payload) => isString(payload.prop) && isOptional(payload.rule, isString),
  setAttr: (payload) => isString(payload.name) && isString(payload.value),
  setText: (payload) => isString(payload.text),
  moveNode: (payload) => isEdId(payload.parent) && (payload.before === null || isEdId(payload.before)),
  wrapNode: (payload) => isString(payload.tag),
  unwrapNode: () => true,
  duplicateNode: () => true,
  deleteNode: () => true,
}

function isEditOp(value: unknown): value is EditOp {
  if (!isObject(value) || !isString(value.kind) || !Object.hasOwn(PAYLOAD_CHECKS, value.kind)) return false
  if (!Array.isArray(value.target) || value.target.length === 0 || !value.target.every(isEdId)) return false
  return isObject(value.payload) && PAYLOAD_CHECKS[value.kind as EditKind](value.payload)
}

function isBoardView(value: unknown): boolean {
  return isObject(value) && isFiniteNumber(value.zoom) && value.zoom > 0 && isFiniteNumber(value.panX) && isFiniteNumber(value.panY) && isEdIdList(value.selection)
}

export function isEditorState(value: unknown): value is EditorState {
  if (!isObject(value) || !isEdIdList(value.hidden) || !isEdIdList(value.locked) || !isEdIdList(value.collapsed)) return false
  return isObject(value.boards) && Object.values(value.boards).every(isBoardView)
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isObject(value)) return false
  switch (value.type) {
    case 'open':
      return isString(value.board)
    case 'op':
      return isString(value.opId) && isEditOp(value.op)
    case 'undo':
    case 'redo':
    case 'unlockStalePush':
      return true
    case 'resolvePending':
      return isString(value.file) && typeof value.keep === 'boolean'
    case 'revertFile':
      return isString(value.file)
    case 'saveEditorState':
      return isEditorState(value.state)
    default:
      return false
  }
}

/** Anything that is not JSON of a known message with the fields it needs is dropped. */
export function parseClientMessage(data: WebSocket.RawData): ClientMessage | null {
  try {
    const message: unknown = JSON.parse(data.toString())
    return isClientMessage(message) ? message : null
  } catch {
    return null
  }
}
