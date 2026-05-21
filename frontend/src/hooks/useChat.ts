import { useCallback, useRef, useState } from 'react'
import { chatStream, summarizeMessages, addMessage, updateConversation } from '@/api/client'
import { addToast } from '@/hooks/useToast'
import type { Attachment, ChatMessage, ChatParams, ContentPart, GenerationStats, LoadConfig } from '@/types'

export const DEFAULT_CHAT_PARAMS: ChatParams = {
  systemPrompt: '',
  permanentRules: '',
  temperature: 0.7,
  maxTokens: 4096,
  topP: 0.95,
  topK: -1,
  repetitionPenalty: 1.1,
  presencePenalty: 0.0,
  frequencyPenalty: 0.0,
  stop: '',
  enableThinking: false,
  autoTitle: true,
  contextCompaction: false,
}

function messageTextLength(msg: ChatMessage): number {
  if (typeof msg.content === 'string') return msg.content.length
  return msg.content.reduce((acc, p) => acc + (p.type === 'text' ? p.text.length : 200), 0)
}

// Estimate token count (~4 chars/token)
function estimateTokens(messages: ChatMessage[], systemPrompt?: string, permanentRules?: string): number {
  const msgChars = messages.reduce((acc, m) => acc + messageTextLength(m), 0)
  const sysChars = (systemPrompt?.length ?? 0) + (permanentRules?.length ?? 0)
  return Math.round((msgChars + sysChars) / 4)
}

function buildUserContent(text: string, attachments: Attachment[]): ChatMessage['content'] {
  if (attachments.length === 0) return text

  const parts: ContentPart[] = []

  // Text files: inject as fenced code blocks prepended to the message text
  const textFiles = attachments.filter(a => a.type === 'text')
  const images = attachments.filter(a => a.type === 'image')

  let combinedText = text
  if (textFiles.length > 0) {
    const injected = textFiles.map(a => {
      const ext = a.name.split('.').pop() ?? 'txt'
      return `\`\`\`${ext} (${a.name})\n${a.data}\n\`\`\``
    }).join('\n\n')
    combinedText = injected + (text ? '\n\n' + text : '')
  }

  if (images.length === 0) return combinedText

  // Multimodal: mix text + image_url parts
  if (combinedText) parts.push({ type: 'text', text: combinedText })
  for (const img of images) {
    parts.push({ type: 'image_url', image_url: { url: img.data } })
  }
  return parts
}

function extractFirstUserText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  return content.find(p => p.type === 'text')?.text ?? ''
}

// Special marker for compacted context
export const COMPACT_MARKER = '__compacted__'

export interface CompactEvent {
  beforeCount: number
  afterCount: number
  summary: string
}

