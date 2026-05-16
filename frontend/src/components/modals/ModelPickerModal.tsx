import { useState } from 'react'
import { Modal } from '@/components/shared/Modal'
import { Btn } from '@/components/shared/Btn'
import { Badge } from '@/components/shared/Badge'
import type { ModelInfo } from '@/types'

interface ModelPickerModalProps {
  models: ModelInfo[]
  loadedModelId: string | null
  onConfirm: (modelId: string) => void
  onCancel: () => void
}

export function ModelPickerModal({ models, loadedModelId, onConfirm, onCancel }: ModelPickerModalProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(loadedModelId)

  const filtered = models.filter(m =>
    m.name.toLowerCase().includes(query.toLowerCase()) ||
    m.author?.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <Modal
      title="Switch model"
      onClose={onCancel}
      width="w-[440px]"
      footer={
        <>
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" disabled={!selected || selected === loadedModelId}
            onClick={() => selected && onConfirm(selected)}>
            Load selected
          </Btn>
        </>
      }
    >
      <div className="flex items-center gap-2 bg-elevated border border-border rounded-sm px-3 py-2">
        <svg className="w-3.5 h-3.5 stroke-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          autoFocus
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter models…"
          className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder-text-muted"
        />
      </div>

      <div className="text-xs font-semibold uppercase tracking-widest text-text-muted">Local models</div>

      <div className="flex flex-col gap-1 max-h-[320px] overflow-y-auto">
        {filtered.map(m => (
          <PickerItem key={m.id} model={m} isLoaded={m.id === loadedModelId} isSelected={m.id === selected}
            onClick={() => setSelected(m.id)} />
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-text-muted py-6 text-sm">No models match "{query}"</div>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Switching model will unload the current one
      </div>
    </Modal>
  )
}

function PickerItem({ model, isLoaded, isSelected, onClick }: {
  model: ModelInfo; isLoaded: boolean; isSelected: boolean; onClick: () => void
}): React.ReactElement {
  const initials = model.name.replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'M'

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-sm border cursor-pointer transition-colors text-left w-full ${
        isSelected
          ? 'bg-accent-dim border-accent/40'
          : isLoaded
          ? 'bg-elevated border-green/25 hover:border-green/40'
          : 'bg-elevated border-border hover:border-border-hover'
      }`}
    >
      <div className="w-8 h-8 rounded-lg bg-overlay flex items-center justify-center text-xs font-bold text-accent flex-shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-text-primary truncate">{model.name}</div>
        <div className="text-xs text-text-muted mt-0.5">
          {model.author} · {model.quantization ?? 'AWQ'} · {model.params_billion}B
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0 text-xs text-text-muted">
        {isLoaded && <Badge variant="loaded">loaded</Badge>}
        {!isLoaded && <Badge variant="dl">downloaded</Badge>}
        {model.vram_estimate_gb && <span>{model.vram_estimate_gb} GB VRAM</span>}
      </div>
    </button>
  )
}
