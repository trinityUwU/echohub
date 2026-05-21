import { useEffect, useRef, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useChat } from '@/hooks/useChat'
import { useToolChat } from '@/hooks/useToolChat'
import { useProfiles } from '@/hooks/useProfiles'
import { useSkills } from '@/hooks/useSkills'
import type { ConversationSummary, ModelInfo, GpuStats, ChatMessage, LoadConfig, ChatParams, GenerationStats, Attachment, ToolCall, WorkspaceFile } from '@/types'
import type { ChatView, ProjectMode } from '@/hooks/useChatMode'
import { ConvSidebar } from '@/components/nav/ConvSidebar'
import { ChatTopBar, LogsPanel } from './ChatTopBar'
import { CpuBanner } from './CpuBanner'
import { MigrationBanner } from '@/components/shared/MigrationBanner'
import { MessageRow } from './MessageRow'
import { InputBar, type SlashCommand } from './InputBar'
import { RightPanel } from './RightPanel'
import { ProjectsPanel } from './ProjectsPanel'
import { ProjectsHub } from './ProjectsHub'
import { useChatMode } from '@/hooks/useChatMode'
import { useProjects } from '@/hooks/useProjects'
import { clearMessages, deleteMessage, addMessage } from '@/api/client'
import { useContextMenu } from '@/components/shared/useContextMenu'
import { useAlert } from '@/components/shared/useAlert'

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
  onToggleMemory?: (id: string) => void
  onOpenPicker: () => void
  onEject: () => void
  onGoToSettings: () => void
  setActiveMessages: (msgs: ChatMessage[]) => void
  onLoadModel?: (config: LoadConfig) => void
}

function buildChatSystemPrompt(params: ChatParams): string | undefined {
  const base = params.systemPrompt?.trim() ?? ''
  const rules = params.permanentRules?.trim() ?? ''
  return [
    base,
    rules ? `\n\n---\nPERMANENT RULES (always apply, never ignore):\n${rules}` : '',
  ].join('').trim() || undefined
}

