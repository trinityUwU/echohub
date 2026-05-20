import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { installSkillStream } from '@/api/client'

export function InstallModal({ initialUrl, onClose, onDone }: { initialUrl: string; onClose: () => void; onDone: () => void }): React.ReactElement {
  const [url, setUrl] = useState(initialUrl)
  const [installing, setInstalling] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef(false)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [log])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (initialUrl) handleInstall(initialUrl)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = (): void => {
    if (installing) {
      abortRef.current = true
      setInstalling(false)
    }
    onClose()
  }

  const handleInstall = async (targetUrl = url): Promise<void> => {
    if (!targetUrl.trim() || installing) return
    setInstalling(true)
    setLog([])
    setDone(false)
    setFailed(false)
    abortRef.current = false

    try {
      for await (const line of installSkillStream(targetUrl.trim())) {
        if (abortRef.current) break
        if (line.startsWith('INSTALL_DONE:')) { setDone(true); setInstalling(false); return }
        if (line === 'INSTALL_FAILED') { setFailed(true); setInstalling(false); return }
        setLog(prev => [...prev, line])
      }
    } catch (e) {
      if (!abortRef.current) {
        setLog(prev => [...prev, `Error: ${e instanceof Error ? e.message : String(e)}`])
        setFailed(true)
      }
      setInstalling(false)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <motion.div
        className="bg-surface border border-border-hover rounded-lg w-[560px] max-h-[80vh] flex flex-col shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }} transition={{ duration: 0.15 }}
      >
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
          <h2 className="flex-1 text-md font-semibold text-text-primary">Install skill</h2>
          <button onClick={handleClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-secondary transition-colors cursor-pointer">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 flex-1 overflow-hidden">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">Repository URL</label>
            <div className="flex gap-2">
              <input
                type="text" value={url} onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleInstall() }}
                placeholder="https://github.com/user/my-skill"
                disabled={installing || done}
                className="flex-1 bg-elevated border border-border focus:border-accent/60 rounded-sm px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none transition-colors font-mono disabled:opacity-50"
              />
              <button
                onClick={() => handleInstall()} disabled={!url.trim() || installing || done}
                className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-medium rounded-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {installing ? 'Installing…' : 'Install'}
              </button>
            </div>
            <p className="text-2xs text-text-muted">
              Installed via <span className="font-mono">package.json</span> (bun) or <span className="font-mono">pyproject.toml</span> (pip).
              Add an <span className="font-mono">"echohub"</span> key to declare tools and awareness.
            </p>
          </div>

          {(log.length > 0 || installing) && (
            <div className="flex flex-col gap-1.5 flex-1 min-h-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-secondary">Install log</span>
                {installing && <div className="w-3 h-3 border border-accent/30 border-t-accent rounded-full animate-spin" />}
                {done && <span className="text-2xs text-green font-medium">Done ✓</span>}
                {failed && <span className="text-2xs text-red font-medium">Failed</span>}
              </div>
              <div ref={logRef} className="flex-1 min-h-[160px] max-h-[260px] bg-base border border-border rounded-sm px-3 py-2.5 overflow-y-auto font-mono text-xs text-text-secondary space-y-0.5">
                {log.map((line, i) => (
                  <div key={i} className={`leading-relaxed ${line.startsWith('ERROR') ? 'text-red' : line.startsWith('✓') ? 'text-green' : ''}`}>{line}</div>
                ))}
                {installing && !done && !failed && <div className="text-text-muted animate-pulse">▌</div>}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-border flex justify-end gap-2">
          {done ? (
            <button onClick={onDone} className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-sm transition-colors cursor-pointer">
              Done
            </button>
          ) : (
            <>
              {installing && (
                <button onClick={handleClose} className="px-4 py-1.5 border border-red/40 text-red hover:bg-red/10 text-sm rounded-sm transition-colors cursor-pointer">
                  Cancel
                </button>
              )}
              <button onClick={handleClose} className="px-4 py-1.5 border border-border text-text-secondary hover:text-text-primary text-sm rounded-sm transition-colors cursor-pointer">
                {installing ? 'Close' : 'Cancel'}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
