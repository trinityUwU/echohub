import { useEffect, useRef, useState } from 'react'
import { checkModelAccess, getModelInfo, searchModels, startDownload } from '@/api/client'
import type { DownloadJob, GgufFile, ModelInfo } from '@/types'
import { useGpu } from '@/hooks/useGpu'

interface Props {
  loadedModelId: string | null
  onLoad: (id: string) => void
  onDownloaded: () => void
  downloadJobs: Record<string, DownloadJob>
}

// ─── Architecture family detection ────────────────────────────────────────────

function detectArch(id: string): string {
  const lower = id.toLowerCase()
  if (lower.includes('qwen')) return 'qwen3'
  if (lower.includes('mistral') || lower.includes('mixtral')) return 'mistral'
  if (lower.includes('llama')) return 'llama3'
  if (lower.includes('gemma')) return 'gemma'
  if (lower.includes('deepseek')) return 'deepseek'
  if (lower.includes('phi')) return 'phi'
  return ''
}

const ARCH_COLORS: Record<string, string> = {
  qwen3: 'bg-red-900/40 text-red-300 border-red-700/40',
  mistral: 'bg-blue-900/40 text-blue-300 border-blue-700/40',
  llama3: 'bg-orange-900/40 text-orange-300 border-orange-700/40',
  gemma: 'bg-green-900/40 text-green-300 border-green-700/40',
  deepseek: 'bg-violet-900/40 text-violet-300 border-violet-700/40',
  phi: 'bg-cyan-900/40 text-cyan-300 border-cyan-700/40',
}

// ─── Capability icons ──────────────────────────────────────────────────────────

function VisionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

function ThinkingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  )
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

// ─── Left panel list item ──────────────────────────────────────────────────────

function VramBar({ vramEstimateGb, vramTotalGb, params }: { vramEstimateGb: number; vramTotalGb: number; params?: number | null }) {
  const pct = vramTotalGb > 0 ? (vramEstimateGb / vramTotalGb) * 100 : 0
  const clampedPct = Math.min(pct, 100)
  const color = pct > 95 ? 'bg-red-500' : pct > 75 ? 'bg-yellow-500' : 'bg-emerald-500'
  const label = `${params ? `${params}B · ` : ''}~${Math.round(pct)}%`

  return (
    <div className="mt-1.5 w-full">
      <div className="relative w-full h-4 rounded-md overflow-hidden bg-surface-0">
        <div className={`absolute inset-y-0 left-0 ${color} opacity-30 rounded-md`} style={{ width: `${clampedPct}%` }} />
        <div className={`absolute inset-y-0 left-0 ${color} opacity-80`} style={{ width: '2px', marginLeft: `${clampedPct}%`, transform: 'translateX(-1px)' }} />
        <span className="absolute inset-0 flex items-center px-2 text-[10px] font-mono text-white/80">{label}</span>
      </div>
    </div>
  )
}

