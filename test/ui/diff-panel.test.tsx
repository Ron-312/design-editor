// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdId, EditRecord, ProjectPath } from '../../src/shared/types'
import { DiffPanel } from '../../src/ui/DiffPanel'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const edId = (id: string) => id as EdId
const home = 'project/home.dc.html' as ProjectPath
const card = 'project/card.dc.html' as ProjectPath

function setDecl(prop: string, before: string, after: string, files: readonly ProjectPath[]): EditRecord {
  return { target: [edId('e1')], kind: 'setDecl', prop, before, after, scope: { kind: 'element' }, files }
}

function setText(before: string, after: string, files: readonly ProjectPath[]): EditRecord {
  return { target: [edId('e2')], kind: 'setText', prop: null, before, after, scope: { kind: 'element' }, files }
}

let mounted: { root: Root; container: HTMLElement } | null = null

function mount(records: readonly EditRecord[]) {
  const container = document.createElement('div')
  document.body.append(container)
  const onRevertFile = vi.fn<(file: ProjectPath) => void>()
  const root = createRoot(container)
  mounted = { root, container }
  act(() => root.render(<DiffPanel records={records} onRevertFile={onRevertFile} />))
  return { container, onRevertFile }
}

function text(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function fileGroups(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-diff-file]')].map((group) => group.getAttribute('data-diff-file') ?? '')
}

function groupOf(container: HTMLElement, file: ProjectPath): HTMLElement {
  const group = container.querySelector<HTMLElement>(`[data-diff-file="${file}"]`)
  if (!group) throw new Error(`no diff group for ${file}`)
  return group
}

function revertButtonOf(group: HTMLElement): HTMLButtonElement {
  const button = [...group.querySelectorAll('button')].find((candidate) => text(candidate) === 'Revert file')
  if (!button) throw new Error('the group has no Revert file button')
  return button
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted
    act(() => root.unmount())
    container.remove()
    mounted = null
  }
})

describe('per-file diff panel', () => {
  it("lists the session's edit records under each file they touched, files in first-edit order", () => {
    const { container } = mount([
      setDecl('border-radius', '12px', '16px', [card]),
      setDecl('padding', '16px', '24px', [home]),
      setDecl('gap', '8px', '12px', [card]),
    ])

    expect(fileGroups(container)).toEqual([card, home])
    expect(text(groupOf(container, card))).toContain('card.dc.html')
    expect(text(groupOf(container, home))).toContain('home.dc.html')
    expect(text(groupOf(container, home))).not.toContain('border-radius')
  })

  it('shows each record as prop: before → after, in session order', () => {
    const { container } = mount([setDecl('border-radius', '12px', '16px', [home]), setDecl('padding', '16px', '24px', [home])])

    const shown = text(groupOf(container, home))
    const radius = shown.indexOf('border-radius: 12px → 16px')
    const padding = shown.indexOf('padding: 16px → 24px')
    expect(radius).toBeGreaterThanOrEqual(0)
    expect(padding).toBeGreaterThan(radius)
  })

  it('shows a text edit with its old and new text', () => {
    const { container } = mount([setText('Studio Weekly', 'Studio Monthly', [home])])

    const shown = text(groupOf(container, home))
    expect(shown).toContain('Studio Weekly')
    expect(shown).toContain('Studio Monthly')
  })

  it('lists a record that touched two files under both', () => {
    const { container } = mount([setDecl('color', '#1c1917', '#292524', [home, card])])

    expect(fileGroups(container)).toEqual([home, card])
    expect(text(groupOf(container, home))).toContain('color: #1c1917 → #292524')
    expect(text(groupOf(container, card))).toContain('color: #1c1917 → #292524')
  })

  it("'Revert file' reverts only that file", () => {
    const { container, onRevertFile } = mount([setDecl('padding', '16px', '24px', [home]), setDecl('gap', '8px', '12px', [card])])

    act(() => revertButtonOf(groupOf(container, card)).click())

    expect(onRevertFile).toHaveBeenCalledTimes(1)
    expect(onRevertFile).toHaveBeenCalledWith(card)
  })

  it('lists no files and offers no revert when the session has no edits', () => {
    const { container } = mount([])

    expect(fileGroups(container)).toEqual([])
    expect([...container.querySelectorAll('button')].filter((button) => text(button) === 'Revert file')).toHaveLength(0)
  })
})
