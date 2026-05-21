import { useEffect, useState } from 'react'
import { getMemoryStats, listMemories, deleteMemory } from '@/api/client'
import type { MemoryEntry, MemoryStats } from '@/api/client'

const MEMORY_TYPES = ['user_trait', 'decision', 'fact', 'context', 'error_learned'] as const
type MemoryType = typeof MEMORY_TYPES[number]

const TYPE_COLORS: Record<string, string> = {
  user_trait:     'bg-purple/15 text-purple',
  decision:       'bg-blue/15 text-blue',
  fact:           'bg-green/15 text-green',
  context:        'bg-yellow/15 text-yellow',
  error_learned:  'bg-red/15 text-red',
}

function Badge({ type }: { type: string }): React.ReactElement {
  const cls = TYPE_COLORS[type] ?? 'bg-overlay text-text-muted'
  return <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${cls}`}>{type.replace('_', ' ')}</span>
}

function ImportanceDots({ value }: { value: number }): React.ReactElement {
  return (
    <div className="flex gap-0.5 items-center">
      {Array.from({ length: 10 }, (_, i) => (
        <div
          key={i}
          className={`w-1 h-1 rounded-full ${i < value ? 'bg-accent' : 'bg-overlay'}`}
        />
      ))}
    </div>
  )
}

export function MemoryTab(): React.ReactElement {
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [filter, setFilter] = useState<MemoryType | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  const loadData = async (): Promise<void> => {
    setLoading(true)
    try {
      const [s, m] = await Promise.all([
        getMemoryStats(),
        listMemories({ limit: 200 }),
      ])
      setStats(s)
      setMemories(m)
    } catch {
      // backend may not have any memories yet
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadData() }, [])

  const filtered = filter === 'all' ? memories : memories.filter(m => m.type === filter)

  const handleDelete = async (id: string): Promise<void> => {
    setDeleting(id)
    try {
      await deleteMemory(id)
      setMemories(prev => prev.filter(m => m.id !== id))
      setStats(prev => prev ? {
        ...prev,
        total: prev.total - 1,
        by_type: { ...prev.by_type, [memories.find(m => m.id === id)?.type ?? '']: Math.max(0, (prev.by_type[memories.find(m => m.id === id)?.type ?? ''] ?? 1) - 1) },
      } : prev)
    } catch { /* ignore */ } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-0.5">Memory</h3>
        <p className="text-xs text-text-muted">Semantic memory persists knowledge across conversations. The agent stores and retrieves memories autonomously.</p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total memories" value={String(stats.total)} />
          <StatCard label="Types active" value={String(Object.keys(stats.by_type).length)} />
          <StatCard label="Storage" value={stats.chroma_dir.split('/').slice(-2).join('/')} small />
        </div>
      )}

      {/* By-type breakdown */}
      {stats && stats.total > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-text-muted font-medium uppercase tracking-wide">By type</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.by_type).map(([type, count]) => (
              <div key={type} className="flex items-center gap-1.5 bg-elevated border border-border rounded px-2.5 py-1">
                <Badge type={type} />
                <span className="text-xs text-text-secondary">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter + list */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-xs text-text-muted font-medium uppercase tracking-wide flex-1">Memories</p>
          <div className="flex gap-1">
            <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')}>All</FilterBtn>
            {MEMORY_TYPES.map(t => (
              <FilterBtn key={t} active={filter === t} onClick={() => setFilter(t)}>
                {t.replace('_', ' ')}
              </FilterBtn>
            ))}
          </div>
          <button
            onClick={() => void loadData()}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay transition-colors cursor-pointer"
            title="Refresh"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.01"/>
            </svg>
          </button>
        </div>

        {loading && (
          <div className="text-xs text-text-muted py-4 text-center">Loading memories…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-xs text-text-muted py-4 text-center bg-elevated border border-border rounded-md">
            No memories {filter !== 'all' ? `of type "${filter}"` : ''} stored yet.
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {filtered.map(m => (
              <MemoryRow
                key={m.id}
                entry={m}
                deleting={deleting === m.id}
                onDelete={() => void handleDelete(m.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, small }: { label: string; value: string; small?: boolean }): React.ReactElement {
  return (
    <div className="bg-elevated border border-border rounded-md px-3 py-2.5">
      <p className="text-xs text-text-muted mb-0.5">{label}</p>
      <p className={`font-medium text-text-primary ${small ? 'text-xs truncate' : 'text-sm'}`}>{value}</p>
    </div>
  )
}

function FilterBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`text-2xs px-2 py-1 rounded cursor-pointer transition-colors ${
        active ? 'bg-accent text-white' : 'bg-elevated border border-border text-text-muted hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

function MemoryRow({ entry, deleting, onDelete }: { entry: MemoryEntry; deleting: boolean; onDelete: () => void }): React.ReactElement {
  const date = new Date(entry.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })
  return (
    <div className="flex items-start gap-3 bg-elevated border border-border rounded-md px-3 py-2.5 group">
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-xs text-text-primary leading-relaxed">{entry.content}</p>
        <div className="flex items-center gap-2">
          <Badge type={entry.type} />
          <ImportanceDots value={entry.importance} />
          <span className="text-2xs text-text-muted">{date}</span>
          {entry.conv_id !== 'global' && (
            <span className="text-2xs text-text-muted truncate max-w-[80px]" title={entry.conv_id}>conv:{entry.conv_id.slice(0, 8)}</span>
          )}
        </div>
      </div>
      <button
        onClick={onDelete}
        disabled={deleting}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-muted hover:text-red transition-all cursor-pointer disabled:opacity-30"
        title="Delete memory"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>
  )
}
