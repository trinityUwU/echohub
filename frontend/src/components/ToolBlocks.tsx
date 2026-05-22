import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { AgentStep } from '@/types'
import { ToolCallBody } from './ToolCallBody'

function _extractTaskFromArgs(raw: string): string {
  const m = raw.match(/"task"\s*:\s*"([\s\S]*)/)
  if (!m) return raw.slice(0, 200)
  return m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/, '"')
}

// ── ToolCallBlock ─────────────────────────────────────────────────────────────

export function ToolCallBlock({ content, streaming, agentSteps = [] }: {
  content: string
  streaming?: boolean
  agentSteps?: AgentStep[]
}): React.ReactElement {
  const lastStep = agentSteps[agentSteps.length - 1]
  const agentRunning = agentSteps.length > 0 && lastStep?.type !== 'agent_done' && lastStep?.type !== 'agent_error'
  const [open, setOpen] = useState(false)
  // Auto-open when first step arrives — stays open after agent finishes
  const hasSteps = agentSteps.length > 0
  useEffect(() => {
    if (hasSteps) setOpen(true)
  }, [hasSteps])
  const isOpen = streaming || agentRunning ? true : open

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

  const rawLiveText = agentSteps
    .filter(s => s.type === 'agent_text_chunk')
    .map(s => s.content ?? '')
    .join('')
  // Strip <tool_call>...</tool_call> blocks and </tool_call> fragments — sub-agent emits these as text
  const liveText = rawLiveText
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<\/?tool_call>/g, '')
    .trim()

  const thinkingChunks = agentSteps.filter(s => s.type === 'agent_thinking_chunk').map(s => s.content ?? '').join('')
  const hasThinkingEnd = agentSteps.some(s => s.type === 'agent_thinking_end')
  const isThinking = thinkingChunks.length > 0 && !hasThinkingEnd

  const milestones = agentSteps.filter(s =>
    s.type === 'agent_tool_start' ||
    s.type === 'agent_tool_done' ||
    s.type === 'agent_done' ||
    s.type === 'agent_error'
  )

  const isInvokeAgent = toolName === 'invoke_agent'

  return (
    <div className="mb-2 rounded-lg border border-white/5 bg-surface overflow-hidden">
      <button
        onClick={() => !(streaming || agentRunning) && setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${(streaming || agentRunning) ? 'cursor-default' : 'hover:bg-white/[0.03] cursor-pointer'}`}
      >
        {(streaming || agentRunning) ? (
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
        <span className={`text-xs font-mono ${(streaming || agentRunning) ? 'text-text-muted animate-pulse' : 'text-text-muted/80'}`}>
          {toolName || 'tool_call'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {(streaming || agentRunning) ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted/60 tracking-wide uppercase">running</span>
          ) : (
            <>
              {wordCount > 0 && <span className="text-[10px] text-text-muted/40">{wordCount}w</span>}
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted/50 tracking-wide uppercase">done</span>
              <svg className={`w-3 h-3 text-text-muted/40 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </>
          )}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} style={{ overflow: 'hidden' }}>
            {isInvokeAgent ? (
              <InvokeAgentPanel
                argsDisplay={argsDisplay}
                streaming={streaming}
                agentSteps={agentSteps}
                thinkingChunks={thinkingChunks}
                isThinking={isThinking}
                liveText={liveText}
                milestones={milestones}
                agentRunning={agentRunning}
              />
            ) : (
              <ToolCallBody
                toolName={toolName}
                argsDisplay={argsDisplay}
                streaming={!!streaming}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}



// ── InvokeAgentPanel ─────────────────────────────────────────────────────────

interface InvokeAgentPanelProps {
  argsDisplay: string
  streaming: boolean
  agentSteps: AgentStep[]
  thinkingChunks: string
  isThinking: boolean
  liveText: string
  milestones: AgentStep[]
  agentRunning: boolean
}

function InvokeAgentPanel({
  argsDisplay, streaming, agentSteps,
  thinkingChunks, isThinking, liveText, milestones, agentRunning,
}: InvokeAgentPanelProps): React.ReactElement {
  const [briefOpen, setBriefOpen] = useState(false)
  const taskText = _extractTaskFromArgs(argsDisplay)
  const hasSteps = agentSteps.length > 0

  return (
    <div className="border-t border-white/5">
      {/* Brief section — collapsible, live during streaming */}
      <div>
        <button
          onClick={() => setBriefOpen(o => !o)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.02] transition-colors"
        >
          {streaming && !hasSteps ? (
            <motion.div className="w-1.5 h-1.5 rounded-full bg-accent/60 flex-shrink-0"
              animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 0.9 }} />
          ) : (
            <svg className="w-3 h-3 text-text-muted/30 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
          )}
          <span className="text-[10px] font-mono text-text-muted/40 uppercase tracking-wider flex-1">
            {streaming && !hasSteps ? 'writing brief…' : 'brief'}
          </span>
          {taskText.length > 0 && (
            <span className="text-[10px] text-text-muted/25 font-mono">{taskText.length}c</span>
          )}
          <svg className={`w-3 h-3 text-text-muted/25 transition-transform flex-shrink-0 ${(briefOpen || (streaming && !hasSteps)) ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <AnimatePresence initial={false}>
          {(briefOpen || (streaming && !hasSteps)) && (
            <motion.div key="brief" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }} style={{ overflow: 'hidden' }}>
              <div className="px-3 pb-2.5">
                <p className="text-[11px] text-text-muted/45 font-mono leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {taskText || argsDisplay}
                  {streaming && !hasSteps && (
                    <span className="inline-block w-1 h-3 bg-text-muted/30 animate-pulse rounded-sm ml-0.5 align-middle" />
                  )}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Live execution panel — shown once agent starts running */}
      {hasSteps && (
        <AgentLivePanel
          thinkingChunks={thinkingChunks}
          isThinking={isThinking}
          liveText={liveText}
          milestones={milestones}
          agentRunning={agentRunning}
        />
      )}
    </div>
  )
}

// ── AgentLivePanel ────────────────────────────────────────────────────────────

interface AgentLivePanelProps {
  thinkingChunks: string
  isThinking: boolean
  liveText: string
  milestones: AgentStep[]
  agentRunning: boolean
}

function AgentLivePanel({ thinkingChunks, isThinking, liveText, milestones, agentRunning }: AgentLivePanelProps): React.ReactElement {
  // Merge start+done pairs into single rows: done supersedes start for same tool+call
  const toolRows = buildToolRows(milestones)
  const finalStep = milestones.find(s => s.type === 'agent_done' || s.type === 'agent_error')

  return (
    <div className="border-t border-white/5">
      {/* Thinking block — only show if substantial content */}
      {thinkingChunks && thinkingChunks.length > 30 && (
        <div className="px-3 pt-2 pb-1">
          <div className={`rounded px-2.5 py-1.5 ${isThinking ? 'bg-amber-500/5 border border-amber-500/10' : 'bg-white/[0.02] border border-white/5'}`}>
            <div className="flex items-center gap-1.5 mb-0.5">
              {isThinking
                ? <motion.div className="w-1.5 h-1.5 rounded-full bg-amber-400/60" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.2 }} />
                : <div className="w-1.5 h-1.5 rounded-full bg-white/15" />}
              <span className={`text-[10px] uppercase tracking-wider font-mono ${isThinking ? 'text-amber-400/50' : 'text-text-muted/30'}`}>
                {isThinking ? 'thinking…' : 'thought'}
              </span>
            </div>
            <p className={`text-[11px] font-mono leading-relaxed whitespace-pre-wrap max-h-24 overflow-y-auto ${isThinking ? 'text-amber-200/40' : 'text-text-muted/30'}`}>
              {thinkingChunks}
              {isThinking && <span className="inline-block w-1 h-3 bg-amber-400/40 animate-pulse rounded-sm ml-0.5 align-middle" />}
            </p>
          </div>
        </div>
      )}

      {/* Tool call rows */}
      {toolRows.length > 0 && (
        <div className="px-3 pt-2 pb-1.5 space-y-1.5">
          {toolRows.map((row, i) => (
            <div key={i} className="flex items-center gap-2 min-w-0">
              <div className="flex-shrink-0">
                {row.done
                  ? <svg className="w-3 h-3 text-green-500/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : <motion.svg className="w-3 h-3 text-text-muted/35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}><path d="M21 12a9 9 0 1 1-6.22-8.56"/></motion.svg>
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-[11px] font-mono text-text-muted/65 flex-shrink-0">{row.tool}</span>
                  {row.query && <span className="text-[11px] font-mono text-text-muted/35 truncate">{row.query}</span>}
                </div>
                {row.done && row.preview && (
                  <span className="text-[10px] text-text-muted/30 block truncate leading-tight mt-0.5">{row.preview}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Live synthesis text — only shown when there's meaningful content beyond tool calls */}
      {liveText && agentRunning && (
        <div className="px-3 pb-2 pt-0.5 border-t border-white/[0.04]">
          <p className="text-[11px] text-text-muted/45 leading-relaxed whitespace-pre-wrap font-mono max-h-20 overflow-hidden">
            {liveText}
            <span className="inline-block w-1 h-3 bg-text-muted/30 animate-pulse rounded-sm ml-0.5 align-middle" />
          </p>
        </div>
      )}

      {/* Final status */}
      {finalStep && (
        <div className="px-3 pb-2.5 flex items-center gap-2">
          {finalStep.type === 'agent_done'
            ? <svg className="w-3 h-3 text-accent/60 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            : <svg className="w-3 h-3 text-red-400/60 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          }
          <span className="text-[11px] text-text-muted/50 font-mono">
            {finalStep.type === 'agent_done' ? `done · ${finalStep.status ?? 'success'}` : `failed · ${finalStep.error?.slice(0, 60) ?? ''}`}
            {finalStep.summary && ` — ${finalStep.summary.slice(0, 80)}`}
          </span>
        </div>
      )}
    </div>
  )
}

interface ToolRow { tool: string; query: string; done: boolean; preview: string }

function buildToolRows(milestones: AgentStep[]): ToolRow[] {
  const rows: ToolRow[] = []
  const idx: Record<string, number> = {}

  for (const step of milestones) {
    if (step.type === 'agent_tool_start') {
      const firstArgVal = step.args ? Object.values(step.args)[0]?.toString().slice(0, 60) ?? '' : ''
      const key = `${step.tool}:${rows.length}`
      idx[key] = rows.length
      rows.push({ tool: step.tool ?? '', query: firstArgVal, done: false, preview: '' })
    } else if (step.type === 'agent_tool_done') {
      // Find last undone row for this tool
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].tool === step.tool && !rows[i].done) {
          rows[i].done = true
          rows[i].preview = step.result_preview ?? ''
          break
        }
      }
    }
  }
  return rows
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

export function ToolResultBlock({ tool, content }: { tool: string; content: string }): React.ReactElement {
  const [open, setOpen] = useState(false)

  const agentResult = tool === 'invoke_agent' ? _parseAgentResult(content) : null
  const harnessParsed = !agentResult && tool !== 'search_memory' ? _parseHarnessFeedback(content) : null
  const isMemoryResult = tool === 'search_memory' || tool === 'store_memory'
  const words = content.trim() ? content.trim().split(/\s+/).length : 0

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
