import { useState } from 'react'

interface CpuBannerProps {
  onGoToSettings: () => void
}

export function CpuBanner({ onGoToSettings }: CpuBannerProps): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div className="flex items-center gap-2.5 px-5 py-2 bg-yellow/[0.07] border-b border-yellow/[0.18] text-sm text-yellow flex-shrink-0">
      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>No NVIDIA GPU detected — running on CPU. Expect slower inference.</span>
      <button onClick={onGoToSettings} className="text-accent underline ml-1 cursor-pointer">Install CUDA drivers →</button>
      <div className="flex-1" />
      <button onClick={() => setDismissed(true)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-yellow/10 cursor-pointer">
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  )
}
