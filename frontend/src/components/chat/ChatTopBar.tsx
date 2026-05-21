import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ModelInfo } from '@/types'
import type { ChatView, ProjectMode } from '@/hooks/useChatMode'
import { onTimings } from '@/api/engineTimings'

interface ChatTopBarProps {
  loadedModel: ModelInfo | null
  loading: boolean
  loadingPct: number
  onOpenPicker: () => void
  onClear: () => void
  onEject: () => void
  onExport: () => void
  view: ChatView
  mode: ProjectMode
  activeProjectName?: string | null
  onViewChange: (v: ChatView) => void
  onModeChange: (m: ProjectMode) => void
  onBackToHub?: () => void
  loadedModelHasTools: boolean
  memoryEnabled?: boolean
  onToggleMemory?: () => void
}

export function ChatTopBar({
  loadedModel, loading, loadingPct, onOpenPicker, onClear, onEject, onExport,
  view, mode, activeProjectName, onViewChange, onModeChange, onBackToHub, loadedModelHasTools,
  memoryEnabled, onToggleMemory,
}: ChatTopBarProps): React.ReactElement {
  if (loading) return <LoadingBar pct={loadingPct} modelName={loadedModel?.name ?? '…'} onEject={onEject} />
  return (
    <NormalBar
      loadedModel={loadedModel}
      onOpenPicker={onOpenPicker}
      onClear={onClear}
      onEject={onEject}
      onExport={onExport}
      view={view}
      mode={mode}
      activeProjectName={activeProjectName ?? null}
      onViewChange={onViewChange}
      onModeChange={onModeChange}
      onBackToHub={onBackToHub ?? null}
      loadedModelHasTools={loadedModelHasTools}
      memoryEnabled={memoryEnabled}
      onToggleMemory={onToggleMemory}
    />
  )
}

interface NormalBarProps {
  loadedModel: ModelInfo | null
  onOpenPicker: () => void
  onClear: () => void
  onEject: () => void
  onExport: () => void
  view: ChatView
  mode: ProjectMode
  activeProjectName: string | null
  onViewChange: (v: ChatView) => void
  onModeChange: (m: ProjectMode) => void
  onBackToHub: (() => void) | null
  loadedModelHasTools: boolean
  memoryEnabled?: boolean
  onToggleMemory?: () => void
}

const VIEWS: { id: ChatView; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'projects', label: 'Projects' },
]

