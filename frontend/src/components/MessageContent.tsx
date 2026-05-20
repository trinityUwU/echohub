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
  | { type: 'tool_call'; content: string; open: boolean }
  | { type: 'tool_result'; tool: string; content: string }

// ── Parser ────────────────────────────────────────────────────────────────────
// State-machine parser that tracks in_think context.
//
// Qwen3 patterns handled:
//   <think>text <tool_call>json</tool_call> more text</think>  → think wraps everything
//   text</think>                                               → orphan close, text = thinking
//   <tool_call>json</tool_call>thinking text</think>           → post-tool text = thinking
//   <tool_result tool="x">...</tool_result>                   → always a result segment

function parseSegments(raw: string): Segment[] {
  const segments: Segment[] = []

  // Tags we scan for
  const TAGS = ['<think>', '</think>', '<tool_call>', '</tool_call>', '<tool_result'] as const
  type Tag = typeof TAGS[number]

  // Find next tag occurrence from pos
  function nextTag(from: number): { tag: Tag; pos: number } | null {
    let best: { tag: Tag; pos: number } | null = null
    for (const tag of TAGS) {
      const p = raw.indexOf(tag, from)
      if (p !== -1 && (best === null || p < best.pos)) best = { tag, pos: p }
    }
    return best
  }

  let pos = 0
  let inThink = false

  // Buffer for current thinking or text content
  let buf = ''
  let bufType: 'text' | 'thinking' = 'text'

  const flushBuf = (open = false) => {
    if (!buf.trim()) { buf = ''; return }
    if (bufType === 'thinking') {
      segments.push({ type: 'thinking', content: buf, open })
    } else {
      segments.push({ type: 'text', content: buf })
    }
    buf = ''
  }

  while (pos <= raw.length) {
    const found = nextTag(pos)

    if (!found) {
      // Rest of string
      buf += raw.slice(pos)
      // If we're still in_think at end, the thinking is open (still streaming)
      flushBuf(inThink)
      break
    }

    // Accumulate text before the tag
    buf += raw.slice(pos, found.pos)
    pos = found.pos

    if (found.tag === '<think>') {
      flushBuf()
      inThink = true
      bufType = 'thinking'
      pos += 7

    } else if (found.tag === '</think>') {
      // Close current think block — flush as thinking (closed)
      flushBuf(false)
      inThink = false
      bufType = 'text'
      pos += 8

    } else if (found.tag === '<tool_call>') {
      // Flush buffered text/thinking before this tool_call
      flushBuf(inThink)
      pos += 11
      // Collect tool_call content until </tool_call>
      const closePos = raw.indexOf('</tool_call>', pos)
      if (closePos === -1) {
        // Still streaming — unclosed
        segments.push({ type: 'tool_call', content: raw.slice(pos), open: true })
        pos = raw.length + 1
        break
      }
      segments.push({ type: 'tool_call', content: raw.slice(pos, closePos), open: false })
      pos = closePos + 12
      // After tool_call, if we're in_think context, resume collecting thinking text
      bufType = inThink ? 'thinking' : 'text'

    } else if (found.tag === '</tool_call>') {
      // Orphan closing tag — skip it
      pos += 12

    } else if (found.tag === '<tool_result') {
      // Flush buffered content
      flushBuf(inThink)
      // Parse <tool_result tool="name">
      const tagEnd = raw.indexOf('>', pos)
      if (tagEnd === -1) {
        // Incomplete tag
        buf += raw.slice(pos)
        flushBuf(false)
        break
      }
      const tagStr = raw.slice(pos, tagEnd + 1)
      const toolMatch = tagStr.match(/tool="([^"]*)"/)
      const toolName = toolMatch ? toolMatch[1] : 'tool'
      const closeTag = '</tool_result>'
      const closePos = raw.indexOf(closeTag, tagEnd + 1)
      if (closePos === -1) {
        // Still streaming
        segments.push({ type: 'tool_result', tool: toolName, content: raw.slice(tagEnd + 1) })
        pos = raw.length + 1
        break
      }
      segments.push({ type: 'tool_result', tool: toolName, content: raw.slice(tagEnd + 1, closePos) })
      pos = closePos + closeTag.length
    }
  }

  // Handle orphan </think>: if no <think> was seen but </think> is present,
  // reparse with everything before the first </think> treated as implicit thinking
  const hasOpenThink = raw.includes('<think>')
  const hasCloseThink = raw.includes('</think>')
  if (!hasOpenThink && hasCloseThink && segments.length > 0) {
    // Already handled by bufType logic above — but if no think tag seen,
    // everything before first </think> that was collected as 'text' should be 'thinking'
    const firstCloseThink = raw.indexOf('</think>')
    if (firstCloseThink > 0) {
      // Re-tag: segments that come entirely before firstCloseThink and are 'text' → 'thinking'
      let charCount = 0
      return segments.map(seg => {
        const start = charCount
        charCount += seg.content.length
        if (seg.type === 'text' && start < firstCloseThink && charCount <= firstCloseThink + 8) {
          return { type: 'thinking' as const, content: seg.content, open: false }
        }
        return seg
      })
    }
  }

  return segments
}

// ── ToolCallBlock ─────────────────────────────────────────────────────────────

function ToolCallBlock({ content, streaming }: { content: string; streaming?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(true)

  // Extract tool name even from partial JSON during streaming
  const nameMatch = content.match(/"name"\s*:\s*"([^"]+)"/)
  let toolName = nameMatch ? nameMatch[1] : ''
  let argsDisplay = content.trim()

  if (!streaming) {
    try {
      const parsed = JSON.parse(content.trim())
      toolName = parsed.name ?? toolName
      const args = parsed.arguments ?? parsed.args ?? parsed
      argsDisplay = JSON.stringify(typeof args === 'string' ? JSON.parse(args) : args, null, 2)
    } catch { /* raw display */ }
  }

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
        {streaming && (
          <span className="text-2xs text-yellow-400/60 ml-1 flex items-center gap-1">
            <span className="animate-pulse">generating</span>
            <span className="inline-block w-1 h-2.5 bg-yellow-400/60 animate-pulse rounded-sm" />
          </span>
        )}
        <motion.svg
          className="w-3 h-3 ml-auto flex-shrink-0 opacity-50 text-yellow-400"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.15 }}
        >
          <polyline points="9 18 15 12 9 6"/>
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (argsDisplay || streaming) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-yellow-500/10"
          >
            <pre className="text-2xs font-mono leading-relaxed px-3 py-2 text-yellow-200/60 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
              {argsDisplay}
              {streaming && <span className="inline-block w-1 h-3 bg-yellow-400/60 animate-pulse rounded-sm ml-0.5 align-middle" />}
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
