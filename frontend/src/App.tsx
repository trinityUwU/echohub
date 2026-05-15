import { useEffect, useRef, useState } from 'react'
import { ModelBrowser } from '@/components/ModelBrowser'
import { ChatPanel } from '@/components/ChatPanel'
import { LoadedModel } from '@/components/LoadedModel'
import { GpuMonitor } from '@/components/GpuMonitor'
import { LibrarySidebar } from '@/components/LibrarySidebar'
import { DownloadPanel } from '@/components/DownloadPanel'
import { LoadConfigModal } from '@/components/LoadConfigModal'
import { useModels } from '@/hooks/useModels'
import { useGpu } from '@/hooks/useGpu'
import { subscribeDownloads } from '@/api/client'
import { SettingsPage } from '@/components/SettingsPage'
import { CpuOnlyBanner } from '@/components/CpuOnlyBanner'
import type { DownloadJob, ModelInfo } from '@/types'

type Tab = 'browse' | 'chat' | 'settings'
type SidebarTab = 'nav' | 'library'

export default function App() {
  const [tab, setTab] = useState<Tab>('browse')
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('nav')
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([])
  const [pendingLoad, setPendingLoad] = useState<ModelInfo | null>(null)
  const { downloaded, loadedModel, loadingModelId, loadError, unloading, refresh, loadModel, unloadModel } = useModels()
  const gpu = useGpu()
  const notifiedComplete = useRef<Set<string>>(new Set())

  useEffect(() => {
    const unsub = subscribeDownloads((jobs) => {
      setDownloadJobs(jobs)
      const newlyComplete = jobs.filter(
        (j) => j.state === 'complete' && !notifiedComplete.current.has(j.model_id)
      )
      if (newlyComplete.length > 0) {
        newlyComplete.forEach((j) => notifiedComplete.current.add(j.model_id))
        refresh()
      }
    })
    return unsub
  }, [refresh])

  // Intercept all load requests — show config modal first (or skip if !manual)
  const requestLoad = (modelId: string, manual = true) => {
    const model = downloaded.find(m => m.id === modelId)
    if (!model) return
    if (!manual) {
      // Skip config modal — load with defaults
      loadModel(modelId)
      setTab('chat')
      return
    }
    setPendingLoad(model)
    setTab('chat')
  }

  const confirmLoad = (config: { maxModelLen: number; gpuMemoryUtilization: number }) => {
    if (!pendingLoad) return
    loadModel(pendingLoad.id, config)
    setPendingLoad(null)
  }

  const jobsMap = Object.fromEntries(downloadJobs.map((j) => [j.model_id, j]))
  const activeDownloads = downloadJobs.filter(j => j.state === 'running' || j.state === 'pending').length

  return (
    <div className="flex flex-col h-screen bg-surface-0 text-white overflow-hidden">
      <LoadedModel model={loadedModel} loading={!!loadingModelId || unloading} onUnload={unloadModel} />
      <CpuOnlyBanner />

      <div className="flex flex-1 min-h-0">
        <aside className="w-56 shrink-0 flex flex-col border-r border-border bg-surface-1">
          <div className="p-3 border-b border-border">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-5 h-5 rounded bg-accent flex items-center justify-center">
                <span className="text-xs font-bold">E</span>
              </div>
              <span className="text-sm font-semibold tracking-tight">EchoHub</span>
            </div>
            <p className="text-xs text-muted">Local LLM Manager</p>
          </div>

          <div className="flex border-b border-border">
            <button
              onClick={() => setSidebarTab('nav')}
              className={`flex-1 text-xs py-2 transition-colors ${sidebarTab === 'nav' ? 'text-white border-b border-accent' : 'text-muted hover:text-white'}`}
            >
              Menu
            </button>
            <button
              onClick={() => setSidebarTab('library')}
              className={`flex-1 text-xs py-2 transition-colors relative ${sidebarTab === 'library' ? 'text-white border-b border-accent' : 'text-muted hover:text-white'}`}
            >
              Library
              {downloaded.length > 0 && (
                <span className="absolute top-1.5 right-3 text-xs bg-surface-3 text-muted rounded-full px-1">
                  {downloaded.length}
                </span>
              )}
            </button>
          </div>

          {sidebarTab === 'nav' ? (
            <div className="flex-1 p-3 space-y-1">
              <button
                onClick={() => setTab('browse')}
                className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-colors ${tab === 'browse' ? 'bg-surface-3 text-white' : 'text-muted hover:text-white hover:bg-surface-2'}`}
              >
                Browse Models
              </button>
              <button
                onClick={() => setTab('chat')}
                className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-colors ${tab === 'chat' ? 'bg-surface-3 text-white' : 'text-muted hover:text-white hover:bg-surface-2'}`}
              >
                Chat
              </button>
              <button
                onClick={() => setTab('settings')}
                className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-colors flex items-center gap-2 ${tab === 'settings' ? 'bg-surface-3 text-white' : 'text-muted hover:text-white hover:bg-surface-2'}`}
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Settings
              </button>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-hidden">
              <LibrarySidebar
                models={downloaded}
                loadedModelId={loadedModel?.id ?? null}
                onLoad={requestLoad}
                onUnload={unloadModel}
                onDeleted={refresh}
              />
            </div>
          )}

          <div className="border-t border-border">
            <DownloadPanel onComplete={refresh} />
            {activeDownloads > 0 && (
              <div className="px-3 py-1 border-t border-border">
                <p className="text-xs text-blue-400 animate-pulse">
                  {activeDownloads} download{activeDownloads > 1 ? 's' : ''} in progress
                </p>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-border">
            <GpuMonitor />
          </div>
        </aside>

        <main className="flex-1 min-w-0 flex flex-col">
          {tab === 'browse' ? (
            <ModelBrowser
              loadedModelId={loadedModel?.id ?? null}
              onLoad={requestLoad}
              onDownloaded={refresh}
              downloadJobs={jobsMap}
            />
          ) : tab === 'settings' ? (
            <SettingsPage />
          ) : (
            <ChatPanel
              loadedModel={loadedModel}
              downloaded={downloaded}
              loadError={loadError}
              onLoad={requestLoad}
              onUnload={unloadModel}
              loadingModelId={!!loadingModelId}
            />
          )}
        </main>
      </div>

      {/* Load config modal */}
      {pendingLoad && gpu && (
        <LoadConfigModal
          model={pendingLoad}
          vramTotalGb={gpu.vram_total_mb / 1024}
          vramUsedGb={gpu.vram_used_mb / 1024}
          onConfirm={confirmLoad}
          onCancel={() => setPendingLoad(null)}
        />
      )}
    </div>
  )
}
