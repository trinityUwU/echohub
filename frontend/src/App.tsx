import { useState, useEffect, useRef } from 'react'
import { useModels } from '@/hooks/useModels'
import { useGpu } from '@/hooks/useGpu'
import { useConversations } from '@/hooks/useConversations'
import { subscribeDownloads } from '@/api/client'
import type { DownloadJob, ModelInfo } from '@/types'
import { TopBar } from '@/components/ui/TopBar'
import { Sidebar } from '@/components/ui/Sidebar'
import { DiscoverPage } from '@/components/discover/DiscoverPage'
import { ChatView } from '@/components/chat/ChatView'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { LoadConfigModal } from '@/components/ui/LoadConfigModal'
import { CpuOnlyBanner } from '@/components/ui/CpuOnlyBanner'

type Tab = 'discover' | 'chat' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('discover')
  const [pendingLoad, setPendingLoad] = useState<ModelInfo | null>(null)
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([])
  const notifiedComplete = useRef<Set<string>>(new Set())

  const { downloaded, loadedModel, loadingModelId, loadError, unloading, refresh, loadModel, unloadModel } = useModels()
  const gpu = useGpu()
  const { conversations, activeId, activeMessages, newConversation, selectConversation, deleteConversation, renameConversation, setActiveMessages } = useConversations()

  useEffect(() => {
    const unsub = subscribeDownloads((jobs) => {
      setDownloadJobs(jobs)
      const newlyDone = jobs.filter(j => j.state === 'complete' && !notifiedComplete.current.has(j.model_id))
      if (newlyDone.length > 0) {
        newlyDone.forEach(j => notifiedComplete.current.add(j.model_id))
        refresh()
      }
    })
    return unsub
  }, [refresh])

  const requestLoad = (modelId: string, manual = true): void => {
    const model = downloaded.find(m => m.id === modelId)
    if (!model) return
    if (!manual) { loadModel(modelId); setTab('chat'); return }
    setPendingLoad(model)
    setTab('chat')
  }

  const confirmLoad = (config: { maxModelLen: number; gpuMemoryUtilization: number }): void => {
    if (!pendingLoad) return
    loadModel(pendingLoad.id, config)
    setPendingLoad(null)
  }

  const activeDownloads = downloadJobs.filter(j => j.state === 'running' || j.state === 'pending').length

  return (
    <div className="flex flex-col h-screen bg-surface-0 text-white overflow-hidden">
      <TopBar loadedModel={loadedModel} onUnload={unloadModel} loading={!!loadingModelId || unloading} />
      <CpuOnlyBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar tab={tab} setTab={setTab as (t: 'discover' | 'chat' | 'settings') => void} conversationCount={conversations.length} activeDownloads={activeDownloads} gpu={gpu} downloadJobs={downloadJobs} />
        <main className="flex-1 min-w-0 overflow-hidden">
          {tab === 'discover' && (
            <DiscoverPage
              loadedModelId={loadedModel?.id ?? null}
              onLoad={requestLoad}
              onDownloaded={refresh}
              downloadJobs={Object.fromEntries(downloadJobs.map(j => [j.model_id, j]))}
              vramTotalGb={gpu ? gpu.vram_total_mb / 1024 : 0}
              vramFreeGb={gpu ? gpu.vram_free_mb / 1024 : 0}
            />
          )}
          {tab === 'chat' && (
            <ChatView
              loadedModel={loadedModel}
              downloaded={downloaded}
              loadError={loadError}
              loadingModelId={!!loadingModelId}
              onLoad={requestLoad}
              onUnload={unloadModel}
              conversations={conversations}
              activeId={activeId}
              activeMessages={activeMessages}
              onNewConversation={newConversation}
              onSelectConversation={selectConversation}
              onDeleteConversation={deleteConversation}
              onRenameConversation={renameConversation}
              setActiveMessages={setActiveMessages}
            />
          )}
          {tab === 'settings' && <SettingsPage />}
        </main>
      </div>
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
