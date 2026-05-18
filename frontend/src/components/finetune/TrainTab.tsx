import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getFtStatus, listFinetuneJobs, cancelFinetuneJob,
  ftJobStreamUrl, ftExportStreamUrl, ftInstallStreamUrl,
} from '@/api/client'
import type { FinetuneJob, FtStatus, ModelInfo } from '@/types'
import { FTLoadModal } from './FTLoadModal'

const MAX_LOG_LINES = 50

interface TrainTabProps {
  selectedModel: ModelInfo | null
  vramTotalGb: number
  onNavigateToModels: () => void
}

export function TrainTab({ selectedModel, vramTotalGb, onNavigateToModels }: TrainTabProps): React.ReactElement {
  const [status, setStatus] = useState<FtStatus | null>(null)
  const [jobs, setJobs] = useState<FinetuneJob[]>([])
  const [showConfig, setShowConfig] = useState(false)
  const [installLogs, setInstallLogs] = useState<string[]>([])
  const [installing, setInstalling] = useState(false)

  const loadData = async (): Promise<void> => {
    try {
      const [s, j] = await Promise.all([getFtStatus(), listFinetuneJobs()])
      setStatus(s)
      setJobs(j)
    } catch { /* best-effort */ }
  }

  useEffect(() => { void loadData() }, [])

  const handleInstall = (): void => {
    setInstalling(true)
    setInstallLogs([])
    ftInstallStreamUrl().then(url => {
      const es = new EventSource(url)
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as { type: string; text?: string; label?: string }
          if (data.type === 'done') {
            es.close()
            setInstalling(false)
            void loadData()
          } else if (data.type === 'error') {
            setInstallLogs(l => [...l.slice(-MAX_LOG_LINES + 1), `ERROR: ${data.text ?? ''}`])
            es.close()
            setInstalling(false)
          } else if (data.type === 'step') {
            setInstallLogs(l => [...l.slice(-MAX_LOG_LINES + 1), `>>> ${data.label ?? ''}`])
          } else if (data.type === 'log' && data.text) {
            setInstallLogs(l => [...l.slice(-MAX_LOG_LINES + 1), data.text!])
          }
        } catch { /* skip */ }
      }
      es.onerror = () => { es.close(); setInstalling(false) }
    }).catch(() => setInstalling(false))
  }

  const handleJobStarted = (job: FinetuneJob): void => {
    setShowConfig(false)
    setJobs(prev => [job, ...prev])
  }

  return (
    <div className="flex flex-col flex-1 overflow-y-auto gap-6 p-5">
      {status && !status.unsloth_available && (
        <InstallBanner onInstall={handleInstall} installing={installing} logs={installLogs} />
      )}

      <section className="flex flex-col gap-3">
        <div className="text-xs text-text-muted uppercase tracking-widest font-medium">New training run</div>
        {selectedModel ? (
          <div className="bg-surface border border-border rounded-md p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-text-primary font-medium">{selectedModel.name ?? selectedModel.id.split('/').pop()}</div>
              <div className="text-xs text-text-muted mt-0.5">{selectedModel.params_billion ? `${selectedModel.params_billion}B` : ''} · {selectedModel.author}</div>
            </div>
            <button
              onClick={() => setShowConfig(true)}
              disabled={status ? !status.unsloth_available : false}
              className="px-4 py-2 text-xs bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-sm cursor-pointer transition-colors font-medium flex-shrink-0"
            >
              Configure & Start
            </button>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-md p-6 flex flex-col items-center gap-2 text-center">
            <p className="text-sm text-text-muted">Select a model from the Models tab to begin</p>
            <button
              onClick={onNavigateToModels}
              className="mt-1 text-xs text-accent hover:text-accent/80 cursor-pointer transition-colors"
            >
              Go to Models →
            </button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="text-xs text-text-muted uppercase tracking-widest font-medium">Jobs</div>
        {jobs.length === 0 ? (
          <div className="text-sm text-text-muted/50 py-4 text-center">No jobs yet</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {jobs.map(job => (
              <JobRow
                key={job.id}
                job={job}
                onCancel={async (id) => {
                  try {
                    await cancelFinetuneJob(id)
                    void loadData()
                  } catch { /* best-effort */ }
                }}
                onJobUpdate={(updated) => setJobs(prev => prev.map(j => j.id === updated.id ? updated : j))}
                onRefresh={loadData}
              />
            ))}
          </div>
        )}
      </section>

      {showConfig && selectedModel && (
        <FTLoadModal
          model={selectedModel}
          vramTotalGb={vramTotalGb}
          onStarted={handleJobStarted}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  )
}

function InstallBanner({ onInstall, installing, logs }: {
  onInstall: () => void; installing: boolean; logs: string[]
}): React.ReactElement {
  return (
    <div className="bg-yellow/8 border border-yellow/25 rounded-md p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-yellow">Unsloth not installed</div>
          <div className="text-xs text-text-muted mt-0.5">Required for QLoRA fine-tuning. Install in an isolated venv.</div>
        </div>
        <button
          onClick={onInstall}
          disabled={installing}
          className="px-4 py-2 text-xs bg-yellow/15 hover:bg-yellow/25 disabled:opacity-50 border border-yellow/30 text-yellow rounded-sm cursor-pointer transition-colors font-medium flex-shrink-0"
        >
          {installing ? 'Installing…' : 'Install Unsloth'}
        </button>
      </div>
      {logs.length > 0 && (
        <div className="font-mono text-xs bg-overlay rounded-sm p-3 max-h-40 overflow-y-auto leading-relaxed">
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: FinetuneJob['status'] }): React.ReactElement {
  const map: Record<FinetuneJob['status'], string> = {
    pending: 'bg-text-muted/15 text-text-muted',
    running: 'bg-accent/15 text-accent',
    done: 'bg-green/15 text-green',
    error: 'bg-red-400/15 text-red-400',
    cancelled: 'bg-text-muted/10 text-text-muted/50',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-sm font-medium ${map[status]}`}>{status}</span>
  )
}

function JobRow({ job, onCancel, onJobUpdate, onRefresh }: {
  job: FinetuneJob
  onCancel: (id: string) => Promise<void>
  onJobUpdate: (j: FinetuneJob) => void
  onRefresh: () => void
}): React.ReactElement {
  const [logs, setLogs] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const [exportLogs, setExportLogs] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (job.status !== 'running') return
    let es: EventSource | null = null
    ftJobStreamUrl(job.id).then(url => {
      es = new EventSource(url)
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as { type: string; text?: string; output_dir?: string }
          if (data.type === 'done') {
            es?.close()
            onRefresh()
          } else if (data.type === 'error') {
            setLogs(l => [...l.slice(-MAX_LOG_LINES + 1), `ERROR: ${data.text ?? ''}`])
            es?.close()
          } else if (data.type === 'log' && data.text) {
            setLogs(l => [...l.slice(-MAX_LOG_LINES + 1), data.text!])
          } else if (data.type === 'start') {
            setLogs(l => [...l, 'Training started…'])
          }
        } catch { /* skip */ }
      }
      es.onerror = () => es?.close()
    }).catch(() => {})
    return () => { es?.close() }
  }, [job.id, job.status, onJobUpdate])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logs])

  const handleExport = (): void => {
    setExporting(true)
    setExportLogs([])
    ftExportStreamUrl(job.id).then(url => {
      const es = new EventSource(url)
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as { type: string; text?: string; label?: string; gguf_path?: string }
          if (data.type === 'done') { es.close(); setExporting(false) }
          else if (data.type === 'step') setExportLogs(l => [...l.slice(-MAX_LOG_LINES + 1), `>>> ${data.label ?? ''}`])
          else if (data.type === 'log' && data.text) setExportLogs(l => [...l.slice(-MAX_LOG_LINES + 1), data.text!])
          else if (data.type === 'error') { setExportLogs(l => [...l, `ERROR: ${data.text ?? ''}`]); es.close(); setExporting(false) }
        } catch { /* skip */ }
      }
      es.onerror = () => { es.close(); setExporting(false) }
    }).catch(() => setExporting(false))
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface border border-border rounded-md p-4 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={job.status} />
          {job.status === 'running' && (
            <span className="w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin flex-shrink-0" />
          )}
          <span className="text-xs text-text-muted truncate">{job.model_id.split('/').pop()}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {job.status === 'running' && (
            <button
              onClick={() => onCancel(job.id)}
              className="px-3 py-1 text-xs border border-border text-text-muted hover:text-red-400 hover:border-red-400/30 rounded-sm cursor-pointer transition-colors"
            >
              Cancel
            </button>
          )}
          {job.status === 'done' && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-3 py-1 text-xs bg-green/10 hover:bg-green/20 border border-green/25 text-green disabled:opacity-50 rounded-sm cursor-pointer transition-colors font-medium"
            >
              {exporting ? 'Exporting…' : 'Export GGUF'}
            </button>
          )}
        </div>
      </div>

      {job.error && (
        <div className="text-xs text-red-400 bg-red-400/8 border border-red-400/15 rounded-sm px-3 py-2">{job.error}</div>
      )}

      <AnimatePresence>
        {(logs.length > 0 || job.status === 'running') && (
          <motion.div
            key="logs"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div
              ref={logRef}
              className="font-mono text-xs bg-overlay rounded-sm p-3 max-h-48 overflow-y-auto leading-relaxed text-text-muted"
            >
              {logs.length === 0
                ? <span className="animate-pulse">Waiting for output…</span>
                : logs.map((l, i) => <div key={i}>{l}</div>)
              }
            </div>
          </motion.div>
        )}
        {exportLogs.length > 0 && (
          <motion.div key="export-logs" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="font-mono text-xs bg-overlay rounded-sm p-3 max-h-32 overflow-y-auto leading-relaxed text-text-muted">
              {exportLogs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
