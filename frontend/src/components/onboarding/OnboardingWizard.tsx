import { useEffect, useState } from 'react'
import { completeOnboarding, listEngines, getPaths, getGpuStats } from '@/api/client'
import type { GpuStats } from '@/types'

// ── Icon components (no emojis) ──────────────────────────────────────────────

function WelcomeIcon({ name }: { name: string }): React.ReactElement {
  const cls = "w-5 h-5 text-accent"
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  if (name === 'lock') return <svg className={cls} viewBox="0 0 24 24" {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
  if (name === 'zap') return <svg className={cls} viewBox="0 0 24 24" {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
  if (name === 'wifi-off') return <svg className={cls} viewBox="0 0 24 24" {...p}><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
  return <svg className={cls} viewBox="0 0 24 24" {...p}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
}

function CompatIcon({ name }: { name: string }): React.ReactElement {
  const p = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  if (name === 'check') return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" {...p} strokeWidth={2.5}><polyline points="20 6 9 17 4 12"/></svg>
  if (name === 'warn') return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" {...p} strokeWidth={2}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
  return <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" {...p} strokeWidth={2.5}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
}

function StorageIcon({ name }: { name: string }): React.ReactElement {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  if (name === 'model') return <svg className="w-4 h-4" viewBox="0 0 24 24" {...p}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
  if (name === 'engine') return <svg className="w-4 h-4" viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
  return <svg className="w-4 h-4" viewBox="0 0 24 24" {...p}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
}


interface OnboardingWizardProps {
  onComplete: () => void
}

const STEPS = ['welcome', 'storage', 'hardware', 'engines', 'compatibility', 'done'] as const
type Step = typeof STEPS[number]

export function OnboardingWizard({ onComplete }: OnboardingWizardProps): React.ReactElement {
  const [step, setStep] = useState<Step>('welcome')
  const [gpu, setGpu] = useState<GpuStats | null>(null)
  const [paths, setPaths] = useState<{ models_dir: string; vllm_envs_dir: string; user_data_dir: string } | null>(null)
  const [engines, setEngines] = useState<{ versions: Array<{ version: string; operational: boolean; size_gb: number }>; operational_count: number } | null>(null)

  useEffect(() => {
    getGpuStats().then(setGpu).catch(() => {})
    getPaths().then(setPaths).catch(() => {})
    listEngines().then(setEngines).catch(() => {})
  }, [])

  const next = (): void => {
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1])
  }

  const finish = async (): Promise<void> => {
    await completeOnboarding().catch(() => {})
    onComplete()
  }

  const stepIdx = STEPS.indexOf(step)
  const progress = Math.round((stepIdx / (STEPS.length - 1)) * 100)

  return (
    <div className="fixed inset-0 z-[300] bg-base flex items-center justify-center p-8">
      <div className="w-[640px] max-h-[90vh] flex flex-col">

        <div className="h-0.5 bg-overlay rounded-full overflow-hidden mb-8 mx-2">
          <div className="h-full bg-accent transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        <div className="flex-1 overflow-y-auto px-2">
          {step === 'welcome'       && <StepWelcome onNext={next} />}
          {step === 'storage'       && <StepStorage paths={paths} onNext={next} />}
          {step === 'hardware'      && <StepHardware gpu={gpu} onNext={next} />}
          {step === 'engines'       && <StepEngines engines={engines} onNext={next} />}
          {step === 'compatibility' && <StepCompatibility onNext={next} />}
          {step === 'done'          && <StepDone onFinish={finish} />}
        </div>

        <div className="flex justify-center gap-2 mt-8">
          {STEPS.map((s, i) => (
            <div key={s} className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
              i === stepIdx ? 'bg-accent' : i < stepIdx ? 'bg-accent/40' : 'bg-overlay'
            }`} />
          ))}
        </div>
      </div>
    </div>
  )
}

function StepWelcome({ onNext }: { onNext: () => void }): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center flex-shrink-0">
          <svg className="w-6 h-6" viewBox="0 0 20 20" fill="none">
            <path d="M3 10 C3 5.5 6.5 2 11 2 s8 3.5 8 8 -3.5 8-8 8" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
            <circle cx="7" cy="10" r="1.3" fill="white"/>
            <circle cx="11" cy="10" r="1.3" fill="white"/>
            <circle cx="15" cy="10" r="1.3" fill="white"/>
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Welcome to EchoHub</h1>
          <p className="text-sm text-text-muted mt-0.5">Your local AI — no cloud, no subscription, no compromise</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { icon: 'lock', title: '100% local', desc: 'Models run on your GPU. Nothing leaves your machine.' },
          { icon: 'zap', title: 'One click', desc: 'Search, download, and chat. No configuration needed.' },
          { icon: 'wifi-off', title: 'Offline capable', desc: 'Once downloaded, models work without internet.' },
          { icon: 'code', title: 'Open source', desc: 'MIT license. You own your data and your setup.' },
        ].map(({ icon, title, desc }) => (
          <div key={title} className="bg-elevated border border-border rounded-md p-4">
            <div className="mb-2"><WelcomeIcon name={icon} /></div>
            <div className="text-sm font-semibold text-text-primary mb-1">{title}</div>
            <div className="text-xs text-text-muted leading-relaxed">{desc}</div>
          </div>
        ))}
      </div>

      <NavButtons onNext={onNext} nextLabel="Get started" showSkip={false} />
    </div>
  )
}

function StepStorage({ paths, onNext }: { paths: { models_dir: string; vllm_envs_dir: string; user_data_dir: string } | null; onNext: () => void }): React.ReactElement {
  return (
    <div className="flex flex-col gap-5">
      <StepHeader step="2/6" title="Storage" subtitle="EchoHub stores files in two main locations. Here's what to expect." />
      <div className="flex flex-col gap-3">
        <StorageItem icon="model" title="AI Models" path={paths?.models_dir ?? '/mnt/models/echohub'} desc="Downloaded model files. Each model is 2–70 GB. Change this in Settings → Paths." badge="2–70 GB per model" badgeColor="text-blue" />
        <StorageItem icon="engine" title="vLLM Environments" path={paths?.vllm_envs_dir ?? '~/.local/share/echohub/vllm-envs'} desc="One isolated environment per vLLM version. Add more later for compatibility with specific models." badge="~7 GB per version" badgeColor="text-yellow" />
        <StorageItem icon="data" title="App Data" path={paths?.user_data_dir ?? '~/.local/share/echohub'} desc="Conversations, settings, state. Very small." badge="< 50 MB" badgeColor="text-green" />
      </div>
      <div className="bg-yellow/7 border border-yellow/20 rounded-sm px-4 py-3 text-sm text-yellow/90">
        Plan for at least 20–30 GB of free disk space to get started comfortably.
      </div>
      <NavButtons onNext={onNext} />
    </div>
  )
}

function StepHardware({ gpu, onNext }: { gpu: GpuStats | null; onNext: () => void }): React.ReactElement {
  const hasGpu = !!gpu
  const vramGb = gpu ? Math.round(gpu.vram_total_mb / 1024) : 0
  const maxModel = vramGb >= 24 ? '70B' : vramGb >= 12 ? '13B' : vramGb >= 8 ? '8B' : '4B'

  return (
    <div className="flex flex-col gap-5">
      <StepHeader step="3/6" title="Your hardware" subtitle="EchoHub adapts to whatever you have." />
      <div className={`border rounded-md p-4 ${hasGpu ? 'border-green/25 bg-green/5' : 'border-yellow/25 bg-yellow/5'}`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${hasGpu ? 'bg-green/15' : 'bg-yellow/15'}`}>
            <svg className={`w-4 h-4 ${hasGpu ? 'text-green' : 'text-yellow'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {hasGpu ? <polyline points="20 6 9 17 4 12"/> : <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>}
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-text-primary">{hasGpu ? gpu!.name : 'No GPU detected'}</div>
            <div className="text-xs text-text-muted">{hasGpu ? `${vramGb} GB VRAM — up to ${maxModel} models` : 'CPU inference only'}</div>
          </div>
        </div>
        <div className="text-xs text-text-secondary leading-relaxed">
          {hasGpu
            ? `GPU detected. You can run GGUF models via llama-cpp and AWQ/GPTQ models via vLLM. With ${vramGb} GB VRAM, you can comfortably run models up to ${maxModel} parameters.`
            : 'No NVIDIA GPU found. EchoHub will run models on CPU via llama-cpp. Inference will be slow (2–5 tok/s). An NVIDIA GPU with 8+ GB VRAM is recommended.'}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        {[
          { label: 'GGUF models', ok: true, desc: 'All platforms' },
          { label: 'AWQ/GPTQ', ok: hasGpu, desc: 'NVIDIA only' },
          { label: 'Flash Attention', ok: hasGpu, desc: 'Ampere GPU+' },
        ].map(({ label, ok, desc }) => (
          <div key={label} className="bg-elevated border border-border rounded-sm p-3">
            <div className={`font-medium mb-0.5 ${ok ? 'text-text-primary' : 'text-text-muted'}`}>{label}</div>
            <div className="text-text-muted mb-2">{desc}</div>
            <div className={`text-xs font-medium ${ok ? 'text-green' : 'text-text-muted'}`}>{ok ? 'Available' : 'Unavailable'}</div>
          </div>
        ))}
      </div>
      <NavButtons onNext={onNext} />
    </div>
  )
}

function StepEngines({ engines, onNext }: { engines: { versions: Array<{ version: string; operational: boolean; size_gb: number }>; operational_count: number } | null; onNext: () => void }): React.ReactElement {
  const versions = engines?.versions ?? []
  return (
    <div className="flex flex-col gap-5">
      <StepHeader step="4/6" title="Inference engines" subtitle="Multiple vLLM versions live side by side — EchoHub picks the right one automatically." />
      <div className="bg-elevated border border-border rounded-md p-4 text-sm text-text-secondary leading-relaxed">
        Different models require different vLLM versions. EchoHub installs them in isolated environments so they never conflict. You start with one and can add more later — no downtime, no breaking changes.
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2">Currently installed</div>
        {versions.length === 0 ? (
          <div className="text-sm text-yellow bg-yellow/7 border border-yellow/20 rounded-sm px-4 py-3">No vLLM environment found yet. Install one in Settings → Engines.</div>
        ) : versions.map(v => (
          <div key={v.version} className="flex items-center gap-3 py-2.5 border-b border-border/50 last:border-b-0">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${v.operational ? 'bg-green' : 'bg-red'}`} />
            <span className="text-sm font-mono text-text-primary flex-1">vLLM {v.version}</span>
            <span className="text-xs text-text-muted">{v.size_gb} GB</span>
            <span className={`text-xs ${v.operational ? 'text-green' : 'text-red'}`}>{v.operational ? 'operational' : 'not working'}</span>
          </div>
        ))}
      </div>
      <div className="bg-accent/5 border border-accent/20 rounded-sm px-4 py-3 text-xs text-text-secondary leading-relaxed">
        Add versions anytime in <strong className="text-text-primary">Settings → Engines</strong>. Each takes ~7 GB and 10–30 min to install.
      </div>
      <NavButtons onNext={onNext} />
    </div>
  )
}

