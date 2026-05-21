import { useCallback, useEffect, useRef, useState } from 'react'
import { listEngines, deleteEngine, installEngineStream, getLlamaCppStatus, getInstallerDiagnose, recompileLlamaStreamUrl } from '@/api/client'
import { useDialog } from '@/components/shared/Dialog'
import { apiUrl } from '@/api/base'

interface LlamaCppStatus {
  installed: boolean; version: string | null
  cuda_enabled: boolean; hipblas_enabled: boolean; metal_enabled: boolean
  backend_type: 'cuda' | 'hipblas' | 'metal' | 'cpu'
  size_gb: number; path: string
}

interface DiagnoseResult {
  gpu_type: 'nvidia' | 'amd' | 'apple' | 'cpu'
  expected_backend: string; actual_backend: string | null
  llama_installed: boolean; backend_ok: boolean; issues: string[]
}

interface EngineVersion {
  version: string; path: string; installed: boolean; operational: boolean
  size_gb: number; arch_count: number; is_legacy: boolean; is_builtin: boolean
}

interface EnginesData {
  versions: EngineVersion[]
  coverage_warning: string | null
  operational_count: number
}

// Popular vLLM versions worth installing
const SUGGESTED_VERSIONS = ['0.21.0', '0.8.5', '0.14.0']

