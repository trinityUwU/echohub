import { useState, useEffect, useRef } from 'react'
import type { ConversationSummary, GpuStats } from '@/types'
import { useContextMenu } from '@/components/shared/useContextMenu'

type Filter = 'active' | 'archived'

interface ConvSidebarProps {
  conversations: ConversationSummary[]
  archivedConversations: ConversationSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void | Promise<void>
  onDelete: (id: string) => void
  onArchive: (id: string) => void
  onUnarchive: (id: string) => void
  onRename: (id: string, title: string) => void
  gpu: GpuStats | null
}

export function ConvSidebar({ conversations, archivedConversations, activeId, onSelect, onNew, onDelete, onArchive, onUnarchive, onRename, gpu }: ConvSidebarProps): React.ReactElement {
  const [filter, setFilter] = useState<Filter>('active')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const { open: openCtx } = useContextMenu()
  const list = filter === 'active' ? conversations : archivedConversations

  const handleContextMenu = (e: React.MouseEvent, conv: ConversationSummary, isArchived: boolean): void => {
    const RenameIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    const ArchiveIcon = isArchived
      ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.01"/></svg>
      : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
    const DeleteIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>

    openCtx(e, [
      { label: 'Rename', icon: RenameIcon, onClick: () => setRenamingId(conv.id) },
      { label: isArchived ? 'Unarchive' : 'Archive', icon: ArchiveIcon, onClick: () => isArchived ? onUnarchive(conv.id) : onArchive(conv.id) },
      { label: '', separator: true, onClick: () => {} },
      { label: 'Delete', icon: DeleteIcon, danger: true, onClick: () => onDelete(conv.id) },
    ])
  }

  return (
    <aside className="w-[240px] bg-surface border-r border-border flex flex-col flex-shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-border">
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-widest text-text-muted">Chats</h2>
        {filter === 'active' && (
          <button onClick={onNew}
            className="w-[26px] h-[26px] flex items-center justify-center rounded-sm hover:bg-overlay text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            title="New chat">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-border">
        <FilterTab label="Active" count={conversations.length} active={filter === 'active'} onClick={() => setFilter('active')} />
        <FilterTab label="Archived" count={archivedConversations.length} active={filter === 'archived'} onClick={() => setFilter('archived')} />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2">
        {list.length === 0 && (
          <div className="text-xs text-text-muted text-center py-8 px-2">
            {filter === 'active' ? 'No conversations yet.\nClick + to start.' : 'No archived conversations.'}
          </div>
        )}
        {list.map(conv => (
          <ConvItem
            key={conv.id} conv={conv}
            active={conv.id === activeId}
            isArchived={filter === 'archived'}
            renaming={renamingId === conv.id}
            onClick={() => { if (renamingId !== conv.id) onSelect(conv.id) }}
            onContextMenu={e => handleContextMenu(e, conv, filter === 'archived')}
            onDelete={() => onDelete(conv.id)}
            onArchive={() => filter === 'archived' ? onUnarchive(conv.id) : onArchive(conv.id)}
            onRenameStart={() => setRenamingId(conv.id)}
            onRenameSubmit={title => { setRenamingId(null); onRename(conv.id, title) }}
            onRenameCancel={() => setRenamingId(null)}
          />
        ))}
      </div>

      {gpu && <GpuSection gpu={gpu} />}
    </aside>
  )
}

function FilterTab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }): React.ReactElement {
  return (
    <button onClick={onClick}
      className={`flex-1 py-2 text-xs font-medium cursor-pointer transition-colors ${
        active ? 'text-accent border-b-2 border-accent' : 'text-text-muted hover:text-text-secondary'
      }`}>
      {label} {count > 0 && <span className="ml-1 opacity-60">{count}</span>}
    </button>
  )
}

