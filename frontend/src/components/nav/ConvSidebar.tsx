import type { ConversationSummary, GpuStats } from '@/types'

interface ConvSidebarProps {
  conversations: ConversationSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  gpu: GpuStats | null
}

export function ConvSidebar({ conversations, activeId, onSelect, onNew, gpu }: ConvSidebarProps): React.ReactElement {
  return (
    <aside className="w-[240px] bg-surface border-r border-border flex flex-col flex-shrink-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-border">
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-widest text-text-muted">Chats</h2>
        <button
          onClick={onNew}
          className="w-[26px] h-[26px] flex items-center justify-center rounded-sm hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {conversations.map(conv => (
          <ConvItem key={conv.id} conv={conv} active={conv.id === activeId} onClick={() => onSelect(conv.id)} />
        ))}
      </div>

      {gpu && <GpuBar gpu={gpu} />}
    </aside>
  )
}

function ConvItem({ conv, active, onClick }: { conv: ConversationSummary; active: boolean; onClick: () => void }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2.5 py-2 rounded-sm cursor-pointer transition-colors flex flex-col gap-0.5 ${
        active ? 'bg-accent-dim' : 'hover:bg-overlay'
      }`}
    >
      <span className={`text-sm truncate ${active ? 'text-accent-hover' : 'text-text-primary'}`}>
        {conv.title}
      </span>
      <span className="text-xs text-text-muted flex gap-1.5">
        <span>{conv.model_id?.split('/').pop()?.split('-').slice(0, 2).join('-') ?? '—'}</span>
        {conv.message_count > 0 && <span>{conv.message_count} msgs</span>}
      </span>
    </button>
  )
}

function GpuBar({ gpu }: { gpu: GpuStats }): React.ReactElement {
  const pct = gpu.vram_used_mb / gpu.vram_total_mb
  const usedGb = (gpu.vram_used_mb / 1024).toFixed(1)
  const totalGb = (gpu.vram_total_mb / 1024).toFixed(0)

  return (
    <div className="px-2.5 py-2.5 border-t border-border">
      <div className="flex items-center gap-2 bg-elevated border border-border rounded-[20px] px-2.5 py-1.5 text-xs text-text-secondary">
        <span className="w-1.5 h-1.5 rounded-full bg-green flex-shrink-0" />
        <span className="truncate">{gpu.name.replace('NVIDIA GeForce ', '')}</span>
        <div className="w-[60px] h-1 bg-overlay rounded-sm overflow-hidden flex-shrink-0">
          <div className="h-full bg-accent rounded-sm transition-all" style={{ width: `${pct * 100}%` }} />
        </div>
        <span className="text-text-muted flex-shrink-0">{usedGb}/{totalGb}G</span>
      </div>
    </div>
  )
}
