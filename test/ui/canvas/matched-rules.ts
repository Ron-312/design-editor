import type { HelmetRuleSource, ProbeRead } from '../../../src/shared/protocol'
import type { RuleId } from '../../../src/shared/types'
import { board, type FakeContext } from './tool-context'

/** A `<helmet><style>` rule, named by its selector, that `matches` lists the elements it applies to. */
export function helmetRule(selector: string, declarations: Readonly<Record<string, string>>, media: string | null = null): HelmetRuleSource {
  return {
    target: `${selector}#0` as RuleId,
    selector,
    media,
    file: board,
    line: 1,
    range: { start: 0, end: 0 },
    declarations: Object.entries(declarations).map(([prop, value]) => ({ prop, value, important: false, hasHole: false })),
  }
}

/** Gives the fake's board these rules, and has its probe match each rule to the elements listed for its selector. */
export function withRules(fake: FakeContext, rules: readonly HelmetRuleSource[], matches: Readonly<Record<string, readonly string[]>>): void {
  const index = fake.ctx.index()
  fake.ctx.index.mockReturnValue({ ...index, rules })
  const answer = fake.ctx.read.getMockImplementation()!
  fake.ctx.read.mockImplementation(async (read: ProbeRead) => {
    if (read.kind !== 'matches') return answer(read)
    return { kind: 'matches', matched: read.selectors.map((selector) => (matches[selector] ?? []).includes(read.edId)) }
  })
}
