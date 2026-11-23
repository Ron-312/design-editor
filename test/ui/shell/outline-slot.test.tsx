// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorState, ProbeToEditor } from '../../../src/shared/protocol'
import type { ActionRegistry, Platform } from '../../../src/ui/actions/registry'
import type { EditorContext, ShellSlot } from '../../../src/ui/plugin-api'
import type { ProbeClient } from '../../../src/ui/probe-client'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

const PLATFORM: Platform = 'mac'
const editorState: EditorState = { hidden: [], locked: [], collapsed: [], boards: {} }

function fakeContext() {
  const spies = {
    editorState: vi.fn(() => editorState),
    setEditorState: vi.fn(),
    apply: vi.fn(),
    setViewport: vi.fn(),
    viewport: vi.fn(() => ({ zoom: 1, panX: 0, panY: 0 })),
    selection: vi.fn(() => null),
    index: vi.fn(() => null),
    readOnly: vi.fn(() => false),
    toast: vi.fn(),
    fit: vi.fn(),
    onChange: vi.fn(() => () => {}),
  }
  return spies as typeof spies & EditorContext
}

function fakeProbe() {
  const listeners = new Set<(message: ProbeToEditor) => void>()
  const spies = {
    setEditorStyles: vi.fn<(css: string | null) => void>(),
    onMessage: vi.fn((listener: (message: ProbeToEditor) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    previewDecl: vi.fn(),
    scrollTo: vi.fn(),
    read: vi.fn(),
    beginTextEdit: vi.fn(() => 'text-1'),
    endTextEdit: vi.fn(),
    dispose: vi.fn(),
  }
  const emit = (message: ProbeToEditor) => act(() => listeners.forEach((listener) => listener(message)))
  return { probe: spies as typeof spies & ProbeClient, emit }
}

type FakeProbe = ReturnType<typeof fakeProbe>

const READY: ProbeToEditor = { type: 'ready', scrollX: 0, scrollY: 0 }

interface Loaded {
  readonly registry: ActionRegistry
  readonly slots: readonly ShellSlot[]
}

/** Outline mode lives only in this editor session, so each test starts from a fresh module graph with it off. */
async function loadFresh(): Promise<Loaded> {
  vi.resetModules()
  const { createDefaultRegistry } = await import('../../../src/ui/actions/registry')
  const { slots } = await import('../../../src/ui/shell/outline.slot')
  return { registry: createDefaultRegistry(PLATFORM), slots }
}

let mounted: { root: Root; container: HTMLElement } | null = null
let loaded: Loaded
let ctx = fakeContext()

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  ctx = fakeContext()
  loaded = await loadFresh()
})

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted
    act(() => root.unmount())
    container.remove()
    mounted = null
  }
  document.body.innerHTML = ''
})

function renderSlots(probe: ProbeClient | null) {
  const { registry, slots } = loaded
  return slots.map(({ id, component: Slot }) => <Slot key={id} ctx={ctx} registry={registry} platform={PLATFORM} probe={probe} />)
}

function mount(probe: ProbeClient | null) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(<>{renderSlots(probe)}</>))
  mounted = { root, container }
  return { rerender: (next: ProbeClient | null) => act(() => root.render(<>{renderSlots(next)}</>)) }
}

function pressOutlineChord() {
  const event = new KeyboardEvent('keydown', { key: 'O', code: 'KeyO', metaKey: true, shiftKey: true, bubbles: true, cancelable: true })
  act(() => {
    loaded.registry.handleKeyDown(event, ctx)
  })
}

function runPaletteToggle() {
  const toggle = loaded.registry.all().find((action) => action.label === 'Toggle outline mode')
  if (!toggle) throw new Error('no Toggle outline mode action in the palette')
  act(() => toggle.run(ctx, 'palette-action'))
}

function sentStyles({ probe }: FakeProbe): Array<string | null> {
  return probe.setEditorStyles.mock.calls.map(([css]) => css)
}

function lastSent(fake: FakeProbe): string | null | undefined {
  return sentStyles(fake).at(-1)
}

function stylesheetSent(fake: FakeProbe): string {
  const css = lastSent(fake)
  if (typeof css !== 'string') throw new Error(`the probe was last sent ${String(css)}, not a stylesheet`)
  return css
}

