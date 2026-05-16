import { useCallback, useEffect, useState } from 'react'
import { searchModels, getModelInfo } from '@/api/client'
import { useFavorites } from '@/hooks/useFavorites'
import type { DownloadJob, ModelInfo } from '@/types'
import { ModelCard } from './ModelCard'
import { ModelDetailPanel } from './ModelDetailPanel'

const FILTERS = ['All', 'GGUF', 'AWQ', 'GPTQ', 'Vision', 'Thinking']

interface DiscoverPageProps {
  loadedModelId: string | null
  onLoad: (id: string) => void
  onDownloaded: () => void
  downloadJobs: Record<string, DownloadJob>
  vramTotalGb: number
  vramFreeGb: number
}

export function DiscoverPage({ onLoad, onDownloaded, downloadJobs, vramTotalGb, vramFreeGb }: DiscoverPageProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [showFavs, setShowFavs] = useState(false)
  const [results, setResults] = useState<ModelInfo[]>([])
  const [selected, setSelected] = useState<ModelInfo | null>(null)
  const [selectedFull, setSelectedFull] = useState<ModelInfo | null>(null)
  const { favorites, isFavorite, toggleFavorite } = useFavorites()

  const doSearch = useCallback(async (q: string): Promise<void> => {
    try {
      const data = await searchModels(q, filter === 'All' ? undefined : filter.toLowerCase())
      setResults(data)
    } catch { /* keep previous */ }
  }, [filter])

  useEffect(() => { doSearch(query) }, [query, filter, doSearch])

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
        <div className="h-[54px] bg-surface border-b border-border flex items-center px-5 gap-3 flex-shrink-0">
          <SearchBox value={query} onChange={setQuery} disabled={showFavs} />
          <div className="flex items-center gap-1.5">
            {!showFavs && <FilterTabs active={filter} onChange={setFilter} />}
            <button
              onClick={() => setShowFavs(v => !v)}
              title={showFavs ? 'Show search' : 'Show favorites'}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-[20px] text-xs border cursor-pointer transition-colors ${
                showFavs ? 'bg-yellow/12 border-yellow/35 text-yellow' : 'border-border text-text-muted hover:text-text-secondary hover:border-border-hover'
              }`}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill={showFavs ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              {showFavs ? `Favorites (${favorites.length})` : 'Favorites'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5 content-start">
          {showFavs && favorites.length === 0 && (
            <div className="col-span-full text-center text-text-muted py-16 text-sm">
              No favorites yet — click ★ on any model
            </div>
          )}
          {displayModels.map(m => (
            <ModelCard key={m.id} model={m} job={downloadJobs[m.id]}
              onClick={() => selectModel(m)}
              isFavorite={isFavorite(m.id)}
              onToggleFavorite={() => toggleFavorite(m)}
            />
          ))}
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
          onSelectRelated={(id) => {
            const stub = { id, name: id.split('/').pop() ?? id } as ModelInfo
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

function FilterTabs({ active, onChange }: { active: string; onChange: (v: string) => void }): React.ReactElement {
  return (
    <div className="flex gap-1">
      {FILTERS.map(f => (
        <button key={f} onClick={() => onChange(f)}
          className={`px-3 py-1 rounded-[20px] text-xs border cursor-pointer transition-colors ${
            active === f ? 'bg-accent-dim border-accent/35 text-accent' : 'border-border text-text-muted hover:text-text-secondary hover:border-border-hover'
          }`}>{f}</button>
      ))}
    </div>
  )
}
