import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { listTrainingPairs, createTrainingPair, deleteTrainingPair } from '@/api/client'
import type { TrainingPair } from '@/types'

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

interface AddFormState {
  prompt: string
  chosen: string
  rejected: string
}

const EMPTY_FORM: AddFormState = { prompt: '', chosen: '', rejected: '' }

export function PairsTab(): React.ReactElement {
  const [pairs, setPairs] = useState<TrainingPair[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    try {
      const data = await listTrainingPairs()
      setPairs(data)
    } catch { /* best-effort */ }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const handleSave = async (): Promise<void> => {
    if (!form.prompt.trim() || !form.chosen.trim() || !form.rejected.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      await createTrainingPair({ prompt: form.prompt, chosen: form.chosen, rejected: form.rejected })
      setForm(EMPTY_FORM)
      setShowAdd(false)
      await load()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await deleteTrainingPair(id)
      setPairs(p => p.filter(x => x.id !== id))
    } catch { /* best-effort */ }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">Training Pairs</span>
          {!loading && (
            <span className="text-xs text-text-muted bg-overlay px-2 py-0.5 rounded-full">{pairs.length}</span>
          )}
        </div>
        <button
          onClick={() => { setShowAdd(v => !v); setSaveError(null) }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-sm text-text-muted hover:text-text-primary hover:bg-overlay cursor-pointer transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add manually
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <AnimatePresence>
          {showAdd && (
            <motion.div
              key="add-form"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="border-b border-border overflow-hidden"
            >
              <div className="px-5 py-4 flex flex-col gap-3 bg-surface">
                <div className="text-xs text-text-muted uppercase tracking-widest font-medium">New pair</div>
                <AddField label="Prompt" value={form.prompt} onChange={v => setForm(f => ({ ...f, prompt: v }))} />
                <AddField label="Chosen response" value={form.chosen} onChange={v => setForm(f => ({ ...f, chosen: v }))} accent="green" />
                <AddField label="Rejected response" value={form.rejected} onChange={v => setForm(f => ({ ...f, rejected: v }))} accent="red" />
                {saveError && <div className="text-xs text-red-400">{saveError}</div>}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => { setShowAdd(false); setForm(EMPTY_FORM) }}
                    className="px-3 py-1 text-xs text-text-muted hover:text-text-secondary border border-border rounded-sm cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || !form.prompt.trim() || !form.chosen.trim() || !form.rejected.trim()}
                    className="px-3 py-1 text-xs bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-sm cursor-pointer transition-colors font-medium"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading && (
          <div className="flex items-center justify-center py-16 text-text-muted text-sm">Loading…</div>
        )}

        {!loading && pairs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-10 h-10 text-text-muted/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="text-sm text-text-muted text-center max-w-xs leading-relaxed">
              No training pairs yet. Save responses from chat to build your dataset.
            </p>
          </div>
        )}

        {!loading && pairs.length > 0 && (
          <div className="divide-y divide-border">
            {pairs.map(pair => (
              <PairRow key={pair.id} pair={pair} onDelete={() => handleDelete(pair.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AddField({ label, value, onChange, accent }: {
  label: string; value: string; onChange: (v: string) => void; accent?: 'green' | 'red'
}): React.ReactElement {
  const borderClass = accent === 'green'
    ? 'border-green/30 focus:border-green'
    : accent === 'red'
      ? 'border-border focus:border-red-400/50'
      : 'border-border focus:border-accent'
  const labelClass = accent === 'green' ? 'text-green' : accent === 'red' ? 'text-red-400' : 'text-text-muted'
  return (
    <div className="flex flex-col gap-1">
      <label className={`text-xs ${labelClass}`}>{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className={`text-xs text-text-primary bg-elevated border ${borderClass} rounded-sm px-2.5 py-2 resize-none outline-none transition-colors leading-relaxed`}
      />
    </div>
  )
}

function PairRow({ pair, onDelete }: { pair: TrainingPair; onDelete: () => void }): React.ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="px-5 py-3 hover:bg-white/[0.02] transition-colors group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="text-xs text-text-muted">{trunc(pair.prompt, 80)}</div>
          <div className="flex gap-4">
            <span className="text-xs text-green">{trunc(pair.chosen, 60)}</span>
            <span className="text-xs text-text-muted/50">{trunc(pair.rejected, 60)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-text-muted/50">{formatDate(pair.created_at)}</span>
          <button
            onClick={onDelete}
            className="w-6 h-6 flex items-center justify-center rounded-sm text-text-muted hover:text-red-400 hover:bg-red-400/10 cursor-pointer transition-colors opacity-0 group-hover:opacity-100"
            title="Delete"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      </div>
    </motion.div>
  )
}
