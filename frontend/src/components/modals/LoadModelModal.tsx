import { useEffect, useState } from 'react'
import { Modal } from '@/components/shared/Modal'
import { Slider } from '@/components/shared/Slider'
import { Btn } from '@/components/shared/Btn'
import { Badge } from '@/components/shared/Badge'
import { getInferenceSettings, getMoeLoadConfig, getMultiGpuConfig, checkMtpSupport } from '@/api/client'
import type { MoeLoadConfig } from '@/api/client'
import type { GpuStats, ModelInfo, MultiGpuConfig } from '@/types'

interface CanLoadResult {
  engine: string; format: string; feasible: boolean; reason: string | null
  vram_estimate_gb: number | null; gpu_type: string; vllm_available: boolean
}

interface LoadModelModalProps {
  model: ModelInfo
  vramTotalGb: number
  vramUsedGb: number
  gpu?: GpuStats | null
  conversationTokens?: number
  onConfirm: (cfg: {
    gpuMemoryUtilization: number; maxModelLen: number | null
    enforceEager: boolean; maxCudagraphCaptureSize: number | null
    nGpuLayers?: number | null; cpuOverflow?: boolean; isMoe?: boolean
    kvQuant?: 'q8_0' | 'q4_0' | 'bf16'
    offloadKqv?: boolean; nBatch?: number | null
    tensorParallelSize?: number | null; pipelineParallelSize?: number | null
    tensorSplit?: number[] | null; mainGpu?: number | null
    speculativeMode?: 'off' | 'ngram' | 'mtp' | 'draft_model'
    draftModelPath?: string | null; nPredTokens?: number
  }) => void
  onCancel: () => void
}

const CUDA_OVERHEAD_GB = 1.2
const SAFETY_MARGIN_GB = 0.3

function kvCacheGb(ctxLen: number, paramsBillion: number): number {
  return (ctxLen / 1000) * 0.025 * (paramsBillion / 8)
}

// Estimate total model layers from params_billion — approximation based on common architectures
function estimateLayers(paramsBillion: number): number {
  if (paramsBillion <= 1.5) return 28
  if (paramsBillion <= 3)   return 36
  if (paramsBillion <= 8)   return 32
  if (paramsBillion <= 14)  return 40
  if (paramsBillion <= 32)  return 64
  return 80
}

type LoadProfile = 'performance' | 'balanced' | 'gaming' | 'minimal'

interface ProfileDef {
  id: LoadProfile
  label: string
  icon: string
  desc: string
  vramTarget: (total: number) => number  // GB
  kvQuant: 'q8_0' | 'q4_0' | 'bf16'
  offloadKqv: boolean
  nBatch: 64 | 128 | 256 | 512
  ctxMode: 'fixed' | 'adaptive'
}

const PROFILES: ProfileDef[] = [
  {
    id: 'performance',
    label: 'Performance',
    icon: '⚡',
    desc: 'Full GPU — max speed, uses all available VRAM',
    vramTarget: (t) => t * 0.92,
    kvQuant: 'q8_0',
    offloadKqv: false,
    nBatch: 512,
    ctxMode: 'fixed',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    icon: '⚖',
    desc: 'Half VRAM — model runs fast, leaves room for the OS and light tasks',
    vramTarget: (t) => t * 0.5,
    kvQuant: 'q8_0',
    offloadKqv: false,
    nBatch: 256,
    ctxMode: 'fixed',
  },
  {
    id: 'gaming',
    label: 'Gaming',
    icon: '🎮',
    desc: '~3 GB VRAM — model stays loaded while playing most games',
    vramTarget: (_) => 3.0,
    kvQuant: 'q4_0',
    offloadKqv: true,
    nBatch: 128,
    ctxMode: 'adaptive',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    icon: '🪶',
    desc: '~1.5 GB VRAM — leaves as much as possible free, slower generation',
    vramTarget: (_) => 1.5,
    kvQuant: 'q4_0',
    offloadKqv: true,
    nBatch: 64,
    ctxMode: 'adaptive',
  },
]

// Compute n_gpu_layers for a given VRAM budget and model weights size
function computeGpuLayersPct(
  vramBudgetGb: number,
  weightsGb: number,
  paramsBillion: number,
): number {
  const totalLayers = estimateLayers(paramsBillion)
  const gbPerLayer = weightsGb / totalLayers
  const fitsLayers = Math.floor(vramBudgetGb / gbPerLayer)
  const pct = Math.round(Math.min(fitsLayers / totalLayers, 1) * 100)
  return Math.max(0, pct)
}