function ModelListItem({
  model,
  selected,
  onClick,
  vramTotalGb,
}: {
  model: ModelInfo
  selected: boolean
  onClick: () => void
  vramTotalGb: number
}) {
  const arch = detectArch(model.id)
  const archColor = ARCH_COLORS[arch] ?? 'bg-surface-3 text-muted border-border'
  const initials = (model.name || model.id).slice(0, 2).toUpperCase()

  const archBgColors: Record<string, string> = {
    qwen3: 'bg-red-900/60', mistral: 'bg-blue-900/60', llama3: 'bg-orange-900/60',
    gemma: 'bg-green-900/60', deepseek: 'bg-violet-900/60', phi: 'bg-cyan-900/60',
  }
  const archTextColors: Record<string, string> = {
    qwen3: 'text-red-300', mistral: 'text-blue-300', llama3: 'text-orange-300',
    gemma: 'text-green-300', deepseek: 'text-violet-300', phi: 'text-cyan-300',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors border-b border-border/50 last:border-0 ${
        selected ? 'bg-surface-3' : 'hover:bg-surface-2/60'
      }`}
    >
      {/* Logo */}
      <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center font-bold ${archBgColors[arch] ?? 'bg-surface-2'}`}>
        <span className={`font-mono text-xs font-semibold ${archTextColors[arch] ?? 'text-muted'}`}>{initials}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white truncate leading-tight">{model.name}</p>
        {model.author && <p className="text-[10px] text-muted truncate">{model.author}</p>}

        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {arch && (
            <span className={`text-[10px] px-1.5 py-0 rounded border font-mono leading-4 ${archColor}`}>
              {arch}
            </span>
          )}
          {model.quantization && (() => {
            const q = model.quantization!
            const base = q.split('/')[0].toUpperCase()
            const variant = q.includes('/') ? q.split('/')[1] : null
            const colors: Record<string, string> = {
              GGUF: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
              AWQ: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
              GPTQ: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
              FP8: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
              EXL2: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
              W8A16: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
              BF16: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
            }
            return (
              <span className={`text-[10px] px-1.5 py-0 rounded border font-mono leading-4 ${colors[base] ?? 'bg-surface-3 text-muted border-border'}`}>
                {variant ?? base}
              </span>
            )
          })()}
          {model.capabilities.vision && <VisionIcon className="w-3 h-3 text-cyan-400" />}
          {model.capabilities.thinking && <ThinkingIcon className="w-3 h-3 text-violet-400" />}
          {model.capabilities.code && <CodeIcon className="w-3 h-3 text-green-400" />}
          {model.gated && (
            <span className="text-[10px] px-1.5 py-0 rounded border font-mono leading-4 bg-yellow-500/20 text-yellow-300 border-yellow-500/30">
              🔒
            </span>
          )}
        </div>

        {/* VRAM bar */}
        {model.vram_estimate_gb != null && vramTotalGb > 0 && (
          <VramBar vramEstimateGb={model.vram_estimate_gb} vramTotalGb={vramTotalGb} params={model.params_billion} />
        )}
      </div>

      {model.downloaded && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
      )}
    </button>
  )
}

// ─── Right panel detail ────────────────────────────────────────────────────────

const CAP_BADGE_COLORS: Record<string, string> = {
  thinking: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  vision: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  code: 'bg-green-500/20 text-green-300 border-green-500/30',
  multilingual: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
}

