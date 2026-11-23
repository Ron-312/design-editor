import type { EditorAction, EditorContext } from '../plugin-api'

const whileEditable = (ctx: EditorContext) => !ctx.readOnly()

export const actions: EditorAction[] = [
  { id: 'history.undo', label: 'Undo', kbd: 'Mod+Z', run: (ctx) => ctx.undo(), when: whileEditable },
  { id: 'history.redo', label: 'Redo', kbd: 'Mod+Shift+Z', run: (ctx) => ctx.redo(), when: whileEditable },
]
