import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { InstallerApp } from './installer/InstallerApp'
import { ContextMenuProvider } from './components/shared/ContextMenu'
import './index.css'
import 'highlight.js/styles/atom-one-dark.css'

// Single root — never recreated across HMR
const rootEl = document.getElementById('root')!
const root = ReactDOM.createRoot(rootEl)

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

function LoadingSplash(): React.ReactElement {
  return (
    <div className="h-screen bg-base flex flex-col items-center justify-center gap-4 select-none">
      <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
        <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
          <path d="M3 10 C3 5.5 6.5 2 11 2 s8 3.5 8 8 -3.5 8-8 8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          <circle cx="7" cy="10" r="1" fill="white"/>
          <circle cx="11" cy="10" r="1" fill="white"/>
          <circle cx="15" cy="10" r="1" fill="white"/>
        </svg>
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-accent/40 animate-pulse"
            style={{ animationDelay: `${i * 0.2}s` }} />
        ))}
      </div>
    </div>
  )
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
