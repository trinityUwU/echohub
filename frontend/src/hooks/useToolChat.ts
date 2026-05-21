import { useCallback, useEffect, useRef, useState } from 'react'
import { toolChat, summarizeMessages } from '@/api/client'
import type { ChatMessage, GenerationStats, SkillsConfig, ToolCall, WorkspaceFile } from '@/types'
import { emitTimings } from '@/api/engineTimings'
import { addToast } from '@/hooks/useToast'

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

function deduplicateMessages(msgs: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>()
  return msgs.filter(m => {
    const key = `${m.role}:${typeof m.content === 'string' ? m.content.slice(0, 200) : JSON.stringify(m.content).slice(0, 200)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseToolChatReturn {
  messages: ChatMessage[]
  toolCalls: ToolCall[]
  workspaceFiles: WorkspaceFile[]
  streaming: boolean
  genStats: GenerationStats | null
  usedTokens: number
  send: (text: string, systemPrompt?: string, skills?: SkillsConfig) => Promise<void>
  stop: () => void
  clear: () => void
  compact: () => Promise<void>
  loadHistory: (msgs: Array<{ role: string; content: string }>) => void
  clearAndResend: (history: ChatMessage[], newText: string, systemPrompt?: string, skills?: SkillsConfig) => void
  sendFromHistory: (history: ChatMessage[]) => void
}

interface UseToolChatOptions {
  conversationId: string | null
  projectMode?: 'dev' | 'docs' | 'research' | ''
  loadConfig?: import('@/types').LoadConfig | null
  onSaveMessage?: (convId: string, role: string, content: string, stats?: import('@/types').MessageStats | null) => Promise<void>
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
    const deduped = deduplicateMessages(hydrated)
    messagesRef.current = deduped
    setMessages(deduped)
    setToolCalls([])
    setWorkspaceFiles([])
    setGenStats(null)
    const historyChars = msgs.reduce((sum, m) => sum + m.content.length, 0)
    _setUsedTokens(Math.round(historyChars / 4))
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

  const send = useCallback(async (text: string, systemPrompt?: string, skills?: SkillsConfig): Promise<void> => {
    // Auto-compact at 98% of context window before sending
    // Use usedTokensRef (synced with the displayed token counter) as the source of truth
    const { maxContextTokens } = optionsRef.current
    if (maxContextTokens) {
      const currentTokens = usedTokensRef.current + Math.round(text.length / 4)
      if (currentTokens >= maxContextTokens * 0.75) {
        await compact()
      }
    }

    setStreaming(true)
    setGenStats(null)

    const userMsg: ChatMessage = { role: 'user', content: text, id: crypto.randomUUID() }

    // Build history to send to backend:
    // If a compact summary exists, inject it first + last 4 real messages.
    // Otherwise send all real messages (excluding display-only compact markers).
    const realMsgs = deduplicateMessages(messagesRef.current).filter(m => {
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
      conv_id: options.conversationId ?? 'global',
      project_mode: options.projectMode ?? '',
      system_prompt: systemPrompt,
      enabled_tools: skills?.enabledTools,
      awareness_block: skills?.awarenessBlock,
    }

    ;(async (): Promise<void> => {
      try {
        for await (const raw of toolChat(req)) {
          if (controller.signal.aborted) break
          // Handle timings before the typed SseEvent check
          if (typeof raw === 'object' && raw !== null && 'timings' in raw) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            emitTimings((raw as any).timings)
            continue
          }
          if (!isSseEvent(raw)) continue

          // Helper — update message + token counter after every content change
          const RENDER_INTERVAL_MS = 80
          let lastRenderTime = 0
          const updateAccumulated = (snap: string, force = false): void => {
            const now = Date.now()
            if (!force && now - lastRenderTime < RENDER_INTERVAL_MS) return
            lastRenderTime = now
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
          }

          if (raw.type === 'tool_call_pending') {
            // no-op
          } else if (raw.type === 'tool_call_streaming') {
            if (!inToolCallBlock) {
              accumulated += '\n<tool_call>'
              inToolCallBlock = true
            }
            accumulated += raw.content
            updateAccumulated(accumulated)
          } else if (raw.type === 'text_chunk') {
            accumulated += raw.content
            updateAccumulated(accumulated)
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
            updateAccumulated(accumulated, true) // flush last chunk
            setWorkspaceFiles(raw.files)
            setStreaming(false)
            const finalChars = messagesRef.current.reduce((sum, m) => {
              const c = typeof m.content === 'string' ? m.content : ''
              return sum + c.length
            }, 0)
            _setUsedTokens(Math.round(finalChars / 4))
            const msgStats = raw.tokens_generated != null ? {
              tokens: raw.tokens_generated,
              tok_per_sec: raw.tok_per_sec ?? 0,
              time_ms: raw.total_ms ?? 0,
              prompt_tokens: 0,
              ttft_ms: raw.ttft_ms ?? undefined,
              engine: raw.engine ?? undefined,
              model_name: raw.model_name ?? undefined,
            } : null
            if (msgStats) {
              setGenStats({
                tokensGenerated: msgStats.tokens,
                tokensPerSecond: msgStats.tok_per_sec,
                timeMs: msgStats.time_ms,
                promptTokens: 0,
                ttftMs: msgStats.ttft_ms ?? null,
                engine: msgStats.engine ?? null,
                modelName: msgStats.model_name ?? null,
              })
            }
            // Attach stats + loadConfig to the assistant message so footer persists
            const currentLoadConfig = optionsRef.current.loadConfig ?? null
            setMessages(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last?.role === 'assistant') {
                updated[updated.length - 1] = { ...last, stats: msgStats ?? undefined, loadConfig: currentLoadConfig ?? undefined }
                messagesRef.current = updated
              }
              return updated
            })
            const { conversationId: cid, onSaveMessage: onSave } = optionsRef.current
            if (cid && onSave && accumulated) {
              void onSave(cid, 'assistant', accumulated, msgStats)
            }
          } else if (raw.type === 'error') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const errRaw = raw as any
            if (errRaw.error_type === 'ctx_exceeded') {
              setStreaming(false)
              const cur = errRaw.current_ctx ?? 4096
              const next = errRaw.next_ctx ?? 8192
              const cfg = optionsRef.current.loadConfig
              const isAdaptive = cfg?.ctx_mode === 'adaptive'
              if (isAdaptive) {
                window.dispatchEvent(new CustomEvent('echohub:reload-ctx', { detail: { nextCtx: next, loadConfig: cfg } }))
              } else {
                addToast({
                  type: 'warning',
                  title: `Context too small (${Math.round(cur / 1024)}K)`,
                  message: `Reload the model with ${Math.round(next / 1024)}K context to continue.`,
                  duration: 0,
                  action: { label: `Reload ${Math.round(next / 1024)}K`, onClick: () => window.dispatchEvent(new CustomEvent('echohub:reload-ctx', { detail: { nextCtx: next, loadConfig: cfg } })) },
                })
              }
              // Remove the empty assistant message
              setMessages(prev => prev.slice(0, -1))
            } else {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: `Error: ${raw.error}`, id: assistantId }
                messagesRef.current = updated
                return updated
              })
              setStreaming(false)
            }
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

  const clearAndResend = useCallback((history: ChatMessage[], newText: string, systemPrompt?: string, skills?: SkillsConfig): void => {
    abortRef.current?.abort()
    messagesRef.current = history
    setMessages(history)
    setToolCalls([])
    send(newText, systemPrompt, skills)
  }, [send])

  const sendFromHistory = useCallback((history: ChatMessage[]): void => {
    const lastUser = [...history].reverse().find(m => m.role === 'user')
    if (!lastUser) return
    const historyWithoutLast = history.slice(0, history.lastIndexOf(lastUser))
    clearAndResend(historyWithoutLast, typeof lastUser.content === 'string' ? lastUser.content : '')
  }, [clearAndResend])

  return { messages, toolCalls, workspaceFiles, streaming, genStats, usedTokens, send, stop, clear, compact, loadHistory, clearAndResend, sendFromHistory }
}
