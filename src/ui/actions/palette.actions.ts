import { requestPaletteOpen } from '../palette'
import type { EditorAction } from '../plugin-api'

export const actions: readonly EditorAction[] = [
  { id: 'palette.open', label: 'Command palette', kbd: ['Mod+K', 'Mod+/'], run: requestPaletteOpen },
]
