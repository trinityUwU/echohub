import type { DownloadJob, GgufFile, ModelInfo } from '@/types'
import { VramBar, ARCH_FAMILIES, FORMAT_COLORS, detectArch, getFormatBase } from './DiscoverPage'

interface Props {
  model: ModelInfo
  selectedGguf: GgufFile | null
  onSelectGguf: (g: GgufFile) => void
  loadedModelId: string | null
  downloadJobs: Record<string, DownloadJob>
  vramTotalGb: number
  vramFreeGb: number
  gatedError: string | null
  copied: boolean
  onCopy: () => void
  onDownload: () => void
  onLoad: (id: string, manual?: boolean) => void
  onSelectRelated: (id: string) => void
}

export function ModelDetail({
  model, selectedGguf, onSelectGguf, loadedModelId, downloadJobs,
  vramTotalGb, vramFreeGb, gatedError, copied, onCopy, onDownload, onLoad, onSelectRelated,
}: Props) {
  const arch = detectArch(model.id)
  const archStyle = ARCH_FAMILIES[arch]
  const fmt = model.quantization ? FORMAT_COLORS[getFormatBase(model.quantization)] : null
  const isDownloading = !!downloadJobs[model.id] && downloadJobs[model.id].state === 'running'
  const isLoaded = loadedModelId === model.id
  const job = downloadJobs[model.id]

  const daysAgo = model.last_modified
    ? Math.round((Date.now() - new Date(model.last_modified).getTime()) / 86400000)
    : null

  const caps = [
    model.capabilities.vision && { label: 'Vision', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
    model.capabilities.thinking && { label: 'Thinking', cls: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
    model.capabilities.code && { label: 'Code', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    model.capabilities.tools && { label: 'Tools', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    model.capabilities.multilingual && { label: 'Multilingual', cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
  ].filter(Boolean) as { label: string; cls: string }[]

  return (
    <div className="p-6 space-y-5 relative">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${archStyle?.bg ?? 'bg-surface-3'}`}>
          <span className={`text-xs font-mono font-semibold ${archStyle?.text ?? 'text-muted/60'}`}>
            {model.name.slice(0, 2)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono truncate">{model.id}</span>
            <button onClick={onCopy} className="text-muted/40 hover:text-white transition-colors shrink-0">
              {copied ? (
                <span className="text-2xs text-emerald-400">Copied!</span>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-2xs text-muted/50">{model.author}</p>
          <div className="flex gap-4 text-2xs text-muted/50 mt-1">
            {model.downloads != null && <span>↓ {model.downloads.toLocaleString()}</span>}
            {model.likes != null && <span>★ {model.likes}</span>}
            {daysAgo != null && <span>{daysAgo}d ago</span>}
          </div>
        </div>
        {fmt && (
          <span className={`text-2xs font-mono px-2 py-0.5 rounded border ${fmt.bg} ${fmt.text} ${fmt.border}`}>
            {model.quantization}
          </span>
        )}
      </div>

      {/* Description */}
      {model.description && (
        <div className="bg-surface-2/40 rounded-lg p-3 text-xs text-white/65 leading-relaxed">
          {model.description}
        </div>
      )}

      {/* Metadata pills */}
      <div className="flex gap-2 flex-wrap">
        {model.params_billion && (
          <span className="bg-surface-2 rounded-md px-2 py-1 text-xs text-white/65">{model.params_billion}B params</span>
        )}
        {archStyle && (
          <span className={`rounded-md px-2 py-1 text-xs ${archStyle.bg} ${archStyle.text}`}>{archStyle.label}</span>
        )}
        {model.quantization && (
          <span className="bg-surface-2 rounded-md px-2 py-1 text-xs text-white/65">{model.quantization}</span>
        )}
        {model.max_context_window && (
          <span className="bg-surface-2 rounded-md px-2 py-1 text-xs text-white/65">{(model.max_context_window / 1024)}K ctx</span>
        )}
        {model.pipeline_tag && (
          <span className="bg-surface-2 rounded-md px-2 py-1 text-xs text-white/65">{model.pipeline_tag}</span>
        )}
      </div>

      {/* Capabilities */}
      {caps.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {caps.map(c => (
            <span key={c.label} className={`text-2xs px-2 py-0.5 rounded-md border ${c.cls}`}>{c.label}</span>
          ))}
        </div>
      )}

      {/* GGUF dropdown */}
      {model.gguf_files && model.gguf_files.length > 0 && (
        <div>
          <label className="text-2xs text-muted/50 block mb-1">Quantization variant</label>
          <select
            value={selectedGguf?.name ?? ''}
            onChange={e => {
              const f = model.gguf_files?.find(g => g.name === e.target.value)
              if (f) onSelectGguf(f)
            }}
            className="bg-surface-2 w-full rounded-lg px-3 py-2 text-xs text-white border-0 focus:outline-none focus:ring-1 focus:ring-accent/30 appearance-none cursor-pointer"
          >
            {model.gguf_files.map(f => (
              <option key={f.name} value={f.name}>{f.variant} — {f.size_gb.toFixed(2)} GB</option>
            ))}
          </select>
        </div>
      )}

      {/* VRAM bar */}
      {model.vram_estimate_gb && vramTotalGb > 0 && (
        <div>
          <VramBar vramEstimateGb={model.vram_estimate_gb} vramTotalGb={vramTotalGb} params={model.params_billion} large />
          <div className="flex justify-between text-2xs text-muted/40 mt-1">
            <span>~{model.vram_estimate_gb.toFixed(1)} GB needed</span>
            <span>{vramFreeGb.toFixed(1)} GB free / {vramTotalGb.toFixed(1)} GB total</span>
          </div>
        </div>
      )}

      {/* Partial offload warning */}
      {model.vram_estimate_gb && model.vram_estimate_gb > vramFreeGb && model.vram_estimate_gb < vramTotalGb && (
        <div className="flex items-center gap-2 text-2xs text-amber-400/70 bg-amber-500/[0.05] rounded-lg px-3 py-2">
          <span>⚠</span>
          <span>Model may require partial CPU offload with current VRAM usage</span>
        </div>
      )}

      {/* Gated error */}
      {gatedError && (
        <div className="bg-red-500/[0.06] border border-red-500/20 rounded-lg p-3 space-y-1">
          <p className="text-xs font-medium text-red-400">🔒 License required</p>
          <p className="text-2xs text-red-300/60">{gatedError}</p>
        </div>
      )}

      {/* Download progress */}
      {isDownloading && job && (
        <div className="space-y-1">
          <div className="flex justify-between text-2xs text-muted/50">
            <span>Downloading…</span>
            <span>{job.downloaded_gb.toFixed(1)} / {(job.total_gb ?? 0).toFixed(1)} GB</span>
          </div>
          <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
            <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${(job.progress ?? 0) * 100}%` }} />
          </div>
        </div>
      )}

      {/* More from author */}
      {model.more_from_author && model.more_from_author.length > 0 && (
        <div className="border-t border-white/[0.05] pt-4 space-y-1">
          <p className="text-2xs uppercase tracking-wider text-muted/40 mb-2">More from {model.author}</p>
          {model.more_from_author.map(m => (
            <button
              key={m.id}
              onClick={() => onSelectRelated(m.id)}
              className="flex justify-between w-full px-2 py-1.5 rounded-lg hover:bg-surface-2/60 text-xs text-white/70 transition-colors"
            >
              <span className="truncate">{m.id.split('/').pop()}</span>
              <span className="text-2xs text-muted/40">↓ {m.downloads?.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}

      {/* Action button */}
      <div className="sticky bottom-0 pb-2 pt-2 bg-gradient-to-t from-surface-1/80 to-transparent">
        {isLoaded ? (
          <button className="w-full py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-medium" disabled>
            Loaded
          </button>
        ) : model.downloaded && !isDownloading ? (
          <button
            onClick={() => onLoad(model.id)}
            className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-dim transition-colors"
          >
            Load Model
          </button>
        ) : !isDownloading ? (
          <button
            onClick={onDownload}
            className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-dim transition-colors disabled:opacity-40"
          >
            Download
          </button>
        ) : null}
      </div>
    </div>
  )
}