function StepCompatibility({ onNext }: { onNext: () => void }): React.ReactElement {
  return (
    <div className="flex flex-col gap-5">
      <StepHeader step="5/6" title="Model compatibility" subtitle="EchoHub checks compatibility before you download anything — no surprises." />
      <div className="flex flex-col gap-3">
        {[
          { color: 'text-green', bg: 'bg-green/8 border-green/20', icon: 'check', title: 'Fully compatible', desc: 'Works with your current engine. Download and use immediately.' },
          { color: 'text-yellow', bg: 'bg-yellow/8 border-yellow/20', icon: 'warn', title: 'Needs a different vLLM version', desc: 'One-click install of the required version. 10–30 min. Happens in the background.' },
          { color: 'text-red', bg: 'bg-red/8 border-red/20', icon: 'cross', title: 'No compatible engine exists yet', desc: 'EchoHub says so clearly and suggests alternatives (e.g. GGUF version of the same model).' },
        ].map(({ color, bg, icon, title, desc }) => (
          <div key={title} className={`border rounded-sm px-4 py-3 ${bg}`}>
            <div className={`flex items-center gap-2 text-sm font-semibold ${color} mb-1`}>
              <CompatIcon name={icon} />
              {title}
            </div>
            <div className="text-xs text-text-secondary leading-relaxed">{desc}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-text-muted">The check runs automatically when you open a model — before you download anything.</div>
      <NavButtons onNext={onNext} />
    </div>
  )
}

function StepDone({ onFinish }: { onFinish: () => void }): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-6 py-8 text-center">
      <div className="w-16 h-16 bg-green/15 rounded-full flex items-center justify-center">
        <svg className="w-8 h-8 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div>
        <h2 className="text-2xl font-bold text-text-primary mb-2">You're ready</h2>
        <p className="text-sm text-text-muted max-w-sm leading-relaxed">Go to Discover, find a model, download it, load it, and start chatting. That's it.</p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs text-xs text-text-muted text-left">
        <div className="flex items-center gap-2"><span className="text-accent">→</span> Settings → Engines to manage vLLM versions</div>
        <div className="flex items-center gap-2"><span className="text-accent">→</span> Settings → Paths to change storage locations</div>
        <div className="flex items-center gap-2"><span className="text-accent">→</span> Settings → Hardware to tune inference options</div>
      </div>
      <button onClick={onFinish} className="px-8 py-3 bg-accent hover:bg-accent-hover text-white rounded-md font-semibold text-sm cursor-pointer transition-colors mt-2">
        Open EchoHub →
      </button>
    </div>
  )
}

function StepHeader({ step, title, subtitle }: { step: string; title: string; subtitle: string }): React.ReactElement {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-1">Step {step}</div>
      <h2 className="text-xl font-bold text-text-primary mb-1">{title}</h2>
      <p className="text-sm text-text-muted">{subtitle}</p>
    </div>
  )
}

function StorageItem({ icon, title, path, desc, badge, badgeColor }: { icon: string; title: string; path: string; desc: string; badge: string; badgeColor: string }): React.ReactElement {
  return (
    <div className="bg-elevated border border-border rounded-md p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StorageIcon name={icon} />
          <span className="text-sm font-semibold text-text-primary">{title}</span>
        </div>
        <span className={`text-xs font-medium ${badgeColor}`}>{badge}</span>
      </div>
      <div className="font-mono text-xs text-text-muted bg-[#0d0d10] rounded-sm px-2 py-1.5 mb-2 truncate">{path}</div>
      <div className="text-xs text-text-muted leading-relaxed">{desc}</div>
    </div>
  )
}

function NavButtons({ onNext, nextLabel = 'Next', showSkip = true }: { onNext: () => void; nextLabel?: string; showSkip?: boolean }): React.ReactElement {
  return (
    <div className="flex justify-between items-center pt-2">
      {showSkip ? (
        <button onClick={onNext} className="text-sm text-text-muted hover:text-text-secondary cursor-pointer transition-colors">Skip</button>
      ) : <div />}
      <button onClick={onNext} className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-sm font-medium text-sm cursor-pointer transition-colors">
        {nextLabel} →
      </button>
    </div>
  )
}