export function LoadModelModal({ model, vramTotalGb, vramUsedGb, gpu, conversationTokens, onConfirm, onCancel }: LoadModelModalProps): React.ReactElement {
  const [gpuUtilPct, setGpuUtilPct] = useState(72)
  const [vramLimitGb, setVramLimitGb] = useState<number | null>(null)
  const [ctxLen, setCtxLen] = useState(() => {
    // Smart initial ctx: start small, grow with conversation history
    // New conv → 4K. Existing conv → max(4K, tokens×2) capped at 32K
    const baseCtx = conversationTokens && conversationTokens > 1024
      ? Math.min(32768, Math.max(4096, Math.pow(2, Math.ceil(Math.log2(conversationTokens * 2)))))
      : 4096
    return Math.min(baseCtx, model.max_context_window ?? 32768)
  })
  const [cudaGraphs, setCudaGraphs] = useState<'default' | 'limited' | 'disabled'>('default')
  const [maxCaptureSize, setMaxCaptureSize] = useState(512)
  const [check, setCheck] = useState<CanLoadResult | null>(null)
  // llama.cpp only
  const [gpuLayersPct, setGpuLayersPct] = useState(100) // 0=CPU, 100=full GPU
  const [cpuOverflow, setCpuOverflow] = useState(false)
  const [moeConfig, setMoeConfig] = useState<MoeLoadConfig | null>(null)
  const [kvQuant, setKvQuant] = useState<'q8_0' | 'q4_0' | 'bf16'>('q8_0')
  const [offloadKqv, setOffloadKqv] = useState(false)
  const [nBatch, setNBatch] = useState<64 | 128 | 256 | 512>(model.is_moe ? 128 : 512)
  const [ctxMode, setCtxMode] = useState<'fixed' | 'adaptive'>('fixed')
  const [activeProfile, setActiveProfile] = useState<LoadProfile | null>(null)
  // Speculative decoding
  const [speculativeMode, setSpeculativeMode] = useState<'off' | 'ngram' | 'mtp' | 'draft_model'>('off')
  const [nPredTokens, setNPredTokens] = useState(10)
  const [draftModelPath, setDraftModelPath] = useState<string>('')
  const [mtpSupported, setMtpSupported] = useState<boolean | null>(null)
  // Multi-GPU state (vLLM only)
  const [gpuCount, setGpuCount] = useState(1)
  const [tensorParallelSize, setTensorParallelSize] = useState<number>(1)
  // Multi-GPU state (llama.cpp)
  const [multiGpuConfig, setMultiGpuConfig] = useState<MultiGpuConfig | null>(null)
  const [tensorSplit, setTensorSplit] = useState<number[] | null>(null)

  // Pre-compute weightsGb here so applyProfile can use it
  const _qUpperEarly = (model.quantization ?? '').toUpperCase()
  const _nameLEarly  = (model.id ?? model.name ?? '').toLowerCase()
  const _isGgufEarly =
    _qUpperEarly.startsWith('GGUF') ||
    _nameLEarly.includes('gguf') ||
    _qUpperEarly.includes('Q4') || _qUpperEarly.includes('Q5') || _qUpperEarly.includes('Q6') ||
    _qUpperEarly.includes('Q8') || _qUpperEarly.includes('IQ') ||
    /[-_]i[1-4][-_.]/.test(_nameLEarly) || _nameLEarly.endsWith('-i1') || _nameLEarly.endsWith('-i2')
  const _engineEarly = _isGgufEarly ? 'llama' : 'vllm'
  const _params = model.params_billion ?? 8
  const _ggufFactor = (() => {
    const q = _qUpperEarly; const n = _nameLEarly
    if (q.includes('Q3') || n.includes('q3')) return 0.42
    if (q.includes('Q4') || n.includes('q4')) return 0.55
    if (q.includes('Q5') || n.includes('q5')) return 0.67
    if (q.includes('Q6') || n.includes('q6')) return 0.80
    if (q.includes('Q8') || n.includes('q8')) return 1.1
    if (q.includes('F16') || n.includes('f16')) return 2.0
    if (/i[1-4][-_.]/.test(n) || n.endsWith('-i1') || n.endsWith('-i2')) return 0.52
    return 0.55
  })()
  const _be = model.vram_estimate_gb
  const _weightsGb = _engineEarly === 'llama'
    ? (_be && _be < _params * 1.2 ? _be : _params * _ggufFactor)
    : (_be ?? _params * 0.6)

  const applyProfile = (profileId: LoadProfile): void => {
    const prof = PROFILES.find(p => p.id === profileId)
    if (!prof) return
    const vramBudget = prof.vramTarget(vramTotalGb)
    const layersPct = computeGpuLayersPct(vramBudget, _weightsGb, _params)
    setGpuLayersPct(layersPct)
    setKvQuant(prof.kvQuant)
    setOffloadKqv(prof.offloadKqv)
    setNBatch(prof.nBatch)
    setCtxMode(prof.ctxMode)
    // All profiles enable n-gram by default — zero cost, always beneficial
    setSpeculativeMode('ngram')
    setActiveProfile(profileId)
  }

  // Any manual tweak after a profile clears the "active" highlight
  const withProfileClear = <T,>(setter: (v: T) => void) => (v: T): void => {
    setActiveProfile(null)
    setter(v)
  }

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
    getMultiGpuConfig().then(cfg => {
      setGpuCount(cfg.gpu_count)
      if (cfg.gpu_count > 1) setTensorParallelSize(cfg.gpu_count)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    // Check all available fields — quantization, name, id, arch_tag
    const haystack = [
      model.quantization ?? '',
      model.name ?? '',
      model.id ?? '',
      model.arch_tag ?? '',
    ].join(' ').toLowerCase()
    const isGguf = haystack.includes('gguf') ||
      /[-_.]q[3-8][-_.]/.test(haystack) || /[-_]iq[2-4][-_]/.test(haystack) ||
      /[-_]i[1-4][-_.]/.test(haystack)
    setCheck({ engine: isGguf ? 'llama' : 'vllm', format: isGguf ? 'gguf' : 'vllm',
               feasible: true, reason: null, vram_estimate_gb: model.vram_estimate_gb,
               gpu_type: 'nvidia', vllm_available: true })
  }, [model.id])

  useEffect(() => {
    getMultiGpuConfig().then(cfg => {
      setMultiGpuConfig(cfg)
      if (cfg.tensor_split && cfg.tensor_split.length > 1) {
        setTensorSplit(cfg.tensor_split)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    checkMtpSupport(model.id).then(r => setMtpSupported(r.mtp_supported)).catch(() => setMtpSupported(false))
  }, [model.id])

  const gpuUtil = gpuUtilPct / 100
  const _qUpper = (model.quantization ?? '').toUpperCase()
  const _nameL  = (model.id ?? model.name ?? '').toLowerCase()
  const isGgufModel =
    _qUpper.startsWith('GGUF') ||
    _nameL.includes('gguf') ||
    _qUpper.includes('Q4') || _qUpper.includes('Q5') || _qUpper.includes('Q6') ||
    _qUpper.includes('Q8') || _qUpper.includes('IQ') ||
    // i1/i2/i3 quantizations (llama.cpp importance-matrix variants)
    /[-_]i[1-4][-_.]/.test(_nameL) || _nameL.endsWith('-i1') || _nameL.endsWith('-i2')
  const engine  = check?.engine ?? (isGgufModel ? 'llama' : 'vllm')
  const params  = model.params_billion ?? 8

  // For GGUF models, recompute VRAM from params × quant factor (backend may have returned BF16 estimate)
  const ggufFactor = (() => {
    const q = _qUpper
    const n = _nameL
    if (q.includes('Q3') || n.includes('q3')) return 0.42
    if (q.includes('Q4') || n.includes('q4')) return 0.55
    if (q.includes('Q5') || n.includes('q5')) return 0.67
    if (q.includes('Q6') || n.includes('q6')) return 0.80
    if (q.includes('Q8') || n.includes('q8')) return 1.1
    if (q.includes('F16') || n.includes('f16')) return 2.0
    if (/i[1-4][-_.]/.test(n) || n.endsWith('-i1') || n.endsWith('-i2')) return 0.52
    return 0.55 // default Q4 estimate
  })()
  const backendEstimate = model.vram_estimate_gb ?? check?.vram_estimate_gb
  const weightsGb = engine === 'llama'
    ? (backendEstimate && backendEstimate < params * 1.2 ? backendEstimate : params * ggufFactor)
    : (backendEstimate ?? params * 0.6)

  // KV cache VRAM: applies to both vLLM and llama.cpp
  // llama.cpp KV factor: bf16=1.0, q8_0=0.5, q4_0=0.25
  // For smart cap mode we don't know resolvedCtx yet (circular dep) — use ctxLen as upper bound estimate
  const kvQuantFactor = kvQuant === 'bf16' ? 1.0 : kvQuant === 'q8_0' ? 0.5 : 0.25
  const kvTotal   = engine === 'vllm' ? kvCacheGb(ctxLen, params) : kvCacheGb(ctxLen, params) * kvQuantFactor
  // offload_kqv: KV cache in system RAM instead of VRAM — zero VRAM cost for KV
  const kv        = (engine === 'llama' && offloadKqv) ? 0 : kvTotal
  const kvOffloadedGb = (engine === 'llama' && offloadKqv) ? kvTotal : 0
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

  // For llama: convert gpuLayersPct to actual layer count
  // 100% → -1 (full GPU), 0% → 0 (CPU only), middle → estimated real count
  const resolvedNGpuLayers = engine === 'llama'
    ? (gpuLayersPct === 100 ? -1 : gpuLayersPct === 0 ? 0 : Math.round(estimateLayers(_params) * gpuLayersPct / 100))
    : null

  // Smart ctx: max ctx that fits in remaining VRAM after partial GPU weights
  // Used in "smart" mode — much safer than null (which breaks llama.cpp)
  const gpuWeightsGb = weightsGb * (gpuLayersPct / 100)
  const vramAfterWeights = Math.max(0, cudaFreeGib - gpuWeightsGb - SAFETY_MARGIN_GB)
  const kvGbPerToken = (kvQuantFactor * 0.025 * params / 8) / 1000
  const smartCtxTokens = offloadKqv
    ? Math.min(model.max_context_window ?? 131072, 32768) // KV in RAM — can go big
    : Math.max(2048, Math.floor(vramAfterWeights / kvGbPerToken / 1024) * 1024)
  const resolvedCtx = ctxMode === 'fixed' ? ctxLen : Math.min(smartCtxTokens, model.max_context_window ?? 131072)

  const canSubmit = (check?.feasible ?? false) && (!isOom || engine === 'llama')

  return (
    <Modal title="Load model" onClose={onCancel} footer={
      <>
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" disabled={!canSubmit}
          onClick={() => onConfirm({
            gpuMemoryUtilization: gpuUtil,
            maxModelLen: resolvedCtx,
            enforceEager: cudaGraphs === 'disabled',
            maxCudagraphCaptureSize: cudaGraphs === 'limited' ? maxCaptureSize : null,
            nGpuLayers: resolvedNGpuLayers,
            cpuOverflow: engine === 'llama' ? cpuOverflow : false,
            isMoe: model.is_moe ?? false,
            kvQuant: engine === 'llama' ? kvQuant : undefined,
            offloadKqv: engine === 'llama' ? offloadKqv : false,
            nBatch: engine === 'llama' ? nBatch : null,
            tensorParallelSize: engine === 'vllm' && tensorParallelSize > 1 ? tensorParallelSize : null,
            pipelineParallelSize: null,
            tensorSplit: engine === 'llama' ? tensorSplit : null,
            mainGpu: engine === 'llama' && tensorSplit ? 0 : null,
            speculativeMode: engine === 'llama' ? speculativeMode : undefined,
            draftModelPath: engine === 'llama' && speculativeMode === 'draft_model' ? (draftModelPath || null) : null,
            nPredTokens: engine === 'llama' ? nPredTokens : undefined,
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
      <VramBar
        totalGb={multiGpuConfig && multiGpuConfig.gpu_count > 1 && engine === 'llama'
          ? multiGpuConfig.total_vram_mb / 1024
          : vramTotalGb}
        usedGb={vramUsedGb} weightsGb={weightsGb}
        kvGb={kv} kvOffloadedGb={kvOffloadedGb} overheadGb={overhead} budgetGb={budgetGb}
        cudaFreeGib={cudaFreeGib} isOom={isOom} engine={engine} />

      {/* Load profiles — llama.cpp only */}
      {engine === 'llama' && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-text-muted">Load profile</div>
          <div className="grid grid-cols-2 gap-2">
            {PROFILES.map(prof => {
              const vramBudget = prof.vramTarget(vramTotalGb)
              const layersPct  = computeGpuLayersPct(vramBudget, _weightsGb, _params)
              const freeGb     = Math.max(0, vramTotalGb - vramUsedGb - Math.min(vramBudget, _weightsGb))
              const active     = activeProfile === prof.id
              return (
                <button key={prof.id} onClick={() => applyProfile(prof.id)}
                  className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-sm border cursor-pointer transition-all text-left ${
                    active
                      ? 'border-accent/50 bg-accent/8 ring-1 ring-accent/20'
                      : 'border-border bg-elevated hover:border-border-hover'
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base leading-none">{prof.icon}</span>
                      <span className={`text-sm font-semibold ${active ? 'text-accent' : 'text-text-primary'}`}>
                        {prof.label}
                      </span>
                    </div>
                    {active && (
                      <span className="text-2xs px-1.5 py-px rounded bg-accent/15 text-accent font-medium">active</span>
                    )}
                  </div>
                  <div className="text-2xs text-text-muted leading-tight">{prof.desc}</div>
                  <div className="flex items-center gap-3 mt-0.5 text-2xs font-mono">
                    <span className={`${active ? 'text-accent' : 'text-text-secondary'}`}>
                      {layersPct === 100 ? 'Full GPU' : layersPct === 0 ? 'CPU only' : `${layersPct}% GPU`}
                    </span>
                    <span className="text-text-muted">
                      ~{freeGb.toFixed(1)} GB free
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
          {activeProfile !== null && (
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>Profile applied — tweak parameters below if needed</span>
              <button onClick={() => setActiveProfile(null)} className="text-text-muted hover:text-text-primary underline underline-offset-2 cursor-pointer">
                clear
              </button>
            </div>
          )}
        </div>
      )}

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
                onChange={e => withProfileClear(setGpuLayersPct)(Number(e.target.value))}
                className="flex-1 accent-accent cursor-pointer" />
              <span className="text-2xs text-text-muted/60 w-8">GPU</span>
            </div>
            <div className="text-xs text-text-muted">
              {gpuLayersPct === 0 && 'All layers on CPU RAM — slow but works without GPU'}
              {gpuLayersPct === 100 && 'All layers on GPU VRAM — maximum performance'}
              {gpuLayersPct > 0 && gpuLayersPct < 100 && 'Hybrid — GPU handles most layers, CPU handles overflow'}
            </div>
            {/* CPU overflow toggle */}
            <button onClick={() => withProfileClear(setCpuOverflow)(!cpuOverflow)}
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

        {/* Multi-GPU — llama.cpp only, shown when > 1 GPU detected */}
        {engine === 'llama' && multiGpuConfig && multiGpuConfig.gpu_count > 1 && (
          <div className="flex items-start gap-2 bg-green/8 border border-green/30 rounded-sm px-3 py-2.5">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <div>
              <div className="text-sm font-medium text-green">
                {multiGpuConfig.gpu_count} GPUs detected — tensor split enabled
              </div>
              <div className="flex gap-3 mt-1 text-xs font-mono text-text-muted">
                {multiGpuConfig.gpus.map(g => (
                  <span key={g.index}>{g.name}: {((tensorSplit?.[g.index] ?? 1 / multiGpuConfig.gpu_count) * 100).toFixed(0)}%</span>
                ))}
              </div>
              <div className="text-xs text-text-muted mt-0.5">
                Split proportional to VRAM — total {(multiGpuConfig.total_vram_mb / 1024).toFixed(0)} GB
              </div>
            </div>
          </div>
        )}

        {/* Context mode — llama.cpp only */}
        {engine === 'llama' && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2.5">Context length</div>
            <div className="flex gap-2 mb-2.5">
              {([
                {
                  id: 'fixed' as const,
                  label: 'Fixed',
                  pros: 'Predictable VRAM, best for long conversations',
                  cons: 'Allocates full KV cache at load even if unused',
                },
                {
                  id: 'adaptive' as const,
                  label: 'Smart cap',
                  pros: 'Auto-calculates max ctx that fits in remaining VRAM',
                  cons: 'Cap is fixed at load — grows only if KV offload is on',
                },
              ]).map(opt => {
                const active = ctxMode === opt.id
                return (
                  <button key={opt.id} onClick={() => withProfileClear(setCtxMode)(opt.id)}
                    className={`flex-1 flex flex-col gap-1 px-3 py-2.5 rounded-sm border cursor-pointer transition-colors text-left ${
                      active ? 'border-accent/40 bg-accent-dim' : 'bg-elevated border-border hover:border-border-hover'
                    }`}>
                    <div className={`text-sm font-semibold ${active ? 'text-accent' : 'text-text-primary'}`}>{opt.label}</div>
                    <div className="text-2xs text-green leading-tight">+ {opt.pros}</div>
                    <div className="text-2xs text-text-muted leading-tight">− {opt.cons}</div>
                  </button>
                )
              })}
            </div>
            {ctxMode === 'fixed' && (
              <Slider label="Fixed context"
                value={Math.min(ctxLen, Math.max(2048, ctxMax))}
                min={2048} max={Math.max(2048, ctxMax)} step={2048}
                onChange={withProfileClear(setCtxLen)} formatValue={v => v.toLocaleString('en')} />
            )}
            {ctxMode === 'adaptive' && (
              <div className="flex items-center justify-between bg-elevated border border-border rounded-sm px-3 py-2">
                <span className="text-xs text-text-muted">Auto ctx cap:</span>
                <span className="text-xs font-mono text-accent font-semibold">
                  {resolvedCtx.toLocaleString('en')} tokens
                  {offloadKqv && <span className="text-green ml-1">(KV in RAM — larger ctx possible)</span>}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Context length — vLLM */}
        {engine === 'vllm' && (
          <>
            <Slider label="Context length"
              value={Math.min(ctxLen, Math.max(2048, ctxMax))}
              min={2048} max={Math.max(2048, ctxMax)} step={2048}
              onChange={setCtxLen} formatValue={v => v.toLocaleString('en')} />
            {ctxMax < (model.max_context_window ?? 131072) && (
              <div className="text-xs text-yellow">
                Max safe ctx at {gpuUtilPct}% util: {ctxMax.toLocaleString('en')} tokens
              </div>
            )}
          </>
        )}

        {/* KV Cache — llama.cpp only */}
        {engine === 'llama' && (
          <div className="flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-text-muted">KV Cache</div>

            {/* Quantization */}
            <div className="flex gap-2">
              {([
                { id: 'q8_0' as const, label: 'Q8_0', sub: '×0.5 VRAM · recommended', color: 'accent' },
                { id: 'q4_0' as const, label: 'Q4_0', sub: '×0.25 VRAM · long context', color: 'green' },
                { id: 'bf16' as const, label: 'BF16', sub: '×1.0 VRAM · max precision', color: 'text-muted' },
              ]).map(opt => {
                const active = kvQuant === opt.id
                const optKvGb = kvCacheGb(ctxMode === 'fixed' ? ctxLen : 2048, params) * (opt.id === 'bf16' ? 1 : opt.id === 'q8_0' ? 0.5 : 0.25)
                return (
                  <button key={opt.id} onClick={() => withProfileClear(setKvQuant)(opt.id)}
                    className={`flex-1 flex flex-col items-center gap-0.5 px-2 py-2 rounded-sm border cursor-pointer transition-colors text-center ${
                      active ? 'border-accent/40 bg-accent-dim' : 'bg-elevated border-border hover:border-border-hover'
                    }`}>
                    <span className={`text-sm font-semibold ${active ? 'text-accent' : 'text-text-primary'}`}>{opt.label}</span>
                    <span className="text-2xs text-text-muted leading-tight">{opt.sub}</span>
                    <span className={`text-2xs font-medium mt-0.5 ${active ? 'text-accent' : 'text-text-muted'}`}>
                      ~{optKvGb.toFixed(1)} GB
                    </span>
                  </button>
                )
              })}
            </div>

            {/* offload_kqv toggle */}
            <button onClick={() => withProfileClear(setOffloadKqv)(!offloadKqv)}
              className={`flex items-start gap-2.5 w-full px-3 py-2.5 rounded-sm border cursor-pointer transition-colors text-left ${
                offloadKqv ? 'border-green/40 bg-green/8' : 'border-border bg-elevated hover:border-border-hover'
              }`}>
              <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                offloadKqv ? 'border-green bg-green' : 'border-border'
              }`}>
                {offloadKqv && <svg className="w-2.5 h-2.5 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-medium ${offloadKqv ? 'text-green' : 'text-text-primary'}`}>
                    KV cache in system RAM
                  </span>
                  {offloadKqv && kvTotal > 0 && (
                    <span className="text-xs font-mono text-green flex-shrink-0">−{kvTotal.toFixed(1)} GB VRAM</span>
                  )}
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  + Frees VRAM equal to the full KV cache — big win on long context
                </div>
                <div className="text-xs text-text-muted">
                  − PCIe transfer per attention step — latency +5–15% on GPU-heavy workloads
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Batch size — llama.cpp only */}
        {engine === 'llama' && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2.5">Batch size</div>
            <div className="grid grid-cols-4 gap-2">
              {([
                {
                  val: 512 as const,
                  label: '512',
                  pros: 'Max prefill speed — ideal for long prompts',
                  cons: 'Highest activation memory (~0.5 GB extra)',
                  recommended: !model.is_moe,
                },
                {
                  val: 256 as const,
                  label: '256',
                  pros: 'Good balance — prefill stays fast',
                  cons: 'Slight memory reduction',
                  recommended: false,
                },
                {
                  val: 128 as const,
                  label: '128',
                  pros: 'Low VRAM — recommended for MoE',
                  cons: '~30% slower prefill on long prompts',
                  recommended: model.is_moe === true,
                },
                {
                  val: 64 as const,
                  label: '64',
                  pros: 'Minimal VRAM — last resort on tight budgets',
                  cons: '~50% slower prefill, visible on long prompts',
                  recommended: false,
                },
              ]).map(opt => {
                const active = nBatch === opt.val
                return (
                  <button key={opt.val} onClick={() => withProfileClear(setNBatch)(opt.val)}
                    className={`flex flex-col gap-1 px-2 py-2 rounded-sm border cursor-pointer transition-colors text-left ${
                      active ? 'border-accent/40 bg-accent-dim' : 'bg-elevated border-border hover:border-border-hover'
                    }`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-sm font-semibold font-mono ${active ? 'text-accent' : 'text-text-primary'}`}>{opt.label}</span>
                      {opt.recommended && (
                        <span className="text-2xs px-1 py-px rounded bg-accent/15 text-accent">rec</span>
                      )}
                    </div>
                    <div className="text-2xs text-green leading-tight">+ {opt.pros}</div>
                    <div className="text-2xs text-text-muted leading-tight">− {opt.cons}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Speculative decoding — llama.cpp only */}
      {engine === 'llama' && (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-text-muted">Speculative decoding</div>
          <div className="flex flex-col gap-1.5">
            {([
              {
                id: 'ngram' as const,
                label: 'N-gram lookup',
                badge: '~1.3x',
                pros: 'Zero VRAM, zero extra model — works on all hardware',
                cons: 'Only helps on repetitive / structured outputs',
                available: true,
              },
              {
                id: 'mtp' as const,
                label: 'MTP self-speculative',
                badge: '~1.5x',
                pros: 'Uses built-in prediction heads — no extra model or VRAM',
                cons: 'Requires MTP-capable GGUF (Qwen3, DeepSeek-V3)',
                available: mtpSupported === true,
                unavailableReason: mtpSupported === false ? 'GGUF does not contain MTP heads' : 'Checking…',
              },
              {
                id: 'draft_model' as const,
                label: 'Draft model',
                badge: '~2x',
                pros: 'Best speedup on coding & RAG tasks',
                cons: 'Requires a compatible smaller GGUF loaded in VRAM',
                available: true,
              },
              {
                id: 'off' as const,
                label: 'Disabled',
                badge: null,
                pros: 'Pure autoregressive — predictable behavior',
                cons: 'No speedup',
                available: true,
              },
            ]).map(opt => {
              const active = speculativeMode === opt.id
              const disabled = !opt.available
              return (
                <button key={opt.id}
                  onClick={() => !disabled && withProfileClear(setSpeculativeMode)(opt.id)}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-sm border text-left transition-colors ${
                    disabled ? 'opacity-40 cursor-not-allowed border-border bg-elevated' :
                    active ? 'border-accent/40 bg-accent-dim cursor-pointer' :
                    'border-border bg-elevated hover:border-border-hover cursor-pointer'
                  }`}>
                  <div className={`w-3.5 h-3.5 rounded-full border-2 mt-0.5 flex-shrink-0 ${
                    active ? 'border-accent bg-accent' : 'border-border'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${active ? 'text-accent' : 'text-text-primary'}`}>
                        {opt.label}
                      </span>
                      {opt.badge && (
                        <span className={`text-2xs px-1.5 py-px rounded font-mono font-semibold ${
                          active ? 'bg-accent/15 text-accent' : 'bg-elevated border border-border text-text-muted'
                        }`}>{opt.badge}</span>
                      )}
                    </div>
                    <div className="text-2xs text-green mt-0.5">+ {opt.pros}</div>
                    <div className="text-2xs text-text-muted">
                      {disabled ? `⚠ ${opt.unavailableReason}` : `− ${opt.cons}`}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Draft model path input */}
          {speculativeMode === 'draft_model' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-text-muted">Draft model path (absolute GGUF path)</label>
              <input
                type="text"
                value={draftModelPath}
                onChange={e => setDraftModelPath(e.target.value)}
                placeholder="/mnt/models/Qwen3-0.6B-Q4_K_M/model.gguf"
                className="w-full bg-elevated border border-border rounded-sm px-3 py-2 text-xs text-text-primary font-mono placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
              />
              <div className="text-2xs text-text-muted">
                Use a smaller model from the same family. Ex: Qwen3-0.6B for a Qwen3-8B target.
              </div>
            </div>
          )}

          {/* n_pred_tokens slider — visible for mtp and draft_model */}
          {(speculativeMode === 'mtp' || speculativeMode === 'draft_model') && (
            <Slider label="Tokens per speculative step"
              value={nPredTokens} min={2} max={16} step={2}
              onChange={setNPredTokens} formatValue={v => `${v} tokens`} />
          )}
        </div>
      )}

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

      {/* Tensor Parallel — vLLM only, shown when multi-GPU detected */}
      {engine === 'vllm' && gpuCount > 1 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2.5">
            Tensor Parallel
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2 bg-green/8 border border-green/30 rounded-sm px-3 py-2.5">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>
              </svg>
              <div>
                <div className="text-sm font-medium text-green">{gpuCount} GPUs detected</div>
                <div className="text-xs text-text-muted mt-0.5">
                  Model distributed across GPUs — throughput ×N, VRAM ×N available
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {Array.from({ length: gpuCount }, (_, i) => i + 1).map(n => {
                const active = tensorParallelSize === n
                return (
                  <button key={n} onClick={() => setTensorParallelSize(n)}
                    className={`flex-1 flex flex-col items-center gap-1 px-3 py-2.5 rounded-sm border cursor-pointer transition-colors ${
                      active ? 'border-green/50 bg-green/8' : 'border-border bg-elevated hover:border-border-hover'
                    }`}>
                    <span className={`text-sm font-semibold font-mono ${active ? 'text-green' : 'text-text-primary'}`}>
                      {n === 1 ? '×1' : `×${n}`}
                    </span>
                    <span className="text-2xs text-text-muted">
                      {n === 1 ? 'Single GPU' : `${n} GPUs`}
                    </span>
                    {n === gpuCount && n > 1 && (
                      <span className="text-2xs px-1 py-px rounded bg-green/15 text-green">max</span>
                    )}
                  </button>
                )
              })}
            </div>
            {tensorParallelSize > 1 && (
              <div className="text-xs text-text-muted">
                NCCL required (included in vLLM). All selected GPUs must be peer-accessible.
              </div>
            )}
          </div>
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

function VramBar({ totalGb, usedGb, weightsGb, kvGb, kvOffloadedGb, overheadGb, budgetGb, cudaFreeGib, isOom, engine }: {
  totalGb: number; usedGb: number; weightsGb: number; kvGb: number; kvOffloadedGb: number
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
        {kvGb > 0    && <Leg color={`${modelColor} opacity-60`} label="KV cache (VRAM)" val={`~${kvGb.toFixed(1)} GB`} />}
        {kvOffloadedGb > 0 && <Leg color="bg-green/60" label="KV cache (RAM)" val={`~${kvOffloadedGb.toFixed(1)} GB`} />}
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
          ⚠ Model may exceed VRAM — enable "Overflow to CPU" or KV offload to avoid crash
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
