import { useState, useEffect, useRef, useCallback } from 'react'
import { searchModels, getModelInfo, checkModelAccess, startDownload } from '@/api/client'
import type { DownloadJob, GgufFile, ModelInfo } from '@/types'
import { ModelDetail } from './ModelDetail'

interface Props {
  loadedModelId: string | null
  onLoad: (id: string, manual?: boolean) => void
  onDownloaded: () => void
  downloadJobs: Record<string, DownloadJob>
  vramTotalGb: number
  vramFreeGb: number
}

const ARCH_FAMILIES: Record<string, { bg: string; text: string; label: string }> = {
  qwen: { bg: 'bg-red-900/40', text: 'text-red-300', label: 'qwen3' },
  mistral: { bg: 'bg-blue-900/40', text: 'text-blue-300', label: 'mistral' },
  llama: { bg: 'bg-orange-900/40', text: 'text-orange-300', label: 'llama3' },
  gemma: { bg: 'bg-green-900/40', text: 'text-green-300', label: 'gemma' },
  deepseek: { bg: 'bg-violet-900/40', text: 'text-violet-300', label: 'deepseek' },
  phi: { bg: 'bg-cyan-900/40', text: 'text-cyan-300', label: 'phi' },
}

const FORMAT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  GGUF: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  AWQ: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  GPTQ: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/20' },
  FP8: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
  EXL2: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500/20' },
  W8A16: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  BF16: { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20' },
}

function detectArch(id: string): string {
  const lower = id.toLowerCase()
  if (lower.includes('qwen')) return 'qwen'
  if (lower.includes('mistral') || lower.includes('mixtral')) return 'mistral'
  if (lower.includes('llama')) return 'llama'
  if (lower.includes('gemma')) return 'gemma'
  if (lower.includes('deepseek')) return 'deepseek'
  if (lower.includes('phi')) return 'phi'
  return ''
}

function getFormatBase(quant: string): string {
  return quant.split('/')[0].toUpperCase()
}

function VramBar({ vramEstimateGb, vramTotalGb, params, large = false }: {
  vramEstimateGb: number; vramTotalGb: number; params?: number | null; large?: boolean
}) {
  const pct = Math.min((vramEstimateGb / vramTotalGb) * 100, 100)
  const color = pct > 95 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500'
  const h = large ? 'h-5' : 'h-3.5'
  const textSize = large ? 'text-xs' : 'text-[10px]'
  return (
    <div className={`w-full ${h} rounded overflow-hidden bg-surface-0 relative`}>
      <div className={`absolute inset-y-0 left-0 ${color} opacity-[0.15]`} style={{ width: `${pct}%` }} />
      <div className={`absolute inset-y-0 w-px ${color} opacity-60`} style={{ left: `${pct}%`, transform: 'translateX(-1px)' }} />
      <span className={`absolute inset-0 flex items-center px-2 ${textSize} font-mono text-white/60`}>
        {params != null ? `${params}B · ` : ''}~{Math.round(pct)}%
      </span>
    </div>
  )
}

function EyeIcon({ className }: { className?: string }) {
  return <svg className={className} width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
}

function BrainIcon({ className }: { className?: string }) {
  return <svg className={className} width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
}

function CodeIcon({ className }: { className?: string }) {
  return <svg className={className} width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
}

const PAGE_SIZE = 20

