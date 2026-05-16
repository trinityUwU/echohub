import { useEffect, useRef, useState } from 'react'
import { useChat, DEFAULT_CHAT_PARAMS } from '@/hooks/useChat'
import type { ConversationSummary, ModelInfo, GpuStats, ChatMessage, ChatParams } from '@/types'
import { ConvSidebar } from '@/components/nav/ConvSidebar'
import { ChatTopBar } from './ChatTopBar'
import { CpuBanner } from './CpuBanner'
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
  const [params, setParams] = useState<ChatParams>(DEFAULT_CHAT_PARAMS)
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
        />
        {!hasCuda && <CpuBanner onGoToSettings={onGoToSettings} />}
        <div className="flex-1 overflow-y-auto py-6">
          {messages.map((msg, i) => (
            <MessageRow
              key={msg.id ?? i}
              message={msg}
              genStats={i === messages.length - 1 && msg.role === 'assistant' ? stats : undefined}
            />
          ))}
          <div ref={bottomRef} />
        </div>
        <InputBar
          modelLoaded={!!loadedModel}
          streaming={streaming}
          params={params}
          onSend={text => send(text, !!loadedModel)}
          onStop={stop}
        />
      </div>
      <RightPanel params={params} onChange={setParams} />
    </div>
  )
}
