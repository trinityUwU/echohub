import { useEffect, useRef, useState } from 'react'
import { useDialog } from '@/components/shared/Dialog'
import { Accordion } from '@/components/shared/Accordion'
import { Slider } from '@/components/shared/Slider'
import { Toggle } from '@/components/shared/Toggle'
import type { ChatParams, ModelInfo } from '@/types'
import type { useProfiles } from '@/hooks/useProfiles'
import { isThinkingControllable } from '@/api/client'
import { NATIVE_SKILLS, type UseSkillsReturn } from '@/hooks/useSkills'

interface RightPanelProps {
  params: ChatParams
  onChange: (p: ChatParams) => void
  profiles: ReturnType<typeof useProfiles>
  loadedModel?: ModelInfo | null
  skills?: UseSkillsReturn
}

export function RightPanel({ params, onChange, profiles, loadedModel, skills }: RightPanelProps): React.ReactElement {
  const thinkControllable = isThinkingControllable(loadedModel?.id)
  const modelHasThinking = loadedModel?.capabilities?.thinking ?? false
  const set = <K extends keyof ChatParams>(k: K, v: ChatParams[K]): void => onChange({ ...params, [k]: v })

  return (
    <aside className="w-[260px] h-full bg-surface border-l border-border flex flex-col flex-shrink-0 overflow-y-auto">
      <Accordion title="Profile">
        <ProfileSection params={params} profiles={profiles} />
      </Accordion>
      <Accordion title="System Prompt">
        <textarea
          value={params.systemPrompt}
          onChange={e => set('systemPrompt', e.target.value)}
          placeholder="You are a helpful assistant…"
          className="w-full bg-elevated border border-border focus:border-border-hover rounded-sm px-2.5 py-2 text-sm text-text-primary placeholder-text-muted resize-y outline-none leading-relaxed min-h-[80px] transition-colors"
        />
      </Accordion>
      <Accordion title="Permanent Rules">
        <div className="flex flex-col gap-1.5">
          <p className="text-2xs text-text-muted leading-relaxed">
            Réinjecté à chaque message, après le system prompt. Utilise pour les règles critiques que le modèle ne doit jamais oublier.
          </p>
          <textarea
            value={params.permanentRules}
            onChange={e => set('permanentRules', e.target.value)}
            placeholder={"- Always verify every variable is initialized\n- Never use blocking calls in async\n- Check all imports are present"}
            className="w-full bg-elevated border border-yellow/30 focus:border-yellow/60 rounded-sm px-2.5 py-2 text-sm text-text-primary placeholder-text-muted/50 resize-y outline-none leading-relaxed min-h-[100px] transition-colors"
          />
          {params.permanentRules && (
            <span className="text-2xs text-yellow">
              ~{Math.round(params.permanentRules.length / 4)} tokens réinjectés à chaque message
            </span>
          )}
        </div>
      </Accordion>
      <Accordion title="Parameters">
        <Slider label="Temperature"  value={params.temperature}     min={0}   max={2}     step={0.01} onChange={v => set('temperature', v)} />
        <Slider label="Max Tokens"   value={params.maxTokens}       min={256} max={loadedModel?.max_context_window ?? 131072} step={256}  onChange={v => set('maxTokens', v)} formatValue={v => v.toLocaleString('en')} />
        <Slider label="Top P"        value={params.topP}            min={0}   max={1}     step={0.01} onChange={v => set('topP', v)} />
        <Slider label="Top K"        value={params.topK < 0 ? 40 : params.topK} min={1} max={100} step={1} onChange={v => set('topK', v)} />
        <Slider label="Rep. Penalty" value={params.repetitionPenalty} min={1} max={2}     step={0.01} onChange={v => set('repetitionPenalty', v)} />
      </Accordion>
      {skills && (
        <Accordion title="Skills">
          <SkillsSection skills={skills} />
        </Accordion>
      )}
      <Accordion title="Features">
        {modelHasThinking && !thinkControllable ? (
          <div className="flex items-start justify-between py-1.5 gap-2">
            <div>
              <div className="text-sm text-text-muted">Enable thinking</div>
              <div className="text-2xs text-yellow mt-0.5">Native thinking — cannot be disabled on this model</div>
            </div>
            <Toggle on={true} onChange={() => {}} />
          </div>
        ) : (
          <ToggleRow label="Enable thinking" value={params.enableThinking} onChange={v => set('enableThinking', v)} />
        )}
        <ToggleRow label="Auto-title"         value={params.autoTitle}         onChange={v => set('autoTitle', v)} />
        <ToggleRow label="Context compaction" value={params.contextCompaction} onChange={v => set('contextCompaction', v)} />
      </Accordion>
    </aside>
  )
}