export function EnginesTab(): React.ReactElement {
  const { confirm, alert: showAlert, element: dialogEl } = useDialog()
  const [data, setData] = useState<EnginesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installLogs, setInstallLogs] = useState<Array<{ level: string; msg: string }>>([])
  const [customVersion, setCustomVersion] = useState('')
  const logsRef = useRef<HTMLDivElement>(null)

  const [llamaStatus, setLlamaStatus] = useState<LlamaCppStatus | null>(null)
  const [llamaLoading, setLlamaLoading] = useState(true)
  const [llamaUpgrading, setLlamaUpgrading] = useState(false)
  const [llamaLogs, setLlamaLogs] = useState<Array<{ level: string; msg: string }>>([])
  const llamaLogsRef = useRef<HTMLDivElement>(null)

  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null)
  const [recompiling, setRecompiling] = useState(false)
  const [recompileLogs, setRecompileLogs] = useState<Array<{ level: string; msg: string }>>([])
  const recompileLogsRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const d = await listEngines()
      setData(d)
    } catch { /* keep previous */ }
    finally { setLoading(false) }
  }, [])

  const refreshLlama = useCallback(async (): Promise<void> => {
    try {
      const s = await getLlamaCppStatus()
      setLlamaStatus(s)
    } catch { /* keep previous */ }
    finally { setLlamaLoading(false) }
  }, [])

  const refreshDiagnose = useCallback(async (): Promise<void> => {
    try {
      const d = await getInstallerDiagnose()
      setDiagnose(d)
    } catch { /* keep previous */ }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { refreshLlama() }, [refreshLlama])
  useEffect(() => { refreshDiagnose() }, [refreshDiagnose])
  useEffect(() => {
    logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: 'smooth' })
  }, [installLogs])
  useEffect(() => {
    llamaLogsRef.current?.scrollTo({ top: llamaLogsRef.current.scrollHeight, behavior: 'smooth' })
  }, [llamaLogs])
  useEffect(() => {
    recompileLogsRef.current?.scrollTo({ top: recompileLogsRef.current.scrollHeight, behavior: 'smooth' })
  }, [recompileLogs])

  const handleLlamaUpgrade = async (): Promise<void> => {
    setLlamaUpgrading(true)
    setLlamaLogs([])
    const url = await apiUrl('/models/llama-upgrade/stream')
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.done || data.type === 'done' || data.type === 'error') {
          es.close()
          setLlamaUpgrading(false)
          refreshLlama()
        } else {
          const msg = data.text ?? data.msg ?? ''
          const level = data.type === 'error' ? 'error' : data.type === 'step' ? 'ok' : 'info'
          if (msg) setLlamaLogs(prev => [...prev, { level, msg }])
        }
      } catch { /* ignore */ }
    }
    es.onerror = () => { es.close(); setLlamaUpgrading(false) }
  }

  const handleRecompile = async (): Promise<void> => {
    setRecompiling(true)
    setRecompileLogs([])
    try {
      const url = await recompileLlamaStreamUrl()
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
            const d = JSON.parse(block.slice(6).trim())
            if (d.done) { setRecompiling(false); refreshLlama(); refreshDiagnose(); return }
            if (d.msg) setRecompileLogs(prev => [...prev, { level: d.level ?? 'info', msg: d.msg }])
          } catch { /* ignore */ }
        }
        if (done) break
      }
    } catch (err) {
      setRecompileLogs(prev => [...prev, { level: 'error', msg: String(err) }])
    }
    setRecompiling(false)
  }

  const handleInstall = (version: string): void => {
    setInstalling(version)
    setInstallLogs([])
    installEngineStream(
      version,
      line => setInstallLogs(prev => [...prev, line]),
      result => {
        setInstalling(null)
        if (result.success) refresh()
      }
    )
  }

  const handleDelete = async (version: string): Promise<void> => {
    const ok = await confirm('Delete vLLM ' + version, 'This will remove the vLLM environment and all its files. This cannot be undone.', 'Delete')
    if (!ok) return
    try {
      await deleteEngine(version)
      refresh()
    } catch (e) {
      showAlert('Delete failed', String(e), 'error')
    }
  }

  const installedVersions = new Set(data?.versions.map(v => v.version) ?? [])
  const suggested = SUGGESTED_VERSIONS.filter(v => !installedVersions.has(v))
  const operationalCount = data?.versions.filter(v => v.operational).length ?? 0

  const backendLabel: Record<string, string> = { cuda: 'CUDA', hipblas: 'ROCm/HIP', metal: 'Metal', cpu: 'CPU only' }
  const llamaBadge = !llamaStatus?.installed
    ? { label: 'not installed', cls: 'bg-red/12 text-red' }
    : llamaStatus.backend_type === 'cpu'
    ? { label: 'cpu only', cls: 'bg-yellow/12 text-yellow' }
    : { label: backendLabel[llamaStatus.backend_type] ?? llamaStatus.backend_type, cls: 'bg-green/12 text-green' }

  const hasMismatch = diagnose && !diagnose.backend_ok && diagnose.gpu_type !== 'cpu'
  const gpuLabel: Record<string, string> = { nvidia: 'NVIDIA', amd: 'AMD', apple: 'Apple Silicon', cpu: 'No GPU' }

  return (
    <div className="flex flex-col gap-6">

      {/* GPU health banner — shown when backend doesn't match GPU */}
      {hasMismatch && (
        <div className="flex items-start gap-3 bg-yellow/7 border border-yellow/25 rounded-md px-4 py-3">
          <svg className="w-4 h-4 text-yellow flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-yellow mb-0.5">GPU backend mismatch</div>
            <div className="text-xs text-text-muted leading-relaxed">
              {gpuLabel[diagnose!.gpu_type]} detected but llama-cpp compiled for{' '}
              <span className="font-mono">{diagnose!.actual_backend ?? 'unknown'}</span>.
              Models will run on CPU instead of GPU.
            </div>
          </div>
          <button
            onClick={handleRecompile}
            disabled={recompiling}
            className="px-3 py-1.5 rounded-sm bg-yellow/15 hover:bg-yellow/25 border border-yellow/30 text-yellow text-xs font-semibold cursor-pointer transition-colors disabled:opacity-40 flex-shrink-0">
            {recompiling ? 'Compiling…' : `Recompile for ${gpuLabel[diagnose!.gpu_type]}`}
          </button>
        </div>
      )}

      {/* Recompile log */}
      {(recompiling || recompileLogs.length > 0) && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2 flex items-center gap-2">
            {recompiling
              ? <><span className="w-1.5 h-1.5 rounded-full bg-yellow animate-pulse" />Recompiling llama-cpp-python…</>
              : 'Recompile log'
            }
          </div>
          <div ref={recompileLogsRef}
            className="bg-[#0a0a0d] border border-border rounded-sm p-3 font-mono text-xs leading-relaxed h-[180px] overflow-y-auto">
            {recompileLogs.map((line, i) => (
              <div key={i} className={
                line.level === 'error' ? 'text-red' :
                line.level === 'ok' ? 'text-green' :
                line.level === 'warn' ? 'text-yellow' :
                line.level === 'step' ? 'text-accent font-semibold' :
                'text-[#6b7280]'
              }>{line.level === 'step' ? `▶ ${line.msg}` : line.msg}</div>
            ))}
            {recompiling && <span className="text-yellow animate-blink">█</span>}
          </div>
        </div>
      )}

      {/* llama-cpp-python section */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">
          Inference engines — llama.cpp
        </div>
        <div className={`flex items-center gap-3 px-4 py-3 rounded-md border transition-colors ${
          llamaStatus?.installed ? 'bg-surface border-border' : 'bg-surface border-red/20'
        }`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold text-text-primary font-mono">llama-cpp-python</span>
              {llamaStatus?.version && (
                <span className="text-2xs text-text-muted font-mono">{llamaStatus.version}</span>
              )}
              <span className={`text-2xs px-1.5 py-px rounded ${llamaBadge.cls}`}>{llamaBadge.label}</span>
            </div>
            <div className="flex gap-4 text-xs text-text-muted">
              {llamaStatus?.size_gb ? <span>{llamaStatus.size_gb} GB</span> : null}
              {llamaStatus?.path && (
                <span className="truncate text-text-muted/60">{llamaStatus.path}</span>
              )}
              {!llamaStatus?.installed && !llamaLoading && (
                <span className="text-red">Not installed</span>
              )}
              {llamaLoading && <span className="animate-pulse">Checking…</span>}
            </div>
          </div>
          <button
            onClick={handleLlamaUpgrade}
            disabled={llamaUpgrading}
            className="px-3 py-1.5 rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-xs font-medium cursor-pointer transition-colors flex-shrink-0">
            {llamaUpgrading ? 'Upgrading…' : 'Upgrade'}
          </button>
        </div>

        {(llamaUpgrading || llamaLogs.length > 0) && (
          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2 flex items-center gap-2">
              {llamaUpgrading
                ? <><span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />Upgrading llama-cpp-python…</>
                : 'Upgrade log'
              }
            </div>
            <div ref={llamaLogsRef}
              className="bg-[#0a0a0d] border border-border rounded-sm p-3 font-mono text-xs leading-relaxed h-[180px] overflow-y-auto">
              {llamaLogs.map((line, i) => (
                <div key={i} className={
                  line.level === 'error' ? 'text-red' :
                  line.level === 'ok' ? 'text-green' :
                  line.level === 'warn' ? 'text-yellow' :
                  'text-[#6b7280]'
                }>
                  {line.msg}
                </div>
              ))}
              {llamaUpgrading && <span className="text-accent animate-blink">█</span>}
            </div>
          </div>
        )}
      </div>

      {/* vLLM section title */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">
          Inference engines — vLLM
        </div>

      {/* Coverage warning */}
      {data?.coverage_warning && (
        <div className="flex items-start gap-2 bg-yellow/7 border border-yellow/20 rounded-sm px-4 py-3 text-sm text-yellow mb-3">
          <svg className="w-4 h-4 flex-shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          {data.coverage_warning}
        </div>
      )}

      {/* Installed versions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-text-muted">
            Installed versions ({data?.operational_count ?? 0} operational)
          </div>
          <button onClick={refresh} disabled={loading}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary cursor-pointer transition-colors disabled:opacity-40">
            {loading
              ? <span className="w-3 h-3 border-2 border-text-muted/30 border-t-text-muted rounded-full animate-spin" />
              : <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.01"/></svg>
            }
            Refresh
          </button>
        </div>
        {loading && <div className="text-sm text-text-muted animate-pulse">Checking versions…</div>}
        {data?.versions.length === 0 && !loading && (
          <div className="text-sm text-red">No vLLM installation found</div>
        )}
        <div className="flex flex-col gap-2">
          {data?.versions.map(v => (
            <VersionCard
              key={v.version} v={v}
              canDelete={!v.is_builtin && (!v.operational || operationalCount > 1)}
              onDelete={() => handleDelete(v.version)}
            />
          ))}
        </div>
      </div>

      {/* Install new version */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">
          Install additional version
        </div>
        <p className="text-sm text-text-muted mb-3">
          Each version adds support for different model architectures. Installing takes 10–30 minutes and uses ~6–8 GB disk space.
        </p>

        {suggested.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {suggested.map(v => (
              <button key={v} onClick={() => handleInstall(v)}
                disabled={!!installing}
                className="text-xs px-3 py-1.5 rounded-sm border border-border hover:border-accent/40 hover:bg-accent-dim text-text-secondary hover:text-accent cursor-pointer transition-colors disabled:opacity-40">
                vLLM {v}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input type="text" value={customVersion}
            onChange={e => setCustomVersion(e.target.value)}
            placeholder="e.g. 0.22.0"
            className="bg-elevated border border-border focus:border-accent rounded-sm px-3 py-1.5 text-sm text-text-primary outline-none transition-colors w-40"
          />
          <button
            onClick={() => customVersion.trim() && handleInstall(customVersion.trim())}
            disabled={!!installing || !customVersion.trim()}
            className="px-4 py-1.5 rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-medium cursor-pointer transition-colors">
            Install
          </button>
        </div>
      </div>

      {/* Install progress */}
      {(installing || installLogs.length > 0) && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-2 flex items-center gap-2">
            {installing
              ? <><span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />Installing vLLM {installing}…</>
              : 'Install log'
            }
          </div>
          <div ref={logsRef}
            className="bg-[#0a0a0d] border border-border rounded-sm p-3 font-mono text-xs leading-relaxed h-[220px] overflow-y-auto">
            {installLogs.map((line, i) => (
              <div key={i} className={
                line.level === 'error' ? 'text-red' :
                line.level === 'ok' ? 'text-green' :
                line.level === 'warn' ? 'text-yellow' :
                'text-[#6b7280]'
              }>
                {line.msg}
              </div>
            ))}
            {installing && <span className="text-accent animate-blink">█</span>}
          </div>
        </div>
      )}

      </div>{/* end vLLM outer div */}

      {dialogEl}
    </div>
  )
}

function VersionCard({ v, canDelete, onDelete }: {
  v: EngineVersion; canDelete: boolean; onDelete: () => void
}): React.ReactElement {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-md border transition-colors ${
      v.operational ? 'bg-surface border-border' : 'bg-surface border-red/20'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-text-primary font-mono">
            vLLM {v.version}
          </span>
          {v.is_builtin && (
            <span className="text-2xs px-1.5 py-px rounded bg-accent/15 text-accent">default</span>
          )}
          {v.is_legacy && !v.is_builtin && (
            <span className="text-2xs px-1.5 py-px rounded bg-yellow/12 text-yellow">legacy</span>
          )}
          <span className={`text-2xs px-1.5 py-px rounded ${
            v.operational ? 'bg-green/12 text-green' : 'bg-red/12 text-red'
          }`}>
            {v.operational ? 'operational' : 'not working'}
          </span>
        </div>
        <div className="flex gap-4 text-xs text-text-muted">
          <span>{v.size_gb} GB</span>
          {v.arch_count > 0 && <span>{v.arch_count} architectures</span>}
          <span className="truncate text-text-muted/60">{v.path}</span>
        </div>
      </div>
      <button
        onClick={onDelete}
        disabled={!canDelete}
        title={canDelete ? 'Delete this version' : v.is_builtin ? 'Cannot delete — default installation' : 'Cannot delete — last installation'}
        className="w-8 h-8 flex items-center justify-center rounded-sm border border-border hover:border-red/30 hover:bg-red/10 text-text-muted hover:text-red transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>
  )
}
