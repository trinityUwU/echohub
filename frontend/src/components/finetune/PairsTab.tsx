import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { listTrainingPairs, createTrainingPair, deleteTrainingPair } from '@/api/client'
import type { TrainingPair } from '@/types'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

interface AddFormState { prompt: string; chosen: string; rejected: string }
const EMPTY_FORM: AddFormState = { prompt: '', chosen: '', rejected: '' }

export function PairsTab(): React.ReactElement {
  const [pairs, setPairs] = useState<TrainingPair[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<TrainingPair | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    try {
      const data = await listTrainingPairs()
      setPairs(data)
      setSelected(prev => prev ? (data.find(p => p.id === prev.id) ?? null) : null)
    } catch { /* best-effort */ }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const handleSave = async (): Promise<void> => {
    if (!form.prompt.trim() || !form.chosen.trim() || !form.rejected.trim()) return
    setSaving(true); setSaveError(null)
    try {
      const created = await createTrainingPair({ prompt: form.prompt, chosen: form.chosen, rejected: form.rejected })
      setForm(EMPTY_FORM); setShowAdd(false)
      await load()
      setSelected(created)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: string): Promise<void> => {
    try {
      await deleteTrainingPair(id)
      if (selected?.id === id) setSelected(null)
      setPairs(p => p.filter(x => x.id !== id))
    } catch { /* best-effort */ }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ── Left: list ── */}
      <div className="flex flex-col w-[340px] flex-shrink-0 border-r border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">Pairs</span>
            {!loading && <span className="text-xs text-text-muted bg-overlay px-1.5 py-0.5 rounded-full">{pairs.length}</span>}
          </div>
          <button
            onClick={() => { setShowAdd(v => !v); setSaveError(null) }}
            className="flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded-sm text-text-muted hover:text-text-primary hover:bg-overlay cursor-pointer transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="py-12 text-center text-sm text-text-muted">Loading…</div>}
          {!loading && pairs.length === 0 && (
            <div className="py-16 text-center text-sm text-text-muted px-4 leading-relaxed">
              No pairs yet. Save responses from chat or click Add.
            </div>
          )}
          {pairs.map(pair => (
            <PairListItem
              key={pair.id}
              pair={pair}
              active={selected?.id === pair.id}
              onClick={() => { setShowAdd(false); setSelected(pair) }}
            />
          ))}
        </div>
      </div>

      {/* ── Right: detail / add form ── */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {showAdd ? (
            <motion.div key="add" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }} className="flex flex-col flex-1 overflow-y-auto p-5 gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary">New pair</span>
                <button onClick={() => { setShowAdd(false); setForm(EMPTY_FORM) }}
                  className="text-xs text-text-muted hover:text-text-primary cursor-pointer transition-colors">Cancel</button>
              </div>
              <AddField label="Prompt" value={form.prompt} onChange={v => setForm(f => ({ ...f, prompt: v }))} rows={4} />
              <AddField label="Chosen response" value={form.chosen} onChange={v => setForm(f => ({ ...f, chosen: v }))} accent="green" rows={6} />
              <AddField label="Rejected response" value={form.rejected} onChange={v => setForm(f => ({ ...f, rejected: v }))} accent="red" rows={6} />
              {saveError && <div className="text-xs text-red-400">{saveError}</div>}
              <button onClick={handleSave}
                disabled={saving || !form.prompt.trim() || !form.chosen.trim() || !form.rejected.trim()}
                className="self-end px-4 py-2 text-xs bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-sm cursor-pointer transition-colors font-medium">
                {saving ? 'Saving…' : 'Save pair'}
              </button>
            </motion.div>
          ) : selected ? (
            <motion.div key={selected.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }} className="flex flex-col flex-1 overflow-y-auto p-5 gap-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-text-muted uppercase tracking-widest font-medium mb-1">Pair</div>
                  <div className="text-xs text-text-muted/60">{formatDate(selected.created_at)}
                    {selected.model_id && <span> · {selected.model_id.split('/').pop()}</span>}
                  </div>
                </div>
                <button onClick={() => handleDelete(selected.id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border rounded-sm text-text-muted hover:text-red-400 hover:border-red-400/30 cursor-pointer transition-colors flex-shrink-0">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/>
                  </svg>
                  Delete
                </button>
              </div>

              <DetailBlock label="Prompt" content={selected.prompt} />
              <DetailBlock label="Chosen" content={selected.chosen} accent="green" />
              <DetailBlock label="Rejected" content={selected.rejected} accent="red" />
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col flex-1 items-center justify-center text-text-muted/40 gap-2 select-none">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span className="text-xs">Select a pair to view details</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function PairListItem({ pair, active, onClick }: { pair: TrainingPair; active: boolean; onClick: () => void }): React.ReactElement {
  const preview = pair.prompt.length > 55 ? pair.prompt.slice(0, 55) + '…' : pair.prompt
  return (
    <button onClick={onClick} className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors cursor-pointer ${
      active ? 'bg-accent/10 border-l-2 border-l-accent' : 'hover:bg-white/[0.02]'
    }`}>
      <div className="text-xs text-text-primary leading-snug mb-1">{preview}</div>
      <div className="text-[10px] text-text-muted/50">{formatDate(pair.created_at)}</div>
    </button>
  )
}

function DetailBlock({ label, content, accent }: { label: string; content: string; accent?: 'green' | 'red' }): React.ReactElement {
  const labelClass = accent === 'green' ? 'text-green' : accent === 'red' ? 'text-red-400' : 'text-text-muted'
  const borderClass = accent === 'green' ? 'border-green/20' : accent === 'red' ? 'border-red-400/20' : 'border-border'
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`text-xs font-medium uppercase tracking-widest ${labelClass}`}>{label}</div>
      <div className={`text-sm text-text-primary bg-elevated border ${borderClass} rounded-sm px-3 py-2.5 leading-relaxed whitespace-pre-wrap font-mono text-xs`}>
        {content}
      </div>
    </div>
  )
}

function AddField({ label, value, onChange, accent, rows }: {
  label: string; value: string; onChange: (v: string) => void; accent?: 'green' | 'red'; rows?: number
}): React.ReactElement {
  const borderClass = accent === 'green' ? 'border-green/30 focus:border-green' : accent === 'red' ? 'border-border focus:border-red-400/50' : 'border-border focus:border-accent'
  const labelClass = accent === 'green' ? 'text-green' : accent === 'red' ? 'text-red-400' : 'text-text-muted'
  return (
    <div className="flex flex-col gap-1.5">
      <label className={`text-xs font-medium uppercase tracking-widest ${labelClass}`}>{label}</label>
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows ?? 3}
        className={`text-xs text-text-primary bg-elevated border ${borderClass} rounded-sm px-2.5 py-2 resize-none outline-none transition-colors leading-relaxed`} />
    </div>
  )
}
