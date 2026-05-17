import { useState } from 'react'
import { runBenchmark } from '@/api/client'

interface BenchResult {
  model_id: string; model_name: string; engine: string | null
  tokens_generated: number; tok_per_sec: number; ttft_ms: number | null
  total_ms: number; gpu_name: string; vram_total_gb: number
  timestamp: number; share_text: string
}

const STORAGE_KEY = 'echohub:benchmarks'

function loadHistory(): BenchResult[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}
function saveHistory(h: BenchResult[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(0, 20)))
}

export function BenchmarkTab(): React.ReactElement {
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<BenchResult[]>(loadHistory)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  const run = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      const result = await runBenchmark()
      const updated = [result, ...history]
      setHistory(updated)
      saveHistory(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const copy = (result: BenchResult): void => {
    navigator.clipboard.writeText(result.share_text)
    setCopied(result.timestamp)
    setTimeout(() => setCopied(null), 2000)
  }

  const clear = (): void => {
    setHistory([])
    saveHistory([])
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Header + run */}
      <div>
        <h2 className="text-[15px] font-semibold text-text-primary mb-1">Benchmark</h2>
        <p className="text-sm text-text-muted mb-4 leading-relaxed">
          Measure your model's real throughput — tokens per second and time to first token.
          Run anytime with any loaded model. Results are saved locally.
        </p>
        <div className="flex items-center gap-3">
          <button onClick={run} disabled={running}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-sm cursor-pointer transition-colors">
            {running ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Running…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Run benchmark
              </>
            )}
          </button>
          {running && (
            <span className="text-xs text-text-muted animate-pulse">
              Generating ~200 tokens with temperature=0…
            </span>
          )}
        </div>
        {error && (
          <div className="mt-3 text-xs text-red bg-red/8 border border-red/20 rounded-sm px-3 py-2">
            {error.includes('No model loaded') ? 'Load a model first to run a benchmark.' : error}
          </div>
        )}
      </div>

      {/* Results */}
      {history.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-text-muted">
              Results ({history.length})
            </div>
            <button onClick={clear} className="text-xs text-text-muted hover:text-red cursor-pointer transition-colors">
              Clear history
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {history.map((r, i) => (
              <ResultCard key={r.timestamp} result={r} isLatest={i === 0}
                onCopy={() => copy(r)} copied={copied === r.timestamp} />
            ))}
          </div>
        </div>
      )}

      {history.length === 0 && !running && !error && (
        <div className="text-center text-text-muted py-12 text-sm">
          No results yet — load a model and run your first benchmark.
        </div>
      )}
    </div>
  )
}

function ResultCard({ result, isLatest, onCopy, copied }: {
  result: BenchResult; isLatest: boolean; onCopy: () => void; copied: boolean
}): React.ReactElement {
  const date = new Date(result.timestamp * 1000).toLocaleString()
  const speedColor = result.tok_per_sec >= 60 ? 'text-green' : result.tok_per_sec >= 30 ? 'text-yellow' : 'text-red'

  return (
    <div className={`bg-surface border rounded-md p-4 ${isLatest ? 'border-accent/30' : 'border-border'}`}>
      {isLatest && (
        <div className="text-2xs text-accent font-semibold uppercase tracking-widest mb-2">Latest</div>
      )}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="text-sm font-semibold text-text-primary">{result.model_name}</div>
          <div className="text-xs text-text-muted mt-0.5">
            {result.gpu_name} · {result.vram_total_gb} GB VRAM
            {result.engine && (
              <span className={`ml-2 px-1.5 py-px rounded text-2xs ${
                result.engine === 'vllm' ? 'bg-blue/15 text-blue' : 'bg-accent/15 text-accent'
              }`}>
                {result.engine === 'vllm' ? 'vLLM' : 'llama.cpp'}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold font-mono ${speedColor}`}>
            {result.tok_per_sec}
          </div>
          <div className="text-xs text-text-muted">tok/s</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
        <Stat label="Time to first token" value={result.ttft_ms ? `${result.ttft_ms}ms` : '—'} />
        <Stat label="Total time" value={`${(result.total_ms / 1000).toFixed(1)}s`} />
        <Stat label="Tokens generated" value={String(result.tokens_generated)} />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{date}</span>
        <button onClick={onCopy}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-sm border border-border hover:bg-overlay text-text-secondary cursor-pointer transition-colors">
          {copied ? (
            <><svg className="w-3 h-3 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
          ) : (
            <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy & share</>
          )}
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="bg-elevated border border-border rounded-sm p-2.5">
      <div className="text-text-muted mb-0.5">{label}</div>
      <div className="font-mono font-semibold text-text-primary">{value}</div>
    </div>
  )
}
