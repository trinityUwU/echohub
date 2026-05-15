import { useState } from 'react'
import { deleteModel } from '@/api/client'
import type { ModelInfo } from '@/types'

interface Props {
  model: ModelInfo
  vramFreeGb: number
  isLoaded: boolean
  onClose: () => void
  onDeleted: () => void
  onLoad: (id: string) => void
  onUnload: () => void
}

const CAP_COLORS: Record<string, string> = {
  thinking: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  vision: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  code: 'bg-green-500/20 text-green-300 border-green-500/30',
  multilingual: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
}

function VramMeter({ estimateGb, freeGb }: { estimateGb: number; freeGb: number }) {
  const pct = freeGb > 0 ? (estimateGb / freeGb) * 100 : 999
  const barPct = Math.min(pct, 100)

  let barColor: string
  let label: string
  if (pct <= 75) { barColor = 'bg-emerald-500'; label = `~${Math.round(pct)}% of free VRAM` }
  else if (pct <= 95) { barColor = 'bg-yellow-500'; label = `~${Math.round(pct)}% — tight` }
  else if (pct <= 115) { barColor = 'bg-orange-500'; label = `~${Math.round(pct)}% — very tight` }
  else { barColor = 'bg-red-500'; label = `~${Math.round(pct)}% — OOM risk` }

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted">VRAM usage estimate</span>
        <span className="text-white font-mono">{label}</span>
      </div>
      <div className="w-full h-2 bg-surface-3 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barPct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted mt-1">
        <span>~{estimateGb} GB needed</span>
        <span>{freeGb.toFixed(1)} GB free</span>
      </div>
    </div>
  )
}

export function ModelDetailModal({ model, vramFreeGb, isLoaded, onClose, onDeleted, onLoad, onUnload }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const activeCaps = Object.entries(model.capabilities).filter(([, v]) => v).map(([k]) => k)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteModel(model.id)
      onDeleted()
      onClose()
    } catch (e) {
      console.error('Delete failed:', e)
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-surface-1 border border-border rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4 gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white break-all">{model.name}</h2>
            {model.author && <p className="text-xs text-muted mt-0.5">{model.author}</p>}
            <p className="text-xs text-muted/60 mt-0.5 break-all">{model.id}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white shrink-0 text-lg leading-none">✕</button>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {model.params_billion && (
            <div className="bg-surface-2 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-white">{model.params_billion}B</p>
              <p className="text-xs text-muted">Parameters</p>
            </div>
          )}
          {model.quantization && (
            <div className="bg-surface-2 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-white font-mono">{model.quantization}</p>
              <p className="text-xs text-muted">Quantization</p>
            </div>
          )}
          {model.size_gb && (
            <div className="bg-surface-2 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-white">{model.size_gb}</p>
              <p className="text-xs text-muted">GB on disk</p>
            </div>
          )}
          {model.downloads !== null && (
            <div className="bg-surface-2 rounded-xl p-3 text-center">
              <p className="text-sm font-bold text-white">{(model.downloads / 1000).toFixed(0)}K</p>
              <p className="text-xs text-muted">Downloads</p>
            </div>
          )}
          {model.likes !== null && (
            <div className="bg-surface-2 rounded-xl p-3 text-center">
              <p className="text-sm font-bold text-white">{model.likes}</p>
              <p className="text-xs text-muted">Likes</p>
            </div>
          )}
        </div>

        {/* Capabilities */}
        {activeCaps.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {activeCaps.map((cap) => (
              <span key={cap} className={`text-xs px-2 py-0.5 rounded border ${CAP_COLORS[cap]}`}>
                {cap}
              </span>
            ))}
          </div>
        )}

        {/* VRAM estimate */}
        {model.vram_estimate_gb && vramFreeGb > 0 && (
          <div className="mb-4">
            <VramMeter estimateGb={model.vram_estimate_gb} freeGb={vramFreeGb} />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-2">
          {isLoaded ? (
            <button
              onClick={onUnload}
              className="flex-1 text-sm py-2 rounded-xl bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              Unload
            </button>
          ) : (
            <button
              onClick={() => onLoad(model.id)}
              className="flex-1 text-sm py-2 rounded-xl bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors"
            >
              Load model
            </button>
          )}

          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-4 text-sm py-2 rounded-xl bg-surface-3 text-muted border border-border hover:text-red-400 hover:border-red-500/30 transition-colors"
              title="Delete from disk"
            >
              🗑
            </button>
          ) : (
            <div className="flex gap-2 flex-1">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 text-sm py-2 rounded-xl bg-surface-3 text-muted border border-border hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 text-sm py-2 rounded-xl bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/40 disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
