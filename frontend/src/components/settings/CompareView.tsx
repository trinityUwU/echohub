import { useState, useMemo } from 'react'

interface EngineParams {
  n_ctx?: number; n_batch?: number; n_gpu_layers?: number; flash_attn?: boolean
  max_model_len?: number; gpu_memory_utilization?: number | null
}

interface BenchResult {
  model_id: string; model_name: string; engine: string | null; engine_version: string
  profile_id?: number; profile_name?: string
  tokens_generated: number; prompt_tokens: number
  tok_per_sec: number; ttft_ms: number | null; decode_ms: number; total_ms: number
  gpu_name: string; gpu_short: string; vram_total_gb: number
  vram_used_gb: number | null; gpu_util_pct: number | null
  engine_params: EngineParams
  bench_prompt: string; bench_max_tokens: number; bench_temperature: number
  generated_text?: string; timestamp: number; _db_id?: number
}

type Layout = '1x2' | '2x2' | '2x4' | '4x4' | '4x8' | '8x8'

const LAYOUTS: { id: Layout; label: string; cols: number; rows: number }[] = [
  { id: '1x2', label: '1×2', cols: 2, rows: 1 },
  { id: '2x2', label: '2×2', cols: 2, rows: 2 },
  { id: '2x4', label: '2×4', cols: 4, rows: 2 },
  { id: '4x4', label: '4×4', cols: 4, rows: 4 },
  { id: '4x8', label: '4×8', cols: 8, rows: 4 },
  { id: '8x8', label: '8×8', cols: 8, rows: 8 },
]

interface Props {
  history: BenchResult[]
}

