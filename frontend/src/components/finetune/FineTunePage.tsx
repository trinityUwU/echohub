import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { DownloadJob, ModelInfo } from '@/types'
import { ProfilesTab } from './ProfilesTab'
import { TrainTab } from './TrainTab'
import { FTModelBrowser } from './FTModelBrowser'

interface FineTunePageProps {
  loadedModel: ModelInfo | null
  vramTotalGb: number
  downloadJobs: Record<string, DownloadJob>
  onDownloaded: () => void
}

type TabId = 'models' | 'profiles' | 'train'

interface Tab {
  id: TabId
  label: string
}

export function FineTunePage({ loadedModel, vramTotalGb, downloadJobs, onDownloaded }: FineTunePageProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabId>('profiles')
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null)

  const tabs: Tab[] = [
    { id: 'models', label: 'Models' },
    { id: 'profiles', label: 'Profiles' },
    { id: 'train', label: loadedModel ? `Train · ${loadedModel.name}` : 'Train' },
  ]

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="h-[54px] bg-surface border-b border-white/[0.06] flex items-center px-5 gap-1 flex-shrink-0">
        <span className="text-sm font-semibold text-text-muted mr-4">Fine-tune</span>
        {tabs.map(tab => (
          <TabButton
            key={tab.id}
            label={tab.label}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="flex flex-1 overflow-hidden"
        >
          {activeTab === 'profiles' && (
            <ProfilesTab
              selectedProfileId={selectedProfileId}
              onSelectProfile={setSelectedProfileId}
            />
          )}
          {activeTab === 'train' && (
            <TrainTab
              profileId={selectedProfileId}
              loadedModel={loadedModel}
              ftModel={selectedModel}
            />
          )}
          {activeTab === 'models' && (
            <FTModelBrowser
              vramTotalGb={vramTotalGb}
              downloadJobs={downloadJobs}
              onDownloaded={onDownloaded}
              onSelect={model => {
                setSelectedProfileId(null)
                setActiveTab('train')
                // pass model to TrainTab via state
                setSelectedModel(model)
              }}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function TabButton({ label, active, onClick }: {
  label: string; active: boolean; onClick: () => void
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-sm text-sm transition-colors cursor-pointer ${
        active
          ? 'bg-accent-dim text-accent font-medium'
          : 'text-text-muted hover:text-text-secondary hover:bg-overlay'
      }`}
    >
      {label}
    </button>
  )
}

