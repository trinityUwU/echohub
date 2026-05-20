import { useCallback, useEffect, useRef, useState } from 'react'
import { toolChat } from '@/api/client'
import type { ChatMessage, GenerationStats, ToolCall, WorkspaceFile } from '@/types'

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
  tokens_generated?: number
  tok_per_sec?: number
  ttft_ms?: number | null
  total_ms?: number
  engine?: string | null
  model_name?: string | null
}

interface ErrorEvent {
  type: 'error'
  error: string
}

interface ToolCallPendingEvent { type: 'tool_call_pending' }
interface ToolCallStreamingEvent { type: 'tool_call_streaming'; content: string }

type SseEvent = ToolCallEvent | ToolResultEvent | TextChunkEvent | DoneEvent | ErrorEvent | ToolCallPendingEvent | ToolCallStreamingEvent

function isSseEvent(v: unknown): v is SseEvent {
  return typeof v === 'object' && v !== null && 'type' in v
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseToolChatReturn {
  messages: ChatMessage[]
  toolCalls: ToolCall[]
  workspaceFiles: WorkspaceFile[]
  streaming: boolean
  genStats: GenerationStats | null
  usedTokens: number
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
  const [genStats, setGenStats] = useState<GenerationStats | null>(null)
  const [usedTokens, setUsedTokens] = useState(0)

  useEffect(() => {
    let alive = true
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/projects/${projectId}/workspace-files`)
        if (res.ok && alive) setWorkspaceFiles(await res.json() as WorkspaceFile[])
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => { alive = false; clearInterval(id) }
  }, [projectId])

  const optionsRef = useRef(options)
  useEffect(() => { optionsRef.current = options }, [options])

  const messagesRef = useRef<ChatMessage[]>([])
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
    setGenStats(null)
    setUsedTokens(0)
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
    setGenStats(null)
    setUsedTokens(0)
  }, [])

  const send = useCallback((text: string, systemPrompt?: string): void => {
    setStreaming(true)
    setGenStats(null)

    const userMsg: ChatMessage = { role: 'user', content: text, id: crypto.randomUUID() }

    const historyToSend = [
      ...messagesRef.current.filter(m => {
        const c = typeof m.content === 'string' ? m.content : ''
        return c.trim().length > 0
      }),
      userMsg,
    ]

    const { conversationId, onSaveMessage } = optionsRef.current
    if (conversationId && onSaveMessage) {
      void onSaveMessage(conversationId, 'user', text)
    }

    const withUser = [...messagesRef.current, userMsg]
    messagesRef.current = withUser
    setMessages(withUser)

    const assistantId = crypto.randomUUID()
    const withPlaceholder = [...withUser, { role: 'assistant' as const, content: '', id: assistantId }]
    messagesRef.current = withPlaceholder
    setMessages(withPlaceholder)

    const controller = new AbortController()
    abortRef.current = controller
    // accumulated tracks the full text for the current assistant turn
    let accumulated = ''
    // true while we are inside a <tool_call> block being streamed live
    let inToolCallBlock = false
    // tool name for the current pending tool (set when tool_call_streaming starts)
    let pendingToolName = ''

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

          if (raw.type === 'tool_call_pending') {
            // no-op
          } else if (raw.type === 'tool_call_streaming') {
            // First token of a new tool_call block — open the tag in accumulated
            if (!inToolCallBlock) {
              accumulated += '\n<tool_call>'
              inToolCallBlock = true
            }
            accumulated += raw.content
            const snap = accumulated
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', content: snap, id: assistantId }
              messagesRef.current = updated
              return updated
            })
          } else if (raw.type === 'text_chunk') {
            accumulated += raw.content
            const snap = accumulated
            setUsedTokens(Math.round(snap.length / 4))
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', content: snap, id: assistantId }
              messagesRef.current = updated
              return updated
            })
          } else if (raw.type === 'tool_call') {
            // Tool call fully parsed — close the streaming block and update DevPanel
            if (inToolCallBlock) {
              accumulated += '</tool_call>'
              inToolCallBlock = false
            }
            pendingToolName = raw.tool
            const tcId = crypto.randomUUID()
            const tc: ToolCall = { id: tcId, tool: raw.tool, args: raw.args, status: 'running' }
            setToolCalls(prev => [...prev, tc])
          } else if (raw.type === 'tool_result') {
            // Update DevPanel sidebar status
            setToolCalls(prev =>
              prev.map(tc => tc.tool === raw.tool ? { ...tc, result: raw.result, status: 'done' } : tc)
            )
            // Inject result inline
            const resultTag = `\n<tool_result tool="${raw.tool}">${raw.result}</tool_result>\n`
            accumulated += resultTag
            pendingToolName = ''
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
            if (raw.tokens_generated != null) {
              setGenStats({
                tokensGenerated: raw.tokens_generated,
                tokensPerSecond: raw.tok_per_sec ?? 0,
                timeMs: raw.total_ms ?? 0,
                promptTokens: 0,
                ttftMs: raw.ttft_ms ?? null,
                engine: raw.engine ?? null,
                modelName: raw.model_name ?? null,
              })
            }
            const { conversationId: cid, onSaveMessage: onSave } = optionsRef.current
            if (cid && onSave && accumulated) {
              void onSave(cid, 'assistant', accumulated)
            }
          } else if (raw.type === 'error') {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', content: `Error: ${raw.error}`, id: assistantId }
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
          updated[updated.length - 1] = { role: 'assistant', content: `Error: ${errMsg}`, id: assistantId }
          return updated
        })
        setStreaming(false)
      } finally {
        abortRef.current = null
        // suppress unused var warning
        void pendingToolName
      }
    })()
  }, [projectId])

  const clearAndResend = useCallback((history: ChatMessage[], newText: string, systemPrompt?: string): void => {
    abortRef.current?.abort()
    messagesRef.current = history
    setMessages(history)
    setToolCalls([])
    send(newText, systemPrompt)
  }, [send])

  return { messages, toolCalls, workspaceFiles, streaming, genStats, usedTokens, send, stop, clear, loadHistory, clearAndResend }
}
