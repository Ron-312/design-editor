import { randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

export const GUARD_HEADER = 'x-push-secret'

export type ArtifactInput = Readonly<Record<string, unknown>>

export interface Decision {
  readonly allow: boolean
  readonly reason: string
}

const DEFAULT_ACTION = 'publish'
/** Looking at the push's own canvas is harmless, and Claude sometimes looks again; anywhere a file is saved is not its choice. */
const LOOKING_KEYS: Readonly<Record<string, readonly string[]>> = {
  read: ['action', 'url', 'path', 'paths', 'prompt'],
  list: ['action', 'url', 'scope', 'limit'],
}

export function isSameCall(a: unknown, b: ArtifactInput): boolean {
  if (typeof a !== 'object' || a === null) return false
  const comparable = (input: ArtifactInput) => ({ action: DEFAULT_ACTION, ...input, ...(Array.isArray(input.paths) ? { paths: [...input.paths].sort() } : {}) })
  return isDeepStrictEqual(comparable(a as ArtifactInput), comparable(b))
}

/**
 * The app decides what is sent and Claude only carries it out: the one publish expected right now is allowed, with
 * exactly that input, plus looking at that canvas and reading the files being sent. Anything else is denied, whatever
 * text in the canvas talked Claude into it.
 */
export class PushGuard {
  readonly secret = randomBytes(32).toString('base64url')
  private publish: ArtifactInput | null = null
  private outgoing: readonly string[] = []

  constructor(private readonly canvas: string) {}

  /** Files Claude may read: it will not publish what it has not seen. */
  expectPublish(input: ArtifactInput, outgoing: readonly string[]): void {
    this.publish = input
    this.outgoing = outgoing.map((file) => path.resolve(file))
  }

  hasSecret(candidate: string | undefined): boolean {
    const given = Buffer.from(candidate ?? '')
    const own = Buffer.from(this.secret)
    return given.length === own.length && timingSafeEqual(given, own)
  }

  /** A publish is spent by being allowed, so it can never be sent twice. */
  decide(toolName: unknown, input: unknown): Decision {
    if (typeof input !== 'object' || input === null) return { allow: false, reason: 'No input.' }
    const fields = input as ArtifactInput
    if (toolName === 'Read') return this.decideRead(fields)
    if (toolName !== 'Artifact') return { allow: false, reason: 'A push needs only the Artifact tool.' }
    if (this.isLooking(fields)) return { allow: true, reason: 'Looking at the canvas being pushed to.' }
    if (!this.publish || !isSameCall(fields, this.publish)) {
      return { allow: false, reason: this.publish ? `Only this exact publish is allowed: ${JSON.stringify(this.publish)}` : 'No publish is expected now.' }
    }
    this.publish = null
    return { allow: true, reason: 'The editor asked for this publish.' }
  }

  private decideRead({ file_path: file }: ArtifactInput): Decision {
    const allow = typeof file === 'string' && this.outgoing.includes(path.resolve(file))
    return { allow, reason: allow ? 'A file being sent.' : 'Only the files being sent can be read.' }
  }

  private isLooking(input: ArtifactInput): boolean {
    const keys = LOOKING_KEYS[String(input.action)]
    return keys !== undefined && input.url === this.canvas && Object.keys(input).every((key) => keys.includes(key))
  }
}
