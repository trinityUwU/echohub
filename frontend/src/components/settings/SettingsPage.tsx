import { useState } from 'react'
import { Toggle } from '@/components/shared/Toggle'
import { Btn } from '@/components/shared/Btn'
import { EnginesTab } from './EnginesTab'

type Section = 'setup' | 'engines' | 'hardware' | 'models' | 'about'

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'setup',    label: 'Setup',    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { id: 'engines',  label: 'Engines',  icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'hardware', label: 'Hardware', icon: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18' },
  { id: 'models',   label: 'Models',   icon: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20' },
  { id: 'about',    label: 'About',    icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 7v4m0 4h.01' },
]

export function SettingsPage(): React.ReactElement {
  const [section, setSection] = useState<Section>('setup')

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="h-[54px] bg-surface border-b border-border flex items-center px-5 flex-shrink-0">
        <span className="text-md font-semibold">Settings</span>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <nav className="w-[200px] border-r border-border p-2 flex-shrink-0">
          {NAV.map(item => (
            <button key={item.id} onClick={() => setSection(item.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-sm text-sm cursor-pointer transition-colors ${
                section === item.id ? 'bg-accent-dim text-accent' : 'text-text-secondary hover:bg-overlay'
              }`}
            >
              <svg className="w-[15px] h-[15px] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon}/>
              </svg>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto px-7 py-6">
          {section === 'setup'    && <SetupSection />}
          {section === 'engines'  && <EnginesTab />}
          {section === 'hardware' && <HardwareSection />}
          {section === 'models'   && <ModelsSection />}
          {section === 'about'    && <AboutSection />}
        </div>
      </div>
    </div>
  )
}

function SetupSection(): React.ReactElement {
  return (
    <>
      <SettingsGroup title="Installation" desc="EchoHub auto-installs inference engines based on your hardware.">
        <SetupCard title="llama-cpp-python (CUDA)" status="ok" desc="Primary inference engine. GGUF models. CUDA backend compiled for RTX 3060 (arch 86)." />
        <SetupCard title="vLLM" status="ok" desc="Optional engine for AWQ/GPTQ models. NVIDIA only. Higher throughput." />
        <SetupCard title="Python environment" status="warn" desc={<>Isolated venv at <code className="font-mono text-xs bg-white/7 px-1 py-px rounded-sm">backend/.venv</code></>} />
      </SettingsGroup>
      <SettingsGroup title="Hugging Face" desc="Required for gated models and faster downloads.">
        <SettingsRow label="HF Token" desc="Access gated models (Llama, Gemma…)">
          <input type="password" defaultValue="hf_••••••••••••••" className="w-[200px] bg-elevated border border-border focus:border-border-hover rounded-sm px-2.5 py-1.5 text-sm font-mono text-text-primary outline-none transition-colors" />
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}

function HardwareSection(): React.ReactElement {
  return (
    <SettingsGroup title="GPU" desc="Detected hardware configuration.">
      <SettingsRow label="GPU" desc="Primary inference device">
        <span className="text-sm font-mono text-text-secondary">NVIDIA RTX 3060</span>
      </SettingsRow>
      <SettingsRow label="VRAM" desc="Total GPU memory">
        <span className="text-sm font-mono text-text-secondary">12 GB</span>
      </SettingsRow>
      <SettingsRow label="Flash Attention" desc="Requires compatible GPU">
        <Toggle on={true} onChange={() => {}} />
      </SettingsRow>
    </SettingsGroup>
  )
}

function ModelsSection(): React.ReactElement {
  return (
    <SettingsGroup title="Model Storage" desc="Where downloaded models are stored.">
      <SettingsRow label="Models directory" desc="Default: /mnt/models/echohub">
        <input type="text" defaultValue="/mnt/models/echohub" className="w-[200px] bg-elevated border border-border rounded-sm px-2.5 py-1.5 text-sm font-mono text-text-primary outline-none focus:border-border-hover transition-colors" />
        <Btn>Browse</Btn>
      </SettingsRow>
      <SettingsRow label="Keep model in memory" desc="Prevent auto-unload on new chat">
        <Toggle on={false} onChange={() => {}} />
      </SettingsRow>
    </SettingsGroup>
  )
}

function AboutSection(): React.ReactElement {
  return (
    <SettingsGroup title="EchoHub" desc="">
      <SettingsRow label="Version" desc=""><span className="text-sm font-mono text-text-secondary">0.1.0</span></SettingsRow>
      <SettingsRow label="License" desc=""><span className="text-sm text-text-secondary">MIT</span></SettingsRow>
      <SettingsRow label="GitHub" desc="">
        <span className="text-sm text-accent">github.com/trinityUwU/echohub</span>
      </SettingsRow>
    </SettingsGroup>
  )
}

function SettingsGroup({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mb-7">
      <h2 className="text-[15px] font-semibold text-text-primary mb-1">{title}</h2>
      {desc && <p className="text-sm text-text-muted mb-4">{desc}</p>}
      {children}
    </div>
  )
}

function SettingsRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex justify-between items-center py-3 border-b border-border last:border-b-0">
      <div>
        <div className="text-sm text-text-primary">{label}</div>
        {desc && <div className="text-xs text-text-muted mt-0.5">{desc}</div>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
    </div>
  )
}

function SetupCard({ title, status, desc }: { title: string; status: 'ok' | 'warn' | 'error'; desc: React.ReactNode }): React.ReactElement {
  const statusStyle = { ok: 'bg-green/15 text-green', warn: 'bg-yellow/12 text-yellow', error: 'bg-red/12 text-red' }
  const statusLabel = { ok: 'installed', warn: 'check', error: 'error' }
  return (
    <div className="bg-elevated border border-border rounded-md p-4 mb-2.5">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusStyle[status]}`}>{statusLabel[status]}</span>
      </div>
      <p className="text-sm text-text-muted leading-relaxed">{desc}</p>
    </div>
  )
}
