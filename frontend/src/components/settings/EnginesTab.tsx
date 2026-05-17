import { useCallback, useEffect, useRef, useState } from 'react'
import { listEngines, deleteEngine, installEngineStream } from '@/api/client'

interface EngineVersion {
  version: string; path: string; installed: boolean; operational: boolean
  size_gb: number; arch_count: number; is_legacy: boolean
}

interface EnginesData {
  versions: EngineVersion[]
  coverage_warning: string | null
  operational_count: number
}

// Popular vLLM versions worth installing
const SUGGESTED_VERSIONS = ['0.21.0', '0.8.5', '0.14.0']

export function EnginesTab(): React.ReactElement {
  const [data, setData] = useState<EnginesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installLogs, setInstallLogs] = useState<Array<{ level: string; msg: string }>>([])
  const [customVersion, setCustomVersion] = useState('')
  const logsRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const d = await listEngines()
      setData(d)
    } catch { /* keep previous */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: 'smooth' })
  }, [installLogs])

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
    if (!window.confirm(`Delete vLLM ${version}? This cannot be undone.`)) return
    try {
      await deleteEngine(version)
      refresh()
    } catch (e) {
      alert(String(e))
    }
  }

  const installedVersions = new Set(data?.versions.map(v => v.version) ?? [])
  const suggested = SUGGESTED_VERSIONS.filter(v => !installedVersions.has(v))

  return (
    <div className="flex flex-col gap-6">

      {/* Coverage warning */}
      {data?.coverage_warning && (
        <div className="flex items-start gap-2 bg-yellow/7 border border-yellow/20 rounded-sm px-4 py-3 text-sm text-yellow">
          <svg className="w-4 h-4 flex-shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          {data.coverage_warning}
        </div>
      )}

      {/* Installed versions */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">
          Installed versions ({data?.operational_count ?? 0} operational)
        </div>
        {loading && <div className="text-sm text-text-muted animate-pulse">Loading...</div>}
        {data?.versions.length === 0 && !loading && (
          <div className="text-sm text-red">No vLLM installation found</div>
        )}
        <div className="flex flex-col gap-2">
          {data?.versions.map(v => (
            <VersionCard
              key={v.version} v={v}
              canDelete={(data?.versions.filter(x => x.operational).length ?? 0) > 1}
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
          {v.is_legacy && (
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
        title={canDelete ? 'Delete this version' : 'Cannot delete — last installation'}
        className="w-8 h-8 flex items-center justify-center rounded-sm border border-border hover:border-red/30 hover:bg-red/10 text-text-muted hover:text-red transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>
  )
}
