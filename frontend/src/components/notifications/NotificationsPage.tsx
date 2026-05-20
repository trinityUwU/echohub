import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNotificationHistory } from '@/hooks/useToast'
import type { Toast } from '@/hooks/useToast'

type Filter = 'all' | Toast['type']

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',     label: 'All' },
  { id: 'error',   label: 'Errors' },
  { id: 'warning', label: 'Warnings' },
  { id: 'success', label: 'Success' },
  { id: 'info',    label: 'Info' },
]

const TYPE_STYLES: Record<Toast['type'], { dot: string; label: string; border: string; text: string }> = {
  success: { dot: 'bg-green',   label: 'text-green',   border: 'border-l-green',   text: 'Success' },
  error:   { dot: 'bg-red',     label: 'text-red',     border: 'border-l-red',     text: 'Error' },
  warning: { dot: 'bg-yellow',  label: 'text-yellow',  border: 'border-l-yellow',  text: 'Warning' },
  info:    { dot: 'bg-accent',  label: 'text-accent',  border: 'border-l-accent',  text: 'Info' },
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  const h = Math.floor(s / 3600)
  if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Calendar grouping ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function startOfWeek(d: Date): Date {
  const day = d.getDay() // 0=Sun
  return startOfDay(new Date(d.getTime() - day * 86400000))
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

interface Group { label: string; items: Toast[] }

function groupByCalendar(items: Toast[]): Group[] {
  if (items.length === 0) return []

  const now = new Date()
  const todayStart = startOfDay(now).getTime()
  const weekStart = startOfWeek(now).getTime()
  const monthStart = startOfMonth(now).getTime()

  // Collect previous calendar weeks & months beyond current
  const groups: Map<string, Toast[]> = new Map()
  const order: string[] = []

  const push = (key: string, item: Toast): void => {
    if (!groups.has(key)) { groups.set(key, []); order.push(key) }
    groups.get(key)!.push(item)
  }

  for (const item of items) {
    const ts = item.createdAt
    if (ts >= todayStart) {
      // Group by hour within today
      const h = new Date(ts).getHours()
      const label = h === now.getHours()
        ? 'This hour'
        : `Today ${h.toString().padStart(2, '0')}:00`
      push(label, item)
    } else if (ts >= weekStart) {
      const d = new Date(ts)
      const label = d.toLocaleDateString([], { weekday: 'long' }) // Monday, Tuesday…
      push(label, item)
    } else if (ts >= monthStart) {
      // Group by calendar week within this month
      const weekOf = startOfWeek(new Date(ts))
      const label = `Week of ${weekOf.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
      push(label, item)
    } else {
      // Group by calendar month
      const label = new Date(ts).toLocaleDateString([], { month: 'long', year: 'numeric' })
      push(label, item)
    }
  }

  return order.map(key => ({ label: key, items: groups.get(key)! }))
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function NotificationsPage(): React.ReactElement {
  const { history, clear } = useNotificationHistory()
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = filter === 'all' ? history : history.filter(n => n.type === filter)
  const groups = groupByCalendar(filtered)

  const counts: Record<Toast['type'], number> = { error: 0, warning: 0, success: 0, info: 0 }
  history.forEach(n => counts[n.type]++)

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-base">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-border flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Notifications</h1>
          <p className="text-sm text-text-muted mt-0.5">System event history</p>
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

      {/* Filters */}
      <div className="flex items-center gap-1 px-8 py-3 border-b border-border flex-shrink-0 overflow-x-auto">
        {FILTERS.map(f => {
          const count = f.id === 'all' ? history.length : counts[f.id as Toast['type']]
          const active = filter === f.id
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-accent-dim text-accent border border-accent/30'
                  : 'text-text-muted hover:text-text-secondary border border-transparent hover:border-border'
              }`}
            >
              {f.id !== 'all' && (
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${TYPE_STYLES[f.id as Toast['type']].dot}`} />
              )}
              {f.label}
              {count > 0 && (
                <span className={`text-2xs px-1 rounded ${active ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-muted'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-text-muted">
            <svg className="w-10 h-10 opacity-25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span className="text-sm">{filter === 'all' ? 'No notifications yet' : `No ${filter} notifications`}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-6 max-w-2xl">
            {groups.map(group => (
              <section key={group.label}>
                <h3 className="text-2xs font-semibold text-text-muted uppercase tracking-wider mb-2">{group.label}</h3>
                <div className="flex flex-col gap-1.5">
                  <AnimatePresence initial={false}>
                    {group.items.map(n => {
                      const s = TYPE_STYLES[n.type]
                      return (
                        <motion.div
                          key={n.id}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.12 }}
                          className={`flex items-start gap-3 px-4 py-3 bg-surface border border-border border-l-2 ${s.border} rounded-md`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${s.dot}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-2xs font-medium uppercase tracking-wide ${s.label}`}>{s.text}</span>
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
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
