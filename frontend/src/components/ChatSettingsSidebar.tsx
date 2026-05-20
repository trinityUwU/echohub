import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ChatParams, ChatProfile } from '@/types'
import { DEFAULT_CHAT_PARAMS } from '@/hooks/useChat'

const PROFILES_KEY = 'echohub_profiles'

const DEFAULT_PROFILES: ChatProfile[] = [
  { id: 'default', name: 'Default', params: { ...DEFAULT_CHAT_PARAMS } },
  { id: 'precise', name: 'Precise', params: { ...DEFAULT_CHAT_PARAMS, temperature: 0.2 } },
  { id: 'creative', name: 'Creative', params: { ...DEFAULT_CHAT_PARAMS, temperature: 1.0 } },
  { id: 'balanced', name: 'Balanced', params: { ...DEFAULT_CHAT_PARAMS, temperature: 0.7 } },
]

function loadProfiles(): ChatProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (!raw) return DEFAULT_PROFILES
    return JSON.parse(raw) as ChatProfile[]
  } catch {
    return DEFAULT_PROFILES
  }
}

function saveProfiles(profiles: ChatProfile[]): void {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}

function Slider({ label, value, min, max, step, onChange, format }: SliderProps) {
  const display = format ? format(value) : String(value)
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-xs text-white font-mono tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-surface-3 rounded-full appearance-none cursor-pointer accent-accent"
      />
    </div>
  )
}

