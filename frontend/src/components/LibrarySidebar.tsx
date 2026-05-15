import { useState, useMemo } from 'react'
import type { ModelInfo } from '@/types'
import { ModelDetailModal } from './ModelDetailModal'
import { useGpu } from '@/hooks/useGpu'

interface Props {
  models: ModelInfo[]
  loadedModelId: string | null
  onLoad: (id: string) => void
  onUnload: () => void
  onDeleted: () => void
}

type LibFilter = 'all' | 'awq' | 'gptq' | 'thinking' | 'vision' | 'code' | 'multilingual'

const FILTER_LABELS: { key: LibFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'awq', label: 'AWQ' },
  { key: 'gptq', label: 'GPTQ' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'vision', label: 'Vision' },
  { key: 'code', label: 'Code' },
  { key: 'multilingual', label: 'Multi' },
]

export function LibrarySidebar({ models, loadedModelId, onLoad, onUnload, onDeleted }: Props) {
  const [filter, setFilter] = useState<LibFilter>('all')
  const [selected, setSelected] = useState<ModelInfo | null>(null)
  const gpu = useGpu()
  const vramFreeGb = gpu ? gpu.vram_free_mb / 1024 : 0

  const filtered = useMemo(() => {
    if (filter === 'all') return models
    if (filter === 'awq') return models.filter((m) => m.quantization === 'AWQ')
    if (filter === 'gptq') return models.filter((m) => m.quantization === 'GPTQ')
    return models.filter((m) => m.capabilities[filter as keyof typeof m.capabilities])
  }, [models, filter])

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="p-3 border-b border-border">
          <p className="text-xs font-semibold text-white mb-2">Library</p>
          <div className="flex flex-wrap gap-1">
            {FILTER_LABELS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  filter === key
                    ? 'bg-accent/20 text-accent border-accent/40'
                    : 'bg-surface-3 text-muted border-border hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 && (
            <p className="text-xs text-muted px-2 py-3">No models</p>
          )}
          {filtered.map((m) => {
            const isLoaded = m.id === loadedModelId
            return (
              <div
                key={m.id}
                onClick={() => setSelected(m)}
                className={`group rounded-lg px-2 py-2 border cursor-pointer transition-colors ${
                  isLoaded
                    ? 'bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/15'
                    : 'border-transparent hover:bg-surface-2'
                }`}
              >
                <p className="text-xs text-white truncate font-medium" title={m.id}>
                  {m.name}
                </p>
                <div className="flex items-center justify-between mt-1 gap-1">
                  <div className="flex gap-1 flex-wrap">
                    {m.quantization && (
                      <span className="text-xs text-muted font-mono">{m.quantization}</span>
                    )}
                    {m.params_billion && (
                      <span className="text-xs text-muted">{m.params_billion}B</span>
                    )}
                    {m.size_gb !== null && (
                      <span className="text-xs text-muted">{m.size_gb} GB</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {isLoaded ? (
                      <button
                        onClick={onUnload}
                        className="text-xs text-red-400 hover:text-red-300 shrink-0"
                      >
                        Unload
                      </button>
                    ) : (
                      <button
                        onClick={() => onLoad(m.id)}
                        className="text-xs text-accent hover:text-white shrink-0 disabled:opacity-40"
                        disabled={!!loadedModelId && loadedModelId !== m.id}
                      >
                        Load
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {selected && (
        <ModelDetailModal
          model={selected}
          vramFreeGb={vramFreeGb}
          isLoaded={selected.id === loadedModelId}
          onClose={() => setSelected(null)}
          onDeleted={() => { onDeleted(); setSelected(null) }}
          onLoad={(id) => { onLoad(id); setSelected(null) }}
          onUnload={() => { onUnload(); setSelected(null) }}
        />
      )}
    </>
  )
}