export function DiscoverPage({ loadedModelId, onLoad, onDownloaded, downloadJobs, vramTotalGb, vramFreeGb }: Props) {
  const [query, setQuery] = useState('')
  const [formats, setFormats] = useState<string[]>(['gguf', 'awq', 'gptq'])
  const [results, setResults] = useState<ModelInfo[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<ModelInfo | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<ModelInfo | null>(null)
  const [selectedGguf, setSelectedGguf] = useState<GgufFile | null>(null)
  const [gatedError, setGatedError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const doSearch = useCallback(async (q: string, f: string[], p: number, append: boolean) => {
    if (!q.trim()) { setResults([]); setHasMore(true); return }
    if (p === 0) setSearching(true)
    else setLoadingMore(true)
    try {
      const filterStr = f.join(',')
      const data = await searchModels(q, filterStr, p)
      if (append) setResults(prev => [...prev, ...data])
      else setResults(data)
      setHasMore(data.length >= PAGE_SIZE)
    } catch {
      // ignore
    } finally {
      setSearching(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    setPage(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doSearch(query, formats, 0, false)
    }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, formats, doSearch])

  const handleScroll = (): void => {
    const el = listRef.current
    if (!el || loadingMore || !hasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      const nextPage = page + 1
      setPage(nextPage)
      doSearch(query, formats, nextPage, true)
    }
  }

  const handleSelectModel = (model: ModelInfo): void => {
    setSelected(model)
    setSelectedDetail(null)
    setGatedError(null)
    setSelectedGguf(null)
    getModelInfo(model.id).then(detail => {
      setSelectedDetail(detail)
      if (detail.gguf_files && detail.gguf_files.length > 0) {
        const q4 = detail.gguf_files.find(f => f.variant.includes('Q4_K_M'))
        setSelectedGguf(q4 ?? detail.gguf_files[0])
      }
    }).catch(() => {})
  }

  const handleDownload = async (): Promise<void> => {
    const model = selectedDetail ?? selected
    if (!model) return
    try {
      const access = await checkModelAccess(model.id)
      if (access.gated && !access.accessible) {
        setGatedError(access.reason ?? `This model requires accepting a license at ${access.hf_url}`)
        return
      }
    } catch {
      // continue anyway
    }
    try {
      await startDownload({ model_id: model.id, gguf_file: selectedGguf?.name })
      onDownloaded()
    } catch {
      // ignore
    }
  }

  const toggleFormat = (f: string): void => {
    setFormats(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel - search results */}
      <div className="w-72 shrink-0 flex flex-col border-r border-white/[0.05] bg-surface-1">
        <div className="p-3 border-b border-white/[0.05] space-y-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search HuggingFace…"
            className="bg-surface-2 w-full rounded-lg px-3 py-2 text-sm placeholder:text-muted/40 border-0 focus:outline-none focus:ring-1 focus:ring-accent/30 text-white"
          />
          <div className="flex flex-wrap gap-1.5">
            {['gguf', 'awq', 'gptq', 'fp8', 'exl2'].map(f => {
              const active = formats.includes(f)
              const fmt = FORMAT_COLORS[f.toUpperCase()]
              return (
                <button
                  key={f}
                  onClick={() => toggleFormat(f)}
                  className={`text-2xs font-mono px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                    active && fmt
                      ? `${fmt.bg} ${fmt.text} ${fmt.border}`
                      : 'bg-surface-3/50 text-muted/40 border-white/[0.05]'
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              )
            })}
          </div>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
          {!query && !searching && (
            <p className="text-2xs text-muted/40 text-center p-6">Search HuggingFace…</p>
          )}
          {searching && results.length === 0 && (
            <p className="text-2xs text-muted/40 text-center p-6 animate-pulse">Searching…</p>
          )}
          {results.map(model => {
            const arch = detectArch(model.id)
            const archStyle = ARCH_FAMILIES[arch]
            const fmt = model.quantization ? FORMAT_COLORS[getFormatBase(model.quantization)] : null
            const isSelected = selected?.id === model.id
            return (
              <button
                key={model.id}
                onClick={() => handleSelectModel(model)}
                className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-white/[0.02] border-b border-white/[0.04] last:border-0 transition-colors ${isSelected ? 'bg-surface-2/60' : ''}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${archStyle?.bg ?? 'bg-surface-3'}`}>
                  <span className={`text-2xs font-mono font-semibold ${archStyle?.text ?? 'text-muted/60'}`}>
                    {model.name.slice(0, 2)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{model.name}</p>
                  <p className="text-2xs text-muted/50">{model.author}</p>
                  <div className="flex gap-1.5 items-center mt-0.5 flex-wrap">
                    {archStyle && (
                      <span className={`text-2xs font-mono px-1.5 py-0 rounded leading-4 ${archStyle.bg}/80 ${archStyle.text}`}>{archStyle.label}</span>
                    )}
                    {model.quantization && fmt && (
                      <span className={`text-2xs font-mono px-1.5 py-0 rounded border leading-4 ${fmt.bg} ${fmt.text} ${fmt.border}`}>{model.quantization}</span>
                    )}
                    {model.capabilities.vision && <EyeIcon className="w-3 h-3 text-cyan-400" />}
                    {model.capabilities.thinking && <BrainIcon className="w-3 h-3 text-amber-400" />}
                    {model.capabilities.code && <CodeIcon className="w-3 h-3 text-violet-400" />}
                  </div>
                  {model.vram_estimate_gb && vramTotalGb > 0 && (
                    <div className="mt-1">
                      <VramBar vramEstimateGb={model.vram_estimate_gb} vramTotalGb={vramTotalGb} params={model.params_billion} />
                    </div>
                  )}
                </div>
                {model.downloaded && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-0.5 shrink-0" />}
              </button>
            )
          })}
          {loadingMore && <p className="text-2xs text-muted/40 text-center py-3 animate-pulse">Loading more…</p>}
          {!hasMore && results.length > 0 && (
            <p className="text-2xs text-muted/30 text-center py-3">{results.length} results</p>
          )}
        </div>
      </div>

      {/* Right panel - detail */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs text-muted/30">Select a model to view details</p>
          </div>
        ) : (
          <ModelDetail
            model={selectedDetail ?? selected}
            selectedGguf={selectedGguf}
            onSelectGguf={setSelectedGguf}
            loadedModelId={loadedModelId}
            downloadJobs={downloadJobs}
            vramTotalGb={vramTotalGb}
            vramFreeGb={vramFreeGb}
            gatedError={gatedError}
            copied={copied}
            onCopy={() => {
              navigator.clipboard.writeText((selectedDetail ?? selected).id)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            onDownload={handleDownload}
            onLoad={onLoad}
            onSelectRelated={id => {
              getModelInfo(id).then(m => handleSelectModel(m)).catch(() => {})
            }}
          />
        )}
      </div>
    </div>
  )
}

export { VramBar, ARCH_FAMILIES, FORMAT_COLORS, detectArch, getFormatBase }
