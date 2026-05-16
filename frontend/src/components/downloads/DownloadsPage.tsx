import type { DownloadJob } from '@/types'
import { Btn } from '@/components/shared/Btn'

interface DownloadsPageProps {
  jobs: DownloadJob[]
  onCancel: (modelId: string) => void
  onLoad: (modelId: string) => void
}

export function DownloadsPage({ jobs, onCancel, onLoad }: DownloadsPageProps): React.ReactElement {
  const active = jobs.filter(j => j.state === 'running' || j.state === 'pending').length
  const complete = jobs.filter(j => j.state === 'complete').length

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="h-[54px] bg-surface border-b border-border flex items-center px-5 gap-3 flex-shrink-0">
        <span className="text-md font-semibold flex-1">Downloads</span>
        <div className="flex gap-3.5 text-sm text-text-muted">
          {active > 0 && <span className="text-accent">{active} active</span>}
          {complete > 0 && <span>{complete} complete</span>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {jobs.map(job => (
          <DownloadCard key={job.model_id} job={job} onCancel={() => onCancel(job.model_id)} onLoad={() => onLoad(job.model_id)} />
        ))}
        {jobs.length === 0 && (
          <div className="text-center text-text-muted py-16 text-md">No downloads yet</div>
        )}
      </div>
    </div>
  )
}

function DownloadCard({ job, onCancel, onLoad }: { job: DownloadJob; onCancel: () => void; onLoad: () => void }): React.ReactElement {
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
