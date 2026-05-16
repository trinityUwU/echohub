import { useEffect, useState } from 'react'
import { Modal } from '@/components/shared/Modal'
import { Slider } from '@/components/shared/Slider'
import { Btn } from '@/components/shared/Btn'
import { canLoadModel } from '@/api/client'
import type { ModelInfo } from '@/types'

interface CanLoadResult {
  engine: string
  format: string
  feasible: boolean
  reason: string | null
  vram_estimate_gb: number | null
  gpu_type: string
  vllm_available: boolean
}

interface LoadModelModalProps {
  model: ModelInfo
  vramTotalGb: number
  vramUsedGb: number
  onConfirm: (cfg: { gpuMemoryUtilization: number; maxModelLen: number | null }) => void
  onCancel: () => void
}

const VLLM_CUDA_OVERHEAD_GB = 1.2  // CUDA graphs + runtime baseline
const SAFETY_MARGIN_GB      = 0.5  // buffer to avoid edge-case OOM

/**
 * KV cache estimate for vLLM.
 * Real formula: 2 * num_layers * num_heads * head_dim * ctx * dtype_bytes
 * Approximation for 7-8B models: ~0.25 GB per 8k ctx tokens
 */
function estimateKvCacheGb(ctxLen: number, paramsBillion: number): number {
  const ctxK = ctxLen / 1000
  const scale = (paramsBillion ?? 8) / 8  // scale relative to 8B baseline
  return ctxK * 0.03 * scale  // ~0.03 GB per 1k ctx tokens for 8B
}


/**
 * VRAM budget available = total * gpuUtil - alreadyUsed
 * vLLM allocates up to gpuUtil * total for its memory pool.
 */
function computeVllmBudget(vramTotalGb: number, vramUsedGb: number, gpuUtil: number): number {
  return vramTotalGb * gpuUtil - vramUsedGb
}

export function LoadModelModal({ model, vramTotalGb, vramUsedGb, onConfirm, onCancel }: LoadModelModalProps): React.ReactElement {
  const defaultCtx = Math.min(model.max_context_window ?? 16384, 16384)
  const [gpuUtil, setGpuUtil] = useState(0.80)
  const [ctxLen, setCtxLen] = useState(defaultCtx)
  const [check, setCheck] = useState<CanLoadResult | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    setChecking(true)
    canLoadModel(model.id)
      .then(setCheck)
      .catch(() => setCheck(null))
      .finally(() => setChecking(false))
  }, [model.id])

  const engine = check?.engine ?? (model.quantization?.toLowerCase().includes('gguf') ? 'llama' : 'vllm')
  const weightsGb = check?.vram_estimate_gb ?? model.vram_estimate_gb ?? 5.0
  const params = model.params_billion ?? 8

  // Real-time VRAM accounting (recalculates on every slider move)
  const kvGb      = estimateKvCacheGb(ctxLen, params)
  const totalNeed = engine === 'vllm'
    ? weightsGb + kvGb + VLLM_CUDA_OVERHEAD_GB
    : weightsGb  // llama.cpp manages its own memory
  const budget    = computeVllmBudget(vramTotalGb, vramUsedGb, gpuUtil)
  const freeAfter = Math.max(0, vramTotalGb - vramUsedGb - totalNeed)
  const isOom     = engine === 'vllm'
    ? totalNeed + SAFETY_MARGIN_GB > budget
    : totalNeed > vramTotalGb - vramUsedGb

  const canSubmit = !checking && (check?.feasible ?? false) && !isOom

  // Safe ctx max = ctx where totalNeed exactly fits budget
  const maxSafeCtx = Math.floor(
    Math.max(2048, ((budget - weightsGb - VLLM_CUDA_OVERHEAD_GB - SAFETY_MARGIN_GB) / (0.03 * params / 8)) * 1000 / 2048) * 2048
  )
  const ctxMax = engine === 'vllm'
    ? Math.min(model.max_context_window ?? 131072, Math.max(2048, maxSafeCtx))
    : Math.min(model.max_context_window ?? 131072, 131072)

  return (
    <Modal
      title="Load model"
      onClose={onCancel}
      footer={
        <>
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" disabled={!canSubmit}
            onClick={() => onConfirm({ gpuMemoryUtilization: gpuUtil, maxModelLen: ctxLen })}>
            {checking ? 'Checking…' : 'Load model'}
          </Btn>
        </>
      }
    >
      <div className="bg-elevated border border-border rounded-sm px-3 py-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">{model.name}</span>
        <span className={`text-2xs px-1.5 py-0.5 rounded ${engine === 'llama' ? 'bg-green/15 text-green' : 'bg-blue/15 text-blue'}`}>
          {engine === 'llama' ? 'llama.cpp' : 'vLLM'} · {check?.format?.toUpperCase() ?? model.quantization ?? '?'}
        </span>
      </div>

      {check && !check.feasible && (
        <div className="flex items-start gap-2 bg-red/8 border border-red/25 rounded-sm px-3 py-2.5 text-sm text-red">
          <svg className="w-4 h-4 flex-shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{check.reason}</span>
        </div>
      )}

      <VramPreview
        usedGb={vramUsedGb}
        modelGb={totalNeed}
        freeGb={freeAfter}
        totalGb={vramTotalGb}
        budgetGb={engine === 'vllm' ? budget : vramTotalGb - vramUsedGb}
        isOom={isOom}
        engine={engine}
        weightsGb={weightsGb}
        kvGb={kvGb}
      />

      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2.5">Parameters</div>
        {engine === 'vllm' && (
          <Slider label="GPU memory utilization" value={gpuUtil} min={0.5} max={0.95} step={0.01} onChange={setGpuUtil} />
        )}
        <Slider
          label="Context length"
          value={Math.min(ctxLen, ctxMax)}
          min={2048}
          max={ctxMax}
          step={2048}
          onChange={setCtxLen}
          formatValue={v => v.toLocaleString('en')}
        />
        {engine === 'vllm' && ctxMax < (model.max_context_window ?? 131072) && (
          <div className="text-xs text-yellow mt-1">
            Max safe context at {(gpuUtil * 100).toFixed(0)}% utilization: {ctxMax.toLocaleString('en')} tokens
          </div>
        )}
        {engine === 'llama' && (
          <div className="text-xs text-text-muted mt-1">
            GPU memory is managed automatically by llama.cpp
          </div>
        )}
      </div>
    </Modal>
  )
}

