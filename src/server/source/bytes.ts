import { readFile } from 'node:fs/promises'
import type { EolStyle } from '../../shared/types'

export type Eol = '\n' | '\r\n'

const utf8 = new TextDecoder('utf-8', { ignoreBOM: true })

/** Keeps a BOM as U+FEFF at offset 0, so parse5 and PostCSS offsets index the bytes on disk (R11 #2, #5). */
export function decodeSource(bytes: Uint8Array): string {
  return utf8.decode(bytes)
}

export function encodeSource(text: string): Buffer {
  return Buffer.from(text, 'utf8')
}

export async function readSource(file: string): Promise<string> {
  return decodeSource(await readFile(file))
}

function countEols(text: string): { crlf: number; lf: number } {
  const crlf = text.match(/\r\n/g)?.length ?? 0
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf
  return { crlf, lf }
}

export function eolStyle(text: string): EolStyle {
  const { crlf, lf } = countEols(text)
  if (crlf > 0 && lf > 0) return 'mixed'
  return crlf > 0 ? 'crlf' : 'lf'
}

export function dominantEol(text: string): Eol {
  const { crlf, lf } = countEols(text)
  return crlf > lf ? '\r\n' : '\n'
}

/** 1-based line of each offset; CRLF, LF and a lone CR each end one line. */
export function lineLocator(text: string): (offset: number) => number {
  const lineStarts = [0]
  for (const match of text.matchAll(/\r\n|\n|\r/g)) lineStarts.push(match.index + match[0].length)
  return (offset) => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (lineStarts[mid]! <= offset) low = mid
      else high = mid - 1
    }
    return low + 1
  }
}
