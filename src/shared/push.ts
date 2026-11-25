import type { ProjectPath } from './types'

export type PushStep = 'starting' | 'opening' | 'checking' | 'merging' | 'sending' | 'confirming'

export type PushFailure =
  | 'noClaude'
  | 'signedOut'
  | 'noCanvas'
  | 'wrongCanvas'
  | 'conflict'
  | 'artboards'
  | 'cancelled'
  | 'error'

export type PushOutcome =
  /** Both lists empty: the canvas already held everything. */
  | { readonly kind: 'pushed'; readonly title: string; readonly sent: readonly ProjectPath[]; readonly received: readonly ProjectPath[] }
  | { readonly kind: 'failed'; readonly reason: PushFailure; readonly message: string; readonly files: readonly ProjectPath[] }

export interface PushState {
  /** The canvas this project was pulled from; null until a link is known. */
  readonly canvas: string | null
  readonly step: PushStep | null
  /** How the last push of this launch ended; null while one runs and before the first. */
  readonly outcome: PushOutcome | null
}

export const IDLE_PUSH: PushState = { canvas: null, step: null, outcome: null }

/** Once the publish may have left, stopping Claude would leave what landed unknown. */
export function isCancellable(step: PushStep | null): boolean {
  return step === 'starting' || step === 'opening' || step === 'checking' || step === 'merging'
}

const CANVAS_LINK = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+$/

/** The link as the Artifact tool takes it, without query or fragment; null for anything that is not a canvas link. */
export function canvasLink(typed: string): string | null {
  const link = typed.trim().replace(/[?#].*$/, '').replace(/\/$/, '')
  return CANVAS_LINK.test(link) ? link : null
}
