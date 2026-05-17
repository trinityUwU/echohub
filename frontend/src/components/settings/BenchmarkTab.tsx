import { useState, useEffect, useMemo, useRef } from 'react'
import { apiRequest } from '@/api/base'
import { RunBenchmarkModal } from './RunBenchmarkModal'
import { CompareView } from './CompareView'
import { LeaderboardView } from './LeaderboardView'
import { useContextMenu } from '@/components/shared/useContextMenu'

interface EngineParams {
  n_ctx?: number; n_batch?: number; n_gpu_layers?: number; flash_attn?: boolean
  max_model_len?: number; gpu_memory_utilization?: number | null; enforce_eager?: boolean
}

interface BenchResult {
  model_id: string; model_name: string; engine: string | null; engine_version: string
  profile_id?: number; profile_name?: string
  tokens_generated: number; prompt_tokens: number
  tok_per_sec: number; prefill_tok_per_sec: number | null
  ttft_ms: number | null; prefill_ms: number | null; decode_ms: number; total_ms: number
  gpu_name: string; gpu_short: string; vram_total_gb: number
  vram_used_gb: number | null; gpu_util_pct: number | null
  engine_params: EngineParams
  bench_prompt: string; bench_max_tokens: number; bench_temperature: number
  generated_text?: string; thinking_tokens?: number | null
  timestamp: number; share_text: string; _db_id?: number
  _name?: string; _archived?: boolean
}

// Clear legacy localStorage keys
;['echohub:benchmarks', 'echohub:benchmarks_v2', 'echohub:benchmarks_v3'].forEach(k => localStorage.removeItem(k))

function speedColor(tps: number): string {
  if (tps >= 60) return 'text-green'
  if (tps >= 30) return 'text-yellow'
  return 'text-red'
}

function speedLabel(tps: number): string {
  if (tps >= 80) return 'Excellent'
  if (tps >= 60) return 'Fast'
  if (tps >= 30) return 'OK'
  if (tps >= 15) return 'Slow'
  return 'Very slow'
}

