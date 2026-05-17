import { useEffect } from 'react'

interface DialogProps {
  title: string
  message: string
  type?: 'confirm' | 'info' | 'error'
  confirmLabel?: string
  cancelLabel?: string
  onConfirm?: () => void
  onClose: () => void
}

export function Dialog({ title, message, type = 'confirm', confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onClose }: DialogProps): React.ReactElement {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const isDestructive = title.toLowerCase().includes('delete') || title.toLowerCase().includes('remove')

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface border border-border-hover rounded-lg w-[400px] shadow-[0_24px_60px_rgba(0,0,0,0.5)] overflow-hidden">
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            {type === 'error' && (
              <div className="w-8 h-8 rounded-full bg-red/15 flex items-center justify-center flex-shrink-0 mt-px">
                <svg className="w-4 h-4 text-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
            )}
            {isDestructive && type !== 'error' && (
              <div className="w-8 h-8 rounded-full bg-red/15 flex items-center justify-center flex-shrink-0 mt-px">
                <svg className="w-4 h-4 text-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </div>
            )}
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-text-primary mb-1.5">{title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{message}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end px-5 py-4 border-t border-border">
          <button onClick={onClose}
            className="px-4 py-2 text-sm rounded-sm border border-border hover:bg-overlay text-text-secondary cursor-pointer transition-colors">
            {type === 'confirm' ? cancelLabel : 'Close'}
          </button>
          {type === 'confirm' && onConfirm && (
            <button onClick={() => { onConfirm(); onClose() }}
              className={`px-4 py-2 text-sm rounded-sm font-medium cursor-pointer transition-colors ${
                isDestructive
                  ? 'bg-red/15 hover:bg-red/25 text-red border border-red/30'
                  : 'bg-accent hover:bg-accent-hover text-white'
              }`}>
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Global dialog hook — replaces window.alert/confirm
import { useState, useCallback } from 'react'

interface DialogState { title: string; message: string; type: 'confirm' | 'info' | 'error'; confirmLabel?: string; onConfirm?: () => void }

export function useDialog() {
  const [state, setState] = useState<DialogState | null>(null)

  const confirm = useCallback((title: string, message: string, confirmLabel = 'Confirm'): Promise<boolean> => {
    return new Promise(resolve => {
      setState({ title, message, type: 'confirm', confirmLabel, onConfirm: () => resolve(true) })
    })
  }, [])

  const alert = useCallback((title: string, message: string, type: 'info' | 'error' = 'info'): void => {
    setState({ title, message, type })
  }, [])

  const close = useCallback(() => setState(null), [])

  const element = state ? (
    <Dialog {...state} onClose={() => { close(); if (state.type === 'confirm') {} }} />
  ) : null

  return { confirm, alert, element }
}
