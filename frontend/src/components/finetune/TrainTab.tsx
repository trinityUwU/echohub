import { useState, useEffect, useCallback } from 'react'
import type { FinetuneJob, FinetuneProfile, ModelInfo } from '@/types'
import { listFinetuneJobs, createFinetuneJob, listFinetuneProfiles } from '@/api/client'
import { EvalPanel } from './EvalPanel'

interface TrainTabProps {
  profileId: string | null
  loadedModel: ModelInfo | null
  ftModel?: ModelInfo | null
}

export function TrainTab({ profileId, loadedModel, ftModel }: TrainTabProps): React.ReactElement {
  const activeModel = ftModel ?? loadedModel
  const [jobs, setJobs] = useState<FinetuneJob[]>([])
  const [profiles, setProfiles] = useState<FinetuneProfile[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string | null>(profileId)
  const [starting, setStarting] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  useEffect(() => { setSelectedProfile(profileId) }, [profileId])

  const loadJobs = useCallback(async (): Promise<void> => {
    try {
      const data = await listFinetuneJobs()
      setJobs(data)
    } catch { /* ignore */ }
  }, [])

  const loadProfiles = useCallback(async (): Promise<void> => {
    try {
      const data = await listFinetuneProfiles()
      setProfiles(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadJobs()
    loadProfiles()
  }, [loadJobs, loadProfiles])

  const handleStart = async (): Promise<void> => {
    if (!activeModel) return
    setStarting(true)
    try {
      const job = await createFinetuneJob({
        model_id: activeModel!.id,
        profile_id: selectedProfile,
      })
      await loadJobs()
      setSelectedJobId(job.id)
    } catch { /* ignore */ } finally {
      setStarting(false)
    }
  }

  const evalLoadedModel = activeModel
    ? { id: activeModel.id, path: undefined }
    : null

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* New run config */}
      <div className="bg-surface border border-white/[0.06] rounded-md p-4 mb-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">New training run</h3>

        {activeModel ? (
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
            <span className="text-xs text-text-secondary">{activeModel.name}</span>
          </div>
        ) : (
          <p className="text-xs text-text-muted mb-3">Load a model first</p>
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
          {starting ? 'Starting...' : 'Start training'}
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
