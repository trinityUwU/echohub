import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import type { ModelInfo } from '@/types'

const CUDA_GRAPH_OVERHEAD_GB = 1.1
const CONTEXT_PRESETS = [2048, 4096, 8192, 16384, 32768, 65536, 131072]

interface Props {
  model: ModelInfo
  vramTotalGb: number
  vramUsedGb: number
  onConfirm: (config: { maxModelLen: number; gpuMemoryUtilization: number }) => void
  onCancel: () => void
}

export function LoadConfigModal({ model, vramTotalGb, vramUsedGb, onConfirm, onCancel }: Props) {
  const maxCtx = model.max_context_window ?? 131072
  const [maxModelLen, setMaxModelLen] = useState(Math.min(4096, maxCtx))
  const [gpuUtil, setGpuUtil] = useState(0.75)

  const { totalNeededGb, vllmClaimedGb, isOom, weightsGb, kvCacheGb } = useMemo(() => {
    const weights = model.vram_estimate_gb ?? 0
    const kv = model.params_billion ? model.params_billion * 0.000016 * maxModelLen : 0
    const total = weights + kv + CUDA_GRAPH_OVERHEAD_GB
    const claimed = vramTotalGb * gpuUtil
    return { totalNeededGb: total, vllmClaimedGb: claimed, isOom: total > claimed, weightsGb: weights, kvCacheGb: kv }
  }, [model, maxModelLen, gpuUtil, vramTotalGb])

  const availablePresets = CONTEXT_PRESETS.filter(p => p <= maxCtx)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-md bg-surface-1 border border-white/[0.08] rounded-2xl p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold mb-1">Load Model</h2>
        <p className="text-2xs text-muted/60 font-mono mb-5 truncate">{model.id}</p>

        <div className="space-y-4">
          <div>
            <label className="text-2xs text-muted/50 uppercase tracking-wider mb-2 block">Context Length</label>
            <div className="flex flex-wrap gap-1.5">
              {availablePresets.map(p => (
                <button
                  key={p}
                  onClick={() => setMaxModelLen(p)}
                  className={`text-2xs font-mono px-2.5 py-1 rounded-md border transition-colors ${
                    maxModelLen === p
                      ? 'bg-accent/20 text-accent border-accent/40'
                      : 'bg-surface-2 text-muted/60 border-white/[0.05] hover:text-white'
                  }`}
                >
                  {p >= 1024 ? `${p / 1024}K` : p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-2xs text-muted/50 uppercase tracking-wider">GPU Memory</label>
              <span className="text-2xs font-mono text-white/50">{Math.round(gpuUtil * 100)}%</span>
            </div>
            <input
              type="range"
              min={40}
              max={95}
              value={gpuUtil * 100}
              onChange={e => setGpuUtil(Number(e.target.value) / 100)}
              className="w-full h-1 bg-surface-3 rounded-full appearance-none cursor-pointer accent-accent"
            />
          </div>

          <div>
            <label className="text-2xs text-muted/50 uppercase tracking-wider mb-2 block">VRAM Estimate</label>
            <div className="w-full h-5 rounded overflow-hidden bg-surface-0 relative flex">
              <div
                className="h-full bg-blue-500/30"
                style={{ width: `${(weightsGb / vllmClaimedGb) * 100}%` }}
              />
              <div
                className="h-full bg-violet-500/30"
                style={{ width: `${(kvCacheGb / vllmClaimedGb) * 100}%` }}
              />
              <div
                className="h-full bg-orange-500/30"
                style={{ width: `${(CUDA_GRAPH_OVERHEAD_GB / vllmClaimedGb) * 100}%` }}
              />
            </div>
            <div className="flex gap-3 mt-1.5 text-[10px] text-muted/40">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500/30" />Weights</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-500/30" />KV Cache</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-500/30" />Overhead</span>
            </div>
            <p className="text-2xs text-muted/40 mt-1">
              {totalNeededGb.toFixed(1)} GB needed / {vllmClaimedGb.toFixed(1)} GB claimed ({(vramTotalGb - vramUsedGb).toFixed(1)} GB free)
            </p>
          </div>

          {isOom && (
            <div className="bg-red-500/[0.06] border border-red-500/20 rounded-lg px-3 py-2">
              <p className="text-2xs text-red-400">Estimated VRAM exceeds allocated GPU memory. Loading may fail or use CPU offload.</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-surface-2 text-sm text-muted/70 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ maxModelLen, gpuMemoryUtilization: gpuUtil })}
            className="flex-1 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-dim transition-colors"
          >
            Load
          </button>
        </div>
      </motion.div>
    </div>
  )
}
