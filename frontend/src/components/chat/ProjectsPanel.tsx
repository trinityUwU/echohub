import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import type { ProjectMode } from '@/hooks/useChatMode'

interface ProjectsPanelProps {
  mode: ProjectMode
  loadedModelHasTools: boolean
  children: React.ReactNode
}

export function ProjectsPanel({ mode, loadedModelHasTools, children }: ProjectsPanelProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="relative flex flex-shrink-0 border-r border-border">
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="left-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="w-[260px] flex-shrink-0 bg-elevated flex flex-col overflow-hidden h-full"
                >
                  <LeftPanel mode={mode} loadedModelHasTools={loadedModelHasTools} />
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toggle button */}
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? 'Expand' : 'Collapse'}
          className="absolute top-1/2 -translate-y-1/2 -right-4 z-10 w-4 h-10 flex items-center justify-center bg-elevated hover:bg-overlay border border-border text-text-muted hover:text-text-secondary transition-colors cursor-pointer rounded-sm rounded-l-none"
        >
          <motion.svg
            className="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={{ rotate: collapsed ? 0 : 180 }}
            transition={{ duration: 0.2 }}
          >
            <polyline points="15 18 9 12 15 6"/>
          </motion.svg>
        </button>
      </div>

      <div className="flex flex-col flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

interface LeftPanelProps {
  mode: ProjectMode
  loadedModelHasTools: boolean
}

function LeftPanel({ mode, loadedModelHasTools }: LeftPanelProps): React.ReactElement {
  if (mode === 'dev') return <DevPanel loadedModelHasTools={loadedModelHasTools} />
  if (mode === 'docs') return <DocsPanel />
  return <ResearchPanel />
}

function PanelHeader({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="h-10 flex items-center px-3 border-b border-border flex-shrink-0">
      <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{children}</span>
    </div>
  )
}

function PanelPlaceholder({ icon, label }: { icon: React.ReactNode; label: string }): React.ReactElement {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
      <div className="w-8 h-8 text-text-muted opacity-40">{icon}</div>
      <p className="text-xs text-text-muted opacity-50">{label}</p>
    </div>
  )
}

function DevPanel({ loadedModelHasTools }: { loadedModelHasTools: boolean }): React.ReactElement {
  return (
    <>
      <PanelHeader>Project Files</PanelHeader>
      {!loadedModelHasTools && (
        <div className="mx-2 mt-2 px-2.5 py-2 bg-yellow-500/10 rounded-md flex items-start gap-2">
          <svg className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="text-2xs text-yellow-300 leading-relaxed">Load a model with tool calling to use Dev mode</span>
        </div>
      )}
      <PanelPlaceholder
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
            <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z"/>
          </svg>
        }
        label="No project files yet"
      />
    </>
  )
}

function DocsPanel(): React.ReactElement {
  return (
    <>
      <PanelHeader>Context Files</PanelHeader>
      <PanelPlaceholder
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        }
        label="Drop files to inject context"
      />
    </>
  )
}

function ResearchPanel(): React.ReactElement {
  return (
    <>
      <PanelHeader>Sources</PanelHeader>
      <PanelPlaceholder
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        }
        label="Add URLs or documents"
      />
    </>
  )
}