export function BenchmarkTab(): React.ReactElement {
  const [history, setHistory] = useState<BenchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<BenchResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [showRun, setShowRun] = useState(false)
  const [view, setView] = useState<'list' | 'compare' | 'leaderboard'>('list')
  const [showArchived, setShowArchived] = useState(false)
  const [filterModel, setFilterModel] = useState<string>('all')
  const [filterProfile, setFilterProfile] = useState<string>('all')
  const [renamingId, setRenamingId] = useState<number | null>(null)

  useEffect(() => {
    apiRequest<BenchResult[]>('/settings/benchmarks')
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(() => history.filter(r => showArchived ? r._archived : !r._archived), [history, showArchived])
  const models = useMemo(() => Array.from(new Set(visible.map(r => r.model_name))), [visible])
  const profiles = useMemo(() => Array.from(new Set(visible.map(r => r.profile_name).filter(Boolean))), [visible])
  const archivedCount = useMemo(() => history.filter(r => r._archived).length, [history])

  const filtered = useMemo(() => visible.filter(r => {
    if (filterModel !== 'all' && r.model_name !== filterModel) return false
    if (filterProfile !== 'all' && r.profile_name !== filterProfile) return false
    return true
  }), [visible, filterModel, filterProfile])

  const patchBenchmark = async (id: number, patch: { name?: string; archived?: boolean }): Promise<void> => {
    await apiRequest(`/settings/benchmarks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).catch(() => {})
    setHistory(prev => prev.map(r => r._db_id === id ? { ...r, ...patch.name !== undefined ? { _name: patch.name } : {}, ...patch.archived !== undefined ? { _archived: patch.archived } : {} } : r))
  }

  const clear = async (): Promise<void> => {
    await apiRequest('/settings/benchmarks', { method: 'DELETE' }).catch(() => {})
    setHistory([])
  }

  const copy = (r: BenchResult): void => {
    navigator.clipboard.writeText(r.share_text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 bg-overlay rounded-md p-0.5">
          <button onClick={() => setView('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${
              view === 'list' ? 'bg-elevated text-text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}>
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            Results
          </button>
          <button onClick={() => setView('compare')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${
              view === 'compare' ? 'bg-elevated text-text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}>
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            Compare
          </button>
          <button onClick={() => setView('leaderboard')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors cursor-pointer ${
              view === 'leaderboard' ? 'bg-elevated text-text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}>
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 20 18 10"/><polyline points="12 20 12 4"/><polyline points="6 20 6 14"/></svg>
            Leaderboard
          </button>
        </div>
        <button onClick={() => setShowRun(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md cursor-pointer transition-colors flex-shrink-0">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Run benchmark
        </button>
      </div>

      {/* Compare view */}
      {view === 'compare' && (
        history.length === 0
          ? <div className="text-center text-text-muted py-12 text-sm">No results yet — run some benchmarks first.</div>
          : <CompareView history={history} />
      )}

      {/* Leaderboard */}
      {view === 'leaderboard' && <LeaderboardView history={history} />}

      {/* Filters */}
      {view === 'list' && history.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <FilterSelect
            value={filterModel}
            onChange={setFilterModel}
            options={[{ value: 'all', label: 'All models' }, ...models.map(m => ({ value: m, label: m }))]}
          />
          <FilterSelect
            value={filterProfile}
            onChange={setFilterProfile}
            options={[{ value: 'all', label: 'All profiles' }, ...profiles.map(p => ({ value: p as string, label: p as string }))]}
          />
          {archivedCount > 0 && (
            <button onClick={() => setShowArchived(v => !v)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors cursor-pointer ${
                showArchived ? 'border-accent/40 text-accent bg-accent/10' : 'border-border text-text-muted hover:text-text-secondary'
              }`}>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>
              {showArchived ? 'Hide archived' : `Archived (${archivedCount})`}
            </button>
          )}
          <span className="text-xs text-text-muted ml-auto">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
          <button onClick={clear} className="text-xs text-text-muted hover:text-red cursor-pointer transition-colors">Clear all</button>
        </div>
      )}

      {/* Results list */}
      {view === 'list' && loading && <div className="text-sm text-text-muted animate-pulse">Loading…</div>}
      {view === 'list' && !loading && filtered.length > 0 && (
        <div className="flex flex-col gap-2">
          {filtered.map((r, i) => (
            <ResultCard key={`${r.timestamp}-${r.profile_id ?? i}`} result={r}
              isLatest={i === 0 && filterModel === 'all' && filterProfile === 'all' && !showArchived}
              renaming={renamingId === r._db_id}
              onClick={() => setDetail(r)}
              onRename={() => r._db_id && setRenamingId(r._db_id)}
              onRenameSubmit={name => { r._db_id && patchBenchmark(r._db_id, { name }); setRenamingId(null) }}
              onRenameCancel={() => setRenamingId(null)}
              onArchive={() => r._db_id && patchBenchmark(r._db_id, { archived: !r._archived })}
              onDelete={() => r._db_id && apiRequest(`/settings/benchmarks/${r._db_id}`, { method: 'DELETE' }).then(() => setHistory(prev => prev.filter(x => x._db_id !== r._db_id))).catch(() => {})}
            />
          ))}
        </div>
      )}
      {view === 'list' && !loading && history.length === 0 && (
        <div className="text-center text-text-muted py-12 text-sm">
          No results yet — load a model and run your first benchmark.
        </div>
      )}

      {showRun && (
        <RunBenchmarkModal
          onClose={() => setShowRun(false)}
          onResults={results => setHistory(prev => [...(results as unknown as BenchResult[]), ...prev])}
        />
      )}

      {/* Detail modal */}
      {detail && (
        <DetailModal result={detail} onClose={() => setDetail(null)}
          onCopy={() => copy(detail)} copied={copied} />
      )}
    </div>
  )
}

