import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface AlertAction {
  label: string
  onClick: () => void
}

export interface AlertBannerProps {
  type: 'error' | 'warning'
  title: string
  detail?: string
  solution?: string
  onAction?: AlertAction
  onDismiss?: () => void
}

const TYPE_STYLES = {
  error:   { border: 'border-red/30',   bg: 'bg-red/8',    icon: 'text-red',    text: 'text-red',    btnBg: 'bg-red/15 hover:bg-red/25 border-red/30 text-red' },
  warning: { border: 'border-yellow/30',bg: 'bg-yellow/8', icon: 'text-yellow', text: 'text-yellow', btnBg: 'bg-yellow/15 hover:bg-yellow/25 border-yellow/30 text-yellow' },
}

function ErrorIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 flex-shrink-0">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}
function WarningIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 flex-shrink-0">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
function ChevronIcon({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function AlertBanner({ type, title, detail, solution, onAction, onDismiss }: AlertBannerProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const s = TYPE_STYLES[type]
  const hasDetail = !!detail || !!solution

  return (
    <div className={`border ${s.border} ${s.bg} rounded overflow-hidden`}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={s.icon}>
          {type === 'error' ? <ErrorIcon /> : <WarningIcon />}
        </span>

        <span className={`text-sm font-medium ${s.text} flex-1 min-w-0`}>{title}</span>

        <div className="flex items-center gap-2 flex-shrink-0">
          {hasDetail && (
            <button
              onClick={() => setExpanded(v => !v)}
              className={`flex items-center gap-1 text-xs ${s.text} opacity-70 hover:opacity-100 transition-opacity cursor-pointer`}
            >
              Details <ChevronIcon open={expanded} />
            </button>
          )}

          {onAction && (
            <button
              onClick={onAction.onClick}
              className={`text-xs px-3 py-1 border rounded-sm font-medium cursor-pointer transition-colors ${s.btnBg}`}
            >
              {onAction.label}
            </button>
          )}

          {onDismiss && (
            <button
              onClick={onDismiss}
              className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3 h-3">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Expandable detail */}
      <AnimatePresence initial={false}>
        {expanded && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 flex flex-col gap-2 border-t border-white/5 pt-2.5">
              {detail && (
                <pre className="text-xs font-mono text-text-secondary bg-black/20 rounded p-2.5 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                  {detail}
                </pre>
              )}
              {solution && (
                <p className="text-xs text-text-muted">
                  <span className="text-text-secondary font-medium">Try: </span>
                  <code className="font-mono text-accent">{solution}</code>
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
