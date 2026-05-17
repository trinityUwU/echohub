import { useState, useEffect, useMemo } from 'react'
import { apiRequest } from '@/api/base'
import { RunBenchmarkModal } from './RunBenchmarkModal'

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
  timestamp: number; share_text: string; _db_id?: number
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
  const [filterModel, setFilterModel] = useState<string>('all')
  const [filterProfile, setFilterProfile] = useState<string>('all')

  useEffect(() => {
    apiRequest<BenchResult[]>('/settings/benchmarks')
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const models = useMemo(() => Array.from(new Set(history.map(r => r.model_name))), [history])
  const profiles = useMemo(() => Array.from(new Set(history.map(r => r.profile_name).filter(Boolean))), [history])

  const filtered = useMemo(() => history.filter(r => {
    if (filterModel !== 'all' && r.model_name !== filterModel) return false
    if (filterProfile !== 'all' && r.profile_name !== filterProfile) return false
    return true
  }), [history, filterModel, filterProfile])

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
        <p className="text-sm text-text-muted leading-relaxed">
          Select profiles and run. Click any result for full details.
        </p>
        <button onClick={() => setShowRun(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md cursor-pointer transition-colors flex-shrink-0">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Run benchmark
        </button>
      </div>

      {/* Filters */}
      {history.length > 0 && (
        <div className="flex items-center gap-2">
          <select value={filterModel} onChange={e => setFilterModel(e.target.value)}
            className="bg-elevated border border-border rounded-sm px-2.5 py-1.5 text-xs text-text-secondary outline-none cursor-pointer">
            <option value="all">All models</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={filterProfile} onChange={e => setFilterProfile(e.target.value)}
            className="bg-elevated border border-border rounded-sm px-2.5 py-1.5 text-xs text-text-secondary outline-none cursor-pointer">
            <option value="all">All profiles</option>
            {profiles.map(p => <option key={p} value={p as string}>{p}</option>)}
          </select>
          <span className="text-xs text-text-muted ml-auto">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
          <button onClick={clear} className="text-xs text-text-muted hover:text-red cursor-pointer transition-colors">Clear all</button>
        </div>
      )}

      {/* Results list */}
      {loading && <div className="text-sm text-text-muted animate-pulse">Loading…</div>}
      {!loading && filtered.length > 0 && (
        <div className="flex flex-col gap-2">
          {filtered.map((r, i) => (
            <ResultCard key={`${r.timestamp}-${r.profile_id ?? i}`} result={r} isLatest={i === 0 && filterModel === 'all' && filterProfile === 'all'}
              onClick={() => setDetail(r)} />
          ))}
        </div>
      )}
      {!loading && history.length === 0 && (
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

function ResultCard({ result: r, isLatest, onClick }: {
  result: BenchResult; isLatest: boolean; onClick: () => void
}): React.ReactElement {
  const date = new Date(r.timestamp * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <button onClick={onClick}
      className={`w-full text-left bg-surface border rounded-md px-4 py-3 hover:bg-elevated transition-colors cursor-pointer ${
        isLatest ? 'border-accent/30' : 'border-border'
      }`}>
      <div className="flex items-center gap-3">
        {/* Left */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {isLatest && <span className="text-2xs text-accent font-semibold uppercase tracking-widest">latest</span>}
            <span className="text-sm font-medium text-text-primary truncate">{r.model_name}</span>
            {r.profile_name && <span className="text-2xs text-text-muted bg-overlay px-1.5 py-px rounded flex-shrink-0">{r.profile_name}</span>}
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{r.gpu_short}</span>
            <span className="text-text-muted/40">·</span>
            <span className={`px-1.5 py-px rounded text-2xs ${
              r.engine === 'vllm' ? 'bg-blue/15 text-blue' : 'bg-accent/15 text-accent'
            }`}>
              {r.engine === 'vllm' ? 'vLLM' : 'llama.cpp'}
            </span>
            <span className="text-text-muted/40">·</span>
            <span>{date}</span>
          </div>
        </div>

        {/* Metrics */}
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <div className="text-xs text-text-muted">TTFT</div>
            <div className="text-sm font-mono font-medium text-text-primary">
              {r.ttft_ms ? `${r.ttft_ms}ms` : '—'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-text-muted">tokens</div>
            <div className="text-sm font-mono font-medium text-text-primary">{r.tokens_generated}</div>
          </div>
          <div className="text-right min-w-[56px]">
            <div className={`text-xl font-bold font-mono ${speedColor(r.tok_per_sec)}`}>
              {r.tok_per_sec}
            </div>
            <div className="text-2xs text-text-muted">tok/s</div>
          </div>
        </div>
      </div>
    </button>
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