function daysAgo(iso: string | null): string | null {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function getArchColor(arch: string): string {
  return ARCH_COLORS[arch] ?? 'bg-surface-3 text-muted border-border'
}

function ModelDetail({
  model,
  loadedModelId,
  onLoad,
  onSelectById,
  downloadJob,
  vramFreeGb,
  vramTotalGb,
}: {
  model: ModelInfo
  loadedModelId: string | null
  onLoad: (id: string) => void
  onSelectById: (id: string) => void
  downloadJob?: DownloadJob
  vramFreeGb: number
  vramTotalGb: number
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [selectedGguf, setSelectedGguf] = useState<GgufFile | null>(null)
  const [gatedError, setGatedError] = useState<string | null>(null)

  const arch = detectArch(model.id)
  const archColor = getArchColor(arch)

  const archBgColors: Record<string, string> = {
    qwen3: 'bg-red-900/60', mistral: 'bg-blue-900/60', llama3: 'bg-orange-900/60',
    gemma: 'bg-green-900/60', deepseek: 'bg-violet-900/60', phi: 'bg-cyan-900/60',
  }
  const archTextColors: Record<string, string> = {
    qwen3: 'text-red-300', mistral: 'text-blue-300', llama3: 'text-orange-300',
    gemma: 'text-green-300', deepseek: 'text-violet-300', phi: 'text-cyan-300',
  }

  const initials = (model.name || model.id).slice(0, 2).toUpperCase()

  // Init GGUF selection when model changes or gguf_files first arrive
  // Use model.id + gguf_files length as stable deps — avoid resetting user selection on re-render
  const ggufCount = model.gguf_files?.length ?? 0
  useEffect(() => {
    if (model.gguf_files && model.gguf_files.length > 0) {
      const preferred =
        model.gguf_files.find(f => f.variant === 'Q4_K_M') ??
        model.gguf_files.find(f => f.variant.startsWith('Q4_K')) ??
        model.gguf_files.find(f => f.variant.startsWith('Q4')) ??
        model.gguf_files[0]
      setSelectedGguf(preferred)
    } else {
      setSelectedGguf(null)
    }
  }, [model.id, ggufCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const isGguf = model.quantization?.toUpperCase().startsWith('GGUF') ||
    (model.gguf_files && model.gguf_files.length > 0)

  const isLoaded = loadedModelId === model.id
  const isLoading = loadingId === model.id
  const isDownloading = downloadJob?.state === 'running' || downloadJob?.state === 'pending'
  const pct = downloadJob?.progress != null ? Math.round(downloadJob.progress * 100) : null

  const canPartialOffload = model.vram_estimate_gb != null &&
    model.vram_estimate_gb > vramFreeGb &&
    model.vram_estimate_gb < vramTotalGb

  const activeCaps = Object.entries(model.capabilities)
    .filter(([, v]) => v)
    .map(([k]) => k)

  const downloadSizeGb = isGguf && selectedGguf ? selectedGguf.size_gb : model.size_gb

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(model.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  const handleDownload = async (): Promise<void> => {
    // Check access first
    try {
      const access = await checkModelAccess(model.id)
      if (!access.accessible && access.gated) {
        setGatedError(access.hf_url ?? `https://huggingface.co/${model.id}`)
        return
      }
    } catch {
      // If check fails, let the download attempt (graceful degradation)
    }
    setGatedError(null)
    try {
      await startDownload({
        model_id: model.id,
        ...(isGguf && selectedGguf ? { gguf_file: selectedGguf.name } : {}),
      })
    } catch (e) {
      console.error('Download start failed:', e)
    }
  }

  const handleLoad = async () => {
    setLoadingId(model.id)
    try {
      await onLoad(model.id)
    } finally {
      setLoadingId(null)
    }
  }

  // Format quant badge color
  const quantBase = model.quantization?.split('/')[0].toUpperCase() ?? ''
  const quantVariant = model.quantization?.includes('/') ? model.quantization.split('/')[1] : null
  const quantColors: Record<string, string> = {
    GGUF: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    AWQ: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    GPTQ: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    FP8: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    EXL2: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
    W8A16: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    BF16: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  }
  const quantBadgeColor = quantColors[quantBase] ?? 'bg-surface-3 text-muted border-border'
  const quantLabel = quantVariant ?? quantBase

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 gap-5">

      {/* Header */}
      <div className="flex items-start gap-3">
        {/* Logo */}
        <div className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center font-bold ${archBgColors[arch] ?? 'bg-surface-2'}`}>
          <span className={`font-mono text-xs font-semibold ${archTextColors[arch] ?? 'text-muted'}`}>{initials}</span>
        </div>

        {/* Name + copy */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 group">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy model ID"
              className="font-mono text-sm text-white truncate leading-tight text-left hover:text-accent transition-colors"
            >
              {model.id}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-white"
              title="Copy to clipboard"
            >
              {copied ? (
                <span className="text-[10px] text-emerald-400 font-mono">Copied!</span>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
          </div>
          {model.author && <p className="text-[10px] text-muted mt-0.5">{model.author}</p>}
        </div>

        {/* Format badge + gated badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          {model.gated && (
            <span className="text-[10px] px-1.5 py-0 rounded border font-mono leading-4 bg-yellow-500/20 text-yellow-300 border-yellow-500/30">
              🔒
            </span>
          )}
          {model.quantization && (
            <span className={`text-xs px-2 py-0.5 rounded border font-mono ${quantBadgeColor}`}>
              {quantLabel}
            </span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4">
        {model.downloads !== null && (
          <span className="text-xs text-muted flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="text-white font-mono">{model.downloads.toLocaleString()}</span>
          </span>
        )}
        {model.likes !== null && (
          <span className="text-xs text-muted flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="text-white font-mono">{model.likes.toLocaleString()}</span>
          </span>
        )}
        {model.last_modified && (
          <span className="text-xs text-muted">{daysAgo(model.last_modified)}</span>
        )}
      </div>

      {/* Description */}
      {model.description && (
        <div className="bg-surface-2 rounded-xl p-4 text-xs text-white/80 leading-relaxed">
          {model.description}
        </div>
      )}

      {/* Metadata pills */}
      <div className="flex flex-wrap gap-2">
        {model.params_billion !== null && (
          <span className="text-xs px-2.5 py-1 rounded-lg bg-surface-3 border border-border font-mono text-white">
            {model.params_billion}B
          </span>
        )}
        {arch && (
          <span className={`text-xs px-2.5 py-1 rounded-lg border font-mono ${archColor}`}>
            {arch}
          </span>
        )}
        {model.arch_tag && model.arch_tag !== arch && (
          <span className={`text-xs px-2.5 py-1 rounded-lg border font-mono ${getArchColor(model.arch_tag)}`}>
            {model.arch_tag}
          </span>
        )}
        {model.quantization && (
          <span className={`text-xs px-2.5 py-1 rounded-lg border font-mono ${quantBadgeColor}`}>
            {quantLabel}
          </span>
        )}
        {model.max_context_window && (
          <span className="text-xs px-2.5 py-1 rounded-lg bg-surface-3 border border-border font-mono text-white">
            {model.max_context_window >= 1024
              ? `${(model.max_context_window / 1024).toFixed(0)}K ctx`
              : `${model.max_context_window} ctx`}
          </span>
        )}
        {model.pipeline_tag && (
          <span className="text-xs px-2.5 py-1 rounded-lg bg-surface-3 border border-border text-muted">
            {model.pipeline_tag}
          </span>
        )}
      </div>

      {/* Capabilities */}
      {activeCaps.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Capabilities</p>
          <div className="flex flex-wrap gap-2">
            {activeCaps.map(cap => (
              <span key={cap} className={`text-xs px-2.5 py-1 rounded-lg border ${CAP_BADGE_COLORS[cap] ?? 'bg-surface-3 text-muted border-border'}`}>
                {cap.charAt(0).toUpperCase() + cap.slice(1)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* GGUF file selector — dropdown */}
      {isGguf && model.gguf_files && model.gguf_files.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">Quantization variant</p>
          <div className="relative">
            <select
              value={selectedGguf?.name ?? ''}
              onChange={e => {
                const f = model.gguf_files!.find(f => f.name === e.target.value)
                if (f) setSelectedGguf(f)
              }}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent/60 appearance-none cursor-pointer"
            >
              {model.gguf_files.map(f => (
                <option key={f.name} value={f.name}>
                  {f.variant} — {f.size_gb.toFixed(1)} GB
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              <svg className="w-3.5 h-3.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
          {selectedGguf && (
            <p className="text-[10px] text-muted mt-1">
              {selectedGguf.name} · {selectedGguf.size_gb.toFixed(2)} GB
            </p>
          )}
        </div>
      )}

      {/* VRAM bar */}
      {model.vram_estimate_gb != null && vramTotalGb > 0 && (
        <div>
          <VramBar vramEstimateGb={model.vram_estimate_gb} vramTotalGb={vramTotalGb} params={model.params_billion} />
          <div className="flex justify-between text-[10px] text-muted mt-1">
            <span>~{model.vram_estimate_gb.toFixed(1)} GB needed</span>
            <span>{vramFreeGb.toFixed(1)} GB free / {vramTotalGb.toFixed(1)} GB total</span>
          </div>
        </div>
      )}

      {/* Partial GPU offload notice */}
      {canPartialOffload && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-300">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Partial GPU Offload Possible
        </div>
      )}

      {/* Download progress */}
      {isDownloading && (
        <div>
          <div className="flex justify-between text-xs text-muted mb-1.5">
            <span>{downloadJob?.state === 'pending' ? 'Queued…' : 'Downloading…'}</span>
            {pct !== null && <span className="font-mono">{pct}%</span>}
          </div>
          <div className="w-full h-1.5 bg-surface-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500"
              style={{ width: pct !== null ? `${pct}%` : '30%' }}
            />
          </div>
          {downloadJob && (
            <p className="text-xs text-muted mt-1 font-mono">
              {downloadJob.downloaded_gb.toFixed(2)} GB
              {downloadJob.total_gb ? ` / ${downloadJob.total_gb.toFixed(2)} GB` : ''}
            </p>
          )}
        </div>
      )}

      {/* More from author */}
      {model.more_from_author && model.more_from_author.length > 0 && model.author && (
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
            More from {model.author}
          </p>
          <div className="flex flex-col gap-0.5">
            {model.more_from_author.map(m => {
              const modelName = m.id.includes('/') ? m.id.split('/')[1] : m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSelectById(m.id)}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-surface-2 transition-colors text-left"
                >
                  <span className="text-xs text-white/80 font-mono truncate">{modelName}</span>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    {m.downloads !== null && (
                      <span className="text-[10px] text-muted flex items-center gap-0.5">
                        <svg className="w-3 h-3 text-sky-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        {m.downloads.toLocaleString()}
                      </span>
                    )}
                    {m.likes !== null && (
                      <span className="text-[10px] text-muted flex items-center gap-0.5">
                        <svg className="w-3 h-3 text-yellow-400/60" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                        {m.likes.toLocaleString()}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Gated model error */}
      {gatedError && (
        <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-300 space-y-1">
          <p className="font-semibold">🔒 Gated model — license required</p>
          <p>Accept the license on HuggingFace, then configure your HF Token in Settings.</p>
          <a
            href={gatedError}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-yellow-200 hover:text-white"
          >
            Accept license on HuggingFace →
          </a>
        </div>
      )}

      {/* Action */}
      <div className="mt-auto pt-2">
        {!model.downloaded && !isDownloading && (
          <button
            onClick={handleDownload}
            disabled={!!(isGguf && !selectedGguf)}
            title={isGguf && !selectedGguf ? 'Loading file list…' : undefined}
            className="w-full py-2.5 rounded-xl bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isGguf && !selectedGguf
              ? 'Loading variants…'
              : `Download${downloadSizeGb !== null ? ` ${downloadSizeGb.toFixed(1)} GB` : ''}`
            }
          </button>
        )}
        {model.downloaded && !isDownloading && (
          <button
            onClick={handleLoad}
            disabled={isLoading || isLoaded}
            className={`w-full py-2.5 rounded-xl border transition-colors text-sm font-medium ${
              isLoaded
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 cursor-default'
                : 'bg-surface-3 text-white border-border hover:bg-surface-4 disabled:opacity-50'
            }`}
          >
            {isLoaded ? 'Loaded' : isLoading ? 'Loading…' : 'Load Model'}
          </button>
        )}
        {isDownloading && (
          <div className="w-full py-2.5 text-center text-sm text-muted">Downloading…</div>
        )}
      </div>
    </div>
  )
}

// ─── ModelBrowser (split panel) ────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: 'best', label: 'Best Match' },
  { value: 'downloads', label: 'Most Downloads' },
  { value: 'likes', label: 'Most Liked' },
]

const FORMAT_OPTIONS = [
  { value: 'gguf',  label: 'GGUF',  color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  { value: 'awq',   label: 'AWQ',   color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  { value: 'gptq',  label: 'GPTQ',  color: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
  { value: 'fp8',   label: 'FP8',   color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  { value: 'exl2',  label: 'EXL2',  color: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
]

const DEFAULT_FORMATS = ['gguf', 'awq', 'gptq']

export function ModelBrowser({ loadedModelId, onLoad, onDownloaded: _onDownloaded, downloadJobs }: Props) {
  const gpu = useGpu()
  const vramFreeGb = gpu ? gpu.vram_free_mb / 1024 : 0
  const vramTotalGb = gpu ? gpu.vram_total_mb / 1024 : 0
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('best')
  const [formats, setFormats] = useState<string[]>(DEFAULT_FORMATS)
  const [results, setResults] = useState<ModelInfo[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ModelInfo | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<ModelInfo | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const PAGE_SIZE = 20

  const toggleFormat = (fmt: string) => {
    setFormats(prev =>
      prev.includes(fmt)
        ? prev.length > 1 ? prev.filter(f => f !== fmt) : prev
        : [...prev, fmt]
    )
  }

  // Reset + nouvelle recherche quand query/sort/formats changent
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setSelected(null)
      setPage(0)
      setHasMore(true)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setError(null)
      setPage(0)
      try {
        const data = await searchModels(query, formats.join(','), 0)
        let sorted = [...data]
        if (sort === 'downloads') sorted.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
        else if (sort === 'likes') sorted.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
        setResults(sorted)
        setHasMore(data.length === PAGE_SIZE)
      } catch (e) {
        setError(String(e))
      } finally {
        setSearching(false)
      }
    }, 400)
  }, [query, sort, formats])

  const loadMore = async () => {
    if (loadingMore || !hasMore || !query.trim()) return
    setLoadingMore(true)
    const nextPage = page + 1
    try {
      const data = await searchModels(query, formats.join(','), nextPage)
      let sorted = [...data]
      if (sort === 'downloads') sorted.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
      else if (sort === 'likes') sorted.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
      setResults(prev => {
        const seen = new Set(prev.map(m => m.id))
        return [...prev, ...sorted.filter(m => !seen.has(m.id))]
      })
      setPage(nextPage)
      setHasMore(data.length === PAGE_SIZE)
    } catch {
      // silently fail on pagination
    } finally {
      setLoadingMore(false)
    }
  }

  // Scroll infini — observer sur le dernier élément
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      loadMore()
    }
  }

  // Keep selected in sync when downloadJobs changes
  useEffect(() => {
    if (selected) {
      const fresh = results.find(m => m.id === selected.id)
      if (fresh) setSelected(fresh)
    }
  }, [results]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectModel = (model: ModelInfo) => {
    setSelected(model)
    setSelectedDetail(null)
    getModelInfo(model.id)
      .then(detail => setSelectedDetail(detail))
      .catch(() => {})
  }

  const handleSelectById = (id: string) => {
    // Chercher dans les résultats existants ou créer un stub minimal
    const existing = results.find(m => m.id === id)
    const stub: ModelInfo = existing ?? {
      id, name: id.split('/').pop() ?? id,
      author: id.includes('/') ? id.split('/')[0] : null,
      size_gb: null, capabilities: { thinking: false, vision: false, code: false, multilingual: false, tools: false },
      downloaded: false, loaded: false, quantization: null, downloads: null, likes: null,
      params_billion: null, vram_estimate_gb: null, max_context_window: null,
      description: null, last_modified: null, pipeline_tag: null, arch_tag: null,
      gguf_files: null, more_from_author: null, gated: false,
    }
    handleSelectModel(stub)
    // Scroll la liste vers le haut
    if (listRef.current) listRef.current.scrollTop = 0
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel — list */}
      <div className="w-80 shrink-0 flex flex-col border-r border-border">
        {/* Search + sort + format filters */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search models…"
              className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent/60 pr-20"
            />
            {searching && (
              <span className="absolute right-3 top-2.5 text-xs text-muted animate-pulse">
                searching…
              </span>
            )}
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="w-full bg-surface-3 border border-border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-accent/60 cursor-pointer"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Format chips — multi-select */}
          <div className="flex flex-wrap gap-1.5">
            {FORMAT_OPTIONS.map(f => {
              const active = formats.includes(f.value)
              return (
                <button
                  key={f.value}
                  onClick={() => toggleFormat(f.value)}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                    active ? f.color : 'bg-surface-3 text-muted border-border hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Results list */}
        <div ref={listRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
          {error && (
            <p className="text-xs text-red-400 px-3 py-2">{error}</p>
          )}
          {!query && (
            <p className="text-xs text-muted px-3 py-4">Type a model name to search HuggingFace</p>
          )}
          {query && results.length === 0 && !searching && (
            <p className="text-xs text-muted px-3 py-4">No results for "{query}"</p>
          )}
          {results.map(model => (
            <ModelListItem
              key={model.id}
              model={model}
              selected={selected?.id === model.id}
              onClick={() => handleSelectModel(model)}
              vramTotalGb={vramTotalGb}
            />
          ))}
          {/* Pagination indicator */}
          {loadingMore && (
            <div className="flex items-center justify-center py-3 gap-2">
              <div className="w-3 h-3 rounded-full border border-muted/40 border-t-accent animate-spin" />
              <span className="text-xs text-muted">Loading more…</span>
            </div>
          )}
          {!hasMore && results.length > 0 && (
            <p className="text-[10px] text-muted/40 text-center py-3">{results.length} results</p>
          )}
        </div>
      </div>

      {/* Right panel — detail */}
      <div className="flex-1 min-w-0 bg-surface-1">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-center px-8">
            <div className="space-y-2">
              <p className="text-sm font-medium text-white">No model selected</p>
              <p className="text-xs text-muted">Search and select a model on the left to see details</p>
            </div>
          </div>
        ) : (
          <ModelDetail
            model={selectedDetail ?? selected}
            loadedModelId={loadedModelId}
            onLoad={onLoad}
            onSelectById={handleSelectById}
            downloadJob={downloadJobs[selected.id]}
            vramFreeGb={vramFreeGb}
            vramTotalGb={vramTotalGb}
          />
        )}
      </div>
    </div>
  )
}
