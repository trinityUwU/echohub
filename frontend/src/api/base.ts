import { invoke } from '@tauri-apps/api/core'

let resolvedBase: string | null = null

async function resolveBase(): Promise<string> {
  if (resolvedBase) return resolvedBase

  // Running inside Tauri webview — get port from Rust state
  if (window.__TAURI_INTERNALS__) {
    try {
      const port = await invoke<number>('get_backend_port')
      resolvedBase = `http://127.0.0.1:${port}`
      return resolvedBase
    } catch {
      // fallback if invoke fails
    }
  }

  // Browser dev mode — use Vite proxy
  resolvedBase = '/api'
  return resolvedBase
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const base = await resolveBase()
  const url = base.startsWith('/') ? `${base}${path}` : `${base}${path}`

  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export async function apiUrl(path: string): Promise<string> {
  const base = await resolveBase()
  return base.startsWith('/') ? `${base}${path}` : `${base}${path}`
}

// Declare Tauri global for TypeScript
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}
