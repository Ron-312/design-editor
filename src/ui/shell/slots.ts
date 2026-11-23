/// <reference types="vite/client" />
import type { ShellSlot } from '../plugin-api'

export interface SlotModule {
  readonly slots: readonly ShellSlot[]
}

export function loadShellSlots(modules: Record<string, SlotModule>): ShellSlot[] {
  return Object.values(modules).flatMap((module) => module.slots)
}

export function defaultShellSlots(): ShellSlot[] {
  return loadShellSlots(import.meta.glob<SlotModule>('./*.slot.tsx', { eager: true }))
}
