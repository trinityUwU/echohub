import { useEffect, useState } from 'react'
import { Modal } from '@/components/shared/Modal'
import { Slider } from '@/components/shared/Slider'
import { Btn } from '@/components/shared/Btn'
import { Badge } from '@/components/shared/Badge'
import { getInferenceSettings, getMoeLoadConfig } from '@/api/client'
import type { MoeLoadConfig } from '@/api/client'
import type { GpuStats, ModelInfo } from '@/types'

interface CanLoadResult {
  engine: string; format: string; feasible: boolean; reason: string | null
  vram_estimate_gb: number | null; gpu_type: string; vllm_available: boolean
}

interface LoadModelModalProps {
  model: ModelInfo
  vramTotalGb: number
  vramUsedGb: number
  gpu?: GpuStats | null
  onConfirm: (cfg: {
    gpuMemoryUtilization: number; maxModelLen: number | null
    enforceEager: boolean; maxCudagraphCaptureSize: number | null
    nGpuLayers?: number | null; cpuOverflow?: boolean; isMoe?: boolean
  }) => void
  onCancel: () => void
}

const CUDA_OVERHEAD_GB = 1.2
const SAFETY_MARGIN_GB = 0.3

function kvCacheGb(ctxLen: number, paramsBillion: number): number {
  return (ctxLen / 1000) * 0.025 * (paramsBillion / 8)
}

