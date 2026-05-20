import { motion, AnimatePresence } from 'framer-motion'
import type { Toast, ToastAction } from '@/hooks/useToast'
import { removeToast } from '@/hooks/useToast'

// Icons
function CheckIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
function XIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3.5 h-3.5">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
function WarningIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
function InfoIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

const TYPE_STYLES: Record<Toast['type'], { border: string; icon: string; bg: string; iconEl: React.ReactElement }> = {
  success: { border: 'border-l-green', icon: 'text-green', bg: 'bg-green/5',     iconEl: <CheckIcon /> },
  error:   { border: 'border-l-red',   icon: 'text-red',   bg: 'bg-red/5',       iconEl: <XIcon /> },
  warning: { border: 'border-l-yellow',icon: 'text-yellow',bg: 'bg-yellow/5',    iconEl: <WarningIcon /> },
  info:    { border: 'border-l-accent', icon: 'text-accent',bg: 'bg-accent-dim',  iconEl: <InfoIcon /> },
}

interface ToastItemProps {
  toast: Toast
}

export function ToastItem({ toast }: ToastItemProps): React.ReactElement {
  const s = TYPE_STYLES[toast.type]

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.95, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className={`
        relative flex items-start gap-3 px-3.5 py-3 rounded
        border border-border border-l-2 ${s.border} ${s.bg}
        bg-surface shadow-lg shadow-black/30
        min-w-[280px] max-w-[340px] pointer-events-auto
      `}
    >
      {/* Icon */}
      <span className={`flex-shrink-0 mt-0.5 ${s.icon}`}>{s.iconEl}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary leading-snug">{toast.title}</p>
        {toast.message && (
          <p className="text-xs text-text-secondary mt-0.5 leading-snug">{toast.message}</p>
        )}
        {toast.action && (
          <ToastActionButton action={toast.action} />
        )}
      </div>

      {/* Dismiss */}
      <button
        onClick={() => removeToast(toast.id)}
        className="flex-shrink-0 mt-0.5 text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3 h-3">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </motion.div>
  )
}

function ToastActionButton({ action }: { action: ToastAction }): React.ReactElement {
  return (
    <button
      onClick={action.onClick}
      className="mt-1.5 text-xs font-medium text-accent hover:text-accent-hover transition-colors cursor-pointer"
    >
      {action.label} →
    </button>
  )
}

export function ToastList({ toasts }: { toasts: Toast[] }): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 items-end">
      <AnimatePresence initial={false} mode="sync">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  )
}
