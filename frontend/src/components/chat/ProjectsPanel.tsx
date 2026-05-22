import { AnimatePresence, motion } from 'framer-motion'
import { useState, useRef, useCallback } from 'react'
import type { ProjectMode } from '@/hooks/useChatMode'
import type { ToolCall, WorkspaceFile } from '@/types'
import { useContextFiles, useProjectSources } from '@/hooks/useProjectContext'
import { DevPanel } from './DevPanel'

// ── Shared helpers ────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function IconFile(): React.ReactElement {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0 text-text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  )
}

function IconLink(): React.ReactElement {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0 text-text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  )
}

function IconTrash(): React.ReactElement {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
    </svg>
  )
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

interface DropZoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  label: string
}

function DropZone({ onFiles, accept, label }: DropZoneProps): React.ReactElement {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onFiles(files)
  }, [onFiles])

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`mx-2 mb-2 rounded-lg border border-dashed cursor-pointer flex flex-col items-center justify-center gap-1.5 py-4 px-3 text-center transition-colors ${dragging ? 'border-white/20 bg-white/5' : 'border-white/10 hover:border-white/15 hover:bg-white/[0.02]'}`}
    >
      <svg className="w-5 h-5 text-text-muted/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <p className="text-[11px] text-text-muted/50 leading-snug">{label}</p>
      <input ref={inputRef} type="file" accept={accept} multiple className="hidden" onChange={e => { if (e.target.files?.length) onFiles(Array.from(e.target.files)) }} />
    </div>
  )
}

// ── Uploading spinner ─────────────────────────────────────────────────────────

function UploadingRow({ name }: { name: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 opacity-60">
      <motion.svg className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
        <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
      </motion.svg>
      <span className="text-xs text-text-muted truncate">{name}</span>
    </div>
  )
}

// ── Panel header ──────────────────────────────────────────────────────────────

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
  if (mode === 'docs') return <DocsPanel projectId={projectId} />
  return <ResearchPanel projectId={projectId} />
}

// ── DocsPanel ─────────────────────────────────────────────────────────────────

const DOCS_ACCEPT = '.txt,.md,.markdown,.rst,.csv,.json,.yaml,.yml,.html,.xml,.py,.ts,.tsx,.js,.jsx'

function DocsPanel({ projectId }: { projectId: string }): React.ReactElement {
  const { files, loading, upload, remove } = useContextFiles(projectId)
  const [uploading, setUploading] = useState<string[]>([])

  const handleFiles = useCallback(async (picked: File[]): Promise<void> => {
    const names = picked.map(f => f.name)
    setUploading(prev => [...prev, ...names])
    await Promise.all(picked.map(f => upload(f).catch(() => null)))
    setUploading(prev => prev.filter(n => !names.includes(n)))
  }, [upload])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="h-10 flex items-center justify-between px-3 border-b border-border flex-shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Context Files</span>
        {files.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted/60 tabular-nums">
            {files.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col">
        <DropZone
          onFiles={handleFiles}
          accept={DOCS_ACCEPT}
          label="Drop text files to inject as context"
        />

        {loading && files.length === 0 ? (
          <div className="px-3 py-3 text-xs text-text-muted/40">Loading…</div>
        ) : files.length === 0 && uploading.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center pb-8">
            <svg className="w-8 h-8 text-text-muted/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <p className="text-xs text-text-muted/30">No context files yet</p>
          </div>
        ) : (
          <div>
            {uploading.map(name => <UploadingRow key={name} name={name} />)}
            <AnimatePresence initial={false}>
              {files.map(f => (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-overlay/40 transition-colors"
                >
                  <IconFile />
                  <span className="text-xs text-text-secondary truncate flex-1 min-w-0">{f.filename}</span>
                  <span className="text-[10px] text-text-muted/40 flex-shrink-0 tabular-nums group-hover:hidden">
                    {formatBytes(f.size)}
                  </span>
                  <button
                    onClick={() => void remove(f.id)}
                    title="Remove"
                    className="hidden group-hover:flex w-5 h-5 items-center justify-center rounded hover:bg-red/20 text-text-muted hover:text-red transition-colors cursor-pointer flex-shrink-0"
                  >
                    <IconTrash />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}

// ── ResearchPanel ─────────────────────────────────────────────────────────────

const RESEARCH_ACCEPT = '.txt,.md,.markdown,.rst,.csv,.json,.yaml,.yml,.html,.xml,.pdf'

function ResearchPanel({ projectId }: { projectId: string }): React.ReactElement {
  const { sources, loading, addUrl, upload, remove } = useProjectSources(projectId)
  const [urlInput, setUrlInput] = useState('')
  const [uploading, setUploading] = useState<string[]>([])

  const handleAddUrl = useCallback(async (): Promise<void> => {
    const val = urlInput.trim()
    if (!val) return
    setUrlInput('')
    await addUrl(val, val)
  }, [urlInput, addUrl])

  const handleFiles = useCallback(async (picked: File[]): Promise<void> => {
    const names = picked.map(f => f.name)
    setUploading(prev => [...prev, ...names])
    await Promise.all(picked.map(f => upload(f).catch(() => null)))
    setUploading(prev => prev.filter(n => !names.includes(n)))
  }, [upload])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="h-10 flex items-center justify-between px-3 border-b border-border flex-shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Sources</span>
        {sources.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted/60 tabular-nums">
            {sources.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* URL input */}
        <div className="px-2 pt-2 pb-1">
          <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-surface overflow-hidden focus-within:border-white/20 transition-colors">
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleAddUrl() }}
              placeholder="Paste URL…"
              className="flex-1 min-w-0 bg-transparent px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted/40 outline-none"
            />
            <button
              onClick={() => void handleAddUrl()}
              disabled={!urlInput.trim()}
              className="px-2 py-1.5 text-xs text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors cursor-pointer mr-1"
            >
              Add
            </button>
          </div>
        </div>

        <DropZone
          onFiles={handleFiles}
          accept={RESEARCH_ACCEPT}
          label="Drop documents as sources"
        />

        {loading && sources.length === 0 ? (
          <div className="px-3 py-3 text-xs text-text-muted/40">Loading…</div>
        ) : sources.length === 0 && uploading.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center pb-8">
            <svg className="w-8 h-8 text-text-muted/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <p className="text-xs text-text-muted/30">No sources yet</p>
          </div>
        ) : (
          <div>
            {uploading.map(name => <UploadingRow key={name} name={name} />)}
            <AnimatePresence initial={false}>
              {sources.map(s => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-overlay/40 transition-colors"
                >
                  {s.source_type === 'url' ? <IconLink /> : <IconFile />}
                  <span className="text-xs text-text-secondary truncate flex-1 min-w-0">
                    {s.label}
                  </span>
                  <button
                    onClick={() => void remove(s.id)}
                    title="Remove"
                    className="hidden group-hover:flex w-5 h-5 items-center justify-center rounded hover:bg-red/20 text-text-muted hover:text-red transition-colors cursor-pointer flex-shrink-0"
                  >
                    <IconTrash />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
