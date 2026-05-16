import type { DownloadJob, GpuStats } from '@/types'
import { GpuMonitor } from '@/components/ui/GpuMonitor'

interface Props {
  tab: string
  setTab: (t: 'discover' | 'chat' | 'settings') => void
  conversationCount: number
  activeDownloads: number
  gpu: GpuStats | null
  downloadJobs: DownloadJob[]
}

const NAV: { id: 'discover' | 'chat' | 'settings'; label: string }[] = [
  { id: 'discover', label: 'Discover' },
  { id: 'chat', label: 'Chat' },
  { id: 'settings', label: 'Settings' },
]

export function Sidebar({ tab, setTab, conversationCount, gpu, downloadJobs }: Props) {
  const activeJob = downloadJobs.find(j => j.state === 'running')

  return (
    <aside
      className="w-[200px] shrink-0 flex flex-col z-10"
      style={{
        background: 'rgba(6, 9, 18, 0.60)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRight: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <nav className="flex-1 p-2.5 pt-3 space-y-0.5">
        {NAV.map(item => {
          const isActive = tab === item.id
          const badge = item.id === 'chat' && conversationCount > 0 && !isActive ? conversationCount : null

          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className="w-full text-left flex items-center rounded-lg transition-colors"
              style={isActive ? {
                background: 'rgba(74,158,191,0.09)',
                borderLeft: '2px solid #4A9EBF',
                padding: '7px 12px 7px 14px',
                color: 'rgba(255,255,255,0.88)',
                fontSize: '13px',
                fontWeight: 500,
              } : {
                padding: '7px 12px 7px 16px',
                color: 'rgba(255,255,255,0.32)',
                fontSize: '13px',
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.65)' }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.32)' }}
            >
              <span className="flex-1">{item.label}</span>
              {badge && (
                <span className="text-[10px] font-mono rounded-full px-1.5 min-w-[18px] text-center"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.28)' }}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="p-3 space-y-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        {activeJob && (
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-[10px] text-white/28 truncate max-w-[120px]">
                {activeJob.model_id.split('/').pop()?.slice(0, 16)}
              </span>
              <span className="text-[10px] font-mono text-white/22">
                {activeJob.progress != null ? `${Math.round(activeJob.progress * 100)}%` : '…'}
              </span>
            </div>
            <div className="h-px rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${(activeJob.progress ?? 0) * 100}%`, background: 'rgba(74,158,191,0.55)' }} />
            </div>
          </div>
        )}
        <GpuMonitor gpu={gpu} />
      </div>
    </aside>
  )
}
