import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import { withReplacedIds, type EditorState, type ServerMessage, type UndoState } from '../shared/protocol'
import type { CanvasLayout, EditRecord, ProjectPath } from '../shared/types'
import { createDefaultRegistry, type Platform } from './actions/registry'
import { CanvasView, openBoard, type CanvasCommands } from './canvas/CanvasView'
import { ToolDock } from './canvas/ToolDock'
import { describeEdit, DiffPanel, fileName } from './DiffPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { FrameGeneration, useProbeReadyCount } from './frame-generation'
import { LayersPanel } from './panels/LayersPanel'
import { PropertiesPanel, type Token } from './panels/PropertiesPanel'
import { TokensPanel } from './panels/TokensPanel'
import type { EditorContext, ShellSlot } from './plugin-api'
import type { ProbeClient } from './probe-client'
import { ShellIcon } from './shell-icons'
import { defaultShellSlots } from './shell/slots'
import type { EditorStore, ShownToast } from './store'
import { BoardSwitcher, PreviewSwitch, PushButton, SyncStrip, ZoomMenu, type SyncStep } from './TopBar'
import type { WsClient } from './ws-client'

export interface AppProps {
  readonly store: EditorStore
  readonly ws: WsClient
  readonly platform: Platform
  readonly projectName: string
  readonly slots?: readonly ShellSlot[]
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

type LeftTab = 'layers' | 'tokens' | 'changes'
type RestoredMessage = Extract<ServerMessage, { type: 'restored' }>
type SavedBoardView = EditorState['boards'][ProjectPath]

const NO_UNDO: UndoState = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null }
const TOAST_MS = 6000
const VIEW_SAVE_MS = 400
const OFFLINE_BANNER = 'offline'
const DEFAULT_SLOTS = defaultShellSlots()

const SHORTCUTS: Readonly<Record<Platform, { readonly undo: string; readonly redo: string }>> = {
  mac: { undo: '⌘Z', redo: '⇧⌘Z' },
  windows: { undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z' },
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

/** A style-only undo needs no reload: the iframe takes every value the restored file now resolves. */
function previewRestored(probe: ProbeClient, { declarations }: RestoredMessage): void {
  for (const { edId, prop, value } of declarations) probe.previewDecl([edId], prop, value)
}

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))
}

/** Canvas shortcuts (Delete, arrows, Escape) keep working after a click on a properties control that takes no typing. */
function returnFocusToCanvas(event: MouseEvent<HTMLElement>): void {
  const { target, currentTarget } = event
  if (!(target instanceof Element) || !target.closest('aside.props')) return
  if (isTextEntry(target) || isTextEntry(document.activeElement)) return
  currentTarget.querySelector<HTMLElement>('[data-canvas-viewport]')?.focus()
}

function atPreviewWidth({ zoom, panX, panY, selection }: SavedBoardView, previewWidth: number | undefined): SavedBoardView {
  const view = { zoom, panX, panY, selection }
  return previewWidth === undefined ? view : { ...view, previewWidth }
}

