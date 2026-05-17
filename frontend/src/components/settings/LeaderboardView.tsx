import { useState, useMemo } from 'react'

interface BenchResult {
  model_id: string; model_name: string; engine: string | null; engine_version: string
  profile_name?: string; tok_per_sec: number; ttft_ms: number | null
  decode_ms: number; total_ms: number; tokens_generated: number
  gpu_short: string; vram_total_gb: number; timestamp: number
  _name?: string; _archived?: boolean; _db_id?: number
}

type SortKey = 'best_tps' | 'avg_tps' | 'best_ttft' | 'runs'

interface ModelStats {
  model_name: string
  engine: string
  gpu: string
  runs: number
  best_tps: number
  avg_tps: number
  worst_tps: number
  best_ttft: number | null
  avg_ttft: number | null
  latest: number
}

interface Props { history: BenchResult[] }

function computeStats(runs: BenchResult[]): ModelStats {
  const tps = runs.map(r => r.tok_per_sec)
  const ttfts = runs.map(r => r.ttft_ms).filter((v): v is number => v != null)
  return {
    model_name: runs[0].model_name,
    engine: runs[0].engine ?? 'llama',
    gpu: runs[0].gpu_short,
    runs: runs.length,
    best_tps: Math.max(...tps),
    avg_tps: Math.round(tps.reduce((a, b) => a + b, 0) / tps.length * 10) / 10,
    worst_tps: Math.min(...tps),
    best_ttft: ttfts.length ? Math.min(...ttfts) : null,
    avg_ttft: ttfts.length ? Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length) : null,
    latest: Math.max(...runs.map(r => r.timestamp)),
  }
}

function groupByModel(runs: BenchResult[]): Map<string, BenchResult[]> {
  const map = new Map<string, BenchResult[]>()
  for (const r of runs) {
    if (!map.has(r.model_name)) map.set(r.model_name, [])
    map.get(r.model_name)!.push(r)
  }
  return map
}

