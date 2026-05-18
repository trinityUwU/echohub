import { useState, useEffect, useCallback } from 'react'
import type { FtRecommendedConfig, FtTrainingConfig } from '@/types'
import { getRecommendedConfig, createFinetuneJob } from '@/api/client'

interface FTLoadModalProps {
  modelId: string
  modelName: string
  paramsBillion: number | null
  profileId: string | null
  onClose: () => void
  onJobCreated: (jobId: string) => void
}

const SEQ_OPTIONS   = [128, 256, 512, 1024, 2048] as const
const RANK_OPTIONS  = [8, 16, 32, 64] as const
const BATCH_OPTIONS = [1, 2, 4] as const
const ACCUM_OPTIONS = [4, 8, 16] as const
const LR_OPTIONS    = [1e-4, 2e-4, 5e-4] as const
const ALL_MODULES   = ['q_proj', 'v_proj', 'k_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj']
const OPTIM_OPTIONS = ['adamw_8bit', 'adamw', 'sgd']

function estimateVram(paramsBillion: number, rank: number, seqLen: number, cpuOffloadGb: number): number {
  const modelGb  = paramsBillion * 0.5       // QLoRA 4bit base (8bit if offload)
  const loraGb   = rank * 0.015
  const activGb  = (seqLen / 512) * 0.8
  const total    = modelGb + loraGb + activGb + 1.5
  return Math.round(Math.max(total - cpuOffloadGb, 1.0) * 10) / 10
}

function VramBar({ used, total }: { used: number; total: number }): React.ReactElement {
  const pct   = total > 0 ? Math.min((used / total) * 100, 100) : 0
  const fits  = total === 0 || used <= total * 0.92
  const barColor = pct > 90 ? '#f87171' : pct > 70 ? '#eab308' : '#4ade80'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">VRAM estimate</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-text-primary">
            {used} GB <span className="text-text-muted">/ {total > 0 ? total : '?'} GB</span>
          </span>
          <span style={{ backgroundColor: `${barColor}20`, color: barColor }}
            className="text-[10px] px-1.5 py-0.5 rounded font-medium">
            {fits ? 'fits' : 'OOM risk'}
          </span>
        </div>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
    </div>
  )
}

