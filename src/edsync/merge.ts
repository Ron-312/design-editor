import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { runGit } from '../core/git'
import { attrValue, elementChildren, TEMPLATE_ROOT } from '../server/source/template-tree'

type Element = DefaultTreeAdapterTypes.Element
type ParentNode = DefaultTreeAdapterTypes.ParentNode

export interface MergeInputs {
  readonly ours: Buffer
  readonly base: Buffer
  readonly theirs: Buffer
}

export type LineMerge =
  | { readonly kind: 'clean'; readonly merged: Buffer }
  | { readonly kind: 'conflict'; readonly conflicts: number; readonly hunks: string }

const LABELS = ['editor', 'last synced', 'Claude Design'] as const
const INPUT_NAMES = ['ours', 'base', 'theirs'] as const
/** git merge-file truncates the conflict count to 127; a negative return (an error) exits above it. */
const MAX_CONFLICT_EXIT = 127
const CONFLICT_START = '<<<<<<< '
const CONFLICT_END = '>>>>>>> '

type LineEnding = '\n' | '\r\n'

/** latin1 keeps one char per byte, so only the line endings change. */
function dominantEnding(bytes: Buffer): LineEnding {
  const text = bytes.toString('latin1')
  const crlf = text.split('\r\n').length - 1
  return crlf > text.split('\n').length - 1 - crlf ? '\r\n' : '\n'
}

function withEnding(bytes: Buffer, ending: LineEnding): Buffer {
  const lf = bytes.toString('latin1').replaceAll('\r\n', '\n')
  return Buffer.from(ending === '\n' ? lf : lf.replaceAll('\n', '\r\n'), 'latin1')
}

/** A raw merge of LF against CRLF conflicts on every line (R11 #4), so mixed inputs merge as LF. */
function normalisedInputs(inputs: MergeInputs): { inputs: MergeInputs; restore: (merged: Buffer) => Buffer } {
  const ending = dominantEnding(inputs.ours)
  const endings = [inputs.ours, inputs.base, inputs.theirs].map(dominantEnding)
  if (endings.every((each) => each === ending)) return { inputs, restore: (merged) => merged }
  const lf = { ours: withEnding(inputs.ours, '\n'), base: withEnding(inputs.base, '\n'), theirs: withEnding(inputs.theirs, '\n') }
  return { inputs: lf, restore: (merged) => withEnding(merged, ending) }
}

function conflictHunks(merged: Buffer): string {
  const hunks: string[] = []
  let open: string[] | null = null
  for (const line of merged.toString('utf8').split('\n')) {
    if (line.startsWith(CONFLICT_START)) open = []
    open?.push(line)
    if (open && line.startsWith(CONFLICT_END)) {
      hunks.push(open.join('\n'))
      open = null
    }
  }
  return hunks.join('\n\n')
}

/** Without `-p` git writes the result into the ours file, so the merged bytes never pass through a string. */
async function gitMergeFile(inputs: MergeInputs, file: string): Promise<{ exitCode: number; merged: Buffer }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'edsync-merge-'))
  try {
    const [ours, base, theirs] = INPUT_NAMES.map((name) => path.join(dir, name))
    await Promise.all(INPUT_NAMES.map((name) => writeFile(path.join(dir, name), inputs[name])))
    const labels = LABELS.flatMap((label) => ['-L', label])
    const result = await runGit(['merge-file', '--diff-algorithm=histogram', ...labels, ours!, base!, theirs!], { cwd: dir })
    if (result.exitCode < 0 || result.exitCode > MAX_CONFLICT_EXIT) {
      throw new Error(`git merge-file could not merge ${file} (exit ${result.exitCode}): ${result.stderr.trim()}`)
    }
    return { exitCode: result.exitCode, merged: await readFile(ours!) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Push step 4: ours = editor file, base = last synced commit, theirs = remote; an error exit throws. */
export async function mergeThreeWay(inputs: MergeInputs, file: string): Promise<LineMerge> {
  const normalised = normalisedInputs(inputs)
  const { exitCode, merged } = await gitMergeFile(normalised.inputs, file)
  if (exitCode > 0) return { kind: 'conflict', conflicts: exitCode, hunks: conflictHunks(merged) }
  return { kind: 'clean', merged: normalised.restore(merged) }
}

interface BlockShape {
  readonly unclosed: number
  readonly templates: number
  readonly scripts: number
}

function isDcScript(element: Element): boolean {
  return element.tagName === 'script' && attrValue(element, 'data-dc-script') !== undefined
}

function blockShapeOf(bytes: Buffer): BlockShape {
  const shape = { unclosed: 0, templates: 0, scripts: 0 }
  const visit = (node: ParentNode) => {
    for (const element of elementChildren(node)) {
      const isTemplate = element.tagName === TEMPLATE_ROOT
      if (isTemplate || isDcScript(element)) {
        if (isTemplate) shape.templates += 1
        else shape.scripts += 1
        if (!element.sourceCodeLocation?.endTag) shape.unclosed += 1
      }
      visit(element)
    }
  }
  visit(parse(bytes.toString('utf8'), { sourceCodeLocationInfo: true }))
  return shape
}

function sameBlocks(left: BlockShape, right: BlockShape): boolean {
  return left.templates === right.templates && left.scripts === right.scripts
}

/** `edsync check`: every `<x-dc>` and `data-dc-script` block has its own end tag. */
export function hasClosedBlocks(bytes: Buffer): boolean {
  return blockShapeOf(bytes).unclosed === 0
}

/** A line merge can exit 0 and still splice one side's open tag to the other's close. */
export function keepsBlocksIntact(merged: Buffer, ours: Buffer, theirs: Buffer): boolean {
  const shape = blockShapeOf(merged)
  return shape.unclosed === 0 && (sameBlocks(shape, blockShapeOf(ours)) || sameBlocks(shape, blockShapeOf(theirs)))
}