export function ChatPage({
  loadedModel, loading, loadingPct, gpu, hasCuda,
  conversations, archivedConversations, activeId, activeMessages,
  onNewConversation, onSelectConversation,
  onDeleteConversation, onArchiveConversation, onUnarchiveConversation, onRenameConversation, onToggleMemory,
  onOpenPicker, onEject, onGoToSettings,
  setActiveMessages, onLoadModel,
}: ChatPageProps): React.ReactElement {
  const { view, mode, activeProject, setView, setMode, openProject, closeProject } = useChatMode()
  const projectsHook = useProjects()
  const profilesHook = useProfiles() // chat-scoped only — project workspace has its own
  const skillsHook = useSkills()
  const alertHook = useAlert()
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const toggleLeft = useCallback(() => setLeftCollapsed(v => !v), [])
  const toggleRight = useCallback(() => setRightCollapsed(v => !v), [])
  const toggleLogs = useCallback(() => setShowLogs(v => !v), [])
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

  const chatHookBase = useChat(
    params,
    activeMessages,
    setActiveMessages,
    loadedModel?.max_context_window ?? undefined,
    loadedModel?.id,
    activeId ?? undefined,
    activeModelName,
  )

  // When tool skills are active, normal chat routes through useToolChat (skill mode, no project)
  const skillChatHook = useToolChat('__skills__', {
    conversationId: activeId ?? null,
    loadConfig: loadedModel ? { model_id: loadedModel.id, engine: loadedModel.engine ?? undefined } : null,
    maxContextTokens: loadedModel?.max_context_window ?? undefined,
    onSaveMessage: useCallback(async (convId: string, role: string, content: string, stats?: import('@/types').MessageStats | null) => {
      await addMessage(convId, { id: crypto.randomUUID(), role, content, stats: stats ?? null })
    }, []),
  })

  const useSkillMode = skillsHook.hasToolSkills
  const { messages, streaming, stats, send, sendFromHistory, stop, setMessages, usedTokens, isTokensExact, oomError } = useSkillMode
    ? {
        messages: skillChatHook.messages,
        streaming: skillChatHook.streaming,
        stats: skillChatHook.genStats,
        send: (text: string, _loaded: boolean, _attachments?: Attachment[]) =>
          skillChatHook.send(text, buildChatSystemPrompt(params), skillsHook),
        sendFromHistory: (history: ChatMessage[]) => skillChatHook.sendFromHistory(history),
        stop: skillChatHook.stop,
        setMessages: (msgs: ChatMessage[]) => { skillChatHook.loadHistory(msgs.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))) },
        usedTokens: skillChatHook.usedTokens,
        isTokensExact: false,
        oomError: false,
      }
    : chatHookBase

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

  const handleCommand = useCallback((cmd: SlashCommand): void => {
    if (cmd.id === 'clear') { handleClear(); return }
    if (cmd.id === 'tokens') {
      const max = loadedModel?.max_context_window ?? 0
      alertHook.show('Token usage', `${usedTokens.toLocaleString()} / ${max.toLocaleString()} (${max ? Math.round(usedTokens / max * 100) : 0}%)`)
      return
    }
    if (cmd.id === 'model') {
      alertHook.show('Loaded model', loadedModel ? `${loadedModel.name} — ${loadedModel.engine ?? 'llama'}` : 'No model loaded')
      return
    }
  }, [handleClear, usedTokens, loadedModel, alertHook])

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
        gpu={gpu}
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
      {alertHook.element}
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
        memoryEnabled={activeConv?.memory_enabled ?? false}
        onToggleMemory={activeId && onToggleMemory ? () => onToggleMemory(activeId) : undefined}
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
        {/* Eye/Logs toggle — centered, slides down with the logs panel */}
        <motion.div
          className="absolute left-1/2 -translate-x-1/2 z-20"
          animate={{ top: showLogs ? 220 : 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          <button
            onClick={toggleLogs}
            title={showLogs ? 'Hide logs' : 'Show engine logs'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-b-md border-x border-b text-xs font-medium transition-colors cursor-pointer ${
              showLogs
                ? 'border-accent/40 bg-accent/15 text-accent'
                : 'border-border bg-surface hover:bg-overlay text-text-muted hover:text-text-secondary'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {showLogs
                ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
              }
            </svg>
            Logs
          </button>
        </motion.div>
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
          onSend={(text, attachments) => send(text, !!loadedModel, attachments, loadedModel ? { model_id: loadedModel.id, engine: loadedModel.engine ?? undefined } : null)}
          onStop={stop}
          onLoadModel={onLoadModel}
          showLogs={showLogs}
          onCommand={handleCommand}
          isDevMode={false}
        />
        <PanelWrapper side="right" collapsed={rightCollapsed} onToggle={toggleRight}>
          <RightPanel params={params} onChange={setParams} profiles={profilesHook} loadedModel={loadedModel} skills={skillsHook} />
        </PanelWrapper>
      </div>
    </div>
  )
}

interface ChatContentProps {
  view: ChatView
  mode: ProjectMode
  projectId?: string
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
  showLogs?: boolean
  onRegenerate: () => void
  onEditUser: (index: number, newText: string) => void
  onSend: (text: string, attachments?: Attachment[]) => void
  onStop: () => void
  onLoadModel?: (config: LoadConfig) => void
  onCommand?: (cmd: SlashCommand) => void
  isDevMode?: boolean
}

function ChatContent({
  view, mode, projectId, loadedModelHasTools,
  messages, streaming, stats, activeModelName, loadedModel,
  params, usedTokens, isTokensExact, bottomRef,
  toolCalls, workspaceFiles, onRefreshFiles,
  onRegenerate, onEditUser, onSend, onStop, onLoadModel, showLogs,
  onCommand, isDevMode,
}: ChatContentProps): React.ReactElement {
  const inner = (
    <>
      <LogsPanel active={showLogs ?? false} />
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
        isDevMode={isDevMode}
        onSend={onSend}
        onStop={onStop}
        onCommand={onCommand}
      />
    </>
  )

  if (view === 'projects') {
    return (
      <ProjectsPanel
        mode={mode}
        projectId={projectId ?? ''}
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
    <div className={`relative flex flex-shrink-0 h-full ${border} border-border`}>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="panel"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-x-hidden h-full"
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
import { useProjectConversations } from '@/hooks/useProjectConversations'
import type { ProjectConversation } from '@/hooks/useProjectConversations'

function buildDevSystemPrompt(params: ChatParams): string | undefined {
  const base = params.systemPrompt?.trim() ?? ''
  const rules = params.permanentRules?.trim() ?? ''
  return [
    base,
    rules ? `\n\n---\nPERMANENT RULES (always apply, never ignore):\n${rules}` : '',
  ].join('').trim() || undefined
}

interface ProjectWorkspaceProps {
  project: Project
  loadedModel: ModelInfo | null
  loading: boolean
  loadingPct: number
  hasCuda: boolean
  gpu: GpuStats | null
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
  project, loadedModel, loading, loadingPct, hasCuda, gpu,
  activeMessages, setActiveMessages,
  onOpenPicker, onEject, onGoToSettings, onBackToHub, onLoadModel,
  view, mode, onViewChange, onModeChange,
}: ProjectWorkspaceProps): React.ReactElement {
  const profilesHook = useProfiles({ mode: project.mode, projectId: project.id })
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [convSidebarCollapsed, setConvSidebarCollapsed] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [params, setParams] = useState(profilesHook.activeProfile.params)
  const prevProfileId = useRef(profilesHook.activeId)

  useEffect(() => {
    if (profilesHook.activeId !== prevProfileId.current) {
      setParams(profilesHook.activeProfile.params)
      prevProfileId.current = profilesHook.activeId
    }
  }, [profilesHook.activeId, profilesHook.activeProfile.params])

  const bottomRef = useRef<HTMLDivElement>(null)

  const convHook = useProjectConversations(project.id)

  const chatHook = useChat(
    params, activeMessages, setActiveMessages,
    loadedModel?.max_context_window ?? undefined,
    loadedModel?.id, undefined, loadedModel?.name ?? null,
  )

  const toolChatHook = useToolChat(project.id, {
    conversationId: convHook.activeId,
    projectMode: project.mode,
    loadConfig: loadedModel ? { model_id: loadedModel.id, engine: loadedModel.engine ?? undefined } : null,
    onSaveMessage: convHook.saveMessage,
    maxContextTokens: loadedModel?.max_context_window ?? undefined,
  })

  const projectSkillsHook = useSkills()
  const projectAlertHook = useAlert()
  const isDevMode = project.mode === 'dev'

  // Load history when active conversation changes
  const prevConvId = useRef<string | null>(null)
  useEffect(() => {
    if (!isDevMode || !convHook.activeId) return
    if (convHook.activeId === prevConvId.current) return
    prevConvId.current = convHook.activeId
    convHook.loadMessages(convHook.activeId).then(msgs => {
      toolChatHook.loadHistory(msgs)
    }).catch(() => {})
  }, [convHook.activeId, isDevMode]) // eslint-disable-line react-hooks/exhaustive-deps

  const messages = isDevMode ? toolChatHook.messages : chatHook.messages
  const streaming = isDevMode ? toolChatHook.streaming : chatHook.streaming
  const stats = isDevMode ? toolChatHook.genStats : chatHook.stats
  const oomError = isDevMode ? false : chatHook.oomError
  const usedTokens = isDevMode ? toolChatHook.usedTokens : chatHook.usedTokens
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
    if (!loadedModel) return
    const lastIdx = [...messages].reverse().findIndex(m => m.role === 'assistant')
    if (lastIdx === -1) return
    const history = messages.slice(0, messages.length - 1 - lastIdx)
    if (isDevMode) {
      const lastUser = [...history].reverse().find(m => m.role === 'user' && !String(m.content).startsWith('[tool:'))
      if (!lastUser) return
      // Clear state and resend only the user messages up to this point
      const _devSys = buildDevSystemPrompt(params)
      toolChatHook.clearAndResend(
        history.filter(m => m.role === 'user' && !String(m.content).startsWith('[tool:')),
        typeof lastUser.content === 'string' ? lastUser.content : '',
        _devSys,
        projectSkillsHook,
      )
    } else {
      chatHook.sendFromHistory(history)
    }
  }

  const handleEditUser = (index: number, newText: string): void => {
    if (!loadedModel) return
    if (isDevMode) {
      const prevUserMessages = messages.slice(0, index).filter(m => m.role === 'user' && !String(m.content).startsWith('[tool:'))
      toolChatHook.clearAndResend(prevUserMessages, newText, buildDevSystemPrompt(params), projectSkillsHook)
    } else {
      const updated = { ...messages[index], content: newText }
      chatHook.sendFromHistory([...messages.slice(0, index), updated])
    }
  }

  const handleClear = (): void => {
    if (isDevMode) {
      toolChatHook.clear()
      if (convHook.activeId) void convHook.clearMessages(convHook.activeId)
      return
    }
    chatHook.setMessages([])
    setActiveMessages([])
  }

  const handleCommand = useCallback((cmd: SlashCommand): void => {
    if (cmd.id === 'clear') { handleClear(); return }
    if (cmd.id === 'compact' && isDevMode) {
      // Trigger immediate compaction by forcing usedTokens to 99% of context
      // The compact function is internal to useToolChat, so we trigger via a dummy send
      // Instead, expose compact directly
      void toolChatHook.compact()
      return
    }
    if (cmd.id === 'tokens') {
      const used = usedTokens
      const max = loadedModel?.max_context_window ?? 0
      projectAlertHook.show('Token usage', `${used.toLocaleString()} / ${max.toLocaleString()} (${max ? Math.round(used / max * 100) : 0}%)`)
      return
    }
    if (cmd.id === 'model') {
      projectAlertHook.show('Loaded model', loadedModel ? `${loadedModel.name} — ${loadedModel.engine ?? 'llama'}` : 'No model loaded')
      return
    }
    if (cmd.id === 'limit' && isDevMode) {
      // Inject a message to the model asking it to call set_tool_limit
      void toolChatHook.send(
        `Call set_tool_limit with new_limit=${cmd.value} and reason="User requested limit increase via /limit command."`,
        buildDevSystemPrompt(params),
        projectSkillsHook,
      )
      return
    }
  }, [handleClear, isDevMode, toolChatHook, usedTokens, loadedModel, params])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {projectAlertHook.element}
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
      <div className="flex flex-1 overflow-hidden relative">
        {/* Eye/Logs toggle — same as chat workspace */}
        <motion.div
          className="absolute left-1/2 -translate-x-1/2 z-20"
          animate={{ top: showLogs ? 220 : 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          <button
            onClick={() => setShowLogs(v => !v)}
            title={showLogs ? 'Hide logs' : 'Show engine logs'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-b-md border-x border-b text-xs font-medium transition-colors cursor-pointer ${
              showLogs ? 'border-accent/40 bg-accent/15 text-accent' : 'border-border bg-surface hover:bg-overlay text-text-muted hover:text-text-secondary'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {showLogs
                ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
              }
            </svg>
            Logs
          </button>
        </motion.div>
        {isDevMode && (
          <PanelWrapper side="left" collapsed={convSidebarCollapsed} onToggle={() => setConvSidebarCollapsed(v => !v)}>
            <ProjectConvSidebar
              conversations={convHook.conversations}
              activeId={convHook.activeId}
              gpu={gpu}
              onSelect={id => { convHook.selectConversation(id) }}
              onNew={() => { void convHook.createConversation() }}
              onDelete={id => { void convHook.deleteConversation(id) }}
              onRename={convHook.renameConversation}
            />
          </PanelWrapper>
        )}
        <ChatContent
          view={view}
          mode={mode}
          projectId={project.id}
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
            ? (text) => toolChatHook.send(text, buildDevSystemPrompt(params), projectSkillsHook)
            : (text, attachments) => chatHook.send(text, !!loadedModel, attachments, loadedModel ? { model_id: loadedModel.id, engine: loadedModel.engine ?? undefined } : null)
          }
          onStop={stop}
          onLoadModel={onLoadModel}
          showLogs={showLogs}
          onCommand={handleCommand}
          isDevMode={isDevMode}
        />
        <PanelWrapper side="right" collapsed={rightCollapsed} onToggle={() => setRightCollapsed(v => !v)}>
          <RightPanel params={params} onChange={setParams} profiles={profilesHook} loadedModel={loadedModel} skills={projectSkillsHook} />
        </PanelWrapper>
      </div>
    </div>
  )
}

// ── Project Conversation Sidebar ───────────────────────────────────────────

interface ProjectConvSidebarProps {
  conversations: ProjectConversation[]
  activeId: string | null
  gpu: GpuStats | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => Promise<void>
}

function ProjectConvSidebar({
  conversations, activeId, gpu, onSelect, onNew, onDelete, onRename,
}: ProjectConvSidebarProps): React.ReactElement {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const { open: openCtx } = useContextMenu()

  const handleContextMenu = (e: React.MouseEvent, conv: ProjectConversation): void => {
    const RenameIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    const DeleteIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/></svg>
    openCtx(e, [
      { label: 'Rename', icon: RenameIcon, onClick: () => setRenamingId(conv.id) },
      { label: '', separator: true, onClick: () => {} },
      { label: 'Delete', icon: DeleteIcon, danger: true, onClick: () => onDelete(conv.id) },
    ])
  }

  return (
    <aside className="w-[240px] h-full bg-surface border-r border-border flex flex-col flex-shrink-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-border">
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-widest text-text-muted">Chats</h2>
        <button onClick={onNew}
          className="w-[26px] h-[26px] flex items-center justify-center rounded-sm hover:bg-overlay text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          title="New chat">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 && (
          <div className="text-xs text-text-muted text-center py-8 px-2">No conversations yet.<br/>Click + to start.</div>
        )}
        {conversations.map(conv => (
          <ProjConvItem
            key={conv.id}
            conv={conv}
            active={conv.id === activeId}
            renaming={renamingId === conv.id}
            onClick={() => { if (renamingId !== conv.id) onSelect(conv.id) }}
            onContextMenu={e => handleContextMenu(e, conv)}
            onDelete={() => onDelete(conv.id)}
            onRenameStart={() => setRenamingId(conv.id)}
            onRenameSubmit={title => { setRenamingId(null); void onRename(conv.id, title) }}
            onRenameCancel={() => setRenamingId(null)}
          />
        ))}
      </div>

      {gpu && <ProjGpuSection gpu={gpu} />}
    </aside>
  )
}

function ProjConvItem({ conv, active, renaming, onClick, onContextMenu, onDelete, onRenameStart, onRenameSubmit, onRenameCancel }: {
  conv: ProjectConversation; active: boolean; renaming: boolean
  onClick: () => void; onContextMenu: (e: React.MouseEvent) => void
  onDelete: () => void; onRenameStart: () => void
  onRenameSubmit: (t: string) => void; onRenameCancel: () => void
}): React.ReactElement {
  const [val, setVal] = useState(conv.title)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) { setVal(conv.title); setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0) }
  }, [renaming, conv.title])
  const submit = (): void => { const v = val.trim(); if (v && v !== conv.title) onRenameSubmit(v); else onRenameCancel() }

  return (
    <div
      className={`group flex items-center rounded-sm mb-0.5 cursor-pointer transition-colors ${active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-overlay hover:text-text-primary'}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {renaming ? (
        <input
          ref={inputRef}
          className="flex-1 px-2.5 py-1.5 text-sm bg-transparent outline-none"
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={submit}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onRenameCancel() }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <>
          <span className="flex-1 px-2.5 py-1.5 text-sm truncate">{conv.title}</span>
          <div className="hidden group-hover:flex items-center gap-0.5 pr-1">
            <button title="Rename" onClick={e => { e.stopPropagation(); onRenameStart() }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-overlay text-text-muted hover:text-text-secondary cursor-pointer">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button title="Delete" onClick={e => { e.stopPropagation(); onDelete() }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-red/20 text-text-muted hover:text-red cursor-pointer">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ProjGpuSection({ gpu }: { gpu: GpuStats }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const vramPct = gpu.vram_total_mb > 0 ? gpu.vram_used_mb / gpu.vram_total_mb : 0
  const gpuPct  = gpu.gpu_utilization_pct ?? 0
  const usedGb  = (gpu.vram_used_mb / 1024).toFixed(1)
  const totalGb = (gpu.vram_total_mb / 1024).toFixed(0)
  const shortName = gpu.name.replace('NVIDIA GeForce ', '').replace('AMD Radeon ', '').replace('Apple ', '')
  return (
    <div className="border-t border-border mt-auto">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-overlay transition-colors cursor-pointer">
        <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-green flex-shrink-0" />
          GPUs (1)
        </div>
        <svg className={`w-3 h-3 stroke-text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5">
          <div className="text-xs font-medium text-text-primary truncate">{shortName}</div>
          {[
            { label: 'VRAM', value: `${usedGb}/${totalGb} GB`, pct: vramPct, color: vramPct > 0.9 ? 'bg-red' : vramPct > 0.75 ? 'bg-yellow' : 'bg-accent' },
            ...(gpu.vram_total_mb > 0 ? [{ label: 'GPU', value: `${gpuPct}%`, pct: gpuPct / 100, color: gpuPct > 90 ? 'bg-red' : gpuPct > 70 ? 'bg-yellow' : 'bg-green' }] : []),
          ].map(b => (
            <div key={b.label}>
              <div className="flex justify-between text-2xs text-text-muted mb-1"><span>{b.label}</span><span className="font-mono">{b.value}</span></div>
              <div className="h-1.5 bg-overlay rounded-sm overflow-hidden">
                <div className={`h-full rounded-sm transition-all duration-500 ${b.color}`} style={{ width: `${Math.min(b.pct * 100, 100)}%` }} />
              </div>
            </div>
          ))}
          {gpu.temperature_c != null && (
            <div className="flex justify-between text-2xs">
              <span className="text-text-muted">Temp</span>
              <span className={`font-mono ${gpu.temperature_c > 80 ? 'text-red' : gpu.temperature_c > 70 ? 'text-yellow' : 'text-text-muted'}`}>{gpu.temperature_c}°C</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
