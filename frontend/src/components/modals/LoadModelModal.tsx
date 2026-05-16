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

export function LoadModelModal({ model, vramTotalGb, vramUsedGb, onConfirm, onCancel }: LoadModelModalProps): React.ReactElement {
  const [gpuUtil, setGpuUtil] = useState(0.80)
  const [ctxLen, setCtxLen] = useState(Math.min(model.max_context_window ?? 16384, 16384))
  const [check, setCheck] = useState<CanLoadResult | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    setChecking(true)
    canLoadModel(model.id, gpuUtil, ctxLen)
      .then(setCheck)
      .catch(() => setCheck(null))
      .finally(() => setChecking(false))
  }, [model.id]) // only on mount — sliders don't re-trigger the check

  const vramEst = check?.vram_estimate_gb ?? model.vram_estimate_gb ?? 0
  // KV cache grows with context — rough estimate: +0.5GB per 16k tokens for 7-8B models
  const kvExtra = Math.max(0, (ctxLen - 4096) / 16384) * 0.5
  const modelVram = vramEst + kvExtra
  const freeVram = Math.max(0, vramTotalGb - vramUsedGb - modelVram)
  const isOom = modelVram > (vramTotalGb - vramUsedGb) * gpuUtil
  const canSubmit = !checking && (check?.feasible ?? false) && !isOom

  const engine = check?.engine ?? (model.quantization?.toLowerCase().includes('gguf') ? 'llama' : 'vllm')
  const engineLabel = engine === 'llama' ? 'llama.cpp' : 'vLLM'

  return (
    <Modal
      title="Load model"
      onClose={onCancel}
      footer={
        <>
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={!canSubmit}
            onClick={() => onConfirm({ gpuMemoryUtilization: gpuUtil, maxModelLen: ctxLen })}
          >
            {checking ? 'Checking…' : 'Load model'}
          </Btn>
        </>
      }
    >
      {/* Model + engine badge */}
      <div className="bg-elevated border border-border rounded-sm px-3 py-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">{model.name}</span>
        <span className={`text-2xs px-1.5 py-0.5 rounded ${engine === 'llama' ? 'bg-green/15 text-green' : 'bg-blue/15 text-blue'}`}>
          {engineLabel} · {check?.format?.toUpperCase() ?? model.quantization ?? '?'}
        </span>
      </div>

      {/* Infeasibility warning */}
      {check && !check.feasible && (
        <div className="flex items-start gap-2 bg-red/8 border border-red/25 rounded-sm px-3 py-2.5 text-sm text-red">
          <svg className="w-4 h-4 flex-shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{check.reason}</span>
        </div>
      )}

      {/* VRAM preview */}
      <VramPreview
        usedPct={Math.min((vramUsedGb / vramTotalGb) * 100, 100)}
        modelPct={Math.min((modelVram / vramTotalGb) * 100, 100)}
        modelGb={modelVram}
        freeGb={freeVram}
        totalGb={vramTotalGb}
        isOom={isOom}
      />

      {/* Parameters */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2.5">Parameters</div>
        {engine === 'vllm' && (
          <Slider label="GPU memory utilization" value={gpuUtil} min={0.5} max={0.95} step={0.01} onChange={setGpuUtil} />
        )}
        <Slider
          label="Context length"
          value={ctxLen}
          min={2048}
          max={Math.min(model.max_context_window ?? 131072, 131072)}
          step={2048}
          onChange={setCtxLen}
          formatValue={v => v.toLocaleString('en')}
        />
        {engine === 'llama' && (
          <div className="text-xs text-text-muted mt-1">
            GPU memory utilization is managed automatically by llama.cpp
          </div>
        )}
      </div>
    </Modal>
  )
}

function VramPreview({ usedPct, modelPct, modelGb, freeGb, totalGb, isOom }: {
  usedPct: number; modelPct: number; modelGb: number; freeGb: number; totalGb: number; isOom: boolean
}): React.ReactElement {
  const systemGb = Math.max(0, totalGb - freeGb - modelGb)
  return (
    <div className="bg-elevated border border-border rounded-sm p-3">
      <div className="text-xs text-text-muted mb-2">VRAM preview</div>
      <div className="h-2 bg-overlay rounded flex overflow-hidden mb-2">
        <div className="h-full bg-white/10 rounded-sm" style={{ width: `${usedPct}%` }} />
        <div className={`h-full rounded-sm ml-px transition-all ${isOom ? 'bg-red' : 'bg-accent'}`} style={{ width: `${Math.min(modelPct, 100 - usedPct)}%` }} />
      </div>
      <div className="flex gap-3 text-xs text-text-muted">
        <LegendItem color="bg-white/15" label={`System ${systemGb.toFixed(1)} GB`} />
        <LegendItem color={isOom ? 'bg-red' : 'bg-accent'} label={`Model ~${modelGb.toFixed(1)} GB`} />
        <LegendItem color="bg-overlay" label={`Free ${freeGb.toFixed(1)} GB`} />
        {isOom && <span className="text-red ml-auto font-medium">⚠ OOM</span>}
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
