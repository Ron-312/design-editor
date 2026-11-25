import type { PushFailure } from '../shared/push'

export class PushError extends Error {
  constructor(
    readonly reason: PushFailure,
    message: string,
    readonly files: readonly string[] = [],
  ) {
    super(message)
  }
}
