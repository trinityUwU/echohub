import { useEffect, useState } from 'react'
import { getPendingChangelog, clearChangelog } from '@/api/client'

export function ChangelogNotification(): React.ReactElement | null {
  const [changelog, setChangelog] = useState<string[]>([])
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    getPendingChangelog().then(r => {
      if (r.changelog.length > 0) {
        setChangelog(r.changelog)
        setVisible(true)
      }
    }).catch(() => {})
  }, [])

  const dismiss = (): void => {
    clearChangelog().catch(() => {})
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[400] flex items-end justify-center pb-6 pointer-events-none">
      <div className="bg-surface border border-border-hover rounded-lg shadow-[0_24px_60px_rgba(0,0,0,0.5)] w-[420px] pointer-events-auto animate-slide-up">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border">
          <div className="w-7 h-7 bg-accent/15 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-text-primary">EchoHub updated</div>
            <div className="text-xs text-text-muted">Here's what changed in this version</div>
          </div>
          <button onClick={dismiss}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-secondary cursor-pointer transition-colors">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="px-4 py-3 flex flex-col gap-1">
          {changelog.slice(0, 10).map((line, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="text-accent mt-0.5 flex-shrink-0">·</span>
              <span className="text-text-secondary font-mono leading-relaxed">{line}</span>
            </div>
          ))}
          {changelog.length > 10 && (
            <div className="text-xs text-text-muted mt-1">+{changelog.length - 10} more commits</div>
          )}
        </div>
        <div className="px-4 pb-4">
          <button onClick={dismiss}
            className="w-full py-2 text-xs text-text-muted hover:text-text-secondary cursor-pointer transition-colors text-center border border-border rounded-sm hover:bg-overlay">
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
