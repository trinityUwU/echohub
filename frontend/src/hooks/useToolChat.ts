import { useCallback, useEffect, useRef, useState } from 'react'
import { toolChat, summarizeMessages } from '@/api/client'
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
  send: (text: string, systemPrompt?: string) => Promise<void>
  stop: () => void
  clear: () => void
  loadHistory: (msgs: Array<{ role: string; content: string }>) => void
  clearAndResend: (history: ChatMessage[], newText: string, systemPrompt?: string) => void
}

interface UseToolChatOptions {
  conversationId: string | null
  onSaveMessage?: (convId: string, role: string, content: string) => Promise<void>
  maxContextTokens?: number
}

export function useToolChat(projectId: string, options: UseToolChatOptions = { conversationId: null }): UseToolChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([])
  const [streaming, setStreaming] = useState(false)
  const [genStats, setGenStats] = useState<GenerationStats | null>(null)
  const [usedTokens, _setUsedTokensState] = useState(0)
  const usedTokensRef = useRef(0)
  const _setUsedTokens = useCallback((n: number) => {
    usedTokensRef.current = n
    _setUsedTokensState(n)
  }, [])

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
    _setUsedTokens(0)
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
    _setUsedTokens(0)
  }, [])

  // compactedSummaryRef: holds the current summary for injection into historyToSend.
  // Chat display is NEVER modified — all messages stay visible.
  const compactedSummaryRef = useRef<string | null>(null)

  // Runs compact in background, shows animation in chat via a transient marker message
  const compact = useCallback(async (): Promise<void> => {
    const msgs = messagesRef.current
    const human = msgs.filter(m => {
      const c = typeof m.content === 'string' ? m.content : ''
      return (m.role === 'user' || m.role === 'assistant') && c.trim()
    })
    if (human.length < 4) return

    // Show "compacting…" indicator at end of chat (display only — messagesRef untouched)
    const markerId = crypto.randomUUID()
    const compactingMsg: ChatMessage = { role: 'system', content: '__compacting__', id: markerId }
    setMessages(prev => [...prev, compactingMsg])

    try {
      const toSummarize = human.slice(0, -4)
      const { summary } = await summarizeMessages(toSummarize)
      compactedSummaryRef.current = summary

      // Replace spinner with "done" marker (display only)
      const doneMsg: ChatMessage = { role: 'system', content: `__compacted__:${summary}`, id: markerId }
      setMessages(prev => prev.map(m => m.id === markerId ? doneMsg : m))

      // Update token estimate to reflect compacted context size
      const summaryTokens = Math.round(summary.length / 4)
      const recentTokens = human.slice(-4).reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 0), 0)
      _setUsedTokens(Math.round(summaryTokens + recentTokens / 4))
    } catch {
      // Remove marker on failure — silently continue
      setMessages(prev => prev.filter(m => m.id !== markerId))
    }
  }, [])

  const send = useCallback(async (text: string, systemPrompt?: string): Promise<void> => {
    // Auto-compact at 98% of context window before sending
    // Use usedTokensRef (synced with the displayed token counter) as the source of truth
    const { maxContextTokens } = optionsRef.current
    if (maxContextTokens) {
      const currentTokens = usedTokensRef.current + Math.round(text.length / 4)
      if (currentTokens >= maxContextTokens * 0.98) {
        await compact()
      }
    }

    setStreaming(true)
    setGenStats(null)

    const userMsg: ChatMessage = { role: 'user', content: text, id: crypto.randomUUID() }

    // Build history to send to backend:
    // If a compact summary exists, inject it first + last 4 real messages.
    // Otherwise send all real messages (excluding display-only compact markers).
    const realMsgs = messagesRef.current.filter(m => {
      const c = typeof m.content === 'string' ? m.content : ''
      return (m.role === 'user' || m.role === 'assistant') && c.trim()
    })

    const historyToSend: Array<{ role: string; content: string }> = []
    if (compactedSummaryRef.current) {
      historyToSend.push({ role: 'system', content: `[Context summary — conversation so far]: ${compactedSummaryRef.current}` })
      realMsgs.slice(-4).forEach(m => historyToSend.push({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
    } else {
      realMsgs.forEach(m => historyToSend.push({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
    }
    historyToSend.push({ role: 'user', content: text })

    const { conversationId, onSaveMessage } = optionsRef.current
    if (conversationId && onSaveMessage) {
      void onSaveMessage(conversationId, 'user', text)
    }

    const withUser = [...messagesRef.current, userMsg]
    messagesRef.current = withUser
    setMessages(withUser)
    const sendChars = withUser.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0)
    _setUsedTokens(Math.round(sendChars / 4))

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
      messages: historyToSend,
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
            // Count tokens from full context: all messages + current generation
            const historyChars = messagesRef.current.reduce((sum, m) => {
              const c = typeof m.content === 'string' ? m.content : ''
              return sum + c.length
            }, 0)
            _setUsedTokens(Math.round((historyChars + snap.length) / 4))
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
            // Final token count from full context
            const finalChars = messagesRef.current.reduce((sum, m) => {
              const c = typeof m.content === 'string' ? m.content : ''
              return sum + c.length
            }, 0)
            _setUsedTokens(Math.round(finalChars / 4))
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
