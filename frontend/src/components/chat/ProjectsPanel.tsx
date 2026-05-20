import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import type { ProjectMode } from '@/hooks/useChatMode'
import type { ToolCall, WorkspaceFile } from '@/types'
import { DevPanel } from './DevPanel'

interface ProjectsPanelProps {
  mode: ProjectMode
  projectId: string
  loadedModelHasTools: boolean
  toolCalls: ToolCall[]
  workspaceFiles: WorkspaceFile[]
  onRefreshFiles: () => void
  children: React.ReactNode
}

export function ProjectsPanel({ mode, projectId, loadedModelHasTools, toolCalls, workspaceFiles, onRefreshFiles, children }: ProjectsPanelProps): React.ReactElement {
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
                  <LeftPanel mode={mode} projectId={projectId} loadedModelHasTools={loadedModelHasTools} toolCalls={toolCalls} workspaceFiles={workspaceFiles} onRefreshFiles={onRefreshFiles} />
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
  projectId: string
  loadedModelHasTools: boolean
  toolCalls: ToolCall[]
  workspaceFiles: WorkspaceFile[]
  onRefreshFiles: () => void
}

function LeftPanel({ mode, projectId, loadedModelHasTools, toolCalls, workspaceFiles, onRefreshFiles }: LeftPanelProps): React.ReactElement {
  if (mode === 'dev') return (
    <DevPanel
      projectId={projectId}
      loadedModelHasTools={loadedModelHasTools}
      toolCalls={toolCalls}
      workspaceFiles={workspaceFiles}
      onRefresh={onRefreshFiles}
    />
  )
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
