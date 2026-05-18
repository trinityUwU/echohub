import { useState, useEffect } from 'react'
import type { FinetuneProfile } from '@/types'
import { listFinetuneProfiles, createFinetuneJob } from '@/api/client'

interface FTLoadModalProps {
  modelId: string
  profileId: string | null
  onClose: () => void
  onJobCreated: (jobId: string) => void
}

export function FTLoadModal({ modelId, profileId, onClose, onJobCreated }: FTLoadModalProps): React.ReactElement {
  const [profiles, setProfiles] = useState<FinetuneProfile[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string | null>(profileId)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    listFinetuneProfiles()
      .then(data => setProfiles(data))
      .catch(() => {})
  }, [])

  useEffect(() => { setSelectedProfile(profileId) }, [profileId])

  const handleStart = async (): Promise<void> => {
    setStarting(true)
    try {
      const job = await createFinetuneJob({
        model_id: modelId,
        profile_id: selectedProfile,
      })
      onJobCreated(job.id)
      onClose()
    } catch { /* ignore */ } finally {
      setStarting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface border border-white/[0.08] rounded-xl p-5 w-[380px] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-text-primary mb-4">Start fine-tuning</h2>

        <div className="mb-3">
          <span className="text-xs text-text-muted block mb-1">Model</span>
          <span className="text-xs text-text-secondary">{modelId}</span>
        </div>

        <div className="mb-4">
          <span className="text-xs text-text-muted block mb-1.5">Profile</span>
          <select
            value={selectedProfile ?? ''}
            onChange={e => setSelectedProfile(e.target.value || null)}
            className="w-full bg-elevated border border-white/[0.08] rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent/40"
          >
            <option value="">All pairs (no profile)</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.pair_count ?? 0} pairs)
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleStart}
            disabled={starting}
            className="flex-1 py-2 bg-accent/20 hover:bg-accent/30 disabled:opacity-40 text-accent text-xs rounded cursor-pointer transition-colors"
          >
            {starting ? 'Starting...' : 'Start training'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 text-text-muted hover:text-text-secondary text-xs rounded border border-white/[0.06] cursor-pointer transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
