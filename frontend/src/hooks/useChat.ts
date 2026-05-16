import { useCallback, useRef, useState } from 'react'
import { chatStream, summarizeMessages, addMessage, updateConversation } from '@/api/client'
import type { Attachment, ChatMessage, ChatParams, ContentPart, GenerationStats } from '@/types'

export const DEFAULT_CHAT_PARAMS: ChatParams = {
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 4096,
  topP: 0.95,
  topK: -1,
  repetitionPenalty: 1.1,
  presencePenalty: 0.0,
  frequencyPenalty: 0.0,
  stop: '',
  enableThinking: false,
}

function messageTextLength(msg: ChatMessage): number {
  if (typeof msg.content === 'string') return msg.content.length
  return msg.content.reduce((acc, p) => acc + (p.type === 'text' ? p.text.length : 200), 0)
}

// Estimate token count (~4 chars/token)
function estimateTokens(messages: ChatMessage[]): number {
  return Math.round(messages.reduce((acc, m) => acc + messageTextLength(m), 0) / 4)
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
) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [streaming, setStreaming] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<GenerationStats | null>(null)
  const [lastCompact, setLastCompact] = useState<CompactEvent | null>(null)
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

  const send = useCallback(async (text: string, modelLoaded: boolean, attachments: Attachment[] = []) => {
    if (!modelLoaded) return
    setError(null)
    setStats(null)

    const content = buildUserContent(text, attachments)
    const userMsgId = crypto.randomUUID()
    const userMsg: ChatMessage = { role: 'user', content, id: userMsgId }
    let currentMessages = [...messages, userMsg]

    // Autocompact check: if estimated tokens > 75% of context, compact before sending
    if (maxContextTokens) {
      const estimated = estimateTokens(currentMessages) + params.maxTokens
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
      // Auto-title on first user message
      const isFirstUserMsg = !messages.some(m => m.role === 'user')
      if (isFirstUserMsg) {
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

    await chatStream(
      { messages: currentMessages, stream: true },
      params,
      (chunk) => {
        accumulated += chunk
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: accumulated, id: assistantMsgId }
          return updated
        })
      },
      (generationStats) => {
        setStats(generationStats)
        setStreaming(false)
        const final = [...currentMessages, { role: 'assistant' as const, content: accumulated, id: assistantMsgId }]
        onMessagesChange?.(final)

        // Persist assistant message with stats
        if (convId) {
          addMessage(convId, {
            id: assistantMsgId,
            role: 'assistant',
            content: accumulated,
            stats: {
              tokens: generationStats.tokensGenerated,
              tok_per_sec: generationStats.tokensPerSecond,
              time_ms: generationStats.timeMs,
              prompt_tokens: generationStats.promptTokens,
            },
          }).catch(() => {/* best-effort */})
        }
      },
      (err) => {
        setError(err.message)
        setStreaming(false)
      },
      modelId,
      controller.signal,
    )
    abortRef.current = null
  }, [messages, params, updateMessages, onMessagesChange, maxContextTokens, compact, modelId, convId])

  const setMessagesExternal = useCallback((msgs: ChatMessage[]) => {
    setMessages(msgs)
    setError(null)
    setStats(null)
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

  return {
    messages,
    setMessages: setMessagesExternal,
    streaming,
    compacting,
    error,
    stats,
    lastCompact,
    send,
    stop,
    clear,
  }
}
