import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import type { ChatMessage, GenerationStats } from '@/types'
import { MarkdownContent } from './MarkdownContent'
import { ThinkingBlock } from './ThinkingBlock'

interface MessageRowProps {
  message: ChatMessage
  isLast?: boolean
  genStats?: GenerationStats | null
  modelName?: string | null
  streaming?: boolean
  onRegenerate?: () => void
  onEditUser?: (text: string) => void
}

export function MessageRow({ message, isLast, genStats, modelName, streaming, onRegenerate, onEditUser }: MessageRowProps): React.ReactElement {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const text = typeof message.content === 'string'
    ? message.content
    : message.content.find(p => p.type === 'text')?.text ?? ''
  const images = typeof message.content !== 'string'
    ? message.content.filter(p => p.type === 'image_url').map(p => (p as { type: 'image_url'; image_url: { url: string } }).image_url.url)
    : []

  const thinkMatch = text.match(/^<think>([\s\S]*?)<\/think>([\s\S]*)$/s)
  const thinkOpen  = !thinkMatch && text.startsWith('<think>')
  const visibleText = thinkMatch ? thinkMatch[2].trim() : thinkOpen ? '' : text

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
      <div className={`max-w-[680px] flex flex-col gap-1 ${isUser ? 'items-end' : ''}`}>
        {images.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-1">
            {images.map((url, i) => (
              <img key={i} src={url} alt="" className="max-h-48 max-w-xs rounded-sm border border-border object-contain" />
            ))}
          </div>
        )}
        {(thinkMatch || thinkOpen) && !isUser && (
          <ThinkingBlock content={thinkMatch ? thinkMatch[1] : text.slice(7)} streaming={thinkOpen} />
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
            {visibleText ? <MarkdownContent content={visibleText} /> : <span className="text-text-muted animate-pulse">…</span>}
          </div>
        )}

        {/* Footer */}
        {!editing && !streaming && (
          <div className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'flex-row-reverse' : ''}`}>
            {/* Stats — left side for assistant */}
            {!isUser && (genStats || message.stats) && (
              <span className="text-xs text-text-muted mr-2">
                {genStats
                  ? <>{genStats.tokensGenerated} tokens · <span className="text-green">{genStats.tokensPerSecond.toFixed(1)} tok/s</span> · {(genStats.timeMs / 1000).toFixed(2)}s{modelName && <span className="text-text-muted/50"> · {modelName}</span>}</>
                  : message.stats
                    ? <>{message.stats.tokens} tokens · <span className="text-green">{message.stats.tok_per_sec.toFixed(1)} tok/s</span> · {(message.stats.time_ms / 1000).toFixed(2)}s{modelName && <span className="text-text-muted/50"> · {modelName}</span>}</>
                    : null
                }
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
          </div>
        )}

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
    <div className="flex gap-2.5 px-0.5 text-xs text-text-muted items-center">
      <span>{stats.tokensGenerated} tokens</span>
      <span className="text-green">{stats.tokensPerSecond.toFixed(1)} tok/s</span>
      <span>{(stats.timeMs / 1000).toFixed(2)}s</span>
      {modelName && <span className="text-text-muted/50 truncate max-w-[160px]">· {modelName}</span>}
    </div>
  )
}
