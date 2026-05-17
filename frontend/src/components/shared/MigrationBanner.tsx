import { useEffect, useState } from 'react'
import { getMigrationState } from '@/api/client'

interface MigrationBannerProps {
  onGoToSettings: () => void
}

export function MigrationBanner({ onGoToSettings }: MigrationBannerProps): React.ReactElement | null {
  const [pending, setPending] = useState(false)

  useEffect(() => {
    getMigrationState()
      .then(s => setPending(s.status === 'pending' || s.status === 'in_progress'))
      .catch(() => {})
  }, [])

  if (!pending) return null

  return (
    <div className="flex items-center gap-2.5 px-5 py-2 bg-accent/8 border-b border-accent/20 text-sm text-accent flex-shrink-0">
      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>A file migration is pending. Models may be in the old location until migration completes.</span>
      <button onClick={onGoToSettings}
        className="ml-1 underline cursor-pointer hover:text-accent-hover transition-colors">
        View in Settings →
      </button>
      <div className="flex-1" />
      <button onClick={() => setPending(false)}
        className="w-5 h-5 flex items-center justify-center rounded hover:bg-accent/10 cursor-pointer">
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  )
}
