import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { listSkills, deleteSkill } from '@/api/client'
import type { NativeSkill, CommunitySkill, GithubSkillResult } from '@/api/client'
import { useDialog } from '@/components/shared/Dialog'
import { DiscoverTab } from '@/components/skills/DiscoverTab'
import { InstalledTab } from '@/components/skills/InstalledTab'
import { InstallModal } from '@/components/skills/InstallModal'

type Tab = 'discover' | 'installed'

// ── Discover state — lifted so it survives tab switches ────────────────────────

export interface DiscoverState {
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

export const DISCOVER_INIT: DiscoverState = {
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
