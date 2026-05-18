import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { getDownloadHistory, deleteDownloadHistoryEntry } from '@/api/client'
import type { DownloadJob, DownloadHistoryEntry, GpuStats } from '@/types'
import { Btn } from '@/components/shared/Btn'

interface DownloadsPageProps {
  jobs: DownloadJob[]
  onCancel: (modelId: string) => void
  onLoad: (modelId: string) => void
  gpu: GpuStats | null
}

export function DownloadsPage({ jobs, onCancel, onLoad, gpu }: DownloadsPageProps): React.ReactElement {
  const [history, setHistory] = useState<DownloadHistoryEntry[]>([])
  const activeJobs = jobs.filter(j => j.state === 'running' || j.state === 'pending')
  const hasActive = activeJobs.length > 0

  const refreshHistory = useCallback(async (): Promise<void> => {
    try {
      const data = await getDownloadHistory()
      setHistory(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  // Poll every 5s when there are active jobs
  useEffect(() => {
    if (!hasActive) return
    const id = setInterval(refreshHistory, 5000)
    return () => clearInterval(id)
  }, [hasActive, refreshHistory])

  const handleDeleteHistory = useCallback(async (modelId: string): Promise<void> => {
    try {
      await deleteDownloadHistoryEntry(modelId)
      await refreshHistory()
    } catch { /* ignore */ }
  }, [refreshHistory])

  const isEmpty = activeJobs.length === 0 && history.length === 0

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="h-[54px] bg-surface border-b border-border flex items-center px-5 gap-3 flex-shrink-0">
        <span className="text-md font-semibold flex-1">Downloads</span>
        <div className="flex gap-3.5 text-sm text-text-muted">
          {hasActive && <span className="text-accent">{activeJobs.length} active</span>}
          {history.length > 0 && <span>{history.length} in history</span>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {isEmpty && (
          <div className="text-center text-text-muted py-16 text-md">No downloads yet</div>
        )}

        {activeJobs.length > 0 && (
          <div className="mb-5">
            {activeJobs.map(job => (
              <DownloadCard
                key={job.model_id}
                job={job}
                onCancel={() => onCancel(job.model_id)}
                onLoad={() => onLoad(job.model_id)}
              />
            ))}
          </div>
        )}

        {history.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wider">History</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="flex flex-col gap-2">
              {history.map(entry => (
                <HistoryCard
                  key={entry.id}
                  entry={entry}
                  gpu={gpu}
                  onLoad={onLoad}
                  onDelete={() => handleDeleteHistory(entry.model_id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DownloadCard({ job, onCancel, onLoad }: {
  job: DownloadJob
  onCancel: () => void
  onLoad: () => void
}): React.ReactElement {
  const pct = job.progress !== null ? Math.round(job.progress * 100) : 0
  const dlGb = job.downloaded_gb.toFixed(2)
  const totalGb = job.total_gb?.toFixed(2) ?? '?'

  return (
    <div className="bg-surface border border-border rounded-md px-4 py-3.5 mb-2">
      <div className="flex justify-between items-start mb-2.5">
        <div>
          <div className="text-sm font-semibold text-text-primary">{job.model_id}</div>
          {job.state === 'error' && job.error && (
            <div className="text-xs text-red mt-0.5">{job.error}</div>
          )}
        </div>
        <StateBadge state={job.state} />
      </div>
      <div className="h-[3px] bg-overlay rounded-sm overflow-hidden mb-2">
        <div
          className={`h-full rounded-sm transition-all ${job.state === 'complete' ? 'bg-green' : 'bg-accent'}`}
          style={{ width: `${job.state === 'complete' ? 100 : pct}%` }}
        />
      </div>
      <div className="flex justify-between items-center text-xs">
        <span className="text-text-secondary font-mono">{dlGb} / {totalGb} GB ({pct}%)</span>
        <div className="flex gap-1.5">
          {job.state === 'complete' && <Btn variant="primary" onClick={onLoad}>Load</Btn>}
          {(job.state === 'running' || job.state === 'pending') && (
            <Btn variant="danger" onClick={onCancel}>Cancel</Btn>
          )}
        </div>
      </div>
    </div>
  )
}

function HistoryCard({ entry, gpu, onLoad, onDelete }: {
  entry: DownloadHistoryEntry
  gpu: GpuStats | null
  onLoad: (modelId: string) => void
  onDelete: () => void
}): React.ReactElement {
  const title = entry.model_name ?? entry.model_id.split('/').pop() ?? entry.model_id
  const sizeLabel = entry.size_gb != null
    ? `${entry.size_gb.toFixed(2)} GB`
    : entry.downloaded_gb > 0
      ? `${entry.downloaded_gb.toFixed(2)} GB`
      : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="bg-surface border border-border rounded-md px-4 py-3 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary truncate max-w-[280px]">{title}</span>
            <HistoryStateBadge state={entry.state} />
            {entry.state === 'complete' && !entry.files_exist && (
              <span className="text-[10px] px-1.5 py-0.5 bg-red-400/15 text-red-400 rounded-sm font-medium flex-shrink-0">files deleted</span>
            )}
          </div>
          <div className="text-xs text-text-muted truncate mt-0.5">{entry.model_id}</div>
          {entry.state === 'error' && entry.error && (
            <div className="text-xs text-red-400 mt-1">{entry.error}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {entry.state === 'complete' && sizeLabel && (
            <span className="text-xs text-text-muted font-mono">{sizeLabel}</span>
          )}
          {entry.state === 'complete' && entry.files_exist && (
            <Btn variant="primary" onClick={() => onLoad(entry.model_id)}>Load</Btn>
          )}
          <button
            onClick={onDelete}
            className="p-1 text-text-muted hover:text-red-400 transition-colors cursor-pointer rounded"
            title="Remove from history"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {gpu && <VramBar gpu={gpu} />}
    </motion.div>
  )
}

function VramBar({ gpu }: { gpu: GpuStats }): React.ReactElement {
  const used = gpu.vram_used_mb / 1024
  const total = gpu.vram_total_mb / 1024
  const pct = total > 0 ? (used / total) * 100 : 0
  const barColor = pct < 60 ? 'bg-green' : pct < 80 ? 'bg-amber-400' : 'bg-red-400'

  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <span className="flex-shrink-0">GPU VRAM</span>
      <div className="flex-1 h-[3px] bg-overlay rounded-sm overflow-hidden">
        <div
          className={`h-full rounded-sm transition-all ${barColor}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="flex-shrink-0 font-mono">{used.toFixed(1)} / {total.toFixed(1)} GB</span>
    </div>
  )
}

function HistoryStateBadge({ state }: { state: DownloadHistoryEntry['state'] }): React.ReactElement {
  const styles: Record<string, string> = {
    complete:  'bg-green/15 text-green',
    error:     'bg-red-400/15 text-red-400',
    cancelled: 'bg-white/6 text-text-muted',
    running:   'bg-accent/15 text-accent',
    pending:   'bg-white/6 text-text-muted',
    paused:    'bg-white/6 text-text-muted',
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${styles[state] ?? styles.pending}`}>
      {state}
    </span>
  )
}

function StateBadge({ state }: { state: DownloadJob['state'] }): React.ReactElement {
  const styles: Record<string, string> = {
    running:   'bg-accent/15 text-accent',
    pending:   'bg-white/6 text-text-muted',
    complete:  'bg-green/15 text-green',
    error:     'bg-red/15 text-red',
    cancelled: 'bg-white/6 text-text-muted',
    paused:    'bg-white/6 text-text-muted',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[state] ?? styles.pending}`}>
      {state}
    </span>
  )
}

function TrashIcon(): React.ReactElement {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  )
}
