import { useState, useRef, useEffect, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ChatMessage, GenerationStats, LoadConfig } from '@/types'
import { MarkdownContent } from './MarkdownContent'
import { ThinkingBlock } from './ThinkingBlock'
import { PairEditor } from '@/components/finetune/PairEditor'

interface MessageRowProps {
  message: ChatMessage
  isLast?: boolean
  genStats?: GenerationStats | null
  modelName?: string | null
  streaming?: boolean
  onRegenerate?: () => void
  onEditUser?: (text: string) => void
  promptForPair?: string
  sourceConvId?: string
  sourceMsgId?: string
  loadedModelId?: string | null
  onReload?: (config: LoadConfig) => void
}

// ── Tool call marker detection ────────────────────────────────────────────────

const TOOL_MARKER_RE = /^\[tool:([^\]]+)\](.*)$/s

interface ParsedToolMarker {
  tool: string
  payload: string
}

function parseToolMarker(content: string): ParsedToolMarker | null {
  const m = content.match(TOOL_MARKER_RE)
  if (!m) return null
  return { tool: m[1], payload: m[2] }
}

function ToolCallRow({ tool, payload }: ParsedToolMarker): React.ReactElement {
  let prettyPayload = payload
  try {
    prettyPayload = JSON.stringify(JSON.parse(payload), null, 2)
  } catch {
    // leave as-is if not valid JSON
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="flex items-start gap-2 px-5 py-1"
    >
      <div className="flex items-center gap-1.5 mt-0.5 flex-shrink-0">
        <svg className="w-3 h-3 text-text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
        <span className="text-2xs font-mono font-medium text-text-muted/80 bg-white/5 border border-border/50 rounded px-1.5 py-0.5">
          {tool}
        </span>
      </div>
      {prettyPayload && (
        <pre className="text-2xs text-text-muted/50 font-mono leading-relaxed overflow-x-auto max-w-[480px] whitespace-pre-wrap break-all">
          {prettyPayload}
        </pre>
      )}
    </motion.div>
  )
}

// ── MessageRow ────────────────────────────────────────────────────────────────

