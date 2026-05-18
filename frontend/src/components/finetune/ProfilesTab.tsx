import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { FinetuneProfile, TrainingPair } from '@/types'
import {
  listFinetuneProfiles, createFinetuneProfile, deleteFinetuneProfile,
  listProfilePairs, createTrainingPair, deleteTrainingPair,
} from '@/api/client'

const PRESET_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#06b6d4',
  '#f59e0b',
  '#10b981',
]

const DOMAIN_OPTIONS = ['dev', 'reasoning', 'general', 'analysis', 'debug']

interface ProfilesTabProps {
  selectedProfileId: string | null
  onSelectProfile: (id: string | null) => void
}

export function ProfilesTab({ selectedProfileId, onSelectProfile }: ProfilesTabProps): React.ReactElement {
  const [profiles, setProfiles] = useState<FinetuneProfile[]>([])
  const [pairs, setPairs] = useState<TrainingPair[]>([])
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [showAddPair, setShowAddPair] = useState(false)

  const loadProfiles = useCallback(async (): Promise<void> => {
    try {
      const data = await listFinetuneProfiles()
      setProfiles(data)
    } catch { /* ignore */ }
  }, [])

  const loadPairs = useCallback(async (profileId: string): Promise<void> => {
    try {
      const data = await listProfilePairs(profileId)
      setPairs(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  useEffect(() => {
    if (selectedProfileId) {
      loadPairs(selectedProfileId)
      setSelectedPairId(null)
    } else {
      setPairs([])
    }
  }, [selectedProfileId, loadPairs])

  const handleProfileSelect = (id: string): void => {
    onSelectProfile(id === selectedProfileId ? null : id)
    setShowAddPair(false)
  }

  const handleDeleteProfile = async (id: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    try {
      await deleteFinetuneProfile(id)
      if (selectedProfileId === id) onSelectProfile(null)
      await loadProfiles()
    } catch { /* ignore */ }
  }

  const handleProfileCreated = async (profile: FinetuneProfile): Promise<void> => {
    setShowNew(false)
    await loadProfiles()
    onSelectProfile(profile.id)
  }

  const handlePairAdded = async (): Promise<void> => {
    setShowAddPair(false)
    if (selectedProfileId) await loadPairs(selectedProfileId)
    await loadProfiles()
  }

  const handleDeletePair = async (id: string): Promise<void> => {
    try {
      await deleteTrainingPair(id)
      if (selectedPairId === id) setSelectedPairId(null)
      if (selectedProfileId) await loadPairs(selectedProfileId)
      await loadProfiles()
    } catch { /* ignore */ }
  }

  const selectedPair = pairs.find(p => p.id === selectedPairId) ?? null
  const selectedProfile = profiles.find(p => p.id === selectedProfileId) ?? null

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Col 1: Profile list */}
      <div className="w-[200px] flex-shrink-0 border-r border-white/[0.06] flex flex-col overflow-hidden">
        <div className="flex items-center px-3 py-2.5 border-b border-white/[0.06] flex-shrink-0">
          <span className="text-xs font-semibold text-text-muted flex-1 uppercase tracking-wider">Profiles</span>
          <button
            onClick={() => setShowNew(v => !v)}
            className="text-xs text-accent hover:text-accent/80 cursor-pointer transition-colors"
          >
            + New
          </button>
        </div>

        <AnimatePresence>
          {showNew && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden flex-shrink-0"
            >
              <NewProfileForm
                onSave={handleProfileCreated}
                onCancel={() => setShowNew(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto">
          {profiles.map(profile => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              selected={profile.id === selectedProfileId}
              onClick={() => handleProfileSelect(profile.id)}
              onDelete={e => handleDeleteProfile(profile.id, e)}
            />
          ))}
          {profiles.length === 0 && !showNew && (
            <div className="text-xs text-text-muted text-center py-8 px-3">
              No profiles yet
            </div>
          )}
        </div>
      </div>

      {/* Col 2: Pairs list */}
      <div className="w-[240px] flex-shrink-0 border-r border-white/[0.06] flex flex-col overflow-hidden">
        {selectedProfile ? (
          <>
            <div className="flex items-center px-3 py-2.5 border-b border-white/[0.06] flex-shrink-0 gap-2">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: selectedProfile.color }}
              />
              <span className="text-xs font-semibold text-text-secondary flex-1 truncate">
                {selectedProfile.name}
              </span>
              <button
                onClick={() => { setShowAddPair(true); setSelectedPairId(null) }}
                className="text-xs text-accent hover:text-accent/80 cursor-pointer transition-colors flex-shrink-0"
              >
                + Add
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {pairs.map(pair => (
                <PairItem
                  key={pair.id}
                  pair={pair}
                  selected={pair.id === selectedPairId}
                  onClick={() => { setSelectedPairId(pair.id); setShowAddPair(false) }}
                  onDelete={() => handleDeletePair(pair.id)}
                />
              ))}
              {pairs.length === 0 && (
                <div className="text-xs text-text-muted text-center py-8 px-3">
                  No pairs yet. Add your first pair.
                </div>
              )}
            </div>
          </>
        ) : (
          <EmptyState message="Select a profile" />
        )}
      </div>

      {/* Col 3: Pair detail or add form */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {showAddPair && selectedProfileId ? (
          <AddPairForm
            profileId={selectedProfileId}
            onSaved={handlePairAdded}
            onCancel={() => setShowAddPair(false)}
          />
        ) : selectedPair ? (
          <PairDetail pair={selectedPair} />
        ) : (
          <EmptyState message={selectedProfile ? 'Select a pair or add one' : 'Select a profile'} />
        )}
      </div>
    </div>
  )
}

// ── ProfileCard ────────────────────────────────────────────────────────────

interface ProfileCardProps {
  profile: FinetuneProfile
  selected: boolean
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
}

function ProfileCard({ profile, selected, onClick, onDelete }: ProfileCardProps): React.ReactElement {
  const pairCount = profile.pair_count ?? 0
  const progress = Math.min(pairCount / profile.target_pairs, 1)

  return (
    <div
      onClick={onClick}
      className={`group px-3 py-2.5 cursor-pointer border-b border-white/[0.04] transition-colors ${
        selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: profile.color }}
        />
        <span className="text-xs font-semibold text-text-primary flex-1 truncate">{profile.name}</span>
        {!profile.builtin && (
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer"
          >
            <svg className="w-3 h-3 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>
        )}
      </div>
      <p className="text-[10px] text-text-muted truncate mb-1.5">{profile.description}</p>
      <div
        className="h-0.5 rounded-full overflow-hidden mb-1"
        style={{ backgroundColor: profile.color + '20' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${progress * 100}%`, backgroundColor: profile.color }}
        />
      </div>
      <span className="text-[10px] text-text-muted">
        {pairCount} / {profile.target_pairs} pairs
      </span>
    </div>
  )
}

// ── NewProfileForm ─────────────────────────────────────────────────────────

interface NewProfileFormProps {
  onSave: (profile: FinetuneProfile) => void
  onCancel: () => void
}

function NewProfileForm({ onSave, onCancel }: NewProfileFormProps): React.ReactElement {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('general')
  const [targetPairs, setTargetPairs] = useState(100)
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [saving, setSaving] = useState(false)

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const profile = await createFinetuneProfile({
        name: name.trim(),
        description: `${domain} fine-tuning profile`,
        domain,
        target_pairs: targetPairs,
        color,
      })
      onSave(profile)
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-3 border-b border-white/[0.06] bg-white/[0.02] flex flex-col gap-2">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Profile name"
        className="w-full bg-surface border border-white/[0.08] rounded px-2 py-1.5 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/40"
      />
      <select
        value={domain}
        onChange={e => setDomain(e.target.value)}
        className="w-full bg-surface border border-white/[0.08] rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent/40"
      >
        {DOMAIN_OPTIONS.map(d => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={50}
          max={200}
          value={targetPairs}
          onChange={e => setTargetPairs(Number(e.target.value))}
          className="w-16 bg-surface border border-white/[0.08] rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent/40"
        />
        <span className="text-[10px] text-text-muted">pairs</span>
      </div>
      <div className="flex gap-1.5">
        {PRESET_COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full transition-transform cursor-pointer ${color === c ? 'scale-125 ring-1 ring-white/30' : 'hover:scale-110'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="flex-1 bg-accent/20 hover:bg-accent/30 disabled:opacity-40 text-accent text-xs py-1 rounded cursor-pointer transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 text-text-muted hover:text-text-secondary text-xs py-1 rounded border border-white/[0.06] cursor-pointer transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── PairItem ───────────────────────────────────────────────────────────────

interface PairItemProps {
  pair: TrainingPair
  selected: boolean
  onClick: () => void
  onDelete: () => void
}

function PairItem({ pair, selected, onClick, onDelete }: PairItemProps): React.ReactElement {
  const date = new Date(pair.created_at).toLocaleDateString()

  return (
    <div
      onClick={onClick}
      className={`group px-3 py-2.5 cursor-pointer border-b border-white/[0.04] transition-colors ${
        selected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-start gap-2">
        <p className="text-xs text-text-primary flex-1 line-clamp-2 leading-relaxed">
          {pair.prompt}
        </p>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer flex-shrink-0 mt-0.5"
        >
          <svg className="w-3 h-3 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
      <span className="text-[10px] text-text-muted mt-0.5">{date}</span>
    </div>
  )
}

// ── PairDetail ─────────────────────────────────────────────────────────────

function PairDetail({ pair }: { pair: TrainingPair }): React.ReactElement {
  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      <PairBlock label="Prompt" content={pair.prompt} color="text-text-secondary" />
      <PairBlock label="Chosen" content={pair.chosen} color="text-green-400" />
      <PairBlock label="Rejected" content={pair.rejected} color="text-red-400" />
    </div>
  )
}

function PairBlock({ label, content, color }: {
  label: string; content: string; color: string
}): React.ReactElement {
  return (
    <div>
      <span className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 block ${color}`}>{label}</span>
      <p className="text-sm text-text-primary leading-relaxed whitespace-pre-wrap">{content}</p>
    </div>
  )
}

// ── AddPairForm ────────────────────────────────────────────────────────────

interface AddPairFormProps {
  profileId: string
  onSaved: () => void
  onCancel: () => void
}

function AddPairForm({ profileId, onSaved, onCancel }: AddPairFormProps): React.ReactElement {
  const [prompt, setPrompt] = useState('')
  const [chosen, setChosen] = useState('')
  const [rejected, setRejected] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async (): Promise<void> => {
    if (!prompt.trim() || !chosen.trim() || !rejected.trim()) return
    setSaving(true)
    try {
      await createTrainingPair({ prompt: prompt.trim(), chosen: chosen.trim(), rejected: rejected.trim(), profile_id: profileId })
      onSaved()
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Add pair</span>
      <PairTextarea label="Prompt" value={prompt} onChange={setPrompt} />
      <PairTextarea label="Chosen" value={chosen} onChange={setChosen} color="text-green-400" />
      <PairTextarea label="Rejected" value={rejected} onChange={setRejected} color="text-red-400" />
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !prompt.trim() || !chosen.trim() || !rejected.trim()}
          className="px-4 py-1.5 bg-accent/20 hover:bg-accent/30 disabled:opacity-40 text-accent text-xs rounded cursor-pointer transition-colors"
        >
          {saving ? 'Saving...' : 'Save pair'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-text-muted hover:text-text-secondary text-xs rounded border border-white/[0.06] cursor-pointer transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function PairTextarea({ label, value, onChange, color }: {
  label: string; value: string; onChange: (v: string) => void; color?: string
}): React.ReactElement {
  return (
    <div>
      <span className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 block ${color ?? 'text-text-muted'}`}>{label}</span>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={4}
        className="w-full bg-surface border border-white/[0.08] rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent/40 resize-y"
      />
    </div>
  )
}

// ── EmptyState ─────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center text-text-muted text-sm">
      {message}
    </div>
  )
}
