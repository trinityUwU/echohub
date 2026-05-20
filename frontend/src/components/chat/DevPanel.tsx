import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ToolCall, WorkspaceFile } from '@/types'
import { apiRequest } from '@/api/base'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Group flat file paths into a shallow tree (depth 1: folder/ or root file) */
function groupFiles(files: WorkspaceFile[]): Array<{ name: string; isDir: boolean; file?: WorkspaceFile }> {
  const dirs = new Set<string>()
  const rootFiles: WorkspaceFile[] = []

  for (const f of files) {
    const slash = f.path.indexOf('/')
    if (slash !== -1) {
      dirs.add(f.path.slice(0, slash + 1))
    } else {
      rootFiles.push(f)
    }
  }

  const entries: Array<{ name: string; isDir: boolean; file?: WorkspaceFile }> = [
    ...[...dirs].sort().map(d => ({ name: d, isDir: true })),
    ...rootFiles.sort((a, b) => a.path.localeCompare(b.path)).map(f => ({ name: f.path, isDir: false, file: f })),
  ]
  return entries
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconFile(): React.ReactElement {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  )
}

function IconFolder(): React.ReactElement {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

function IconRefresh(): React.ReactElement {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  )
}

function IconChevron({ open }: { open: boolean }): React.ReactElement {
  return (
    <motion.svg
      className="w-3 h-3 flex-shrink-0 text-text-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={{ rotate: open ? 90 : 0 }}
      transition={{ duration: 0.15 }}
    >
      <polyline points="9 18 15 12 9 6"/>
    </motion.svg>
  )
}

// ── Tool call status icon ─────────────────────────────────────────────────────

