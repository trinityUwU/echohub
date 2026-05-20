import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { listSkills, deleteSkill, installSkillStream, searchSkills } from '@/api/client'
import type { NativeSkill, CommunitySkill, GithubSkillResult } from '@/api/client'
import { useDialog } from '@/components/shared/Dialog'

type Tab = 'discover' | 'installed'

export function SkillsPage(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('discover')
  const [native, setNative] = useState<NativeSkill[]>([])
  const [community, setCommunity] = useState<CommunitySkill[]>([])
  const [showInstall, setShowInstall] = useState(false)
  const [installUrl, setInstallUrl] = useState('')
  const { confirm, element: dialogEl } = useDialog()

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await listSkills()
      setNative(data.native)
      setCommunity(data.community)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleDelete = async (skill: CommunitySkill): Promise<void> => {
    const ok = await confirm(`Remove "${skill.name}"?`, 'This will delete the skill files from disk. This cannot be undone.', 'Remove')
    if (!ok) return
    try { await deleteSkill(skill.id); await refresh() } catch { /* ignore */ }
  }

  const openInstallModal = (url = ''): void => {
    setInstallUrl(url)
    setShowInstall(true)
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-base">
      {dialogEl}

      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-border flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Skills</h1>
          <p className="text-sm text-text-muted mt-0.5">Extend the model's abilities with tools and integrations</p>
        </div>
        <button
          onClick={() => openInstallModal()}
          className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add by URL
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 px-8 border-b border-border flex-shrink-0">
        {([['discover', 'Discover'], ['installed', 'Installed']] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer -mb-px ${
              tab === id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {label}
            {id === 'installed' && community.length > 0 && (
              <span className="ml-1.5 text-2xs bg-elevated border border-border text-text-muted rounded px-1.5 py-0.5">{native.length + community.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'discover' && <DiscoverTab community={community} onInstall={url => openInstallModal(url)} />}
        {tab === 'installed' && <InstalledTab native={native} community={community} onDelete={handleDelete} />}
      </div>

      <AnimatePresence>
        {showInstall && (
          <InstallModal
            initialUrl={installUrl}
            onClose={() => setShowInstall(false)}
            onDone={() => { setShowInstall(false); refresh() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Discover tab ───────────────────────────────────────────────────────────────

function DiscoverTab({ community, onInstall }: { community: CommunitySkill[]; onInstall: (url: string) => void }): React.ReactElement {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GithubSkillResult[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [authenticated, setAuthenticated] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const installedUrls = new Set(community.map(c => c.repo_url))

  const doSearch = useCallback(async (q: string): Promise<void> => {
    setLoading(true)
    setError(null)
    setRateLimited(false)
    try {
      const data = await searchSkills(q)
      setResults(data.results)
      setTotal(data.total)
      setAuthenticated(data.authenticated)
      if (data.rate_limited) setRateLimited(true)
      if (data.error) setError(data.error)
      setSearched(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    }
    setLoading(false)
  }, [])

  // Auto-search on mount
  useEffect(() => { doSearch('') }, [doSearch])

  const handleInput = (val: string): void => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 400)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="px-8 py-4 border-b border-border flex-shrink-0">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-xl">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={query}
              onChange={e => handleInput(e.target.value)}
              placeholder="Search skills…"
              className="w-full bg-elevated border border-border focus:border-accent/60 rounded-md pl-9 pr-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none transition-colors"
            />
          </div>
          {loading && <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin flex-shrink-0" />}
          {!authenticated && !rateLimited && (
            <span className="text-2xs text-text-muted flex-shrink-0">
              Unauthenticated · 60 req/h
              <a href="#" className="ml-1 text-accent hover:underline" onClick={e => { e.preventDefault(); /* navigate to settings */ }}>Add token</a>
            </span>
          )}
          {authenticated && <span className="text-2xs text-text-muted flex-shrink-0">5000 req/h</span>}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-8 py-4">
        {rateLimited && (
          <div className="mb-4 px-4 py-3 bg-yellow/10 border border-yellow/30 rounded-md text-sm text-yellow">
            GitHub API rate limit reached. Add a GitHub token in Settings to increase to 5000 req/h.
          </div>
        )}
        {error && !rateLimited && (
          <div className="mb-4 px-4 py-3 bg-red/10 border border-red/30 rounded-md text-sm text-red">{error}</div>
        )}

        {searched && !loading && results.length === 0 && !error && !rateLimited && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-text-muted">
            <svg className="w-10 h-10 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span className="text-sm">No skills found{query ? ` for "${query}"` : ''}</span>
            <span className="text-xs">Skills must have the <code className="font-mono bg-elevated px-1 py-0.5 rounded">echohub-skill</code> GitHub topic</span>
          </div>
        )}

        {results.length > 0 && (
          <>
            {total > results.length && (
              <p className="text-xs text-text-muted mb-3">Showing {results.length} of {total.toLocaleString()} results</p>
            )}
            <div className="flex flex-col gap-2">
              {results.map(r => (
                <DiscoverCard
                  key={r.full_name}
                  result={r}
                  installed={installedUrls.has(r.repo_url)}
                  onInstall={() => onInstall(r.repo_url)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function DiscoverCard({ result, installed, onInstall }: { result: GithubSkillResult; installed: boolean; onInstall: () => void }): React.ReactElement {
  return (
    <div className="bg-surface border border-border rounded-lg px-4 py-3.5 flex items-center gap-4 hover:border-border-hover transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary">{result.name}</span>
          <span className="text-2xs text-text-muted font-mono">{result.full_name}</span>
          {result.language && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-elevated text-text-muted border border-border">{result.language}</span>
          )}
          {installed && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/20">installed</span>
          )}
        </div>
        {result.description && (
          <p className="text-xs text-text-muted mt-1 line-clamp-2">{result.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1.5">
          <span className="flex items-center gap-1 text-2xs text-text-muted">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            {result.stars.toLocaleString()}
          </span>
          <a
            href={result.html_url}
            target="_blank"
            rel="noreferrer"
            className="text-2xs text-text-muted hover:text-accent transition-colors"
            onClick={e => e.stopPropagation()}
          >
            View on GitHub ↗
          </a>
        </div>
      </div>
      <button
        onClick={onInstall}
        disabled={installed}
        className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-sm transition-colors cursor-pointer ${
          installed
            ? 'bg-elevated border border-border text-text-muted cursor-default'
            : 'bg-accent hover:bg-accent-hover text-white'
        }`}
      >
        {installed ? 'Installed' : 'Install'}
      </button>
    </div>
  )
}

// ── Installed tab ──────────────────────────────────────────────────────────────

function InstalledTab({ native, community, onDelete }: {
  native: NativeSkill[]; community: CommunitySkill[]; onDelete: (s: CommunitySkill) => void
}): React.ReactElement {
  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-8">
      <SkillSection title="Built-in skills" description="Shipped with EchoHub. Always available." count={native.length}>
        {native.map(s => <NativeSkillCard key={s.id} skill={s} />)}
      </SkillSection>
      <SkillSection title="Community skills" description="Installed from external repositories." count={community.length} empty="No community skills installed yet.">
        {community.map(s => <CommunitySkillCard key={s.id} skill={s} onDelete={() => onDelete(s)} />)}
      </SkillSection>
    </div>
  )
}

function SkillSection({ title, description, count, empty, children }: {
  title: string; description: string; count: number; empty?: string; children: React.ReactNode
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
        <div className="flex flex-col gap-2">{children}</div>
      )}
    </section>
  )
}

function NativeSkillCard({ skill }: { skill: NativeSkill }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <button onClick={() => setExpanded(v => !v)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-overlay/40 transition-colors cursor-pointer">
        <div className="w-8 h-8 rounded-md bg-accent-dim flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{skill.name}</span>
            <span className="text-2xs px-1.5 py-0.5 rounded bg-elevated text-text-muted border border-border">built-in</span>
          </div>
          <p className="text-xs text-text-muted mt-0.5 truncate">{skill.description}</p>
        </div>
        <svg className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
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

function CommunitySkillCard({ skill, onDelete }: { skill: CommunitySkill; onDelete: () => void }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button onClick={() => setExpanded(v => !v)} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer">
          <div className="w-8 h-8 rounded-md bg-elevated flex items-center justify-center flex-shrink-0 border border-border">
            <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{skill.name}</span>
              <span className="text-2xs text-text-muted">v{skill.version}</span>
            </div>
            <p className="text-xs text-text-muted mt-0.5 truncate">{skill.description}</p>
          </div>
          <svg className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 mr-1 ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <button onClick={onDelete} className="w-7 h-7 flex items-center justify-center rounded hover:bg-red/15 text-text-muted hover:text-red transition-colors flex-shrink-0 cursor-pointer" title="Remove">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
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

function InstallModal({ initialUrl, onClose, onDone }: { initialUrl: string; onClose: () => void; onDone: () => void }): React.ReactElement {
  const [url, setUrl] = useState(initialUrl)
  const [installing, setInstalling] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [log])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !installing) onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, installing])

  // Auto-start if URL pre-filled from Discover
  useEffect(() => {
    if (initialUrl) handleInstall(initialUrl)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleInstall = async (targetUrl = url): Promise<void> => {
    if (!targetUrl.trim() || installing) return
    setInstalling(true)
    setLog([])
    setDone(false)
    setFailed(false)

    try {
      for await (const line of installSkillStream(targetUrl.trim())) {
        if (line.startsWith('INSTALL_DONE:')) { setDone(true); setInstalling(false); return }
        if (line === 'INSTALL_FAILED') { setFailed(true); setInstalling(false); return }
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
                onClick={() => handleInstall()}
                disabled={!url.trim() || installing || done}
                className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-medium rounded-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {installing ? 'Installing…' : 'Install'}
              </button>
            </div>
            <p className="text-2xs text-text-muted">
              EchoHub installs via <span className="font-mono">package.json</span> (bun) or <span className="font-mono">pyproject.toml</span> (pip).
              Add an <span className="font-mono">"echohub"</span> key to declare tools and awareness.
            </p>
          </div>

          {(log.length > 0 || installing) && (
            <div className="flex flex-col gap-1.5 flex-1 min-h-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-secondary">Install log</span>
                {installing && <div className="w-3 h-3 border border-accent/30 border-t-accent rounded-full animate-spin" />}
                {done && <span className="text-2xs text-green font-medium">Done</span>}
                {failed && <span className="text-2xs text-red font-medium">Failed</span>}
              </div>
              <div ref={logRef} className="flex-1 min-h-[160px] max-h-[260px] bg-base border border-border rounded-sm px-3 py-2.5 overflow-y-auto font-mono text-xs text-text-secondary space-y-0.5">
                {log.map((line, i) => (
                  <div key={i} className={`leading-relaxed ${line.startsWith('ERROR') ? 'text-red' : ''}`}>{line}</div>
                ))}
                {installing && !done && !failed && <div className="text-text-muted animate-pulse">▌</div>}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-border flex justify-end">
          {done ? (
            <button onClick={onDone} className="px-4 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-sm transition-colors cursor-pointer">
              Done
            </button>
          ) : (
            <button onClick={onClose} disabled={installing} className="px-4 py-1.5 border border-border text-text-secondary hover:text-text-primary text-sm rounded-sm transition-colors cursor-pointer disabled:opacity-40">
              Cancel
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
