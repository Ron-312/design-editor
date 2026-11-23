import type { EdId, EditOp } from '../../shared/types'
import type { AckMessage, EditorAction, EditorContext } from '../plugin-api'

type EditorToggle = 'hidden' | 'locked'

/** The layers panel's row buttons, named for what a press does next. */
const TOGGLE_LABELS: Readonly<Record<EditorToggle, readonly string[]>> = {
  hidden: ['Hide', 'Show'],
  locked: ['Lock', 'Unlock'],
}

function selected(ctx: EditorContext): readonly EdId[] {
  return ctx.selection()?.edIds ?? []
}

const hasSelection = (ctx: EditorContext) => selected(ctx).length > 0
const whileEditable = (ctx: EditorContext) => !ctx.readOnly() && hasSelection(ctx)

/** Shows the server's selector-match warnings (R04) for a structural op as toasts. */
export async function applyStructural(ctx: EditorContext, op: EditOp): Promise<void> {
  let ack: AckMessage
  try {
    ack = await ctx.apply(op)
  } catch {
    // The ws client already toasted the server's one-line refusal; it is never retried with another tag.
    return
  }
  for (const warning of ack.warnings) ctx.toast({ message: warning, tone: 'warning' })
}

function structural(kind: 'unwrapNode' | 'duplicateNode' | 'deleteNode') {
  return (ctx: EditorContext) => void applyStructural(ctx, { target: selected(ctx), kind, payload: {} })
}

/**
 * EditorContext has no setter for editor-only state, which the app owns and the layers panel changes,
 * so the shortcut presses the selected rows' own toggle.
 */
function toggleEditorState(key: EditorToggle) {
  return (ctx: EditorContext) => {
    const labels = TOGGLE_LABELS[key].map((label) => `button[aria-label="${label}"]`).join(', ')
    for (const edId of selected(ctx)) {
      globalThis.document?.querySelector(`[role="treeitem"][data-layer-id="${edId}"]`)?.querySelector<HTMLButtonElement>(labels)?.click()
    }
  }
}

export const actions: EditorAction[] = [
  {
    id: 'layer.wrap',
    label: 'Wrap in container',
    kbd: 'Mod+G',
    run: (ctx) => void applyStructural(ctx, { target: selected(ctx), kind: 'wrapNode', payload: { tag: 'div' } }),
    when: whileEditable,
  },
  { id: 'layer.ungroup', label: 'Ungroup', kbd: 'Mod+Shift+G', run: structural('unwrapNode'), when: whileEditable },
  { id: 'layer.duplicate', label: 'Duplicate', kbd: 'Mod+D', run: structural('duplicateNode'), when: whileEditable },
  { id: 'layer.delete', label: 'Delete', kbd: 'Delete', run: structural('deleteNode'), when: whileEditable },
  { id: 'layer.hide', label: 'Hide / show', kbd: 'Mod+Shift+H', run: toggleEditorState('hidden'), when: hasSelection },
  { id: 'layer.lock', label: 'Lock / unlock', kbd: 'Mod+Shift+L', run: toggleEditorState('locked'), when: hasSelection },
]
