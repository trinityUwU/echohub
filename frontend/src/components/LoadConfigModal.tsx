import { useState, useMemo } from 'react'
import type { ModelInfo } from '@/types'

interface LoadConfig {
  maxModelLen: number
  gpuMemoryUtilization: number
}

interface Props {
  model: ModelInfo
  vramTotalGb: number
  vramUsedGb: number
  onConfirm: (config: LoadConfig) => void
  onCancel: () => void
}

const CONTEXT_PRESETS = [2048, 4096, 8192, 16384, 32768, 65536, 131072]

function fmt(n: number): string {
  if (n >= 1024) return `${(n / 1024).toFixed(0)}K`
  return String(n)
}

// KV cache scales linearly with context: each token needs 2 × layers × heads × head_dim × 2 bytes
// Approximation validated empirically: params_B × 0.000016 × ctx_tokens ≈ KV cache GB
function estimateKvCacheGb(paramsBillion: number, ctxTokens: number): number {
  return paramsBillion * 0.000016 * ctxTokens
}

// vLLM 0.21+ profiles CUDA graphs by default — takes ~1.1 GB before KV cache allocation
// Source: "gpu-memory-utilization=0.70 is equivalent to 0.6083 without CUDA graph memory profiling"
const CUDA_GRAPH_OVERHEAD_GB = 1.1

