import { invoke } from '@tauri-apps/api/core'

let resolvedBase: string | null = null
let lastHealthCheck = 0
const HEALTH_TTL = 10_000 // re-verify every 10s

async function tryInvokePort(): Promise<string | null> {
  if (!window.__TAURI_INTERNALS__) return null
  try {
    const port = await invoke<number>('get_backend_port')
    return `http://127.0.0.1:${port}`
  } catch {
    return null
  }
}

async function resolveBase(): Promise<string> {
  // Re-verify cached base periodically so a backend restart is picked up
  if (resolvedBase && Date.now() - lastHealthCheck < HEALTH_TTL) return resolvedBase

  if (resolvedBase) {
    try {
      const r = await fetch(`${resolvedBase}/health`, { signal: AbortSignal.timeout(1500) })
      if (r.ok) { lastHealthCheck = Date.now(); return resolvedBase }
    } catch { /* backend died — invalidate cache */ }
    resolvedBase = null
  }

  const tauriBase = await tryInvokePort()

  if (tauriBase) {
    try {
      const r = await fetch(`${tauriBase}/health`, { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        resolvedBase = tauriBase
        lastHealthCheck = Date.now()
        return resolvedBase
      }
    } catch { /* not ready yet */ }
    return tauriBase
  }

  resolvedBase = '/api'
  lastHealthCheck = Date.now()
  return resolvedBase
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const base = await resolveBase()
  const url = `${base}${path}`

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
  return `${base}${path}`
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}
