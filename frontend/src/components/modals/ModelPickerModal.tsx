import { useState } from 'react'
import { Modal } from '@/components/shared/Modal'
import { Btn } from '@/components/shared/Btn'
import { Badge } from '@/components/shared/Badge'
import type { ModelInfo, FinetunedModel, LlamaCompatResult } from '@/types'
import { checkLlamaCompat } from '@/api/client'

type SourceFilter = 'all' | 'downloaded' | 'finetuned'

interface ModelPickerModalProps {
  models: ModelInfo[]
  finetunedModels: FinetunedModel[]
  loadedModelId: string | null
  onConfirm: (modelId: string) => void
  onConfirmFinetuned: (model: FinetunedModel) => void
  onCancel: () => void
  onGoToEngines?: () => void
}

export function ModelPickerModal({
  models,
  finetunedModels,
  loadedModelId,
  onConfirm,
  onConfirmFinetuned,
  onCancel,
  onGoToEngines,
}: ModelPickerModalProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SourceFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(loadedModelId)
  const [selectedFt, setSelectedFt] = useState<FinetunedModel | null>(null)
  const [compatCheck, setCompatCheck] = useState<LlamaCompatResult | null>(null)

  const filteredModels = (source === 'all' || source === 'downloaded')
    ? models.filter(m =>
        m.name.toLowerCase().includes(query.toLowerCase()) ||
        m.author?.toLowerCase().includes(query.toLowerCase()))
    : []

  const filteredFt = (source === 'all' || source === 'finetuned')
    ? finetunedModels.filter(m =>
        m.name.toLowerCase().includes(query.toLowerCase()))
    : []

  const hasSelection = selectedId !== null || selectedFt !== null
  const isCurrentLoaded = selectedId === loadedModelId && selectedFt === null

  const handleSelectFt = (m: FinetunedModel): void => {
    setSelectedId(null)
    setSelectedFt(m)
    setCompatCheck(null)
  }

  const handleSelectModel = (id: string): void => {
    setSelectedFt(null)
    setSelectedId(id)
    setCompatCheck(null)
  }

  const handleLoad = async (): Promise<void> => {
    if (selectedFt) {
      const result = await checkLlamaCompat(selectedFt.path).catch(() => null)
      if (result && !result.compatible && result.needs_upgrade) {
        setCompatCheck(result)
        return
      }
      onConfirmFinetuned(selectedFt)
      return
    }
    if (selectedId) onConfirm(selectedId)
  }

  if (compatCheck) {
    return (
      <CompatBanner
        result={compatCheck}
        onGoToEngines={onGoToEngines ?? (() => setCompatCheck(null))}
        onCancel={() => setCompatCheck(null)}
      />
    )
  }

  return (
    <Modal
      title="Switch model"
      onClose={onCancel}
      width="w-[480px]"
      footer={
        <>
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" disabled={!hasSelection || isCurrentLoaded} onClick={handleLoad}>
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

      <SourceToggle value={source} onChange={setSource} />

      <div className="flex flex-col gap-1 max-h-[320px] overflow-y-auto">
        {filteredModels.map(m => (
          <PickerItem key={m.id} model={m} isLoaded={m.id === loadedModelId}
            isSelected={m.id === selectedId} onClick={() => handleSelectModel(m.id)} />
        ))}
        {filteredFt.map(m => (
          <PickerFtItem key={m.id} model={m} isSelected={m.id === selectedFt?.id}
            onClick={() => handleSelectFt(m)} />
        ))}
        {filteredModels.length === 0 && filteredFt.length === 0 && (
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

function SourceToggle({ value, onChange }: { value: SourceFilter; onChange: (v: SourceFilter) => void }): React.ReactElement {
  const opts: { v: SourceFilter; label: string }[] = [
    { v: 'all', label: 'All' },
    { v: 'downloaded', label: 'Downloaded' },
    { v: 'finetuned', label: 'Fine-tuned' },
  ]
  return (
    <div className="flex bg-elevated border border-border rounded-sm overflow-hidden text-xs self-start">
      {opts.map(o => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 cursor-pointer transition-colors ${
            value === o.v ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
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
        isSelected ? 'bg-accent-dim border-accent/40'
          : isLoaded ? 'bg-elevated border-green/25 hover:border-green/40'
          : 'bg-elevated border-border hover:border-border-hover'
      }`}
    >
      <div className="w-8 h-8 rounded-lg bg-overlay flex items-center justify-center text-xs font-bold text-accent flex-shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-text-primary truncate">{model.name}</div>
        <div className="text-xs text-text-muted mt-0.5">
          {model.author}{model.params_billion ? ` · ${model.params_billion}B` : ''}
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {model.quantization && <Badge variant="quant">{model.quantization.split('/')[0]}</Badge>}
          {model.is_moe && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">
              MoE{model.active_params_billion ? ` A${model.active_params_billion}B` : ''}
            </span>
          )}
          {model.has_mtp && <Badge variant="mtp">MTP</Badge>}
          {model.capabilities?.thinking && <Badge variant="think">thinking</Badge>}
          {model.capabilities?.vision && <Badge variant="vision">vision</Badge>}
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

function PickerFtItem({ model, isSelected, onClick }: {
  model: FinetunedModel; isSelected: boolean; onClick: () => void
}): React.ReactElement {
  const initials = model.name.replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'FT'

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-sm border cursor-pointer transition-colors text-left w-full ${
        isSelected ? 'bg-accent-dim border-accent/40' : 'bg-elevated border-border hover:border-border-hover'
      }`}
    >
      <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-xs font-bold text-purple-400 flex-shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-text-primary truncate">{model.name}</div>
        <div className="text-xs text-text-muted mt-0.5">
          {model.base_model_id ? model.base_model_id.split('/').pop() : 'finetuned'} · {model.quantization} · {model.size_gb.toFixed(1)} GB
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <Badge variant="ft">ft</Badge>
        {model.loaded && <Badge variant="loaded">loaded</Badge>}
      </div>
    </button>
  )
}

function CompatBanner({ result, onGoToEngines, onCancel }: {
  result: LlamaCompatResult
  onGoToEngines: () => void
  onCancel: () => void
}): React.ReactElement {
  return (
    <Modal title="Incompatible llama-cpp-python" onClose={onCancel} width="w-[480px]"
      footer={
        <>
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" onClick={onGoToEngines}>
            Go to Settings → Engines
          </Btn>
        </>
      }
    >
      <div className="flex items-start gap-3 p-3 bg-yellow/8 border border-yellow/20 rounded-sm text-sm">
        <span className="text-yellow text-base flex-shrink-0">⚠</span>
        <div className="flex-1">
          <p className="text-text-primary font-medium mb-1">This GGUF requires a newer version of llama-cpp-python.</p>
          {result.version && <p className="text-text-muted text-xs">Current: {result.version}</p>}
          {result.error && <p className="text-text-muted text-xs mt-1">{result.error}</p>}
          <p className="text-text-muted text-xs mt-2">Use the Upgrade button in Settings → Engines to update.</p>
        </div>
      </div>
    </Modal>
  )
}