export function LoadConfigModal({ model, vramTotalGb, vramUsedGb, onConfirm, onCancel }: Props) {
  const maxCtx = model.max_context_window ?? 4096
  const defaultCtx = Math.min(4096, maxCtx)

  const [maxModelLen, setMaxModelLen] = useState(defaultCtx)
  const [gpuUtil, setGpuUtil] = useState(0.75)

  const vramFreeGb = vramTotalGb - vramUsedGb
  const weightsGb = model.vram_estimate_gb ?? 0
  const kvCacheGb = model.params_billion ? estimateKvCacheGb(model.params_billion, maxModelLen) : 0
  // CUDA graph profiling in vLLM 0.21+ takes ~1.1 GB before KV cache
  const totalNeededGb = weightsGb + kvCacheGb + CUDA_GRAPH_OVERHEAD_GB
  // GPU util also determines how much of total VRAM vLLM claims at startup
  const vllmClaimedGb = vramTotalGb * gpuUtil
  // Must satisfy both: enough free VRAM at startup AND enough for weights+KV+cuda_graphs
  const pctOfFree = vramFreeGb > 0 ? (vllmClaimedGb / vramFreeGb) * 100 : 999
  const pctOfClaimed = vllmClaimedGb > 0 ? (totalNeededGb / vllmClaimedGb) * 100 : 999
  const overallPct = Math.max(pctOfFree, pctOfClaimed)

  const warning = useMemo(() => {
    if (maxModelLen > (model.max_context_window ?? Infinity)) return {
      level: 'error' as const,
      msg: `Context ${fmt(maxModelLen)} exceeds model max (${fmt(model.max_context_window!)}). vLLM will reject this.`,
    }
    if (pctOfFree > 115) return {
      level: 'error' as const,
      msg: `vLLM would claim ${vllmClaimedGb.toFixed(1)} GB but only ${vramFreeGb.toFixed(1)} GB free — startup will fail.`,
    }
    if (totalNeededGb > vllmClaimedGb) return {
      level: 'error' as const,
      msg: `Weights (${weightsGb.toFixed(1)} GB) + KV cache (${kvCacheGb.toFixed(1)} GB) = ${totalNeededGb.toFixed(1)} GB exceeds allocated ${vllmClaimedGb.toFixed(1)} GB — OOM guaranteed.`,
    }
    if (pctOfClaimed > 90) return {
      level: 'warn' as const,
      msg: `Tight fit — ${totalNeededGb.toFixed(1)} GB needed vs ${vllmClaimedGb.toFixed(1)} GB allocated. Reduce context or increase GPU util.`,
    }
    if (pctOfFree > 90) return {
      level: 'warn' as const,
      msg: `Claiming ${vllmClaimedGb.toFixed(1)} GB of ${vramFreeGb.toFixed(1)} GB free VRAM — very tight startup margin.`,
    }
    return null
  }, [pctOfFree, pctOfClaimed, totalNeededGb, vllmClaimedGb, vramFreeGb, weightsGb, kvCacheGb, maxModelLen, model.max_context_window])

  const availablePresets = CONTEXT_PRESETS.filter(p => p <= maxCtx)
  if (!availablePresets.includes(maxCtx)) availablePresets.push(maxCtx)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md bg-surface-1 border border-border rounded-2xl p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-sm font-semibold text-white">Load model</h2>
            <p className="text-xs text-muted mt-0.5 truncate max-w-xs">{model.name}</p>
          </div>
          <button onClick={onCancel} className="text-muted hover:text-white text-lg leading-none">✕</button>
        </div>

        {/* Context window */}
        <div className="mb-5">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white">Context window</label>
            <span className="text-xs font-mono text-accent">{fmt(maxModelLen)} tokens</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {availablePresets.map(p => (
              <button
                key={p}
                onClick={() => setMaxModelLen(p)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  maxModelLen === p
                    ? 'bg-accent/20 text-accent border-accent/40'
                    : 'bg-surface-3 text-muted border-border hover:text-white'
                }`}
              >
                {fmt(p)}
              </button>
            ))}
          </div>
          {model.max_context_window && (
            <p className="text-xs text-muted">Model max: {fmt(model.max_context_window)} tokens</p>
          )}
        </div>

        {/* GPU utilization */}
        <div className="mb-5">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white">GPU memory utilization</label>
            <span className="text-xs font-mono text-accent">{Math.round(gpuUtil * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.4}
            max={0.92}
            step={0.01}
            value={gpuUtil}
            onChange={e => setGpuUtil(parseFloat(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-xs text-muted mt-1">
            <span>40%</span>
            <span>{vramFreeGb.toFixed(1)} GB free / {vramTotalGb.toFixed(1)} GB total</span>
            <span>92%</span>
          </div>

          {/* VRAM breakdown bar — stacked: weights + KV cache */}
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted">VRAM estimate</span>
              <span className={
                totalNeededGb > vllmClaimedGb ? 'text-red-400' :
                overallPct > 90 ? 'text-yellow-400' : 'text-emerald-400'
              }>
                {totalNeededGb.toFixed(2)} GB / {vllmClaimedGb.toFixed(1)} GB allocated
              </span>
            </div>
            <div className="w-full h-3 bg-surface-3 rounded-full overflow-hidden flex">
              {/* Weights segment */}
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${Math.min((weightsGb / vramTotalGb) * 100, 100)}%` }}
                title={`Weights: ~${weightsGb.toFixed(2)} GB`}
              />
              {/* KV cache segment */}
              <div
                className="h-full bg-violet-500 transition-all"
                style={{ width: `${Math.min((kvCacheGb / vramTotalGb) * 100, 100)}%` }}
                title={`KV cache: ~${kvCacheGb.toFixed(2)} GB`}
              />
              {/* CUDA graph overhead segment */}
              <div
                className="h-full bg-orange-500/70 transition-all"
                style={{ width: `${Math.min((CUDA_GRAPH_OVERHEAD_GB / vramTotalGb) * 100, 100)}%` }}
                title={`CUDA graphs: ~${CUDA_GRAPH_OVERHEAD_GB.toFixed(1)} GB`}
              />
              {/* Overflow indicator */}
              {totalNeededGb > vllmClaimedGb && (
                <div className="h-full bg-red-500 flex-1" title="Overflow — OOM" />
              )}
            </div>
            <div className="flex gap-3 text-xs text-muted flex-wrap">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" />
                Weights ~{weightsGb.toFixed(1)} GB
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-violet-500 inline-block" />
                KV ~{kvCacheGb.toFixed(1)} GB
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm bg-orange-500/70 inline-block" />
                CUDA ~{CUDA_GRAPH_OVERHEAD_GB.toFixed(1)} GB
              </span>
              <span className="flex items-center gap-1 ml-auto">
                Alloc: {vllmClaimedGb.toFixed(1)} GB
              </span>
            </div>
          </div>
        </div>

        {/* Warning */}
        {warning && (
          <div className={`mb-4 p-3 rounded-xl text-xs border ${
            warning.level === 'error'
              ? 'bg-red-500/10 text-red-300 border-red-500/20'
              : 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20'
          }`}>
            {warning.level === 'error' ? '⚠️ ' : '⚡ '}{warning.msg}
          </div>
        )}

        {/* Info row */}
        <div className="flex gap-3 text-xs text-muted mb-5">
          {model.params_billion && <span>{model.params_billion}B params</span>}
          {model.quantization && <span>{model.quantization}</span>}
          {model.vram_estimate_gb && <span>~{model.vram_estimate_gb} GB needed</span>}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 text-sm py-2 rounded-xl bg-surface-3 text-muted border border-border hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ maxModelLen, gpuMemoryUtilization: gpuUtil })}
            className={`flex-1 text-sm py-2 rounded-xl border transition-colors ${
              warning?.level === 'error'
                ? 'bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30'
                : 'bg-accent/20 text-accent border-accent/30 hover:bg-accent/30'
            }`}
          >
            {warning?.level === 'error' ? 'Load anyway' : 'Load model'}
          </button>
        </div>
      </div>
    </div>
  )
}
