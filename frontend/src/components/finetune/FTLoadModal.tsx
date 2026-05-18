import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getVramEstimate, createFinetuneJob } from '@/api/client'
import type { FinetuneConfig, FinetuneJob, ModelInfo } from '@/types'

const TARGET_MODULES_OPTIONS = ['q_proj', 'v_proj', 'k_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj']
const LORA_RANKS = [8, 16, 32, 64] as const
const LR_OPTIONS = [1e-4, 2e-4, 5e-4] as const

interface FTLoadModalProps {
  model: ModelInfo
  vramTotalGb: number
  onStarted: (job: FinetuneJob) => void
  onClose: () => void
}

export function FTLoadModal({ model, vramTotalGb, onStarted, onClose }: FTLoadModalProps): React.ReactElement {
  const [vramGb, setVramGb] = useState<number | null>(null)
  const [rank, setRank] = useState<8 | 16 | 32 | 64>(16)
  const [alpha, setAlpha] = useState(16)
  const [targetModules, setTargetModules] = useState<Set<string>>(new Set(['q_proj', 'v_proj']))
  const [epochs, setEpochs] = useState(3)
  const [lr, setLr] = useState<number>(2e-4)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!model.params_billion) return
    getVramEstimate(model.params_billion)
      .then(r => setVramGb(r.vram_gb))
      .catch(() => {})
  }, [model.params_billion])

  const fits = vramGb !== null ? vramGb < vramTotalGb * 0.9 : null

  const toggleModule = (m: string): void => {
    setTargetModules(prev => {
      const next = new Set(prev)
      next.has(m) ? next.delete(m) : next.add(m)
      return next
    })
  }

  const handleStart = async (): Promise<void> => {
    setStarting(true)
    setError(null)
    const config: FinetuneConfig = {
      model_id: model.id,
      model_path: model.id,
      lora_rank: rank,
      lora_alpha: alpha,
      target_modules: Array.from(targetModules),
      num_epochs: epochs,
      learning_rate: lr,
    }
    try {
      const job = await createFinetuneJob(config)
      onStarted(job)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start job')
    } finally {
      setStarting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="bg-surface border border-border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <div className="text-sm font-medium text-text-primary">{model.name ?? model.id.split('/').pop()}</div>
              <div className="text-xs text-text-muted mt-0.5">{model.author} · {model.params_billion ? `${model.params_billion}B params` : 'unknown size'}</div>
            </div>
            <div className="flex items-center gap-2">
              {fits !== null && (
                <span className={`text-xs px-2 py-0.5 rounded-sm font-medium ${fits ? 'bg-green/15 text-green' : 'bg-red-400/15 text-red-400'}`}>
                  {vramGb?.toFixed(1)} GB QLoRA · {fits ? 'fits' : 'tight'}
                </span>
              )}
              <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-sm text-text-muted hover:text-text-primary hover:bg-overlay cursor-pointer transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <div className="px-5 py-4 flex flex-col gap-5">
            <ConfigSection label="LoRA Rank">
              <div className="flex gap-1.5">
                {LORA_RANKS.map(r => (
                  <button
                    key={r}
                    onClick={() => { setRank(r); setAlpha(r) }}
                    className={`px-3 py-1.5 text-xs rounded-sm border cursor-pointer transition-colors ${
                      rank === r ? 'bg-accent/15 border-accent/40 text-accent' : 'border-border text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </ConfigSection>

            <ConfigSection label={`Alpha (${alpha})`}>
              <input
                type="number"
                value={alpha}
                min={1}
                max={256}
                onChange={e => setAlpha(Number(e.target.value))}
                className="w-24 bg-elevated border border-border focus:border-accent rounded-sm px-2.5 py-1.5 text-sm text-text-primary outline-none transition-colors"
              />
            </ConfigSection>

            <ConfigSection label="Target modules">
              <div className="flex flex-wrap gap-1.5">
                {TARGET_MODULES_OPTIONS.map(m => (
                  <button
                    key={m}
                    onClick={() => toggleModule(m)}
                    className={`px-2.5 py-1 text-xs rounded-sm border cursor-pointer transition-colors font-mono ${
                      targetModules.has(m) ? 'bg-accent/15 border-accent/40 text-accent' : 'border-border text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </ConfigSection>

            <ConfigSection label={`Epochs (${epochs})`}>
              <input
                type="range"
                min={1}
                max={10}
                value={epochs}
                onChange={e => setEpochs(Number(e.target.value))}
                className="w-40 accent-accent"
              />
            </ConfigSection>

            <ConfigSection label="Learning rate">
              <div className="flex gap-1.5">
                {LR_OPTIONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setLr(r)}
                    className={`px-3 py-1.5 text-xs rounded-sm border cursor-pointer transition-colors font-mono ${
                      lr === r ? 'bg-accent/15 border-accent/40 text-accent' : 'border-border text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {r.toExponential(0)}
                  </button>
                ))}
              </div>
            </ConfigSection>

            {error && <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-sm px-3 py-2">{error}</div>}

            <button
              onClick={handleStart}
              disabled={starting || targetModules.size === 0}
              className="w-full py-2.5 text-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-sm cursor-pointer transition-colors font-medium"
            >
              {starting ? 'Starting…' : 'Start Training'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function ConfigSection({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-text-muted uppercase tracking-widest font-medium">{label}</div>
      {children}
    </div>
  )
}