export function FTLoadModal({
  modelId, modelName, paramsBillion, profileId, onClose, onJobCreated,
}: FTLoadModalProps): React.ReactElement {
  const [hw, setHw]         = useState<FtRecommendedConfig | null>(null)
  const [config, setConfig] = useState<FtTrainingConfig | null>(null)
  const [dirty, setDirty]   = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const rec = await getRecommendedConfig(paramsBillion ?? undefined)
      setHw(rec)
      setConfig({ ...rec.recommended })
    } catch { /* ignore */ }
  }, [paramsBillion])

  useEffect(() => { void load() }, [load])

  const update = <K extends keyof FtTrainingConfig>(key: K, val: FtTrainingConfig[K]): void => {
    setConfig(c => c ? { ...c, [key]: val } : c)
    setDirty(true)
  }

  const resetToRecommended = (): void => {
    if (!hw) return
    setConfig({ ...hw.recommended })
    setDirty(false)
  }

  const handleStart = async (): Promise<void> => {
    if (!config) return
    setStarting(true); setError(null)
    try {
      const job = await createFinetuneJob({ model_id: modelId, profile_id: profileId, ...config })
      onJobCreated(job.id); onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start job')
    } finally { setStarting(false) }
  }

  const vramUsed = config && paramsBillion
    ? estimateVram(paramsBillion, config.lora_rank, config.max_seq_length, config.cpu_offload_gb)
    : null
  const maxOffload = hw ? Math.floor(hw.ram_free_gb * 0.7) : 0

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-white/[0.06] rounded-xl w-[500px] max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-white/[0.06] flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Configure & Start</h2>
            <p className="text-xs text-text-muted mt-0.5 truncate max-w-[340px]">{modelName}</p>
          </div>
          {hw && (
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-text-primary">{hw.gpu_name.split(' ').slice(0, 4).join(' ')}</p>
              <p className="text-[10px] text-text-muted">{hw.vram_total_gb} GB VRAM · {hw.ram_free_gb} GB RAM free</p>
            </div>
          )}
        </div>

        {!hw && (
          <div className="px-5 py-6 text-xs text-text-muted animate-pulse">Detecting hardware…</div>
        )}

        {hw && config && (
          <div className="px-5 py-4 flex flex-col gap-4">
            {/* Recommended banner */}
            {!dirty && (
              <div className="bg-accent/8 border border-accent/15 rounded-md px-3 py-2">
                <p className="text-xs text-accent font-medium">Optimal for {hw.gpu_name.split(' ').slice(0,3).join(' ')}</p>
                <p className="text-[10px] text-text-muted/70 mt-0.5">{hw.rationale}</p>
              </div>
            )}
            {dirty && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-muted">Custom configuration</span>
                <button onClick={resetToRecommended}
                  className="text-[10px] text-accent hover:text-accent/80 cursor-pointer transition-colors">
                  Reset to recommended
                </button>
              </div>
            )}

            {/* Warn if VRAM is likely occupied by a loaded model */}
            {hw.vram_total_gb > 0 && hw.qlora_vram_estimate_gb !== null &&
             hw.qlora_vram_estimate_gb > hw.vram_total_gb * 0.6 && (
              <div className="bg-yellow/8 border border-yellow/20 rounded-md px-3 py-2 text-[10px] text-yellow">
                If a model is loaded in EchoHub, it will be automatically unloaded before training starts to free VRAM.
              </div>
            )}

            {/* VRAM bar */}
            {vramUsed !== null && (
              <VramBar used={vramUsed} total={hw.vram_total_gb} />
            )}

            {/* Parameters grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <ParamRow label="Sequence length">
                <ToggleGroup options={SEQ_OPTIONS as unknown as number[]} value={config.max_seq_length}
                  onChange={v => update('max_seq_length', v)} />
              </ParamRow>

              <ParamRow label="LoRA rank">
                <ToggleGroup options={RANK_OPTIONS as unknown as number[]} value={config.lora_rank}
                  onChange={v => update('lora_rank', v as FtTrainingConfig['lora_rank'])} />
              </ParamRow>

              <ParamRow label={`Alpha · ${config.lora_alpha}`}>
                <ToggleGroup options={RANK_OPTIONS as unknown as number[]} value={config.lora_alpha}
                  onChange={v => update('lora_alpha', v)} />
              </ParamRow>

              <ParamRow label="Epochs">
                <div className="flex items-center gap-2">
                  <input type="range" min={1} max={10} step={1} value={config.num_epochs}
                    onChange={e => update('num_epochs', Number(e.target.value))}
                    className="w-24 accent-accent" />
                  <span className="text-xs text-text-primary font-mono w-4">{config.num_epochs}</span>
                </div>
              </ParamRow>

              <ParamRow label="Batch size">
                <ToggleGroup options={BATCH_OPTIONS as unknown as number[]} value={config.per_device_train_batch_size}
                  onChange={v => update('per_device_train_batch_size', v)} />
              </ParamRow>

              <ParamRow label="Gradient accum.">
                <ToggleGroup options={ACCUM_OPTIONS as unknown as number[]} value={config.gradient_accumulation_steps}
                  onChange={v => update('gradient_accumulation_steps', v)} />
              </ParamRow>

              <ParamRow label="Learning rate">
                <ToggleGroup options={LR_OPTIONS as unknown as number[]} value={config.learning_rate}
                  display={v => v.toExponential(0)} onChange={v => update('learning_rate', v)} />
              </ParamRow>

              <ParamRow label="Optimizer">
                <div className="flex gap-1 flex-wrap">
                  {OPTIM_OPTIONS.map(o => (
                    <button key={o} onClick={() => update('optim', o)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer border ${
                        o === config.optim
                          ? 'bg-accent/20 border-accent/30 text-accent'
                          : 'bg-white/[0.03] border-white/[0.06] text-text-muted hover:border-white/[0.12] hover:text-text-secondary'
                      }`}>
                      {o}
                    </button>
                  ))}
                </div>
              </ParamRow>
            </div>

            {/* CPU RAM offload */}
            <div className="border-t border-white/[0.04] pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <div>
                  <p className="text-[10px] text-text-muted uppercase tracking-wider">CPU RAM offload</p>
                  <p className="text-[10px] text-text-muted/50 mt-0.5">
                    {config.cpu_offload_gb === 0
                      ? 'GPU only — fastest, may OOM on large models'
                      : `${config.cpu_offload_gb} GB offloaded to RAM — uses 8bit instead of 4bit, slower`}
                  </p>
                </div>
                <span className="text-xs font-mono text-text-primary flex-shrink-0">
                  {config.cpu_offload_gb} GB
                </span>
              </div>
              <input type="range" min={0} max={maxOffload} step={1}
                value={config.cpu_offload_gb}
                onChange={e => update('cpu_offload_gb', Number(e.target.value))}
                className="w-full accent-accent" />
              <div className="flex justify-between text-[10px] text-text-muted/40 mt-0.5">
                <span>0 GB (GPU only)</span>
                {hw && <span>{maxOffload} GB max ({hw.ram_free_gb} GB free)</span>}
              </div>
            </div>

            {/* Target modules */}
            <div>
              <p className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Target modules</p>
              <div className="flex flex-wrap gap-2">
                {ALL_MODULES.map(m => {
                  const active = config.target_modules.includes(m)
                  return (
                    <button key={m} onClick={() => {
                      const next = active
                        ? config.target_modules.filter(x => x !== m)
                        : [...config.target_modules, m]
                      update('target_modules', next)
                    }}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer border ${
                        active
                          ? 'bg-accent/15 border-accent/30 text-accent'
                          : 'bg-white/[0.03] border-white/[0.06] text-text-muted hover:border-white/[0.12]'
                      }`}>
                      {m}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Effective batch size hint */}
            <p className="text-[10px] text-text-muted">
              Effective batch size: {config.per_device_train_batch_size * config.gradient_accumulation_steps} samples/step
            </p>
          </div>
        )}

        {error && (
          <div className="mx-5 mb-3 text-xs text-red-400 bg-red-400/8 border border-red-400/15 rounded-sm px-3 py-2">{error}</div>
        )}

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 flex gap-2 border-t border-white/[0.04]">
          <button onClick={handleStart} disabled={starting || !config}
            className="flex-1 py-2 bg-accent/20 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-accent text-xs rounded cursor-pointer transition-colors font-medium">
            {starting ? 'Starting…' : 'Start Training'}
          </button>
          <button onClick={onClose}
            className="flex-1 py-2 text-text-muted hover:text-text-secondary text-xs rounded border border-white/[0.06] cursor-pointer transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function ParamRow({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] text-text-muted uppercase tracking-wider">{label}</span>
      {children}
    </div>
  )
}

interface ToggleGroupProps {
  options: number[]
  value: number
  onChange: (v: number) => void
  display?: (v: number) => string
}

function ToggleGroup({ options, value, onChange, display }: ToggleGroupProps): React.ReactElement {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)}
          className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer border ${
            o === value
              ? 'bg-accent/20 border-accent/30 text-accent'
              : 'bg-white/[0.03] border-white/[0.06] text-text-muted hover:border-white/[0.12] hover:text-text-secondary'
          }`}>
          {display ? display(o) : String(o)}
        </button>
      ))}
    </div>
  )
}
