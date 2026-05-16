import { useCallback, useEffect, useState } from 'react'
import { searchModels, getModelInfo } from '@/api/client'
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
  const [results, setResults] = useState<ModelInfo[]>([])
  const [selected, setSelected] = useState<ModelInfo | null>(null)
  const [selectedFull, setSelectedFull] = useState<ModelInfo | null>(null)

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

  const doSearch = useCallback(async (q: string): Promise<void> => {
    try {
      const data = await searchModels(q, filter === 'All' ? undefined : filter.toLowerCase())
      setResults(data)
    } catch {
      // keep previous results on error
    }
  }, [filter])

  useEffect(() => { doSearch(query) }, [query, filter, doSearch])

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-[54px] bg-surface border-b border-border flex items-center px-5 gap-3 flex-shrink-0">
          <SearchBox value={query} onChange={setQuery} />
          <FilterTabs active={filter} onChange={setFilter} />
        </div>
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5 content-start">
          {results.map(m => (
            <ModelCard key={m.id} model={m} job={downloadJobs[m.id]} onClick={() => selectModel(m)} />
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
          onClose={() => { setSelected(null); setSelectedFull(null) }}
          onLoad={() => { onLoad(selected.id); setSelected(null); setSelectedFull(null) }}
          onDownloaded={onDownloaded}
        />
      )}
    </div>
  )
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }): React.ReactElement {
  return (
    <div className="flex-1 max-w-[420px] flex items-center gap-2 bg-elevated border border-border focus-within:border-accent rounded-sm px-3 py-1.5 transition-colors">
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
