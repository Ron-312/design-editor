import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { EditorState, ServerMessage, UndoState } from '../shared/protocol'
import type { CanvasLayout, EdId, EditRecord, ProjectPath } from '../shared/types'
import { createDefaultRegistry, type Platform } from './actions/registry'
import { canvasContext, CanvasView } from './canvas/CanvasView'
import { describeEdit, DiffPanel, fileName } from './DiffPanel'
import { LayersPanel } from './panels/LayersPanel'
import { PropertiesPanel, type Token } from './panels/PropertiesPanel'
import type { ProbeClient } from './probe-client'
import type { EditorStore, ShownToast } from './store'
import type { WsClient } from './ws-client'

export interface AppProps {
  readonly store: EditorStore
  readonly ws: WsClient
  readonly platform: Platform
  readonly projectName: string
}

interface Session {
  readonly layout: CanvasLayout
  readonly editorState: EditorState
}

/** The last write the server acknowledged, echoed by the save toast. */
interface SavedEdit {
  readonly record: EditRecord
  readonly line: number | null
}

type LeftTab = 'layers' | 'changes'
type SyncStep = 'pulled' | 'edited' | 'pushing'
type RestoredMessage = Extract<ServerMessage, { type: 'restored' }>

const NO_TOKENS: readonly Token[] = []
const NO_UNDO: UndoState = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null }
const TOAST_MS = 6000
const OFFLINE_BANNER = 'offline'
const STALE_PUSH_BANNER = 'push-stale'

const SHORTCUTS: Readonly<Record<Platform, { readonly undo: string; readonly redo: string }>> = {
  mac: { undo: '⌘Z', redo: '⇧⌘Z' },
  windows: { undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z' },
}

const ICON_PATHS = {
  check: <path d="M3 8.5l3 3 7-7" />,
  'chev-r': <path d="M6 4l4 4-4 4" />,
  push: <path d="M5 12.5h-.5a3 3 0 0 1-.4-6A4 4 0 0 1 11.8 5.5a3 3 0 0 1 .2 7h-1M8 14V8.5M6 10.5l2-2 2 2" />,
  undo: <path d="M5.5 3.5l-3 3 3 3M2.5 6.5h7a4 4 0 0 1 0 8H7" />,
  redo: <path d="M10.5 3.5l3 3-3 3M13.5 6.5h-7a4 4 0 0 0 0 8H9" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </>
  ),
  moon: <path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.5 4.5 0 0 0 6.6 6.6z" />,
  warn: (
    <>
      <path d="M7.1 2.9a1 1 0 0 1 1.8 0l5.4 9.6a1 1 0 0 1-.9 1.5H2.6a1 1 0 0 1-.9-1.5z" />
      <path d="M8 6.5v3M8 11.6v.1" />
    </>
  ),
} satisfies Record<string, ReactNode>

function ShellIcon({ name, className = 'i' }: { readonly name: keyof typeof ICON_PATHS; readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  )
}

function Mark() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 17V9.5a7 7 0 0 1 14 0V17z" fill="currentColor" />
      <path d="M8 17v-3.5a2 2 0 0 1 4 0V17" fill="var(--chrome)" />
      <circle cx="10" cy="8" r="1.4" fill="var(--chrome)" />
    </svg>
  )
}

/** The line the save toast names: the rule the record wrote to, or the element's inline style. */
function lineOf(store: EditorStore, record: EditRecord): number | null {
  const target = record.scope.kind === 'rule' ? record.scope.rule : 'inline'
  const sources = store.getState().index?.styles[record.target[0]!] ?? []
  return sources.find((source) => source.target === target)?.line ?? null
}

/** A style-only undo needs no reload: the iframe takes the values the restored file now resolves. */
function previewRestored(probe: ProbeClient, { record, resolved }: RestoredMessage): void {
  if (!record.prop) return
  for (const [edId, value] of Object.entries(resolved)) probe.previewDecl([edId as EdId], record.prop, value)
}

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))
}

function offlineMessage(families: readonly string[]): string {
  return `offline: ${families.join(', ')} not loaded, layout may differ; sizes tuned now may be off`
}

function askAboutPendingEdits(store: EditorStore, ws: WsClient, file: ProjectPath): void {
  store.toast({
    message: `${fileName(file)} changed outside the editor while edits were waiting to save`,
    tone: 'warning',
    actions: [
      { label: 'Keep mine', run: () => ws.send({ type: 'resolvePending', file, keep: true }) },
      { label: 'Use the file', run: () => ws.send({ type: 'resolvePending', file, keep: false }) },
    ],
  })
}

