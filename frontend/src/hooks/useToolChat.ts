import { useCallback, useEffect, useRef, useState } from 'react'
import { toolChat } from '@/api/client'
import type { ChatMessage, ToolCall, WorkspaceFile } from '@/types'

// ── SSE event shapes ──────────────────────────────────────────────────────────

interface ToolCallEvent {
  type: 'tool_call'
  tool: string
  args: Record<string, unknown>
}

interface ToolResultEvent {
  type: 'tool_result'
  tool: string
  result: string
}

interface TextChunkEvent {
  type: 'text_chunk'
  content: string
}

interface DoneEvent {
  type: 'done'
  files: WorkspaceFile[]
}

interface ErrorEvent {
  type: 'error'
  error: string
}

type SseEvent = ToolCallEvent | ToolResultEvent | TextChunkEvent | DoneEvent | ErrorEvent

function isSseEvent(v: unknown): v is SseEvent {
  return typeof v === 'object' && v !== null && 'type' in v
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseToolChatReturn {
  messages: ChatMessage[]
  toolCalls: ToolCall[]
  workspaceFiles: WorkspaceFile[]
  streaming: boolean
  send: (text: string, systemPrompt?: string) => void
  stop: () => void
  clear: () => void
  loadHistory: (msgs: Array<{ role: string; content: string }>) => void
  clearAndResend: (history: ChatMessage[], newText: string, systemPrompt?: string) => void
}

interface UseToolChatOptions {
  conversationId: string | null
  onSaveMessage?: (convId: string, role: string, content: string) => Promise<void>
}

export function useToolChat(projectId: string, options: UseToolChatOptions = { conversationId: null }): UseToolChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])
  const [streaming, setStreaming] = useState(false)
  const optionsRef = useRef(options)

  // Keep options ref fresh so send() always reads current values
  useEffect(() => { optionsRef.current = options }, [options])

  // Maps tool name → local ToolCall id so we can update status on tool_result
  // Maps tool name → marker message id (for inline chat display)
  const messagesRef = useRef<ChatMessage[]>([])
  const pendingToolMap = useRef<Map<string, string>>(new Map())
  const pendingToolMsgMap = useRef<Map<string, string>>(new Map())
  const abortRef = useRef<AbortController | null>(null)

  const stop = useCallback((): void => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }, [])

  const clear = useCallback((): void => {
    messagesRef.current = []
    setMessages([])
    setToolCalls([])
    setWorkspaceFiles([])
    pendingToolMap.current.clear()
    pendingToolMsgMap.current.clear()
  }, [])

  const loadHistory = useCallback((msgs: Array<{ role: string; content: string }>): void => {
    const hydrated: ChatMessage[] = msgs.map(m => ({
      role: m.role as ChatMessage['role'],
      content: m.content,
      id: crypto.randomUUID(),
    }))
    messagesRef.current = hydrated
    setMessages(hydrated)
    setToolCalls([])
    setWorkspaceFiles([])
    pendingToolMap.current.clear()
    pendingToolMsgMap.current.clear()
  }, [])

  const send = useCallback((text: string, systemPrompt?: string): void => {
    setStreaming(true)

    const userMsg: ChatMessage = { role: 'user', content: text, id: crypto.randomUUID() }

    // Build the messages to send synchronously using the ref (not state, which is async)
    const historyToSend = [
      ...messagesRef.current.filter(m => {
        const c = typeof m.content === 'string' ? m.content : ''
        if (c.trim().length === 0) return false
        // Exclude inline tool-call marker messages — backend must not see them
        if (c.startsWith('[tool:')) return false
        return true
      }),
      userMsg,
    ]

    // Persist user message
    const { conversationId, onSaveMessage } = optionsRef.current
    if (conversationId && onSaveMessage) {
      void onSaveMessage(conversationId, 'user', text)
    }

    // Update state + ref
    const withUser = [...messagesRef.current, userMsg]
    messagesRef.current = withUser
    setMessages(withUser)

    // Seed the assistant placeholder
    const assistantId = crypto.randomUUID()
    const withPlaceholder = [...withUser, { role: 'assistant' as const, content: '', id: assistantId }]
    messagesRef.current = withPlaceholder
    setMessages(withPlaceholder)

    const controller = new AbortController()
    abortRef.current = controller
    let accumulated = ''

    const req = {
      messages: historyToSend.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      })),
      project_id: projectId,
      system_prompt: systemPrompt,
    }

    ;(async (): Promise<void> => {
      try {
        for await (const raw of toolChat(req)) {
          if (controller.signal.aborted) break
          if (!isSseEvent(raw)) continue

          if (raw.type === 'tool_call') {
            const tcId = crypto.randomUUID()
            const tc: ToolCall = {
              id: tcId,
              tool: raw.tool,
              args: raw.args,
              status: 'running',
            }
            pendingToolMap.current.set(raw.tool, tcId)
            setToolCalls(prev => [...prev, tc])

            // Insert inline marker message before the assistant placeholder
            const markerMsgId = crypto.randomUUID()
            const markerContent = `[tool:${raw.tool}]${JSON.stringify(raw.args)}`
            const markerMsg: ChatMessage = { role: 'assistant', content: markerContent, id: markerMsgId }
            pendingToolMsgMap.current.set(raw.tool, markerMsgId)
            setMessages(prev => {
              // Insert before last element (the assistant placeholder)
              const updated = [...prev.slice(0, -1), markerMsg, prev[prev.length - 1]]
              messagesRef.current = updated
              return updated
            })
          } else if (raw.type === 'tool_result') {
            const tcId = pendingToolMap.current.get(raw.tool)
            if (tcId) {
              setToolCalls(prev =>
                prev.map(tc =>
                  tc.id === tcId ? { ...tc, result: raw.result, status: 'done' } : tc,
                ),
              )
              pendingToolMap.current.delete(raw.tool)
            }
            // Update inline marker message with result
            const markerMsgId = pendingToolMsgMap.current.get(raw.tool)
            if (markerMsgId) {
              const resultContent = `[tool:${raw.tool}]${JSON.stringify(raw.result)}`
              setMessages(prev => {
                const updated = prev.map(m =>
                  m.id === markerMsgId ? { ...m, content: resultContent } : m,
                )
                messagesRef.current = updated
                return updated
              })
              pendingToolMsgMap.current.delete(raw.tool)
            }
          } else if (raw.type === 'text_chunk') {
            accumulated += raw.content
            const snap = accumulated
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', content: snap, id: assistantId }
              messagesRef.current = updated
              return updated
            })
          } else if (raw.type === 'done') {
            setWorkspaceFiles(raw.files)
            setStreaming(false)
            // Persist completed assistant message
            const { conversationId: cid, onSaveMessage: onSave } = optionsRef.current
            if (cid && onSave && accumulated) {
              void onSave(cid, 'assistant', accumulated)
            }
          } else if (raw.type === 'error') {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                role: 'assistant',
                content: `Error: ${raw.error}`,
                id: assistantId,
              }
              messagesRef.current = updated
              return updated
            })
            setStreaming(false)
          }
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          setStreaming(false)
          return
        }
        const errMsg = e instanceof Error ? e.message : String(e)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'assistant',
            content: `Error: ${errMsg}`,
            id: assistantId,
          }
          return updated
        })
        setStreaming(false)
      } finally {
        abortRef.current = null
      }
    })()
  }, [projectId])

  const clearAndResend = useCallback((history: ChatMessage[], newText: string, systemPrompt?: string): void => {
    // Reset state to only the provided history, then send newText
    abortRef.current?.abort()
    messagesRef.current = history
    setMessages(history)
    setToolCalls([])
    pendingToolMap.current.clear()
    pendingToolMsgMap.current.clear()
    send(newText, systemPrompt)
  }, [send])

  return { messages, toolCalls, workspaceFiles, streaming, send, stop, clear, loadHistory, clearAndResend }
}
