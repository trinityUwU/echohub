export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  duration?: number
  action?: ToastAction
  createdAt: number
}

type Listener = (toasts: Toast[]) => void

const STORAGE_KEY = 'echohub:notifications'

function _loadHistory(): Toast[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function _saveHistory(history: Toast[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    // localStorage quota exceeded — not critical
  }
}

// ── Singleton state ────────────────────────────────────────────────────────────
let _toasts: Toast[] = []
let _history: Toast[] = _loadHistory()  // restored from localStorage on module init
let _historyListeners: Listener[] = []  // for the history page
const _listeners: Listener[] = []

function notifyLive(): void {
  _listeners.forEach(fn => fn([..._toasts]))
}

function notifyHistory(): void {
  _historyListeners.forEach(fn => fn([..._history]))
}

export function addToast(opts: Omit<Toast, 'id' | 'createdAt'>): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const toast: Toast = { ...opts, id, createdAt: Date.now() }

  _toasts = [..._toasts, toast].slice(-4)
  _history = [toast, ..._history].slice(0, 200)  // keep last 200
  _saveHistory(_history)
  notifyLive()
  notifyHistory()

  const duration = opts.duration ?? (opts.type === 'error' ? 5000 : 4000)
  setTimeout(() => removeToast(id), duration)

  return id
}

export function removeToast(id: string): void {
  _toasts = _toasts.filter(t => t.id !== id)
  notifyLive()
}

export function clearHistory(): void {
  _history = []
  _saveHistory(_history)
  notifyHistory()
}

export function getHistory(): Toast[] {
  return [..._history]
}

export function getUnreadCount(): number {
  return _history.length
}

// ── React hook for live toasts ─────────────────────────────────────────────────
import { useEffect, useState } from 'react'

export function useToast(): {
  toasts: Toast[]
  show: (opts: Omit<Toast, 'id' | 'createdAt'>) => string
  dismiss: (id: string) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string, action?: ToastAction) => void
  warning: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
} {
  const [toasts, setToasts] = useState<Toast[]>([..._toasts])

  useEffect(() => {
    _listeners.push(setToasts)
    return () => {
      const idx = _listeners.indexOf(setToasts)
      if (idx !== -1) _listeners.splice(idx, 1)
    }
  }, [])

  return {
    toasts,
    show: addToast,
    dismiss: removeToast,
    success: (title, message) => addToast({ type: 'success', title, message }),
    error: (title, message, action) => addToast({ type: 'error', title, message, action }),
    warning: (title, message) => addToast({ type: 'warning', title, message }),
    info: (title, message) => addToast({ type: 'info', title, message }),
  }
}

// ── React hook for notification history ───────────────────────────────────────
export function useNotificationHistory(): {
  history: Toast[]
  clear: () => void
} {
  const [history, setHistory] = useState<Toast[]>([..._history])

  useEffect(() => {
    _historyListeners.push(setHistory)
    return () => {
      const idx = _historyListeners.indexOf(setHistory)
      if (idx !== -1) _historyListeners.splice(idx, 1)
    }
  }, [])

  return { history, clear: clearHistory }
}