function toggleTheme(): void {
  document.documentElement.classList.toggle('light')
}

export function App({ store, ws, platform, projectName }: AppProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [session, setSession] = useState<Session | null>(null)
  const [probe, setProbe] = useState<ProbeClient | null>(null)
  const [undoState, setUndoState] = useState<UndoState>(NO_UNDO)
  const [saved, setSaved] = useState<SavedEdit | null>(null)
  const [leftTab, setLeftTab] = useState<LeftTab>('layers')
  const registry = useMemo(() => createDefaultRegistry(platform), [platform])
  const editorState = session?.editorState
  const ctx = useMemo(
    () => editorState && canvasContext(store, ws, probe, editorState),
    [store, ws, probe, editorState],
  )

  useEffect(
    () =>
      ws.onMessage((message) => {
        switch (message.type) {
          case 'hello':
            store.setReadOnly(message.readOnly)
            setSession({ layout: message.layout, editorState: message.editorState })
            break
          case 'undoState':
            setUndoState(message.state)
            break
          case 'ack':
            setSaved({ record: message.record, line: lineOf(store, message.record) })
            break
          case 'writeFailed':
            store.toast({ message: message.reason === 'locked' ? `File locked by another program: ${message.message}` : message.message, tone: 'error' })
            break
          case 'outsideChange':
            if (message.pendingOps) askAboutPendingEdits(store, ws, message.file)
            break
          case 'pushStale':
            store.showBanner({ id: STALE_PUSH_BANNER, message: `A push has held the canvas for ${Math.round(message.heldForMs / 60_000)} min; run \`edsync unlock\` if it has stopped` })
            break
          case 'pushLock':
            if (!message.held) store.hideBanner(STALE_PUSH_BANNER)
            break
        }
      }),
    [store, ws],
  )

  useEffect(() => {
    if (!probe) return
    const stopFonts = probe.onMessage((message) => {
      if (message.type === 'fontsFailed') store.showBanner({ id: OFFLINE_BANNER, message: offlineMessage(message.families) })
    })
    const stopRestored = ws.onMessage((message) => {
      if (message.type === 'restored' && !message.reload) previewRestored(probe, message)
    })
    return () => {
      stopFonts()
      stopRestored()
    }
  }, [store, ws, probe])

  useEffect(() => {
    if (!ctx) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTextEntry(event.target)) registry.handleKeyDown(event, ctx)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [registry, ctx])

  function changeEditorState(next: EditorState): void {
    setSession((current) => current && { ...current, editorState: next })
    ws.send({ type: 'saveEditorState', state: next })
  }

  function undoSaved(): void {
    setSaved(null)
    ws.undo()
  }

  function showDiff(): void {
    setSaved(null)
    setLeftTab('changes')
  }

  // The panels read the artboard through the probe, so they wait for one to attach.
  const panelCtx = probe && ctx
  const syncStep: SyncStep = state.readOnly ? 'pushing' : state.records.length > 0 ? 'edited' : 'pulled'
  const shortcuts = SHORTCUTS[platform]

  return (
    <div className="app">
      <header className="top">
        <div className="mark" title="Design Editor">
          <Mark />
        </div>
        <div className="proj">
          {projectName} {state.board && <span className="sub">/ {fileName(state.board)}</span>}
        </div>
        <div className="vsep" />
        <SyncStrip step={syncStep} edits={state.records.length} />
        <div className="spacer" />
        <button type="button" className="ibtn" title={`Undo  ${shortcuts.undo}`} disabled={!undoState.canUndo || state.readOnly} onClick={() => ws.undo()}>
          <ShellIcon name="undo" />
        </button>
        <button type="button" className="ibtn" title={`Redo  ${shortcuts.redo}`} disabled={!undoState.canRedo || state.readOnly} onClick={() => ws.redo()}>
          <ShellIcon name="redo" />
        </button>
        <div className="spacer" />
        <button type="button" className="ibtn theme-ico" title="Toggle light / dark" onClick={toggleTheme}>
          <ShellIcon name="sun" className="i sun" />
          <ShellIcon name="moon" className="i moon" />
        </button>
      </header>

      <aside className="left">
        <div className="ptabs" role="tablist" aria-label="Left panel">
          <LeftTabButton tab="layers" current={leftTab} onPick={setLeftTab}>
            Layers
          </LeftTabButton>
          <LeftTabButton tab="changes" current={leftTab} onPick={setLeftTab}>
            Changes{state.records.length > 0 && <span className="n">{state.records.length}</span>}
          </LeftTabButton>
        </div>
        {panelCtx && leftTab === 'layers' && <LayersPanel ctx={panelCtx} onEditorStateChange={changeEditorState} />}
        {leftTab === 'changes' && <DiffPanel records={state.records} onRevertFile={(file) => ws.send({ type: 'revertFile', file })} />}
      </aside>

      <main className="center">
        {state.banners.length > 0 && (
          <div className="banners">
            {state.banners.map((banner) => (
              <p className="banner" role="alert" key={banner.id}>
                <ShellIcon name="warn" />
                {banner.message}
              </p>
            ))}
          </div>
        )}
        {session && editorState && (
          <CanvasView store={store} ws={ws} layout={session.layout} editorState={editorState} platform={platform} onProbe={setProbe} />
        )}
        <div className="toasts">
          {state.toasts.map((toast) => (
            <NoticeToast key={toast.id} store={store} toast={toast} />
          ))}
          {saved && <SaveToast saved={saved} onUndo={undoSaved} onDiff={showDiff} />}
        </div>
      </main>

      {panelCtx ? <PropertiesPanel ctx={panelCtx} tokens={NO_TOKENS} /> : <aside className="props" aria-label="Properties" />}
    </div>
  )
}