export function LeaderboardView({ history }: Props): React.ReactElement {
  const [activeTab, setActiveTab] = useState<string>('overall')
  const [sortBy, setSortBy] = useState<SortKey>('best_tps')
  const [expandedModel, setExpandedModel] = useState<string | null>(null)

  const active = useMemo(() => history.filter(r => !r._archived), [history])

  // All unique profile names
  const profileNames = useMemo(() => {
    const names = Array.from(new Set(active.map(r => r.profile_name).filter(Boolean))) as string[]
    return names.sort()
  }, [active])

  // Runs for current tab
  const tabRuns = useMemo(() => {
    if (activeTab === 'overall') return active
    return active.filter(r => r.profile_name === activeTab)
  }, [active, activeTab])

  // Stats per model for current tab
  const stats = useMemo((): ModelStats[] => {
    const map = groupByModel(tabRuns)
    return Array.from(map.values()).map(computeStats)
  }, [tabRuns])

  const sorted = useMemo(() => [...stats].sort((a, b) => {
    switch (sortBy) {
      case 'best_tps': return b.best_tps - a.best_tps
      case 'avg_tps': return b.avg_tps - a.avg_tps
      case 'best_ttft': return (a.best_ttft ?? 99999) - (b.best_ttft ?? 99999)
      case 'runs': return b.runs - a.runs
    }
  }), [stats, sortBy])

  const globalBestTps = sorted[0]?.best_tps ?? 1

  if (active.length === 0) {
    return <div className="text-center text-text-muted py-12 text-sm">No results yet — run some benchmarks first.</div>
  }

  const tabs = [
    { id: 'overall', label: 'Overall', count: groupByModel(active).size },
    ...profileNames.map(p => ({ id: p, label: p, count: groupByModel(active.filter(r => r.profile_name === p)).size })),
  ]

  return (
    <div className="flex flex-col gap-4">

      {/* Profile tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); setExpandedModel(null) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md whitespace-nowrap cursor-pointer transition-colors flex-shrink-0 ${
              activeTab === tab.id
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-text-muted hover:text-text-secondary bg-overlay hover:bg-elevated'
            }`}>
            {tab.label}
            <span className={`text-2xs px-1 py-px rounded ${
              activeTab === tab.id ? 'bg-accent/20 text-accent' : 'bg-white/5 text-text-muted/60'
            }`}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Sort bar */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 bg-overlay rounded-md p-0.5">
          {([
            { id: 'best_tps', label: 'Best tok/s' },
            { id: 'avg_tps', label: 'Avg tok/s' },
            { id: 'best_ttft', label: 'Best TTFT' },
            { id: 'runs', label: 'Most runs' },
          ] as { id: SortKey; label: string }[]).map(s => (
            <button key={s.id} onClick={() => setSortBy(s.id)}
              className={`px-2.5 py-1 text-xs rounded transition-colors cursor-pointer ${
                sortBy === s.id ? 'bg-elevated text-text-primary' : 'text-text-muted hover:text-text-secondary'
              }`}>
              {s.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-text-muted ml-auto">{sorted.length} model{sorted.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Empty state for tab */}
      {sorted.length === 0 && (
        <div className="text-center text-text-muted py-8 text-sm">
          No results for profile "{activeTab}" — run this profile to see rankings.
        </div>
      )}

      {/* Rankings */}
      <div className="flex flex-col gap-2">
        {sorted.map((m, rank) => (
          <LeaderboardRow
            key={m.model_name}
            stats={m}
            rank={rank + 1}
            globalBestTps={globalBestTps}
            expanded={expandedModel === m.model_name}
            onToggle={() => setExpandedModel(v => v === m.model_name ? null : m.model_name)}
            profileBreakdown={activeTab === 'overall' ? (() => {
              const byProfile: Record<string, { best_tps: number; runs: number }> = {}
              for (const r of active.filter(r => r.model_name === m.model_name && r.profile_name)) {
                const p = r.profile_name!
                if (!byProfile[p]) byProfile[p] = { best_tps: 0, runs: 0 }
                byProfile[p].runs++
                if (r.tok_per_sec > byProfile[p].best_tps) byProfile[p].best_tps = r.tok_per_sec
              }
              return byProfile
            })() : undefined}
          />
        ))}
      </div>

    </div>
  )
}

function LeaderboardRow({ stats: m, rank, globalBestTps, expanded, onToggle, profileBreakdown }: {
  stats: ModelStats; rank: number; globalBestTps: number; expanded: boolean; onToggle: () => void
  profileBreakdown?: Record<string, { best_tps: number; runs: number }>
}): React.ReactElement {
  const tpsColor = m.best_tps >= 60 ? 'text-green' : m.best_tps >= 30 ? 'text-yellow' : 'text-red'
  const barPct = Math.round((m.best_tps / globalBestTps) * 100)
  const medalColor = rank === 1 ? 'text-yellow' : rank === 2 ? 'text-white/60' : rank === 3 ? 'text-[#cd7f32]' : 'text-text-muted/30'
  const spread = m.best_tps - m.worst_tps
  const spreadPct = m.best_tps > 0 ? Math.round((spread / m.best_tps) * 100) : 0

  return (
    <div className={`bg-surface border rounded-md overflow-hidden transition-colors ${expanded ? 'border-accent/20' : 'border-border'}`}>
      <button onClick={onToggle} className="w-full text-left px-4 py-3 hover:bg-elevated/50 transition-colors cursor-pointer">
        <div className="flex items-center gap-3">
          <div className={`text-sm font-bold font-mono w-7 flex-shrink-0 text-center ${medalColor}`}>
            {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `#${rank}`}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-medium text-text-primary truncate">{m.model_name}</span>
              <span className={`text-2xs px-1.5 py-px rounded flex-shrink-0 ${
                m.engine === 'vllm' ? 'bg-blue/15 text-blue' : 'bg-accent/15 text-accent'
              }`}>{m.engine === 'vllm' ? 'vLLM' : 'llama.cpp'}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 bg-overlay rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${
                  m.best_tps >= 60 ? 'bg-green' : m.best_tps >= 30 ? 'bg-yellow' : 'bg-red'
                }`} style={{ width: `${barPct}%` }} />
              </div>
              <span className="text-2xs text-text-muted/40 w-7 text-right">{barPct}%</span>
            </div>
          </div>
          <div className="flex items-center gap-5 flex-shrink-0">
            <StatCol label="Best" value={`${m.best_tps}`} unit="tok/s" color={tpsColor} />
            <StatCol label="Avg" value={`${m.avg_tps}`} unit="tok/s" />
            <StatCol label="TTFT" value={m.best_ttft ? `${m.best_ttft}ms` : '—'} />
            <StatCol label="Runs" value={String(m.runs)} />
          </div>
          <svg className={`w-3.5 h-3.5 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-4 py-3 bg-elevated/30 flex flex-col gap-3">
          {/* Profile breakdown (overall tab only) */}
          {profileBreakdown && Object.keys(profileBreakdown).length > 0 && (
            <div>
              <div className="text-2xs font-semibold uppercase tracking-widest text-text-muted mb-2">By profile</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {Object.entries(profileBreakdown).map(([name, p]) => (
                  <div key={name} className="bg-surface border border-border rounded-md px-3 py-2">
                    <div className="text-2xs text-text-muted mb-1 truncate">{name}</div>
                    <div className={`text-sm font-bold font-mono ${
                      p.best_tps >= 60 ? 'text-green' : p.best_tps >= 30 ? 'text-yellow' : 'text-red'
                    }`}>{p.best_tps}</div>
                    <div className="text-2xs text-text-muted/50 mt-0.5">{p.runs} run{p.runs !== 1 ? 's' : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Stats detail */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
            <DetailRow label="Best tok/s" value={`${m.best_tps}`} highlight />
            <DetailRow label="Avg tok/s" value={`${m.avg_tps}`} />
            <DetailRow label="Worst tok/s" value={`${m.worst_tps}`} />
            <DetailRow label="Spread" value={`${spread.toFixed(1)} (${spreadPct}%)`} warn={spreadPct > 20} />
            <DetailRow label="Best TTFT" value={m.best_ttft ? `${m.best_ttft} ms` : '—'} />
            <DetailRow label="Avg TTFT" value={m.avg_ttft ? `${m.avg_ttft} ms` : '—'} />
            <DetailRow label="GPU" value={m.gpu} />
            <DetailRow label="Total runs" value={String(m.runs)} />
          </div>
        </div>
      )}
    </div>
  )
}

function StatCol({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }): React.ReactElement {
  return (
    <div className="text-right">
      <div className="text-2xs text-text-muted">{label}</div>
      <div className={`text-sm font-mono font-semibold ${color ?? 'text-text-primary'}`}>
        {value}{unit && <span className="text-2xs text-text-muted ml-0.5">{unit}</span>}
      </div>
    </div>
  )
}

function DetailRow({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between py-0.5 gap-2">
      <span className="text-xs text-text-muted">{label}</span>
      <span className={`text-xs font-mono font-medium ${highlight ? 'text-accent' : warn ? 'text-red' : 'text-text-secondary'}`}>{value}</span>
    </div>
  )
}
