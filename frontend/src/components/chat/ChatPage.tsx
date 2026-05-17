import { useEffect, useRef, useState } from 'react'
import { useChat } from '@/hooks/useChat'
import { useProfiles } from '@/hooks/useProfiles'
import type { ConversationSummary, ModelInfo, GpuStats, ChatMessage } from '@/types'
import { ConvSidebar } from '@/components/nav/ConvSidebar'
import { ChatTopBar } from './ChatTopBar'
import { CpuBanner } from './CpuBanner'
import { MigrationBanner } from '@/components/shared/MigrationBanner'
import { MessageRow } from './MessageRow'
import { InputBar } from './InputBar'
import { RightPanel } from './RightPanel'

interface ChatPageProps {
  loadedModel: ModelInfo | null
  loading: boolean
  loadingPct: number
  gpu: GpuStats | null
  hasCuda: boolean
  conversations: ConversationSummary[]
  activeId: string | null
  activeMessages: ChatMessage[]
  onNewConversation: () => void
  onSelectConversation: (id: string) => void
  onOpenPicker: () => void
  onOpenLoad: () => void
  onEject: () => void
  onGoToSettings: () => void
  setActiveMessages: (msgs: ChatMessage[]) => void
}

export function ChatPage({
  loadedModel, loading, loadingPct, gpu, hasCuda,
  conversations, activeId, activeMessages,
  onNewConversation, onSelectConversation,
  onOpenPicker, onOpenLoad, onEject, onGoToSettings,
  setActiveMessages,
}: ChatPageProps): React.ReactElement {
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

  const { messages, streaming, stats, send, stop, setMessages } = useChat(
    params,
    activeMessages,
    setActiveMessages,
    loadedModel?.max_context_window ?? undefined,
    loadedModel?.id,
    activeId ?? undefined,
  )

  // Only reset messages when switching conversations, not during streaming
  useEffect(() => { setMessages(activeMessages) }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleClear = (): void => { setMessages([]); setActiveMessages([]) }

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

  return (
    <div className="flex flex-1 overflow-hidden">
      <ConvSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={onSelectConversation}
        onNew={onNewConversation}
        gpu={gpu}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        <ChatTopBar
          loadedModel={loadedModel}
          loading={loading}
          loadingPct={loadingPct}
          onOpenPicker={onOpenPicker}
          onOpenLoad={onOpenLoad}
          onClear={handleClear}
          onEject={onEject}
          onExport={handleExport}
        />
        {!hasCuda && <CpuBanner onGoToSettings={onGoToSettings} />}
        <MigrationBanner onGoToSettings={onGoToSettings} />
        <div className="flex-1 overflow-y-auto py-6">
          {messages.map((msg, i) => (
            <MessageRow
              key={msg.id ?? i}
              message={msg}
              genStats={i === messages.length - 1 && msg.role === 'assistant' ? stats : undefined}
              showThinking={params.enableThinking}
            />
          ))}
          <div ref={bottomRef} />
        </div>
        <InputBar
          modelLoaded={!!loadedModel}
          visionEnabled={!!loadedModel?.capabilities?.vision}
          streaming={streaming}
          params={params}
          onSend={(text, attachments) => send(text, !!loadedModel, attachments)}
          onStop={stop}
        />
      </div>
      <RightPanel params={params} onChange={setParams} profiles={profilesHook} />
    </div>
  )
}
