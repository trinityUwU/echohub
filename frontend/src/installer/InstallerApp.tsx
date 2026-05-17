import React, { useEffect, useState } from 'react'

import { apiRequest, apiUrl } from '@/api/base'

type Step = 'welcome' | 'paths' | 'installing' | 'done'

interface InstallConfig {
  models_dir: string
  user_data_dir: string
}

interface LogLine { level: 'info' | 'ok' | 'warn' | 'error' | 'step'; msg: string }

export function InstallerApp(): React.ReactElement {
  const [step, setStep] = useState<Step>('welcome')
  const [config, setConfig] = useState<InstallConfig>({
    models_dir: '',
    user_data_dir: '',
  })
  const [logs, setLogs] = useState<LogLine[]>([])
  const [installing, setInstalling] = useState(false)
  
  const [defaults, setDefaults] = useState<InstallConfig | null>(null)

  useEffect(() => {
    // Load platform defaults
    apiRequest<{ models_dir: string; user_data_dir: string }>('/settings/paths')
      .then(p => {
        setDefaults({ models_dir: p.models_dir, user_data_dir: p.user_data_dir })
        setConfig({ models_dir: p.models_dir, user_data_dir: p.user_data_dir })
      })
      .catch(() => {})
  }, [])

  const startInstall = async (): Promise<void> => {
    setStep('installing')
    setInstalling(true)
    setLogs([])

    // Save config first
    try {
      await apiRequest('/settings/paths/models-dir', { method: 'POST', body: JSON.stringify({ path: config.models_dir }) })
    } catch {}

    // Stream installation logs via fetch ReadableStream (more reliable in Tauri webview)
    const url = await apiUrl('/installer/run')
    try {
      const res = await fetch(url)
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (value) buf += decoder.decode(value, { stream: !done })
        const blocks = buf.split('\n\n')
        buf = done ? '' : (blocks.pop() ?? '')
        for (const block of blocks) {
          if (!block.startsWith('data: ')) continue
          try {
            const data = JSON.parse(block.slice(6).trim())
            if (data.done) { setInstalling(false); setStep('done'); return }
            if (data.msg) setLogs(prev => [...prev, { level: data.level ?? 'info', msg: data.msg }])
          } catch {}
        }
        if (done) { setInstalling(false); setStep('done'); break }
      }
    } catch (err) {
      setInstalling(false)
      setLogs(prev => [...prev, { level: 'error', msg: String(err) }])
    }
  }

  const launch = async (): Promise<void> => {
    await apiRequest('/installer/complete', { method: 'POST' }).catch(() => {})
    window.location.reload()
  }

  return (
    <div className="h-screen bg-base text-text-primary flex flex-col select-none overflow-hidden">
      {/* Title bar area */}
      <div className="h-10 bg-surface border-b border-border flex items-center px-4 gap-3 flex-shrink-0">
        <div className="w-5 h-5 bg-accent rounded flex items-center justify-center">
          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="none">
            <path d="M3 10 C3 5.5 6.5 2 11 2 s8 3.5 8 8 -3.5 8-8 8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="7" cy="10" r="1" fill="white"/>
            <circle cx="11" cy="10" r="1" fill="white"/>
            <circle cx="15" cy="10" r="1" fill="white"/>
          </svg>
        </div>
        <span className="text-sm font-medium text-text-primary">EchoHub Setup</span>
        {/* Step indicator */}
        <div className="flex-1 flex justify-center gap-1.5">
          {(['welcome', 'paths', 'installing', 'done'] as Step[]).map((s, i) => (
            <div key={s} className={`h-1 rounded-full transition-all duration-300 ${
              s === step ? 'w-6 bg-accent' : i < (['welcome','paths','installing','done'] as Step[]).indexOf(step) ? 'w-3 bg-accent/40' : 'w-3 bg-overlay'
            }`} />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {step === 'welcome' && <WelcomeStep onNext={() => setStep('paths')} />}
        {step === 'paths' && (
          <PathsStep
            config={config}
            defaults={defaults}
            onChange={setConfig}
            onBack={() => setStep('welcome')}
            onNext={startInstall}
          />
        )}
        {step === 'installing' && (
          <InstallingStep logs={logs} installing={installing} onDone={() => setStep('done')} />
        )}
        {step === 'done' && <DoneStep onLaunch={launch} />}
      </div>
    </div>
  )
}

function WelcomeStep({ onNext }: { onNext: () => void }): React.ReactElement {
  return (
    <div className="flex-1 flex flex-col justify-between p-8">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-2">Welcome to EchoHub</h1>
          <p className="text-sm text-text-muted leading-relaxed">
            This setup will install the inference engines and configure your environment.
            It only runs once — the next time you open EchoHub, it launches directly.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: 'clock', title: '5–30 min', desc: 'Depending on GPU and internet speed' },
            { icon: 'hdd', title: '8–15 GB', desc: 'For inference engines + dependencies' },
            { icon: 'lock', title: 'Local only', desc: 'Nothing is sent to the cloud' },
            { icon: 'terminal', title: 'No terminal', desc: 'Everything happens here' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="bg-elevated border border-border rounded-md p-3.5 flex gap-3 items-start">
              <SetupIcon name={icon} />
              <div>
                <div className="text-sm font-semibold text-text-primary">{title}</div>
                <div className="text-xs text-text-muted mt-0.5">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <button onClick={onNext}
          className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-sm cursor-pointer transition-colors">
          Get started →
        </button>
      </div>
    </div>
  )
}

function PathsStep({ config, defaults, onChange, onBack, onNext }: {
  config: InstallConfig; defaults: InstallConfig | null
  onChange: (c: InstallConfig) => void; onBack: () => void; onNext: () => void
}): React.ReactElement {
  return (
    <div className="flex-1 flex flex-col justify-between p-8">
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-xl font-bold text-text-primary mb-1">Storage locations</h2>
          <p className="text-sm text-text-muted">You can change these later in Settings → Paths.</p>
        </div>

        <PathField
          label="AI Models"
          desc="Where downloaded model files are stored. Allow 50+ GB for multiple models."
          value={config.models_dir}
          defaultValue={defaults?.models_dir ?? ''}
          onChange={v => onChange({ ...config, models_dir: v })}
        />
        <PathField
          label="App Data"
          desc="Conversations, settings, and inference engines (~8 GB for one vLLM version)."
          value={config.user_data_dir}
          defaultValue={defaults?.user_data_dir ?? ''}
          onChange={v => onChange({ ...config, user_data_dir: v })}
          readOnly
        />
      </div>
      <div className="flex justify-between">
        <button onClick={onBack}
          className="px-4 py-2 text-sm text-text-muted hover:text-text-secondary cursor-pointer transition-colors">
          ← Back
        </button>
        <button onClick={onNext}
          className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-sm cursor-pointer transition-colors">
          Install now →
        </button>
      </div>
    </div>
  )
}

function InstallingStep({ logs, installing }: { logs: LogLine[]; installing: boolean; onDone: () => void }): React.ReactElement {
  const logRef = React.useRef<HTMLDivElement>(null)
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [logs])

  const currentStep = logs.filter(l => l.level === 'step').slice(-1)[0]?.msg ?? 'Initializing…'

  return (
    <div className="flex-1 flex flex-col p-6 gap-4">
      <div className="flex items-center gap-3">
        {installing ? (
          <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin flex-shrink-0" />
        ) : (
          <svg className="w-4 h-4 text-green flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )}
        <div>
          <div className="text-sm font-semibold text-text-primary">{installing ? 'Installing…' : 'Installation complete'}</div>
          <div className="text-xs text-text-muted">{currentStep}</div>
        </div>
      </div>

      {/* Log box */}
      <div ref={logRef}
        className="flex-1 bg-[#0a0a0d] border border-border rounded-md p-3 font-mono text-xs leading-relaxed overflow-y-auto">
        {logs.map((line, i) => (
          <div key={i} className={
            line.level === 'error' ? 'text-red' :
            line.level === 'ok' ? 'text-green' :
            line.level === 'warn' ? 'text-yellow' :
            line.level === 'step' ? 'text-accent font-semibold mt-1' :
            'text-[#6b7280]'
          }>{line.level === 'step' ? `▶ ${line.msg}` : line.msg}</div>
        ))}
        {installing && <span className="text-accent animate-blink">█</span>}
      </div>
    </div>
  )
}

function DoneStep({ onLaunch }: { onLaunch: () => void }): React.ReactElement {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <div className="w-14 h-14 bg-green/15 rounded-full flex items-center justify-center">
        <svg className="w-7 h-7 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold text-text-primary mb-2">Ready to go</h2>
        <p className="text-sm text-text-muted">EchoHub is installed and configured. Click below to launch the app.</p>
      </div>
      <button onClick={onLaunch}
        className="px-8 py-3 bg-accent hover:bg-accent-hover text-white font-semibold text-sm rounded-sm cursor-pointer transition-colors">
        Launch EchoHub →
      </button>
    </div>
  )
}

function PathField({ label, desc, value, defaultValue, onChange, readOnly }: {
  label: string; desc: string; value: string; defaultValue: string
  onChange: (v: string) => void; readOnly?: boolean
}): React.ReactElement {
  const isDefault = value === defaultValue
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-medium text-text-primary">{label}</div>
        {isDefault && <span className="text-2xs text-text-muted bg-overlay px-1.5 py-0.5 rounded">default</span>}
      </div>
      <div className="text-xs text-text-muted mb-2">{desc}</div>
      <input type="text" value={value} readOnly={readOnly}
        onChange={e => onChange(e.target.value)}
        className={`w-full font-mono text-xs bg-elevated border border-border rounded-sm px-3 py-2 text-text-primary outline-none transition-colors ${
          readOnly ? 'opacity-60 cursor-not-allowed' : 'focus:border-accent'
        }`}
      />
      {readOnly && <div className="text-xs text-text-muted mt-1">Managed by the OS — not configurable here.</div>}
    </div>
  )
}

function SetupIcon({ name }: { name: string }): React.ReactElement {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  const cls = "w-4 h-4 text-accent flex-shrink-0 mt-0.5"
  if (name === 'clock') return <svg className={cls} viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  if (name === 'hdd') return <svg className={cls} viewBox="0 0 24 24" {...p}><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>
  if (name === 'lock') return <svg className={cls} viewBox="0 0 24 24" {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
  return <svg className={cls} viewBox="0 0 24 24" {...p}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
}