export function useChat(
  params: ChatParams = DEFAULT_CHAT_PARAMS,
  initialMessages: ChatMessage[] = [],
  onMessagesChange?: (messages: ChatMessage[]) => void,
  maxContextTokens?: number,
  modelId?: string,
  convId?: string,
  modelName?: string | null,
) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [streaming, setStreaming] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<GenerationStats | null>(null)
  const [lastCompact, setLastCompact] = useState<CompactEvent | null>(null)
  const [liveTokens, setLiveTokens] = useState<{ prompt: number; completion: number } | null>(null)
  const [oomError, setOomError] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const updateMessages = useCallback((next: ChatMessage[]) => {
    setMessages(next)
    onMessagesChange?.(next)
  }, [onMessagesChange])

  // Autocompact: summarize oldest messages, keep last 4 exchanges + summary
  const compact = useCallback(async (msgs: ChatMessage[]): Promise<ChatMessage[]> => {
    const userMsgs = msgs.filter(m => m.role === 'user' || m.role === 'assistant')
    if (userMsgs.length < 6) return msgs // not enough to compact

    setCompacting(true)
    try {
      // Keep last 4 messages (2 exchanges), summarize the rest
      const toSummarize = userMsgs.slice(0, -4)
      const toKeep = userMsgs.slice(-4)
      const beforeTokens = estimateTokens(msgs)

      const { summary } = await summarizeMessages(toSummarize)

      const compactedMessages: ChatMessage[] = [
        {
          role: 'system',
          content: `[Context compacted — ${toSummarize.length} messages summarized]\n\n${summary}`,
        },
        ...toKeep,
      ]

      const afterTokens = estimateTokens(compactedMessages)
      setLastCompact({
        beforeCount: beforeTokens,
        afterCount: afterTokens,
        summary,
      })
      return compactedMessages
    } catch {
      // Compact failed — continue with original
      return msgs
    } finally {
      setCompacting(false)
    }
  }, [])

  const send = useCallback(async (text: string, modelLoaded: boolean, attachments: Attachment[] = [], currentLoadConfig?: LoadConfig | null) => {
    if (!modelLoaded) return
    setError(null)
    setStats(null)
    setOomError(false)

    // Capture load config at send time — before any async work
    const loadConfigSnapshot: LoadConfig | null = currentLoadConfig ?? null

    const content = buildUserContent(text, attachments)
    const userMsgId = crypto.randomUUID()
    const userMsg: ChatMessage = { role: 'user', content, id: userMsgId }
    let currentMessages = [...messages, userMsg]

    // Autocompact check: if enabled and estimated tokens > 75% of context, compact before sending
    if (maxContextTokens && params.contextCompaction) {
      const estimated = estimateTokens(currentMessages, params.systemPrompt, params.permanentRules) + params.maxTokens
      const threshold = maxContextTokens * 0.75
      if (estimated > threshold && currentMessages.filter(m => m.role !== 'system').length > 6) {
        const compacted = await compact(currentMessages)
        if (compacted !== currentMessages) {
          updateMessages(compacted)
          currentMessages = compacted
        }
      }
    }

    updateMessages(currentMessages)

    // Persist user message
    if (convId) {
      // Auto-title on first user message (if enabled)
      const isFirstUserMsg = !messages.some(m => m.role === 'user')
      if (isFirstUserMsg && params.autoTitle) {
        const rawText = extractFirstUserText(content)
        const title = rawText.slice(0, 40) + (rawText.length > 40 ? '…' : '')
        updateConversation(convId, { title }).catch(() => {/* best-effort */})
      }

      addMessage(convId, { id: userMsgId, role: 'user', content, stats: null }).catch(() => {/* best-effort */})
    }

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setMessages(prev => [...prev, assistantMsg])
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller
    let accumulated = ''
    const assistantMsgId = crypto.randomUUID()

    // Throttle UI updates — only re-render every 150ms to avoid DOM freeze on long generations
    let lastRenderTime = 0
    const RENDER_INTERVAL_MS = 150

    await chatStream(
      { messages: currentMessages, stream: true },
      params,
      (chunk) => {
        accumulated += chunk
        const now = Date.now()
        if (now - lastRenderTime >= RENDER_INTERVAL_MS) {
          lastRenderTime = now
          const snap = accumulated
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: snap, id: assistantMsgId }
            return updated
          })
        }
      },
      (generationStats) => {
        setStats(generationStats)
        setStreaming(false)
        const msgStats = {
          tokens: generationStats.tokensGenerated,
          model_name: generationStats.modelName ?? modelName ?? undefined,
          tok_per_sec: generationStats.tokensPerSecond,
          time_ms: generationStats.timeMs,
          prompt_tokens: generationStats.promptTokens,
          ttft_ms: generationStats.ttftMs ?? undefined,
          engine: generationStats.engine ?? undefined,
          oom: generationStats.oom ?? undefined,
        }
        const assistantFinal: ChatMessage = {
          role: 'assistant', content: accumulated, id: assistantMsgId,
          stats: msgStats,
          loadConfig: loadConfigSnapshot,
        }
        const final = [...currentMessages, assistantFinal]
        setMessages(prev => { const u = [...prev]; u[u.length - 1] = assistantFinal; return u })
        onMessagesChange?.(final)

        // Persist assistant message with stats and load config snapshot
        if (convId) {
          addMessage(convId, {
            id: assistantMsgId,
            role: 'assistant',
            content: accumulated,
            stats: msgStats,
            load_config: loadConfigSnapshot,
          }).catch(() => {/* best-effort */})
        }
      },
      (err) => {
        setError(err.message)
        setStreaming(false)
      },
      modelId,
      controller.signal,
      (prompt, completion) => setLiveTokens({ prompt, completion }),
      () => { setOomError(true); setStreaming(false) },
      (currentCtx, nextCtx) => {
        setStreaming(false)
        setError(null)
        const isAdaptive = loadConfigSnapshot?.ctx_mode === 'adaptive'
        if (isAdaptive) {
          window.dispatchEvent(new CustomEvent('echohub:reload-ctx', { detail: { nextCtx, loadConfig: loadConfigSnapshot } }))
        } else {
          addToast({
            type: 'warning',
            title: `Context too small (${Math.round(currentCtx / 1024)}K)`,
            message: `Reload the model with ${Math.round(nextCtx / 1024)}K context to continue.`,
            duration: 0,
            action: { label: `Reload ${Math.round(nextCtx / 1024)}K`, onClick: () => window.dispatchEvent(new CustomEvent('echohub:reload-ctx', { detail: { nextCtx, loadConfig: loadConfigSnapshot } })) },
          })
        }
      },
    )
    abortRef.current = null
  }, [messages, params, updateMessages, onMessagesChange, maxContextTokens, compact, modelId, convId])

  const setMessagesExternal = useCallback((msgs: ChatMessage[]) => {
    setMessages(msgs)
    setError(null)
    setStats(null)
    setLiveTokens(null)
  }, [])

  const clear = useCallback(() => {
    setMessages([])
    setError(null)
    setStats(null)
    setLastCompact(null)
    onMessagesChange?.([])
  }, [onMessagesChange])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }, [])

  const sendFromHistory = useCallback(async (history: ChatMessage[]) => {
    setError(null)
    setStats(null)
    setStreaming(true)  // set BEFORE any state that triggers useEffect sync

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setMessages([...history, assistantMsg])

    const controller = new AbortController()
    abortRef.current = controller
    let accumulated = ''
    const assistantMsgId = crypto.randomUUID()

    let lastRenderTime2 = 0
    await chatStream(
      { messages: history, stream: true },
      params,
      (chunk) => {
        accumulated += chunk
        const now = Date.now()
        if (now - lastRenderTime2 >= 150) {
          lastRenderTime2 = now
          const snap = accumulated
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: snap, id: assistantMsgId }
            return updated
          })
        }
      },
      (generationStats) => {
        setStats(generationStats)
        setStreaming(false)
        const msgStats2 = {
          tokens: generationStats.tokensGenerated,
          model_name: generationStats.modelName ?? modelName ?? undefined,
          tok_per_sec: generationStats.tokensPerSecond,
          time_ms: generationStats.timeMs,
          prompt_tokens: generationStats.promptTokens,
          ttft_ms: generationStats.ttftMs ?? undefined,
          engine: generationStats.engine ?? undefined,
          oom: generationStats.oom ?? undefined,
        }
        const assistantFinal2: ChatMessage = {
          role: 'assistant', content: accumulated, id: assistantMsgId,
          stats: msgStats2,
        }
        setMessages(prev => { const u = [...prev]; u[u.length - 1] = assistantFinal2; return u })
        const final = [...history, assistantFinal2]
        onMessagesChange?.(final)
        if (convId) {
          addMessage(convId, {
            id: assistantMsgId, role: 'assistant', content: accumulated,
            stats: msgStats2,
          }).catch(() => {})
        }
      },
      (err) => { setError(err.message); setStreaming(false) },
      modelId,
      controller.signal,
      (prompt, completion) => setLiveTokens({ prompt, completion }),
      () => { setOomError(true); setStreaming(false) },
      (currentCtx, nextCtx) => {
        setStreaming(false)
        setError(null)
        addToast({
          type: 'warning',
          title: `Context too small (${Math.round(currentCtx / 1024)}K)`,
          message: `Reload the model with ${Math.round(nextCtx / 1024)}K context to continue.`,
          duration: 0,
          action: { label: `Reload ${Math.round(nextCtx / 1024)}K`, onClick: () => window.dispatchEvent(new CustomEvent('echohub:reload-ctx', { detail: { nextCtx } })) },
        })
      },
    )
    abortRef.current = null
  }, [params, onMessagesChange, modelId, convId])

  // Exact uniquement quand le stream est terminé ET qu'on a reçu le vrai compte
  const isTokensExact = !streaming && liveTokens !== null
  const usedTokens = liveTokens !== null
    ? liveTokens.prompt + liveTokens.completion
    : estimateTokens(messages, params.systemPrompt, params.permanentRules)

  return {
    messages,
    setMessages: setMessagesExternal,
    streaming,
    compacting,
    error,
    oomError,
    stats,
    lastCompact,
    usedTokens,
    isTokensExact,
    send,
    sendFromHistory,
    stop,
    clear,
  }
}