export function CompareView({ history }: Props): React.ReactElement {
  const [layout, setLayout] = useState<Layout>('1x2')
  const current = LAYOUTS.find(l => l.id === layout)!
  const slots = current.cols * current.rows
  const [selections, setSelections] = useState<(number | null)[]>(Array(64).fill(null))

  const select = (slot: number, idx: number | null): void => {
    setSelections(prev => { const n = [...prev]; n[slot] = idx; return n })
  }

  const selectedResults = useMemo(
    () => Array.from({ length: slots }, (_, i) => {
      const idx = selections[i]
      return idx !== null ? history[idx] ?? null : null
    }),
    [selections, slots, history]
  )

  // When layout changes, keep existing selections that still fit
  const gridCols = current.cols <= 2 ? 'grid-cols-2' :
                   current.cols <= 4 ? 'grid-cols-4' : 'grid-cols-8'

  return (
    <div className="flex flex-col gap-4">

      {/* Layout picker */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-muted">Layout</span>
        <div className="flex gap-1 bg-overlay rounded-md p-0.5">
          {LAYOUTS.map(l => (
            <button key={l.id} onClick={() => setLayout(l.id)}
              className={`px-2.5 py-1 text-xs rounded transition-colors cursor-pointer ${
                layout === l.id ? 'bg-elevated text-text-primary' : 'text-text-muted hover:text-text-secondary'
              }`}>
              {l.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-text-muted ml-auto">{slots} slots · {selectedResults.filter(Boolean).length} selected</span>
      </div>

      {/* Grid */}
      <div className={`grid ${gridCols} gap-2`}>
        {Array.from({ length: slots }, (_, i) => (
          <CompareCell
            key={i}
            slot={i}
            result={selectedResults[i]}
            baseline={selectedResults[0]}
            isBaseline={i === 0}
            history={history}
            onSelect={idx => select(i, idx)}
          />
        ))}
      </div>

    </div>
  )
}

// ── Diff helpers ─────────────────────────────────────────────────────────────

function diffNum(a: number, b: number): { delta: number; pct: number; better: boolean } {
  const delta = b - a
  const pct = a !== 0 ? (delta / a) * 100 : 0
  return { delta, pct, better: delta > 0 }
}

function DiffBadge({ a, b, higherBetter = true }: {
  a: number; b: number; higherBetter?: boolean
}): React.ReactElement {
  const { pct, better } = diffNum(a, b)
  const positive = higherBetter ? better : !better
  if (Math.abs(pct) < 0.5) return <span className="text-2xs text-white/30">≈</span>
  return (
    <span className={`text-2xs font-mono font-semibold px-1 py-px rounded ${
      positive ? 'text-green bg-green/10' : 'text-red bg-red/10'
    }`}>
      {positive ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

function MetricDiff({ label, a, b, unit = '', higherBetter = true }: {
  label: string; a: number | null | undefined; b: number | null | undefined
  unit?: string; higherBetter?: boolean
}): React.ReactElement {
  const hasA = a != null; const hasB = b != null
  return (
    <div className="flex items-center justify-between py-1 gap-2">
      <span className="text-2xs text-white/40">{label}</span>
      <div className="flex items-center gap-1.5">
        {hasA && hasB && (
          <DiffBadge a={a as number} b={b as number} higherBetter={higherBetter} />
        )}
        <span className="text-xs font-mono text-white/80">
          {hasB ? `${b}${unit}` : '—'}
        </span>
      </div>
    </div>
  )
}

// ── Cell ─────────────────────────────────────────────────────────────────────

function CompareCell({ slot, result, baseline, isBaseline, history, onSelect }: {
  slot: number
  result: BenchResult | null
  baseline: BenchResult | null
  isBaseline: boolean
  history: BenchResult[]
  onSelect: (idx: number | null) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)

  const speedColor = (tps: number) =>
    tps >= 60 ? 'text-green' : tps >= 30 ? 'text-yellow' : 'text-red'

  return (
    <div className="relative bg-white/[0.025] rounded-xl overflow-hidden min-h-[160px] flex flex-col">

      {/* Slot header */}
      <div className={`flex items-center justify-between px-3 py-2 ${
        isBaseline ? 'bg-accent/10' : 'bg-white/[0.02]'
      }`}>
        <span className="text-2xs font-semibold text-white/50 uppercase tracking-widest">
          {isBaseline ? 'Baseline' : `Run ${slot + 1}`}
        </span>
        <div className="flex items-center gap-1.5">
          {result && (
            <button onClick={() => onSelect(null)}
              className="text-2xs text-white/30 hover:text-white/60 cursor-pointer transition-colors">✕</button>
          )}
          <button onClick={() => setOpen(v => !v)}
            className="text-2xs text-accent hover:text-accent/80 cursor-pointer transition-colors">
            {result ? 'change' : '+ select'}
          </button>
        </div>
      </div>

      {/* Picker dropdown */}
      {open && (
        <div className="absolute top-8 left-0 right-0 z-20 bg-[#0f0f12] border border-white/10 rounded-b-xl shadow-2xl max-h-48 overflow-y-auto">
          <button onClick={() => { onSelect(null); setOpen(false) }}
            className="w-full text-left px-3 py-2 text-xs text-white/30 hover:bg-white/5 cursor-pointer transition-colors">
            — Clear slot
          </button>
          {history.map((r, i) => (
            <button key={i} onClick={() => { onSelect(i); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs cursor-pointer transition-colors hover:bg-white/5 border-t border-white/5">
              <div className="text-white/80 truncate">{r.model_name}</div>
              <div className="text-white/30 text-2xs mt-0.5">
                {r.profile_name ? `${r.profile_name} · ` : ''}
                {r.tok_per_sec} tok/s · {new Date(r.timestamp * 1000).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {result ? (
        <div className="flex-1 p-3 flex flex-col gap-1">
          {/* Model + profile */}
          <div className="mb-2">
            <div className="text-xs font-medium text-white/90 truncate">{result.model_name}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {result.profile_name && (
                <span className="text-2xs text-white/40 bg-white/5 px-1.5 py-px rounded">{result.profile_name}</span>
              )}
              <span className="text-2xs text-white/30">{result.engine === 'vllm' ? 'vLLM' : 'llama.cpp'}</span>
            </div>
          </div>

          {/* Hero tok/s */}
          <div className="flex items-baseline gap-2 mb-1">
            <span className={`text-2xl font-black font-mono ${speedColor(result.tok_per_sec)}`}>
              {result.tok_per_sec}
            </span>
            <span className="text-2xs text-white/30">tok/s</span>
            {!isBaseline && baseline && (
              <DiffBadge a={baseline.tok_per_sec} b={result.tok_per_sec} higherBetter />
            )}
          </div>

          {/* Diff metrics */}
          <MetricDiff label="TTFT" a={baseline?.ttft_ms} b={result.ttft_ms} unit="ms" higherBetter={false} />
          <MetricDiff label="Total" a={baseline?.total_ms} b={result.total_ms} unit="ms" higherBetter={false} />
          <MetricDiff label="Tokens" a={baseline?.tokens_generated} b={result.tokens_generated} unit="" higherBetter />

          {/* GPU */}
          <div className="mt-1 pt-1.5 border-t border-white/5">
            <div className="text-2xs text-white/30 truncate">{result.gpu_short}</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-white/20">Empty</span>
        </div>
      )}
    </div>
  )
}
