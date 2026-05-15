import type { ModelInfo } from '@/types'

interface Props {
  model: ModelInfo | null
  loading: boolean
  onUnload: () => void
}

export function LoadedModel({ model, loading, onUnload }: Props) {
  if (!model) {
    return (
      <div className="flex items-center gap-2 px-4 h-12 border-b border-border bg-surface-1">
        {loading ? (
          <>
            <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-sm text-yellow-300 animate-pulse">Unloading model…</span>
          </>
        ) : (
          <>
            <div className="w-2 h-2 rounded-full bg-surface-4" />
            <span className="text-sm text-muted">No model loaded</span>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between px-4 h-12 border-b border-border bg-surface-1">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-sm font-medium text-white">{model.name}</span>
        {model.quantization && (
          <span className="text-xs text-muted font-mono">· {model.quantization}</span>
        )}
        {model.size_gb !== null && (
          <span className="text-xs text-muted">· {model.size_gb} GB</span>
        )}
      </div>
      <button
        onClick={onUnload}
        disabled={loading}
        className="text-xs px-3 py-1 rounded-lg border border-red-500/30 text-red-400 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Unloading…' : 'Unload'}
      </button>
    </div>
  )
}
