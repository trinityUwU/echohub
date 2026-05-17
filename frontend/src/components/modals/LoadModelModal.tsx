import { useEffect, useState } from 'react'
import { Modal } from '@/components/shared/Modal'
import { Slider } from '@/components/shared/Slider'
import { Btn } from '@/components/shared/Btn'
import { canLoadModel } from '@/api/client'
import type { ModelInfo } from '@/types'

interface CanLoadResult {
  engine: string; format: string; feasible: boolean; reason: string | null
  vram_estimate_gb: number | null; gpu_type: string; vllm_available: boolean
}

interface LoadModelModalProps {
  model: ModelInfo
  vramTotalGb: number
  vramUsedGb: number
  onConfirm: (cfg: { gpuMemoryUtilization: number; maxModelLen: number | null; enforceEager: boolean; maxCudagraphCaptureSize: number | null }) => void
  onCancel: () => void
}

const CUDA_OVERHEAD_GB  = 1.2   // CUDA graphs + runtime
const SAFETY_MARGIN_GB  = 0.3   // buffer

function kvCacheGb(ctxLen: number, paramsBillion: number): number {
  // ~0.025 GB per 1k ctx for 8B — scales linearly with params
  return (ctxLen / 1000) * 0.025 * (paramsBillion / 8)
}

