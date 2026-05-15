import { useEffect, useRef, useState, useCallback } from 'react'
import { useChat, DEFAULT_CHAT_PARAMS } from '@/hooks/useChat'
import { useConversations } from '@/hooks/useConversations'
import { ChatSettingsSidebar } from '@/components/ChatSettingsSidebar'
import { ModelPickerModal } from '@/components/ModelPickerModal'
import { MessageContent } from '@/components/MessageContent'
import type { Attachment, ChatParams, ModelInfo } from '@/types'

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const ACCEPTED_TEXT_EXTENSIONS = ['.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.md', '.txt', '.sh', '.yaml', '.yml', '.toml', '.env', '.csv', '.xml', '.html', '.css', '.rs', '.go', '.c', '.cpp', '.h']
const MAX_FILE_SIZE_MB = 10

async function readFileAsAttachment(file: File): Promise<Attachment | null> {
  const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type)
  const ext = '.' + (file.name.split('.').pop() ?? '')
  const isText = ACCEPTED_TEXT_EXTENSIONS.includes(ext.toLowerCase()) || file.type.startsWith('text/')

  if (!isImage && !isText) return null
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) return null

  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result
      if (typeof result !== 'string') { resolve(null); return }
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        type: isImage ? 'image' : 'text',
        mimeType: file.type || 'text/plain',
        data: result,
        sizeBytes: file.size,
      })
    }
    reader.onerror = () => resolve(null)
    if (isImage) reader.readAsDataURL(file)
    else reader.readAsText(file)
  })
}

const SIDEBAR_KEY = 'echohub_sidebar_open'

interface Props {
  loadedModel: ModelInfo | null
  downloaded: ModelInfo[]
  loadError: string | null
  onLoad: (id: string, manual?: boolean) => void
  onUnload: () => void
  loadingModelId: boolean
}

function VllmLoadingPanel({ onEject }: { onEject: () => void }) {
  const [logs, setLogs] = useState<string[]>([])
  const [elapsed, setElapsed] = useState(0)
  const logsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const start = Date.now()
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/system/vllm-log')
        if (!res.ok) return
        const lines = (await res.text()).split('\n').filter(Boolean).slice(-40)
        setLogs(lines)
        if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight
      } catch { /* ignore */ }
    }, 1500)
    return () => { clearInterval(tick); clearInterval(interval) }
  }, [])

  const progress = (() => {
    const last = logs.join('\n')
    if (last.includes('Application startup complete')) return 100
    if (last.includes('Loading weights took')) return 85
    if (last.includes('checkpoint shards: 100%')) return 75
    if (last.includes('checkpoint shards:  50%')) return 40
    if (last.includes('Starting to load model')) return 20
    if (last.includes('Initializing a V1 LLM')) return 10
    return 5
  })()

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 max-w-2xl mx-auto w-full">
      <div className="w-full">
        <div className="flex justify-between text-xs text-muted mb-2">
          <span className="animate-pulse text-blue-400">Loading model…</span>
          <span>{elapsed}s</span>
        </div>
        <div className="w-full h-1.5 bg-surface-3 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between items-center mt-1">
          <p className="text-xs text-muted">{progress}%</p>
          <button onClick={onEject} className="text-xs px-3 py-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors">
            ⏏ Eject
          </button>
        </div>
      </div>
      <div ref={logsRef} className="w-full h-64 overflow-y-auto bg-surface-2 border border-border rounded-xl p-3 font-mono text-xs text-muted space-y-0.5">
        {logs.length === 0 ? <p className="text-muted/50">Waiting for vLLM output…</p> : logs.map((line, i) => (
          <p key={i} className={`leading-relaxed break-all ${line.includes('ERROR') ? 'text-red-400' : line.includes('INFO') ? 'text-blue-300/70' : 'text-muted'}`}>{line}</p>
        ))}
      </div>
    </div>
  )
}

