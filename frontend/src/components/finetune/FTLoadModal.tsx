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

const SEQ_OPTIONS = [128, 256, 512, 1024, 2048] as const
const RANK_OPTIONS = [8, 16, 32, 64] as const
const BATCH_OPTIONS = [1, 2, 4] as const
const ACCUM_OPTIONS = [4, 8, 16] as const
const LR_OPTIONS = [1e-4, 2e-4, 5e-4] as const
const ALL_MODULES = ['q_proj', 'v_proj', 'k_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj']

export function FTLoadModal({
  modelId, modelName, paramsBillion, profileId, onClose, onJobCreated,
}: FTLoadModalProps): React.ReactElement {
  const [hw, setHw] = useState<FtRecommendedConfig | null>(null)
  const [config, setConfig] = useState<FtTrainingConfig | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const rec = await getRecommendedConfig(paramsBillion ?? undefined)
      setHw(rec)
      setConfig({ ...rec.recommended })
    } catch { /* ignore */ }
  }, [paramsBillion])

  useEffect(() => { void load() }, [load])

  const resetToRecommended = (): void => {
    if (!hw) return
    setConfig({ ...hw.recommended })
    setDirty(false)
  }

  const update = <K extends keyof FtTrainingConfig>(key: K, val: FtTrainingConfig[K]): void => {
    setConfig(c => c ? { ...c, [key]: val } : c)
    setDirty(true)
  }

  const handleStart = async (): Promise<void> => {
    if (!config) return
    setStarting(true)
    setError(null)
    try {
      const job = await createFinetuneJob({
        model_id: modelId,
        profile_id: profileId,
        ...config,
      })
      onJobCreated(job.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start job')
    } finally {
      setStarting(false)
    }
  }

  const vramLive = config
    ? `~${((config.lora_rank * 0.02) + (paramsBillion ?? 7) * 0.5 + 2).toFixed(1)} GB QLoRA`
    : null

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface border border-white/[0.06] rounded-xl w-[460px] max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <ModalHeader modelName={modelName} vramEstimate={hw?.qlora_vram_estimate_gb ?? null} />

        {hw && <HardwareSection hw={hw} />}

        {!hw && (
          <div className="px-5 py-3 text-xs text-text-muted animate-pulse">Detecting hardware…</div>
        )}

        {hw && config && (
          <ConfigSection
            hw={hw}
            config={config}
            advanced={advanced}
            dirty={dirty}
            onToggleAdvanced={() => setAdvanced(a => !a)}
            onUpdate={update}
            onReset={resetToRecommended}
            vramLive={vramLive}
          />
        )}

        {error && (
          <div className="mx-5 mb-3 text-xs text-red-400 bg-red-400/8 border border-red-400/15 rounded-sm px-3 py-2">
            {error}
          </div>
        )}

        <ModalFooter starting={starting} canStart={!!config} onCancel={onClose} onStart={handleStart} />
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ModalHeader({ modelName, vramEstimate }: { modelName: string; vramEstimate: number | null }): React.ReactElement {
  return (
    <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 border-b border-white/[0.06]">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Configure & Start</h2>
        <p className="text-xs text-text-muted mt-0.5 truncate max-w-[300px]">{modelName}</p>
      </div>
      {vramEstimate !== null && (
        <span className="text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 flex-shrink-0">
          {vramEstimate} GB QLoRA
        </span>
      )}
    </div>
  )
}

function HardwareSection({ hw }: { hw: FtRecommendedConfig }): React.ReactElement {
  return (
    <div className="px-5 py-3 border-b border-white/[0.06]">
      <p className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Hardware</p>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-primary truncate">{hw.gpu_name}</p>
          <p className="text-[10px] text-text-muted mt-0.5">{hw.vram_total_gb} GB VRAM</p>
        </div>
        {hw.has_gpu && (
          <span className={`text-[10px] px-2 py-0.5 rounded border flex-shrink-0 ${
            hw.model_fits
              ? 'bg-green-400/10 text-green-400 border-green-400/20'
              : 'bg-red-400/10 text-red-400 border-red-400/20'
          }`}>
            {hw.model_fits ? 'fits' : 'tight'}
          </span>
        )}
      </div>
      <p className="text-[10px] text-text-muted italic mt-1.5">{hw.rationale}</p>
    </div>
  )
}

interface ConfigSectionProps {
  hw: FtRecommendedConfig
  config: FtTrainingConfig
  advanced: boolean
  dirty: boolean
  onToggleAdvanced: () => void
  onUpdate: <K extends keyof FtTrainingConfig>(k: K, v: FtTrainingConfig[K]) => void
  onReset: () => void
  vramLive: string | null
}

function ConfigSection({
  hw, config, advanced, dirty, onToggleAdvanced, onUpdate, onReset, vramLive,
}: ConfigSectionProps): React.ReactElement {
  return (
    <div className="px-5 py-3">
      {!advanced ? (
        <SimpleConfig hw={hw} config={config} onToggleAdvanced={onToggleAdvanced} />
      ) : (
        <AdvancedConfig
          config={config}
          dirty={dirty}
          onUpdate={onUpdate}
          onReset={onReset}
          onToggleAdvanced={onToggleAdvanced}
        />
      )}
      {vramLive && (
        <p className="mt-3 text-[10px] text-text-muted border-t border-white/[0.04] pt-3">
          Estimated VRAM: {vramLive}
          {hw.has_gpu ? ` · fits your ${hw.vram_total_gb} GB GPU` : ' · CPU mode'}
        </p>
      )}
    </div>
  )
}

function SimpleConfig({
  hw, config, onToggleAdvanced,
}: { hw: FtRecommendedConfig; config: FtTrainingConfig; onToggleAdvanced: () => void }): React.ReactElement {
  return (
    <div>
      <div className="bg-accent/8 border border-accent/15 rounded-md p-3 mb-3">
        <p className="text-xs text-accent font-medium">Optimal settings for {hw.gpu_name.split(' ').slice(0, 3).join(' ')}</p>
        <p className="text-[10px] text-text-muted mt-0.5">{hw.rationale}</p>
      </div>
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {[
          ['seq_length', config.max_seq_length],
          ['batch_size', config.per_device_train_batch_size],
          ['lora_rank', config.lora_rank],
          ['epochs', config.num_epochs],
          ['lr', config.learning_rate],
          ['optim', config.optim],
        ].map(([k, v]) => (
          <div key={String(k)} className="flex justify-between bg-white/[0.03] rounded px-2 py-1">
            <span className="text-text-muted">{String(k)}</span>
            <span className="text-text-secondary font-mono">{String(v)}</span>
          </div>
        ))}
      </div>
      <button onClick={onToggleAdvanced} className="mt-3 text-[10px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer">
        Advanced settings
      </button>
    </div>
  )
}

interface AdvancedConfigProps {
  config: FtTrainingConfig
  dirty: boolean
  onUpdate: <K extends keyof FtTrainingConfig>(k: K, v: FtTrainingConfig[K]) => void
  onReset: () => void
  onToggleAdvanced: () => void
}

function AdvancedConfig({ config, dirty, onUpdate, onReset, onToggleAdvanced }: AdvancedConfigProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onToggleAdvanced} className="text-[10px] text-text-muted hover:text-text-secondary cursor-pointer transition-colors">
          Simple mode
        </button>
        {dirty && (
          <button onClick={onReset} className="text-[10px] text-accent hover:text-accent/80 cursor-pointer transition-colors">
            Reset to recommended
          </button>
        )}
      </div>

      <FieldRow label="Max sequence length">
        <ToggleGroup
          options={SEQ_OPTIONS as unknown as number[]}
          value={config.max_seq_length}
          onChange={v => onUpdate('max_seq_length', v)}
        />
      </FieldRow>

      <FieldRow label="LoRA Rank">
        <ToggleGroup
          options={RANK_OPTIONS as unknown as number[]}
          value={config.lora_rank}
          onChange={v => onUpdate('lora_rank', v as FtTrainingConfig['lora_rank'])}
        />
      </FieldRow>

      <FieldRow label="Alpha">
        <input
          type="number" min={1} max={256}
          value={config.lora_alpha}
          onChange={e => onUpdate('lora_alpha', Number(e.target.value))}
          className="w-20 bg-elevated border border-white/[0.08] rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent/40"
        />
      </FieldRow>

      <FieldRow label="Target modules">
        <div className="flex flex-wrap gap-1.5">
          {ALL_MODULES.map(m => (
            <label key={m} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={config.target_modules.includes(m)}
                onChange={e => {
                  const next = e.target.checked
                    ? [...config.target_modules, m]
                    : config.target_modules.filter(x => x !== m)
                  onUpdate('target_modules', next)
                }}
                className="w-3 h-3 accent-accent"
              />
              <span className="text-[10px] text-text-muted font-mono">{m}</span>
            </label>
          ))}
        </div>
      </FieldRow>

      <FieldRow label="Batch size">
        <ToggleGroup
          options={BATCH_OPTIONS as unknown as number[]}
          value={config.per_device_train_batch_size}
          onChange={v => onUpdate('per_device_train_batch_size', v)}
        />
      </FieldRow>

      <FieldRow label="Gradient accumulation">
        <ToggleGroup
          options={ACCUM_OPTIONS as unknown as number[]}
          value={config.gradient_accumulation_steps}
          onChange={v => onUpdate('gradient_accumulation_steps', v)}
        />
      </FieldRow>

      <FieldRow label={`Epochs: ${config.num_epochs}`}>
        <input
          type="range" min={1} max={10} step={1}
          value={config.num_epochs}
          onChange={e => onUpdate('num_epochs', Number(e.target.value))}
          className="w-full accent-accent"
        />
      </FieldRow>

      <FieldRow label="Learning rate">
        <ToggleGroup
          options={LR_OPTIONS as unknown as number[]}
          value={config.learning_rate}
          display={v => String(v)}
          onChange={v => onUpdate('learning_rate', v)}
        />
      </FieldRow>

      <FieldRow label="Optimizer">
        <select
          value={config.optim}
          onChange={e => onUpdate('optim', e.target.value)}
          className="bg-elevated border border-white/[0.08] rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent/40"
        >
          {['adamw_8bit', 'adamw', 'sgd'].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </FieldRow>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex items-start gap-3">
      <span className="text-[10px] text-text-muted w-32 pt-1 flex-shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
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
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer ${
            o === value
              ? 'bg-accent/20 text-accent border border-accent/30'
              : 'bg-white/[0.04] text-text-muted hover:bg-white/[0.07] border border-transparent'
          }`}
        >
          {display ? display(o) : String(o)}
        </button>
      ))}
    </div>
  )
}

function ModalFooter({ starting, canStart, onCancel, onStart }: {
  starting: boolean; canStart: boolean; onCancel: () => void; onStart: () => void
}): React.ReactElement {
  return (
    <div className="px-5 pb-5 pt-3 flex gap-2 border-t border-white/[0.04]">
      <button
        onClick={onStart}
        disabled={starting || !canStart}
        className="flex-1 py-2 bg-accent/20 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-accent text-xs rounded cursor-pointer transition-colors"
      >
        {starting ? 'Starting…' : 'Start Training'}
      </button>
      <button
        onClick={onCancel}
        className="flex-1 py-2 text-text-muted hover:text-text-secondary text-xs rounded border border-white/[0.06] cursor-pointer transition-colors"
      >
        Cancel
      </button>
    </div>
  )
}
