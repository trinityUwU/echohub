import { useEffect, useRef, useState, useCallback } from 'react'
import { useModels } from '@/hooks/useModels'
import { useGpu } from '@/hooks/useGpu'
import { useConversations } from '@/hooks/useConversations'
import { subscribeDownloads, cancelDownload, deleteModel, listFinetunedModels, deleteFinetunedModel } from '@/api/client'
import type { DownloadJob, FinetunedModel, ModelInfo, LoadConfig } from '@/types'
import { NavRail } from '@/components/nav/NavRail'
import { ChatPage } from '@/components/chat/ChatPage'
import { LibraryPage } from '@/components/library/LibraryPage'
import { DiscoverPage } from '@/components/discover/DiscoverPage'
import { DownloadsPage } from '@/components/downloads/DownloadsPage'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { FineTunePage } from '@/components/finetune/FineTunePage'
import { SkillsPage } from '@/components/skills/SkillsPage'
import { LoadModelModal } from '@/components/modals/LoadModelModal'
import { ModelPickerModal } from '@/components/modals/ModelPickerModal'
import { useDialog } from '@/components/shared/Dialog'
import { UpdateBanner } from '@/components/shared/UpdateBanner'
import { ChangelogNotification } from '@/components/shared/ChangelogNotification'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import { getOnboardingStatus } from '@/api/client'

type Page = 'chat' | 'library' | 'discover' | 'downloads' | 'finetune' | 'skills' | 'settings'

