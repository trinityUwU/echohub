import { useEffect, useState } from 'react'
import { getHfToken, setHfToken } from '@/api/client'

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  )
}

export function SettingsPage(): JSX.Element {
  const [tokenSet, setTokenSet] = useState(false)
  const [tokenPreview, setTokenPreview] = useState('')
  const [inputValue, setInputValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedFeedback, setSavedFeedback] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    getHfToken()
      .then(({ token_set, token_preview }) => {
        setTokenSet(token_set)
        setTokenPreview(token_preview)
      })
      .catch(() => setLoadError('Failed to load token status'))
  }, [])

  const handleSave = async (): Promise<void> => {
    if (!inputValue.trim()) return
    setSaving(true)
    try {
      const res = await setHfToken(inputValue.trim())
      setTokenSet(res.token_set)
      setInputValue('')
      setSavedFeedback(true)
      setTimeout(() => setSavedFeedback(false), 2000)
      // Reload preview
      const fresh = await getHfToken()
      setTokenPreview(fresh.token_preview)
      setTokenSet(fresh.token_set)
    } catch {
      // silent — could add error state here
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (): Promise<void> => {
    setSaving(true)
    try {
      await setHfToken('')
      setTokenSet(false)
      setTokenPreview('')
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <h1 className="text-lg font-semibold text-white">Settings</h1>

      {/* HuggingFace Access */}
      <div className="border border-border rounded-2xl p-5 space-y-4 bg-surface-1">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">HuggingFace Token</h2>
          {tokenSet ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
              Token configured
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-3 text-muted border border-border font-mono">
              No token
            </span>
          )}
        </div>

        <p className="text-xs text-muted leading-relaxed">
          Required for gated models (Gemma, Llama, etc.). Get your token at{' '}
          <a
            href="https://huggingface.co/settings/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-white underline transition-colors"
          >
            huggingface.co/settings/tokens
          </a>
        </p>

        {loadError && (
          <p className="text-xs text-red-400">{loadError}</p>
        )}

        <div className="flex gap-2">
          <input
            type="password"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder={tokenSet && tokenPreview ? tokenPreview : 'hf_...'}
            className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-white placeholder-muted focus:outline-none focus:border-accent/60 font-mono"
            onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          />
          <button
            onClick={handleSave}
            disabled={saving || !inputValue.trim()}
            className="px-4 py-2 rounded-lg bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-xs font-medium shrink-0"
          >
            {savedFeedback ? 'Saved ✓' : 'Save'}
          </button>
        </div>

        {tokenSet && (
          <button
            onClick={handleRemove}
            disabled={saving}
            className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
          >
            Remove token
          </button>
        )}
      </div>

      {/* Models Directory */}
      <div className="border border-border rounded-2xl p-5 space-y-4 bg-surface-1">
        <h2 className="text-sm font-semibold text-white">Models Directory</h2>
        <div className="flex items-center gap-2 bg-surface-2 rounded-lg px-3 py-2.5">
          <FolderIcon className="w-4 h-4 text-muted shrink-0" />
          <span className="text-xs font-mono text-white/80">/mnt/models/echohub</span>
        </div>
        <p className="text-[10px] text-muted">Change in .env (MODELS_DIR)</p>
      </div>

      {/* About */}
      <div className="border border-border rounded-2xl p-5 space-y-4 bg-surface-1">
        <h2 className="text-sm font-semibold text-white">About</h2>
        <p className="text-xs text-muted">EchoHub v0.1.0 — Local LLM Manager</p>
        <p className="text-xs text-muted">MIT License — Open Source</p>
      </div>
    </div>
  )
}
