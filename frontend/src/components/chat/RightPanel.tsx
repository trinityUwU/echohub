import { useEffect, useRef, useState } from 'react'
import { Accordion } from '@/components/shared/Accordion'
import { Slider } from '@/components/shared/Slider'
import { Toggle } from '@/components/shared/Toggle'
import type { ChatParams } from '@/types'
import type { useProfiles } from '@/hooks/useProfiles'

interface RightPanelProps {
  params: ChatParams
  onChange: (p: ChatParams) => void
  profiles: ReturnType<typeof useProfiles>
}

export function RightPanel({ params, onChange, profiles }: RightPanelProps): React.ReactElement {
  const set = <K extends keyof ChatParams>(k: K, v: ChatParams[K]): void => onChange({ ...params, [k]: v })

  return (
    <aside className="w-[260px] bg-surface border-l border-border flex flex-col flex-shrink-0 overflow-y-auto">
      <Accordion title="Profile">
        <ProfileSection params={params} onChange={onChange} profiles={profiles} />
      </Accordion>
      <Accordion title="System Prompt">
        <textarea
          value={params.systemPrompt}
          onChange={e => set('systemPrompt', e.target.value)}
          placeholder="You are a helpful assistant…"
          className="w-full bg-elevated border border-border focus:border-border-hover rounded-sm px-2.5 py-2 text-sm text-text-primary placeholder-text-muted resize-y outline-none leading-relaxed min-h-[80px] transition-colors"
        />
      </Accordion>
      <Accordion title="Parameters">
        <Slider label="Temperature"  value={params.temperature}     min={0}   max={2}     step={0.01} onChange={v => set('temperature', v)} />
        <Slider label="Max Tokens"   value={params.maxTokens}       min={256} max={16384} step={256}  onChange={v => set('maxTokens', v)} formatValue={v => v.toLocaleString('en')} />
        <Slider label="Top P"        value={params.topP}            min={0}   max={1}     step={0.01} onChange={v => set('topP', v)} />
        <Slider label="Top K"        value={params.topK < 0 ? 40 : params.topK} min={1} max={100} step={1} onChange={v => set('topK', v)} />
        <Slider label="Rep. Penalty" value={params.repetitionPenalty} min={1} max={2}     step={0.01} onChange={v => set('repetitionPenalty', v)} />
      </Accordion>
      <Accordion title="Features">
        <ToggleRow label="Enable thinking"    value={params.enableThinking} onChange={v => set('enableThinking', v)} />
        <ToggleRow label="Stream output"      value={true}  onChange={() => {}} />
        <ToggleRow label="Auto-title"         value={true}  onChange={() => {}} />
        <ToggleRow label="Context compaction" value={false} onChange={() => {}} />
      </Accordion>
    </aside>
  )
}

interface ProfileSectionProps {
  params: ChatParams
  onChange: (p: ChatParams) => void
  profiles: ReturnType<typeof useProfiles>
}

function ProfileSection({ params, onChange, profiles }: ProfileSectionProps): React.ReactElement {
  const { profiles: list, activeId, selectProfile, saveProfile, deleteProfile } = profiles
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState('')

  const handleSelect = (id: string): void => {
    const loaded = selectProfile(id)
    onChange(loaded)
  }

  const handleSaveCurrent = (): void => {
    saveProfile(activeId, list.find(p => p.id === activeId)?.name ?? 'Profile', params)
    setSaving(false)
  }

  const handleSaveNew = (): void => {
    const name = newName.trim()
    if (!name) return
    const id = `custom-${Date.now()}`
    saveProfile(id, name, params)
    setNewName('')
    setSaving(false)
  }

  const isBuiltin = ['default', 'coder', 'creative'].includes(activeId)

  return (
    <div className="flex flex-col gap-2.5">
      <ProfileDropdown list={list} activeId={activeId} onSelect={handleSelect} />

      {/* Action buttons */}
      {!saving ? (
        <div className="flex gap-1.5">
          <button
            onClick={() => setSaving(true)}
            className="flex-1 text-xs px-2.5 py-1.5 rounded-sm border border-border hover:border-border-hover bg-elevated text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
          >
            Save as…
          </button>
          {!isBuiltin && (
            <button
              onClick={handleSaveCurrent}
              className="flex-1 text-xs px-2.5 py-1.5 rounded-sm border border-accent/35 bg-accent-dim text-accent hover:bg-accent/20 cursor-pointer transition-colors"
            >
              Save
            </button>
          )}
          {!isBuiltin && (
            <button
              onClick={() => deleteProfile(activeId)}
              className="w-8 flex items-center justify-center rounded-sm border border-border hover:border-red/30 hover:bg-red/10 text-text-muted hover:text-red cursor-pointer transition-colors"
              title="Delete profile"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveNew(); if (e.key === 'Escape') setSaving(false) }}
            placeholder="Profile name…"
            className="w-full bg-elevated border border-accent/40 rounded-sm px-2.5 py-1.5 text-sm text-text-primary placeholder-text-muted outline-none"
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleSaveNew}
              disabled={!newName.trim()}
              className="flex-1 text-xs px-2.5 py-1.5 rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-white cursor-pointer transition-colors"
            >
              Save new
            </button>
            <button
              onClick={() => { setSaving(false); setNewName('') }}
              className="flex-1 text-xs px-2.5 py-1.5 rounded-sm border border-border text-text-muted hover:text-text-secondary cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ProfileDropdown({ list, activeId, onSelect }: {
  list: import('@/types').ChatProfile[]
  activeId: string
  onSelect: (id: string) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = list.find(p => p.id === activeId) ?? list[0]

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 bg-elevated border border-border hover:border-border-hover rounded-sm px-2.5 py-2 text-sm text-text-primary cursor-pointer transition-colors"
      >
        <span>{active.name}</span>
        <svg className={`w-3.5 h-3.5 stroke-text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-elevated border border-border-hover rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.4)] z-50 overflow-hidden">
          {list.map(p => (
            <button
              key={p.id}
              onClick={() => { onSelect(p.id); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-sm cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                p.id === activeId
                  ? 'bg-accent-dim text-accent'
                  : 'text-text-secondary hover:bg-overlay hover:text-text-primary'
              }`}
            >
              <span>{p.name}</span>
              {p.id === activeId && (
                <svg className="w-3 h-3 stroke-accent flex-shrink-0" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }): React.ReactElement {
  return (
    <div className="flex justify-between items-center py-1.5 text-sm text-text-secondary">
      <span>{label}</span>
      <Toggle on={value} onChange={onChange} />
    </div>
  )
}
