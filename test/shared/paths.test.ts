import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findStoredPath, isPortablePath, toNativePath, toProjectPath } from '../../src/shared/paths'
import type { ProjectPath } from '../../src/shared/types'

const ROOT = path.join(os.tmpdir(), 'projects', 'Ron’s site ü')

describe('toProjectPath', () => {
  it('turns a native path under the root into a project-relative / path', () => {
    expect(toProjectPath(ROOT, path.join(ROOT, 'project', 'hero.dc.html'))).toBe('project/hero.dc.html')
    expect(toProjectPath(ROOT, path.join(ROOT, 'project', 'ds', 'core', 'tokens.json'))).toBe('project/ds/core/tokens.json')
  })

  it('keeps spaces and non-ASCII characters in names', () => {
    expect(toProjectPath(ROOT, path.join(ROOT, 'project', 'Café menu.dc.html'))).toBe('project/Café menu.dc.html')
  })
})

describe('toNativePath', () => {
  it('joins a project path onto the root with native separators', () => {
    const projectPath = 'project/ds/core/tokens.json' as ProjectPath
    expect(toNativePath(ROOT, projectPath)).toBe(path.join(ROOT, 'project', 'ds', 'core', 'tokens.json'))
  })

  it('round-trips with toProjectPath', () => {
    const projectPath = 'project/Café menu.dc.html' as ProjectPath
    expect(toProjectPath(ROOT, toNativePath(ROOT, projectPath))).toBe(projectPath)
  })
})

describe('findStoredPath', () => {
  const stored = ['project/Hero.dc.html', 'project/ds/core/tokens.json'] as ProjectPath[]

  it('matches case-insensitively and returns the stored spelling', () => {
    expect(findStoredPath(stored, 'project/hero.DC.html')).toBe('project/Hero.dc.html')
    expect(findStoredPath(stored, 'PROJECT/DS/Core/Tokens.json')).toBe('project/ds/core/tokens.json')
  })

  it('finds nothing for a path that is not stored', () => {
    expect(findStoredPath(stored, 'project/pricing.dc.html')).toBeUndefined()
  })
})

describe('isPortablePath', () => {
  it.each([
    'project/hero.dc.html',
    'project/ds/core/tokens.json',
    'project/console.dc.html',
    'project/icon.svg',
    'project/com.dc.html',
    'project/Café menu.dc.html',
  ])('accepts %s', (candidate) => {
    expect(isPortablePath(candidate)).toBe(true)
  })

  it.each([
    'project/CON',
    'project/con.dc.html',
    'project/NUL',
    'project/nul.txt',
    'project/PRN.html',
    'project/aux',
    'project/COM1.dc.html',
    'project/lpt9',
    'con/hero.dc.html',
  ])('rejects the Windows-reserved name in %s', (candidate) => {
    expect(isPortablePath(candidate)).toBe(false)
  })

  it.each(['project/notes.', 'project/notes ', 'project/drafts./hero.dc.html', 'project/drafts /hero.dc.html'])(
    'rejects a trailing dot or space in %j',
    (candidate) => {
      expect(isPortablePath(candidate)).toBe(false)
    },
  )

  it.each(['<', '>', ':', '"', '|', '?', '*'])('rejects %s in a name', (character) => {
    expect(isPortablePath(`project/a${character}b.dc.html`)).toBe(false)
  })
})
