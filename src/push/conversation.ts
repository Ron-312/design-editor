import { PushError } from './errors'
import { isSameCall, PushGuard, type ArtifactInput } from './guard'

export interface CallResult {
  readonly failed: boolean
  readonly text: string
  /** The Artifact tool's structured result. */
  readonly data: unknown
}

/** The fields this app reads of Claude Code's hook events. */
export interface HookEvent {
  readonly hook_event_name?: unknown
  readonly tool_name?: unknown
  readonly tool_input?: unknown
  readonly tool_response?: unknown
  readonly error?: unknown
  readonly last_assistant_message?: unknown
}

export type HookReply = Readonly<Record<string, unknown>>

interface PendingCall {
  readonly input: ArtifactInput
  readonly instruction: string
  readonly resolve: (result: CallResult) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
  stops: number
}

/** The first call also waits for the user to look at the new window and trust the folder. */
const FIRST_CALL_MS = 15 * 60_000
const CALL_MS = 5 * 60_000
/** Claude Code must wait as long as the editor takes between two calls: merging, or fetching images. */
export const HOOK_TIMEOUT_S = 120
const MAX_STOPS = 3
const DONE = 'All done. Make no more calls; reply done.'

function instructionFor(input: ArtifactInput, readFirst: readonly string[]): string {
  const call = `call the Artifact tool with exactly this input: ${JSON.stringify(input)}`
  return readFirst.length > 0 ? `Read these files with the Read tool: ${JSON.stringify(readFirst)} and then ${call}` : `Next, ${call}`
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '')
}

/** Drives a Claude Code session through its hooks: each finished call is answered with the next one to make. */
export class Conversation {
  private pending: PendingCall | null = null
  private ended: PushError | null = null
  private finished = false
  private calls = 0
  private waiting: ((reply: string) => void)[] = []
  private readonly stoppedListeners: (() => void)[] = []

  constructor(readonly guard: PushGuard) {}

  /** `readFirst` are files Claude must see before it publishes them. */
  call(input: ArtifactInput, readFirst: readonly string[] = []): Promise<CallResult> {
    if (this.ended) return Promise.reject(this.ended)
    const instruction = instructionFor(input, readFirst)
    const limit = this.calls++ === 0 ? FIRST_CALL_MS : CALL_MS
    const answered = new Promise<CallResult>((resolve, reject) => {
      const timer = setTimeout(() => this.settle((call) => call.reject(new PushError('error', 'Claude Code did not answer in time.'))), limit)
      this.pending = { input, instruction, resolve, reject, timer, stops: 0 }
    })
    this.tell(instruction)
    return answered
  }

  /** Nothing more is asked, and Claude is told so at its next hook; a call still waited for fails with `error`. */
  end(error: PushError): void {
    this.ended ??= error
    this.settle((call) => call.reject(this.ended!))
    this.finished = true
    this.tell(DONE)
  }

  /** Runs once Claude has nothing left to do. */
  onStopped(listener: () => void): void {
    this.stoppedListeners.push(listener)
  }

  async receive(event: HookEvent): Promise<HookReply> {
    switch (event.hook_event_name) {
      case 'PreToolUse':
        return this.beforeCall(event)
      case 'PostToolUse':
        return this.afterCall(event, { failed: false, text: textOf(event.tool_response), data: event.tool_response })
      case 'PostToolUseFailure':
        return this.afterCall(event, { failed: true, text: textOf(event.error ?? event.tool_response), data: null })
      case 'Stop':
        return this.beforeStop(event)
      default:
        return {}
    }
  }

  private beforeCall({ tool_name: tool, tool_input: input }: HookEvent): HookReply {
    const { allow, reason } = this.finished ? { allow: false, reason: DONE } : this.guard.decide(tool, input)
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: allow ? 'allow' : 'deny', permissionDecisionReason: reason } }
  }

  private async afterCall(event: HookEvent, result: CallResult): Promise<HookReply> {
    if (event.tool_name !== 'Artifact') return {}
    if (this.pending && isSameCall(event.tool_input, this.pending.input)) this.settle((call) => call.resolve(result))
    return { hookSpecificOutput: { hookEventName: event.hook_event_name, additionalContext: await this.next() } }
  }

  /** Claude stopping early is sent back to the call; a call refused before any hook, or given up on, ends the push. */
  private beforeStop(event: HookEvent): HookReply {
    if (this.pending && ++this.pending.stops < MAX_STOPS) return { decision: 'block', reason: this.pending.instruction }
    const said = textOf(event.last_assistant_message ?? '').replace(/\s+/g, ' ').slice(0, 300)
    this.settle((call) => call.reject(new PushError('error', `Claude Code stopped without making the call. ${said === '""' ? '' : said}`.trim())))
    for (const listener of this.stoppedListeners) listener()
    return {}
  }

  private next(): Promise<string> {
    if (this.pending) return Promise.resolve(this.pending.instruction)
    if (this.finished) return Promise.resolve(DONE)
    return new Promise((resolve) => this.waiting.push(resolve))
  }

  private tell(reply: string): void {
    for (const resolve of this.waiting.splice(0)) resolve(reply)
  }

  private settle(how: (call: PendingCall) => void): void {
    const call = this.pending
    if (!call) return
    this.pending = null
    clearTimeout(call.timer)
    how(call)
  }
}
