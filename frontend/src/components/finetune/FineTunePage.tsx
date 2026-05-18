import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ModelInfo } from '@/types'
import { FTModelBrowser } from './FTModelBrowser'
import { PairsTab } from './PairsTab'
import { TrainTab } from './TrainTab'

type Tab = 'models' | 'pairs' | 'train'

interface FineTunePageProps {
  vramTotalGb: number
  vramFreeGb: number
}

export function FineTunePage({ vramTotalGb }: FineTunePageProps): React.ReactElement {
  const [activeTab, setActiveTab] = useState<Tab>('models')
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null)

  const handleModelSelect = (model: ModelInfo): void => {
    setSelectedModel(model)
    setActiveTab('train')
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TabBar active={activeTab} onSelect={setActiveTab} selectedModelName={selectedModel?.name ?? null} />
      <div className="flex flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'models' && (
            <TabPane key="models">
              <FTModelBrowser
                vramTotalGb={vramTotalGb}
                onSelect={handleModelSelect}
              />
            </TabPane>
          )}
          {activeTab === 'pairs' && (
            <TabPane key="pairs">
              <PairsTab />
            </TabPane>
          )}
          {activeTab === 'train' && (
            <TabPane key="train">
              <TrainTab
                selectedModel={selectedModel}
                vramTotalGb={vramTotalGb}
                onNavigateToModels={() => setActiveTab('models')}
              />
            </TabPane>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function TabPane({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="flex flex-col flex-1 overflow-hidden"
    >
      {children}
    </motion.div>
  )
}

function TabBar({ active, onSelect, selectedModelName }: {
  active: Tab; onSelect: (t: Tab) => void; selectedModelName: string | null
}): React.ReactElement {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'models', label: 'Models' },
    { id: 'pairs', label: 'Pairs' },
    { id: 'train', label: selectedModelName ? `Train · ${selectedModelName}` : 'Train' },
  ]

  return (
    <div className="flex items-center gap-0 px-5 border-b border-border bg-surface flex-shrink-0">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={`relative px-4 py-3 text-sm cursor-pointer transition-colors truncate max-w-[200px] ${
            active === t.id ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          {t.label}
          {active === t.id && (
            <motion.div
              layoutId="ft-tab-indicator"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full"
            />
          )}
        </button>
      ))}
    </div>
  )
}
