import { useEffect, useRef, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useChat } from '@/hooks/useChat'
import { useToolChat } from '@/hooks/useToolChat'
import { useProfiles } from '@/hooks/useProfiles'
import type { ConversationSummary, ModelInfo, GpuStats, ChatMessage, LoadConfig, ChatParams, GenerationStats, Attachment, ToolCall, WorkspaceFile } from '@/types'
import type { ChatView, ProjectMode } from '@/hooks/useChatMode'
import { ConvSidebar } from '@/components/nav/ConvSidebar'
import { ChatTopBar } from './ChatTopBar'
import { CpuBanner } from './CpuBanner'
import { MigrationBanner } from '@/components/shared/MigrationBanner'
import { MessageRow } from './MessageRow'
import { InputBar } from './InputBar'
import { RightPanel } from './RightPanel'
import { ProjectsPanel } from './ProjectsPanel'
import { ProjectsHub } from './ProjectsHub'
import { useChatMode } from '@/hooks/useChatMode'
import { useProjects } from '@/hooks/useProjects'
import { clearMessages, deleteMessage } from '@/api/client'

interface ChatPageProps {
  loadedModel: ModelInfo | null
  loading: boolean
  loadingPct: number
  gpu: GpuStats | null
  hasCuda: boolean
  conversations: ConversationSummary[]
  archivedConversations: ConversationSummary[]
  activeId: string | null
  activeMessages: ChatMessage[]
  onNewConversation: () => void | Promise<void>
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
  onArchiveConversation: (id: string) => void
  onUnarchiveConversation: (id: string) => void
  onRenameConversation: (id: string, title: string) => void
  onOpenPicker: () => void
  onEject: () => void
  onGoToSettings: () => void
  setActiveMessages: (msgs: ChatMessage[]) => void
  onLoadModel?: (config: LoadConfig) => void
}

