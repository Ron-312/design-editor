import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PushGuard, type ArtifactInput } from '../../src/push/guard'

const CANVAS = 'https://claude.ai/artifact/abc'
const SOURCE = path.resolve('/p/.editor/outbox/project/a.dc.html')
const PUBLISH: ArtifactInput = { action: 'publish', url: CANVAS, root: '.editor/outbox', file_path: SOURCE, files: { 'project/b.dc.html': 'project/b.dc.html' } }

const allows = (guard: PushGuard, input: unknown, tool: unknown = 'Artifact') => guard.decide(tool, input).allow

function expecting(): PushGuard {
  const guard = new PushGuard(CANVAS)
  guard.expectPublish(PUBLISH, [SOURCE])
  return guard
}

describe('PushGuard', () => {
  it('allows the exact publish that was asked for, once', () => {
    const guard = expecting()

    expect(allows(guard, structuredClone(PUBLISH))).toBe(true)
    expect(allows(guard, structuredClone(PUBLISH))).toBe(false)
  })

  it('allows a publish that leaves out the default action', () => {
    expect(allows(expecting(), Object.fromEntries(Object.entries(PUBLISH).filter(([key]) => key !== 'action')))).toBe(true)
  })

  it.each<[string, Record<string, unknown>]>([
    ['another canvas', { url: 'https://claude.ai/artifact/other' }],
    ['another source file', { file_path: '/etc/passwd' }],
    ['an extra file', { files: { 'project/b.dc.html': 'project/b.dc.html', 'project/c.dc.html': 'project/c.dc.html' } }],
    ['another root', { root: '/' }],
    ['a forced overwrite', { force: true }],
    ['new capabilities', { capabilities: { db: {} } }],
    ['a delete', { action: 'delete' }],
    ['a pin', { action: 'pin' }],
  ])('denies the publish with %s', (_label, change) => {
    expect(allows(expecting(), { ...PUBLISH, ...change })).toBe(false)
  })

  it('denies any publish before one is expected', () => {
    expect(allows(new PushGuard(CANVAS), PUBLISH)).toBe(false)
  })

  it.each<[string, Record<string, unknown>]>([
    ['reading the canvas', { action: 'read', url: CANVAS }],
    ['reading its files', { action: 'read', url: CANVAS, paths: ['project/a.dc.html'] }],
    ['listing it', { action: 'list', url: CANVAS, scope: 'files' }],
  ])('allows %s at any time', (_label, input) => {
    expect(allows(new PushGuard(CANVAS), input)).toBe(true)
  })

  it.each<[string, Record<string, unknown>]>([
    ['reading another canvas', { action: 'read', url: 'https://claude.ai/artifact/other' }],
    ['saving a read somewhere else', { action: 'read', url: CANVAS, path: 'project/a.dc.html', out_dir: '/Users/x' }],
    ['listing every artifact', { action: 'list' }],
  ])('denies %s', (_label, input) => {
    expect(allows(new PushGuard(CANVAS), input)).toBe(false)
  })

  it('lets Claude read only the files being sent', () => {
    const guard = expecting()

    expect(allows(guard, { file_path: SOURCE }, 'Read')).toBe(true)
    expect(allows(guard, { file_path: path.join(SOURCE, '..', '..', 'project', 'a.dc.html') }, 'Read')).toBe(true)
    expect(allows(guard, { file_path: '/etc/passwd' }, 'Read')).toBe(false)
    expect(allows(guard, { file_path: path.join(SOURCE, '..', 'b.dc.html') }, 'Read')).toBe(false)
    expect(allows(guard, {}, 'Read')).toBe(false)
  })

  it.each([[null], ['text'], [undefined], [[]]])('denies an input that is %j', (input) => {
    expect(allows(expecting(), input)).toBe(false)
  })

  it('denies every other tool', () => {
    expect(allows(expecting(), PUBLISH, 'Bash')).toBe(false)
  })

  it('knows only its own secret', () => {
    const guard = new PushGuard(CANVAS)

    expect(guard.hasSecret(guard.secret)).toBe(true)
    expect(guard.hasSecret(new PushGuard(CANVAS).secret)).toBe(false)
    expect(guard.hasSecret('')).toBe(false)
    expect(guard.hasSecret(undefined)).toBe(false)
  })
})
