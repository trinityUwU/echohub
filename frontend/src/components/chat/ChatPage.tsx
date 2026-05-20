import { useEffect, useRef, useState } from 'react'
import { useChat } from '@/hooks/useChat'
import { useProfiles } from '@/hooks/useProfiles'
import type { ConversationSummary, ModelInfo, GpuStats, ChatMessage, LoadConfig, ChatParams, GenerationStats, Attachment } from '@/types'
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
  const profilesHook = useProfiles()
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

  return (
    <div className="flex flex-1 overflow-hidden">
      {view === 'chat' && (
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
      )}
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
          activeProjectName={activeProject?.name ?? null}
          onViewChange={setView}
          onModeChange={setMode}
          onBackToHub={closeProject}
          loadedModelHasTools={!!loadedModel?.capabilities?.tools}
        />
        {!hasCuda && <CpuBanner onGoToSettings={onGoToSettings} />}
        <MigrationBanner onGoToSettings={onGoToSettings} />
        {(oomError || [...messages].reverse().find(m => m.role === 'assistant')?.stats?.oom) && (
          <div className="mx-4 mt-2 px-3 py-2 bg-red/10 border border-red/30 rounded-md flex items-center gap-2 text-sm text-red">
            <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Out of memory — VRAM insuffisante pour cette génération. Réduis le contexte ou recharge le modèle.
          </div>
        )}
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
          onRegenerate={handleRegenerate}
          onEditUser={handleEditUser}
          onSend={(text, attachments) => send(text, !!loadedModel, attachments)}
          onStop={stop}
          onLoadModel={onLoadModel}
        />
      </div>
      {view === 'chat' && <RightPanel params={params} onChange={setParams} profiles={profilesHook} loadedModel={loadedModel} />}
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
      <ProjectsPanel mode={mode} loadedModelHasTools={loadedModelHasTools}>
        {inner}
      </ProjectsPanel>
    )
  }

  return <>{inner}</>
}
