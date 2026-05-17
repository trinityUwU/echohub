import { motion } from 'framer-motion'
import type { ChatMessage, GenerationStats, MessageStats } from '@/types'
import { MarkdownContent } from './MarkdownContent'
import { ThinkingBlock } from './ThinkingBlock'

interface MessageRowProps {
  message: ChatMessage
  genStats?: GenerationStats | null
}

export function MessageRow({ message, genStats }: MessageRowProps): React.ReactElement {
  const isUser = message.role === 'user'
  const text = typeof message.content === 'string'
    ? message.content
    : message.content.find(p => p.type === 'text')?.text ?? ''
  const images = typeof message.content !== 'string'
    ? message.content.filter(p => p.type === 'image_url').map(p => (p as { type: 'image_url'; image_url: { url: string } }).image_url.url)
    : []

  const thinkMatch   = text.match(/^<think>([\s\S]*?)<\/think>([\s\S]*)$/s)
  const thinkOpen    = !thinkMatch && text.startsWith('<think>')  // still streaming inside <think>
  const visibleText  = thinkMatch
    ? thinkMatch[2].trim()
    : thinkOpen
      ? ''
      : text

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={`flex px-5 py-1.5 gap-3 hover:bg-white/[0.02] transition-colors ${isUser ? 'flex-row-reverse' : ''}`}>
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
        <div className={`rounded-md px-3.5 py-2.5 text-md leading-relaxed border ${
          isUser ? 'bg-accent-dim border-accent/20' : 'bg-elevated border-border'
        } text-text-primary`}>
          {visibleText ? <MarkdownContent content={visibleText} /> : <span className="text-text-muted animate-pulse">…</span>}
        </div>
        {genStats && !isUser && <GenStatsRow stats={genStats} />}
        {!genStats && message.stats && !isUser && <MsgStatsRow stats={message.stats} />}
      </div>
    </motion.div>
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

function GenStatsRow({ stats }: { stats: GenerationStats }): React.ReactElement {
  return (
    <div className="flex gap-2.5 px-0.5 text-xs text-text-muted">
      <span>{stats.tokensGenerated} tokens</span>
      <span className="text-green">{stats.tokensPerSecond.toFixed(1)} tok/s</span>
      <span>{(stats.timeMs / 1000).toFixed(2)}s</span>
    </div>
  )
}

function MsgStatsRow({ stats }: { stats: MessageStats }): React.ReactElement {
  return (
    <div className="flex gap-2.5 px-0.5 text-xs text-text-muted">
      <span>{stats.tokens} tokens</span>
      <span className="text-green">{stats.tok_per_sec.toFixed(1)} tok/s</span>
      <span>{(stats.time_ms / 1000).toFixed(2)}s</span>
    </div>
  )
}