function isInvisible(colour: string | undefined): boolean {
  return colour !== undefined && /^(transparent|rgba\(.*,\s*0\))$/.test(colour.trim())
}

/** The declarations `css` gives `element`, from every style rule whose selector matches it, later rules winning. */
function declarationsFor(css: string, element: Element): Map<string, string> {
  const sheet = document.createElement('style')
  sheet.textContent = css
  document.head.append(sheet)
  const declarations = new Map<string, string>()
  for (const rule of Array.from(sheet.sheet?.cssRules ?? [])) {
    if (!(rule instanceof CSSStyleRule) || !matchesSafely(element, rule.selectorText)) continue
    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style.item(i)
      declarations.set(prop, rule.style.getPropertyValue(prop))
    }
  }
  sheet.remove()
  return declarations
}

function matchesSafely(element: Element, selector: string): boolean {
  try {
    return element.matches(selector)
  } catch {
    return false
  }
}

function sampleElements(): Element[] {
  const page = document.createElement('main')
  page.innerHTML = '<header class="hero"><h1>Studio</h1><p>Hello <strong>you</strong></p></header><section><div class="col">Brief</div><img alt=""></section>'
  document.body.append(page)
  return [...page.querySelectorAll('*'), page]
}

describe('outline mode', () => {
  it('sends no stylesheet until it is turned on', () => {
    const fake = fakeProbe()
    mount(fake.probe)

    expect(sentStyles(fake).filter((css) => css !== null)).toEqual([])
  })

  it('Mod-Shift-O sends a stylesheet that outlines every element and hides fills and text', () => {
    const fake = fakeProbe()
    mount(fake.probe)

    pressOutlineChord()

    const css = stylesheetSent(fake)
    for (const element of sampleElements()) {
      const declarations = declarationsFor(css, element)
      const outline = declarations.get('outline-style') ?? declarations.get('outline') ?? ''
      expect(outline, `<${element.localName}> outline`).toMatch(/\b(solid|dashed|dotted|double)\b/)
      expect(isInvisible(declarations.get('background-color')), `<${element.localName}> fill`).toBe(true)
      expect(declarations.get('background-image'), `<${element.localName}> background image`).toBe('none')
      const text = [declarations.get('color'), declarations.get('-webkit-text-fill-color')]
      expect(text.some(isInvisible), `<${element.localName}> text`).toBe(true)
    }
  })

  it('a second Mod-Shift-O removes the stylesheet', () => {
    const fake = fakeProbe()
    mount(fake.probe)

    pressOutlineChord()
    pressOutlineChord()

    expect(lastSent(fake)).toBeNull()
  })

  it('the palette action toggles it the same way', () => {
    const fake = fakeProbe()
    mount(fake.probe)

    runPaletteToggle()
    const css = stylesheetSent(fake)
    runPaletteToggle()

    expect(lastSent(fake)).toBeNull()
    pressOutlineChord()
    expect(lastSent(fake)).toBe(css)
  })

  it('re-sends the stylesheet on every probe ready, since a reload drops it', () => {
    const fake = fakeProbe()
    mount(fake.probe)
    pressOutlineChord()
    const css = stylesheetSent(fake)
    fake.probe.setEditorStyles.mockClear()

    fake.emit(READY)
    fake.emit(READY)

    expect(sentStyles(fake)).toEqual([css, css])
  })

  it('sends no stylesheet on ready while outline mode is off', () => {
    const fake = fakeProbe()
    mount(fake.probe)
    pressOutlineChord()
    pressOutlineChord()
    fake.probe.setEditorStyles.mockClear()

    fake.emit(READY)

    expect(sentStyles(fake).filter((css) => css !== null)).toEqual([])
  })

  it("follows the probe of a newly opened board and sends it the stylesheet on that probe's ready", () => {
    const first = fakeProbe()
    const { rerender } = mount(first.probe)
    pressOutlineChord()
    const css = stylesheetSent(first)
    const second = fakeProbe()

    rerender(second.probe)
    second.emit(READY)

    expect(lastSent(second)).toBe(css)
  })

  it('is never serialised: no write, no saved editor state', () => {
    const fake = fakeProbe()
    mount(fake.probe)

    pressOutlineChord()
    fake.emit(READY)
    pressOutlineChord()

    expect(ctx.apply).not.toHaveBeenCalled()
    expect(ctx.setEditorState).not.toHaveBeenCalled()
  })
})
