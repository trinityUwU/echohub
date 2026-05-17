import { invoke } from '@tauri-apps/api/core'

let resolvedBase: string | null = null

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
  if (resolvedBase) return resolvedBase

  const tauriBase = await tryInvokePort()

  if (tauriBase) {
    // Verify backend is actually reachable on this port
    try {
      const r = await fetch(`${tauriBase}/health`, { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        resolvedBase = tauriBase
        return resolvedBase
      }
    } catch {
      // Backend not ready yet — don't cache, will retry on next call
    }
    // Backend not ready — return but don't cache so next call retries
    return tauriBase
  }

  resolvedBase = '/api'
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