function MessageRowInner({ message, isLast, genStats, modelName, streaming, onRegenerate, onEditUser, promptForPair, sourceConvId, sourceMsgId, loadedModelId, onReload }: MessageRowProps): React.ReactElement {
  const isUser = message.role === 'user'

  // Detect tool call marker — render as compact badge, not a full message bubble
  const rawContent = typeof message.content === 'string' ? message.content : ''
  const toolMarker = !isUser ? parseToolMarker(rawContent) : null
  if (toolMarker) {
    return <ToolCallRow tool={toolMarker.tool} payload={toolMarker.payload} />
  }
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [savingPair, setSavingPair] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const text = typeof message.content === 'string'
    ? message.content
    : message.content.find(p => p.type === 'text')?.text ?? ''
  const images = typeof message.content !== 'string'
    ? message.content.filter(p => p.type === 'image_url').map(p => (p as { type: 'image_url'; image_url: { url: string } }).image_url.url)
    : []

  // Match <think>...</think> anywhere in text (model sometimes emits preamble before <think>)
  const thinkMatch = text.match(/^([\s\S]*?)<think>([\s\S]*?)<\/think>([\s\S]*)$/s)
  // <think> open without closing — still streaming
  const thinkOpen = !thinkMatch && text.includes('<think>') && !text.includes('</think>')
  // </think> present but no <think> — opening tag was dropped by throttle, treat whole prefix as thinking
  const thinkOrphanClose = !thinkMatch && !thinkOpen && text.includes('</think>')
  const visibleText = thinkMatch
    ? (thinkMatch[1] + thinkMatch[3]).trim()
    : thinkOpen
      ? ''
      : thinkOrphanClose
        ? text.slice(text.indexOf('</think>') + 8).trim()
        : text
  const thinkContent = thinkMatch
    ? thinkMatch[2]
    : thinkOpen
      ? text.slice(text.indexOf('<think>') + 7)
      : thinkOrphanClose
        ? text.slice(0, text.indexOf('</think>'))
        : ''
  const hasThink = thinkMatch !== null || thinkOpen || thinkOrphanClose

  const copy = (): void => {
    navigator.clipboard.writeText(visibleText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const startEdit = (): void => {
    setEditText(text)
    setEditing(true)
  }

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.selectionStart = textareaRef.current.value.length
      // Auto-height
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [editing])

  const submitEdit = (): void => {
    if (editText.trim() && editText !== text) onEditUser?.(editText.trim())
    setEditing(false)
  }

  const cancelEdit = (): void => setEditing(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={`group flex px-5 py-1.5 gap-3 hover:bg-white/[0.02] transition-colors ${isUser ? 'flex-row-reverse' : ''}`}>
      <Avatar role={message.role} />
      <div className={`max-w-[680px] min-w-0 flex flex-col gap-1 overflow-hidden ${isUser ? 'items-end' : ''}`}>
        {images.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-1">
            {images.map((url, i) => (
              <img key={i} src={url} alt="" onClick={() => setLightboxUrl(url)}
                className="max-h-48 max-w-xs rounded-sm border border-border object-contain cursor-zoom-in hover:border-accent/50 transition-colors" />
            ))}
          </div>
        )}

        <AnimatePresence>
          {lightboxUrl && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setLightboxUrl(null)}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
            >
              <motion.img
                src={lightboxUrl} alt=""
                initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={e => e.stopPropagation()}
                className="max-w-[90vw] max-h-[90vh] rounded-md border border-border/40 object-contain shadow-2xl cursor-default"
              />
              <button onClick={() => setLightboxUrl(null)}
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {hasThink && !isUser && (
          <ThinkingBlock content={thinkContent} streaming={thinkOpen} />
        )}

        {editing ? (
          <div className="flex flex-col gap-2 w-full">
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={e => {
                setEditText(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = e.target.scrollHeight + 'px'
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit() }
                if (e.key === 'Escape') cancelEdit()
              }}
              className="w-full min-w-[320px] bg-elevated border border-accent/40 rounded-md px-3.5 py-2.5 text-[0.92rem] text-text-primary resize-none outline-none focus:border-accent transition-colors leading-relaxed"
              rows={1}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={cancelEdit}
                className="px-3 py-1 text-xs text-text-muted hover:text-text-secondary border border-border rounded-sm cursor-pointer transition-colors">
                Cancel
              </button>
              <button onClick={submitEdit}
                className="px-3 py-1 text-xs bg-accent hover:bg-accent-hover text-white rounded-sm cursor-pointer transition-colors font-medium">
                Send
              </button>
            </div>
          </div>
        ) : (
          <div className={`rounded-md px-3.5 py-2.5 text-md leading-relaxed border ${
            isUser ? 'bg-accent-dim border-accent/20' : 'bg-elevated border-border'
          } text-text-primary`}>
            {visibleText
              ? <MarkdownContent content={visibleText} />
              : !isUser && streaming && isLast
                ? <img src="/claude_math.gif" alt="" className="w-14 h-14 object-contain opacity-90" />
                : <span className="text-text-muted animate-pulse">…</span>
            }
          </div>
        )}

        {/* Footer */}
        {!editing && !streaming && (
          <div className={`flex items-center gap-0.5 transition-opacity ${isUser ? 'flex-row-reverse' : ''}`}>
            {/* Stats — left side for assistant */}
            {!isUser && (genStats || message.stats) && (
              <span className="text-xs text-text-muted mr-2 flex items-center gap-1.5 flex-wrap">
                {genStats ? (
                  <>
                    <span>{genStats.tokensGenerated} tokens</span>
                    <span className="text-green">{genStats.tokensPerSecond.toFixed(1)} tok/s</span>
                    {genStats.ttftMs != null && <span>{genStats.ttftMs}ms TTFT</span>}
                    <span>{(genStats.timeMs / 1000).toFixed(2)}s</span>
                    {genStats.engine && <span className="text-text-muted/50">{genStats.engine}</span>}
                    {(genStats.modelName ?? modelName) && <span className="text-text-muted/50 truncate max-w-[160px]">· {genStats.modelName ?? modelName}</span>}
                  </>
                ) : message.stats ? (
                  <>
                    <span>{message.stats.tokens} tokens</span>
                    <span className="text-green">{message.stats.tok_per_sec.toFixed(1)} tok/s</span>
                    {message.stats.ttft_ms != null && <span>{message.stats.ttft_ms}ms TTFT</span>}
                    <span>{(message.stats.time_ms / 1000).toFixed(2)}s</span>
                    {message.stats.engine && <span className="text-text-muted/50">{message.stats.engine}</span>}
                    {message.stats.model_name && <span className="text-text-muted/50 truncate max-w-[160px]">· {message.stats.model_name}</span>}
                  </>
                ) : null}
              </span>
            )}

            <ActionBtn onClick={copy} title={copied ? 'Copied!' : 'Copy'}>
              {copied
                ? <svg className="w-3.5 h-3.5 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                : <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              }
            </ActionBtn>

            {isUser && onEditUser && (
              <ActionBtn onClick={startEdit} title="Edit">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </ActionBtn>
            )}

            {(onRegenerate || (isUser && onEditUser)) && (
              <ActionBtn onClick={onRegenerate ?? (() => onEditUser?.(text))} title="Regenerate">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.01"/>
                </svg>
              </ActionBtn>
            )}

            {!isUser && promptForPair && (
              <ActionBtn onClick={() => setSavingPair(v => !v)} title="Save as training pair">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
              </ActionBtn>
            )}

            {!isUser && onReload && (() => {
              const cfg = message.loadConfig ?? (
                message.stats?.model_name
                  ? { model_id: message.stats.model_name, engine: message.stats.engine ?? undefined }
                  : null
              )
              if (!cfg) return null
              const modelMismatch = !loadedModelId || loadedModelId !== cfg.model_id
              if (!modelMismatch) return null
              return (
                <ActionBtn onClick={() => onReload(cfg)} title={`Reload: ${cfg.model_id.split('/').pop()}`}>
                  <svg className="w-3.5 h-3.5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.01"/>
                  </svg>
                </ActionBtn>
              )
            })()}
          </div>
        )}

        <AnimatePresence>
          {savingPair && promptForPair && !isUser && (
            <PairEditor
              key="pair-editor"
              prompt={promptForPair}
              assistantContent={visibleText}
              sourceConvId={sourceConvId}
              sourceMsgId={sourceMsgId}
              modelId={loadedModelId ?? undefined}
              onSave={() => setSavingPair(false)}
              onClose={() => setSavingPair(false)}
            />
          )}
        </AnimatePresence>

        {/* Stats always visible on last assistant message while streaming */}
        {!isUser && streaming && isLast && genStats && (
          <GenStatsRow stats={genStats} modelName={modelName} />
        )}
      </div>
    </motion.div>
  )
}

function ActionBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <button onClick={onClick} title={title}
      className="w-6 h-6 flex items-center justify-center rounded-sm text-text-muted hover:text-text-secondary hover:bg-white/5 cursor-pointer transition-colors">
      {children}
    </button>
  )
}