const MODES: { id: ProjectMode; label: string; icon: React.ReactElement }[] = [
  {
    id: 'dev',
    label: 'Dev',
    icon: (
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
  },
  {
    id: 'docs',
    label: 'Docs',
    icon: (
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
  },
  {
    id: 'research',
    label: 'Research',
    icon: (
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
  },
]

function NormalBar({
  loadedModel, onOpenPicker, onClear, onEject, onExport,
  view, mode, activeProjectName, onViewChange, onModeChange, onBackToHub, loadedModelHasTools,
  memoryEnabled, onToggleMemory,
}: NormalBarProps): React.ReactElement {
  return (
    <div className="bg-surface border-b border-border flex-shrink-0">
      <div className="h-[50px] flex items-center px-4 gap-2.5">
        {view === 'projects' && activeProjectName && onBackToHub && (
          <button
            onClick={onBackToHub}
            className="flex items-center gap-1.5 text-text-muted hover:text-text-secondary transition-colors cursor-pointer mr-1"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            <span className="text-xs font-medium truncate max-w-[120px]">{activeProjectName}</span>
          </button>
        )}
        <button
          onClick={onOpenPicker}
          className="flex items-center gap-2 bg-elevated border border-border hover:border-border-hover rounded-sm px-2.5 py-1.5 cursor-pointer transition-colors"
        >
          <span className="text-sm font-medium text-text-primary max-w-[180px] truncate">
            {loadedModel?.name ?? 'No model loaded'}
          </span>
          {loadedModel && <span className="text-2xs bg-green/15 text-green rounded px-1.5 py-px">loaded</span>}
          {loadedModel?.engine && (
            <span className={`text-2xs rounded px-1.5 py-px ${loadedModel.engine === 'vllm' ? 'bg-blue/15 text-blue' : 'bg-accent/15 text-accent'}`}>
              {loadedModel.engine === 'vllm' ? 'vLLM' : 'llama.cpp'}
            </span>
          )}
          {loadedModel?.quantization && (
            <span className="text-2xs bg-blue/15 text-blue rounded px-1.5 py-px">
              {loadedModel.quantization.split('/')[0]}
            </span>
          )}
          {loadedModel?.has_mtp && <span className="text-2xs bg-cyan-500/15 text-cyan-400 rounded px-1.5 py-px">MTP</span>}
          <svg className="w-3.5 h-3.5 stroke-text-muted" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <div className="relative flex items-center bg-elevated border border-border rounded-md p-0.5 ml-3">
          {VIEWS.map(v => (
            <button
              key={v.id}
              onClick={() => onViewChange(v.id)}
              className="relative z-10 px-3 py-1 text-xs font-medium transition-colors rounded-sm cursor-pointer"
              style={{ color: view === v.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
            >
              {view === v.id && (
                <motion.span
                  layoutId="view-indicator"
                  className="absolute inset-0 bg-overlay rounded-sm"
                  style={{ zIndex: -1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              {v.label}
            </button>
          ))}
        </div>

        <AnimatePresence>
          {false && view === 'projects' && !activeProjectName && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="relative flex items-center bg-elevated border border-border rounded-md p-0.5 ml-1">
                {MODES.map(m => (
                  <button
                    key={m.id}
                    onClick={() => onModeChange(m.id)}
                    className="relative z-10 flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors rounded-sm cursor-pointer whitespace-nowrap"
                    style={{ color: mode === m.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
                  >
                    {mode === m.id && (
                      <motion.span
                        layoutId="mode-indicator"
                        className="absolute inset-0 bg-overlay rounded-sm"
                        style={{ zIndex: -1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                      />
                    )}
                    {m.icon}
                    {m.label}
                    {m.id === 'dev' && !loadedModelHasTools && (
                      <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-1.5 ml-auto">
          {onToggleMemory && (
            <button
              onClick={onToggleMemory}
              title={memoryEnabled ? 'Memory ON — click to disable' : 'Memory OFF — click to enable'}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-sm text-xs transition-colors cursor-pointer border ${
                memoryEnabled
                  ? 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20'
                  : 'border-border bg-surface text-text-muted hover:bg-overlay hover:text-text-primary'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
              </svg>
              Memory
            </button>
          )}
          <TopBarBtn onClick={onExport}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            Export
          </TopBarBtn>
          <TopBarBtn onClick={onClear}>
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 .49-5.01"/>
            Clear
          </TopBarBtn>
          {loadedModel && (
            <button
              onClick={onEject}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border border-red/30 bg-red/10 hover:bg-red/20 text-red text-xs font-medium transition-colors cursor-pointer"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
              </svg>
              Eject
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function LoadingBar({ pct, modelName, onEject }: {
  pct: number
  modelName: string
  onEject: () => void
}): React.ReactElement {
  return (
    <div className="h-[50px] bg-surface border-b border-border flex items-center px-4 gap-3 flex-shrink-0">
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex justify-between text-xs">
          <span className="text-accent">Loading {modelName}…</span>
          <span className="font-mono text-text-muted">~{pct}%</span>
        </div>
        <div className="h-[3px] bg-overlay rounded-sm overflow-hidden">
          <div className="h-full bg-accent rounded-sm transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <TopBarBtn onClick={onEject}>
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        Eject
      </TopBarBtn>
    </div>
  )
}

/** Logs panel — rendered in the content area, between left/right sidebars */
export function LogsPanel({ active }: { active: boolean }): React.ReactElement {
  const [logs, setLogs] = React.useState<string>('')
  const [timingsLines, setTimingsLines] = React.useState<string[]>([])
  const endRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!active) return
    let alive = true
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch('/api/system/engine-log')
        if (res.ok && alive) setLogs(await res.text())
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 1500)
    return () => { alive = false; clearInterval(id) }
  }, [active])

  // Subscribe to timings buffer — called immediately with buffered lines on mount
  React.useEffect(() => {
    return onTimings(lines => setTimingsLines(lines))
  }, [])

  React.useEffect(() => {
    if (active) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, timingsLines, active])

  const allLines = [...logs.split('\n'), ...timingsLines]

  return (
    <AnimatePresence initial={false}>
      {active && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 220, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="overflow-hidden bg-[#0a0a0c] border-b border-border flex-shrink-0"
        >
          <div className="h-full overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
            {allLines.some(l => l.trim())
              ? allLines.map((line, i) => (
                  <div key={i} className={
                    /error/i.test(line) ? 'text-red' :
                    /warn/i.test(line) ? 'text-yellow' :
                    /loaded|success|\bOK\b/i.test(line) ? 'text-green' :
                    /prompt eval|eval time|total time|─{10,}/.test(line) ? 'text-cyan-400' :
                    'text-text-muted'
                  }>{line || ' '}</div>
                ))
              : <span className="animate-pulse text-text-muted/50">Waiting for log output…</span>
            }
            <div ref={endRef} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function TopBarBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border border-border hover:bg-overlay text-text-secondary text-xs font-medium transition-colors cursor-pointer"
    >
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {Array.isArray(children) ? children.slice(0, -1) : null}
      </svg>
      {Array.isArray(children) ? children[children.length - 1] : children}
    </button>
  )
}