export function ChatPage({
  loadedModel, loading, loadingPct, gpu, hasCuda,
  conversations, archivedConversations, activeId, activeMessages,
  onNewConversation, onSelectConversation,
  onDeleteConversation, onArchiveConversation, onUnarchiveConversation, onRenameConversation,
  onOpenPicker, onEject, onGoToSettings,
  setActiveMessages, onLoadModel,
}: ChatPageProps): React.ReactElement {
  const { view, mode, activeProject, setView, setMode, openProject, closeProject } = useChatMode()
  const projectsHook = useProjects()
  const profilesHook = useProfiles() // chat-scoped only — project workspace has its own
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const toggleLeft = useCallback(() => setLeftCollapsed(v => !v), [])
  const toggleRight = useCallback(() => setRightCollapsed(v => !v), [])
  // Local params state — syncs from profile on profile switch, edited freely by sliders
  const [params, setParams] = useState(profilesHook.activeProfile.params)
  const prevProfileId = useRef(profilesHook.activeId)

  useEffect(() => {
    if (profilesHook.activeId !== prevProfileId.current) {
      setParams(profilesHook.activeProfile.params)
      prevProfileId.current = profilesHook.activeId
    }
  }, [profilesHook.activeId, profilesHook.activeProfile.params])
  const bottomRef = useRef<HTMLDivElement>(null)

  const activeConv = conversations.find(cv => cv.id === activeId)
  const activeModelName = loadedModel?.name ?? activeConv?.model_id?.split('/').pop() ?? null

  const { messages, streaming, stats, send, sendFromHistory, stop, setMessages, usedTokens, isTokensExact, oomError } = useChat(
    params,
    activeMessages,
    setActiveMessages,
    loadedModel?.max_context_window ?? undefined,
    loadedModel?.id,
    activeId ?? undefined,
    activeModelName,
  )

  // Sync messages when conversation changes OR when activeMessages loads from DB
  // streaming flag prevents reset mid-generation
  useEffect(() => {
    if (!streaming) setMessages(activeMessages)
  }, [activeId, activeMessages]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleClear = (): void => {
    setMessages([])
    setActiveMessages([])
    if (activeId) clearMessages(activeId).catch(() => {})
  }

  const handleRegenerate = (): void => {
    const lastAssistant = [...messages].reverse().findIndex(m => m.role === 'assistant')
    if (lastAssistant === -1 || !loadedModel) return
    const idx = messages.length - 1 - lastAssistant
    const msgToDelete = messages[idx]
    const history = messages.slice(0, idx)
    // Delete old assistant message from DB before regenerating
    if (activeId && msgToDelete.id) {
      deleteMessage(activeId, msgToDelete.id).catch(() => {})
    }
    sendFromHistory(history)
  }

  const handleEditUser = (index: number, newText: string): void => {
    if (!loadedModel) return
    // Delete all messages from this index onwards in DB
    if (activeId) {
      messages.slice(index).forEach(m => {
        if (m.id) deleteMessage(activeId, m.id).catch(() => {})
      })
    }
    const updated = { ...messages[index], content: newText }
    const history = [...messages.slice(0, index), updated]
    sendFromHistory(history)
  }

  const handleExport = (): void => {
    const lines: string[] = []
    const modelName = loadedModel?.name ?? 'Unknown model'
    lines.push(`# Chat export — ${modelName}`)
    lines.push(`*Exported: ${new Date().toLocaleString()}*\n`)
    for (const msg of messages) {
      const role = msg.role === 'user' ? '**You**' : `**${modelName}**`
      const text = typeof msg.content === 'string' ? msg.content : msg.content.find(p => p.type === 'text')?.text ?? ''
      lines.push(`### ${role}\n${text}\n`)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `echohub-chat-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Projects hub: no active project selected yet
  if (view === 'projects' && !activeProject) {
    return (
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-hidden">
          <ChatTopBar
            loadedModel={loadedModel}
            loading={loading}
            loadingPct={loadingPct}
            onOpenPicker={onOpenPicker}
            onClear={handleClear}
            onEject={onEject}
            onExport={handleExport}
            view={view}
            mode={mode}
            onViewChange={setView}
            onModeChange={setMode}
            loadedModelHasTools={!!loadedModel?.capabilities?.tools}
          />
          <ProjectsHub
            projects={projectsHook.projects}
            activeMode={mode}
            onSelectProject={openProject}
            onCreateProject={projectsHook.createProject}
            onArchiveProject={projectsHook.archiveProject}
            onUnarchiveProject={projectsHook.unarchiveProject}
            onDeleteProject={projectsHook.deleteProject}
            onRenameProject={projectsHook.renameProject}
          />
        </div>
      </div>
    )
  }

  // Project workspace — isolated component with its own useProfiles scoped to the project
  if (view === 'projects' && activeProject) {
    return (
      <ProjectWorkspace
        key={activeProject.id}
        project={activeProject}
        loadedModel={loadedModel}
        loading={loading}
        loadingPct={loadingPct}
        hasCuda={hasCuda}
        activeMessages={activeMessages}
        setActiveMessages={setActiveMessages}
        onOpenPicker={onOpenPicker}
        onEject={onEject}
        onGoToSettings={onGoToSettings}
        onBackToHub={closeProject}
        onLoadModel={onLoadModel}
        view={view}
        mode={mode}
        onViewChange={setView}
        onModeChange={setMode}
      />
    )
  }

  // Chat workspace
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <ChatTopBar
        loadedModel={loadedModel}
        loading={loading}
        loadingPct={loadingPct}
        onOpenPicker={onOpenPicker}
        onClear={handleClear}
        onEject={onEject}
        onExport={handleExport}
        view={view}
        mode={mode}
        onViewChange={setView}
        onModeChange={setMode}
        loadedModelHasTools={!!loadedModel?.capabilities?.tools}
      />
      {!hasCuda && <CpuBanner onGoToSettings={onGoToSettings} />}
      <MigrationBanner onGoToSettings={onGoToSettings} />
      {(oomError || [...messages].reverse().find(m => m.role === 'assistant')?.stats?.oom) && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red/10 border border-red/30 rounded-md flex items-center gap-2 text-sm text-red flex-shrink-0">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Out of memory — VRAM insuffisante pour cette génération. Réduis le contexte ou recharge le modèle.
        </div>
      )}
      <div className="flex flex-1 overflow-hidden relative">
        <PanelWrapper side="left" collapsed={leftCollapsed} onToggle={toggleLeft}>
          <ConvSidebar
            conversations={conversations}
            archivedConversations={archivedConversations}
            activeId={activeId}
            onSelect={onSelectConversation}
            onNew={onNewConversation}
            onDelete={onDeleteConversation}
            onArchive={onArchiveConversation}
            onUnarchive={onUnarchiveConversation}
            onRename={onRenameConversation}
            gpu={gpu}
          />
        </PanelWrapper>
        <ChatContent
          view={view}
          mode={mode}
          loadedModelHasTools={!!loadedModel?.capabilities?.tools}
          messages={messages}
          streaming={streaming}
          stats={stats}
          activeModelName={activeModelName}
          loadedModel={loadedModel}
          params={params}
          usedTokens={usedTokens}
          isTokensExact={isTokensExact}
          bottomRef={bottomRef}
          toolCalls={[]}
          workspaceFiles={[]}
          onRefreshFiles={() => {}}
          onRegenerate={handleRegenerate}
          onEditUser={handleEditUser}
          onSend={(text, attachments) => send(text, !!loadedModel, attachments)}
          onStop={stop}
          onLoadModel={onLoadModel}
        />
        <PanelWrapper side="right" collapsed={rightCollapsed} onToggle={toggleRight}>
          <RightPanel params={params} onChange={setParams} profiles={profilesHook} loadedModel={loadedModel} />
        </PanelWrapper>
      </div>
    </div>
  )
}

interface ChatContentProps {
  view: ChatView
  mode: ProjectMode
  loadedModelHasTools: boolean
  messages: ChatMessage[]
  streaming: boolean
  stats: GenerationStats | null
  activeModelName: string | null
  loadedModel: ModelInfo | null
  params: ChatParams
  usedTokens: number
  isTokensExact: boolean
  bottomRef: React.RefObject<HTMLDivElement | null>
  toolCalls: ToolCall[]
  workspaceFiles: WorkspaceFile[]
  onRefreshFiles: () => void
  onRegenerate: () => void
  onEditUser: (index: number, newText: string) => void
  onSend: (text: string, attachments?: Attachment[]) => void
  onStop: () => void
  onLoadModel?: (config: LoadConfig) => void
}

function ChatContent({
  view, mode, loadedModelHasTools,
  messages, streaming, stats, activeModelName, loadedModel,
  params, usedTokens, isTokensExact, bottomRef,
  toolCalls, workspaceFiles, onRefreshFiles,
  onRegenerate, onEditUser, onSend, onStop, onLoadModel,
}: ChatContentProps): React.ReactElement {
  const inner = (
    <>
      <div className="flex-1 overflow-y-auto py-6">
        {messages.map((msg, i) => (
          <MessageRow
            key={msg.id ?? i}
            message={msg}
            isLast={i === messages.length - 1}
            genStats={i === messages.length - 1 && msg.role === 'assistant' ? stats : undefined}
            modelName={activeModelName}
            streaming={streaming}
            onRegenerate={msg.role === 'assistant' && i === messages.length - 1 ? onRegenerate : undefined}
            onEditUser={msg.role === 'user' ? (text: string) => onEditUser(i, text) : undefined}
            loadedModelId={loadedModel?.id ?? null}
            onReload={onLoadModel}
          />
        ))}
        <div ref={bottomRef as React.RefObject<HTMLDivElement>} />
      </div>
      <InputBar
        modelLoaded={!!loadedModel}
        visionEnabled={!!loadedModel?.capabilities?.vision}
        streaming={streaming}
        params={params}
        usedTokens={usedTokens}
        maxTokens={loadedModel?.max_context_window ?? null}
        tokensExact={isTokensExact}
        onSend={onSend}
        onStop={onStop}
      />
    </>
  )

  if (view === 'projects') {
    return (
      <ProjectsPanel
        mode={mode}
        loadedModelHasTools={loadedModelHasTools}
        toolCalls={toolCalls}
        workspaceFiles={workspaceFiles}
        onRefreshFiles={onRefreshFiles}
      >
        <div className="flex flex-col flex-1 overflow-hidden">{inner}</div>
      </ProjectsPanel>
    )
  }

  return <div className="flex flex-col flex-1 overflow-hidden">{inner}</div>
}

interface PanelWrapperProps {
  side: 'left' | 'right'
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}

function PanelWrapper({ side, collapsed, onToggle, children }: PanelWrapperProps): React.ReactElement {
  const isLeft = side === 'left'
  const border = isLeft ? 'border-r' : 'border-l'

  return (
    <div className={`relative flex flex-shrink-0 ${border} border-border`}>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle button — sits on the outer edge, vertically centered */}
      <button
        onClick={onToggle}
        title={collapsed ? 'Expand' : 'Collapse'}
        className={`absolute top-1/2 -translate-y-1/2 z-10 w-4 h-10 flex items-center justify-center
          bg-elevated hover:bg-overlay border border-border text-text-muted hover:text-text-secondary
          transition-colors cursor-pointer rounded-sm
          ${isLeft ? '-right-4 rounded-l-none' : '-left-4 rounded-r-none'}`}
      >
        <motion.svg
          className="w-3 h-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          animate={{ rotate: isLeft ? (collapsed ? 0 : 180) : (collapsed ? 180 : 0) }}
          transition={{ duration: 0.2 }}
        >
          <polyline points="15 18 9 12 15 6"/>
        </motion.svg>
      </button>
    </div>
  )
}

// ── Project Workspace ──────────────────────────────────────────────────────────
// Isolated component: key={project.id} ensures fresh mount per project,
// so useProfiles initialises with the correct project scope from the start.

import type { Project } from '@/hooks/useProjects'

interface ProjectWorkspaceProps {
  project: Project
  loadedModel: ModelInfo | null
  loading: boolean
  loadingPct: number
  hasCuda: boolean
  activeMessages: ChatMessage[]
  setActiveMessages: (msgs: ChatMessage[]) => void
  onOpenPicker: () => void
  onEject: () => void
  onGoToSettings: () => void
  onBackToHub: () => void
  onLoadModel?: (config: LoadConfig) => void
  view: ChatView
  mode: ProjectMode
  onViewChange: (v: ChatView) => void
  onModeChange: (m: ProjectMode) => void
}

function ProjectWorkspace({
  project, loadedModel, loading, loadingPct, hasCuda,
  activeMessages, setActiveMessages,
  onOpenPicker, onEject, onGoToSettings, onBackToHub, onLoadModel,
  view, mode, onViewChange, onModeChange,
}: ProjectWorkspaceProps): React.ReactElement {
  const profilesHook = useProfiles({ mode: project.mode, projectId: project.id })
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [params, setParams] = useState(profilesHook.activeProfile.params)
  const prevProfileId = useRef(profilesHook.activeId)

  useEffect(() => {
    if (profilesHook.activeId !== prevProfileId.current) {
      setParams(profilesHook.activeProfile.params)
      prevProfileId.current = profilesHook.activeId
    }
  }, [profilesHook.activeId, profilesHook.activeProfile.params])

  const bottomRef = useRef<HTMLDivElement>(null)

  const chatHook = useChat(
    params, activeMessages, setActiveMessages,
    loadedModel?.max_context_window ?? undefined,
    loadedModel?.id, undefined, loadedModel?.name ?? null,
  )

  const toolChatHook = useToolChat(project.id)

  const isDevMode = project.mode === 'dev'

  const messages = isDevMode ? toolChatHook.messages : chatHook.messages
  const streaming = isDevMode ? toolChatHook.streaming : chatHook.streaming
  const stats = isDevMode ? null : chatHook.stats
  const oomError = isDevMode ? false : chatHook.oomError
  const usedTokens = isDevMode ? 0 : chatHook.usedTokens
  const isTokensExact = isDevMode ? false : chatHook.isTokensExact
  const toolCalls = isDevMode ? toolChatHook.toolCalls : []
  const workspaceFiles = isDevMode ? toolChatHook.workspaceFiles : []

  const stop = isDevMode ? toolChatHook.stop : chatHook.stop

  useEffect(() => {
    if (!isDevMode && !chatHook.streaming) chatHook.setMessages(activeMessages)
  }, [activeMessages]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleRegenerate = (): void => {
    if (isDevMode) return
    const lastIdx = [...messages].reverse().findIndex(m => m.role === 'assistant')
    if (lastIdx === -1 || !loadedModel) return
    chatHook.sendFromHistory(messages.slice(0, messages.length - 1 - lastIdx))
  }

  const handleEditUser = (index: number, newText: string): void => {
    if (isDevMode || !loadedModel) return
    const updated = { ...messages[index], content: newText }
    chatHook.sendFromHistory([...messages.slice(0, index), updated])
  }

  const handleClear = (): void => {
    if (isDevMode) { toolChatHook.clear(); return }
    chatHook.setMessages([])
    setActiveMessages([])
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <ChatTopBar
        loadedModel={loadedModel}
        loading={loading}
        loadingPct={loadingPct}
        onOpenPicker={onOpenPicker}
        onClear={handleClear}
        onEject={onEject}
        onExport={() => {}}
        view={view}
        mode={mode}
        activeProjectName={project.name}
        onViewChange={onViewChange}
        onModeChange={onModeChange}
        onBackToHub={onBackToHub}
        loadedModelHasTools={!!loadedModel?.capabilities?.tools}
      />
      {!hasCuda && <CpuBanner onGoToSettings={onGoToSettings} />}
      {oomError && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red/10 border border-red/30 rounded-md flex items-center gap-2 text-sm text-red flex-shrink-0">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Out of memory — VRAM insuffisante.
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <ChatContent
          view={view}
          mode={mode}
          loadedModelHasTools={!!loadedModel?.capabilities?.tools}
          messages={messages}
          streaming={streaming}
          stats={stats}
          activeModelName={loadedModel?.name ?? null}
          loadedModel={loadedModel}
          params={params}
          usedTokens={usedTokens}
          isTokensExact={isTokensExact}
          bottomRef={bottomRef}
          toolCalls={toolCalls}
          workspaceFiles={workspaceFiles}
          onRefreshFiles={() => {}}
          onRegenerate={handleRegenerate}
          onEditUser={handleEditUser}
          onSend={isDevMode
            ? (text) => toolChatHook.send(text, params.systemPrompt || undefined)
            : (text, attachments) => chatHook.send(text, !!loadedModel, attachments)
          }
          onStop={stop}
          onLoadModel={onLoadModel}
        />
        <PanelWrapper side="right" collapsed={rightCollapsed} onToggle={() => setRightCollapsed(v => !v)}>
          <RightPanel params={params} onChange={setParams} profiles={profilesHook} loadedModel={loadedModel} />
        </PanelWrapper>
      </div>
    </div>
  )
}