export function ChatPanel({ loadedModel, downloaded, loadError, onLoad, onUnload, loadingModelId }: Props) {
  const [params, setParams] = useState<ChatParams>(DEFAULT_CHAT_PARAMS)
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'true' } catch { return false }
  })
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)

  const { conversations, activeId, activeMessages, newConversation, selectConversation, deleteConversation, renameConversation } = useConversations()

  const maxCtx = loadedModel?.max_context_window ?? undefined

  const { messages, setMessages, streaming, compacting, error, stats, send, stop, clear } = useChat(
    params,
    activeMessages,
    undefined,
    maxCtx,
    loadedModel?.id,
    activeId ?? undefined,
  )

  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [visionEnabled, setVisionEnabled] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Sync messages when switching conversations
  useEffect(() => {
    setMessages(activeMessages)
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const toggleSidebar = () => {
    setSidebarOpen(open => {
      const next = !open
      try { localStorage.setItem(SIDEBAR_KEY, String(next)) } catch { /* ignore */ }
      return next
    })
  }

  const handleSend = async () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || streaming || compacting) return
    setInput('')
    const pendingAttachments = visionEnabled
      ? [...attachments]
      : attachments.filter(a => a.type !== 'image')
    setAttachments([])
    await send(text, !!loadedModel, pendingAttachments)
  }

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files) return
    const results = await Promise.all(Array.from(files).map(readFileAsAttachment))
    const valid = results.filter((a): a is Attachment => a !== null)
    setAttachments(prev => [...prev, ...valid])
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    await handleFileSelect(e.dataTransfer.files)
  }, [handleFileSelect])

  const removeAttachment = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id))

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleNewChat = () => {
    newConversation()
  }

  const modelLoaded = !!loadedModel
  const noModelBanner = !loadedModel && !loadingModelId && !loadError

  if (loadingModelId) return <VllmLoadingPanel onEject={onUnload} />

  if (loadError) {
    const lines = loadError.split('\n').filter(Boolean)
    const rootCause = lines.find(l => l.includes('ValueError') || l.includes('RuntimeError') || l.includes('Error:')) ?? lines[lines.length - 1] ?? loadError
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 px-8 max-w-xl mx-auto w-full">
        <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
          <span className="text-red-400 text-lg">✕</span>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-white mb-1">Load failed</p>
          <p className="text-xs text-muted">vLLM exited with an error</p>
        </div>
        <div className="w-full bg-surface-2 border border-red-500/20 rounded-xl p-4">
          <p className="text-xs font-mono text-red-300 break-all leading-relaxed">{rootCause}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => window.location.reload()} className="text-sm px-5 py-2 rounded-xl bg-surface-3 text-muted border border-border hover:text-white transition-colors">← Back</button>
          <button onClick={() => downloaded[0] && onLoad(downloaded[0].id)} className="text-sm px-5 py-2 rounded-xl bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors">↺ Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Conversation history sidebar */}
      <div className="w-52 shrink-0 flex flex-col border-r border-border bg-surface-1">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <span className="text-xs font-semibold text-white">Chats</span>
          <button onClick={handleNewChat} className="p-1 rounded-lg text-muted hover:text-white hover:bg-surface-3 transition-colors" title="New chat">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {conversations.length === 0 && (
            <p className="text-xs text-muted px-2 py-3">No conversations yet</p>
          )}
          {conversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => selectConversation(conv.id)}
              className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                conv.id === activeId ? 'bg-surface-3 text-white' : 'text-muted hover:bg-surface-2 hover:text-white'
              }`}
            >
              {editingTitle === conv.id ? (
                <input
                  autoFocus
                  defaultValue={conv.title}
                  className="flex-1 text-xs bg-transparent outline-none text-white"
                  onBlur={e => { renameConversation(conv.id, e.target.value || conv.title); setEditingTitle(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="flex-1 text-xs truncate" onDoubleClick={e => { e.stopPropagation(); setEditingTitle(conv.id) }}>
                  {conv.title}
                </span>
              )}
              <button
                onClick={e => { e.stopPropagation(); deleteConversation(conv.id) }}
                className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted hover:text-red-400 transition-all"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main chat */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border gap-3">
          {/* Model picker — centered button like LM Studio */}
          <div className="flex items-center gap-2 min-w-0">
            {modelLoaded ? (
              <button
                onClick={() => setModelPickerOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-3 border border-border hover:border-accent/40 transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                <span className="text-xs text-white font-medium truncate max-w-xs">{loadedModel.name}</span>
                <svg className="w-3 h-3 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            ) : (
              <button
                onClick={() => downloaded.length > 0 && setModelPickerOpen(true)}
                disabled={downloaded.length === 0}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-3 border border-border hover:border-accent/40 disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-muted shrink-0" />
                <span className="text-xs text-muted">Select a model to load</span>
                <svg className="w-3 h-3 text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}
            {modelLoaded && (
              <button onClick={onUnload} className="p-1.5 rounded-lg text-muted hover:text-red-400 hover:bg-surface-3 transition-colors" title="Unload model">
                ⏏
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted">{messages.length} msg</span>
            {messages.length > 0 && (
              <button onClick={clear} className="text-xs text-muted hover:text-white transition-colors">Clear</button>
            )}
            <button
              onClick={toggleSidebar}
              title="Chat settings"
              className={`p-1.5 rounded-lg transition-colors ${sidebarOpen ? 'bg-accent/20 text-accent border border-accent/30' : 'text-muted hover:text-white hover:bg-surface-3'}`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* subtle no-model indicator */}
        {noModelBanner && downloaded.length === 0 && (
          <div className="mx-4 mt-3 px-4 py-2 rounded-xl bg-surface-2 border border-border text-xs text-muted text-center">
            No models downloaded — go to Browse to download one.
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted">
              <p className="text-sm">{modelLoaded ? 'Start a conversation…' : 'Load a model to start chatting'}</p>
            </div>
          )}
          {compacting && (
            <div className="flex items-center justify-center py-3 gap-2 text-xs text-violet-400 animate-pulse">
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Compacting context…
            </div>
          )}
          {messages.map((msg, i) => {
            // System messages = compact markers
            if (msg.role === 'system') {
              return (
                <div key={i} className="flex items-center gap-3 py-2 px-1">
                  <div className="flex-1 h-px bg-violet-500/20" />
                  <span className="text-xs text-violet-400/60 shrink-0 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                    </svg>
                    Context compacted
                  </span>
                  <div className="flex-1 h-px bg-violet-500/20" />
                </div>
              )
            }
            const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1
            const showLiveStats = isLastAssistant && !streaming && stats !== null
            // Show persisted stats on historical assistant messages
            const showPersistedStats = msg.role === 'assistant' && !isLastAssistant && msg.stats != null
            return (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm break-words ${
                  msg.role === 'user'
                    ? 'bg-accent text-white rounded-br-sm whitespace-pre-wrap'
                    : 'bg-surface-3 text-white rounded-bl-sm border border-border'
                }`}>
                  {msg.role === 'assistant' ? (
                    <MessageContent content={typeof msg.content === 'string' ? msg.content : msg.content.find(p => p.type === 'text')?.text ?? ''} streaming={isLastAssistant && streaming} />
                  ) : typeof msg.content === 'string' ? msg.content : (
                    <div className="space-y-2">
                      {msg.content.filter(p => p.type === 'image_url').map((p, idx) => (
                        <img key={idx} src={p.type === 'image_url' ? p.image_url.url : ''} alt="attachment" className="max-w-full max-h-64 rounded-lg object-contain" />
                      ))}
                      {msg.content.find(p => p.type === 'text') && (
                        <p className="whitespace-pre-wrap">{msg.content.find(p => p.type === 'text')?.text}</p>
                      )}
                    </div>
                  )}
                </div>
                {showLiveStats && (
                  <p className="text-[10px] text-muted/50 mt-1 px-1 tabular-nums">
                    {stats.tokensGenerated} tokens · {stats.tokensPerSecond.toFixed(1)} tok/s · {(stats.timeMs / 1000).toFixed(2)}s
                    {stats.promptTokens > 0 && ` · ${stats.promptTokens} prompt`}
                  </p>
                )}
                {showPersistedStats && msg.stats && (
                  <p className="text-[10px] text-muted/50 mt-1 px-1 tabular-nums">
                    {msg.stats.tokens} tokens · {msg.stats.tok_per_sec.toFixed(1)} tok/s · {(msg.stats.time_ms / 1000).toFixed(2)}s
                    {msg.stats.prompt_tokens > 0 && ` · ${msg.stats.prompt_tokens} prompt`}
                  </p>
                )}
              </div>
            )
          })}
          {error && (
            <div className="flex justify-start">
              <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-bl-sm bg-red-500/10 border border-red-500/20 text-xs font-mono text-red-300 leading-relaxed">
                <span className="font-semibold text-red-400 block mb-1">⚠ Error</span>
                {error}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 pt-3 pb-4 border-t border-border">
          {/* Context usage bar */}
          {loadedModel && (() => {
            const maxCtx = loadedModel.max_context_window ?? 4096
            // Estimate tokens: history + current input, ~4 chars/token
            const historyChars = messages.reduce((acc, m) => {
              if (typeof m.content === 'string') return acc + m.content.length
              return acc + m.content.reduce((s, p) => s + (p.type === 'text' ? p.text.length : 200), 0)
            }, 0)
            const inputChars = input.length
            const estimatedTokens = Math.round((historyChars + inputChars) / 4)
            const pct = Math.min((estimatedTokens / maxCtx) * 100, 100)
            const color = pct > 85 ? 'text-red-400' : pct > 65 ? 'text-yellow-400' : 'text-muted'
            const barColor = pct > 85 ? 'bg-red-500' : pct > 65 ? 'bg-yellow-500' : 'bg-accent/50'
            return (
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-0.5 bg-surface-3 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                <span className={`text-xs tabular-nums shrink-0 ${color}`}>
                  ~{estimatedTokens.toLocaleString()} / {maxCtx.toLocaleString()}
                </span>
              </div>
            )
          })()}
          {/* Vision / Thinking toggles */}
          {loadedModel && (
            <div className="flex items-center gap-2 mb-2">
              {/* Vision toggle */}
              <button
                type="button"
                disabled={!loadedModel.capabilities.vision}
                onClick={() => loadedModel.capabilities.vision && setVisionEnabled(v => !v)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
                  !loadedModel.capabilities.vision
                    ? 'opacity-40 cursor-not-allowed bg-surface-3 text-muted border-border'
                    : visionEnabled
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                      : 'bg-surface-3 text-muted border-border hover:text-white'
                }`}
                title={loadedModel.capabilities.vision ? 'Toggle vision (image attachments)' : 'This model does not support vision'}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Vision
              </button>

              {/* Thinking toggle — toujours disponible, contrôle /think pour Qwen3, ignoré pour les modèles qui pensent nativement */}
              <button
                type="button"
                onClick={() => setParams(p => ({ ...p, enableThinking: !p.enableThinking }))}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
                  params.enableThinking
                    ? 'bg-violet-500/20 text-violet-300 border-violet-500/30'
                    : 'bg-surface-3 text-muted border-border hover:text-white'
                }`}
                title="Toggle thinking mode"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Thinking
              </button>
            </div>
          )}

          {/* Attachments preview */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachments.map(a => (
                <div key={a.id} className="relative group flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-3 border border-border text-xs text-white max-w-[160px]">
                  {a.type === 'image' ? (
                    <img src={a.data} alt={a.name} className="w-8 h-8 rounded object-cover shrink-0" />
                  ) : (
                    <span className="text-accent font-mono shrink-0">
                      {a.name.split('.').pop()?.toUpperCase() ?? 'TXT'}
                    </span>
                  )}
                  <span className="truncate text-muted">{a.name}</span>
                  <button
                    onClick={() => removeAttachment(a.id)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-surface-1 border border-border text-muted hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            className="flex gap-2 items-end"
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_TEXT_EXTENSIONS].join(',')}
              className="hidden"
              onChange={e => handleFileSelect(e.target.files)}
            />

            {/* Upload button — always visible when model loaded */}
            {modelLoaded && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="shrink-0 p-2 rounded-lg bg-surface-3 border border-border text-muted hover:text-white transition-colors"
                title="Attach image or text file"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              </button>
            )}

            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={modelLoaded ? 'Message… (drag & drop files)' : 'Load a model to chat…'}
              rows={1}
              className="flex-1 resize-none bg-surface-3 border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:border-accent/60 max-h-32 overflow-y-auto disabled:opacity-50"
            />
            {streaming ? (
              <button
                onClick={stop}
                className="shrink-0 p-2.5 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                title="Stop generation"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={(!input.trim() && attachments.length === 0) || compacting || !modelLoaded}
                className="shrink-0 p-2.5 rounded-xl bg-accent text-white disabled:opacity-40 hover:bg-accent-dim transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Settings sidebar */}
      {sidebarOpen && (
        <ChatSettingsSidebar
          params={params}
          onChange={setParams}
          maxContextWindow={loadedModel?.max_context_window ?? undefined}
        />
      )}

      {/* Model picker modal */}
      {modelPickerOpen && (
        <ModelPickerModal
          models={downloaded}
          onSelect={(id, manual) => { onLoad(id, manual) }}
          onClose={() => setModelPickerOpen(false)}
        />
      )}
    </div>
  )
}
