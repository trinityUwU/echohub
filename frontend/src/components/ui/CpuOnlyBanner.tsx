import { useEffect, useState } from 'react'
import { getGpuBackend } from '@/api/client'

export function CpuOnlyBanner() {
  const [backend, setBackend] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    getGpuBackend()
      .then(res => setBackend(res.backend))
      .catch(() => {})
  }, [])

  if (dismissed || backend !== 'cpu') return null

  return (
    <div className="mx-4 my-1 border-l-2 border-amber-500/40 bg-amber-500/[0.04] rounded-r-lg px-4 py-2.5 flex items-start gap-3">
      <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
      <div className="flex-1">
        <p className="text-xs text-amber-300/80">Running in CPU-only mode. GPU acceleration unavailable.</p>
      </div>
      <button onClick={() => setDismissed(true)} className="text-muted/40 hover:text-white text-xs">
        ✕
      </button>
    </div>
  )
}
