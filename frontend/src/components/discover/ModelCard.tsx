import type { ModelInfo, DownloadJob } from '@/types'
import { Badge } from '@/components/shared/Badge'

interface ModelCardProps {
  model: ModelInfo
  job?: DownloadJob
  onClick: () => void
  isFavorite?: boolean
  onToggleFavorite?: (e: React.MouseEvent) => void
}

export function ModelCard({ model, job, onClick, isFavorite, onToggleFavorite }: ModelCardProps): React.ReactElement {
  const dlPct = job ? Math.round((job.progress ?? 0) * 100) : 0

  return (
    <div
      onClick={onClick}
      className={`bg-surface border rounded-md p-3.5 cursor-pointer transition-colors flex flex-col gap-2 ${
        model.loaded   ? 'border-accent/30 bg-accent-dim' :
        model.downloaded ? 'border-green/20 hover:border-green/35' :
                         'border-border hover:border-border-hover hover:bg-elevated'
      }`}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-primary leading-tight truncate">{model.name}</div>
          <div className="text-xs text-text-muted mt-0.5">{model.author}</div>
        </div>
        <div className="flex gap-1 flex-wrap justify-end flex-shrink-0 items-start">
          {onToggleFavorite && (
            <button onClick={e => { e.stopPropagation(); onToggleFavorite(e) }}
              className={`w-5 h-5 flex items-center justify-center rounded transition-colors cursor-pointer ${isFavorite ? 'text-yellow' : 'text-text-muted hover:text-yellow'}`}>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </button>
          )}
          {model.quantization && <Badge variant="quant">{model.quantization.split('/')[0]}</Badge>}
          {model.is_moe && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium flex-shrink-0">
              MoE{model.active_params_billion ? ` A${model.active_params_billion}B` : ''}
            </span>
          )}
          {model.has_mtp && <Badge variant="mtp">MTP</Badge>}
          {model.capabilities.thinking && <Badge variant="think">thinking</Badge>}
          {model.capabilities.vision && <Badge variant="vision">vision</Badge>}
          {model.capabilities.tools && <Badge variant="tools">tools</Badge>}
          {model.gated && <Badge variant="gated">gated</Badge>}
          {model.loaded && <Badge variant="loaded">loaded</Badge>}
          {model.downloaded && !model.loaded && <Badge variant="dl">downloaded</Badge>}
        </div>
      </div>

      {model.description && (
        <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">{model.description}</p>
      )}

      <div className="flex gap-3 text-xs text-text-muted">
        {model.downloads != null && <span className="flex items-center gap-1"><DownIcon />{fmtNum(model.downloads)}</span>}
        {model.likes != null && <span className="flex items-center gap-1"><HeartIcon />{fmtNum(model.likes)}</span>}
        {model.params_billion && <span>{model.params_billion}B</span>}
      </div>

      <div className="flex justify-between items-center text-xs">
        <span className="font-mono text-text-secondary">{model.size_gb ? `${model.size_gb.toFixed(2)} GB` : '—'}</span>
        {model.vram_estimate_gb && <span className="text-text-muted">~{model.vram_estimate_gb} GB VRAM</span>}
      </div>

      {job && (job.state === 'running' || job.state === 'pending') && (
        <div className="h-[3px] bg-overlay rounded-sm overflow-hidden">
          <div className="h-full bg-accent rounded-sm transition-all" style={{ width: `${dlPct}%` }} />
        </div>
      )}
    </div>
  )
}

const fmtNum = (n: number): string => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(0)}K` : String(n)

function DownIcon(): React.ReactElement {
  return <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
}
function HeartIcon(): React.ReactElement {
  return <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
}
