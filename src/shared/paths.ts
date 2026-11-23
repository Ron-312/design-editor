import path from 'node:path'
import type { ProjectPath } from './types'

export function toProjectPath(root: string, nativePath: string): ProjectPath {
  return path.relative(root, nativePath).split(path.sep).join('/') as ProjectPath
}

export function toNativePath(root: string, projectPath: ProjectPath): string {
  return path.join(root, ...projectPath.split('/'))
}

/** NTFS and default APFS are case-insensitive: match ignoring case, keep the stored spelling for writes. */
export function findStoredPath(stored: readonly ProjectPath[], candidate: string): ProjectPath | undefined {
  const key = candidate.toLowerCase()
  return stored.find((storedPath) => storedPath.toLowerCase() === key)
}

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i
const WINDOWS_FORBIDDEN_CHARACTER = /[<>:"|?*]/
const TRAILING_DOT_OR_SPACE = /[. ]$/

function isPortableSegment(segment: string): boolean {
  return (
    !WINDOWS_RESERVED_NAME.test(segment) &&
    !WINDOWS_FORBIDDEN_CHARACTER.test(segment) &&
    !TRAILING_DOT_OR_SPACE.test(segment)
  )
}

/** A project path that can be written on Windows as well as macOS. */
export function isPortablePath(projectPath: string): boolean {
  return projectPath.split('/').every(isPortableSegment)
}
