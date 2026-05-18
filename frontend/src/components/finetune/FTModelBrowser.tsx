import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { searchModels, getVramEstimate } from '@/api/client'
import type { ModelInfo } from '@/types'

const PAGE_SIZE = 20

interface FTModelBrowserProps {
  vramTotalGb: number
  onSelect: (model: ModelInfo) => void
}

export function FTModelBrowser({ vramTotalGb, onSelect }: FTModelBrowserProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ModelInfo[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const searchRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const doSearch = useCallback(async (q: string, pg: number): Promise<void> => {
    const ticket = ++searchRef.current
    setLoading(true)
    try {
      const data = await searchModels(q, ['safetensors'], pg, 'downloads', 'desc')
      if (ticket !== searchRef.current) return
      setResults(data)
      setHasMore(data.length === PAGE_SIZE)
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      if (ticket === searchRef.current) setHasMore(false)
    } finally {
      if (ticket === searchRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setPage(0)
    doSearch(query, 0)
  }, [query, doSearch])

  useEffect(() => {
    if (page > 0) doSearch(query, page)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-5 py-2.5 border-b border-border bg-surface flex-shrink-0">
        <div className="flex items-center gap-2 bg-elevated border border-border focus-within:border-accent rounded-sm px-3 py-1.5 max-w-[420px] transition-colors">
          <svg className="w-3.5 h-3.5 stroke-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(0) }}
            placeholder="Search FT-ready models…"
            className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder-text-muted"
          />
        </div>
        <div className="text-xs text-text-muted mt-1.5">Showing safetensors models only — compatible with QLoRA fine-tuning</div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5 content-start">
          {results.map(m => (
            <FTModelCard
              key={m.id}
              model={m}
              vramTotalGb={vramTotalGb}
              onSelect={() => onSelect(m)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/50">
          <span className="text-xs text-text-muted">{results.length} models · page {page + 1}</span>
          <div className="flex items-center gap-2">
            {page > 0 && (
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                className="px-3 py-1.5 text-xs border border-border rounded-sm text-text-muted hover:text-text-primary hover:bg-overlay cursor-pointer transition-colors"
              >
                ← Prev
              </button>
            )}
            {hasMore && (
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-sm cursor-pointer transition-colors"
              >
                {loading && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Next {loading ? '…' : '→'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FTModelCard({ model, vramTotalGb, onSelect }: {
  model: ModelInfo; vramTotalGb: number; onSelect: () => void
}): React.ReactElement {
  const [vramGb, setVramGb] = useState<number | null>(null)

  useEffect(() => {
    if (!model.params_billion) return
    getVramEstimate(model.params_billion)
      .then(r => setVramGb(r.vram_gb))
      .catch(() => {})
  }, [model.params_billion])

  const fits = vramGb !== null ? vramGb < vramTotalGb * 0.9 : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="bg-surface border border-border rounded-md p-3 flex flex-col gap-2 hover:border-accent/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-text-muted truncate">{model.author}</div>
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
        {model.params_billion !== null && (
          <span>{model.params_billion}B params</span>
        )}
        {vramGb !== null && (
          <span className="text-accent">~{vramGb.toFixed(1)} GB QLoRA</span>
        )}
        {vramGb === null && model.params_billion !== null && (
          <span className="text-text-muted/50 animate-pulse">estimating…</span>
        )}
      </div>

      <button
        onClick={onSelect}
        className="mt-auto px-3 py-1.5 text-xs bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent rounded-sm cursor-pointer transition-colors font-medium"
      >
        Select for training
      </button>
    </motion.div>
  )
}
