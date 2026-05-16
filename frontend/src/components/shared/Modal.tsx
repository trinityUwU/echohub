import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}

export function Modal({ title, onClose, children, footer, width = 'w-[480px]' }: ModalProps): React.ReactElement {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`bg-surface border border-border-hover rounded-lg ${width} max-h-[90vh] flex flex-col shadow-[0_24px_60px_rgba(0,0,0,0.5)]`}>
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
          <h2 className="flex-1 text-md font-semibold text-text-primary">{title}</h2>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-secondary transition-colors">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">{children}</div>
        {footer && <div className="flex gap-2 justify-end px-5 py-3.5 border-t border-border">{footer}</div>}
      </div>
    </div>
  )
}
