import { useEffect, useRef, useState } from 'react'
import { cancelDownload, subscribeDownloads } from '@/api/client'
import type { DownloadJob } from '@/types'

interface Props {
  onComplete: () => void
}

const STATE_COLORS: Record<string, string> = {
  running: 'text-blue-400',
  pending: 'text-yellow-400',
  complete: 'text-emerald-400',
  error: 'text-red-400',
  cancelled: 'text-muted',
  paused: 'text-orange-400',
}

function ProgressBar({ value }: { value: number | null }) {
  return (
    <div className="w-full h-1 bg-surface-3 rounded-full overflow-hidden mt-1.5">
      <div
        className="h-full bg-accent rounded-full transition-all duration-500"
        style={{ width: value !== null ? `${Math.round(value * 100)}%` : '100%' }}
      />
    </div>
  )
}

export function DownloadPanel({ onComplete }: Props) {
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const notified = useRef<Set<string>>(new Set())

  useEffect(() => {
    const unsub = subscribeDownloads((updated) => {
      setJobs(updated)
      const newlyDone = updated.filter(
        (j) => j.state === 'complete' && !notified.current.has(j.model_id)
      )
      if (newlyDone.length > 0) {
        newlyDone.forEach((j) => notified.current.add(j.model_id))
        onComplete()
      }
    })
    return unsub
  }, [onComplete])

  const active = jobs.filter((j) => j.state !== 'complete' && j.state !== 'cancelled')

  if (active.length === 0) return null

  return (
    <div className="border-t border-border bg-surface-1 p-3 space-y-3">
      <p className="text-xs font-medium text-muted uppercase tracking-wider">Downloads</p>
      {active.map((job) => {
        const name = job.model_id.split('/').pop() ?? job.model_id
        const pct = job.progress !== null ? Math.round(job.progress * 100) : null
        const dlGb = job.downloaded_gb.toFixed(2)
        const totalGb = job.total_gb !== null ? job.total_gb.toFixed(2) : '?'

        return (
          <div key={job.model_id} className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-white truncate flex-1" title={job.model_id}>
                {name}
              </span>
              <span className={`text-xs shrink-0 ${STATE_COLORS[job.state] ?? 'text-muted'}`}>
                {job.state === 'running' && pct !== null ? `${pct}%` : job.state}
              </span>
              {(job.state === 'running' || job.state === 'pending') && (
                <button
                  onClick={() => cancelDownload(job.model_id)}
                  className="text-xs text-red-400 hover:text-red-300 shrink-0"
                  title="Cancel download"
                >
                  ✕
                </button>
              )}
            </div>

            {job.state === 'running' && (
              <>
                <ProgressBar value={job.progress} />
                <p className="text-xs text-muted">
                  {dlGb} GB / {totalGb} GB
                </p>
              </>
            )}

            {job.state === 'error' && job.error && (
              <p
                className="text-xs text-red-400 leading-tight"
                title={job.error}
              >
                {job.error.includes('401') || job.error.includes('Access denied')
                  ? '🔒 Gated model — set HF_TOKEN in .env'
                  : job.error.length > 80 ? job.error.slice(0, 80) + '…' : job.error
                }
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
