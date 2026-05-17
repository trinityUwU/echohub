import { useState } from 'react'
import type { ConversationSummary, GpuStats } from '@/types'

interface ConvSidebarProps {
  conversations: ConversationSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void | Promise<void>
  gpu: GpuStats | null
}

export function ConvSidebar({ conversations, activeId, onSelect, onNew, gpu }: ConvSidebarProps): React.ReactElement {
  return (
    <aside className="w-[240px] bg-surface border-r border-border flex flex-col flex-shrink-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-border">
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-widest text-text-muted">Chats</h2>
        <button
          onClick={onNew}
          className="w-[26px] h-[26px] flex items-center justify-center rounded-sm hover:bg-overlay text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 && (
          <div className="text-xs text-text-muted text-center py-8 px-2">
            No conversations yet.<br/>Click + to start.
          </div>
        )}
        {conversations.map(conv => (
          <ConvItem key={conv.id} conv={conv} active={conv.id === activeId} onClick={() => onSelect(conv.id)} />
        ))}
      </div>

      {gpu && <GpuSection gpu={gpu} />}
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

function GpuSection({ gpu }: { gpu: GpuStats }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const vramPct  = gpu.vram_total_mb > 0 ? gpu.vram_used_mb / gpu.vram_total_mb : 0
  const gpuPct   = gpu.gpu_utilization_pct ?? 0
  const usedGb   = (gpu.vram_used_mb / 1024).toFixed(1)
  const totalGb  = (gpu.vram_total_mb / 1024).toFixed(0)
  const shortName = gpu.name.replace('NVIDIA GeForce ', '').replace('AMD Radeon ', '').replace('Apple ', '')

  return (
    <div className="border-t border-border">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-overlay transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-green flex-shrink-0" />
          GPUs (1)
        </div>
        <svg
          className={`w-3 h-3 stroke-text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Expanded details */}
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5">
          <div className="text-xs font-medium text-text-primary truncate">{shortName}</div>

          <div>
            <div className="flex justify-between text-2xs text-text-muted mb-1">
              <span>VRAM</span>
              <span className="font-mono">{usedGb} / {totalGb} GB · {Math.round(vramPct * 100)}%</span>
            </div>
            <div className="h-1.5 bg-overlay rounded-sm overflow-hidden">
              <div
                className={`h-full rounded-sm transition-all duration-500 ${
                  vramPct > 0.9 ? 'bg-red' : vramPct > 0.75 ? 'bg-yellow' : 'bg-accent'
                }`}
                style={{ width: `${Math.min(vramPct * 100, 100)}%` }}
              />
            </div>
          </div>

          {gpu.vram_total_mb > 0 && (
            <div>
              <div className="flex justify-between text-2xs text-text-muted mb-1">
                <span>GPU utilization</span>
                <span className="font-mono">{gpuPct}%</span>
              </div>
              <div className="h-1.5 bg-overlay rounded-sm overflow-hidden">
                <div
                  className={`h-full rounded-sm transition-all duration-500 ${
                    gpuPct > 90 ? 'bg-red' : gpuPct > 70 ? 'bg-yellow' : 'bg-green'
                  }`}
                  style={{ width: `${gpuPct}%` }}
                />
              </div>
            </div>
          )}

          {gpu.temperature_c != null && (
            <div className="flex justify-between text-2xs">
              <span className="text-text-muted">Temperature</span>
              <span className={`font-mono ${gpu.temperature_c > 80 ? 'text-red' : gpu.temperature_c > 70 ? 'text-yellow' : 'text-text-muted'}`}>
                {gpu.temperature_c}°C
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