export function LoadModelModal({ model, vramTotalGb, vramUsedGb, onConfirm, onCancel }: LoadModelModalProps): React.ReactElement {
  const [gpuUtilPct, setGpuUtilPct] = useState(72)
  const [ctxLen, setCtxLen] = useState(Math.min(model.max_context_window ?? 16384, 16384))
  const [cudaGraphs, setCudaGraphs] = useState<'default' | 'limited' | 'disabled'>('default')
  const [maxCaptureSize, setMaxCaptureSize] = useState(512)
  const [check, setCheck] = useState<CanLoadResult | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    setChecking(true)
    canLoadModel(model.id)
      .then(setCheck).catch(() => setCheck(null)).finally(() => setChecking(false))
  }, [model.id])

  const gpuUtil   = gpuUtilPct / 100
  const engine    = check?.engine ?? (model.quantization?.toLowerCase().includes('gguf') ? 'llama' : 'vllm')
  const params    = model.params_billion ?? 8

  // Priority: metadata from HF (most accurate) > backend file estimate > fallback
  const weightsGb = model.vram_estimate_gb ?? check?.vram_estimate_gb ?? params * 0.6

  const kv        = engine === 'vllm' ? kvCacheGb(ctxLen, params) : 0
  const overhead  = engine === 'vllm' ? CUDA_OVERHEAD_GB : 0
  const totalNeed = weightsGb + kv + overhead

  // nvidia-smi reports in MiB, frontend already divides by 1024 → vramTotalGb is GiB
  // No additional conversion needed.
  const vramCudaGib = vramTotalGb
  const budgetGb    = vramCudaGib * gpuUtil
  // vLLM checks: free >= budget. free = vramCuda - vramUsed
  const cudaFreeGib = vramCudaGib - vramUsedGb
  const isOom       = totalNeed + SAFETY_MARGIN_GB > budgetGb  // model doesn't fit in allocated budget
                   || budgetGb > cudaFreeGib                  // budget exceeds what's actually free

  // Ctx ceiling: largest ctx that fits within budget
  const safeCtxK  = Math.max(2, (cudaFreeGib - weightsGb - overhead - SAFETY_MARGIN_GB) / (0.025 * params / 8))
  const ctxMax    = engine === 'vllm'
    ? Math.min(model.max_context_window ?? 131072, Math.floor(safeCtxK) * 1000)
    : (model.max_context_window ?? 131072)

  const canSubmit = !checking && (check?.feasible ?? false) && !isOom

  return (
    <Modal title="Load model" onClose={onCancel} footer={
      <>
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={!canSubmit}
          onClick={() => onConfirm({
            gpuMemoryUtilization: gpuUtil,
            maxModelLen: ctxLen,
            enforceEager: cudaGraphs === 'disabled',
            maxCudagraphCaptureSize: cudaGraphs === 'limited' ? maxCaptureSize : null,
          })}>
          {checking ? 'Checking…' : 'Load model'}
        </Btn>
      </>
    }>
      {/* Model + engine */}
      <div className="bg-elevated border border-border rounded-sm px-3 py-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">{model.name}</span>
        <span className={`text-2xs px-1.5 py-0.5 rounded ${engine === 'llama' ? 'bg-green/15 text-green' : 'bg-blue/15 text-blue'}`}>
          {engine === 'llama' ? 'llama.cpp' : 'vLLM'} · {check?.format?.toUpperCase() ?? model.quantization ?? '?'}
        </span>
      </div>

      {/* Infeasibility */}
      {check && !check.feasible && (
        <div className="flex items-start gap-2 bg-red/8 border border-red/25 rounded-sm px-3 py-2.5 text-sm text-red">
          <svg className="w-4 h-4 flex-shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{check.reason}</span>
        </div>
      )}

      {/* VRAM preview */}
      <VramBar
        totalGb={vramTotalGb} usedGb={vramUsedGb}
        weightsGb={weightsGb} kvGb={kv} overheadGb={overhead}
        budgetGb={budgetGb} cudaFreeGib={cudaFreeGib} isOom={isOom} engine={engine}
      />

      {/* Parameters */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2.5">Parameters</div>
        {engine === 'vllm' && (
          <Slider label="GPU memory utilization" value={gpuUtilPct} min={50} max={95} step={1}
            onChange={setGpuUtilPct} formatValue={v => `${v}%`} />
        )}
        <Slider label="Context length"
          value={Math.min(ctxLen, Math.max(2048, ctxMax))}
          min={2048} max={Math.max(2048, ctxMax)} step={2048}
          onChange={setCtxLen} formatValue={v => v.toLocaleString('en')} />
        {engine === 'vllm' && ctxMax < (model.max_context_window ?? 131072) && (
          <div className="text-xs text-yellow mt-1">
            Max safe ctx at {gpuUtilPct}% util: {ctxMax.toLocaleString('en')} tokens
          </div>
        )}
        {engine === 'llama' && (
          <div className="text-xs text-text-muted mt-1">GPU memory managed automatically by llama.cpp</div>
        )}
      </div>

      {engine === 'vllm' && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2.5">CUDA Graphs</div>
          <div className="flex flex-col gap-1.5">
            {(['default', 'limited', 'disabled'] as const).map(opt => (
              <button key={opt} onClick={() => setCudaGraphs(opt)}
                className={`flex items-start gap-3 px-3 py-2.5 rounded-sm border cursor-pointer transition-colors text-left ${
                  cudaGraphs === opt ? 'border-accent/40 bg-accent-dim' : 'bg-elevated border-border hover:border-border-hover'
                }`}>
                <div className={`w-3.5 h-3.5 rounded-full border-2 mt-0.5 flex-shrink-0 ${cudaGraphs === opt ? 'border-accent bg-accent' : 'border-border'}`} />
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {opt === 'default' ? 'Enabled (default)' : opt === 'limited' ? 'Limited' : 'Disabled'}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {opt === 'default' && 'Full CUDA graphs — max throughput, uses ~1.2 GB extra VRAM'}
                    {opt === 'limited' && 'Cap graph size — reduces VRAM usage, slight throughput cost'}
                    {opt === 'disabled' && 'No CUDA graphs (enforce-eager) — saves ~1.2 GB, slower inference'}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {cudaGraphs === 'limited' && (
            <div className="mt-2.5">
              <Slider label="Max capture size" value={maxCaptureSize} min={64} max={2048} step={64}
                onChange={setMaxCaptureSize} formatValue={v => `${v} tokens`} />
              <div className="text-xs text-text-muted mt-1">
                Lower = less VRAM for graphs. Requests larger than this run in eager mode.
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function VramBar({ totalGb, usedGb, weightsGb, kvGb, overheadGb, budgetGb, cudaFreeGib, isOom, engine }: {
  totalGb: number; usedGb: number; weightsGb: number; kvGb: number
  overheadGb: number; budgetGb: number; cudaFreeGib: number; isOom: boolean; engine: string
}): React.ReactElement {
  const pct = (gb: number): number => Math.min((gb / totalGb) * 100, 100)

  const systemPct   = pct(usedGb)
  const weightsPct  = pct(weightsGb)
  const kvPct       = pct(kvGb)
  const overheadPct = pct(overheadGb)
  const budgetPct   = pct(budgetGb)
  const freeGb      = Math.max(0, totalGb - usedGb - weightsGb - kvGb - overheadGb)
  const modelColor  = isOom ? 'bg-red' : 'bg-accent'

  return (
    <div className="bg-elevated border border-border rounded-sm p-3">
      <div className="text-xs text-text-muted mb-2">VRAM preview — {totalGb.toFixed(0)} GB total</div>

      {/* Stacked bar */}
      <div className="relative h-5 bg-overlay rounded-sm overflow-hidden mb-3 flex">
        <div className="h-full bg-white/20 transition-all" style={{ width: `${systemPct}%` }} title={`System: ${usedGb.toFixed(1)} GB`} />
        <div className={`h-full ${modelColor} transition-all`} style={{ width: `${weightsPct}%` }} title={`Weights: ${weightsGb.toFixed(1)} GB`} />
        {kvGb > 0 && <div className={`h-full ${modelColor} opacity-60 transition-all`} style={{ width: `${kvPct}%` }} title={`KV cache: ${kvGb.toFixed(1)} GB`} />}
        {overheadGb > 0 && <div className={`h-full ${modelColor} opacity-30 transition-all`} style={{ width: `${overheadPct}%` }} title={`CUDA overhead: ${overheadGb.toFixed(1)} GB`} />}
        {/* Budget line */}
        {engine === 'vllm' && (
          <div className="absolute top-0 bottom-0 w-0.5 bg-yellow z-10 transition-all"
            style={{ left: `${Math.min(budgetPct, 99.5)}%` }} />
        )}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Leg color="bg-white/20"       label="System"   val={`${usedGb.toFixed(1)} GB`} />
        <Leg color={modelColor}        label="Weights"  val={`${weightsGb.toFixed(1)} GB`} />
        {kvGb > 0    && <Leg color={`${modelColor} opacity-60`} label="KV cache" val={`~${kvGb.toFixed(1)} GB`} />}
        {overheadGb > 0 && <Leg color={`${modelColor} opacity-30`} label="Overhead" val={`${overheadGb.toFixed(1)} GB`} />}
        <Leg color="bg-overlay border border-border" label="Free" val={`${freeGb.toFixed(1)} GB`} />
        {engine === 'vllm' && <Leg color="bg-yellow" label="GPU util limit" val={`${budgetGb.toFixed(1)} GB`} />}
      </div>

      {isOom && (
        <div className="mt-2 text-xs text-red font-medium">
          {budgetGb > cudaFreeGib
            ? '⚠ OOM — GPU util limit exceeds free VRAM, lower the % slider'
            : '⚠ OOM — model doesn\'t fit in budget, increase GPU utilization %'}
        </div>
      )}
    </div>
  )
}

function Leg({ color, label, val }: { color: string; label: string; val: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5 text-text-muted">
      <span className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${color}`} />
      <span>{label}</span>
      <span className="ml-auto font-mono text-text-secondary">{val}</span>
    </span>
  )
}