function ResultCard({ result: r, isLatest, renaming, onClick, onRename, onRenameSubmit, onRenameCancel, onArchive, onDelete }: {
  result: BenchResult; isLatest: boolean; renaming: boolean
  onClick: () => void; onRename: () => void
  onRenameSubmit: (name: string) => void; onRenameCancel: () => void
  onArchive: () => void; onDelete: () => void
}): React.ReactElement {
  const { open: openCtx } = useContextMenu()
  const [renameVal, setRenameVal] = useState(r._name || r.model_name)
  const inputRef = useRef<HTMLInputElement>(null)
  const date = new Date(r.timestamp * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  useEffect(() => {
    if (renaming) {
      setRenameVal(r._name || r.model_name)
      setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0)
    }
  }, [renaming, r._name, r.model_name])

  const handleCtx = (e: React.MouseEvent): void => {
    openCtx(e, [
      { label: 'Rename', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>, onClick: onRename },
      { label: r._archived ? 'Unarchive' : 'Archive', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>, onClick: onArchive },
      { label: '', separator: true, onClick: () => {} },
      { label: 'Delete', danger: true, icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>, onClick: onDelete },
    ])
  }

  const displayName = r._name || r.model_name

  return (
    <div onContextMenu={handleCtx}
      className={`w-full bg-surface border rounded-md px-4 py-3 hover:bg-elevated transition-colors ${
        isLatest ? 'border-accent/30' : r._archived ? 'border-border/40 opacity-60' : 'border-border'
      }`}>
      {renaming ? (
        <input ref={inputRef} value={renameVal} onChange={e => setRenameVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onRenameSubmit(renameVal.trim() || displayName); if (e.key === 'Escape') onRenameCancel() }}
          onBlur={() => onRenameSubmit(renameVal.trim() || displayName)}
          className="w-full bg-elevated border border-accent/50 rounded-sm px-2 py-1 text-sm text-text-primary outline-none"
        />
      ) : (
        <button onClick={onClick} className="w-full text-left">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                {isLatest && <span className="text-2xs text-accent font-semibold uppercase tracking-widest">latest</span>}
                {r._archived && <span className="text-2xs text-text-muted bg-overlay px-1.5 py-px rounded">archived</span>}
                <span className="text-sm font-medium text-text-primary truncate">{displayName}</span>
                {r._name && r._name !== r.model_name && <span className="text-2xs text-text-muted/60 truncate">{r.model_name}</span>}
                {r.profile_name && <span className="text-2xs text-text-muted bg-overlay px-1.5 py-px rounded flex-shrink-0">{r.profile_name}</span>}
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span>{r.gpu_short}</span>
                <span className="text-text-muted/40">·</span>
                <span className={`px-1.5 py-px rounded text-2xs ${r.engine === 'vllm' ? 'bg-blue/15 text-blue' : 'bg-accent/15 text-accent'}`}>
                  {r.engine === 'vllm' ? 'vLLM' : 'llama.cpp'}
                </span>
                <span className="text-text-muted/40">·</span>
                <span>{date}</span>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="text-right">
                <div className="text-xs text-text-muted">TTFT</div>
                <div className="text-sm font-mono font-medium text-text-primary">{r.ttft_ms ? `${r.ttft_ms}ms` : '—'}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-text-muted">tokens</div>
                <div className="text-sm font-mono font-medium text-text-primary">{r.tokens_generated}</div>
              </div>
              <div className="text-right min-w-[56px]">
                <div className={`text-xl font-bold font-mono ${speedColor(r.tok_per_sec)}`}>{r.tok_per_sec}</div>
                <div className="text-2xs text-text-muted">tok/s</div>
              </div>
            </div>
          </div>
        </button>
      )}
    </div>
  )
}