/** Each saved board view carries the preview width the editor state holds for that board, and none once it is cleared. */
function withPreviewWidths(views: EditorState['boards'], state: EditorState): EditorState['boards'] {
  const boards = Object.keys({ ...state.boards, ...views }) as ProjectPath[]
  return Object.fromEntries(boards.map((board) => [board, atPreviewWidth(views[board] ?? state.boards[board]!, state.boards[board]?.previewWidth)]))
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

/** Stays until answered; Unlock releases the lock the stalled push left on the canvas. */
function askToUnlockStalePush(store: EditorStore, ws: WsClient, heldForMs: number): string {
  return store.toast({
    message: `A push has held the canvas for ${Math.round(heldForMs / 60_000)} min. It may still be running in Claude Code: unlock?`,
    tone: 'warning',
    actions: [
      { label: 'Unlock', run: () => ws.send({ type: 'unlockStalePush' }) },
      { label: 'Keep waiting', run: () => {} },
    ],
  })
}

function toggleTheme(): void {
  document.documentElement.classList.toggle('light')
}

export function App({ store, ws, platform, projectName, slots = DEFAULT_SLOTS }: AppProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [session, setSession] = useState<Session | null>(null)
  const [probe, setProbe] = useState<ProbeClient | null>(null)
  const [undoState, setUndoState] = useState<UndoState>(NO_UNDO)
  const [saved, setSaved] = useState<SavedEdit | null>(null)
  const [leftTab, setLeftTab] = useState<LeftTab>('layers')
  const [tokens, setTokens] = useState<readonly Token[]>([])
  const [ctx, setCtx] = useState<EditorContext | null>(null)
  const staleToast = useRef<string | null>(null)
  const canvas = useRef<CanvasCommands>(null)
  const registry = useMemo(() => createDefaultRegistry(platform), [platform])
  const editorState = session?.editorState
  const frameGeneration = useProbeReadyCount(probe)

  useEffect(
    () =>
      ws.onMessage((message) => {
        switch (message.type) {
          case 'hello':
            store.setReadOnly(message.readOnly)
            store.restoreBoardViews(message.editorState.boards)
            boardViews.current = message.editorState.boards
            setSession({ layout: message.layout, editorState: message.editorState })
            break
          case 'outsideChange':
            setSession((current) => current && { ...current, editorState: withReplacedIds(current.editorState, message.replacedIds) })
            if (message.pendingOps) askAboutPendingEdits(store, ws, message.file)
            break
          case 'layout':
            setSession((current) => current && { ...current, layout: message.layout })
            break
          case 'undoState':
            setUndoState(message.state)
            break
          case 'tokens':
            setTokens(message.tokens)
            break
          case 'ack':
            setSaved({ record: message.record, line: lineOf(store, message.record) })
            break
          case 'writeFailed':
            store.toast({ message: message.reason === 'locked' ? `File locked by another program: ${message.message}` : message.message, tone: 'error' })
            break
          case 'pushStale':
            staleToast.current = askToUnlockStalePush(store, ws, message.heldForMs)
            break
          case 'pushLock':
            if (!message.held && staleToast.current) store.dismissToast(staleToast.current)
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
    const onKeyDown = (event: KeyboardEvent) => registry.handleKeyDown(event, ctx)
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [registry, ctx])

  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => registry.handleKeyUp(event)
    const onBlur = () => registry.handleBlur()
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [registry])

  /** The saved board views change on every zoom, so they live here and not in the state the panels re-render on. */
  const boardViews = useRef<EditorState['boards']>({})
  const latestEditorState = useRef(editorState)
  useEffect(() => {
    latestEditorState.current = editorState
  }, [editorState])

  const changeEditorState = useCallback(
    (next: EditorState) => {
      setSession((current) => current && { ...current, editorState: next })
      ws.send({ type: 'saveEditorState', state: { ...next, boards: withPreviewWidths(boardViews.current, next) } })
    },
    [ws],
  )

  // Zoom, pan and selection per board are editor-only state too; they are saved once the view settles.
  const hasSession = session !== null
  useEffect(() => {
    if (!hasSession) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const saveSettledView = () => {
      const state = latestEditorState.current
      const { board, view } = store.getState()
      if (!state || !board) return
      const settled = { ...view.viewport, selection: view.selection }
      if (JSON.stringify(boardViews.current[board]) === JSON.stringify(settled)) return
      boardViews.current = { ...boardViews.current, [board]: settled }
      ws.send({ type: 'saveEditorState', state: { ...state, boards: withPreviewWidths(boardViews.current, state) } })
    }
    const stop = store.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(saveSettledView, VIEW_SAVE_MS)
    })
    return () => {
      stop()
      clearTimeout(timer)
    }
  }, [store, ws, hasSession])

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
  const pendingEdits = state.records.length - state.pushed
  const syncStep: SyncStep = state.readOnly || state.push.step ? 'pushing' : pendingEdits > 0 ? 'edited' : 'pulled'
  const shortcuts = SHORTCUTS[platform]
  const shownTab = leftTab === 'tokens' && tokens.length === 0 ? 'layers' : leftTab
  const renderSlots = (place: ShellSlot['place']) =>
    ctx &&
    slots
      .filter((slot) => slot.place === place)
      .map(({ id, component: Slot }) => <Slot key={id} ctx={ctx} registry={registry} platform={platform} probe={probe} />)

  return (
    <FrameGeneration.Provider value={frameGeneration}>
      <div className="app" onClick={returnFocusToCanvas}>
        <header className="top">
          <div className="mark" title="Design Editor">
            <Mark />
          </div>
          <div className="proj">
            {projectName} {state.board && <span className="sub">/ {fileName(state.board)}</span>}
          </div>
          <div className="vsep" />
          <SyncStrip step={syncStep} edits={pendingEdits} />
          <div className="spacer" />
          <button type="button" className="ibtn" title={`Undo  ${shortcuts.undo}`} disabled={!undoState.canUndo || state.readOnly} onClick={() => ws.undo()}>
            <ShellIcon name="undo" />
          </button>
          <button type="button" className="ibtn" title={`Redo  ${shortcuts.redo}`} disabled={!undoState.canRedo || state.readOnly} onClick={() => ws.redo()}>
            <ShellIcon name="redo" />
          </button>
          {session && (
            <>
              <div className="vsep" />
              <BoardSwitcher layout={session.layout} current={state.board} onOpen={(board) => openBoard(store, ws, board)} />
            </>
          )}
          <div className="vsep" />
          <ZoomMenu zoom={state.view.viewport.zoom} canvas={canvas} />
          {renderSlots('top-bar')}
          <div className="spacer" />
          <button type="button" className="ibtn theme-ico" title="Toggle light / dark" onClick={toggleTheme}>
            <ShellIcon name="sun" className="i sun" />
            <ShellIcon name="moon" className="i moon" />
          </button>
          <PreviewSwitch on={state.interact} onToggle={() => store.setInteract(!store.getState().interact)} />
          <PushButton
            pending={pendingEdits}
            locked={state.readOnly}
            push={state.push}
            onStart={(canvas) => ws.send(canvas === undefined ? { type: 'startPush' } : { type: 'startPush', canvas })}
            onCancel={() => ws.send({ type: 'cancelPush' })}
          />
        </header>

        <aside className="left">
          <div className="ptabs" role="tablist" aria-label="Left panel">
            <LeftTabButton tab="layers" current={shownTab} onPick={setLeftTab}>
              Layers
            </LeftTabButton>
            {tokens.length > 0 && (
              <LeftTabButton tab="tokens" current={shownTab} onPick={setLeftTab}>
                Tokens
              </LeftTabButton>
            )}
            <LeftTabButton tab="changes" current={shownTab} onPick={setLeftTab}>
              Changes{state.records.length > 0 && <span className="n">{state.records.length}</span>}
            </LeftTabButton>
          </div>
          <ErrorBoundary area="left panel">
            {panelCtx && shownTab === 'layers' && <LayersPanel ctx={panelCtx} platform={platform} onEditorStateChange={changeEditorState} />}
            {shownTab === 'tokens' && <TokensPanel tokens={tokens} />}
            {shownTab === 'changes' && <DiffPanel records={state.records} onRevertFile={(file) => ws.send({ type: 'revertFile', file })} />}
          </ErrorBoundary>
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
          <ErrorBoundary area="canvas">
            {session && editorState && (
              <CanvasView
                ref={canvas}
                store={store}
                ws={ws}
                layout={session.layout}
                editorState={editorState}
                platform={platform}
                onProbe={setProbe}
                onContext={setCtx}
                onEditorStateChange={changeEditorState}
              />
            )}
          </ErrorBoundary>
          <ToolDock store={store} />
          <div className="toasts">
            {state.toasts.map((toast) => (
              <NoticeToast key={toast.id} store={store} toast={toast} />
            ))}
            {saved && <SaveToast saved={saved} onUndo={undoSaved} onDiff={showDiff} />}
          </div>
        </main>

        {panelCtx ? (
          <ErrorBoundary area="properties panel">
            <PropertiesPanel ctx={panelCtx} tokens={tokens} />
          </ErrorBoundary>
        ) : (
          <aside className="props" aria-label="Properties" />
        )}
        {renderSlots('overlay')}
      </div>
    </FrameGeneration.Provider>
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