function VramPreview({ usedGb, modelGb, freeGb, totalGb, budgetGb, isOom, engine, weightsGb, kvGb }: {
  usedGb: number; modelGb: number; freeGb: number; totalGb: number; budgetGb: number
  isOom: boolean; engine: string; weightsGb: number; kvGb: number
}): React.ReactElement {
  const usedPct   = Math.min((usedGb  / totalGb) * 100, 100)
  const modelPct  = Math.min((modelGb / totalGb) * 100, 100 - usedPct)
  const budgetPct = Math.min((budgetGb / totalGb) * 100, 100)

  return (
    <div className="bg-elevated border border-border rounded-sm p-3">
      <div className="text-xs text-text-muted mb-2">VRAM preview</div>
      <div className="relative h-2 bg-overlay rounded overflow-hidden mb-1">
        <div className="absolute left-0 top-0 h-full bg-white/10" style={{ width: `${usedPct}%` }} />
        <div className={`absolute top-0 h-full transition-all ${isOom ? 'bg-red' : 'bg-accent'}`}
          style={{ left: `${usedPct}%`, width: `${modelPct}%` }} />
        {engine === 'vllm' && (
          <div className="absolute top-0 h-full border-r-2 border-yellow/60 border-dashed"
            style={{ left: `${budgetPct}%` }} />
        )}
      </div>
      {engine === 'vllm' && (
        <div className="text-2xs text-yellow/60 mb-2 text-right">▲ GPU util limit</div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
        <LegendItem color="bg-white/15" label={`System ${usedGb.toFixed(1)} GB`} />
        <LegendItem color={isOom ? 'bg-red' : 'bg-accent'} label={`Weights ${weightsGb.toFixed(1)} GB`} />
        {engine === 'vllm' && <LegendItem color="bg-accent/50" label={`KV cache ~${kvGb.toFixed(1)} GB`} />}
        <LegendItem color="bg-overlay" label={`Free ${freeGb.toFixed(1)} GB`} />
        {isOom && <span className="text-red font-medium ml-auto">⚠ OOM — reduce ctx or GPU util</span>}
      </div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}
