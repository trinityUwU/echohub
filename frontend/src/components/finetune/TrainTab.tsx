import { useState, useEffect, useCallback, useRef } from 'react'
import type { FinetuneJob, FinetuneProfile, FtStatus, ModelInfo } from '@/types'
import { listFinetuneJobs, listFinetuneProfiles, getFtStatus, ftInstallStreamUrl, cancelFinetuneJob, ftJobStreamUrl } from '@/api/client'
import { EvalPanel } from './EvalPanel'
import { FTLoadModal } from './FTLoadModal'

const MAX_LOG_LINES = 50

interface TrainTabProps {
  profileId: string | null
  loadedModel: ModelInfo | null
  ftModel?: ModelInfo | null
}

export function TrainTab({ profileId, loadedModel, ftModel }: TrainTabProps): React.ReactElement {
  const activeModel = ftModel ?? loadedModel
  const [status, setStatus] = useState<FtStatus | null>(null)
  const [jobs, setJobs] = useState<FinetuneJob[]>([])
  const [profiles, setProfiles] = useState<FinetuneProfile[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string | null>(profileId)
  const [showConfig, setShowConfig] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installLogs, setInstallLogs] = useState<string[]>([])

  useEffect(() => { setSelectedProfile(profileId) }, [profileId])

  const loadData = useCallback(async (): Promise<void> => {
    try {
      const [s, j, p] = await Promise.all([getFtStatus(), listFinetuneJobs(), listFinetuneProfiles()])
      setStatus(s); setJobs(j); setProfiles(p)
    } catch { /* ignore */ }
  }, [])

  const loadJobs = useCallback(async (): Promise<void> => {
    try { setJobs(await listFinetuneJobs()) } catch { /* ignore */ }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const handleInstall = (): void => {
    setInstalling(true); setInstallLogs([])
    ftInstallStreamUrl().then(url => {
      const es = new EventSource(url)
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data) as { type: string; text?: string; label?: string }
          if (d.type === 'done') { es.close(); setInstalling(false); void loadData() }
          else if (d.type === 'error') { setInstallLogs(l => [...l.slice(-MAX_LOG_LINES + 1), `ERROR: ${d.text ?? ''}`]); es.close(); setInstalling(false) }
          else if (d.type === 'step') setInstallLogs(l => [...l.slice(-MAX_LOG_LINES + 1), `>>> ${d.label ?? ''}`])
          else if (d.type === 'log' && d.text) setInstallLogs(l => [...l.slice(-MAX_LOG_LINES + 1), d.text!])
        } catch { /* skip */ }
      }
      es.onerror = () => { es.close(); setInstalling(false) }
    }).catch(() => setInstalling(false))
  }

  const handleJobCreated = useCallback(async (jobId: string): Promise<void> => {
    await loadJobs()
    setSelectedJobId(jobId)
  }, [loadJobs])

  const evalLoadedModel = activeModel
    ? { id: activeModel.id, path: undefined }
    : null

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Unsloth install banner */}
      {status && !status.unsloth_available && (
        <div className="bg-yellow/8 border border-yellow/20 rounded-md p-4 mb-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-yellow">Unsloth not installed</div>
              <div className="text-xs text-text-muted mt-0.5">Required for QLoRA fine-tuning. Will be installed in an isolated venv.</div>
            </div>
            <button onClick={handleInstall} disabled={installing}
              className="px-4 py-1.5 text-xs bg-yellow/15 hover:bg-yellow/25 disabled:opacity-50 border border-yellow/30 text-yellow rounded-sm cursor-pointer transition-colors font-medium flex-shrink-0 flex items-center gap-1.5">
              {installing && <span className="w-3 h-3 border border-yellow/40 border-t-yellow rounded-full animate-spin" />}
              {installing ? 'Installing…' : 'Install Unsloth'}
            </button>
          </div>
          {installLogs.length > 0 && (
            <div className="font-mono text-xs bg-overlay rounded-sm p-3 max-h-48 overflow-y-auto leading-relaxed text-text-muted">
              {installLogs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      )}

      {/* New run config */}
      <div className="bg-surface border border-white/[0.06] rounded-md p-4 mb-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">New training run</h3>

        {activeModel ? (
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
            <span className="text-xs text-text-secondary">{activeModel.name}</span>
          </div>
        ) : (
          <p className="text-xs text-text-muted mb-3">
            No model selected — go to <span className="text-accent">Models</span> tab and click "Select for training"
          </p>
        )}

        <ProfileSelector
          profiles={profiles}
          value={selectedProfile}
          onChange={setSelectedProfile}
        />

        <button
          disabled={!activeModel}
          onClick={() => setShowConfig(true)}
          className="mt-3 px-4 py-1.5 bg-accent/20 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-accent text-xs rounded cursor-pointer transition-colors"
        >
          Configure &amp; Start
        </button>
      </div>

      {/* Jobs list */}
      {jobs.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Jobs</h3>
          <div className="space-y-1.5">
            {jobs.map(job => (
              <JobRow
                key={job.id}
                job={job}
                selected={false}
                onClick={() => {}}
                onRefresh={loadJobs}
              />
            ))}
          </div>
        </div>
      )}

      {/* Eval panel */}
      <EvalPanel
        profileId={selectedProfile}
        jobId={selectedJobId}
        loadedModel={evalLoadedModel}
        onEvalDone={loadJobs}
      />

      {showConfig && activeModel && (
        <FTLoadModal
          modelId={activeModel.id}
          modelName={activeModel.name}
          paramsBillion={activeModel.params_billion}
          profileId={selectedProfile}
          onClose={() => setShowConfig(false)}
          onJobCreated={handleJobCreated}
        />
      )}
    </div>
  )
}

