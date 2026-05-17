import { useEffect, useRef, useState } from 'react'
import { checkForUpdates, runUpdate, saveChangelog } from '@/api/client'

interface UpdateState {
  available: boolean
  commitsBehind: number
  changelog: string[]
  updating: boolean
  logs: Array<{ level: string; msg: string }>
  done: boolean
  success: boolean
}

export function UpdateBanner(): React.ReactElement | null {
  const [state, setState] = useState<UpdateState>({
    available: false, commitsBehind: 0, changelog: [],
    updating: false, logs: [], done: false, success: false,
  })
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const logsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Check for updates 30s after launch (non-blocking)
    const t = setTimeout(() => {
      checkForUpdates().then(r => {
        if (!r.up_to_date && r.commits_behind > 0) {
          setState(prev => ({ ...prev, available: true, commitsBehind: r.commits_behind, changelog: r.changelog }))
        }
      }).catch(() => {})
    }, 30_000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight })
  }, [state.logs])

  const update = (): void => {
    setState(prev => ({ ...prev, updating: true, logs: [] }))
    setExpanded(true)
    runUpdate(
      line => setState(prev => ({ ...prev, logs: [...prev.logs, line] })),
      result => {
        setState(prev => ({ ...prev, updating: false, done: true, success: result.success }))
        if (result.success) {
          saveChangelog(state.changelog).catch(() => {})
        }
      }
    )
  }

  const restart = (): void => {
    // Tauri: reload the webview — in prod this triggers the new build
    window.location.reload()
  }

  if (!state.available || dismissed) return null

  return (
    <div className="flex-shrink-0 border-b border-accent/20 bg-accent/5">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
          <svg className="w-3.5 h-3.5 text-accent flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.01"/>
          </svg>
          <span className="text-accent font-medium">Update available</span>
          <span className="text-text-muted text-xs">{state.commitsBehind} new commit{state.commitsBehind > 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!state.done && !state.updating && (
            <>
              <button onClick={() => setExpanded(v => !v)}
                className="text-xs text-text-muted hover:text-text-secondary cursor-pointer transition-colors">
                {expanded ? 'Hide' : 'What\'s new'}
              </button>
              <button onClick={update}
                className="text-xs px-3 py-1 bg-accent hover:bg-accent-hover text-white rounded-sm cursor-pointer transition-colors font-medium">
                Update now
              </button>
            </>
          )}
          {state.updating && (
            <div className="flex items-center gap-1.5 text-xs text-accent">
              <span className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              Updating…
            </div>
          )}
          {state.done && state.success && (
            <button onClick={restart}
              className="text-xs px-3 py-1 bg-green/15 hover:bg-green/25 text-green border border-green/30 rounded-sm cursor-pointer transition-colors font-medium">
              Restart now →
            </button>
          )}
          {!state.updating && !state.done && (
            <button onClick={() => setDismissed(true)}
              className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-secondary cursor-pointer transition-colors">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Changelog / logs */}
      {expanded && (
        <div className="px-4 pb-3">
          {!state.updating && state.changelog.length > 0 && (
            <div className="text-xs text-text-muted flex flex-col gap-0.5 mb-2">
              {state.changelog.slice(0, 8).map((line, i) => (
                <div key={i} className="font-mono">{line}</div>
              ))}
            </div>
          )}
          {(state.updating || state.done) && state.logs.length > 0 && (
            <div ref={logsRef}
              className="bg-[#0a0a0d] border border-border rounded-sm p-2.5 font-mono text-xs leading-relaxed max-h-32 overflow-y-auto">
              {state.logs.map((line, i) => (
                <div key={i} className={
                  line.level === 'ok' ? 'text-green' :
                  line.level === 'error' ? 'text-red' :
                  line.level === 'step' ? 'text-accent font-semibold' :
                  'text-[#6b7280]'
                }>{line.level === 'step' ? `▶ ${line.msg}` : line.msg}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
