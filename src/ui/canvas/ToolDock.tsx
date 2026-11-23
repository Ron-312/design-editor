import { useSyncExternalStore } from 'react'
import { ShellIcon, type ShellIconName } from '../shell-icons'
import type { CanvasMode, EditorStore } from '../store'

interface DockTool {
  readonly name: string
  readonly icon: ShellIconName
  readonly key?: string
  /** The canvas mode the tool switches to; tools without one are not built yet. */
  readonly mode?: CanvasMode
}

const DRAWING_TOOLS: readonly DockTool[] = [
  { name: 'Select', icon: 'cursor', key: 'V', mode: 'select' },
  { name: 'Frame', icon: 'frame', key: 'F' },
  { name: 'Box', icon: 'rect', key: 'R' },
  { name: 'Text', icon: 'text', key: 'T' },
  { name: 'Image', icon: 'image' },
]

const VIEW_TOOLS: readonly DockTool[] = [
  { name: 'Hand', icon: 'hand', key: 'H', mode: 'hand' },
  { name: 'Code view', icon: 'code' },
]

function DockButton({ tool, current, onPick }: { readonly tool: DockTool; readonly current: CanvasMode; readonly onPick: (mode: CanvasMode) => void }) {
  const { mode } = tool
  const shortcut = tool.key ? `  ${tool.key}` : ''
  if (!mode) {
    return (
      <button type="button" className="ibtn" aria-label={tool.name} aria-disabled="true" title={`${tool.name}: coming soon`}>
        <ShellIcon name={tool.icon} />
      </button>
    )
  }
  return (
    <button
      type="button"
      className={mode === current ? 'ibtn on' : 'ibtn'}
      aria-label={tool.name}
      aria-pressed={mode === current}
      title={`${tool.name}${shortcut}`}
      onClick={() => onPick(mode)}
    >
      <ShellIcon name={tool.icon} />
    </button>
  )
}

export function ToolDock({ store }: { readonly store: EditorStore }) {
  const mode = useSyncExternalStore(store.subscribe, () => store.getState().mode)
  const pick = (next: CanvasMode) => store.setMode(next)
  return (
    <div className="tools" role="toolbar" aria-label="Tools">
      {DRAWING_TOOLS.map((tool) => (
        <DockButton key={tool.name} tool={tool} current={mode} onPick={pick} />
      ))}
      <span className="vsep" />
      {VIEW_TOOLS.map((tool) => (
        <DockButton key={tool.name} tool={tool} current={mode} onPick={pick} />
      ))}
    </div>
  )
}
