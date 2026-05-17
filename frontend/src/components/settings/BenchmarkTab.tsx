import { useState } from 'react'
import { runBenchmark } from '@/api/client'

interface EngineParams {
  n_ctx?: number; n_batch?: number; n_gpu_layers?: number; flash_attn?: boolean
  max_model_len?: number; gpu_memory_utilization?: number | null; enforce_eager?: boolean
}

interface BenchResult {
  model_id: string; model_name: string; engine: string | null; engine_version: string
  tokens_generated: number; prompt_tokens: number
  tok_per_sec: number; prefill_tok_per_sec: number | null
  ttft_ms: number | null; prefill_ms: number | null; decode_ms: number; total_ms: number
  gpu_name: string; gpu_short: string; vram_total_gb: number
  vram_used_gb: number | null; gpu_util_pct: number | null
  engine_params: EngineParams
  bench_prompt: string; bench_max_tokens: number; bench_temperature: number
  timestamp: number; share_text: string
}

const STORAGE_KEY = 'echohub:benchmarks_v3'

function loadHistory(): BenchResult[] {
  // Clear old keys from previous formats
  localStorage.removeItem('echohub:benchmarks')
  localStorage.removeItem('echohub:benchmarks_v2')
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    // Filter out entries missing required v3 fields
    return raw.filter((r: BenchResult) => r.engine_version !== undefined && r.decode_ms !== undefined)
  } catch { return [] }
}
function saveHistory(h: BenchResult[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(0, 20)))
}

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
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<BenchResult[]>(loadHistory)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<BenchResult | null>(null)
  const [copied, setCopied] = useState(false)

  const run = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      const result = await runBenchmark() as unknown as BenchResult
      const updated = [result, ...history]
      setHistory(updated)
      saveHistory(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const clear = (): void => { setHistory([]); saveHistory([]) }

  const copy = (r: BenchResult): void => {
    navigator.clipboard.writeText(r.share_text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div>
        <p className="text-sm text-text-muted mb-4 leading-relaxed">
          Standardized benchmark — greedy decoding, {200} tokens, temperature 0. Click any result for full details.
        </p>
        <div className="flex items-center gap-3">
          <button onClick={run} disabled={running}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-sm cursor-pointer transition-colors">
            {running ? (
              <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Running…</>
            ) : (
              <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>Run benchmark</>
            )}
          </button>
          {running && <span className="text-xs text-text-muted animate-pulse">Generating ~200 tokens…</span>}
        </div>
        {error && (
          <div className="mt-3 text-xs text-red bg-red/8 border border-red/20 rounded-sm px-3 py-2">
            {error.includes('No model loaded') ? 'Load a model first.' : error}
          </div>
        )}
      </div>

      {/* Results list */}
      {history.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-text-muted">
              Results ({history.length})
            </span>
            <button onClick={clear} className="text-xs text-text-muted hover:text-red cursor-pointer transition-colors">
              Clear history
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {history.map((r, i) => (
              <ResultCard key={r.timestamp} result={r} isLatest={i === 0}
                onClick={() => setDetail(r)} />
            ))}
          </div>
        </div>
      )}

      {history.length === 0 && !running && !error && (
        <div className="text-center text-text-muted py-12 text-sm">
          No results yet — load a model and run your first benchmark.
        </div>
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
  const date = new Date(r.timestamp * 1000).toLocaleString()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface border border-border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <div className="text-sm font-semibold text-text-primary">{r.model_name}</div>
            <div className="text-xs text-text-muted mt-0.5">{date}</div>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-sm hover:bg-overlay text-text-muted hover:text-text-primary cursor-pointer transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">

          {/* Hero metric */}
          <div className="flex items-center justify-between bg-elevated border border-border rounded-md px-5 py-4">
            <div>
              <div className={`text-4xl font-bold font-mono ${speedColor(r.tok_per_sec)}`}>{r.tok_per_sec}</div>
              <div className="text-xs text-text-muted mt-0.5">tokens / second (decode)</div>
            </div>
            <div className={`text-sm font-semibold px-3 py-1 rounded-sm ${
              r.tok_per_sec >= 60 ? 'bg-green/15 text-green' :
              r.tok_per_sec >= 30 ? 'bg-yellow/15 text-yellow' : 'bg-red/15 text-red'
            }`}>
              {speedLabel(r.tok_per_sec)}
            </div>
          </div>

          {/* Timing */}
          <Section title="Timing">
            <MetricRow label="Time to first token (TTFT)" value={r.ttft_ms ? `${r.ttft_ms} ms` : '—'} note="prefill latency" />
            <MetricRow label="Decode time" value={r.decode_ms != null ? `${r.decode_ms} ms` : '—'} note={`${r.tokens_generated} tokens`} />
            <MetricRow label="Total time" value={`${(r.total_ms / 1000).toFixed(2)} s`} />
          </Section>

          {/* Throughput */}
          <Section title="Throughput">
            <MetricRow label="Decode speed" value={`${r.tok_per_sec} tok/s`} highlight />
            {r.prefill_tok_per_sec && (
              <MetricRow label="Prefill speed" value={`${r.prefill_tok_per_sec} tok/s`} note="prompt processing" />
            )}
            <MetricRow label="Tokens generated" value={String(r.tokens_generated)} />
            <MetricRow label="Prompt tokens" value={`~${r.prompt_tokens}`} note="estimated" />
          </Section>

          {/* Hardware */}
          <Section title="Hardware">
            <MetricRow label="GPU" value={r.gpu_name} />
            <MetricRow label="VRAM total" value={`${r.vram_total_gb} GB`} />
            <MetricRow label="VRAM used (at bench start)" value={r.vram_used_gb != null ? `${r.vram_used_gb} GB` : '—'} />
            <MetricRow label="GPU utilization" value={r.gpu_util_pct != null ? `${r.gpu_util_pct}%` : '—'} />
          </Section>

          {/* Engine */}
          <Section title="Engine">
            <MetricRow label="Engine" value={r.engine === 'vllm' ? 'vLLM' : 'llama.cpp'} />
            <MetricRow label="Version" value={r.engine_version || '—'} />
            {r.engine === 'llama' && r.engine_params && (
              <>
                <MetricRow label="Context length (n_ctx)" value={String(r.engine_params.n_ctx ?? '—')} />
                <MetricRow label="Batch size (n_batch)" value={String(r.engine_params.n_batch ?? 512)} />
                <MetricRow label="GPU layers" value={r.engine_params.n_gpu_layers === -1 ? 'All (full offload)' : String(r.engine_params.n_gpu_layers ?? '—')} />
                <MetricRow label="Flash Attention" value={r.engine_params.flash_attn ? 'Enabled' : 'Disabled'} />
              </>
            )}
            {r.engine === 'vllm' && r.engine_params && (
              <>
                <MetricRow label="Max model len" value={String(r.engine_params.max_model_len ?? '—')} />
                {r.engine_params.gpu_memory_utilization !== null && r.engine_params.gpu_memory_utilization !== undefined && (
                  <MetricRow label="GPU memory utilization" value={`${Math.round((r.engine_params.gpu_memory_utilization) * 100)}%`} />
                )}
              </>
            )}
          </Section>

          {/* Bench config */}
          <Section title="Benchmark config">
            <MetricRow label="Max tokens" value={r.bench_max_tokens != null ? String(r.bench_max_tokens) : '—'} />
            <MetricRow label="Temperature" value={r.bench_temperature != null ? String(r.bench_temperature) : '—'} />
            <div className="mt-2">
              <div className="text-xs text-text-muted mb-1">Prompt</div>
              <div className="bg-elevated border border-border rounded-sm px-3 py-2 text-xs text-text-secondary font-mono leading-relaxed">
                {r.bench_prompt}
              </div>
            </div>
          </Section>

        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <button onClick={onCopy}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-border rounded-sm text-sm text-text-secondary hover:bg-overlay hover:text-text-primary cursor-pointer transition-colors">
            {copied ? (
              <><svg className="w-3.5 h-3.5 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied!</>
            ) : (
              <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy & share</>
            )}
          </button>
        </div>

      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div>
      <div className="text-2xs font-semibold uppercase tracking-widest text-text-muted mb-2">{title}</div>
      <div className="bg-elevated border border-border rounded-md overflow-hidden divide-y divide-border/50">
        {children}
      </div>
    </div>
  )
}

function MetricRow({ label, value, note, highlight }: {
  label: string; value: string; note?: string; highlight?: boolean
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <span className="text-xs text-text-muted">{label}</span>
      <div className="flex items-center gap-2">
        {note && <span className="text-2xs text-text-muted/60">{note}</span>}
        <span className={`text-xs font-mono font-semibold ${highlight ? 'text-accent' : 'text-text-primary'}`}>
          {value}
        </span>
      </div>
    </div>
  )
}
