import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Platform } from './actions/registry'
import { App } from './App'
import { createEditorStore } from './store'
import './theme.css'
import { connectWsClient } from './ws-client'

/** The editor server injects the per-launch token under this name (TOKEN_META in editor-server.ts). */
const TOKEN_META = 'design-editor-token'

function launchToken(): string {
  const token = document.querySelector<HTMLMetaElement>(`meta[name="${TOKEN_META}"]`)?.content
  if (!token) throw new Error('the editor page carries no launch token')
  return token
}

function currentPlatform(): Platform {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'windows'
}

/** Re-navigating the cross-origin frame to its own src reloads it from disk; its probe shakes hands again on load. */
function reloadArtboard(): void {
  const frame = document.querySelector<HTMLIFrameElement>('[aria-label="Canvas"] iframe')
  frame?.setAttribute('src', frame.src)
}

if (location.hash === '#light') document.documentElement.classList.add('light')

const store = createEditorStore()
const ws = connectWsClient({ host: location.host, token: launchToken(), store, reloadFrame: reloadArtboard })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} ws={ws} platform={currentPlatform()} projectName={document.title} />
  </StrictMode>,
)
