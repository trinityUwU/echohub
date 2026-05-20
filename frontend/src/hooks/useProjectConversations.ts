import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '@/api/base'

export interface ProjectConversation {
  id: string
  project_id: string
  title: string
  created_at: number
  updated_at: number
}

interface ProjectMessage {
  role: string
  content: string
}

export interface UseProjectConversationsReturn {
  conversations: ProjectConversation[]
  activeId: string | null
  createConversation: () => Promise<string>
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  loadMessages: (convId: string) => Promise<ProjectMessage[]>
  saveMessage: (convId: string, role: string, content: string) => Promise<void>
  clearMessages: (convId: string) => Promise<void>
}

const LS_KEY = (projectId: string): string => `echohub:project-conv:${projectId}`

export function useProjectConversations(projectId: string): UseProjectConversationsReturn {
  const [conversations, setConversations] = useState<ProjectConversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const initialized = useRef(false)

  const fetchConversations = useCallback(async (): Promise<ProjectConversation[]> => {
    try {
      const data = await apiRequest<ProjectConversation[]>(`/projects/${projectId}/conversations`)
      setConversations(data)
      return data
    } catch (err) {
      console.error('useProjectConversations: fetchConversations', err)
      return []
    }
  }, [projectId])

  // On mount: load conversations, restore or create active
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    void (async () => {
      const list = await fetchConversations()
      const stored = localStorage.getItem(LS_KEY(projectId))

      if (stored && list.find(c => c.id === stored)) {
        setActiveId(stored)
        return
      }

      if (list.length > 0) {
        const first = list[0].id
        setActiveId(first)
        localStorage.setItem(LS_KEY(projectId), first)
        return
      }

      // No conversations exist — create one
      try {
        const conv = await apiRequest<ProjectConversation>(`/projects/${projectId}/conversations`, {
          method: 'POST',
          body: JSON.stringify({ title: 'New conversation' }),
        })
        setConversations([conv])
        setActiveId(conv.id)
        localStorage.setItem(LS_KEY(projectId), conv.id)
      } catch (err) {
        console.error('useProjectConversations: auto-create', err)
      }
    })()
  }, [projectId, fetchConversations])

  const createConversation = useCallback(async (): Promise<string> => {
    const conv = await apiRequest<ProjectConversation>(`/projects/${projectId}/conversations`, {
      method: 'POST',
      body: JSON.stringify({ title: 'New conversation' }),
    })
    setConversations(prev => [conv, ...prev])
    setActiveId(conv.id)
    localStorage.setItem(LS_KEY(projectId), conv.id)
    return conv.id
  }, [projectId])

  const selectConversation = useCallback((id: string): void => {
    setActiveId(id)
    localStorage.setItem(LS_KEY(projectId), id)
  }, [projectId])

  const deleteConversation = useCallback(async (id: string): Promise<void> => {
    await apiRequest<{ ok: boolean }>(`/projects/${projectId}/conversations/${id}`, { method: 'DELETE' })
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id)
      // If deleting the active one, switch to the next or create
      if (id === activeId) {
        if (next.length > 0) {
          setActiveId(next[0].id)
          localStorage.setItem(LS_KEY(projectId), next[0].id)
        } else {
          setActiveId(null)
          localStorage.removeItem(LS_KEY(projectId))
        }
      }
      return next
    })
  }, [projectId, activeId])

  const renameConversation = useCallback(async (id: string, title: string): Promise<void> => {
    await apiRequest<{ ok: boolean }>(`/projects/${projectId}/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c))
  }, [projectId])

  const loadMessages = useCallback(async (convId: string): Promise<ProjectMessage[]> => {
    try {
      const data = await apiRequest<Array<{ role: string; content: string }>>(
        `/projects/${projectId}/conversations/${convId}/messages`
      )
      return data
    } catch (err) {
      console.error('useProjectConversations: loadMessages', err)
      return []
    }
  }, [projectId])

  const saveMessage = useCallback(async (convId: string, role: string, content: string): Promise<void> => {
    try {
      await apiRequest(`/projects/${projectId}/conversations/${convId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ role, content }),
      })
      // Bump updated_at in local state
      const now = Date.now() / 1000
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, updated_at: now } : c))
    } catch (err) {
      console.error('useProjectConversations: saveMessage', err)
    }
  }, [projectId])

  const clearMessages = useCallback(async (convId: string): Promise<void> => {
    try {
      await apiRequest(`/projects/${projectId}/conversations/${convId}/messages`, { method: 'DELETE' })
    } catch (err) {
      console.error('useProjectConversations: clearMessages', err)
    }
  }, [projectId])

  return {
    conversations,
    activeId,
    createConversation,
    selectConversation,
    deleteConversation,
    renameConversation,
    loadMessages,
    saveMessage,
    clearMessages,
  }
}
