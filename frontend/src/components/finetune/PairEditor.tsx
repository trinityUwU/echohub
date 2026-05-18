import { useState } from 'react'
import { motion } from 'framer-motion'
import { createTrainingPair } from '@/api/client'

interface PairEditorProps {
  prompt: string
  assistantContent: string
  sourceConvId?: string
  sourceMsgId?: string
  modelId?: string
  onSave: () => void
  onClose: () => void
}

export function PairEditor({ prompt, assistantContent, sourceConvId, sourceMsgId, modelId, onSave, onClose }: PairEditorProps): React.ReactElement {
  const [chosen, setChosen] = useState(assistantContent)
  const [rejected, setRejected] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    if (!chosen.trim() || !rejected.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createTrainingPair({
        prompt,
        chosen: chosen.trim(),
        rejected: rejected.trim(),
        source_conv_id: sourceConvId ?? null,
        source_msg_id: sourceMsgId ?? null,
        model_id: modelId ?? null,
      })
      onSave()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-[400px] mt-2 bg-overlay border border-accent/30 rounded-md p-3 flex flex-col gap-2.5"
    >
      <div className="text-xs text-text-muted font-medium uppercase tracking-widest">Save as training pair</div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-text-muted">Prompt (readonly)</label>
        <div className="text-xs text-text-primary bg-surface border border-border rounded-sm px-2.5 py-2 max-h-16 overflow-y-auto leading-relaxed opacity-70">
          {prompt}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-green">Chosen response</label>
        <textarea
          value={chosen}
          onChange={e => setChosen(e.target.value)}
          rows={3}
          className="text-xs text-text-primary bg-surface border border-green/30 focus:border-green rounded-sm px-2.5 py-2 resize-none outline-none transition-colors leading-relaxed"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-red-400">Rejected response</label>
        <textarea
          value={rejected}
          onChange={e => setRejected(e.target.value)}
          placeholder="Paste the response you want the model to avoid…"
          rows={3}
          className="text-xs text-text-primary bg-surface border border-border focus:border-red-400/50 rounded-sm px-2.5 py-2 resize-none outline-none transition-colors leading-relaxed placeholder-text-muted/50"
        />
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-1 text-xs text-text-muted hover:text-text-secondary border border-border rounded-sm cursor-pointer transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || !chosen.trim() || !rejected.trim()}
          className="px-3 py-1 text-xs bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-sm cursor-pointer transition-colors font-medium"
        >
          {saving ? 'Saving…' : 'Save pair'}
        </button>
      </div>
    </motion.div>
  )
}
