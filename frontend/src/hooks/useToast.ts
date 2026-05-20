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
}

type Listener = (toasts: Toast[]) => void

// Module-level singleton state
let _toasts: Toast[] = []
const _listeners: Listener[] = []

function notify(): void {
  _listeners.forEach(fn => fn([..._toasts]))
}

export function addToast(opts: Omit<Toast, 'id'>): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const toast: Toast = { ...opts, id }

  _toasts = [..._toasts, toast].slice(-4) // max 4 visible
  notify()

  const duration = opts.duration ?? (opts.type === 'error' ? 8000 : 4000)
  setTimeout(() => removeToast(id), duration)

  return id
}

export function removeToast(id: string): void {
  _toasts = _toasts.filter(t => t.id !== id)
  notify()
}

import { useEffect, useState } from 'react'

export function useToast(): {
  toasts: Toast[]
  show: (opts: Omit<Toast, 'id'>) => string
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
