// @vitest-environment jsdom
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import type { ShellSlot } from '../../../src/ui/plugin-api'
import { defaultShellSlots, loadShellSlots, type SlotModule } from '../../../src/ui/shell/slots'

function slot(id: string, place: ShellSlot['place']): ShellSlot {
  return { id, place, component: () => <span data-test-slot={id} /> }
}

describe('shell slot loading', () => {
  it('collects the slots of every module, in file order', () => {
    const modules: Record<string, SlotModule> = {
      './a.slot.tsx': { slots: [slot('palette', 'overlay')] },
      './b.slot.tsx': { slots: [slot('preview-width', 'top-bar'), slot('outline', 'top-bar')] },
    }

    expect(loadShellSlots(modules).map((entry: ShellSlot) => entry.id)).toEqual(['palette', 'preview-width', 'outline'])
  })

  it('keeps the place each slot asks for', () => {
    const modules: Record<string, SlotModule> = {
      './a.slot.tsx': { slots: [slot('palette', 'overlay'), slot('preview-width', 'top-bar')] },
    }

    expect(loadShellSlots(modules).map((entry: ShellSlot) => [entry.id, entry.place])).toEqual([
      ['palette', 'overlay'],
      ['preview-width', 'top-bar'],
    ])
  })

  it('loads no slots from no modules', () => {
    expect(loadShellSlots({})).toEqual([])
  })

  it('loads the slots from src/ui/shell/*.slot.tsx, and there may be none', () => {
    const files = import.meta.glob<SlotModule>('../../../src/ui/shell/*.slot.tsx', { eager: true })
    const exported = Object.values(files).flatMap((file) => file.slots.map((entry: ShellSlot) => entry.id))

    expect(defaultShellSlots().map((entry: ShellSlot) => entry.id).sort()).toEqual(exported.sort())
  })
})