export function LoadModelModal({ model, vramTotalGb, vramUsedGb, gpu, onConfirm, onCancel }: LoadModelModalProps): React.ReactElement {
  const [gpuUtilPct, setGpuUtilPct] = useState(72)
  const [vramLimitGb, setVramLimitGb] = useState<number | null>(null)
  const [ctxLen, setCtxLen] = useState(Math.min(model.max_context_window ?? 16384, 16384))
  const [cudaGraphs, setCudaGraphs] = useState<'default' | 'limited' | 'disabled'>('default')
  const [maxCaptureSize, setMaxCaptureSize] = useState(512)
  const [check, setCheck] = useState<CanLoadResult | null>(null)
  // llama.cpp only
  const [gpuLayersPct, setGpuLayersPct] = useState(100) // 0=CPU, 100=full GPU
  const [cpuOverflow, setCpuOverflow] = useState(false)
  const [moeConfig, setMoeConfig] = useState<MoeLoadConfig | null>(null)

  useEffect(() => {
    getInferenceSettings().then(s => {
      const ext = s as unknown as { gpu_util_limit_pct?: number | null; gpu_vram_limit_gb?: number | null }
      if (ext.gpu_util_limit_pct) setGpuUtilPct(ext.gpu_util_limit_pct)
      if (ext.gpu_vram_limit_gb) setVramLimitGb(ext.gpu_vram_limit_gb)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!model.is_moe) return
    getMoeLoadConfig(model.id, vramTotalGb).then(cfg => {
      if (!cfg.is_moe) return
      setMoeConfig(cfg)
      if (cfg.recommended_n_gpu_layers != null) {
        const totalLayers = 64 // conservative estimate matching backend
        setGpuLayersPct(Math.round((cfg.recommended_n_gpu_layers / totalLayers) * 100))
      }
      setCpuOverflow(cfg.recommended_cpu_overflow ?? true)
      if (cfg.recommended_ctx) setCtxLen(cfg.recommended_ctx)
    }).catch(() => {})
  }, [model.id, model.is_moe, vramTotalGb])

  useEffect(() => {
    const isGguf = model.quantization?.toLowerCase().includes('gguf') || model.arch_tag?.toLowerCase().includes('gguf')
    setCheck({ engine: isGguf ? 'llama' : 'vllm', format: isGguf ? 'gguf' : 'vllm',
               feasible: true, reason: null, vram_estimate_gb: model.vram_estimate_gb,
               gpu_type: 'nvidia', vllm_available: true })
  }, [model.id])

  const gpuUtil = gpuUtilPct / 100
  const engine  = check?.engine ?? (model.quantization?.toLowerCase().includes('gguf') ? 'llama' : 'vllm')
  const params  = model.params_billion ?? 8
  const weightsGb = model.vram_estimate_gb ?? check?.vram_estimate_gb ?? params * 0.6

  const kv        = engine === 'vllm' ? kvCacheGb(ctxLen, params) : 0
  const overhead  = engine === 'vllm' ? CUDA_OVERHEAD_GB : 0
  const totalNeed = weightsGb + kv + overhead

  const vramCudaGib = vramLimitGb ? Math.min(vramTotalGb, vramLimitGb) : vramTotalGb
  const budgetGb    = vramCudaGib * gpuUtil
  const cudaFreeGib = vramCudaGib - vramUsedGb
  const isOom       = totalNeed + SAFETY_MARGIN_GB > budgetGb || budgetGb > cudaFreeGib

  const safeCtxK = Math.max(2, (cudaFreeGib - weightsGb - overhead - SAFETY_MARGIN_GB) / (0.025 * params / 8))
  const ctxMax   = engine === 'vllm'
    ? Math.min(model.max_context_window ?? 131072, Math.floor(safeCtxK) * 1000)
    : (model.max_context_window ?? 131072)

  // For llama: n_gpu_layers — -1=full GPU, 0=CPU only
  // gpuLayersPct 100 → -1, 0 → 0, middle → proportional
  const resolvedNGpuLayers = engine === 'llama'
    ? (gpuLayersPct === 100 ? -1 : gpuLayersPct === 0 ? 0 : null)
    : null

  const canSubmit = (check?.feasible ?? false) && (!isOom || engine === 'llama')

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
            nGpuLayers: resolvedNGpuLayers,
            cpuOverflow: engine === 'llama' ? cpuOverflow : false,
            isMoe: model.is_moe ?? false,
          })}>
          Load model
        </Btn>
      </>
    }>
      {/* MoE banner */}
      {model.is_moe && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-sm px-3 py-2.5 text-sm text-amber-400">
          <svg className="w-4 h-4 flex-shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <div className="font-medium">
              MoE model: {model.params_billion ?? '?'}B total
              {model.active_params_billion != null && ` / ${model.active_params_billion}B active per token`}
            </div>
            <div className="text-xs text-amber-400/70 mt-0.5">
              Requires CPU overflow on 12 GB GPU — RAM will be used for remaining layers
            </div>
            {moeConfig?.is_moe && (
              <div className="flex gap-3 mt-1.5 text-xs font-mono">
                <span className={moeConfig.estimated_gpu_vram_gb != null && moeConfig.estimated_gpu_vram_gb <= vramTotalGb ? 'text-green-400' : 'text-amber-400'}>
                  GPU ~{moeConfig.estimated_gpu_vram_gb ?? '?'} GB
                </span>
                <span className="text-text-muted">
                  RAM ~{moeConfig.estimated_ram_gb ?? '?'} GB
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Model + engine + capability badges */}
      <div className="bg-elevated border border-border rounded-sm px-3 py-2.5 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">{model.name}</span>
          <div className="flex flex-wrap gap-1">
            {model.quantization && <Badge variant="quant">{model.quantization.split('/')[0]}</Badge>}
            {model.is_moe && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">
                MoE{model.active_params_billion ? ` A${model.active_params_billion}B` : ''}
              </span>
            )}
            {model.has_mtp && <Badge variant="mtp">MTP</Badge>}
            {model.capabilities?.thinking && <Badge variant="think">thinking</Badge>}
            {model.capabilities?.vision && <Badge variant="vision">vision</Badge>}
          </div>
        </div>
        <span className={`text-2xs px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 ${engine === 'llama' ? 'bg-green/15 text-green' : 'bg-blue/15 text-blue'}`}>
          {engine === 'llama' ? 'llama.cpp' : 'vLLM'}
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

      {/* Hardware live */}
      <HardwareSection gpu={gpu ?? null} />

      {/* VRAM preview */}
      <VramBar totalGb={vramTotalGb} usedGb={vramUsedGb} weightsGb={weightsGb}
        kvGb={kv} overheadGb={overhead} budgetGb={budgetGb}
        cudaFreeGib={cudaFreeGib} isOom={isOom} engine={engine} />

      {/* Parameters */}
      <div className="flex flex-col gap-3">
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted">Parameters</div>

        {engine === 'vllm' && (
          <Slider label="GPU memory utilization" value={gpuUtilPct} min={50} max={95} step={1}
            onChange={setGpuUtilPct} formatValue={v => `${v}%`} />
        )}

        {engine === 'llama' && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-text-primary">Compute split</span>
              <span className="text-xs font-mono text-text-muted">
                {gpuLayersPct === 0 ? 'CPU only' : gpuLayersPct === 100 ? 'GPU only' : `${gpuLayersPct}% GPU · ${100 - gpuLayersPct}% CPU`}
              </span>
            </div>
            {/* CPU ←——→ GPU slider */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xs text-text-muted/60 w-8 text-right">CPU</span>
              <input type="range" min={0} max={100} step={10} value={gpuLayersPct}
                onChange={e => setGpuLayersPct(Number(e.target.value))}
                className="flex-1 accent-accent cursor-pointer" />
              <span className="text-2xs text-text-muted/60 w-8">GPU</span>
            </div>
            <div className="text-xs text-text-muted">
              {gpuLayersPct === 0 && 'All layers on CPU RAM — slow but works without GPU'}
              {gpuLayersPct === 100 && 'All layers on GPU VRAM — maximum performance'}
              {gpuLayersPct > 0 && gpuLayersPct < 100 && 'Hybrid — GPU handles most layers, CPU handles overflow'}
            </div>
            {/* CPU overflow toggle */}
            <button onClick={() => setCpuOverflow(v => !v)}
              className={`mt-3 flex items-center gap-2.5 w-full px-3 py-2.5 rounded-sm border cursor-pointer transition-colors text-left ${
                cpuOverflow ? 'border-yellow/40 bg-yellow/8' : 'border-border bg-elevated hover:border-border-hover'
              }`}>
              <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                cpuOverflow ? 'border-yellow bg-yellow' : 'border-border'
              }`}>
                {cpuOverflow && <svg className="w-2.5 h-2.5 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              <div>
                <div className={`text-sm font-medium ${cpuOverflow ? 'text-yellow' : 'text-text-primary'}`}>
                  Overflow to CPU if VRAM exceeded
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  Automatically spills excess layers to CPU RAM instead of crashing
                </div>
              </div>
            </button>
          </div>
        )}

        <Slider label="Context length"
          value={Math.min(ctxLen, Math.max(2048, ctxMax))}
          min={2048} max={Math.max(2048, ctxMax)} step={2048}
          onChange={setCtxLen} formatValue={v => v.toLocaleString('en')} />
        {engine === 'vllm' && ctxMax < (model.max_context_window ?? 131072) && (
          <div className="text-xs text-yellow">
            Max safe ctx at {gpuUtilPct}% util: {ctxMax.toLocaleString('en')} tokens
          </div>
        )}
      </div>

      {/* CUDA Graphs (vLLM only) */}
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

function HardwareSection({ gpu }: { gpu: GpuStats | null }): React.ReactElement | null {
  if (!gpu) return null
  const cpu = gpu.cpu
  const vramPct = gpu.vram_total_mb > 0 ? Math.round((gpu.vram_used_mb / gpu.vram_total_mb) * 100) : 0
  const ramPct  = cpu ? Math.round((cpu.ram_used_gb / cpu.ram_total_gb) * 100) : 0

  return (
    <div className="bg-elevated border border-border rounded-sm p-3 flex flex-col gap-2.5">
      <div className="text-xs font-semibold uppercase tracking-widest text-text-muted">Hardware</div>

      {/* GPU */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-text-secondary truncate">{gpu.name}</span>
          <div className="flex items-center gap-3 text-xs text-text-muted flex-shrink-0 ml-2">
            {gpu.temperature_c != null && (
              <span className={gpu.temperature_c > 80 ? 'text-red' : gpu.temperature_c > 70 ? 'text-yellow' : ''}>
                {gpu.temperature_c}°C
              </span>
            )}
            <span className="font-mono">{(gpu.vram_used_mb / 1024).toFixed(1)} / {(gpu.vram_total_mb / 1024).toFixed(0)} GB</span>
            <span className={`font-mono ${gpu.gpu_utilization_pct > 90 ? 'text-red' : gpu.gpu_utilization_pct > 70 ? 'text-yellow' : ''}`}>
              {gpu.gpu_utilization_pct}%
            </span>
          </div>
        </div>
        <div className="h-1.5 bg-overlay rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${
            vramPct > 90 ? 'bg-red' : vramPct > 75 ? 'bg-yellow' : 'bg-accent'
          }`} style={{ width: `${vramPct}%` }} />
        </div>
      </div>

      {/* CPU */}
      {cpu && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-text-secondary truncate">{cpu.name || 'CPU'} · {cpu.cores_physical}C/{cpu.cores_logical}T</span>
            <div className="flex items-center gap-3 text-xs text-text-muted flex-shrink-0 ml-2">
              {cpu.temperature_c != null && (
                <span className={cpu.temperature_c > 85 ? 'text-red' : cpu.temperature_c > 70 ? 'text-yellow' : ''}>
                  {cpu.temperature_c}°C
                </span>
              )}
              <span className="font-mono">{cpu.ram_used_gb.toFixed(1)} / {cpu.ram_total_gb.toFixed(0)} GB RAM</span>
              <span className={`font-mono ${cpu.usage_pct > 90 ? 'text-red' : cpu.usage_pct > 70 ? 'text-yellow' : ''}`}>
                {cpu.usage_pct}%
              </span>
            </div>
          </div>
          <div className="h-1.5 bg-overlay rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${
              ramPct > 90 ? 'bg-red' : ramPct > 75 ? 'bg-yellow' : 'bg-green'
            }`} style={{ width: `${ramPct}%` }} />
          </div>
        </div>
      )}
    </div>
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
      <div className="relative h-5 bg-overlay rounded-sm overflow-hidden mb-3 flex">
        <div className="h-full bg-white/20 transition-all" style={{ width: `${systemPct}%` }} title={`System: ${usedGb.toFixed(1)} GB`} />
        <div className={`h-full ${modelColor} transition-all`} style={{ width: `${weightsPct}%` }} title={`Weights: ${weightsGb.toFixed(1)} GB`} />
        {kvGb > 0 && <div className={`h-full ${modelColor} opacity-60 transition-all`} style={{ width: `${kvPct}%` }} title={`KV cache: ${kvGb.toFixed(1)} GB`} />}
        {overheadGb > 0 && <div className={`h-full ${modelColor} opacity-30 transition-all`} style={{ width: `${overheadPct}%` }} title={`CUDA overhead: ${overheadGb.toFixed(1)} GB`} />}
        {engine === 'vllm' && (
          <div className="absolute top-0 bottom-0 w-0.5 bg-yellow z-10 transition-all"
            style={{ left: `${Math.min(budgetPct, 99.5)}%` }} />
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Leg color="bg-white/20"       label="System"   val={`${usedGb.toFixed(1)} GB`} />
        <Leg color={modelColor}        label="Weights"  val={`${weightsGb.toFixed(1)} GB`} />
        {kvGb > 0    && <Leg color={`${modelColor} opacity-60`} label="KV cache" val={`~${kvGb.toFixed(1)} GB`} />}
        {overheadGb > 0 && <Leg color={`${modelColor} opacity-30`} label="Overhead" val={`${overheadGb.toFixed(1)} GB`} />}
        <Leg color="bg-overlay border border-border" label="Free" val={`${freeGb.toFixed(1)} GB`} />
        {engine === 'vllm' && <Leg color="bg-yellow" label="GPU util limit" val={`${budgetGb.toFixed(1)} GB`} />}
      </div>
      {isOom && engine !== 'llama' && (
        <div className="mt-2 text-xs text-red font-medium">
          {budgetGb > cudaFreeGib
            ? '⚠ OOM — GPU util limit exceeds free VRAM, lower the % slider'
            : '⚠ OOM — model doesn\'t fit in budget, increase GPU utilization %'}
        </div>
      )}
      {isOom && engine === 'llama' && (
        <div className="mt-2 text-xs text-yellow font-medium">
          ⚠ Model may exceed VRAM — enable "Overflow to CPU" to avoid crash
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