const SYNC_LABELS: Readonly<Record<SyncStep, string>> = {
  pulled: 'Sync status: pulled, no edits yet',
  edited: 'Sync status: edited, changes not pushed',
  pushing: 'Sync status: pushing',
}

function SyncStrip({ step, edits }: { readonly step: SyncStep; readonly edits: number }) {
  const currentIf = (candidate: SyncStep) => (candidate === step ? ('step' as const) : undefined)
  return (
    <div className="sync" role="status" aria-label={SYNC_LABELS[step]}>
      <span className="step done" aria-current={currentIf('pulled')}>
        <ShellIcon name="check" />
        Pulled
      </span>
      <ShellIcon name="chev-r" className="i arrow" />
      <span className="step" aria-current={currentIf('edited')}>
        {edits > 0 && <span className="dot" />}
        Edited {edits > 0 && <span className="n">· {edits}</span>}
      </span>
      <ShellIcon name="chev-r" className="i arrow" />
      <span className="step" aria-current={currentIf('pushing')}>
        <ShellIcon name="push" />
        Pushing
      </span>
    </div>
  )
}

interface LeftTabButtonProps {
  readonly tab: LeftTab
  readonly current: LeftTab
  readonly onPick: (tab: LeftTab) => void
  readonly children: ReactNode
}

function LeftTabButton({ tab, current, onPick, children }: LeftTabButtonProps) {
  return (
    <button type="button" role="tab" className="ptab" aria-selected={tab === current} onClick={() => onPick(tab)}>
      {children}
    </button>
  )
}

interface SaveToastProps {
  readonly saved: SavedEdit
  readonly onUndo: () => void
  readonly onDiff: () => void
}

function SaveToast({ saved: { record, line }, onUndo, onDiff }: SaveToastProps) {
  return (
    <div className="toast" role="status">
      <span className="ok">
        <ShellIcon name="check" />
      </span>
      <div>
        <strong>1 change saved · {record.files.map(fileName).join(', ')}</strong>{' '}
        <span className="mono">
          {describeEdit(record)}
          {line !== null && `  L${line}`}
        </span>
      </div>{' '}
      <div className="ta">
        <button type="button" onClick={onUndo}>
          Undo
        </button>
        <button type="button" onClick={onDiff}>
          Diff
        </button>
      </div>
    </div>
  )
}

/** A toast that asks for a choice stays until it is answered; the rest fade on their own. */
function NoticeToast({ store, toast }: { readonly store: EditorStore; readonly toast: ShownToast }) {
  useEffect(() => {
    if (toast.actions) return
    const timer = setTimeout(() => store.dismissToast(toast.id), TOAST_MS)
    return () => clearTimeout(timer)
  }, [store, toast])

  function run(action: () => void) {
    action()
    store.dismissToast(toast.id)
  }

  return (
    <div className={`toast ${toast.tone ?? 'info'}`} role="status">
      <span className="ok">
        <ShellIcon name={toast.tone === 'warning' || toast.tone === 'error' ? 'warn' : 'check'} />
      </span>
      <strong>{toast.message}</strong>
      <div className="ta">
        {toast.actions?.map((action) => (
          <button type="button" key={action.label} onClick={() => run(action.run)}>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