// ── ProfileSelector ────────────────────────────────────────────────────────

interface ProfileSelectorProps {
  profiles: FinetuneProfile[]
  value: string | null
  onChange: (id: string | null) => void
}

function ProfileSelector({ profiles, value, onChange }: ProfileSelectorProps): React.ReactElement {
  const selected = profiles.find(p => p.id === value) ?? null

  return (
    <div>
      <span className="text-xs text-text-muted mb-1.5 block">Profile</span>
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onChange(null)}
          className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
            value === null
              ? 'bg-accent/20 text-accent'
              : 'bg-white/[0.04] text-text-muted hover:bg-white/[0.06]'
          }`}
        >
          All pairs
        </button>
        {profiles.map(p => (
          <button
            key={p.id}
            onClick={() => onChange(p.id)}
            className={`px-2.5 py-1 rounded text-xs transition-colors cursor-pointer flex items-center gap-1.5 ${
              value === p.id
                ? 'bg-white/[0.08] text-text-primary'
                : 'bg-white/[0.04] text-text-muted hover:bg-white/[0.06]'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
            {p.name}
            {p.pair_count !== undefined && (
              <span className="text-text-muted text-[10px]">{p.pair_count}</span>
            )}
          </button>
        ))}
      </div>
      {selected && selected.pair_count !== undefined && (
        <p className="text-xs text-text-muted mt-1.5">
          {selected.pair_count} pairs in this profile
        </p>
      )}
    </div>
  )
}

// ── JobRow ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<FinetuneJob['status'], string> = {
  pending: 'text-text-muted',
  running: 'text-accent',
  done: 'text-green-400',
  error: 'text-red-400',
  cancelled: 'text-text-muted/50',
}

interface JobRowProps {
  job: FinetuneJob
  selected: boolean
  onClick: () => void
  onRefresh: () => void
}

function JobRow({ job, onRefresh }: JobRowProps): React.ReactElement {
  const [logs, setLogs] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const isActive = job.status === 'pending' || job.status === 'running'

  // Auto-expand active jobs, keep expanded after done
  useEffect(() => { if (isActive) setExpanded(true) }, [isActive])

  const onRefreshRef = useRef(onRefresh)
  useEffect(() => { onRefreshRef.current = onRefresh }, [onRefresh])

  useEffect(() => {
    if (!isActive) return
    let es: EventSource | null = null
    let connected = false
    ftJobStreamUrl(job.id).then(url => {
      es = new EventSource(url)
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data) as { type: string; text?: string }
          if (!connected && (d.type === 'start' || d.type === 'log')) {
            connected = true
            setLogs(['Training started…'])
          }
          if (d.type === 'log' && d.text) setLogs(l => [...l.slice(-MAX_LOG_LINES + 1), d.text!])
          if (d.type === 'error' && d.text) setLogs(l => [...l, `ERROR: ${d.text}`])
          if (d.type === 'done' || d.type === 'error') { es?.close(); setTimeout(() => onRefreshRef.current(), 300) }
        } catch { /* skip */ }
      }
      es.onerror = () => { es?.close(); setTimeout(() => onRefreshRef.current(), 500) }
    }).catch(() => {})
    return () => { es?.close() }
  }, [job.id, isActive])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logs])

  const handleCancel = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    setCancelling(true)
    try { await cancelFinetuneJob(job.id); onRefresh() } catch { /* ignore */ } finally { setCancelling(false) }
  }

  const hasLogs = logs.length > 0 || isActive

  return (
    <div className="rounded-md border border-white/[0.04] hover:border-white/[0.08] transition-colors bg-surface">
      <div
        onClick={() => setExpanded(e => !e)}
        className="px-3 py-2.5 flex items-center gap-2 cursor-pointer"
      >
        <span className={`text-xs font-medium flex-shrink-0 ${STATUS_COLOR[job.status] ?? 'text-text-muted'}`}>{job.status}</span>
        {isActive && <span className="w-3 h-3 border border-accent/30 border-t-accent rounded-full animate-spin flex-shrink-0" />}
        <span className="text-xs text-text-muted flex-1 truncate">{job.model_id.split('/').pop()}</span>
        <span className="text-[10px] text-text-muted flex-shrink-0">{new Date(job.created_at).toLocaleDateString()}</span>
        {isActive && (
          <button onClick={handleCancel} disabled={cancelling}
            className="text-[10px] px-2 py-0.5 border border-white/[0.08] rounded-sm text-text-muted hover:text-red-400 hover:border-red-400/30 cursor-pointer transition-colors flex-shrink-0 disabled:opacity-40">
            {cancelling ? '…' : 'Cancel'}
          </button>
        )}
        {hasLogs && (
          <svg className={`w-3 h-3 text-text-muted/40 flex-shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        )}
      </div>
      {job.error && !expanded && (
        <p className="px-3 pb-2 text-xs text-red-400 truncate">{job.error}</p>
      )}
      {expanded && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          {job.error && <p className="text-xs text-red-400 bg-red-400/8 rounded-sm px-2 py-1.5">{job.error}</p>}
          <div ref={logRef} className="font-mono text-xs bg-overlay rounded-sm p-2.5 max-h-72 overflow-y-auto leading-relaxed text-text-muted">
            {logs.length === 0 && isActive
              ? <span className="animate-pulse opacity-50">Connecting…</span>
              : logs.length === 0
              ? <span className="opacity-40">No logs captured for this job</span>
              : logs.map((l, i) => <div key={i} className="py-[1px]">{l}</div>)
            }
          </div>
        </div>
      )}
    </div>
  )
}
