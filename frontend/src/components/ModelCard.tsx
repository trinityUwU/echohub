import { startDownload } from '@/api/client'
import type { DownloadJob, ModelInfo } from '@/types'
import { VramBadge } from './VramBadge'

interface Props {
  model: ModelInfo
  onLoad: (id: string) => void
  onDownloaded: () => void
  loadedModelId: string | null
  loadingModelId: string | null
  downloadJob?: DownloadJob
  vramFreeGb?: number
}

const CAP_COLORS: Record<string, string> = {
  thinking: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  vision: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  code: 'bg-green-500/20 text-green-300 border-green-500/30',
  multilingual: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
}

const QUANT_COLORS: Record<string, string> = {
  AWQ: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  GPTQ: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
}

export function ModelCard({ model, onLoad, loadedModelId, loadingModelId, downloadJob, vramFreeGb = 0 }: Props) {
  const activeCaps = Object.entries(model.capabilities)
    .filter(([, v]) => v)
    .map(([k]) => k)

  const isLoaded = loadedModelId === model.id
  const isLoading = loadingModelId === model.id
  const isDownloading = downloadJob?.state === 'running' || downloadJob?.state === 'pending'
  const pct = downloadJob?.progress !== null && downloadJob?.progress !== undefined
    ? Math.round(downloadJob.progress * 100)
    : null

  const handleDownload = async () => {
    try {
      await startDownload({ model_id: model.id })
    } catch (e) {
      console.error('Download start failed:', e)
    }
  }

  return (
    <div className="p-4 rounded-xl bg-surface-2 border border-border hover:border-accent/40 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{model.name}</p>
          {model.author && (
            <p className="text-xs text-muted truncate">{model.author}</p>
          )}
        </div>
        {model.quantization && (
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded border font-mono ${QUANT_COLORS[model.quantization] ?? 'bg-surface-3 text-muted border-border'}`}>
            {model.quantization}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {activeCaps.map((cap) => (
          <span key={cap} className={`text-xs px-2 py-0.5 rounded border ${CAP_COLORS[cap]}`}>
            {cap}
          </span>
        ))}
        {model.size_gb !== null && (
          <span className="text-xs px-2 py-0.5 rounded border bg-surface-3 text-muted border-border">
            {model.size_gb} GB
          </span>
        )}
      </div>

      {/* Context window badge */}
      {model.max_context_window && (
        <div className="mb-2">
          <span className="text-xs px-2 py-0.5 rounded border bg-surface-3 text-muted border-border font-mono">
            {model.max_context_window >= 1024
              ? `${(model.max_context_window / 1024).toFixed(0)}K ctx`
              : `${model.max_context_window} ctx`}
          </span>
        </div>
      )}

      {/* VRAM estimate badge */}
      {model.vram_estimate_gb !== null && vramFreeGb > 0 && (
        <div className="mb-2">
          <VramBadge
            vramEstimateGb={model.vram_estimate_gb}
            vramFreeGb={vramFreeGb}
            paramsBillion={model.params_billion}
          />
        </div>
      )}

      {(model.downloads !== null || model.likes !== null) && (
        <div className="flex gap-3 text-xs text-muted mb-3">
          {model.downloads !== null && <span>↓ {model.downloads.toLocaleString()}</span>}
          {model.likes !== null && <span>♥ {model.likes.toLocaleString()}</span>}
        </div>
      )}

      {/* Download progress bar */}
      {isDownloading && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-muted mb-1">
            <span>{downloadJob?.state === 'pending' ? 'Queued…' : 'Downloading…'}</span>
            {pct !== null && <span>{pct}%</span>}
          </div>
          <div className="w-full h-1 bg-surface-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500"
              style={{ width: pct !== null ? `${pct}%` : '30%' }}
            />
          </div>
          {downloadJob && (
            <p className="text-xs text-muted mt-1">
              {downloadJob.downloaded_gb.toFixed(2)} GB
              {downloadJob.total_gb ? ` / ${downloadJob.total_gb.toFixed(2)} GB` : ''}
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        {!model.downloaded && !isDownloading ? (
          <button
            onClick={handleDownload}
            className="flex-1 text-xs py-1.5 rounded-lg bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors"
          >
            Download
          </button>
        ) : isDownloading ? (
          <span className="flex-1 text-xs py-1.5 text-center text-muted">Downloading…</span>
        ) : (
          <button
            onClick={() => onLoad(model.id)}
            disabled={isLoading || isLoaded}
            className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors ${
              isLoaded
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : 'bg-surface-3 text-white border-border hover:bg-surface-4 disabled:opacity-50'
            }`}
          >
            {isLoaded ? 'Loaded' : isLoading ? 'Loading…' : 'Load'}
          </button>
        )}
      </div>
    </div>
  )
}
