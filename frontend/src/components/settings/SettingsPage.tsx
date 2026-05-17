import { useEffect, useState } from 'react'
import { getInferenceSettings, setInferenceSetting } from '@/api/client'
import { apiRequest } from '@/api/base'
import { Toggle } from '@/components/shared/Toggle'
import { EnginesTab } from './EnginesTab'
import { PathsTab } from './PathsTab'
import { BenchmarkTab } from './BenchmarkTab'

type Section = 'setup' | 'engines' | 'benchmark' | 'paths' | 'hardware' | 'models' | 'about'

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'setup',    label: 'Setup',    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { id: 'engines',   label: 'Engines',   icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'benchmark', label: 'Benchmark', icon: 'M18 20V10M12 20V4M6 20v-6' },
  { id: 'hardware', label: 'Hardware', icon: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18' },
  { id: 'paths',    label: 'Paths',    icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
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
          {section === 'engines'   && <EnginesTab />}
          {section === 'benchmark' && <BenchmarkTab />}
          {section === 'paths'    && <PathsTab />}
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
        <HfTokenRow />
      </SettingsGroup>
    </>
  )
}

function HfTokenRow(): React.ReactElement {
  const [token, setToken] = useState("")
  const [status, setStatus] = useState<"idle"|"saving"|"validating"|"ok"|"error">("idle")
  const [message, setMessage] = useState("")
  const [preview, setPreview] = useState("")

  useEffect(() => {
    apiRequest<{token_set: boolean; token_preview: string}>("/settings/hf-token")
      .then(r => { if (r.token_set) setPreview(r.token_preview) })
      .catch(() => {})
  }, [])

  const save = async (): Promise<void> => {
    setStatus("saving")
    try {
      await apiRequest("/settings/hf-token", { method: "POST", body: JSON.stringify({ token }) })
      setStatus("validating")
      setMessage("Validating…")
      const v = await apiRequest<{valid: boolean; reason: string|null; username: string|null}>("/settings/hf-token/validate")
      if (v.valid) {
        setStatus("ok")
        setMessage(`✓ Connected as ${v.username}`)
        setPreview(token.slice(0, 6) + "…" + token.slice(-4))
        setToken("")
      } else {
        setStatus("error")
        setMessage(v.reason ?? "Invalid token")
      }
    } catch {
      setStatus("error")
      setMessage("Failed to save")
    }
  }

  return (
    <SettingsRow label="HF Token" desc={preview ? `Active: ${preview}` : "Access gated models (Llama, Gemma…)"}>
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex gap-2">
          <input type="password" value={token} onChange={e => setToken(e.target.value)}
            onKeyDown={e => e.key === "Enter" && token && save()}
            placeholder="hf_…"
            className="w-[180px] bg-elevated border border-border focus:border-accent rounded-sm px-2.5 py-1.5 text-sm font-mono text-text-primary outline-none transition-colors" />
          <button onClick={save} disabled={!token || status === "saving" || status === "validating"}
            className="px-3 py-1.5 text-xs rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-white cursor-pointer transition-colors">
            {status === "saving" || status === "validating" ? "…" : "Save"}
          </button>
        </div>
        {message && (
          <span className={`text-xs ${status === "ok" ? "text-green" : status === "error" ? "text-red" : "text-text-muted"}`}>
            {message}
          </span>
        )}
      </div>
    </SettingsRow>
  )
}

function HardwareSection(): React.ReactElement {
  const [settings, setSettings] = useState<{ flash_attn: boolean; keep_model_in_memory: boolean; gpu: { name: string; vram_gb: number } } | null>(null)

  useEffect(() => {
    getInferenceSettings().then(setSettings).catch(() => {})
  }, [])

  const toggle = async (key: string, val: boolean): Promise<void> => {
    setSettings(prev => prev ? { ...prev, [key]: val } : prev)
    await setInferenceSetting(key, val).catch(() => {})
  }

  return (
    <>
      <SettingsGroup title="GPU" desc="Detected hardware.">
        <SettingsRow label="GPU" desc="Primary inference device">
          <span className="text-sm font-mono text-text-secondary">{settings?.gpu.name ?? '—'}</span>
        </SettingsRow>
        <SettingsRow label="VRAM" desc="Total GPU memory">
          <span className="text-sm font-mono text-text-secondary">{settings ? `${settings.gpu.vram_gb} GB` : '—'}</span>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Inference" desc="Applied at next model load.">
        <SettingsRow label="Flash Attention" desc="Faster inference, slightly less VRAM. Requires NVIDIA Ampere+.">
          <Toggle on={settings?.flash_attn ?? true} onChange={v => toggle('flash_attn', v)} />
        </SettingsRow>
        <SettingsRow label="Keep model in memory" desc="Don't unload when starting a new chat.">
          <Toggle on={settings?.keep_model_in_memory ?? false} onChange={v => toggle('keep_model_in_memory', v)} />
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}

function ModelsSection(): React.ReactElement {
  return (
    <SettingsGroup title="Model Storage" desc="Managed in Settings → Paths.">
      <SettingsRow label="Models directory" desc="">
        <span className="text-sm text-text-muted text-xs">See Paths tab</span>
      </SettingsRow>
    </SettingsGroup>
  )
}

function AboutSection(): React.ReactElement {
  const [resetting, setResetting] = useState(false)
  const [done, setDone] = useState(false)

  const resetOnboarding = async (): Promise<void> => {
    setResetting(true)
    try {
      await apiRequest('/settings/onboarding/reset', { method: 'POST' })
      setDone(true)
      setTimeout(() => window.location.reload(), 1200)
    } catch { /* ignore */ }
    finally { setResetting(false) }
  }

  return (
    <SettingsGroup title="EchoHub" desc="">
      <SettingsRow label="Version" desc=""><span className="text-sm font-mono text-text-secondary">0.2.0</span></SettingsRow>
      <SettingsRow label="License" desc=""><span className="text-sm text-text-secondary">MIT</span></SettingsRow>
      <SettingsRow label="GitHub" desc="">
        <a href="https://github.com/trinityUwU/echohub" target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline cursor-pointer">
          github.com/trinityUwU/echohub
        </a>
      </SettingsRow>
      <SettingsRow label="Onboarding tutorial" desc="Replay the setup guide">
        <button onClick={resetOnboarding} disabled={resetting || done}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm border border-border hover:bg-overlay text-text-secondary cursor-pointer transition-colors disabled:opacity-50">
          {done ? '✓ Reloading…' : resetting ? 'Resetting…' : 'Replay tutorial'}
        </button>
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
