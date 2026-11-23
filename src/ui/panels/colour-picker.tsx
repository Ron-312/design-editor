import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { EditorContext } from '../plugin-api'
import { NOTATIONS, formatColour, isOutsideSrgb, notationOf, toHsva, type Hsva, type Notation } from './colour'
import type { Declaration } from './fields'
import { useHeldStep } from './hold-step'

interface EyeDropperApi {
  open(): Promise<{ readonly sRGBHex: string }>
}

/** Chromium, Edge and Electron only; not yet in TypeScript's DOM types. */
function eyeDropper(): (new () => EyeDropperApi) | undefined {
  return (window as { EyeDropper?: new () => EyeDropperApi }).EyeDropper
}

const BLACK: Hsva = { h: 0, s: 0, v: 0, a: 1 }

interface Point {
  readonly x: number
  readonly y: number
}

const STEP_DIRECTIONS: Readonly<Record<string, Point>> = {
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
  ArrowRight: { x: 1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function hundredths(value: number): number {
  return Math.round(value * 100) / 100
}

/** Where the pointer sits in the element, from 0 to 1 on each axis, clamped to its edges. */
function pointIn(event: PointerEvent<HTMLElement>): Point {
  const box = event.currentTarget.getBoundingClientRect()
  return { x: clamp01((event.clientX - box.left) / box.width), y: clamp01((event.clientY - box.top) / box.height) }
}

interface Picked {
  readonly hsva: Hsva
  readonly readFrom: string
  readonly wrote: string
}

/**
 * The picker's point. It survives the authored value changing to what the picker wrote, so the hue of
 * a grey is not lost, and is read again when anything else changes the value.
 */
function usePickedColour(authored: string, fallback: string | null) {
  const read = (): Picked => ({ hsva: toHsva(authored) ?? toHsva(fallback ?? '') ?? BLACK, readFrom: authored, wrote: authored })
  const [picked, setPicked] = useState(read)
  const current = picked.readFrom === authored || picked.wrote === authored ? picked : read()
  return {
    hsva: current.hsva,
    show: (hsva: Hsva) => setPicked({ ...current, hsva }),
    wrote: (hsva: Hsva, written: string) => setPicked({ hsva, readFrom: authored, wrote: written }),
    reset: () => setPicked(read()),
  }
}

export interface ColourPickerProps {
  readonly ctx: EditorContext
  readonly label: string
  readonly declaration: Declaration
  /** The colour shown and picked from when nothing readable is authored, such as the computed one. */
  readonly fallback: string | null
}

export function ColourPicker({ ctx, label, declaration, fallback }: ColourPickerProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  return (
    <span className="cpick" ref={root}>
      <button
        type="button"
        className="sw"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={declaration.locked}
        style={{ background: declaration.value || fallback || 'transparent' }}
        onClick={() => setOpen(!open)}
      />
      {open && <PickerDialog ctx={ctx} declaration={declaration} fallback={fallback} onClose={() => setOpen(false)} />}
    </span>
  )
}

interface PickerDialogProps {
  readonly ctx: EditorContext
  readonly declaration: Declaration
  readonly fallback: string | null
  readonly onClose: () => void
}

function PickerDialog({ ctx, declaration, fallback, onClose }: PickerDialogProps) {
  const authored = declaration.value ?? ''
  const picked = usePickedColour(authored, fallback)
  const { hsva } = picked
  const [chosenNotation, setChosenNotation] = useState<Notation | null>(null)
  const notation = chosenNotation ?? notationOf(authored) ?? 'hex'
  const held = useHeldStep(ctx)
  const dragging = useRef(false)
  const EyeDropper = eyeDropper()

  function show(next: Hsva) {
    picked.show(next)
    declaration.preview(formatColour(next, notation))
  }

  function commit(next: Hsva, actionId?: string) {
    const written = formatColour(next, notation)
    picked.wrote(next, written)
    declaration.write(written, actionId)
  }

  function restoreAuthored() {
    picked.reset()
    declaration.restore()
  }

  /** Previews every move and commits once on release, so a drag is one write (plan contract #6). */
  function dragTo(at: (point: Point) => Hsva) {
    return {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        dragging.current = true
        show(at(pointIn(event)))
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        if (dragging.current) show(at(pointIn(event)))
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        if (!dragging.current) return
        dragging.current = false
        commit(at(pointIn(event)))
      },
      onPointerCancel() {
        if (!dragging.current) return
        dragging.current = false
        restoreAuthored()
      },
    }
  }

  function stepWith(step: (direction: Point, large: boolean) => Hsva) {
    return {
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        const direction = STEP_DIRECTIONS[event.key]
        if (!direction) return
        event.preventDefault()
        commit(step(direction, event.shiftKey), held.actionFor(event))
      },
      onKeyUp: held.keyUp,
      onBlur: held.release,
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (!dragging.current) return onClose()
    dragging.current = false
    restoreAuthored()
  }

  async function pickFromScreen(Dropper: new () => EyeDropperApi) {
    try {
      const { sRGBHex } = await new Dropper().open()
      commit({ ...(toHsva(sRGBHex) ?? hsva), a: hsva.a })
    } catch {
      // Escape while picking from the screen rejects; nothing was picked.
    }
  }

  const opaque = formatColour({ ...hsva, a: 1 }, 'hex')
  const hueStep = (direction: Point, large: boolean) => ({ ...hsva, h: (hsva.h + (direction.x + direction.y) * (large ? 10 : 1) + 360) % 360 })
  const alphaStep = (direction: Point, large: boolean) => ({ ...hsva, a: clamp01(hundredths(hsva.a + (direction.x + direction.y) * (large ? 0.1 : 0.01))) })
  const squareStep = (direction: Point, large: boolean) => {
    const delta = large ? 0.1 : 0.01
    return { ...hsva, s: clamp01(hsva.s + direction.x * delta), v: clamp01(hsva.v + direction.y * delta) }
  }

  return (
    <div className="cp" role="dialog" aria-label="Colour picker" onKeyDown={onKeyDown}>
      <style>{PICKER_CSS}</style>
      <div
        className="cp-sv"
        role="slider"
        tabIndex={0}
        aria-label="Saturation and value"
        aria-valuetext={`saturation ${Math.round(hsva.s * 100)}%, value ${Math.round(hsva.v * 100)}%`}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsva.h} 100% 50%))` }}
        {...dragTo(({ x, y }) => ({ ...hsva, s: x, v: 1 - y }))}
        {...stepWith(squareStep)}
      >
        <span className="cp-thumb" style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: opaque }} />
      </div>
      <div
        className="cp-track cp-hue"
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsva.h)}
        {...dragTo(({ x }) => ({ ...hsva, h: x * 360 }))}
        {...stepWith(hueStep)}
      >
        <span className="cp-thumb" style={{ left: `${(hsva.h / 360) * 100}%`, background: `hsl(${hsva.h} 100% 50%)` }} />
      </div>
      <div
        className="cp-track"
        role="slider"
        tabIndex={0}
        aria-label="Alpha"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsva.a * 100)}
        style={{ background: `linear-gradient(to right, transparent, ${opaque}), ${CHECKER}` }}
        {...dragTo(({ x }) => ({ ...hsva, a: hundredths(x) }))}
        {...stepWith(alphaStep)}
      >
        <span className="cp-thumb" style={{ left: `${hsva.a * 100}%`, background: opaque }} />
      </div>
      <div className="cp-row">
        <select aria-label="Notation" value={notation} onChange={(event) => setChosenNotation(event.target.value as Notation)}>
          {NOTATIONS.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        {isOutsideSrgb(authored) && (
          <span className="cp-badge" title="The square shows the nearest colour inside sRGB; dragging writes it">
            outside sRGB
          </span>
        )}
        {EyeDropper && (
          <button type="button" className="ib" aria-label="Eyedropper" title="Pick a colour from the screen" onClick={() => void pickFromScreen(EyeDropper)}>
            <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10.5 2.5l3 3M12 4l-1.5-1.5-2 2-1-1-1 1 4 4 1-1-1-1zM8.5 6.5L3 12v1.5h1.5L10 8" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

const CHECKER = 'repeating-conic-gradient(#c8c8c8 0 25%, #fff 0 50%) 0 0 / 8px 8px'

const PICKER_CSS = `
.props .cpick{position:relative;display:flex}
.props .cp{position:absolute;z-index:10;top:calc(100% + 10px);left:-9px;width:232px;padding:8px;border-radius:var(--r-lg);background:var(--panel);box-shadow:var(--pop-shadow);display:grid;gap:10px}
.props .cp-sv{position:relative;height:148px;border-radius:var(--r-sm);touch-action:none;cursor:crosshair}
.props .cp-track{position:relative;height:12px;border-radius:6px;touch-action:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
.props .cp-hue{background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
.props .cp-sv:focus-visible,.props .cp-track:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.props .cp-thumb{position:absolute;top:50%;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35);transform:translate(-50%,-50%);pointer-events:none}
.props .cp-row{display:flex;align-items:center;gap:8px}
.props .cp-row select{height:24px;padding:0 6px;border:0;border-radius:var(--r-sm);background:var(--field);color:inherit;font:inherit}
.props .cp-badge{font-size:11px;color:var(--warn)}
.props .cp-row .ib{margin-left:auto}
`