function ConvItem({ conv, active, isArchived, renaming, onClick, onContextMenu, onDelete, onArchive, onRenameStart, onRenameSubmit, onRenameCancel }: {
  conv: ConversationSummary; active: boolean; isArchived: boolean; renaming: boolean
  onClick: () => void; onContextMenu: (e: React.MouseEvent) => void
  onDelete: () => void; onArchive: () => void
  onRenameStart: () => void; onRenameSubmit: (title: string) => void; onRenameCancel: () => void
}): React.ReactElement {
  const [renameVal, setRenameVal] = useState(conv.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) {
      setRenameVal(conv.title)
      setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0)
    }
  }, [renaming, conv.title])

  const submit = (): void => {
    const val = renameVal.trim()
    if (val && val !== conv.title) onRenameSubmit(val)
    else onRenameCancel()
  }

  return (
    <div
      className={`relative w-full group rounded-sm transition-colors ${active ? 'bg-accent-dim' : 'hover:bg-overlay'}`}
      onContextMenu={onContextMenu}
    >
      {renaming ? (
        <div className="px-2.5 py-2">
          <input
            ref={inputRef}
            value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') onRenameCancel()
            }}
            onBlur={submit}
            className="w-full bg-elevated border border-accent/50 rounded-sm px-2 py-0.5 text-sm text-text-primary outline-none"
          />
        </div>
      ) : (
        <button onClick={onClick} className="w-full text-left px-2.5 py-2 flex flex-col gap-0.5 pr-16">
          <span className={`text-sm truncate ${active ? 'text-accent-hover' : 'text-text-primary'}`}>
            {conv.title}
          </span>
          <span className="text-xs text-text-muted flex gap-1.5">
            <span>{conv.model_id?.split('/').pop()?.split('-').slice(0, 2).join('-') ?? '—'}</span>
            {conv.message_count > 0 && <span>{conv.message_count} msgs</span>}
          </span>
        </button>
      )}

      {/* Hover actions */}
      {!renaming && (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={e => { e.stopPropagation(); onRenameStart() }} title="Rename"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-secondary cursor-pointer transition-colors">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button onClick={e => { e.stopPropagation(); onArchive() }} title={isArchived ? 'Unarchive' : 'Archive'}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-secondary cursor-pointer transition-colors">
            {isArchived ? (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.01"/>
              </svg>
            ) : (
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
              </svg>
            )}
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete() }} title="Delete"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-red/15 text-text-muted hover:text-red cursor-pointer transition-colors">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

function GpuSection({ gpu }: { gpu: GpuStats }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const vramPct = gpu.vram_total_mb > 0 ? gpu.vram_used_mb / gpu.vram_total_mb : 0
  const gpuPct  = gpu.gpu_utilization_pct ?? 0
  const usedGb  = (gpu.vram_used_mb / 1024).toFixed(1)
  const totalGb = (gpu.vram_total_mb / 1024).toFixed(0)
  const shortName = gpu.name.replace('NVIDIA GeForce ', '').replace('AMD Radeon ', '').replace('Apple ', '')

  return (
    <div className="border-t border-border mt-auto">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-overlay transition-colors cursor-pointer">
        <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-green flex-shrink-0" />
          GPUs (1)
        </div>
        <svg className={`w-3 h-3 stroke-text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5">
          <div className="text-xs font-medium text-text-primary truncate">{shortName}</div>
          <MiniBar label="VRAM" value={`${usedGb}/${totalGb} GB`} pct={vramPct}
            color={vramPct > 0.9 ? 'bg-red' : vramPct > 0.75 ? 'bg-yellow' : 'bg-accent'} />
          {gpu.vram_total_mb > 0 && (
            <MiniBar label="GPU" value={`${gpuPct}%`} pct={gpuPct / 100}
              color={gpuPct > 90 ? 'bg-red' : gpuPct > 70 ? 'bg-yellow' : 'bg-green'} />
          )}
          {gpu.temperature_c != null && (
            <div className="flex justify-between text-2xs">
              <span className="text-text-muted">Temp</span>
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

function MiniBar({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }): React.ReactElement {
  return (
    <div>
      <div className="flex justify-between text-2xs text-text-muted mb-1">
        <span>{label}</span><span className="font-mono">{value}</span>
      </div>
      <div className="h-1.5 bg-overlay rounded-sm overflow-hidden">
        <div className={`h-full rounded-sm transition-all duration-500 ${color}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
      </div>
    </div>
  )
}
