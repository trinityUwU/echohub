import { useState, useEffect, useRef, useCallback } from 'react'
import { useChat, DEFAULT_CHAT_PARAMS } from '@/hooks/useChat'
import { MessageContent } from './MessageContent'
import { ModelPickerModal } from '@/components/ui/ModelPickerModal'
import type { Attachment, ChatMessage, ChatParams, ConversationSummary, ModelInfo } from '@/types'

interface Props {
  loadedModel: ModelInfo | null
  downloaded: ModelInfo[]
  loadError: string | null
  loadingModelId: boolean
  onLoad: (id: string, manual?: boolean) => void
  onUnload: () => void
  conversations: ConversationSummary[]
  activeId: string | null
  activeMessages: ChatMessage[]
  onNewConversation: (modelId?: string) => Promise<ConversationSummary>
  onSelectConversation: (id: string) => Promise<void>
  onDeleteConversation: (id: string) => Promise<void>
  onRenameConversation: (id: string, title: string) => Promise<void>
  setActiveMessages: (msgs: ChatMessage[]) => void
}

export function ChatView({
  loadedModel, downloaded, loadError, loadingModelId,
  onLoad, onUnload, conversations, activeId, activeMessages,
  onNewConversation, onSelectConversation, onDeleteConversation, onRenameConversation, setActiveMessages: _setActiveMessages,
}: Props) {
  const [params, setParams] = useState<ChatParams>(DEFAULT_CHAT_PARAMS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [editingTitle, setEditingTitle] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { messages, setMessages, streaming, compacting, error, send, stop, clear } = useChat(
    params, activeMessages, undefined,
    loadedModel?.max_context_window ?? undefined,
    loadedModel?.id, activeId ?? undefined
  )

  useEffect(() => { setMessages(activeMessages) }, [activeId]) // eslint-disable-line
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const handleSend = useCallback((): void => {
    if ((!input.trim() && attachments.length === 0) || !loadedModel) return
    send(input, true, attachments)
    setInput('')
    setAttachments([])
  }, [input, attachments, loadedModel, send])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      const isImage = file.type.startsWith('image/')
      if (isImage) {
        reader.onload = () => {
          setAttachments(prev => [...prev, {
            id: crypto.randomUUID(), name: file.name, type: 'image',
            mimeType: file.type, data: reader.result as string, sizeBytes: file.size,
          }])
        }
        reader.readAsDataURL(file)
      } else {
        reader.onload = () => {
          setAttachments(prev => [...prev, {
            id: crypto.randomUUID(), name: file.name, type: 'text',
            mimeType: file.type, data: reader.result as string, sizeBytes: file.size,
          }])
        }
        reader.readAsText(file)
      }
    })
    e.target.value = ''
  }

  const maxCtx = loadedModel?.max_context_window ?? 4096
  const historyChars = messages.reduce((acc, m) => {
    if (typeof m.content === 'string') return acc + m.content.length
    return acc + m.content.reduce((s, p) => s + (p.type === 'text' ? p.text.length : 200), 0)
  }, 0)
  const estimatedTokens = Math.round((historyChars + input.length) / 4)
  const ctxPct = Math.min(estimatedTokens / maxCtx * 100, 100)
  const ctxColor = ctxPct > 85 ? 'bg-red-500' : ctxPct > 65 ? 'bg-amber-500' : 'bg-accent/60'

  return (
    <div className="flex h-full overflow-hidden">
      {/* Conversations panel */}
      <div className="w-48 shrink-0 flex flex-col bg-surface-1 border-r border-white/[0.05]">
        <div className="h-10 flex items-center justify-between px-3 border-b border-white/[0.05]">
          <span className="text-2xs font-semibold uppercase tracking-widest text-muted/50">Chats</span>
          <button
            onClick={() => onNewConversation(loadedModel?.id)}
            className="w-5 h-5 rounded flex items-center justify-center text-muted/40 hover:text-white hover:bg-white/[0.05] transition-colors"
          >
            +
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 space-y-px">
          {conversations.map(conv => {
            const active = conv.id === activeId
            return (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors group flex items-center ${
                  active ? 'bg-surface-3 text-white border-l-2 border-accent pl-[9px]' : 'text-muted/60 hover:text-white hover:bg-white/[0.03]'
                }`}
              >
                {editingTitle === conv.id ? (
                  <input
                    autoFocus
                    defaultValue={conv.title}
                    className="bg-transparent border-0 outline-none text-xs w-full"
                    onBlur={e => { onRenameConversation(conv.id, e.target.value); setEditingTitle(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  />
                ) : (
                  <span className="truncate flex-1" onDoubleClick={() => setEditingTitle(conv.id)}>{conv.title}</span>
                )}
                <button
                  onClick={e => { e.stopPropagation(); onDeleteConversation(conv.id) }}
                  className="ml-auto opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main chat zone */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="h-10 flex items-center px-4 gap-2.5 border-b border-white/[0.05] shrink-0 bg-surface-1">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 rounded-lg text-xs hover:bg-surface-3 transition-colors"
          >
            {loadedModel ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="truncate max-w-[160px]">{loadedModel.name}</span>
              </>
            ) : (
              <span className="text-muted/60">Select model</span>
            )}
            <svg className="w-3 h-3 text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {loadedModel && (
            <button onClick={onUnload} className="text-muted/30 hover:text-red-400 transition-colors text-sm">⏏</button>
          )}
          <div className="flex-1" />
          <span className="text-2xs text-muted/30">{messages.length} msg</span>
          {messages.length > 0 && (
            <button onClick={clear} className="text-2xs text-muted/40 hover:text-white transition-colors">Clear</button>
          )}
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className={`text-sm transition-colors ${settingsOpen ? 'text-accent' : 'text-muted/40 hover:text-white'}`}
          >
            ⚙
          </button>
        </div>

        {/* Loading state */}
        {loadingModelId && (
          <div className="flex items-center justify-center gap-3 py-4 bg-surface-1/50">
            <svg className="w-4 h-4 animate-spin text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4m-3.93 7.07l-2.83-2.83M7.76 7.76L4.93 4.93" />
            </svg>
            <span className="text-xs text-muted/60">Loading model…</span>
            <button onClick={onUnload} className="text-2xs text-red-400/60 hover:text-red-400 ml-2">Eject</button>
          </div>
        )}

        {/* Load error */}
        {loadError && (
          <div className="mx-4 mt-3 bg-red-500/[0.06] border border-red-500/20 rounded-lg p-3">
            <p className="text-xs text-red-400">{loadError}</p>
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-surface-0">
            {messages.length === 0 && !compacting && (
              <div className="h-full flex items-center justify-center">
                <p className="text-xs text-muted/30">Start a conversation</p>
              </div>
            )}
            {compacting && (
              <div className="flex items-center justify-center py-4">
                <p className="text-xs text-accent/50 animate-pulse">Compacting context…</p>
              </div>
            )}
            {messages.map((msg, i) => {
              const isLast = i === messages.length - 1
              if (msg.role === 'system') {
                return (
                  <div key={i} className="flex items-center gap-2 py-1">
                    <div className="flex-1 h-px bg-white/[0.05]" />
                    <span className="text-2xs text-muted/30">system</span>
                    <div className="flex-1 h-px bg-white/[0.05]" />
                  </div>
                )
              }
              if (msg.role === 'user') {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[72%] bg-surface-3 rounded-xl rounded-br-sm px-4 py-2.5 text-sm">
                      {Array.isArray(msg.content) ? (
                        <div className="space-y-2">
                          {msg.content.filter(p => p.type === 'image_url').map((p, j) => (
                            p.type === 'image_url' && <img key={j} src={p.image_url.url} alt="" className="max-h-48 rounded-lg object-contain" />
                          ))}
                          {msg.content.filter(p => p.type === 'text').map((p, j) => (
                            p.type === 'text' && <p key={j} className="whitespace-pre-wrap">{p.text}</p>
                          ))}
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                    </div>
                  </div>
                )
              }
              return (
                <div key={i} className="flex flex-col items-start max-w-[85%] space-y-1">
                  <MessageContent content={msg.content} streaming={isLast && streaming} />
                  {msg.stats && (
                    <p className="text-[10px] font-mono text-muted/30">
                      {msg.stats.tokens} tokens · {msg.stats.tok_per_sec.toFixed(1)} tok/s · {(msg.stats.time_ms / 1000).toFixed(2)}s
                    </p>
                  )}
                </div>
              )
            })}
            {error && (
              <div className="bg-red-500/[0.06] border border-red-500/20 rounded-lg p-3">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Settings panel */}
          {settingsOpen && (
            <div className="w-72 shrink-0 bg-surface-1 border-l border-white/[0.05] overflow-y-auto p-4 space-y-4">
              <h3 className="text-2xs uppercase tracking-widest text-muted/50 mb-3">Chat Settings</h3>

              <div className="flex items-center justify-between">
                <span className="text-xs text-white/70">Thinking</span>
                <button
                  onClick={() => setParams(p => ({ ...p, enableThinking: !p.enableThinking }))}
                  className={`w-8 h-4 rounded-full transition-colors relative ${params.enableThinking ? 'bg-accent' : 'bg-surface-3'}`}
                >
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${params.enableThinking ? 'left-[18px]' : 'left-[2px]'}`} />
                </button>
              </div>

              <div>
                <label className="text-2xs text-muted/50 block mb-1">System Prompt</label>
                <textarea
                  value={params.systemPrompt}
                  onChange={e => setParams(p => ({ ...p, systemPrompt: e.target.value }))}
                  className="bg-surface-2 w-full rounded-lg p-2.5 text-xs resize-none border-0 focus:outline-none focus:ring-1 focus:ring-accent/30 text-white"
                  rows={4}
                />
              </div>

              <SliderParam label="Temperature" value={params.temperature} min={0} max={2} step={0.05}
                onChange={v => setParams(p => ({ ...p, temperature: v }))} />
              <SliderParam label="Max Tokens" value={params.maxTokens} min={64} max={8192} step={64}
                onChange={v => setParams(p => ({ ...p, maxTokens: v }))} />
              <SliderParam label="Top P" value={params.topP} min={0} max={1} step={0.05}
                onChange={v => setParams(p => ({ ...p, topP: v }))} />
            </div>
          )}
        </div>

        {/* Input zone */}
        <div className="shrink-0 bg-surface-1 border-t border-white/[0.05] px-4 pt-2 pb-3">
          <div className="h-0.5 mb-2 bg-surface-3 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${ctxColor}`} style={{ width: `${ctxPct}%` }} />
          </div>

          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {attachments.map(a => (
                <span key={a.id} className="text-2xs bg-surface-2 rounded px-2 py-0.5 text-muted/60 flex items-center gap-1">
                  {a.name}
                  <button onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))} className="text-muted/30 hover:text-red-400">×</button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileSelect} />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-muted/40 hover:text-white p-2 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={loadedModel ? 'Message…' : 'Load a model to chat'}
              disabled={!loadedModel || loadingModelId}
              className="flex-1 bg-surface-2 rounded-xl px-4 py-2.5 text-sm resize-none max-h-32 overflow-y-auto border-0 focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-50 text-white placeholder:text-muted/40"
              rows={1}
            />
            {streaming ? (
              <button
                onClick={stop}
                className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl p-2.5 hover:bg-red-500/20 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={(!input.trim() && attachments.length === 0) || !loadedModel}
                className="bg-accent rounded-xl p-2.5 hover:bg-accent-dim transition-colors disabled:opacity-30"
              >
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Model picker modal */}
      {pickerOpen && (
        <ModelPickerModal
          models={downloaded}
          onSelect={(id, manual) => { onLoad(id, manual); setPickerOpen(false) }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

function SliderParam({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-white/70">{label}</span>
        <span className="text-2xs font-mono text-muted/50">{value}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 bg-surface-3 rounded-full appearance-none cursor-pointer accent-accent"
      />
    </div>
  )
}
