import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PatchEngine } from '../../../src/server/edit/patch-engine'
import { decodeSource, encodeSource } from '../../../src/server/source/bytes'
import { SourceIndex } from '../../../src/server/source/source-index'
import type { EdId, EditOp, ProjectPath, SourceRange } from '../../../src/shared/types'

type IndexedFile = ReturnType<SourceIndex['indexFile']>
type PatchOutcome = ReturnType<PatchEngine['apply']>

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url))
const ENDINGS = ['lf', 'crlf', 'mixed', 'bom', 'nonl'] as const
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

interface OnePropertyEdit {
  readonly element: RegExp
  readonly prop: string
  readonly value: string
  readonly from: string
  readonly to: string
}

const CANVAS_EDITS: Readonly<Record<string, OnePropertyEdit>> = {
  'home.dc.html': {
    element: /^<main/,
    prop: 'color',
    value: '#000000',
    from: '<main class="page" style="color: #1c1917">',
    to: '<main class="page" style="color: #000000">',
  },
  'card.dc.html': {
    element: /^<article/,
    prop: 'background-color',
    value: '#fafaf9',
    from: 'style="background-color: #ffffff; width: 328px"',
    to: 'style="background-color: #fafaf9; width: 328px"',
  },
}

const EDGE_EDIT: OnePropertyEdit = {
  element: /^<section/,
  prop: 'background',
  value: '#ffffff',
  from: 'sans-serif; background: #fff7ed">',
  to: 'sans-serif; background: #ffffff">',
}

const IN_MEMORY_VARIANTS: Readonly<Record<(typeof ENDINGS)[number], (lf: string) => string>> = {
  lf: (lf) => lf,
  crlf: (lf) => lf.replace(/\n/g, '\r\n'),
  mixed: (lf) => {
    let line = 0
    return lf.replace(/\n/g, () => (++line % 2 === 0 ? '\r\n' : '\n'))
  },
  bom: (lf) => `\uFEFF${lf}`,
  nonl: (lf) => lf.replace(/\n$/, ''),
}

const canvasFile = (name: string) => path.join(FIXTURES, 'canvas', 'project', name)
const edgeFile = (variant: string) => path.join(FIXTURES, 'endings', `edge.${variant}.dc.html`)

function open(text: string, file: ProjectPath) {
  const indexed = new SourceIndex().indexFile(file, text)
  let minted = 0
  const engine = new PatchEngine({ mintId: () => `minted${++minted}` as EdId })
  return { indexed, engine }
}

function textOf(outcome: PatchOutcome): string {
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`)
  return outcome.text
}

function slice(text: string, range: SourceRange): string {
  return text.slice(range.start, range.end)
}

function findId(indexed: IndexedFile, startTag: RegExp): EdId {
  const id = indexed.ids.find((candidate) => {
    const location = indexed.locate(candidate)
    return location !== undefined && startTag.test(slice(indexed.text, location.startTag))
  })
  if (!id) throw new Error(`no element whose start tag matches ${startTag}`)
  return id
}

function replaceOnce(text: string, from: string, to: string): string {
  const at = text.indexOf(from)
  if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`"${from}" must occur exactly once`)
  return text.slice(0, at) + to + text.slice(at + from.length)
}

function linesWithEndings(text: string): string[] {
  return text.split(/(?<=\n)/)
}

function lineEnding(line: string): string {
  return /\r?\n$/.exec(line)?.[0] ?? ''
}

function changedLineIndexes(before: string, after: string): number[] {
  const beforeLines = linesWithEndings(before)
  const afterLines = linesWithEndings(after)
  expect(afterLines).toHaveLength(beforeLines.length)
  return beforeLines.flatMap((line, index) => (line === afterLines[index] ? [] : [index]))
}

function applyOneProperty(text: string, file: ProjectPath, edit: OnePropertyEdit): string {
  const { indexed, engine } = open(text, file)
  const setDecl = { target: [findId(indexed, edit.element)], kind: 'setDecl', payload: { prop: edit.prop, value: edit.value } }
  return textOf(engine.apply(indexed, [setDecl as EditOp]))
}

function expectOneLineDiff(before: string, after: string, edit: OnePropertyEdit): void {
  expect(after).toBe(replaceOnce(before, edit.from, edit.to))
  const [changed, ...rest] = changedLineIndexes(before, after)
  expect(rest).toEqual([])
  expect(changed).toBeDefined()
  expect(lineEnding(linesWithEndings(after)[changed!]!)).toBe(lineEnding(linesWithEndings(before)[changed!]!))
  expect(after.startsWith('\uFEFF')).toBe(before.startsWith('\uFEFF'))
}

describe.each(ENDINGS)('edge.%s.dc.html on disk', (variant) => {
  const bytes = readFileSync(edgeFile(variant))
  const text = decodeSource(bytes)
  const file = `project/edge.${variant}.dc.html` as ProjectPath

  it('is byte-identical after a flush with no ops', () => {
    const { indexed, engine } = open(text, file)
    expect(encodeSource(textOf(engine.apply(indexed, []))).equals(bytes)).toBe(true)
  })

  it('gives a one-line diff for a one-property edit, keeping the line ending and BOM', () => {
    const after = applyOneProperty(text, file, EDGE_EDIT)
    expectOneLineDiff(text, after, EDGE_EDIT)
    expect(encodeSource(after).subarray(0, 3).equals(UTF8_BOM)).toBe(bytes.subarray(0, 3).equals(UTF8_BOM))
  })
})

describe.each(Object.keys(CANVAS_EDITS))('canvas fixture %s', (name) => {
  const bytes = readFileSync(canvasFile(name))
  const lf = decodeSource(bytes)
  const edit = CANVAS_EDITS[name]!

  it('is byte-identical on disk after a flush with no ops', () => {
    const { indexed, engine } = open(lf, `project/${name}` as ProjectPath)
    expect(encodeSource(textOf(engine.apply(indexed, []))).equals(bytes)).toBe(true)
  })

  it.each(ENDINGS)('is byte-identical as an in-memory %s copy after a flush with no ops', (variant) => {
    const text = IN_MEMORY_VARIANTS[variant](lf)
    const { indexed, engine } = open(text, `project/${name}` as ProjectPath)
    expect(textOf(engine.apply(indexed, []))).toBe(text)
  })

  it.each(ENDINGS)('gives a one-line diff for a one-property edit on the %s copy', (variant) => {
    const text = IN_MEMORY_VARIANTS[variant](lf)
    expectOneLineDiff(text, applyOneProperty(text, `project/${name}` as ProjectPath, edit), edit)
  })
})
