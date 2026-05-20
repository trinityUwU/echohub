import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { listSkills, deleteSkill, installSkillStream } from '@/api/client'
import type { NativeSkill, CommunitySkill } from '@/api/client'
import { useDialog } from '@/components/shared/Dialog'

export function SkillsPage(): React.ReactElement {
  const [native, setNative] = useState<NativeSkill[]>([])
  const [community, setCommunity] = useState<CommunitySkill[]>([])
  const [loading, setLoading] = useState(true)
  const [showInstall, setShowInstall] = useState(false)
  const { confirm, element: dialogEl } = useDialog()

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await listSkills()
      setNative(data.native)
      setCommunity(data.community)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleDelete = async (skill: CommunitySkill): Promise<void> => {
    const ok = await confirm(
      `Remove "${skill.name}"?`,
      'This will delete the skill files from disk. This cannot be undone.',
      'Remove',
    )
    if (!ok) return
    try {
      await deleteSkill(skill.id)
      await refresh()
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-base">
      {dialogEl}
      <div className="flex items-center justify-between px-8 py-5 border-b border-border flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Skills</h1>
          <p className="text-sm text-text-muted mt-0.5">Extend the model's abilities with tools and integrations</p>
        </div>
        <button
          onClick={() => setShowInstall(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Install skill
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-8">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <SkillSection
              title="Built-in skills"
              description="Native skills shipped with EchoHub. Always available, cannot be removed."
              count={native.length}
            >
              {native.map(s => <NativeSkillCard key={s.id} skill={s} />)}
            </SkillSection>

            <SkillSection
              title="Community skills"
              description="Installed from external repositories."
              count={community.length}
              empty="No community skills installed yet."
            >
              {community.map(s => (
                <CommunitySkillCard key={s.id} skill={s} onDelete={() => handleDelete(s)} />
              ))}
            </SkillSection>
          </>
        )}
      </div>

      <AnimatePresence>
        {showInstall && (
          <InstallModal onClose={() => setShowInstall(false)} onDone={() => { setShowInstall(false); refresh() }} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function SkillSection({ title, description, count, empty, children }: {
  title: string; description: string; count: number
  empty?: string; children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <span className="text-xs text-text-muted">{count}</span>
      </div>
      <p className="text-xs text-text-muted -mt-1">{description}</p>
      {count === 0 && empty ? (
        <p className="text-sm text-text-muted italic py-3">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {children}
        </div>
      )}
    </section>
  )
}

// ── Native skill card ──────────────────────────────────────────────────────────

function NativeSkillCard({ skill }: { skill: NativeSkill }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-overlay/40 transition-colors cursor-pointer"
      >
        <div className="w-8 h-8 rounded-md bg-accent-dim flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{skill.name}</span>
            <span className="text-2xs px-1.5 py-0.5 rounded bg-elevated text-text-muted border border-border">built-in</span>
          </div>
          <p className="text-xs text-text-muted mt-0.5 truncate">{skill.description}</p>
        </div>
        <svg
          className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.18 }} className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-border flex flex-col gap-3">
              <DetailRow label="Author" value={skill.author} />
              <DetailRow label="Version" value={skill.version} />
              <DetailRow label="Storage" value={skill.storage} mono />
              <DetailRow label="Tools" value={skill.tools.join(', ')} mono />
              {skill.awareness && <DetailRow label="Awareness" value={skill.awareness} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Community skill card ───────────────────────────────────────────────────────

function CommunitySkillCard({ skill, onDelete }: { skill: CommunitySkill; onDelete: () => void }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-md bg-elevated flex items-center justify-center flex-shrink-0 border border-border">
            <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{skill.name}</span>
              <span className="text-2xs text-text-muted">v{skill.version}</span>
            </div>
            <p className="text-xs text-text-muted mt-0.5 truncate">{skill.description}</p>
          </div>
          <svg
            className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-red/15 text-text-muted hover:text-red transition-colors flex-shrink-0 cursor-pointer"
          title="Remove skill"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            transition={{ duration: 0.18 }} className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-border flex flex-col gap-3">
              <DetailRow label="Author" value={skill.author} />
              <DetailRow label="Repository" value={skill.repo_url} mono />
              <DetailRow label="Path" value={skill.path} mono />
              {skill.tools.length > 0 && <DetailRow label="Tools" value={skill.tools.join(', ')} mono />}
              {skill.awareness && <DetailRow label="Awareness" value={skill.awareness} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs text-text-muted uppercase tracking-wider">{label}</span>
      <span className={`text-xs text-text-secondary break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

// ── Install modal ──────────────────────────────────────────────────────────────

function InstallModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }): React.ReactElement {
  const [url, setUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<boolean>(false)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [log])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !installing) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, installing])

  const handleInstall = async (): Promise<void> => {
    if (!url.trim() || installing) return
    setInstalling(true)
    setLog([])
    setDone(false)
    setFailed(false)
    abortRef.current = false

    try {
      for await (const line of installSkillStream(url.trim())) {
        if (abortRef.current) break
        if (line.startsWith('INSTALL_DONE:')) {
          setDone(true)
          setInstalling(false)
          return
        }
        if (line === 'INSTALL_FAILED') {
          setFailed(true)
          setInstalling(false)
          return
        }
        setLog(prev => [...prev, line])
      }
    } catch (e) {
      setLog(prev => [...prev, `Error: ${e instanceof Error ? e.message : String(e)}`])
      setFailed(true)
      setInstalling(false)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={e => { if (e.target === e.currentTarget && !installing) onClose() }}
    >
      <motion.div
        className="bg-surface border border-border-hover rounded-lg w-[560px] max-h-[80vh] flex flex-col shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }} transition={{ duration: 0.15 }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
          <h2 className="flex-1 text-md font-semibold text-text-primary">Install skill</h2>
          {!installing && (
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-secondary transition-colors cursor-pointer">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4 flex-1 overflow-hidden">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">GitHub / Git repository URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleInstall() }}
                placeholder="https://github.com/user/my-skill"
                disabled={installing || done}
                className="flex-1 bg-elevated border border-border focus:border-accent/60 rounded-sm px-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none transition-colors font-mono disabled:opacity-50"
              />
              <button
                onClick={handleInstall}
                disabled={!url.trim() || installing || done}
                className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-medium rounded-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {installing ? 'Installing…' : 'Install'}
              </button>
            </div>
            <p className="text-2xs text-text-muted">
              EchoHub will clone the repo, detect install commands, and register the skill automatically.
              Skills can declare install instructions via <span className="font-mono">echohub.yml</span>.
            </p>
          </div>

          {/* Log */}
          {(log.length > 0 || installing) && (
            <div className="flex flex-col gap-1.5 flex-1 min-h-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-secondary">Install log</span>
                {installing && <div className="w-3 h-3 border border-accent/30 border-t-accent rounded-full animate-spin" />}
                {done && <span className="text-2xs text-green font-medium">Done</span>}
                {failed && <span className="text-2xs text-red font-medium">Failed</span>}
              </div>
              <div
                ref={logRef}
                className="flex-1 min-h-[160px] max-h-[260px] bg-base border border-border rounded-sm px-3 py-2.5 overflow-y-auto font-mono text-xs text-text-secondary space-y-0.5"
              >
                {log.map((line, i) => (
                  <div key={i} className={`leading-relaxed ${line.startsWith('ERROR') ? 'text-red' : ''}`}>{line}</div>
                ))}
                {installing && !done && !failed && (
                  <div className="text-text-muted animate-pulse">▌</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border flex justify-end gap-2">
          {done ? (
            <button
              onClick={onDone}
              className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-sm transition-colors cursor-pointer"
            >
              Done
            </button>
          ) : (
            <button
              onClick={onClose}
              disabled={installing}
              className="px-4 py-1.5 border border-border text-text-secondary hover:text-text-primary text-sm rounded-sm transition-colors cursor-pointer disabled:opacity-40"
            >
              Cancel
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
