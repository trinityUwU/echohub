import { useEffect, useState } from 'react'
import { getInferenceSettings, setInferenceSetting, checkForUpdates, runUpdate, saveChangelog, getGithubToken, setGithubToken } from '@/api/client'
import { apiRequest } from '@/api/base'
import { Toggle } from '@/components/shared/Toggle'
import { EnginesTab } from './EnginesTab'
import { PathsTab } from './PathsTab'
import { BenchmarkTab } from './BenchmarkTab'

type Section = 'setup' | 'engines' | 'benchmark' | 'paths' | 'hardware' | 'about'

const NAV: { id: Section; label: string; icon: string }[] = [
  { id: 'setup',    label: 'Setup',    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { id: 'engines',   label: 'Engines',   icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { id: 'benchmark', label: 'Benchmark', icon: 'M18 20V10M12 20V4M6 20v-6' },
  { id: 'hardware', label: 'Hardware', icon: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18' },
  { id: 'paths',    label: 'Paths',    icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },

  { id: 'about',    label: 'About',    icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 7v4m0 4h.01' },
]

interface SettingsPageProps {
  initialTab?: Section
}

export function SettingsPage({ initialTab }: SettingsPageProps): React.ReactElement {
  const [section, setSection] = useState<Section>(initialTab ?? 'setup')

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
      <SettingsGroup title="GitHub" desc="Optional — increases Skills search rate limit from 60 to 5000 requests/hour.">
        <GithubTokenRow />
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

function GithubTokenRow(): React.ReactElement {
  const [token, setToken] = useState("")
  const [status, setStatus] = useState<"idle"|"saving"|"ok"|"error">("idle")
  const [preview, setPreview] = useState("")

  useEffect(() => {
    getGithubToken().then(r => { if (r.token_set) setPreview(r.token_preview) }).catch(() => {})
  }, [])

  const save = async (): Promise<void> => {
    setStatus("saving")
    try {
      await setGithubToken(token)
      setStatus("ok")
      setPreview(token ? `ghp_...${token.slice(-4)}` : "")
      setToken("")
    } catch {
      setStatus("error")
    }
  }

  return (
    <SettingsRow label="GitHub Token" desc={preview ? `Active: ${preview}` : "Optional — 5000 req/h vs 60 unauthenticated"}>
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex gap-2">
          <input type="password" value={token} onChange={e => setToken(e.target.value)}
            onKeyDown={e => e.key === "Enter" && token && save()}
            placeholder="ghp_…"
            className="w-[180px] bg-elevated border border-border focus:border-accent rounded-sm px-2.5 py-1.5 text-sm font-mono text-text-primary outline-none transition-colors" />
          <button onClick={save} disabled={!token || status === "saving"}
            className="px-3 py-1.5 text-xs rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-white cursor-pointer transition-colors">
            {status === "saving" ? "…" : "Save"}
          </button>
        </div>
        {status === "ok" && <span className="text-xs text-green">Token saved</span>}
        {status === "error" && <span className="text-xs text-red">Failed to save</span>}
      </div>
    </SettingsRow>
  )
}

function HardwareSection(): React.ReactElement {
  const [settings, setSettings] = useState<{ flash_attn: boolean; keep_model_in_memory: boolean; gpu: { name: string; vram_gb: number; type: string }; gpu_vram_limit_gb: number | null; gpu_util_limit_pct: number | null; cpu_threads: number | null } | null>(null)

  useEffect(() => {
    getInferenceSettings().then(s => setSettings(s as typeof s & { gpu_vram_limit_gb: number|null; gpu_util_limit_pct: number|null; cpu_threads: number|null })).catch(() => {})
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
      <SettingsGroup title="Resource limits" desc="Cap VRAM and GPU utilization. Applies to all model loads. Leave blank to use all available resources.">
        <SettingsRow label="VRAM limit" desc={`Available: ${settings?.gpu.vram_gb ?? '?'} GB — set a lower cap if you share the GPU`}>
          <div className="flex items-center gap-2">
            <input
              type="number" min="1" max={settings?.gpu.vram_gb ?? 24} step="0.5"
              value={settings?.gpu_vram_limit_gb ?? ''}
              onChange={e => {
                const v = e.target.value ? parseFloat(e.target.value) : null
                setSettings(prev => prev ? { ...prev, gpu_vram_limit_gb: v } : prev)
                setInferenceSetting('gpu_vram_limit_gb', v as number).catch(() => {})
              }}
              placeholder="e.g. 8"
              className="w-20 bg-elevated border border-border focus:border-accent rounded-sm px-2.5 py-1.5 text-sm font-mono text-text-primary outline-none transition-colors"
            />
            <span className="text-xs text-text-muted">GB</span>
          </div>
        </SettingsRow>
        <SettingsRow label="Max GPU utilization" desc="Sets the ceiling for vLLM memory allocation">
          <div className="flex items-center gap-2">
            <input
              type="number" min="50" max="95" step="1"
              value={settings?.gpu_util_limit_pct ?? ''}
              onChange={e => {
                const v = e.target.value ? parseInt(e.target.value) : null
                setSettings(prev => prev ? { ...prev, gpu_util_limit_pct: v } : prev)
                setInferenceSetting('gpu_util_limit_pct', v as number).catch(() => {})
              }}
              placeholder="e.g. 80"
              className="w-20 bg-elevated border border-border focus:border-accent rounded-sm px-2.5 py-1.5 text-sm font-mono text-text-primary outline-none transition-colors"
            />
            <span className="text-xs text-text-muted">%</span>
          </div>
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}


function AboutSection(): React.ReactElement {
  const [resetting, setResetting] = useState(false)
  const [updateState, setUpdateState] = useState<{
    checking: boolean; result: string | null
    available: boolean; commitsBehind: number; changelog: string[]
    updating: boolean; done: boolean; success: boolean
    logs: Array<{ level: string; msg: string }>
  }>({ checking: false, result: null, available: false, commitsBehind: 0, changelog: [], updating: false, done: false, success: false, logs: [] })

  const resetOnboarding = async (): Promise<void> => {
    setResetting(true)
    try {
      await apiRequest('/settings/onboarding/reset', { method: 'POST' })
      setTimeout(() => window.location.reload(), 800)
    } catch { setResetting(false) }
  }

  const checkUpdates = async (): Promise<void> => {
    setUpdateState(s => ({ ...s, checking: true, result: null }))
    try {
      const r = await checkForUpdates()
      if (r.error) {
        setUpdateState(s => ({ ...s, checking: false, result: 'Could not check — verify your internet connection.' }))
      } else if (r.up_to_date) {
        setUpdateState(s => ({ ...s, checking: false, result: `Up to date (${r.local_sha})`, available: false }))
      } else {
        setUpdateState(s => ({ ...s, checking: false, available: true, commitsBehind: r.commits_behind, changelog: r.changelog, result: null }))
      }
    } catch {
      setUpdateState(s => ({ ...s, checking: false, result: 'Check failed.' }))
    }
  }

  const applyUpdate = (): void => {
    setUpdateState(s => ({ ...s, updating: true, logs: [] }))
    runUpdate(
      line => setUpdateState(s => ({ ...s, logs: [...s.logs, line] })),
      result => {
        setUpdateState(s => ({ ...s, updating: false, done: true, success: result.success }))
        if (result.success) saveChangelog(updateState.changelog).catch(() => {})
      }
    )
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
      <SettingsRow label="Updates" desc={updateState.result ?? (updateState.available ? `${updateState.commitsBehind} update${updateState.commitsBehind > 1 ? 's' : ''} available` : 'Check for new commits on GitHub')}>
        <div className="flex items-center gap-2">
          {updateState.available && !updateState.updating && !updateState.done && (
            <button onClick={applyUpdate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm bg-accent hover:bg-accent-hover text-white cursor-pointer transition-colors font-medium">
              Update now
            </button>
          )}
          {updateState.updating && (
            <span className="flex items-center gap-1.5 text-xs text-accent">
              <span className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />Updating…
            </span>
          )}
          {updateState.done && updateState.success && (
            <button onClick={() => window.location.reload()}
              className="px-3 py-1.5 text-xs rounded-sm bg-green/15 border border-green/30 text-green cursor-pointer transition-colors font-medium">
              Restart now →
            </button>
          )}
          <button onClick={checkUpdates} disabled={updateState.checking || updateState.updating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm border border-border hover:bg-overlay text-text-secondary cursor-pointer transition-colors disabled:opacity-50">
            {updateState.checking ? (
              <><span className="w-3 h-3 border-2 border-text-muted/30 border-t-text-muted rounded-full animate-spin" />Checking…</>
            ) : 'Check for updates'}
          </button>
        </div>
      </SettingsRow>
      {(updateState.updating || updateState.done) && updateState.logs.length > 0 && (
        <div className="px-4 pb-3">
          <div className="bg-[#0a0a0d] border border-border rounded-sm p-2.5 font-mono text-xs leading-relaxed max-h-32 overflow-y-auto">
            {updateState.logs.map((line, i) => (
              <div key={i} className={line.level === 'ok' ? 'text-green' : line.level === 'error' ? 'text-red' : line.level === 'step' ? 'text-accent font-semibold' : 'text-[#6b7280]'}>
                {line.level === 'step' ? `▶ ${line.msg}` : line.msg}
              </div>
            ))}
          </div>
        </div>
      )}
      <SettingsRow label="Onboarding tutorial" desc="Replay the setup guide">
        <button onClick={resetOnboarding} disabled={resetting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm border border-border hover:bg-overlay text-text-secondary cursor-pointer transition-colors disabled:opacity-50">
          {resetting ? 'Reloading…' : 'Replay tutorial'}
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
