import { useEffect, useState } from 'react'
import { getHfToken, setHfToken, getGpuBackend } from '@/api/client'

interface GpuBackendInfo {
  backend: 'cuda' | 'rocm' | 'metal' | 'cpu'
  gpu_name: string | null
  cuda_available: boolean
  reason?: string
}

export function SettingsPage() {
  const [tokenInput, setTokenInput] = useState('')
  const [tokenSet, setTokenSet] = useState(false)
  const [tokenPreview, setTokenPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveFeedback, setSaveFeedback] = useState(false)
  const [gpuBackend, setGpuBackend] = useState<GpuBackendInfo | null>(null)
  const [showInstructions, setShowInstructions] = useState(false)
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    getHfToken()
      .then(res => { setTokenSet(res.token_set); setTokenPreview(res.token_preview) })
      .catch(() => {})
    getGpuBackend()
      .then(setGpuBackend)
      .catch(() => {})
  }, [])

  const handleSave = async (): Promise<void> => {
    if (!tokenInput.trim()) return
    setSaving(true)
    try {
      const res = await setHfToken(tokenInput.trim())
      setTokenSet(res.token_set)
      setTokenInput('')
      setSaveFeedback(true)
      setTimeout(() => setSaveFeedback(false), 2000)
      const info = await getHfToken()
      setTokenPreview(info.token_preview)
    } catch {
      // ignore
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
      // ignore
    } finally {
      setSaving(false)
    }
  }

  const backendColors: Record<string, string> = {
    cuda: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    cpu: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    metal: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    rocm: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  }

  return (
    <div className="max-w-xl mx-auto p-6 space-y-5 overflow-y-auto h-full">
      <div>
        <h2 className="text-2xs font-semibold uppercase tracking-widest text-muted/50 mb-2">HuggingFace Token</h2>
        <div className="bg-surface-1 rounded-xl border border-white/[0.07] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${tokenSet ? 'bg-emerald-400' : 'bg-muted/30'}`} />
            <span className={`text-xs ${tokenSet ? 'text-emerald-400' : 'text-muted/50'}`}>
              {tokenSet ? 'Token configured' : 'Not configured'}
            </span>
          </div>

          {tokenSet && tokenPreview && (
            <p className="text-2xs font-mono text-muted/40">{tokenPreview}</p>
          )}

          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showToken ? 'text' : 'password'}
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                placeholder="hf_..."
                className="bg-surface-2 w-full rounded-lg px-3 py-2 text-xs text-white border-0 focus:outline-none focus:ring-1 focus:ring-accent/30 pr-8"
              />
              <button
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted/40 hover:text-white"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !tokenInput.trim()}
              className="bg-accent rounded-lg px-4 py-2 text-sm text-white hover:bg-accent-dim disabled:opacity-40 transition-colors"
            >
              Save
            </button>
          </div>

          {tokenSet && (
            <button onClick={handleRemove} disabled={saving} className="text-2xs text-red-400/60 hover:text-red-400">
              Remove token
            </button>
          )}

          {saveFeedback && <p className="text-2xs text-emerald-400">Saved ✓</p>}
        </div>
      </div>

      <div>
        <h2 className="text-2xs font-semibold uppercase tracking-widest text-muted/50 mb-2">GPU Backend</h2>
        <div className="bg-surface-1 rounded-xl border border-white/[0.07] p-5 space-y-3">
          {gpuBackend && (
            <>
              <div className="flex items-center gap-2">
                <span className={`text-2xs font-mono px-2 py-0.5 rounded border ${backendColors[gpuBackend.backend] ?? 'bg-surface-3 text-muted/60 border-white/[0.05]'}`}>
                  {gpuBackend.backend.toUpperCase()}
                </span>
                {gpuBackend.gpu_name && (
                  <span className="text-xs text-muted/60">{gpuBackend.gpu_name}</span>
                )}
              </div>

              {gpuBackend.backend === 'cpu' && gpuBackend.gpu_name && (
                <div className="space-y-2">
                  <button
                    onClick={() => setShowInstructions(!showInstructions)}
                    className="text-2xs text-accent hover:text-accent-dim"
                  >
                    How to fix {showInstructions ? '↑' : '↓'}
                  </button>
                  {showInstructions && (
                    <div className="bg-surface-2 rounded-lg p-3 text-2xs text-muted/60 space-y-1">
                      <p>GPU detected ({gpuBackend.gpu_name}) but CUDA not available.</p>
                      <p>Install CUDA toolkit and PyTorch with CUDA support:</p>
                      <code className="block bg-surface-0 rounded px-2 py-1 font-mono">pip install torch --index-url https://download.pytorch.org/whl/cu121</code>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-2xs font-semibold uppercase tracking-widest text-muted/50 mb-2">About</h2>
        <div className="bg-surface-1 rounded-xl border border-white/[0.07] p-5 space-y-1">
          <p className="text-lg font-semibold">EchoHub <span className="text-xs text-muted/50 font-normal">v0.1.0</span></p>
          <p className="text-xs text-muted/60">Local LLM Manager — MIT License</p>
          <a href="https://github.com/trinityUwU/echohub" target="_blank" rel="noreferrer" className="text-xs text-accent hover:text-accent-dim">
            GitHub
          </a>
        </div>
      </div>
    </div>
  )
}
