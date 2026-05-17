import type { ModelInfo } from '@/types'

interface ChatTopBarProps {
  loadedModel: ModelInfo | null
  loading: boolean
  loadingPct: number
  onOpenPicker: () => void
  onOpenLoad: () => void
  onClear: () => void
  onEject: () => void
  onExport: () => void
}

export function ChatTopBar({ loadedModel, loading, loadingPct, onOpenPicker, onOpenLoad, onClear, onEject, onExport }: ChatTopBarProps): React.ReactElement {
  if (loading) return <LoadingBar pct={loadingPct} modelName={loadedModel?.name ?? '…'} onEject={onEject} />
  return <NormalBar loadedModel={loadedModel} onOpenPicker={onOpenPicker} onOpenLoad={onOpenLoad} onClear={onClear} onEject={onEject} onExport={onExport} />
}

function NormalBar({ loadedModel, onOpenPicker, onOpenLoad, onClear, onEject, onExport }: Pick<ChatTopBarProps, 'loadedModel' | 'onOpenPicker' | 'onOpenLoad' | 'onClear' | 'onEject' | 'onExport'>): React.ReactElement {
  return (
    <div className="h-[50px] bg-surface border-b border-border flex items-center px-4 gap-2.5 flex-shrink-0">
      <button
        onClick={onOpenPicker}
        className="flex items-center gap-2 bg-elevated border border-border hover:border-border-hover rounded-sm px-2.5 py-1.5 cursor-pointer transition-colors"
      >
        <span className="text-sm font-medium text-text-primary max-w-[180px] truncate">
          {loadedModel?.name ?? 'No model loaded'}
        </span>
        {loadedModel && (
          <span className="text-2xs bg-green/15 text-green rounded px-1.5 py-px">loaded</span>
        )}
        {loadedModel?.engine && (
          <span className={`text-2xs rounded px-1.5 py-px ${
            loadedModel.engine === 'vllm' ? 'bg-blue/15 text-blue' : 'bg-accent/15 text-accent'
          }`}>
            {loadedModel.engine === 'vllm' ? 'vLLM' : 'llama.cpp'}
          </span>
        )}
        <svg className="w-3.5 h-3.5 stroke-text-muted" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div className="flex items-center gap-1.5 ml-auto">
        <TopBarBtn onClick={onExport}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          Export
        </TopBarBtn>
        <TopBarBtn onClick={onClear}>
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 .49-5.01"/>
          Clear
        </TopBarBtn>
        {loadedModel && (
          <button
            onClick={onEject}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border border-red/30 bg-red/10 hover:bg-red/20 text-red text-xs font-medium transition-colors cursor-pointer"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
            </svg>
            Eject
          </button>
        )}
      </div>
    </div>
  )
}

function LoadingBar({ pct, modelName, onEject }: { pct: number; modelName: string; onEject: () => void }): React.ReactElement {
  return (
    <div className="h-[50px] bg-surface border-b border-border flex items-center px-4 gap-3 flex-shrink-0">
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex justify-between text-xs">
          <span className="text-accent">Loading {modelName}…</span>
          <span className="font-mono text-text-muted">~{pct}%</span>
        </div>
        <div className="h-[3px] bg-overlay rounded-sm overflow-hidden">
          <div className="h-full bg-accent rounded-sm transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <TopBarBtn onClick={onEject}>
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        Eject
      </TopBarBtn>
    </div>
  )
}

function TopBarBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border border-border hover:bg-overlay text-text-secondary text-xs font-medium transition-colors cursor-pointer"
    >
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {Array.isArray(children) ? children.slice(0, -1) : null}
      </svg>
      {Array.isArray(children) ? children[children.length - 1] : children}
    </button>
  )
}
