import { describe, expect, it } from 'vitest'
import { PushGuard, type ArtifactInput } from '../../src/push/guard'

const URL = 'https://claude.ai/artifact/abc'
const PUBLISH: ArtifactInput = { action: 'publish', url: URL, root: '.editor/outbox', files: { 'project/a.dc.html': 'project/a.dc.html' } }
const READ: ArtifactInput = { action: 'read', url: URL, paths: ['project/a.dc.html', 'project/canvas.json'] }

const decisionOf = (guard: PushGuard, input: unknown, tool: unknown = 'Artifact') => guard.decide(tool, input).hookSpecificOutput.permissionDecision

function expecting(input: ArtifactInput): PushGuard {
  const guard = new PushGuard()
  guard.expect(input)
  return guard
}

describe('PushGuard', () => {
  it('allows the exact publish that was asked for, once', () => {
    const guard = expecting(PUBLISH)

    expect(decisionOf(guard, structuredClone(PUBLISH))).toBe('allow')
    expect(decisionOf(guard, structuredClone(PUBLISH))).toBe('deny')
  })

  it('allows a publish that leaves out the default action', () => {
    expect(decisionOf(expecting(PUBLISH), { url: URL, root: '.editor/outbox', files: { 'project/a.dc.html': 'project/a.dc.html' } })).toBe('allow')
  })

  it.each<[string, Record<string, unknown>]>([
    ['another canvas', { url: 'https://claude.ai/artifact/other' }],
    ['another source file', { files: { 'project/a.dc.html': '/etc/passwd' } }],
    ['an extra file', { files: { 'project/a.dc.html': 'project/a.dc.html', 'project/b.dc.html': 'project/b.dc.html' } }],
    ['another root', { root: '/' }],
    ['a forced overwrite', { force: true }],
    ['new capabilities', { capabilities: { db: {} } }],
    ['a delete', { action: 'delete' }],
  ])('denies the publish with %s', (_label, change) => {
    expect(decisionOf(expecting(PUBLISH), { ...PUBLISH, ...change })).toBe('deny')
  })

  it('denies a publish while a read is expected, and a read of other paths', () => {
    expect(decisionOf(expecting(READ), PUBLISH)).toBe('deny')
    expect(decisionOf(expecting(READ), { ...READ, paths: ['project/secret'] })).toBe('deny')
  })

  it('allows the expected read again and in any path order', () => {
    const guard = expecting(READ)

    expect(decisionOf(guard, { ...READ, paths: ['project/canvas.json', 'project/a.dc.html'] })).toBe('allow')
    expect(decisionOf(guard, READ)).toBe('allow')
  })

  it.each([[null], ['text'], [undefined], [[]]])('denies an input that is %j', (input) => {
    expect(decisionOf(expecting(PUBLISH), input)).toBe('deny')
  })

  it('denies every other tool, and everything while no call is expected', () => {
    expect(decisionOf(expecting(PUBLISH), PUBLISH, 'Bash')).toBe('deny')
    expect(decisionOf(new PushGuard(), PUBLISH)).toBe('deny')
  })

  it('knows only its own secret', () => {
    const guard = new PushGuard()

    expect(guard.hasSecret(guard.secret)).toBe(true)
    expect(guard.hasSecret(new PushGuard().secret)).toBe(false)
    expect(guard.hasSecret('')).toBe(false)
    expect(guard.hasSecret(undefined)).toBe(false)
  })
})
