import { useState, useEffect, useCallback } from 'react'
import type { FinetuneJob, FinetuneProfile, FtStatus, ModelInfo } from '@/types'
import { listFinetuneJobs, createFinetuneJob, listFinetuneProfiles, getFtStatus, ftInstallStreamUrl } from '@/api/client'
import { EvalPanel } from './EvalPanel'

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
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
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

  const handleStart = async (): Promise<void> => {
    if (!activeModel) return
    setStarting(true)
    setStartError(null)
    try {
      const job = await createFinetuneJob({
        model_id: activeModel.id,
        profile_id: selectedProfile,
      })
      await loadJobs()
      setSelectedJobId(job.id)
    } catch (e) {
      setStartError(e instanceof Error ? e.message : 'Failed to start job')
    } finally {
      setStarting(false)
    }
  }

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
          disabled={!activeModel || starting}
          onClick={handleStart}
          className="mt-3 px-4 py-1.5 bg-accent/20 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-accent text-xs rounded cursor-pointer transition-colors"
        >
          {starting ? 'Starting…' : 'Start training'}
        </button>
        {startError && (
          <div className="mt-2 text-xs text-red-400 bg-red-400/8 border border-red-400/15 rounded-sm px-3 py-2">
            {startError}
          </div>
        )}
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
                selected={job.id === selectedJobId}
                onClick={() => setSelectedJobId(job.id === selectedJobId ? null : job.id)}
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

interface JobRowProps {
  job: FinetuneJob
  selected: boolean
  onClick: () => void
}

function JobRow({ job, selected, onClick }: JobRowProps): React.ReactElement {
  const statusColor: Record<FinetuneJob['status'], string> = {
    pending: 'text-text-muted',
    running: 'text-accent',
    done: 'text-green-400',
    error: 'text-red-400',
  }

  return (
    <div
      onClick={onClick}
      className={`px-3 py-2.5 rounded-md border cursor-pointer transition-colors ${
        selected
          ? 'bg-white/[0.06] border-white/[0.1]'
          : 'bg-surface border-white/[0.04] hover:border-white/[0.08]'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium ${statusColor[job.status]}`}>{job.status}</span>
        <span className="text-xs text-text-muted flex-1 truncate">{job.model_id}</span>
        <span className="text-[10px] text-text-muted">
          {new Date(job.created_at).toLocaleDateString()}
        </span>
      </div>
      {job.status === 'running' && job.progress !== null && (
        <div className="h-0.5 bg-white/[0.06] rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-500"
            style={{ width: `${job.progress * 100}%` }}
          />
        </div>
      )}
      {job.error && (
        <p className="text-xs text-red-400 mt-1">{job.error}</p>
      )}
    </div>
  )
}