interface SectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function Section({ title, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-white/70 hover:text-white transition-colors"
      >
        <span>{title}</span>
        <span className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface Props {
  params: ChatParams
  onChange: (params: ChatParams) => void
  maxContextWindow?: number
}

interface SaveModalProps {
  initialName: string
  isOverwrite: boolean
  onConfirm: (name: string) => void
  onCancel: () => void
}

function SaveProfileModal({ initialName, isOverwrite, onConfirm, onCancel }: SaveModalProps) {
  const [name, setName] = useState(initialName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleConfirm = () => {
    if (!name.trim()) return
    onConfirm(name.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.15 }}
        className="relative z-10 w-80 bg-surface-1 border border-border rounded-2xl shadow-2xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="text-sm font-semibold text-white">Save Profile</p>
          <p className="text-xs text-muted mt-0.5">
            {isOverwrite ? 'A profile with this name already exists — it will be overwritten.' : 'Name your settings profile.'}
          </p>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm()
            if (e.key === 'Escape') onCancel()
          }}
          className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent/60"
          placeholder="Profile name"
        />

        {isOverwrite && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <span className="text-yellow-400 text-xs">⚠</span>
            <p className="text-xs text-yellow-400">"{name}" will be overwritten</p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 text-xs py-2 rounded-lg bg-surface-3 text-muted border border-border hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!name.trim()}
            className="flex-1 text-xs py-2 rounded-lg bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isOverwrite ? 'Overwrite' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

export function ChatSettingsSidebar({ params, onChange, maxContextWindow }: Props) {
  const [profiles, setProfiles] = useState<ChatProfile[]>(loadProfiles)
  const [selectedProfileId, setSelectedProfileId] = useState<string>('default')
  const [stopInput, setStopInput] = useState('')
  const [saveModalOpen, setSaveModalOpen] = useState(false)

  const set = useCallback(<K extends keyof ChatParams>(key: K, value: ChatParams[K]) => {
    onChange({ ...params, [key]: value })
  }, [params, onChange])

  const stopChips = params.stop
    ? params.stop.split(',').map((s) => s.trim()).filter(Boolean)
    : []

  const addStop = (val: string) => {
    const trimmed = val.trim()
    if (!trimmed) return
    const existing = stopChips
    if (!existing.includes(trimmed)) {
      set('stop', [...existing, trimmed].join(', '))
    }
    setStopInput('')
  }

  const removeStop = (chip: string) => {
    set('stop', stopChips.filter((c) => c !== chip).join(', '))
  }

  const handleProfileSelect = (profileId: string) => {
    setSelectedProfileId(profileId)
    const profile = profiles.find((p) => p.id === profileId)
    if (profile) onChange({ ...profile.params })
  }

  const currentProfileName = profiles.find((p) => p.id === selectedProfileId)?.name ?? 'My Profile'

  const handleSaveConfirm = (name: string) => {
    setSaveModalOpen(false)
    const existing = profiles.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      // Overwrite — keep same id
      const updated = profiles.map((p) =>
        p.id === existing.id ? { ...p, params: { ...params } } : p
      )
      setProfiles(updated)
      saveProfiles(updated)
      setSelectedProfileId(existing.id)
    } else {
      const newProfile: ChatProfile = {
        id: `custom_${Date.now()}`,
        name,
        params: { ...params },
      }
      const updated = [...profiles, newProfile]
      setProfiles(updated)
      saveProfiles(updated)
      setSelectedProfileId(newProfile.id)
    }
  }


  const handleDeleteProfile = () => {
    const profile = profiles.find((p) => p.id === selectedProfileId)
    if (!profile) return
    // Prevent deleting built-in profiles
    if (['default', 'precise', 'creative', 'balanced'].includes(profile.id)) return
    const updated = profiles.filter((p) => p.id !== selectedProfileId)
    setProfiles(updated)
    saveProfiles(updated)
    setSelectedProfileId('default')
    const def = updated.find((p) => p.id === 'default')
    if (def) onChange({ ...def.params })
  }

  const tokenEstimate = Math.round(params.systemPrompt.length / 4)
  const isBuiltIn = ['default', 'precise', 'creative', 'balanced'].includes(selectedProfileId)

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-surface-1 border-l border-border w-[280px] shrink-0">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Chat Settings</p>
      </div>

      {/* Thinking toggle */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-white">Thinking mode</p>
          <p className="text-xs text-muted">Qwen3 extended reasoning</p>
        </div>
        <button
          onClick={() => set('enableThinking', !params.enableThinking)}
          className={`relative inline-flex items-center w-10 h-6 rounded-full transition-colors shrink-0 ${
            params.enableThinking ? 'bg-violet-500' : 'bg-surface-3 border border-border'
          }`}
        >
          <span className={`absolute w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            params.enableThinking ? 'translate-x-5' : 'translate-x-1'
          }`} />
        </button>
      </div>

      <Section title="System Prompt">
        <div className="space-y-1.5">
          <textarea
            value={params.systemPrompt}
            onChange={(e) => set('systemPrompt', e.target.value)}
            placeholder="You are a helpful assistant…"
            rows={4}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-muted resize-none focus:outline-none focus:border-accent/60"
          />
          <p className="text-xs text-muted text-right">~{tokenEstimate} tokens</p>
        </div>
      </Section>

      <Section title="Permanent Rules" defaultOpen={false}>
        <div className="space-y-2">
          <p className="text-xs text-muted leading-relaxed">
            Always injected after the system prompt, every turn. Use this to enforce behaviors the model must never ignore.
          </p>
          <textarea
            value={params.permanentRules}
            onChange={(e) => set('permanentRules', e.target.value)}
            placeholder={"Example:\n- Always use tools to write files\n- Never output code in markdown"}
            rows={5}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-muted resize-none focus:outline-none focus:border-accent/60 font-mono"
          />
          <p className="text-xs text-muted text-right">~{Math.round(params.permanentRules.length / 4)} tokens</p>
        </div>
      </Section>

      <Section title="Profiles">
        <div className="space-y-2">
          <select
            value={selectedProfileId}
            onChange={(e) => handleProfileSelect(e.target.value)}
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent/60"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={() => setSaveModalOpen(true)}
              className="flex-1 text-xs py-1.5 rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
            >
              Save
            </button>
            <button
              onClick={handleDeleteProfile}
              disabled={isBuiltIn}
              className="flex-1 text-xs py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Delete
            </button>
          </div>
        </div>
      </Section>

      <Section title="Generation">
        <Slider
          label="Temperature"
          value={params.temperature}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => set('temperature', v)}
        />
        <Slider
          label="Max Tokens"
          value={params.maxTokens}
          min={128}
          max={maxContextWindow ? Math.floor(maxContextWindow / 2) : 2048}
          step={128}
          onChange={(v) => set('maxTokens', v)}
        />
        {maxContextWindow && params.maxTokens > maxContextWindow * 0.6 && (
          <p className="text-xs text-yellow-400/70 -mt-1">
            ⚠ High — leaves little room for prompt ({maxContextWindow} ctx total)
          </p>
        )}
        <Slider
          label="Top P"
          value={params.topP}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => set('topP', v)}
        />
      </Section>

      <Section title="Sampling" defaultOpen={false}>
        <Slider
          label="Top K"
          value={params.topK}
          min={-1}
          max={100}
          step={1}
          onChange={(v) => set('topK', v)}
          format={(v) => v === -1 ? '-1 (disabled)' : String(v)}
        />
        <Slider
          label="Repetition Penalty"
          value={params.repetitionPenalty}
          min={1}
          max={2}
          step={0.05}
          onChange={(v) => set('repetitionPenalty', v)}
        />
        <Slider
          label="Presence Penalty"
          value={params.presencePenalty}
          min={-2}
          max={2}
          step={0.1}
          onChange={(v) => set('presencePenalty', v)}
        />
        <Slider
          label="Frequency Penalty"
          value={params.frequencyPenalty}
          min={-2}
          max={2}
          step={0.1}
          onChange={(v) => set('frequencyPenalty', v)}
        />
      </Section>

      <Section title="Stop Strings">
        <div className="space-y-2">
          <input
            type="text"
            value={stopInput}
            onChange={(e) => setStopInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addStop(stopInput)
              }
            }}
            placeholder="Add stop string, press Enter"
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-muted focus:outline-none focus:border-accent/60"
          />
          {stopChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {stopChips.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-3 border border-border text-xs text-white font-mono"
                >
                  {chip}
                  <button
                    onClick={() => removeStop(chip)}
                    className="text-muted hover:text-white transition-colors ml-0.5"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </Section>

      <AnimatePresence>
        {saveModalOpen && (
          <SaveProfileModal
            initialName={currentProfileName}
            isOverwrite={profiles.some((p) => p.name.toLowerCase() === currentProfileName.toLowerCase())}
            onConfirm={handleSaveConfirm}
            onCancel={() => setSaveModalOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
