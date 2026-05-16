import type { ModelInfo } from '@/types'
import { Badge } from '@/components/shared/Badge'
import { Btn } from '@/components/shared/Btn'

interface LibraryPageProps {
  models: ModelInfo[]
  onDelete: (id: string) => void
  onAddModel: () => void
  totalDiskGb: number
}

export function LibraryPage({ models, onDelete, onAddModel, totalDiskGb }: LibraryPageProps): React.ReactElement {
  const loadedCount = models.filter(m => m.loaded).length

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="h-[54px] bg-surface border-b border-border flex items-center px-5 gap-3 flex-shrink-0">
        <span className="text-md font-semibold flex-1">My Models</span>
        <div className="flex gap-3.5 text-sm text-text-muted">
          <span>{models.length} models</span>
          <span>{totalDiskGb.toFixed(1)} GB on disk</span>
          {loadedCount > 0 && <span className="text-accent">{loadedCount} loaded</span>}
        </div>
        <Btn onClick={onAddModel}>
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add model
        </Btn>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {models.map(m => (
          <LibraryRow key={m.id} model={m} onDelete={() => onDelete(m.id)} />
        ))}
        {models.length === 0 && (
          <div className="text-center text-text-muted py-16">
            <p className="text-md mb-2">No models downloaded yet</p>
            <button onClick={onAddModel} className="text-accent underline text-sm cursor-pointer">Browse Hugging Face →</button>
          </div>
        )}
      </div>
    </div>
  )
}

function LibraryRow({ model, onDelete }: {
  model: ModelInfo
  onDelete: () => void
}): React.ReactElement {
  const initials = model.name.replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'M'

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-md border mb-1.5 transition-colors cursor-pointer ${
      model.loaded
        ? 'bg-accent-dim border-accent/30'
        : 'bg-surface border-border hover:border-border-hover'
    }`}>
      <div className="w-9 h-9 rounded-lg bg-elevated border border-border flex items-center justify-center text-xs font-bold text-accent flex-shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-text-primary truncate">{model.name}</div>
        <div className="flex gap-2 text-xs text-text-muted mt-0.5">
          <span>{model.author}</span>
          {model.quantization && <span>{model.quantization}</span>}
          {model.params_billion && <span>{model.params_billion}B params</span>}
          {model.vram_estimate_gb && <span>{model.vram_estimate_gb} GB VRAM</span>}
          {model.loaded && <span className="text-accent">● loaded</span>}
        </div>
      </div>
      <div className="flex gap-1.5 items-center flex-shrink-0">
        <ModelBadges model={model} />
        {!model.loaded && (
          <button
            onClick={onDelete}
            className="w-8 h-8 flex items-center justify-center rounded-sm border border-border hover:border-red/30 hover:bg-red/10 text-text-muted hover:text-red cursor-pointer transition-colors"
            title="Delete model"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6m4-6v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

function ModelBadges({ model }: { model: ModelInfo }): React.ReactElement {
  return (
    <div className="flex gap-1 flex-wrap justify-end">
      {model.loaded && <Badge variant="loaded">loaded</Badge>}
      {!model.loaded && <Badge variant="dl">downloaded</Badge>}
      {model.capabilities.thinking && <Badge variant="think">thinking</Badge>}
      {model.capabilities.vision && <Badge variant="vision">vision</Badge>}
      {model.capabilities.code && <Badge variant="cap">code</Badge>}
    </div>
  )
}
