import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isPulledCanvas, readRecent, withRecent, writeRecent } from '../../src/desktop/recent'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'desktop recent '))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('isPulledCanvas', () => {
  it('is true only for a folder holding project/canvas.json', () => {
    expect(isPulledCanvas(dir)).toBe(false)
    mkdirSync(path.join(dir, 'project'))
    expect(isPulledCanvas(dir)).toBe(false)
    writeFileSync(path.join(dir, 'project', 'canvas.json'), '{}')
    expect(isPulledCanvas(dir)).toBe(true)
  })
})

describe('withRecent', () => {
  it('puts the folder first and drops its older entry', () => {
    expect(withRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('keeps at most eight folders', () => {
    expect(withRecent(['1', '2', '3', '4', '5', '6', '7', '8'], 'new')).toEqual(['new', '1', '2', '3', '4', '5', '6', '7'])
  })
})

describe('readRecent and writeRecent', () => {
  it('round-trips the list', async () => {
    const file = path.join(dir, 'recent.json')
    await writeRecent(file, ['/one', '/two'])

    expect(await readRecent(file)).toEqual(['/one', '/two'])
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true)
  })

  it('reads a missing or broken file as empty, and drops entries that are not strings', async () => {
    const file = path.join(dir, 'recent.json')
    expect(await readRecent(file)).toEqual([])
    writeFileSync(file, '{not json')
    expect(await readRecent(file)).toEqual([])
    writeFileSync(file, JSON.stringify(['/ok', 3, null]))
    expect(await readRecent(file)).toEqual(['/ok'])
    writeFileSync(file, JSON.stringify({ not: 'a list' }))
    expect(await readRecent(file)).toEqual([])
  })
})