interface ProfileSectionProps {
  params: ChatParams
  profiles: ReturnType<typeof useProfiles>
}

function ProfileSection({ params, profiles }: ProfileSectionProps): React.ReactElement {
  const { profiles: list, activeId, selectProfile, saveProfile, deleteProfile } = profiles
  const [naming, setNaming] = useState(false)
  const [newName, setNewName] = useState('')
  const { confirm, element: dialogEl } = useDialog()

  const handleSelect = (id: string): void => { selectProfile(id) }

  const handleSaveCurrent = async (): Promise<void> => {
    const name = list.find(p => p.id === activeId)?.name ?? 'Profile'
    const ok = await confirm(`Overwrite "${name}"?`, 'This will replace the profile with your current settings.')
    if (!ok) return
    saveProfile(activeId, name, params)
  }

  const handleSaveNew = (): void => {
    const name = newName.trim()
    if (!name) return
    saveProfile(`custom-${Date.now()}`, name, params)
    setNewName('')
    setNaming(false)
  }

  return (
    <div className="flex flex-col gap-2.5">
      {dialogEl}
      <ProfileDropdown list={list} activeId={activeId} onSelect={handleSelect} onDelete={deleteProfile} />

      {!naming ? (
        <div className="flex gap-1.5">
          <button
            onClick={handleSaveCurrent}
            className="flex-1 text-xs px-2.5 py-1.5 rounded-sm border border-accent/35 bg-accent-dim text-accent hover:bg-accent/20 cursor-pointer transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => { setNaming(true); setNewName('') }}
            className="flex-1 text-xs px-2.5 py-1.5 rounded-sm border border-border hover:border-border-hover bg-elevated text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
          >
            New
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSaveNew(); if (e.key === 'Escape') setNaming(false) }}
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
              onClick={() => { setNaming(false); setNewName('') }}
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

const BUILTIN_IDS = ['default']

function ProfileDropdown({ list, activeId, onSelect, onDelete }: {
  list: import('@/types').ChatProfile[]
  activeId: string
  onSelect: (id: string) => void
  onDelete: (id: string) => void
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

  const { confirm: dlgConfirm, element: dlgEl } = useDialog()

  const handleDelete = async (e: React.MouseEvent, p: import('@/types').ChatProfile): Promise<void> => {
    e.stopPropagation()
    const ok = await dlgConfirm(`Delete "${p.name}"?`, 'This profile will be permanently removed.', 'Delete')
    if (ok) { onDelete(p.id); setOpen(false) }
  }

  return (
    <div className="relative" ref={ref}>
      {dlgEl}
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
            <div
              key={p.id}
              onClick={() => { onSelect(p.id); setOpen(false) }}
              className={`w-full px-3 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2 group ${
                p.id === activeId
                  ? 'bg-accent-dim text-accent'
                  : 'text-text-secondary hover:bg-overlay hover:text-text-primary'
              }`}
            >
              <span className="flex-1">{p.name}</span>
              {p.id === activeId && (
                <svg className={`w-3 h-3 flex-shrink-0 ${BUILTIN_IDS.includes(p.id) ? 'stroke-accent' : 'stroke-text-muted'}`} viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {!BUILTIN_IDS.includes(p.id) && (
                <button
                  onClick={e => handleDelete(e, p)}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-red/20 text-text-muted hover:text-red transition-colors flex-shrink-0"
                  title={`Delete ${p.name}`}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              )}
            </div>
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

function SkillsSection({ skills }: { skills: UseSkillsReturn }): React.ReactElement {
  const all = [...NATIVE_SKILLS, ...skills.communitySkills]
  return (
    <div className="flex flex-col gap-0.5">
      {all.map(skill => {
        const active = skills.activeIds.has(skill.id)
        return (
          <div key={skill.id} className="flex items-center gap-2 py-1.5">
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              <span className={`text-sm truncate leading-tight ${active ? 'text-text-primary' : 'text-text-secondary'}`}>{skill.name}</span>
              <span className="text-2xs text-text-muted truncate leading-tight">{skill.description || 'Community skill'}</span>
            </div>
            <Toggle on={active} onChange={() => skills.toggle(skill.id)} />
          </div>
        )
      })}
      {skills.communitySkills.length > 0 && <div className="border-t border-border mt-1 pt-1" />}
      {skills.hasToolSkills && (
        <p className="text-2xs text-accent">Tool use actif — le chat utilise /tool-chat</p>
      )}
    </div>
  )
}
