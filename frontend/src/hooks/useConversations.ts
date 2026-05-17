import { useCallback, useEffect, useState } from 'react'
import {
  createConversation,
  deleteConversation as apiDeleteConversation,
  getConversations,
  getArchivedConversations,
  archiveConversation as apiArchive,
  unarchiveConversation as apiUnarchive,
  getMessages,
  updateConversation,
} from '@/api/client'
import type { ChatMessage, ConversationSummary } from '@/types'

export type { ConversationSummary }

function chatMessageFromStored(stored: import('@/types').StoredMessage): ChatMessage {
  return {
    id: stored.id,
    role: stored.role,
    content: stored.content,
    stats: stored.stats,
  }
}

export function useConversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [archivedConversations, setArchivedConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)

  // Load conversation list at mount
  useEffect(() => {
    Promise.all([getConversations(), getArchivedConversations().catch(() => [])])
      .then(([convs, archived]) => {
        setArchivedConversations(archived)
        setConversations(convs)
        if (convs.length > 0) {
          const first = convs[0]
          setActiveId(first.id)
          return getMessages(first.id).then(msgs => {
            setActiveMessages(msgs.map(chatMessageFromStored))
          })
        }
      })
      .catch(() => {/* ignore — backend may not be ready */})
      .finally(() => setLoading(false))
  }, [])

  const active = activeId
    ? (() => {
        const conv = conversations.find(c => c.id === activeId)
        if (!conv) return null
        return { id: conv.id, title: conv.title, messages: activeMessages, model_id: conv.model_id }
      })()
    : null

  const newConversation = useCallback(async (modelId?: string) => {
    const id = crypto.randomUUID()
    const conv = await createConversation(id, 'New Chat', modelId)
    setConversations(prev => [conv, ...prev])
    setActiveId(conv.id)
    setActiveMessages([])
    return conv
  }, [])

  const selectConversation = useCallback(async (id: string) => {
    setActiveId(id)
    try {
      const msgs = await getMessages(id)
      setActiveMessages(msgs.map(chatMessageFromStored))
    } catch {
      setActiveMessages([])
    }
  }, [])

  const deleteConversation = useCallback(async (id: string) => {
    await apiDeleteConversation(id)
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id)
      if (activeId === id) {
        const nextActive = next[0] ?? null
        setActiveId(nextActive?.id ?? null)
        if (nextActive) {
          getMessages(nextActive.id)
            .then(msgs => setActiveMessages(msgs.map(chatMessageFromStored)))
            .catch(() => setActiveMessages([]))
        } else {
          setActiveMessages([])
        }
      }
      return next
    })
  }, [activeId])

  const archiveConversation = useCallback(async (id: string) => {
    await apiArchive(id)
    const conv = conversations.find(c => c.id === id)
    if (conv) {
      setConversations(prev => prev.filter(c => c.id !== id))
      setArchivedConversations(prev => [conv, ...prev])
      if (activeId === id) { setActiveId(null); setActiveMessages([]) }
    }
  }, [conversations, activeId])

  const unarchiveConversation = useCallback(async (id: string) => {
    await apiUnarchive(id)
    const conv = archivedConversations.find(c => c.id === id)
    if (conv) {
      setArchivedConversations(prev => prev.filter(c => c.id !== id))
      setConversations(prev => [conv, ...prev])
    }
  }, [archivedConversations])

  const renameConversation = useCallback(async (id: string, title: string) => {
    const updated = await updateConversation(id, { title })
    setConversations(prev => prev.map(c => c.id === id ? updated : c))
  }, [])

  // No-op kept for API compatibility — persistence is now via addMessage in useChat
  const updateMessages = useCallback((_convId: string, _messages: ChatMessage[]) => {
    // no-op: messages are persisted directly via addMessage API calls
  }, [])

  return {
    conversations,
    active,
    activeId,
    activeMessages,
    loading,
    newConversation,
    selectConversation,
    updateMessages,
    deleteConversation,
    archiveConversation,
    unarchiveConversation,
    archivedConversations,
    renameConversation,
    setActiveMessages,
  }
}
