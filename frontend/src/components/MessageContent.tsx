import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ThinkingBlock } from './ThinkingBlock'
import { MarkdownContent } from './MarkdownContent'

interface Props {
  content: string
  streaming?: boolean
}

// ── Segment types ─────────────────────────────────────────────────────────────

type Segment =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string; open: boolean }
  | { type: 'tool_call'; content: string; open: boolean }       // inside <tool_call>...</tool_call>
  | { type: 'tool_result'; tool: string; content: string }      // inside <tool_result tool="...">

// ── Parser ────────────────────────────────────────────────────────────────────

function parseSegments(raw: string): Segment[] {
  const segments: Segment[] = []
  let pos = 0

  while (pos < raw.length) {
    // Find the earliest opening tag
    const thinkStart = raw.indexOf('<think>', pos)
    const tcStart = raw.indexOf('<tool_call>', pos)
    const trStart = raw.indexOf('<tool_result', pos)

    const next = Math.min(
      thinkStart === -1 ? Infinity : thinkStart,
      tcStart === -1 ? Infinity : tcStart,
      trStart === -1 ? Infinity : trStart,
    )

    if (next === Infinity) {
      // No more tags
      const tail = raw.slice(pos)
      if (tail) segments.push({ type: 'text', content: tail })
      break
    }

    // Text before next tag
    if (next > pos) {
      segments.push({ type: 'text', content: raw.slice(pos, next) })
    }

    if (next === thinkStart) {
      const end = raw.indexOf('</think>', next)
      if (end === -1) {
        // Still streaming — unclosed
        segments.push({ type: 'thinking', content: raw.slice(next + 7), open: true })
        break
      }
      segments.push({ type: 'thinking', content: raw.slice(next + 7, end), open: false })
      pos = end + 8
    } else if (next === tcStart) {
      const end = raw.indexOf('</tool_call>', next)
      if (end === -1) {
        // Still streaming — unclosed
        segments.push({ type: 'tool_call', content: raw.slice(next + 11), open: true })
        break
      }
      segments.push({ type: 'tool_call', content: raw.slice(next + 11, end), open: false })
      pos = end + 12
    } else {
      // <tool_result tool="...">...</tool_result>
      const tagEnd = raw.indexOf('>', next)
      if (tagEnd === -1) {
        // Incomplete tag — treat as text
        const tail = raw.slice(pos)
        if (tail) segments.push({ type: 'text', content: tail })
        break
      }
      const tagStr = raw.slice(next, tagEnd + 1)
      const toolMatch = tagStr.match(/tool="([^"]*)"/)
      const toolName = toolMatch ? toolMatch[1] : 'tool'
      const closeTag = '</tool_result>'
      const closePos = raw.indexOf(closeTag, tagEnd)
      if (closePos === -1) {
        // Still streaming
        segments.push({ type: 'tool_result', tool: toolName, content: raw.slice(tagEnd + 1) })
        break
      }
      segments.push({ type: 'tool_result', tool: toolName, content: raw.slice(tagEnd + 1, closePos) })
      pos = closePos + closeTag.length
    }
  }

  return segments
}

// ── ToolCallBlock ─────────────────────────────────────────────────────────────

function ToolCallBlock({ content, streaming }: { content: string; streaming?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(true)

  let toolName = ''
  let argsDisplay = content.trim()
  try {
    const parsed = JSON.parse(content.trim())
    toolName = parsed.name ?? ''
    const args = parsed.arguments ?? parsed.args ?? parsed
    argsDisplay = JSON.stringify(typeof args === 'string' ? JSON.parse(args) : args, null, 2)
  } catch { /* raw display */ }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="my-1.5 rounded-md border border-yellow-500/20 bg-yellow-500/5 overflow-hidden"
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/[0.03] transition-colors text-left"
      >
        {streaming ? (
          <motion.svg
            className="w-3 h-3 flex-shrink-0 text-yellow-400"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          >
            <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
          </motion.svg>
        ) : (
          <svg className="w-3 h-3 flex-shrink-0 text-yellow-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
        )}
        <span className="text-2xs font-mono font-medium text-yellow-300">
          {toolName || 'tool_call'}
        </span>
        {streaming && <span className="text-2xs text-yellow-400/60 animate-pulse ml-1">running…</span>}
        <motion.svg
          className="w-3 h-3 ml-auto flex-shrink-0 opacity-50 text-yellow-400"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }}
        >
          <polyline points="9 18 15 12 9 6"/>
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && argsDisplay && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-yellow-500/10"
          >
            <pre className="text-2xs font-mono leading-relaxed px-3 py-2 text-yellow-200/60 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
              {argsDisplay}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── ToolResultBlock ───────────────────────────────────────────────────────────

function ToolResultBlock({ tool, content }: { tool: string; content: string }): React.ReactElement {
  const [open, setOpen] = useState(false)

  const preview = content.length > 80 ? content.slice(0, 80) + '…' : content

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="my-1.5 rounded-md border border-green-500/20 bg-green-500/5 overflow-hidden"
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/[0.03] transition-colors text-left"
      >
        <svg className="w-3 h-3 flex-shrink-0 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span className="text-2xs font-mono font-medium text-green-300">{tool}</span>
        {!open && <span className="text-2xs text-green-400/50 truncate max-w-[240px] ml-1">{preview}</span>}
        <motion.svg
          className="w-3 h-3 ml-auto flex-shrink-0 opacity-50 text-green-400"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }}
        >
          <polyline points="9 18 15 12 9 6"/>
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-green-500/10"
          >
            <pre className="text-2xs font-mono leading-relaxed px-3 py-2 text-green-200/60 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
              {content}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── MessageContent ────────────────────────────────────────────────────────────

export function MessageContent({ content, streaming }: Props): React.ReactElement {
  const segments = parseSegments(content)

  return (
    <div>
      {segments.map((seg, i) => {
        const isLastSeg = i === segments.length - 1

        if (seg.type === 'thinking') {
          return (
            <ThinkingBlock
              key={i}
              content={seg.content.trim()}
              streaming={streaming && seg.open}
            />
          )
        }

        if (seg.type === 'tool_call') {
          return (
            <ToolCallBlock
              key={i}
              content={seg.content}
              streaming={streaming && seg.open}
            />
          )
        }

        if (seg.type === 'tool_result') {
          return <ToolResultBlock key={i} tool={seg.tool} content={seg.content} />
        }

        // text
        const trimmed = seg.content.trim()
        if (!trimmed) return null
        return (
          <MarkdownContent
            key={i}
            content={seg.content}
            streaming={streaming && isLastSeg}
          />
        )
      })}
    </div>
  )
}
