import { useEffect, useRef } from 'react'
import { applyStructural } from '../actions/layer.actions'
import { classesWithoutRule, pastedTopLevel, pasteTarget, PRIVATE_HTML_TYPE, sourceHtmlOf, type LastCopy } from '../clipboard'
import type { AckMessage, EditorContext, ShellSlot, ShellSlotProps } from '../plugin-api'

const LAYER_FOCUS = '[data-canvas-viewport], .layers'

function isTextEntry(element: Element): boolean {
  return element.matches('input, textarea, select') || element.closest('[contenteditable]:not([contenteditable="false"])') !== null
}

/** Layer clipboard events come from the canvas, the layers panel, or nothing focused; the rest stay the browser's. */
function isLayerClipboardEvent(event: ClipboardEvent): boolean {
  const target = event.target as Element
  if (target === target.ownerDocument.body || target === target.ownerDocument.documentElement) return true
  return !isTextEntry(target) && target.closest(LAYER_FOCUS) !== null
}

/** Puts the selection's source on the clipboard; null when nothing is selected. */
function copySelection(ctx: EditorContext, data: DataTransfer): LastCopy | null {
  const index = ctx.index()
  const selection = ctx.selection()
  if (!index || !selection || selection.edIds.length === 0) return null
  const html = sourceHtmlOf(index, selection.edIds)
  for (const type of ['text/html', 'text/plain', PRIVATE_HTML_TYPE]) data.setData(type, html)
  return { board: selection.board, edIds: selection.edIds, html }
}

async function paste(ctx: EditorContext, html: string, lastCopy: LastCopy | null): Promise<void> {
  const index = ctx.index()!
  const { parent, before } = pasteTarget(index, ctx.selection()?.edIds ?? [], html, lastCopy)
  let ack: AckMessage
  try {
    ack = await ctx.apply({ target: [parent], kind: 'insertHtml', payload: { before, html } })
  } catch {
    // The ws client already toasted the server's one-line refusal.
    return
  }
  ctx.select(pastedTopLevel(ack))
  const unstyled = classesWithoutRule(index, html)
  if (unstyled.length > 0) ctx.toast({ message: `No rule on this board styles the pasted classes: ${unstyled.join(', ')}`, tone: 'warning' })
}

function LayerClipboard({ ctx }: ShellSlotProps) {
  const lastCopy = useRef<LastCopy | null>(null)

  useEffect(() => {
    function onCopy(event: ClipboardEvent) {
      if (!isLayerClipboardEvent(event)) return
      const copied = copySelection(ctx, event.clipboardData!)
      if (!copied) return
      event.preventDefault()
      lastCopy.current = copied
    }

    function onCut(event: ClipboardEvent) {
      onCopy(event)
      if (!event.defaultPrevented || ctx.readOnly()) return
      void applyStructural(ctx, { target: lastCopy.current!.edIds, kind: 'deleteNode', payload: {} })
    }

    function onPaste(event: ClipboardEvent) {
      if (!isLayerClipboardEvent(event) || ctx.readOnly() || !ctx.index()) return
      const data = event.clipboardData!
      const html = data.getData(PRIVATE_HTML_TYPE) || data.getData('text/html')
      if (!html) return
      event.preventDefault()
      void paste(ctx, html, lastCopy.current)
    }

    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [ctx])

  return null
}

export const slots: readonly ShellSlot[] = [{ id: 'layer-clipboard', place: 'overlay', component: LayerClipboard }]