export default function App(): React.ReactElement {
  const { confirm, element: dialogEl } = useDialog()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [page, setPage] = useState<Page>('chat')
  const [settingsInitialTab, setSettingsInitialTab] = useState<'engines' | undefined>(undefined)
  const [pendingLoad, setPendingLoad] = useState<ModelInfo | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([])
  const [finetunedModels, setFinetunedModels] = useState<FinetunedModel[]>([])
  const [loadingPct, setLoadingPct] = useState(0)
  const notifiedComplete = useRef<Set<string>>(new Set())
  const loadPctTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const { downloaded, loadedModel, loadingModelId, loadError, unloading, refresh, loadModel, loadModelFromPath, unloadModel } = useModels()
  const gpu = useGpu()
  const { conversations, archivedConversations, activeId, activeMessages, newConversation, selectConversation, deleteConversation, archiveConversation, unarchiveConversation, renameConversation, setActiveMessages } = useConversations()

  useEffect(() => {
    const unsub = subscribeDownloads(jobs => {
      setDownloadJobs(jobs)
      const done = jobs.filter(j => j.state === 'complete' && !notifiedComplete.current.has(j.model_id))
      if (done.length > 0) {
        done.forEach(j => notifiedComplete.current.add(j.model_id))
        refresh()
      }
    })
    return unsub
  }, [refresh])

  // Fake loading pct for UX feedback
  useEffect(() => {
    if (loadingModelId) {
      setLoadingPct(0)
      clearInterval(loadPctTimer.current ?? undefined)
      loadPctTimer.current = setInterval(() => {
        setLoadingPct(p => Math.min(p + Math.random() * 3, 88))
      }, 500)
    } else {
      clearInterval(loadPctTimer.current ?? undefined)
      setLoadingPct(0)
    }
    return () => clearInterval(loadPctTimer.current ?? undefined)
  }, [loadingModelId])

  useEffect(() => {
    getOnboardingStatus()
      .then(r => { if (!r.complete) setShowOnboarding(true) })
      .catch(() => {})
  }, [])

  const refreshFinetuned = useCallback(() => {
    listFinetunedModels().then(setFinetunedModels).catch(() => {})
  }, [])

  useEffect(() => {
    refreshFinetuned()
    const t = setInterval(refreshFinetuned, 15_000)
    return () => clearInterval(t)
  }, [refreshFinetuned])

  const requestLoad = (modelId: string): void => {
    const model = downloaded.find(m => m.id === modelId)
    if (!model) return
    setPendingLoad(model)
  }

  const handleLoadFinetuned = (model: FinetunedModel): void => {
    loadModelFromPath(model.id, model.path).catch(console.error)
  }

  const handleReloadFromConfig = (config: LoadConfig): void => {
    // model_id may be a short name (from stats.model_name) — resolve to full HF id
    const resolvedId = downloaded.find(m =>
      m.id === config.model_id ||
      m.name === config.model_id ||
      m.id.split('/').pop() === config.model_id ||
      m.name.startsWith(config.model_id.replace('...', ''))
    )?.id ?? config.model_id

    loadModel(resolvedId, {
      gpuMemoryUtilization: config.gpu_memory_utilization ?? 0.75,
      maxModelLen: config.n_ctx ?? undefined,
      enforceEager: false,
      maxCudagraphCaptureSize: null,
      n_gpu_layers: config.n_gpu_layers ?? null,
      cpu_overflow: config.cpu_overflow ?? false,
      is_moe: config.is_moe ?? false,
      gguf_path: config.gguf_path ?? null,
    }).catch(() => {})
  }

  const confirmLoad = (cfg: {
    gpuMemoryUtilization: number; maxModelLen: number | null
    enforceEager: boolean; maxCudagraphCaptureSize: number | null
    nGpuLayers?: number | null; cpuOverflow?: boolean; isMoe?: boolean
    kvQuant?: 'q8_0' | 'q4_0' | 'bf16'
  }): void => {
    if (!pendingLoad) return
    loadModel(pendingLoad.id, {
      gpuMemoryUtilization: cfg.gpuMemoryUtilization,
      maxModelLen: cfg.maxModelLen ?? undefined,
      enforceEager: cfg.enforceEager,
      maxCudagraphCaptureSize: cfg.maxCudagraphCaptureSize,
      n_gpu_layers: cfg.nGpuLayers ?? undefined,
      cpu_overflow: cfg.cpuOverflow ?? false,
      is_moe: cfg.isMoe ?? false,
      kv_quant: cfg.kvQuant ?? 'q8_0',
    })
    setPendingLoad(null)
  }

  const handlePickerConfirm = (modelId: string): void => {
    setShowPicker(false)
    requestLoad(modelId)
  }

  const handleCancelDownload = async (modelId: string): Promise<void> => {
    try { await cancelDownload(modelId) } catch { /* best-effort */ }
  }

  const isLoading = !!loadingModelId || unloading
  const activeJobs = downloadJobs.filter(j => j.state === 'running' || j.state === 'pending').length
  const hasCuda = gpu !== null

  return (
    <div className="flex h-screen bg-base text-text-primary overflow-hidden">
      <NavRail active={page} onNavigate={setPage} downloadsBadge={activeJobs > 0} />

      <div className="flex flex-col flex-1 overflow-hidden">
        <UpdateBanner />
        <div className="flex flex-1 overflow-hidden">
        <div className={`flex flex-1 overflow-hidden ${page === 'chat' ? 'animate-fade-in' : 'hidden'}`}>
          <ChatPage
            loadedModel={loadedModel}
            loading={isLoading}
            loadingPct={Math.round(loadingPct)}
            gpu={gpu}
            hasCuda={hasCuda}
            conversations={conversations}
            archivedConversations={archivedConversations}
            activeId={activeId}
            activeMessages={activeMessages}
            onNewConversation={() => { newConversation().catch(console.error) }}
            onSelectConversation={selectConversation}
            onDeleteConversation={id => deleteConversation(id).catch(console.error)}
            onArchiveConversation={id => archiveConversation(id).catch(console.error)}
            onUnarchiveConversation={id => unarchiveConversation(id).catch(console.error)}
            onRenameConversation={(id, title) => renameConversation(id, title).catch(console.error)}
            onOpenPicker={() => setShowPicker(true)}
            onEject={unloadModel}
            onGoToSettings={() => setPage('settings')}
            setActiveMessages={setActiveMessages}
            onLoadModel={handleReloadFromConfig}
          />
        </div>
        <div className={`flex flex-1 overflow-hidden ${page === 'library' ? 'animate-fade-in' : 'hidden'}`}>
          <LibraryPage
            models={downloaded}
            finetunedModels={finetunedModels}
            onDelete={async (id) => {
              const ok = await confirm('Delete model?', 'This will permanently remove the model files from disk. This cannot be undone.', 'Delete')
              if (!ok) return
              try { await deleteModel(id); refresh() } catch { /* TODO error toast */ }
            }}
            onAddModel={() => setPage('discover')}
            onLoad={requestLoad}
            onLoadFinetuned={handleLoadFinetuned}
            onDeleteFinetuned={async (jobId) => {
              const ok = await confirm('Delete fine-tuned model?', 'This will delete the GGUF export. The LoRA and training data are preserved.', 'Delete')
              if (!ok) return
              try { await deleteFinetunedModel(jobId); refreshFinetuned() } catch { /* ignore */ }
            }}
            totalDiskGb={downloaded.reduce((s, m) => s + (m.size_gb ?? 0), 0)}
          />
        </div>
        <div className={`flex flex-1 overflow-hidden ${page === 'discover' ? 'animate-fade-in' : 'hidden'}`}>
          <DiscoverPage
            loadedModelId={loadedModel?.id ?? null}
            onLoad={requestLoad}
            onDownloaded={refresh}
            downloadJobs={Object.fromEntries(downloadJobs.map(j => [j.model_id, j]))}
            vramTotalGb={gpu ? gpu.vram_total_mb / 1024 : 0}
            vramFreeGb={gpu ? gpu.vram_free_mb / 1024 : 0}
            onGoToEngines={() => setPage('settings')}
          />
        </div>
        <div className={`flex flex-1 overflow-hidden ${page === 'downloads' ? 'animate-fade-in' : 'hidden'}`}>
          <DownloadsPage
            jobs={downloadJobs}
            onCancel={handleCancelDownload}
            onLoad={id => { requestLoad(id); setPage('chat') }}
            gpu={gpu}
          />
        </div>
        <div className={`flex flex-1 overflow-hidden ${page === 'finetune' ? 'animate-fade-in' : 'hidden'}`}>
          <FineTunePage
            loadedModel={loadedModel}
            vramTotalGb={gpu ? gpu.vram_total_mb / 1024 : 0}
            downloadJobs={Object.fromEntries(downloadJobs.map(j => [j.model_id, j]))}
            onDownloaded={refresh}
          />
        </div>
        <div className={`flex flex-1 overflow-hidden ${page === 'skills' ? 'animate-fade-in' : 'hidden'}`}>
          <SkillsPage onGoToSettings={() => setPage('settings')} />
        </div>
        <div className={`flex flex-1 overflow-hidden ${page === 'settings' ? 'animate-fade-in' : 'hidden'}`}>
          <SettingsPage initialTab={settingsInitialTab} />
        </div>
      </div>

      {pendingLoad && gpu && (
        <LoadModelModal
          model={pendingLoad}
          vramTotalGb={gpu.vram_total_mb / 1024}
          vramUsedGb={gpu.vram_used_mb / 1024}
          gpu={gpu}
          onConfirm={confirmLoad}
          onCancel={() => setPendingLoad(null)}
        />
      )}
      {showPicker && (
        <ModelPickerModal
          models={downloaded}
          finetunedModels={finetunedModels}
          loadedModelId={loadedModel?.id ?? null}
          onConfirm={handlePickerConfirm}
          onConfirmFinetuned={(m) => { setShowPicker(false); handleLoadFinetuned(m) }}
          onCancel={() => setShowPicker(false)}
          onGoToEngines={() => { setShowPicker(false); setSettingsInitialTab('engines'); setPage('settings') }}
        />
      )}
      {loadError && <LoadErrorToast message={loadError} />}
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      {dialogEl}
      <ChangelogNotification />
        </div>
    </div>
  )
}

function LoadErrorToast({ message }: { message: string }): React.ReactElement | null {
  const [visible, setVisible] = useState(true)
  const dismiss = useCallback(() => setVisible(false), [])

  useEffect(() => {
    const t = setTimeout(dismiss, 60_000)
    return () => clearTimeout(t)
  }, [dismiss])

  if (!visible) return null

  return (
    <div className="fixed bottom-4 right-4 bg-red/15 border border-red/30 text-red text-sm px-4 py-3 rounded-md max-w-sm flex items-start gap-3">
      <span className="flex-1">Load failed: {message}</span>
      <button onClick={dismiss}
        className="flex-shrink-0 w-4 h-4 flex items-center justify-center opacity-60 hover:opacity-100 cursor-pointer transition-opacity mt-0.5">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3 h-3">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  )
}
