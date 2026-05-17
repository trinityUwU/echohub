import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { InstallerApp } from './installer/InstallerApp'
import './index.css'

async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.VITE_MSW === 'true') {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }

  // Check install status — show installer if not complete
  let showInstaller = false
  try {
    const res = await fetch('/api/installer/status', {
      signal: AbortSignal.timeout(3000),
    }).catch(() => null)
    if (res?.ok) {
      const data = await res.json()
      showInstaller = !data.complete
    }
  } catch {
    // Backend not ready — skip installer (already installed, sidecar starting)
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {showInstaller ? <InstallerApp /> : <App />}
    </React.StrictMode>,
  )
}

bootstrap()
