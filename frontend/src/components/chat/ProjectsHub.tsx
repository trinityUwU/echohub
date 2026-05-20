import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ProjectMode } from '@/hooks/useChatMode'
import type { Project } from '@/hooks/useProjects'

interface ProjectsHubProps {
  projects: Project[]
  activeMode: ProjectMode
  onSelectProject: (project: Project) => void
  onCreateProject: (name: string, mode: ProjectMode) => void
  onArchiveProject: (id: string) => void
  onUnarchiveProject: (id: string) => void
  onDeleteProject: (id: string) => void
  onRenameProject: (id: string, name: string) => void
}

const MODE_META: Record<ProjectMode, { label: string; color: string; icon: React.ReactElement }> = {
  dev: {
    label: 'Dev',
    color: 'text-accent border-accent/30 bg-accent/10',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
  },
  docs: {
    label: 'Docs',
    color: 'text-blue border-blue/30 bg-blue/10',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
  research: {
    label: 'Research',
    color: 'text-green border-green/30 bg-green/10',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
    ),
  },
}

type FilterTab = 'all' | 'dev' | 'docs' | 'research' | 'archived'

export function ProjectsHub({
  projects,
  onSelectProject,
  onCreateProject,
  onArchiveProject,
  onUnarchiveProject,
  onDeleteProject,
  onRenameProject,
}: ProjectsHubProps): React.ReactElement {
  const [filter, setFilter] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createMode, setCreateMode] = useState<ProjectMode>('dev')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const filtered = projects.filter(p => {
    const matchesTab = filter === 'archived' ? p.archived : filter === 'all' ? !p.archived : !p.archived && p.mode === filter
    const matchesSearch = !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())
    return matchesTab && matchesSearch
  })

  const handleCreate = (): void => {
    const name = createName.trim()
    if (!name) return
    const project = { name, mode: createMode } as { name: string; mode: ProjectMode }
    onCreateProject(project.name, project.mode)
    setCreateName('')
    setShowCreate(false)
  }

  const handleContextMenu = (e: React.MouseEvent, id: string): void => {
    e.preventDefault()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
  }

  const closeContext = (): void => setContextMenu(null)

  const startRename = (project: Project): void => {
    setRenamingId(project.id)
    setRenameValue(project.name)
    closeContext()
  }

  const commitRename = (id: string): void => {
    const v = renameValue.trim()
    if (v) onRenameProject(id, v)
    setRenamingId(null)
  }

  const TABS: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'dev', label: 'Dev' },
    { id: 'docs', label: 'Docs' },
    { id: 'research', label: 'Research' },
    { id: 'archived', label: 'Archived' },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-base" onClick={closeContext}>
      {/* Header */}
      <div className="flex items-center justify-between px-8 pt-8 pb-4 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-text-primary tracking-tight">Projects</h1>
          <p className="text-xs text-text-muted mt-0.5">{projects.filter(p => !p.archived).length} active project{projects.filter(p => !p.archived).length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Search projects…"
              className="bg-elevated border border-border rounded-md pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 transition-colors w-48"
            />
          </div>
          <button
            onClick={e => { e.stopPropagation(); setShowCreate(true) }}
            className="flex items-center gap-2 px-3 py-1.5 bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent text-xs font-medium rounded-md transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New project
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-8 mb-5 flex-shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={e => { e.stopPropagation(); setFilter(tab.id) }}
            className={`px-3 py-1 text-xs rounded-md transition-colors cursor-pointer font-medium ${
              filter === tab.id
                ? 'bg-overlay text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {/* Create form inline */}
        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden mb-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="bg-elevated border border-border rounded-lg p-4 flex flex-col gap-3">
                <p className="text-xs font-semibold text-text-primary">New project</p>
                <input
                  autoFocus
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false) }}
                  placeholder="Project name…"
                  className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 transition-colors"
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted">Type</span>
                  {(['dev', 'docs', 'research'] as ProjectMode[]).map(m => {
                    const meta = MODE_META[m]
                    return (
                      <button
                        key={m}
                        onClick={() => setCreateMode(m)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                          createMode === m ? meta.color : 'text-text-muted border-border hover:border-border-hover'
                        }`}
                      >
                        {meta.icon}
                        {meta.label}
                      </button>
                    )
                  })}
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary cursor-pointer">Cancel</button>
                  <button
                    onClick={handleCreate}
                    disabled={!createName.trim()}
                    className="px-3 py-1.5 text-xs bg-accent text-white rounded-md font-medium disabled:opacity-40 cursor-pointer transition-opacity"
                  >
                    Create
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <svg className="w-10 h-10 text-text-muted opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
            </svg>
            <p className="text-sm text-text-muted opacity-50">
              {filter === 'archived' ? 'No archived projects' : 'No projects yet — create one above'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            <AnimatePresence>
              {filtered.map(project => {
                const meta = MODE_META[project.mode]
                return (
                  <motion.div
                    key={project.id}
                    layout
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.94 }}
                    transition={{ duration: 0.15 }}
                    onContextMenu={e => handleContextMenu(e, project.id)}
                    onClick={() => !project.archived && onSelectProject(project)}
                    className={`bg-elevated border border-border rounded-lg p-4 flex flex-col gap-2.5 group transition-colors ${
                      !project.archived ? 'hover:border-border-hover cursor-pointer' : 'opacity-60'
                    }`}
                  >
                    {/* Mode badge + actions */}
                    <div className="flex items-center justify-between">
                      <span className={`flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md border ${meta.color}`}>
                        {meta.icon}
                        {meta.label}
                      </span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {project.archived ? (
                          <ActionBtn onClick={e => { e.stopPropagation(); onUnarchiveProject(project.id) }} title="Restore">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                            <path d="M3 3v5h5"/>
                          </ActionBtn>
                        ) : (
                          <ActionBtn onClick={e => { e.stopPropagation(); onArchiveProject(project.id) }} title="Archive">
                            <polyline points="21 8 21 21 3 21 3 8"/>
                            <rect x="1" y="3" width="22" height="5"/>
                            <line x1="10" y1="12" x2="14" y2="12"/>
                          </ActionBtn>
                        )}
                        <ActionBtn onClick={e => { e.stopPropagation(); onDeleteProject(project.id) }} title="Delete" danger>
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14H6L5 6"/>
                          <path d="M10 11v6"/><path d="M14 11v6"/>
                        </ActionBtn>
                      </div>
                    </div>

                    {/* Name */}
                    {renamingId === project.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(project.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(project.id); if (e.key === 'Escape') setRenamingId(null) }}
                        onClick={e => e.stopPropagation()}
                        className="text-sm font-medium text-text-primary bg-surface border border-accent/40 rounded px-2 py-0.5 outline-none w-full"
                      />
                    ) : (
                      <p className="text-sm font-medium text-text-primary truncate">{project.name}</p>
                    )}

                    {/* Date */}
                    <p className="text-xs text-text-muted">
                      {new Date(project.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Context menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 50 }}
            className="bg-elevated border border-border rounded-lg shadow-xl py-1 min-w-[140px]"
            onClick={e => e.stopPropagation()}
          >
            {[
              { label: 'Rename', action: () => { const p = projects.find(x => x.id === contextMenu.id); if (p) startRename(p) } },
              { label: 'Archive', action: () => { onArchiveProject(contextMenu.id); closeContext() } },
              { label: 'Delete', action: () => { onDeleteProject(contextMenu.id); closeContext() }, danger: true },
            ].map(item => (
              <button
                key={item.label}
                onClick={item.action}
                className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-overlay ${
                  item.danger ? 'text-red' : 'text-text-secondary'
                }`}
              >
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ActionBtn({
  onClick, title, danger = false, children,
}: {
  onClick: React.MouseEventHandler
  title: string
  danger?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors cursor-pointer ${
        danger ? 'hover:bg-red/15 text-text-muted hover:text-red' : 'hover:bg-overlay text-text-muted hover:text-text-secondary'
      }`}
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}
