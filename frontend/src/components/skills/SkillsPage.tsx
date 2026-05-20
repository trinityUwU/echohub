import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { listSkills, deleteSkill, patchSkill, analyzeSkill, installSkillStream, searchSkills } from '@/api/client'
import type { NativeSkill, CommunitySkill, GithubSkillResult } from '@/api/client'
import { useDialog } from '@/components/shared/Dialog'

type Tab = 'discover' | 'installed'

// ── Discover state — lifted so it survives tab switches ────────────────────────

interface DiscoverState {
  query: string
  results: GithubSkillResult[]
  total: number
  loading: boolean
  searched: boolean
  fromCache: boolean
  cacheAgeH: number | null
  authenticated: boolean
  rateLimited: boolean
  rlRemaining: number | null
  rlLimit: number | null
  rlResetTs: number | null
  error: string | null
}

const DISCOVER_INIT: DiscoverState = {
  query: '', results: [], total: 0, loading: false, searched: false,
  fromCache: false, cacheAgeH: null, authenticated: false, rateLimited: false,
  rlRemaining: null, rlLimit: null, rlResetTs: null, error: null,
}

// ── SkillsPage ─────────────────────────────────────────────────────────────────

export function SkillsPage({ onGoToSettings }: { onGoToSettings?: () => void }): React.ReactElement {
  const [tab, setTab] = useState<Tab>('discover')
  const [native, setNative] = useState<NativeSkill[]>([])
  const [community, setCommunity] = useState<CommunitySkill[]>([])
  const [showInstall, setShowInstall] = useState(false)
  const [installUrl, setInstallUrl] = useState('')
  const [discover, setDiscover] = useState<DiscoverState>(DISCOVER_INIT)
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

      <div className="flex gap-0 px-8 border-b border-border flex-shrink-0">
        {(['discover', 'installed'] as Tab[]).map(id => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer -mb-px capitalize ${
              tab === id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {id}
            {id === 'installed' && community.length > 0 && (
              <span className="ml-1.5 text-2xs bg-elevated border border-border text-text-muted rounded px-1.5 py-0.5">{native.length + community.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Both tabs always mounted so state is preserved */}
      <div className={`flex-1 overflow-hidden ${tab === 'discover' ? '' : 'hidden'}`}>
        <DiscoverTab
          community={community}
          state={discover}
          onStateChange={setDiscover}
          onInstall={url => openInstallModal(url)}
          onGoToSettings={onGoToSettings}
        />
      </div>
      <div className={`flex-1 overflow-hidden ${tab === 'installed' ? '' : 'hidden'}`}>
        <InstalledTab native={native} community={community} onDelete={handleDelete} onRefresh={refresh} />
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

function DiscoverTab({ community, state, onStateChange, onInstall, onGoToSettings }: {
  community: CommunitySkill[]
  state: DiscoverState
  onStateChange: React.Dispatch<React.SetStateAction<DiscoverState>>
  onInstall: (url: string) => void
  onGoToSettings?: () => void
}): React.ReactElement {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const installedUrls = new Set(community.map(c => c.repo_url))

  const doSearch = useCallback(async (q: string, force = false): Promise<void> => {
    onStateChange(prev => ({ ...prev, loading: true, error: null, rateLimited: false, fromCache: false }))
    try {
      const data = await searchSkills(q, force)
      onStateChange({
        query: q,
        results: data.results,
        total: data.total,
        loading: false,
        searched: true,
        fromCache: data.from_cache ?? false,
        cacheAgeH: data.cache_age_h ?? null,
        authenticated: data.authenticated,
        rateLimited: data.rate_limited ?? false,
        rlRemaining: data.rl_remaining ?? null,
        rlLimit: data.rl_limit ?? null,
        rlResetTs: data.rl_reset ?? null,
        error: data.error ?? null,
      })
    } catch (e) {
      onStateChange(prev => ({ ...prev, loading: false, error: e instanceof Error ? e.message : 'Search failed' }))
    }
  }, [onStateChange])

  // Auto-search once on first mount
  const didMount = useRef(false)
  useEffect(() => {
    if (!didMount.current && !state.searched) {
      didMount.current = true
      doSearch('')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = (val: string): void => {
    onStateChange(prev => ({ ...prev, query: val }))
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 400)
  }

  const { results, query, loading, searched, fromCache, cacheAgeH, authenticated,
    rateLimited, rlRemaining, rlLimit, rlResetTs, error, total } = state

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-8 py-4 border-b border-border flex-shrink-0">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1 max-w-xl">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text" value={query} onChange={e => handleInput(e.target.value)}
              placeholder="Search MCP servers and LLM tools…"
              className="w-full bg-elevated border border-border focus:border-accent/60 rounded-md pl-9 pr-3 py-2 text-sm text-text-primary placeholder-text-muted outline-none transition-colors"
            />
          </div>
          {loading
            ? <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin flex-shrink-0" />
            : (
              <button onClick={() => doSearch(query, true)} title="Refresh from GitHub"
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-secondary transition-colors cursor-pointer flex-shrink-0">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
            )
          }
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            {fromCache && cacheAgeH !== null && (
              <span className="text-2xs text-text-muted">Cached · {cacheAgeH < 1 ? '<1h' : `${cacheAgeH}h`} ago</span>
            )}
            <RateLimitBadge
              remaining={rlRemaining} limit={rlLimit} resetTs={rlResetTs}
              authenticated={authenticated} onGoToSettings={onGoToSettings}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        {rateLimited && (
          <div className="mb-4 px-4 py-3 bg-yellow/10 border border-yellow/30 rounded-md text-sm text-yellow flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span>GitHub rate limit reached. {results.length > 0 ? 'Showing cached results.' : ''} Add a GitHub token in Settings to increase to 30 req/min.</span>
          </div>
        )}
        {error && !rateLimited && (
          <div className="mb-4 px-4 py-3 bg-surface border border-border rounded-md text-sm text-text-muted">
            {error}{results.length > 0 ? ' — showing cached results' : ''}
          </div>
        )}
        {searched && !loading && results.length === 0 && !error && !rateLimited && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-text-muted">
            <svg className="w-10 h-10 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span className="text-sm">No results{query ? ` for "${query}"` : ''}</span>
          </div>
        )}
        {results.length > 0 && (
          <>
            <p className="text-xs text-text-muted mb-3">
              {total > results.length ? `${results.length} of ${total.toLocaleString()} results` : `${results.length} result${results.length !== 1 ? 's' : ''}`}
              {fromCache ? ' · cached' : ''}
            </p>
            <div className="flex flex-col gap-2">
              {results.map(r => (
                <DiscoverCard key={r.full_name} result={r} installed={installedUrls.has(r.repo_url)} onInstall={() => onInstall(r.repo_url)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Rate limit badge ───────────────────────────────────────────────────────────

function RateLimitBadge({ remaining, limit, resetTs, authenticated, onGoToSettings }: {
  remaining: number | null; limit: number | null; resetTs: number | null
  authenticated: boolean; onGoToSettings?: () => void
}): React.ReactElement {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])

  const resetIn = resetTs ? Math.max(0, Math.ceil((resetTs * 1000 - now) / 60_000)) : null
  const pct = remaining !== null && limit ? Math.round((remaining / limit) * 100) : null
  const color = pct === null ? 'text-text-muted' : pct > 30 ? 'text-text-muted' : pct > 10 ? 'text-yellow' : 'text-red'

  return (
    <span className={`text-2xs ${color} flex items-center gap-1`}>
      {remaining !== null && limit !== null
        ? <>{remaining}/{limit} req remaining{resetIn !== null && remaining < limit / 2 ? ` · resets in ${resetIn}m` : ''}</>
        : authenticated ? '30 req/min' : '10 req/min'
      }
      {!authenticated && (
        <> · <button onClick={onGoToSettings} className="text-accent hover:underline cursor-pointer">Add token</button></>
      )}
    </span>
  )
}

// ── Installed tab ──────────────────────────────────────────────────────────────

function InstalledTab({ native, community, onDelete, onRefresh }: {
  native: NativeSkill[]; community: CommunitySkill[]; onDelete: (s: CommunitySkill) => void; onRefresh: () => void
}): React.ReactElement {
  return (
    <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-8 h-full">
      <SkillSection title="Built-in skills" description="Shipped with EchoHub. Always available." count={native.length}>
        {native.map(s => <NativeSkillCard key={s.id} skill={s} />)}
      </SkillSection>
      <SkillSection title="Community skills" description="Installed from external repositories." count={community.length} empty="No community skills installed yet.">
        {community.map(s => <CommunitySkillCard key={s.id} skill={s} onDelete={() => onDelete(s)} onRefresh={onRefresh} />)}
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
      {count === 0 && empty ? <p className="text-sm text-text-muted italic py-3">{empty}</p> : <div className="flex flex-col gap-2">{children}</div>}
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

function CommunitySkillCard({ skill, onDelete, onRefresh }: { skill: CommunitySkill; onDelete: () => void; onRefresh: () => void }): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [tools, setTools] = useState(skill.tools.join(', '))
  const [awareness, setAwareness] = useState(skill.awareness)
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const hasTools = skill.tools.length > 0

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const toolList = tools.split(',').map(t => t.trim()).filter(Boolean)
      await patchSkill(skill.id, { tools: toolList, awareness })
      onRefresh()
      setEditing(false)
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleAnalyze = async (): Promise<void> => {
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      const result = await analyzeSkill(skill.id)
      setTools(result.suggested_tools.join(', '))
      setAwareness(result.suggested_awareness)
      setEditing(true)
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : 'Analysis failed')
    }
    setAnalyzing(false)
  }

  return (
    <div className={`bg-surface border rounded-lg overflow-hidden transition-colors ${!hasTools ? 'border-yellow/30' : 'border-border'}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button onClick={() => setExpanded(v => !v)} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer">
          <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border ${!hasTools ? 'bg-yellow/10 border-yellow/30' : 'bg-elevated border-border'}`}>
            {!hasTools
              ? <svg className="w-4 h-4 text-yellow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              : <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{skill.name}</span>
              <span className="text-2xs text-text-muted">v{skill.version}</span>
              {!hasTools && <span className="text-2xs text-yellow px-1.5 py-0.5 rounded bg-yellow/10 border border-yellow/30">Setup required</span>}
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

              {/* Tools & Awareness editor */}
              {!editing ? (
                <>
                  {hasTools
                    ? <DetailRow label="Tools" value={skill.tools.join(', ')} mono />
                    : (
                      <div className="flex flex-col gap-1">
                        <span className="text-2xs text-text-muted uppercase tracking-wider">Tools</span>
                        <p className="text-xs text-yellow">No tools declared — configure below so the model can use this skill.</p>
                      </div>
                    )
                  }
                  {skill.awareness && <DetailRow label="Awareness" value={skill.awareness} />}
                  {analyzeError && (
                    <p className="text-xs text-red">{analyzeError}</p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={handleAnalyze}
                      disabled={analyzing}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-white transition-colors cursor-pointer"
                    >
                      {analyzing ? (
                        <><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />Analyzing…</>
                      ) : (
                        <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 8v4l3 3"/></svg>Auto-configure with AI</>
                      )}
                    </button>
                    <button
                      onClick={() => setEditing(true)}
                      className="text-xs px-3 py-1.5 rounded-sm border border-border text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                    >
                      {hasTools ? 'Edit manually' : 'Configure manually'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-2xs text-text-muted uppercase tracking-wider">Tools (comma-separated tool names)</label>
                    <input
                      type="text"
                      value={tools}
                      onChange={e => setTools(e.target.value)}
                      placeholder="tool_name_1, tool_name_2"
                      className="bg-base border border-border focus:border-accent/60 rounded-sm px-2.5 py-1.5 text-xs font-mono text-text-primary placeholder-text-muted outline-none transition-colors"
                    />
                    <p className="text-2xs text-text-muted">Tool names exposed by this skill to the model. Must match what the skill actually registers.</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-2xs text-text-muted uppercase tracking-wider">Awareness block (≤100 tokens)</label>
                    <textarea
                      value={awareness}
                      onChange={e => setAwareness(e.target.value)}
                      rows={3}
                      placeholder="Describe how the model should use this skill's tools..."
                      className="bg-base border border-border focus:border-accent/60 rounded-sm px-2.5 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none resize-none transition-colors"
                    />
                    <p className="text-2xs text-text-muted">Injected into the system prompt when this skill is active. Keep concise.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="text-xs px-3 py-1.5 rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-white transition-colors cursor-pointer"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setEditing(false); setTools(skill.tools.join(', ')); setAwareness(skill.awareness) }}
                      className="text-xs px-3 py-1.5 rounded-sm border border-border text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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

function DiscoverCard({ result, installed, onInstall }: { result: GithubSkillResult; installed: boolean; onInstall: () => void }): React.ReactElement {
  return (
    <div className="bg-surface border border-border rounded-lg px-4 py-3.5 flex items-center gap-4 hover:border-border-hover transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary">{result.name}</span>
          <span className="text-2xs text-text-muted font-mono">{result.full_name}</span>
          {result.language && <span className="text-2xs px-1.5 py-0.5 rounded bg-elevated text-text-muted border border-border">{result.language}</span>}
          {installed && <span className="text-2xs px-1.5 py-0.5 rounded bg-green/10 text-green border border-green/20">installed</span>}
        </div>
        {result.description && <p className="text-xs text-text-muted mt-1 line-clamp-2">{result.description}</p>}
        <div className="flex items-center gap-3 mt-1.5">
          <span className="flex items-center gap-1 text-2xs text-text-muted">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            {result.stars.toLocaleString()}
          </span>
          <a href={result.html_url} target="_blank" rel="noreferrer" className="text-2xs text-text-muted hover:text-accent transition-colors" onClick={e => e.stopPropagation()}>
            View on GitHub ↗
          </a>
        </div>
      </div>
      <button
        onClick={onInstall} disabled={installed}
        className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-sm transition-colors cursor-pointer ${
          installed ? 'bg-elevated border border-border text-text-muted cursor-default' : 'bg-accent hover:bg-accent-hover text-white'
        }`}
      >
        {installed ? 'Installed' : 'Install'}
      </button>
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
  const abortRef = useRef(false)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [log])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-start if URL pre-filled from Discover
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