export const MessageRow = memo(MessageRowInner, (prev, next) => {
  if (prev.streaming !== next.streaming) return false
  if (prev.isLast !== next.isLast) return false
  if (prev.message.content !== next.message.content) return false
  if (prev.genStats !== next.genStats) return false
  if (prev.loadedModelId !== next.loadedModelId) return false
  return true
})

function Avatar({ role }: { role: string }): React.ReactElement {
  const isUser = role === 'user'
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
      isUser ? 'bg-accent-dim' : 'bg-green/15'
    }`}>
      {isUser ? (
        <svg className="w-3.5 h-3.5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 text-green" viewBox="0 0 20 20" fill="none">
          <path d="M3 10 C3 5.5 6.5 2 11 2 s8 3.5 8 8 -3.5 8-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <circle cx="7" cy="10" r="1.2" fill="currentColor"/>
          <circle cx="11" cy="10" r="1.2" fill="currentColor"/>
          <circle cx="15" cy="10" r="1.2" fill="currentColor"/>
        </svg>
      )}
    </div>
  )
}

function GenStatsRow({ stats, modelName }: { stats: GenerationStats; modelName?: string | null }): React.ReactElement {
  return (
    <div className="flex gap-2.5 px-0.5 text-xs text-text-muted items-center flex-wrap">
      <span>{stats.tokensGenerated} tokens</span>
      <span className="text-green">{stats.tokensPerSecond.toFixed(1)} tok/s</span>
      {stats.ttftMs != null && <span>{stats.ttftMs}ms TTFT</span>}
      <span>{(stats.timeMs / 1000).toFixed(2)}s</span>
      {stats.engine && <span className="text-text-muted/50">{stats.engine}</span>}
      {(stats.modelName ?? modelName) && <span className="text-text-muted/50 truncate max-w-[160px]">· {stats.modelName ?? modelName}</span>}
    </div>
  )
}
