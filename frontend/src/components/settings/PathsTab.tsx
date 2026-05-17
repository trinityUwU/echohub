import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getPaths, setModelsDir, setVllmEnvsDir,
  getMigrationState, cancelMigration, cleanupMigration, runMigrationStream
} from '@/api/client'

interface PathsData {
  models_dir: string; vllm_envs_dir: string; user_data_dir: string; db_path: string
  models_dir_is_default: boolean; vllm_envs_dir_is_default: boolean
}

interface MigrationState {
  status: string; migration_type?: string; source?: string; destination?: string
  files_total?: number; files_done?: number; bytes_total?: number; bytes_done?: number
  files_failed?: string[]
}

export function PathsTab(): React.ReactElement {
  const [paths, setPaths] = useState<PathsData | null>(null)
  const [migration, setMigration] = useState<MigrationState>({ status: 'idle' })
  const [migrating, setMigrating] = useState(false)
  const [logs, setLogs] = useState<Array<{ level: string; msg: string }>>([])
  const [editingModels, setEditingModels] = useState('')
  const [editingEnvs, setEditingEnvs] = useState('')
  const logsRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    const [p, m] = await Promise.all([getPaths(), getMigrationState()])
    setPaths(p)
    setMigration(m)
    setEditingModels(p.models_dir)
    setEditingEnvs(p.vllm_envs_dir)
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: 'smooth' })
  }, [logs])

  // Auto-resume in-progress migration on mount
  useEffect(() => {
    if (migration.status === 'in_progress') startMigration()
  }, [migration.status])

  const applyModelsDir = async (): Promise<void> => {
    if (editingModels === paths?.models_dir) return
    const r = await setModelsDir(editingModels)
    if (r.status === 'migration_pending') {
      setMigration(r.state as MigrationState)
      refresh()
    }
  }

  const applyVllmEnvsDir = async (): Promise<void> => {
    if (editingEnvs === paths?.vllm_envs_dir) return
    const r = await setVllmEnvsDir(editingEnvs)
    if (r.status === 'migration_pending') {
      setMigration(r.state as MigrationState)
      refresh()
    }
  }

  const startMigration = (): void => {
    setMigrating(true)
    setLogs([])
    runMigrationStream(
      line => setLogs(prev => [...prev, line]),
      result => {
        setMigrating(false)
        if (result.success) { cleanupMigration(); refresh() }
        else refresh()
      }
    )
  }

  const handleCancel = async (): Promise<void> => {
    await cancelMigration()
    await refresh()
  }

  const pct = migration.files_total
    ? Math.round((migration.files_done ?? 0) / migration.files_total * 100)
    : 0

  return (
    <div className="flex flex-col gap-6">

      {/* Paths config */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-1">Models directory</div>
        <div className="text-xs text-text-muted mb-3">Where downloaded AI models are stored. Large files (~2–70 GB each).</div>
        <PathInput
          value={editingModels}
          onChange={setEditingModels}
          onApply={applyModelsDir}
          isDefault={paths?.models_dir_is_default ?? true}
          disabled={migration.status !== 'idle' && migration.status !== 'complete'}
        />
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-1">vLLM environments</div>
        <div className="text-xs text-text-muted mb-3">Where vLLM version environments are stored (~6–8 GB per version).</div>
        <PathInput
          value={editingEnvs}
          onChange={setEditingEnvs}
          onApply={applyVllmEnvsDir}
          isDefault={paths?.vllm_envs_dir_is_default ?? true}
          disabled={migration.status !== 'idle' && migration.status !== 'complete'}
        />
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-1">App data</div>
        <div className="text-xs text-text-muted mb-2">Read-only — conversations, settings, state.</div>
        <div className="font-mono text-xs text-text-secondary bg-elevated border border-border rounded-sm px-3 py-2">
          {paths?.user_data_dir}
        </div>
      </div>

      {/* Migration panel */}
      {migration.status !== 'idle' && migration.status !== 'complete' && (
        <MigrationPanel
          migration={migration}
          migrating={migrating}
          pct={pct}
          logs={logs}
          logsRef={logsRef}
          onStart={startMigration}
          onCancel={handleCancel}
        />
      )}

    </div>
  )
}

function PathInput({ value, onChange, onApply, isDefault, disabled }: {
  value: string; onChange: (v: string) => void; onApply: () => void
  isDefault: boolean; disabled: boolean
}): React.ReactElement {
  return (
    <div className="flex gap-2 items-center">
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onApply() }}
        disabled={disabled}
        className="flex-1 bg-elevated border border-border focus:border-accent rounded-sm px-3 py-2 text-sm font-mono text-text-primary outline-none transition-colors disabled:opacity-50"
      />
      {isDefault && (
        <span className="text-2xs text-text-muted bg-overlay px-1.5 py-0.5 rounded flex-shrink-0">default</span>
      )}
      <button onClick={onApply} disabled={disabled}
        className="px-3 py-2 text-sm rounded-sm border border-accent/35 bg-accent-dim text-accent hover:bg-accent/20 cursor-pointer transition-colors disabled:opacity-40 flex-shrink-0">
        Apply
      </button>
    </div>
  )
}

function MigrationPanel({ migration, migrating, pct, logs, logsRef, onStart, onCancel }: {
  migration: MigrationState; migrating: boolean; pct: number
  logs: Array<{ level: string; msg: string }>
  logsRef: React.RefObject<HTMLDivElement>
  onStart: () => void; onCancel: () => void
}): React.ReactElement {
  const typeLabel = migration.migration_type === 'models' ? 'Models' : 'vLLM envs'
  const isPending = migration.status === 'pending'
  const isInProgress = migration.status === 'in_progress' || migrating
  const hasFailed = (migration.files_failed?.length ?? 0) > 0

  return (
    <div className="border border-accent/25 bg-accent/5 rounded-md p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-sm font-semibold text-text-primary mb-0.5">
            {isPending ? `${typeLabel} migration ready` : isInProgress ? `Migrating ${typeLabel}…` : `${typeLabel} migration — issues`}
          </div>
          <div className="text-xs text-text-muted">
            {migration.source} → {migration.destination}
          </div>
        </div>
        {isPending && !migrating && (
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded-sm border border-border text-text-secondary hover:text-text-primary cursor-pointer transition-colors">
              Cancel
            </button>
            <button onClick={onStart}
              className="px-3 py-1.5 text-xs rounded-sm bg-accent hover:bg-accent-hover text-white cursor-pointer transition-colors">
              Migrate now
            </button>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {isInProgress && migration.files_total && (
        <div>
          <div className="flex justify-between text-xs text-text-muted mb-1">
            <span>{migration.files_done ?? 0} / {migration.files_total} files</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 bg-overlay rounded-sm overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <div ref={logsRef}
          className="bg-[#0a0a0d] border border-border rounded-sm p-3 font-mono text-xs leading-relaxed h-[160px] overflow-y-auto">
          {logs.map((line, i) => (
            <div key={i} className={
              line.level === 'error' ? 'text-red' :
              line.level === 'ok' ? 'text-green' :
              line.level === 'warn' ? 'text-yellow' :
              'text-[#6b7280]'
            }>{line.msg}</div>
          ))}
          {migrating && <span className="text-accent animate-blink">█</span>}
        </div>
      )}

      {hasFailed && !migrating && (
        <div className="text-xs text-yellow">
          {migration.files_failed?.length} files could not be copied — they will be re-downloaded automatically when accessed.
        </div>
      )}
    </div>
  )
}
