import { useCallback, useEffect, useRef, useState } from 'react'
import { searchModels, getModelInfo } from '@/api/client'
import { useFavorites } from '@/hooks/useFavorites'
import type { DownloadJob, ModelInfo } from '@/types'
import { ModelCard } from './ModelCard'
import { ModelDetailPanel } from './ModelDetailPanel'

const FORMAT_FILTERS = ['GGUF', 'AWQ', 'GPTQ', 'FP8', 'EXL2']
const CAP_FILTERS    = ['Vision', 'Thinking']
const PAGE_SIZE      = 20

type SortKey = 'downloads' | 'likes' | 'created_at'

interface DiscoverPageProps {
  loadedModelId: string | null
  onLoad: (id: string) => void
  onDownloaded: () => void
  downloadJobs: Record<string, DownloadJob>
  vramTotalGb: number
  vramFreeGb: number
  onGoToEngines?: (version?: string) => void
}

export function DiscoverPage({ onLoad, onDownloaded, downloadJobs, vramTotalGb, vramFreeGb, onGoToEngines }: DiscoverPageProps): React.ReactElement {
  const [query, setQuery]         = useState('')
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(['GGUF', 'AWQ', 'GPTQ']))
  const [sortKey, setSortKey]     = useState<SortKey>('downloads')
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [showFavs, setShowFavs]   = useState(false)
  const [results, setResults]     = useState<ModelInfo[]>([])
  const [page, setPage]           = useState(0)
  const [hasMore, setHasMore]     = useState(true)
  const [loading, setLoading]     = useState(false)
  const [selected, setSelected]   = useState<ModelInfo | null>(null)
  const [selectedFull, setSelectedFull] = useState<ModelInfo | null>(null)
  const { favorites, isFavorite, toggleFavorite } = useFavorites()
  const searchRef = useRef(0)

  const toggleFilter = (f: string): void => {
    setActiveFilters(prev => {
      const next = new Set(prev)
      next.has(f) ? next.delete(f) : next.add(f)
      return next
    })
    setPage(0)
  }

  const toggleSort = (key: SortKey): void => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
    setPage(0)
  }

  const doSearch = useCallback(async (q: string, filters: Set<string>, sk: SortKey, sd: 'asc' | 'desc', pg: number): Promise<void> => {
    if (!q.trim() && filters.size === 0) return
    const ticket = ++searchRef.current
    setLoading(true)
    try {
      const filterArr = Array.from(filters).map(f => f.toLowerCase())
      const data = await searchModels(q, filterArr, pg, sk, sd)
      if (ticket !== searchRef.current) return  // stale
      if (pg === 0) {
        setResults(data)
      } else {
        setResults(prev => [...prev, ...data])
      }
      setHasMore(data.length === PAGE_SIZE)
    } catch (e) {
      if (ticket === searchRef.current) {
        setHasMore(false)
        console.error('Search failed:', e)
      }
    } finally {
      if (ticket === searchRef.current) setLoading(false)
    }
  }, [])

  // Re-search when query/filters/sort change (reset page)
  useEffect(() => {
    setPage(0)
    doSearch(query, activeFilters, sortKey, sortDir, 0)
  }, [query, activeFilters, sortKey, sortDir, doSearch])

  // Load more when page increments
  useEffect(() => {
    if (page > 0) doSearch(query, activeFilters, sortKey, sortDir, page)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectModel = useCallback(async (m: ModelInfo): Promise<void> => {
    setSelected(m)
    setSelectedFull(null)
    try {
      const full = await getModelInfo(m.id)
      setSelectedFull(full)
    } catch {
      setSelectedFull(m)
    }
  }, [])

  const closePanel = (): void => { setSelected(null); setSelectedFull(null) }
  const displayModels = showFavs ? favorites : results

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="bg-surface border-b border-border flex-shrink-0">
          {/* Row 1 — search + fav */}
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border/50">
            <SearchBox value={query} onChange={v => { setQuery(v); setPage(0) }} disabled={showFavs} />
            <button onClick={() => setShowFavs(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border cursor-pointer transition-colors flex-shrink-0 ${
                showFavs ? 'bg-yellow/12 border-yellow/35 text-yellow' : 'border-border text-text-muted hover:text-text-secondary'
              }`}>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill={showFavs ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              {showFavs ? `Favorites (${favorites.length})` : 'Favorites'}
            </button>
          </div>

          {/* Row 2 — filters + sort */}
          {!showFavs && (
            <div className="flex items-center gap-3 px-5 py-2 overflow-x-auto">
              {/* Format toggles */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-2xs text-text-muted/60 mr-1 uppercase tracking-widest">Format</span>
                {FORMAT_FILTERS.map(f => (
                  <FilterToggle key={f} label={f} active={activeFilters.has(f)} onClick={() => toggleFilter(f)} />
                ))}
              </div>
              <div className="w-px h-4 bg-border/60 flex-shrink-0" />
              {/* Capability toggles */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-2xs text-text-muted/60 mr-1 uppercase tracking-widest">Cap</span>
                {CAP_FILTERS.map(f => (
                  <FilterToggle key={f} label={f} active={activeFilters.has(f)} onClick={() => toggleFilter(f)} accent="yellow" />
                ))}
              </div>
              <div className="flex-1" />
              {/* Sort */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-2xs text-text-muted/60 mr-1 uppercase tracking-widest">Sort</span>
                {(['downloads', 'likes', 'created_at'] as SortKey[]).map(k => (
                  <SortBtn key={k} label={k === 'created_at' ? 'Date' : k === 'downloads' ? 'DL' : 'Likes'}
                    active={sortKey === k} dir={sortKey === k ? sortDir : null}
                    onClick={() => toggleSort(k)} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {showFavs && favorites.length === 0 && (
            <div className="text-center text-text-muted py-16 text-sm">No favorites yet — click ★ on any model</div>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5 content-start">
            {displayModels.map(m => (
              <ModelCard key={m.id} model={m} job={downloadJobs[m.id]}
                onClick={() => selectModel(m)}
                isFavorite={isFavorite(m.id)}
                onToggleFavorite={() => toggleFavorite(m)}
              />
            ))}
          </div>

          {/* Pagination footer */}
          {!showFavs && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border/50">
              <span className="text-xs text-text-muted">
                {results.length} models · page {page + 1}
              </span>
              <div className="flex items-center gap-2">
                {page > 0 && (
                  <button onClick={() => setPage(0)}
                    className="px-3 py-1.5 text-xs border border-border rounded-sm text-text-muted hover:text-text-primary hover:bg-overlay cursor-pointer transition-colors">
                    ← First
                  </button>
                )}
                {page > 0 && (
                  <button onClick={() => setPage(p => Math.max(0, p - 1))}
                    className="px-3 py-1.5 text-xs border border-border rounded-sm text-text-muted hover:text-text-primary hover:bg-overlay cursor-pointer transition-colors">
                    ← Prev
                  </button>
                )}
                {hasMore && (
                  <button onClick={() => setPage(p => p + 1)} disabled={loading}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-sm cursor-pointer transition-colors">
                    {loading && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    Next {loading ? '…' : '→'}
                  </button>
                )}
                {!hasMore && results.length > 0 && (
                  <span className="text-xs text-text-muted/50">End of results</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <ModelDetailPanel
          model={selectedFull ?? selected}
          loading={!selectedFull}
          vramTotalGb={vramTotalGb}
          vramFreeGb={vramFreeGb}
          job={downloadJobs[selected.id]}
          isFavorite={isFavorite(selected.id)}
          onClose={closePanel}
          onLoad={() => { onLoad(selected.id); closePanel() }}
          onDownloaded={onDownloaded}
          onToggleFavorite={toggleFavorite}
          onGoToEngines={onGoToEngines}
          onSelectRelated={(id) => {
            const stub: ModelInfo = { id, name: id.split('/').pop() ?? id, author: id.split('/')[0] ?? null, size_gb: null, quantization: null, params_billion: null, vram_estimate_gb: null, max_context_window: null, description: null, last_modified: null, pipeline_tag: null, arch_tag: null, gguf_files: null, more_from_author: null, downloads: null, likes: null, downloaded: false, loaded: false, gated: false, capabilities: { thinking: false, vision: false, code: false, multilingual: false, tools: false } }
            selectModel(stub)
          }}
        />
      )}
    </div>
  )
}

function SearchBox({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }): React.ReactElement {
  return (
    <div className={`flex-1 max-w-[420px] flex items-center gap-2 bg-elevated border border-border focus-within:border-accent rounded-sm px-3 py-1.5 transition-colors ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <svg className="w-3.5 h-3.5 stroke-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder="Search Hugging Face models…"
        className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder-text-muted"
      />
    </div>
  )
}

function FilterToggle({ label, active, onClick, accent = 'accent' }: {
  label: string; active: boolean; onClick: () => void; accent?: 'accent' | 'yellow'
}): React.ReactElement {
  const activeClass = accent === 'yellow'
    ? 'bg-yellow/12 border-yellow/40 text-yellow'
    : 'bg-accent/12 border-accent/40 text-accent'
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xs border cursor-pointer transition-colors ${
        active ? activeClass : 'border-border text-text-muted hover:text-text-secondary hover:border-border'
      }`}>
      {label}
    </button>
  )
}

function SortBtn({ label, active, dir, onClick }: {
  label: string; active: boolean; dir: 'asc' | 'desc' | null; onClick: () => void
}): React.ReactElement {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border cursor-pointer transition-colors ${
        active ? 'bg-accent/12 border-accent/40 text-accent' : 'border-border text-text-muted hover:text-text-secondary'
      }`}>
      {label}
      {active && dir && (
        <svg className={`w-2.5 h-2.5 transition-transform ${dir === 'asc' ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      )}
    </button>
  )
}
