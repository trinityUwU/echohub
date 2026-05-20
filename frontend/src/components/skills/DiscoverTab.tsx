import { useCallback, useEffect, useRef, useState } from 'react'
import { searchSkills } from '@/api/client'
import type { CommunitySkill, GithubSkillResult } from '@/api/client'
import type { DiscoverState } from '@/components/skills/SkillsPage'

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

// ── Discover card ──────────────────────────────────────────────────────────────

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

// ── Discover tab ───────────────────────────────────────────────────────────────

export function DiscoverTab({ community, state, onStateChange, onInstall, onGoToSettings }: {
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
