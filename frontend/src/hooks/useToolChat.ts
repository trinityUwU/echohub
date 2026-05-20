import { useCallback, useRef, useState } from 'react'
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
}

export function useToolChat(projectId: string): UseToolChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])
  const [streaming, setStreaming] = useState(false)

  // Maps tool name → local ToolCall id so we can update status on tool_result
  const pendingToolMap = useRef<Map<string, string>>(new Map())
  const abortRef = useRef<AbortController | null>(null)

  const stop = useCallback((): void => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }, [])

  const clear = useCallback((): void => {
    setMessages([])
    setToolCalls([])
    setWorkspaceFiles([])
    pendingToolMap.current.clear()
  }, [])

  const send = useCallback((text: string, systemPrompt?: string): void => {
    setStreaming(true)

    const userMsg: ChatMessage = { role: 'user', content: text, id: crypto.randomUUID() }
    let currentMessages: ChatMessage[] = []
    setMessages(prev => {
      currentMessages = [...prev, userMsg]
      return currentMessages
    })

    // Seed the assistant placeholder immediately
    const assistantId = crypto.randomUUID()
    setMessages(prev => [...prev, { role: 'assistant', content: '', id: assistantId }])

    const controller = new AbortController()
    abortRef.current = controller
    let accumulated = ''

    const req = {
      messages: [...currentMessages].map(m => ({
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
          } else if (raw.type === 'text_chunk') {
            accumulated += raw.content
            const snap = accumulated
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', content: snap, id: assistantId }
              return updated
            })
          } else if (raw.type === 'done') {
            setWorkspaceFiles(raw.files)
            setStreaming(false)
          } else if (raw.type === 'error') {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = {
                role: 'assistant',
                content: `Error: ${raw.error}`,
                id: assistantId,
              }
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

  return { messages, toolCalls, workspaceFiles, streaming, send, stop, clear }
}
