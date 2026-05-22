import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { AgentStep } from '@/types'

// ── ToolCallBlock ─────────────────────────────────────────────────────────────

export function ToolCallBlock({ content, streaming, agentSteps = [] }: {
  content: string
  streaming?: boolean
  agentSteps?: AgentStep[]
}): React.ReactElement {
  const lastStep = agentSteps[agentSteps.length - 1]
  const agentRunning = agentSteps.length > 0 && lastStep?.type !== 'agent_done' && lastStep?.type !== 'agent_error'
  const [open, setOpen] = useState(false)
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

  const liveText = agentSteps
    .filter(s => s.type === 'agent_text_chunk')
    .map(s => s.content ?? '')
    .join('')

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
            {isInvokeAgent && agentSteps.length > 0 && (
              <div className="border-t border-white/5">
                {thinkingChunks && (
                  <div className="px-3 pt-2 pb-1">
                    <div className={`rounded-md px-3 py-2 ${isThinking ? 'bg-amber-500/5 border border-amber-500/10' : 'bg-white/[0.02] border border-white/5'}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        {isThinking ? (
                          <motion.div className="w-1.5 h-1.5 rounded-full bg-amber-400/60"
                            animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.2 }} />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                        )}
                        <span className={`text-[10px] font-mono uppercase tracking-wider ${isThinking ? 'text-amber-400/60' : 'text-text-muted/40'}`}>
                          {isThinking ? 'thinking…' : 'thought'}
                        </span>
                      </div>
                      <p className={`text-[11px] leading-relaxed font-mono whitespace-pre-wrap max-h-32 overflow-y-auto ${isThinking ? 'text-amber-200/50' : 'text-text-muted/40'}`}>
                        {thinkingChunks}
                        {isThinking && <span className="inline-block w-1 h-3 bg-amber-400/40 animate-pulse rounded-sm ml-0.5 align-middle" />}
                      </p>
                    </div>
                  </div>
                )}
                {liveText && (
                  <div className="px-3 pb-2">
                    <p className="text-[11px] text-text-muted/70 leading-relaxed whitespace-pre-wrap font-mono">
                      {liveText}
                      {agentRunning && !isThinking && (
                        <span className="inline-block w-1 h-3 bg-text-muted/40 animate-pulse rounded-sm ml-0.5 align-middle" />
                      )}
                    </p>
                  </div>
                )}
                {milestones.length > 0 && (
                  <div className="px-3 pt-1 pb-2 space-y-0.5">
                    {milestones.map((step, i) => (
                      <div key={i} className="flex items-center gap-2 py-0.5">
                        <AgentStepIcon step={step} />
                        <span className="text-[11px] font-mono text-text-muted/60 truncate">
                          {step.type === 'agent_tool_start' && `→ ${step.tool ?? ''}${step.args && Object.keys(step.args).length ? ` (${Object.values(step.args)[0]?.toString().slice(0, 40)})` : ''}`}
                          {step.type === 'agent_tool_done' && `✓ ${step.tool ?? ''}${step.result_preview ? ` — ${step.result_preview.slice(0, 50)}` : ''}`}
                          {step.type === 'agent_done' && `completed (${step.status ?? 'success'})${step.summary ? ` — ${step.summary.slice(0, 60)}` : ''}`}
                          {step.type === 'agent_error' && `error — ${step.error?.slice(0, 80) ?? 'unknown'}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <pre className="px-3 pb-3 pt-2 text-xs text-text-muted/60 leading-relaxed whitespace-pre-wrap border-t border-white/5 font-mono max-h-64 overflow-y-auto">
              {streaming && !argsDisplay.trim() ? (
                <span className="text-text-muted/40 italic">Executing…</span>
              ) : argsDisplay}
              {streaming && <span className="inline-block w-1 h-3 bg-text-muted/40 animate-pulse rounded-sm ml-0.5 align-middle" />}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AgentStepIcon({ step }: { step: AgentStep }): React.ReactElement {
  if (step.type === 'agent_tool_start') {
    return (
      <motion.svg className="w-3 h-3 flex-shrink-0 text-text-muted/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
        <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
      </motion.svg>
    )
  }
  if (step.type === 'agent_tool_done') {
    return (
      <svg className="w-3 h-3 flex-shrink-0 text-green-500/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    )
  }
  if (step.type === 'agent_done') {
    return (
      <svg className="w-3 h-3 flex-shrink-0 text-accent/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    )
  }
  return (
    <svg className="w-3 h-3 flex-shrink-0 text-red-400/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
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
