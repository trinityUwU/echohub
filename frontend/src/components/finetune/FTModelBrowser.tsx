import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { searchModels, listDownloaded, getVramEstimate, startDownload } from '@/api/client'
import type { DownloadJob, ModelInfo } from '@/types'

const PAGE_SIZE = 20
type SourceFilter = 'hf' | 'local'

interface FTModelBrowserProps {
  vramTotalGb: number
  onSelect: (model: ModelInfo) => void
  onDownloaded: () => void
  downloadJobs: Record<string, DownloadJob>
}

export function FTModelBrowser({ vramTotalGb, onSelect, downloadJobs }: FTModelBrowserProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SourceFilter>('local')
  const [results, setResults] = useState<ModelInfo[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const searchRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadLocal = useCallback(async (q: string): Promise<void> => {
    const ticket = ++searchRef.current
    setLoading(true)
    try {
      const all = await listDownloaded()
      if (ticket !== searchRef.current) return
      const ftReady = all.filter(m => {
        const isSafetensors = !m.quantization || m.quantization.toLowerCase() === 'bf16' || m.quantization.toLowerCase() === 'safetensors'
        const matchesQuery = !q.trim() || m.id.toLowerCase().includes(q.toLowerCase()) || (m.name ?? '').toLowerCase().includes(q.toLowerCase())
        return isSafetensors && matchesQuery
      })
      setResults(ftReady)
      setHasMore(false)
    } catch {
      if (ticket === searchRef.current) setResults([])
    } finally {
      if (ticket === searchRef.current) setLoading(false)
    }
  }, [])

  const loadHF = useCallback(async (q: string, pg: number): Promise<void> => {
    const ticket = ++searchRef.current
    setLoading(true)
    try {
      const data = await searchModels(q, ['safetensors'], pg, 'downloads', 'desc')
      if (ticket !== searchRef.current) return
      setResults(data)
      setHasMore(data.length === PAGE_SIZE)
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      if (ticket === searchRef.current) { setResults([]); setHasMore(false) }
    } finally {
      if (ticket === searchRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setPage(0)
    if (source === 'local') loadLocal(query)
    else loadHF(query, 0)
  }, [query, source, loadLocal, loadHF])

  useEffect(() => {
    if (page > 0 && source === 'hf') loadHF(query, page)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = useCallback(async (modelId: string): Promise<void> => {
    try {
      await startDownload({ model_id: modelId })
      // App.tsx's subscribeDownloads SSE will update downloadJobs automatically
    } catch { /* best-effort */ }
  }, [])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-5 py-2.5 border-b border-border bg-surface flex-shrink-0 flex items-center gap-3">
        <div className="flex items-center gap-1 bg-overlay rounded-sm p-0.5 flex-shrink-0">
          {(['local', 'hf'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setSource(s); setPage(0) }}
              className={`px-3 py-1 text-xs rounded-sm cursor-pointer transition-colors font-medium ${
                source === s ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {s === 'local' ? 'Installed' : 'Hugging Face'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 bg-elevated border border-border focus-within:border-accent rounded-sm px-3 py-1.5 flex-1 max-w-[380px] transition-colors">
          <svg className="w-3.5 h-3.5 stroke-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(0) }}
            placeholder={source === 'local' ? 'Filter installed models…' : 'Search FT-ready models on HF…'}
            className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder-text-muted"
          />
        </div>
        {source === 'local' && results.length === 0 && !loading && (
          <span className="text-xs text-text-muted">No safetensors models installed — switch to HF to download one</span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5">
        {loading && results.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-text-muted py-8 justify-center">
            <span className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
            Loading…
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5 content-start">
          {results.map(m => (
            <FTModelCard
              key={m.id}
              model={m}
              vramTotalGb={vramTotalGb}
              isLocal={source === 'local'}
              downloadJob={downloadJobs[m.id] ?? null}
              onSelect={() => onSelect(m)}
              onDownload={() => handleDownload(m.id)}
            />
          ))}
        </div>

        {source === 'hf' && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/50">
            <span className="text-xs text-text-muted">{results.length} models · page {page + 1}</span>
            <div className="flex items-center gap-2">
              {page > 0 && (
                <button onClick={() => setPage(p => Math.max(0, p - 1))} className="px-3 py-1.5 text-xs border border-border rounded-sm text-text-muted hover:text-text-primary hover:bg-overlay cursor-pointer transition-colors">← Prev</button>
              )}
              {hasMore && (
                <button onClick={() => setPage(p => p + 1)} disabled={loading} className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-sm cursor-pointer transition-colors">
                  {loading && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Next {loading ? '…' : '→'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FTModelCard({ model, vramTotalGb, isLocal, downloadJob, onSelect, onDownload }: {
  model: ModelInfo
  vramTotalGb: number
  isLocal: boolean
  downloadJob: DownloadJob | null
  onSelect: () => void
  onDownload: () => void
}): React.ReactElement {
  const [vramGb, setVramGb] = useState<number | null>(null)

  useEffect(() => {
    if (!model.params_billion) return
    getVramEstimate(model.params_billion)
      .then(r => setVramGb(r.vram_gb))
      .catch(() => {})
  }, [model.params_billion])

  const fits = vramGb !== null ? vramGb < vramTotalGb * 0.9 : null
  const isActive = downloadJob?.state === 'running' || downloadJob?.state === 'pending'
  const isComplete = downloadJob?.state === 'complete' || model.downloaded
  const pct = downloadJob?.progress != null ? Math.round(downloadJob.progress * 100) : 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="bg-surface border border-border rounded-md p-3 flex flex-col gap-2 hover:border-accent/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="text-xs text-text-muted truncate">{model.author}</div>
            {isLocal && <span className="text-[10px] px-1.5 py-0.5 bg-accent/15 text-accent rounded-sm font-medium flex-shrink-0">local</span>}
          </div>
          <div className="text-sm font-medium text-text-primary truncate">{model.name ?? model.id.split('/').pop()}</div>
        </div>
        {fits !== null && (
          <span className={`text-xs px-1.5 py-0.5 rounded-sm font-medium flex-shrink-0 ${
            fits ? 'bg-green/15 text-green' : 'bg-red-400/15 text-red-400'
          }`}>
            {fits ? `fits ${Math.round(vramTotalGb)}GB` : `>${Math.round(vramTotalGb)}GB`}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-text-muted flex-wrap">
        {model.params_billion !== null && <span>{model.params_billion}B params</span>}
        {vramGb !== null && <span className="text-accent">~{vramGb.toFixed(1)} GB QLoRA</span>}
        {vramGb === null && model.params_billion !== null && <span className="text-text-muted/50 animate-pulse">estimating…</span>}
      </div>

      {isActive && (
        <div className="flex flex-col gap-1.5">
          <div className="h-[3px] bg-overlay rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-accent rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 border border-accent/40 border-t-accent rounded-full animate-spin" />
              Downloading…
            </span>
            <span className="font-mono">{pct}% · {downloadJob?.downloaded_gb.toFixed(2)} / {downloadJob?.total_gb?.toFixed(2) ?? '?'} GB</span>
          </div>
        </div>
      )}

      {!isActive && !isComplete && (
        <button
          onClick={onDownload}
          className="mt-auto px-3 py-1.5 text-xs bg-overlay hover:bg-overlay/80 border border-border text-text-muted hover:text-text-primary rounded-sm cursor-pointer transition-colors font-medium"
        >
          Download
        </button>
      )}
      {(isComplete || isLocal) && (
        <button
          onClick={onSelect}
          className="mt-auto px-3 py-1.5 text-xs bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent rounded-sm cursor-pointer transition-colors font-medium"
        >
          Select for training
        </button>
      )}
    </motion.div>
  )
}
