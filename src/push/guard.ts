import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

export type ArtifactInput = Readonly<Record<string, unknown>>

/** What Claude Code's PreToolUse hook is answered; without an explicit allow it denies the call itself. */
export interface HookReply {
  readonly hookSpecificOutput: {
    readonly hookEventName: 'PreToolUse'
    readonly permissionDecision: 'allow' | 'deny'
    readonly permissionDecisionReason: string
  }
}

export const GUARD_HEADER = 'x-push-secret'

const ARTIFACT_TOOL = 'Artifact'
const DEFAULT_ACTION = 'publish'

function reply(permissionDecision: 'allow' | 'deny', permissionDecisionReason: string): HookReply {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } }
}

function comparable(input: ArtifactInput): ArtifactInput {
  const paths = Array.isArray(input.paths) ? { paths: [...input.paths].sort() } : {}
  return { action: DEFAULT_ACTION, ...input, ...paths }
}

/**
 * The app decides every call and Claude only carries it out: the one call expected right now is allowed, with
 * exactly that input, and anything else is denied, whatever text in the canvas talked Claude into it.
 */
export class PushGuard {
  readonly secret = randomBytes(32).toString('base64url')
  private expected: ArtifactInput | null = null

  expect(input: ArtifactInput | null): void {
    this.expected = input
  }

  hasSecret(candidate: string | undefined): boolean {
    const given = Buffer.from(candidate ?? '')
    const own = Buffer.from(this.secret)
    return given.length === own.length && timingSafeEqual(given, own)
  }

  /** A publish is spent by being allowed, so it can never be sent twice. */
  decide(toolName: unknown, input: unknown): HookReply {
    const expected = this.expected
    if (!expected) return reply('deny', 'No call is expected now.')
    const matches = toolName === ARTIFACT_TOOL && typeof input === 'object' && input !== null && isDeepStrictEqual(comparable(input as ArtifactInput), comparable(expected))
    if (!matches) return reply('deny', `Only this exact Artifact input is allowed: ${JSON.stringify(expected)}`)
    if ((expected.action ?? DEFAULT_ACTION) === DEFAULT_ACTION) this.expected = null
    return reply('allow', 'The editor asked for this call.')
  }
}
