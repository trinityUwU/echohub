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
  // While streaming (tag still open): always expanded, showing live content.
  // Once done: collapsed by default, user can toggle.
  const [open, setOpen] = useState(false)
  const isOpen = streaming ? true : open

  const nameMatch = content.match(/"name"\s*:\s*"([^"]+)"/)
  let toolName = nameMatch ? nameMatch[1] : ''
  let argsDisplay = content.trim()
  let wordCount = 0

  if (!streaming) {
    try {
      const parsed = JSON.parse(content.trim())
      toolName = parsed.name ?? toolName
      const args = parsed.arguments ?? parsed.args ?? parsed
      const argsStr = JSON.stringify(typeof args === 'string' ? JSON.parse(args) : args, null, 2)
      argsDisplay = argsStr
      wordCount = argsStr.trim().split(/\s+/).length
    } catch { /* raw display */ }
  }

  return (
    <div className="mb-2 rounded-lg border border-white/5 bg-surface overflow-hidden">
      <button
        onClick={() => !streaming && setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${streaming ? 'cursor-default' : 'hover:bg-white/[0.03] cursor-pointer'}`}
      >
        {streaming ? (
          <motion.svg
            className="w-3.5 h-3.5 flex-shrink-0 text-text-muted"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          >
            <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
          </motion.svg>
        ) : (
          <svg className="w-3.5 h-3.5 flex-shrink-0 text-text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
        )}
        <span className={`text-xs font-mono ${streaming ? 'text-text-muted animate-pulse' : 'text-text-muted/80'}`}>
          {toolName || 'tool_call'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {streaming ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted/60 tracking-wide uppercase">
              running
            </span>
          ) : (
            <>
              {wordCount > 0 && (
                <span className="text-[10px] text-text-muted/40">{wordCount}w</span>
              )}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted/50 tracking-wide uppercase">
                done
              </span>
              <svg
                className={`w-3 h-3 text-text-muted/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </>
          )}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <pre className="px-3 pb-3 pt-2 text-xs text-text-muted/60 leading-relaxed whitespace-pre-wrap border-t border-white/5 font-mono max-h-64 overflow-y-auto">
              {streaming && !argsDisplay.trim() ? (
                <span className="text-text-muted/40 italic">Executing…</span>
              ) : (
                argsDisplay
              )}
              {streaming && <span className="inline-block w-1 h-3 bg-text-muted/40 animate-pulse rounded-sm ml-0.5 align-middle" />}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── ToolResultBlock ───────────────────────────────────────────────────────────

type AgentResult = { status: string; summary: string; findings: Record<string, unknown>; actions_taken: string[] }

function _parseAgentResult(content: string): AgentResult | null {
  try {
    const parsed = JSON.parse(content.trim())
    if (parsed && typeof parsed.status === 'string' && typeof parsed.summary === 'string') return parsed as AgentResult
  } catch { /* not JSON */ }
  return null
}

function _parseHarnessFeedback(content: string): { main: string; harness: string[] } | null {
  const lines = content.split('\n')
  const harnessLines = lines.filter(l => l.trim().startsWith('[harness]') || (l.trim().startsWith('line ') && l.includes('[')))
  const mainLines = lines.filter(l => !l.trim().startsWith('[harness]') && !(l.trim().startsWith('line ') && l.includes('[')))
  if (harnessLines.length === 0) return null
  return { main: mainLines.join('\n').trim(), harness: harnessLines }
}

function AgentResultView({ result }: { result: AgentResult }): React.ReactElement {
  const statusColor = result.status === 'success' ? 'text-green bg-green/10'
    : result.status === 'failed' ? 'text-red bg-red/10'
    : 'text-yellow bg-yellow/10'
  return (
    <div className="px-3 pb-3 pt-2 border-t border-white/5 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide ${statusColor}`}>{result.status}</span>
        <span className="text-xs text-text-muted/80">{result.summary}</span>
      </div>
      {result.actions_taken?.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] text-text-muted/40 uppercase tracking-wide">Actions</p>
          {result.actions_taken.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-text-muted/60 font-mono">
              <span className="text-text-muted/30">›</span>{a}
            </div>
          ))}
        </div>
      )}
      {Object.keys(result.findings ?? {}).length > 0 && (
        <div className="text-[11px] text-text-muted/50 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto border-t border-white/5 pt-2">
          {JSON.stringify(result.findings, null, 2)}
        </div>
      )}
    </div>
  )
}

function HarnessView({ main, harness }: { main: string; harness: string[] }): React.ReactElement {
  const hasFatal = harness.some(l => l.includes('FATAL') || l.includes('fatal'))
  const hasError = harness.some(l => l.includes('ERROR') || l.includes('error'))
  const color = hasFatal || hasError ? 'text-red' : 'text-yellow'
  return (
    <div className="px-3 pb-3 pt-2 border-t border-white/5 space-y-2">
      {main && <p className="text-xs text-text-muted/60 font-mono">{main}</p>}
      <div className={`space-y-0.5 ${color}`}>
        {harness.map((l, i) => (
          <p key={i} className="text-[11px] font-mono">{l.trim()}</p>
        ))}
      </div>
    </div>
  )
}

function ToolResultBlock({ tool, content }: { tool: string; content: string }): React.ReactElement {
  const [open, setOpen] = useState(false)

  const agentResult = tool === 'invoke_agent' ? _parseAgentResult(content) : null
  const harnessParsed = !agentResult && tool !== 'search_memory' ? _parseHarnessFeedback(content) : null
  const isMemoryResult = tool === 'search_memory' || tool === 'store_memory'
  const words = content.trim() ? content.trim().split(/\s+/).length : 0

  // Status badge for header
  const statusBadge = agentResult
    ? <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-medium ${agentResult.status === 'success' ? 'text-green bg-green/10' : agentResult.status === 'failed' ? 'text-red bg-red/10' : 'text-yellow bg-yellow/10'}`}>{agentResult.status}</span>
    : harnessParsed
      ? <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-medium text-red bg-red/10">harness</span>
      : isMemoryResult
        ? <span className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide font-medium text-purple bg-purple/10">memory</span>
        : null

  const alwaysOpen = agentResult !== null || harnessParsed !== null
  const isOpen = alwaysOpen || open

  return (
    <div className="mb-2 rounded-lg border border-white/5 bg-surface overflow-hidden">
      <button
        onClick={() => !alwaysOpen && setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${alwaysOpen ? 'cursor-default' : 'hover:bg-white/[0.03] cursor-pointer'}`}
      >
        <svg className="w-3.5 h-3.5 flex-shrink-0 text-text-muted/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span className="text-xs font-mono text-text-muted/80">{tool}</span>
        <div className="ml-auto flex items-center gap-2">
          {statusBadge}
          {!alwaysOpen && words > 0 && <span className="text-[10px] text-text-muted/40">{words}w</span>}
          {!alwaysOpen && (
            <svg className={`w-3 h-3 text-text-muted/40 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} style={{ overflow: 'hidden' }}>
            {agentResult
              ? <AgentResultView result={agentResult} />
              : harnessParsed
                ? <HarnessView main={harnessParsed.main} harness={harnessParsed.harness} />
                : <div className="px-3 pb-3 pt-2 text-xs text-text-muted/60 leading-relaxed whitespace-pre-wrap border-t border-white/5 font-mono max-h-64 overflow-y-auto">{content}</div>
            }
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
