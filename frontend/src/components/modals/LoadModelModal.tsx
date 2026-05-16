import { useState } from 'react'
import { Modal } from '@/components/shared/Modal'
import { Slider } from '@/components/shared/Slider'
import { Btn } from '@/components/shared/Btn'
import type { ModelInfo } from '@/types'

interface LoadModelModalProps {
  model: ModelInfo
  vramTotalGb: number
  vramUsedGb: number
  onConfirm: (cfg: { gpuMemoryUtilization: number; maxModelLen: number | null }) => void
  onCancel: () => void
}

export function LoadModelModal({ model, vramTotalGb, vramUsedGb, onConfirm, onCancel }: LoadModelModalProps): React.ReactElement {
  const [gpuUtil, setGpuUtil] = useState(0.85)
  const [ctxLen, setCtxLen] = useState(16384)
  const maxCtx = model.max_context_window ?? 131072

  const modelVram = (model.vram_estimate_gb ?? 4.8) + (ctxLen / 16384) * 0.3
  const freeVram = Math.max(0, vramTotalGb - vramUsedGb - modelVram)
  const vramPct = Math.min((modelVram / vramTotalGb) * 100, 100)
  const usedPct = Math.min((vramUsedGb / vramTotalGb) * 100, 100)
  const isOom = modelVram + vramUsedGb > vramTotalGb * gpuUtil

  const engine = model.quantization?.startsWith('GGUF') ? 'llama.cpp' : 'vLLM'

  return (
    <Modal
      title="Load model"
      onClose={onCancel}
      footer={
        <>
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" disabled={isOom} onClick={() => onConfirm({ gpuMemoryUtilization: gpuUtil, maxModelLen: ctxLen })}>
            Load model
          </Btn>
        </>
      }
    >
      <div className="bg-elevated border border-border rounded-sm px-3 py-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">{model.name}</span>
        <span className="text-2xs px-1.5 py-0.5 rounded bg-blue/15 text-blue">{engine} · {model.quantization ?? 'AWQ'}</span>
      </div>

      <VramPreview usedPct={usedPct} modelPct={vramPct} modelGb={modelVram} freeGb={freeVram} totalGb={vramTotalGb} isOom={isOom} />

      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2.5">Parameters</div>
        <Slider label="GPU memory utilization" value={gpuUtil} min={0.5} max={0.95} step={0.01} onChange={setGpuUtil} />
        <Slider label="Context length" value={ctxLen} min={2048} max={maxCtx} step={2048} onChange={setCtxLen}
          formatValue={v => v.toLocaleString('en')} />
      </div>

      <LogBox />
    </Modal>
  )
}

function VramPreview({ usedPct, modelPct, modelGb, freeGb, totalGb, isOom }: {
  usedPct: number; modelPct: number; modelGb: number; freeGb: number; totalGb: number; isOom: boolean
}): React.ReactElement {
  return (
    <div className="bg-elevated border border-border rounded-sm p-3">
      <div className="text-xs text-text-muted mb-2">VRAM preview</div>
      <div className="h-2 bg-overlay rounded flex overflow-hidden mb-2">
        <div className="h-full bg-white/10 rounded-sm" style={{ width: `${usedPct}%` }} />
        <div className={`h-full rounded-sm ml-px transition-all ${isOom ? 'bg-red' : 'bg-accent'}`} style={{ width: `${modelPct}%` }} />
      </div>
      <div className="flex gap-3 text-xs text-text-muted">
        <LegendItem color="bg-white/15" label={`System ${(totalGb - freeGb - modelGb).toFixed(1)} GB`} />
        <LegendItem color={isOom ? 'bg-red' : 'bg-accent'} label={`Model ${modelGb.toFixed(1)} GB`} />
        <LegendItem color="bg-overlay" label={`Free ${freeGb.toFixed(1)} GB`} />
        {isOom && <span className="text-red ml-auto">⚠ OOM risk</span>}
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

function LogBox(): React.ReactElement {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2">vLLM log</div>
      <div className="bg-[#0a0a0d] border border-border rounded-sm p-3 font-mono text-xs leading-relaxed text-[#6b7280] h-[110px] overflow-y-auto">
        <div className="text-green">INFO  Initializing engine...</div>
        <div>INFO  Loading model weights...</div>
        <div className="text-green">INFO  Loading safetensors checkpoint... done (3.2s)</div>
        <div>INFO  Profiling CUDA graphs (ctx=16384)...</div>
        <div className="text-yellow">WARN  CUDA graph profiling may take up to 30s</div>
        <div>INFO  Memory pool: 9.8 GB allocated<span className="animate-blink">█</span></div>
      </div>
    </div>
  )
}