function ToolStatusIcon({ status }: { status: ToolCall['status'] }): React.ReactElement {
  if (status === 'running' || status === 'pending') {
    return (
      <motion.svg
        className="w-3.5 h-3.5 flex-shrink-0 text-text-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
      >
        <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
      </motion.svg>
    )
  }
  if (status === 'done') {
    return (
      <svg className="w-3.5 h-3.5 flex-shrink-0 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    )
  }
  // error
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

// ── DevPanel ──────────────────────────────────────────────────────────────────

export interface DevPanelProps {
  projectId: string
  loadedModelHasTools: boolean
  toolCalls: ToolCall[]
  workspaceFiles: WorkspaceFile[]
  onRefresh: () => void
}

export function DevPanel({
  projectId,
  loadedModelHasTools,
  toolCalls,
  workspaceFiles,
  onRefresh,
}: DevPanelProps): React.ReactElement {
  const [toolsOpen, setToolsOpen] = useState(true)
  const [viewer, setViewer] = useState<{ path: string; content: string } | null>(null)
  const fileEntries = groupFiles(workspaceFiles)

  const openFile = useCallback(async (path: string): Promise<void> => {
    try {
      const res = await apiRequest<{ result: string }>(`/projects/${projectId}/workspace-files/${encodeURIComponent(path)}`)
      setViewer({ path, content: res.result })
    } catch {
      setViewer({ path, content: '(failed to load file)' })
    }
  }, [projectId])

  const deleteFile = useCallback(async (path: string): Promise<void> => {
    try {
      await apiRequest(`/projects/${projectId}/workspace-files/${encodeURIComponent(path)}`, { method: 'DELETE' })
      onRefresh()
    } catch { /* ignore */ }
  }, [projectId, onRefresh])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-border flex-shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Project Files</span>
        <button
          onClick={onRefresh}
          title="Refresh"
          className="text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
        >
          <IconRefresh />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* No-tools warning */}
        {!loadedModelHasTools && (
          <div className="mx-2 mt-2 px-2.5 py-2 bg-yellow-500/10 rounded-md flex items-start gap-2">
            <svg className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0 mt-px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span className="text-2xs text-yellow-300 leading-relaxed">Load a model with tool calling to use Dev mode</span>
          </div>
        )}

        {/* Tool calls section */}
        <AnimatePresence initial={false}>
          {toolCalls.length > 0 && (
            <motion.div
              key="tool-calls-section"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <button
                onClick={() => setToolsOpen(v => !v)}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider hover:text-text-secondary transition-colors cursor-pointer"
              >
                <IconChevron open={toolsOpen} />
                Tool Calls
                <span className="ml-auto text-xs font-normal normal-case tracking-normal tabular-nums">
                  {toolCalls.length}
                </span>
              </button>

              <AnimatePresence initial={false}>
                {toolsOpen && (
                  <motion.div
                    key="tool-calls-list"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="pb-1">
                      <AnimatePresence>
                        {toolCalls.map(tc => (
                          <motion.div
                            key={tc.id}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            className="flex items-center gap-2 px-3 py-1.5 hover:bg-overlay/40 transition-colors"
                          >
                            <ToolStatusIcon status={tc.status} />
                            <span className="text-xs text-text-secondary truncate flex-1 min-w-0">
                              <span className="text-text-primary font-medium">{tc.tool}</span>
                              {tc.args.path ? (
                                <span className="text-text-muted"> {String(tc.args.path)}</span>
                              ) : null}
                            </span>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Files section */}
        <div>
          <div className="px-3 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider">
            Files
          </div>

          {fileEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
              <div className="w-8 h-8 text-text-muted opacity-30">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
                  <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z"/>
                </svg>
              </div>
              <p className="text-xs text-text-muted opacity-40">No project files yet</p>
            </div>
          ) : (
            <div>
              {fileEntries.map(entry => (
                <div
                  key={entry.name}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-overlay/60 transition-colors cursor-default"
                >
                  {entry.isDir ? <IconFolder /> : <IconFile />}
                  <span className="text-xs text-text-secondary truncate flex-1 min-w-0">{entry.name}</span>
                  {!entry.isDir && entry.file && (
                    <>
                      <span className="text-2xs text-text-muted flex-shrink-0 tabular-nums group-hover:hidden">
                        {formatBytes(entry.file.size)}
                      </span>
                      <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                        <button
                          title="View file"
                          onClick={() => void openFile(entry.file!.path)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                          </svg>
                        </button>
                        <button
                          title="Delete file"
                          onClick={() => void deleteFile(entry.file!.path)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-red/20 text-text-muted hover:text-red transition-colors cursor-pointer"
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
                          </svg>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* File viewer modal */}
      <AnimatePresence>
        {viewer && (
          <FileViewerModal
            path={viewer.path}
            content={viewer.content}
            onClose={() => setViewer(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── File Viewer Modal ─────────────────────────────────────────────────────────

function FileViewerModal({ path, content, onClose }: {
  path: string; content: string; onClose: () => void
}): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const lang = ext === 'ts' || ext === 'tsx' ? 'typescript'
    : ext === 'js' || ext === 'jsx' ? 'javascript'
    : ext === 'py' ? 'python'
    : ext === 'html' ? 'html'
    : ext === 'css' ? 'css'
    : ext === 'json' ? 'json'
    : 'text'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="bg-elevated border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden w-full max-w-3xl max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <svg className="w-4 h-4 text-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <span className="text-sm font-medium text-text-primary truncate flex-1">{path}</span>
          <span className="text-2xs text-text-muted bg-overlay px-1.5 py-0.5 rounded font-mono flex-shrink-0">{lang}</span>
          <button
            onClick={copy}
            title="Copy"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-border hover:bg-overlay text-text-secondary transition-colors cursor-pointer flex-shrink-0"
          >
            {copied ? (
              <><svg className="w-3 h-3 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
            ) : (
              <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
            )}
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-primary transition-colors cursor-pointer flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto bg-[#0a0a0c]">
          <pre className="p-4 text-xs font-mono leading-relaxed text-text-primary whitespace-pre overflow-x-auto">
            {content}
          </pre>
        </div>
      </motion.div>
    </motion.div>
  )
}
