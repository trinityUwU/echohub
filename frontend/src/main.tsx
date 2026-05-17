import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { InstallerApp } from './installer/InstallerApp'
import { ContextMenuProvider } from './components/shared/ContextMenu'
import { LoadingSplash } from './components/shared/LoadingSplash'
import './index.css'
import 'highlight.js/styles/atom-one-dark.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

async function waitForBackend(maxAttempts = 30, intervalMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch('/api/installer/status', {
        signal: AbortSignal.timeout(2000),
      }).catch(() => null)
      if (res?.ok) return true
    } catch { /* keep retrying */ }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.VITE_MSW === 'true') {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }

  root.render(<React.StrictMode><LoadingSplash /></React.StrictMode>)

  const ready = await waitForBackend()

  let showInstaller = false
  if (ready) {
    try {
      const res = await fetch('/api/installer/status').catch(() => null)
      if (res?.ok) {
        const data = await res.json()
        showInstaller = !data.complete
      }
    } catch { /* go to app */ }
  }

  root.render(
    <React.StrictMode>
      <ContextMenuProvider>
        {showInstaller ? <InstallerApp /> : <App />}
      </ContextMenuProvider>
    </React.StrictMode>,
  )
}

bootstrap()
