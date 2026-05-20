import { AnimatePresence, motion } from 'framer-motion'
import { useNotificationHistory } from '@/hooks/useToast'
import type { Toast } from '@/hooks/useToast'

const TYPE_LABELS: Record<Toast['type'], string> = {
  success: 'Success', error: 'Error', warning: 'Warning', info: 'Info',
}

const TYPE_STYLES: Record<Toast['type'], { dot: string; label: string; border: string }> = {
  success: { dot: 'bg-green',   label: 'text-green',   border: 'border-l-green' },
  error:   { dot: 'bg-red',     label: 'text-red',     border: 'border-l-red' },
  warning: { dot: 'bg-yellow',  label: 'text-yellow',  border: 'border-l-yellow' },
  info:    { dot: 'bg-accent',  label: 'text-accent',  border: 'border-l-accent' },
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function NotificationsPage(): React.ReactElement {
  const { history, clear } = useNotificationHistory()

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-base">
      <div className="flex items-center justify-between px-8 py-5 border-b border-border flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Notifications</h1>
          <p className="text-sm text-text-muted mt-0.5">History of all system events</p>
        </div>
        {history.length > 0 && (
          <button
            onClick={clear}
            className="text-xs px-3 py-1.5 rounded-sm border border-border text-text-muted hover:text-text-secondary hover:border-border-hover transition-colors cursor-pointer"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-text-muted">
            <svg className="w-10 h-10 opacity-25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span className="text-sm">No notifications yet</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-2xl">
            <AnimatePresence initial={false}>
              {history.map(n => {
                const s = TYPE_STYLES[n.type]
                return (
                  <motion.div
                    key={n.id}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.15 }}
                    className={`flex items-start gap-3 px-4 py-3 bg-surface border border-border border-l-2 ${s.border} rounded-md`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${s.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-2xs font-medium uppercase tracking-wide ${s.label}`}>
                          {TYPE_LABELS[n.type]}
                        </span>
                        <span className="text-2xs text-text-muted">{timeAgo(n.createdAt)}</span>
                      </div>
                      <p className="text-sm text-text-primary mt-0.5 leading-snug">{n.title}</p>
                      {n.message && (
                        <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{n.message}</p>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