function DetailModal({ result: r, onClose, onCopy, copied }: {
  result: BenchResult; onClose: () => void; onCopy: () => void; copied: boolean
}): React.ReactElement {
  const date = new Date(r.timestamp * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
  const engineLabel = r.engine === 'vllm' ? 'vLLM' : 'llama.cpp'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0f0f12] rounded-xl w-full max-w-[500px] max-h-[92vh] overflow-y-auto shadow-2xl mx-4 mb-4 sm:mb-0">

        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-[#0f0f12]/95 backdrop-blur-sm px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-2xs font-semibold text-white/50">{engineLabel}</span>
            <span className="text-white/20">·</span>
            <span className="text-sm font-medium text-white truncate">{r.model_name}</span>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/6 text-text-muted hover:text-text-primary transition-colors cursor-pointer flex-shrink-0">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="px-5 pb-5 flex flex-col gap-4">

          {/* Hero */}
          <div className="rounded-xl bg-white/[0.03] p-5">
            <div className="flex items-end justify-between mb-5">
              <div>
                <div className={`text-5xl font-black font-mono tracking-tight ${speedColor(r.tok_per_sec)}`}>
                  {r.tok_per_sec}
                </div>
                <div className="text-xs text-white/50 mt-1.5">tokens / second — decode</div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-md ${
                  r.tok_per_sec >= 60 ? 'bg-green/12 text-green' :
                  r.tok_per_sec >= 30 ? 'bg-yellow/12 text-yellow' : 'bg-red/12 text-red'
                }`}>{speedLabel(r.tok_per_sec)}</span>
                <span className="text-2xs text-white/40">{date}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <HeroStat label="TTFT" value={r.ttft_ms ? `${r.ttft_ms}ms` : '—'} sub="first token" />
              <HeroStat label="Total" value={`${(r.total_ms / 1000).toFixed(2)}s`} sub="wall time" />
              <HeroStat label="Tokens" value={String(r.tokens_generated)} sub="generated" />
            </div>
          </div>

          {/* Grid 2 col */}
          <div className="grid grid-cols-2 gap-3">
            <InfoCard title="Throughput">
              <InfoRow label="Decode" value={`${r.tok_per_sec} tok/s`} highlight />
              <InfoRow label="Out tokens" value={String(r.tokens_generated)} />
              {r.thinking_tokens != null && <InfoRow label="Think tokens" value={String(r.thinking_tokens)} muted />}
              <InfoRow label="In tokens" value={`~${r.prompt_tokens}`} muted />
            </InfoCard>
            <InfoCard title="Hardware">
              <InfoRow label="GPU" value={r.gpu_short || r.gpu_name} />
              <InfoRow label="VRAM" value={`${r.vram_total_gb} GB`} />
              <InfoRow label="Used" value={r.vram_used_gb != null ? `${r.vram_used_gb} GB` : '—'} />
              <InfoRow label="Util" value={r.gpu_util_pct != null ? `${r.gpu_util_pct}%` : '—'} />
            </InfoCard>
          </div>

          {/* Engine */}
          <InfoCard title={`${engineLabel}  ${r.engine_version || ''}`}>
            {r.engine === 'llama' && r.engine_params && (
              <div className="grid grid-cols-2 gap-x-6">
                <InfoRow label="n_ctx" value={String(r.engine_params.n_ctx ?? '—')} />
                <InfoRow label="n_batch" value={String(r.engine_params.n_batch ?? 512)} />
                <InfoRow label="GPU layers" value={r.engine_params.n_gpu_layers === -1 ? 'All' : String(r.engine_params.n_gpu_layers ?? '—')} />
                <InfoRow label="Flash Attn" value={r.engine_params.flash_attn ? 'On' : 'Off'} highlight={r.engine_params.flash_attn} />
              </div>
            )}
            {r.engine === 'vllm' && r.engine_params && (
              <div className="grid grid-cols-2 gap-x-6">
                <InfoRow label="max_model_len" value={String(r.engine_params.max_model_len ?? '—')} />
                {r.engine_params.gpu_memory_utilization != null && (
                  <InfoRow label="GPU util cap" value={`${Math.round(r.engine_params.gpu_memory_utilization * 100)}%`} />
                )}
              </div>
            )}
          </InfoCard>

          {/* Bench config */}
          <InfoCard title="Benchmark config">
            <div className="grid grid-cols-2 gap-x-6 mb-3">
              <InfoRow label="Max tokens" value={r.bench_max_tokens != null ? String(r.bench_max_tokens) : '—'} />
              <InfoRow label="Temperature" value={r.bench_temperature != null ? String(r.bench_temperature) : '—'} />
            </div>
            {r.bench_prompt && (
              <div className="bg-black/20 rounded-lg px-3 py-2.5 text-xs text-white/60 leading-relaxed italic">
                "{r.bench_prompt}"
              </div>
            )}
          </InfoCard>

          {/* Generated response */}
          {r.generated_text && (
            <InfoCard title="Model response">
              <div className="text-xs text-white/75 leading-relaxed whitespace-pre-wrap font-mono bg-black/20 rounded-lg px-3 py-3 max-h-64 overflow-y-auto">
                {r.generated_text}
              </div>
            </InfoCard>
          )}

          {/* Copy */}
          <button onClick={onCopy}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-white/4 hover:bg-white/8 rounded-lg text-sm text-white/60 hover:text-white/90 cursor-pointer transition-colors">
            {copied ? (
              <><svg className="w-3.5 h-3.5 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>Copied!</>
            ) : (
              <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy & share</>
            )}
          </button>

        </div>
      </div>
    </div>
  )
}

function HeroStat({ label, value, sub }: { label: string; value: string; sub: string }): React.ReactElement {
  return (
    <div className="bg-black/20 rounded-lg px-3 py-2.5 text-center">
      <div className="text-2xs text-white/40 uppercase tracking-widest mb-1">{label}</div>
      <div className="text-sm font-bold font-mono text-white">{value}</div>
      <div className="text-2xs text-white/40 mt-0.5">{sub}</div>
    </div>
  )
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="bg-white/[0.025] rounded-xl p-4">
      <div className="text-2xs font-semibold uppercase tracking-widest text-white/90 mb-3">{title}</div>
      {children}
    </div>
  )
}

function InfoRow({ label, value, highlight, muted }: {
  label: string; value: string; highlight?: boolean; muted?: boolean
}): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between py-0.5 gap-2">
      <span className="text-xs text-white/50 flex-shrink-0">{label}</span>
      <span className={`text-xs font-mono font-medium truncate ${
        highlight ? 'text-white' : muted ? 'text-white/40' : 'text-white/80'
      }`}>{value}</span>
    </div>
  )
}

function FilterSelect({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-1.5 bg-elevated hover:bg-overlay border border-border rounded-md text-xs text-text-secondary cursor-pointer transition-colors min-w-[120px] justify-between">
        <span className="truncate">{selected.label}</span>
        <svg className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-elevated border border-border rounded-md shadow-xl py-1 min-w-full">
          {options.map(o => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                o.value === value
                  ? 'text-accent bg-accent/10'
                  : 'text-text-secondary hover:bg-overlay hover:text-text-primary'
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
