import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { detectMcp, startMcpStream, stopMcp, getMcpStatus } from '@/api/client'
import type { CommunitySkill, McpStatus } from '@/api/client'

// ── Plug icon ──────────────────────────────────────────────────────────────────

export function PlugIcon(): React.ReactElement {
  return (
    <svg className="w-3.5 h-3.5 text-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12"/>
      <path d="M5 3v4M3 5h4M19 17v4M17 19h4"/>
    </svg>
  )
}

// ── MCP status dot ─────────────────────────────────────────────────────────────

function McpStatusDot({ status }: { status: McpStatus['status'] }): React.ReactElement {
  const colorMap: Record<McpStatus['status'], string> = {
    running: 'bg-green',
    starting: 'bg-yellow',
    error: 'bg-red',
    stopped: 'bg-text-muted',
  }
  return (
    <span className="relative inline-flex items-center justify-center w-2.5 h-2.5 flex-shrink-0">
      <span className={`w-2.5 h-2.5 rounded-full ${colorMap[status]}`} />
      {status === 'running' && (
        <span className="absolute inset-0 rounded-full bg-green animate-ping opacity-60" />
      )}
    </span>
  )
}

// ── MCP section ────────────────────────────────────────────────────────────────

export function McpSection({ skill }: { skill: CommunitySkill }): React.ReactElement {
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectResult, setDetectResult] = useState<{ is_mcp: boolean; transport: string | null; start_command: string | null; port_hint: number | null; detail: string } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [startLog, setStartLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const startLogRef = useRef<HTMLDivElement>(null)

  const isMcp = skill.is_mcp === true || detectResult?.is_mcp === true
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const s = await getMcpStatus(skill.id)
      setMcpStatus(s)
    } catch { /* ignore */ }
  }, [skill.id])

  useEffect(() => {
    if (!isMcp) return
    void fetchStatus()
    pollRef.current = setInterval(() => { void fetchStatus() }, 3000)
    return () => { if (pollRef.current !== null) clearInterval(pollRef.current) }
  }, [isMcp, fetchStatus])

  const handleDetect = async (): Promise<void> => {
    setDetecting(true)
    setError(null)
    try {
      const result = await detectMcp(skill.id)
      setDetectResult(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Detection failed')
    }
    setDetecting(false)
  }

  const handleStart = async (): Promise<void> => {
    setActionLoading(true)
    setError(null)
    setStartLog([])
    try {
      for await (const event of startMcpStream(skill.id)) {
        if (event.type === 'log') {
          setStartLog(prev => [...prev, event.msg])
          setTimeout(() => { if (startLogRef.current) startLogRef.current.scrollTop = startLogRef.current.scrollHeight }, 10)
        } else if (event.type === 'done') {
          setMcpStatus(event.result)
        } else if (event.type === 'error') {
          setError(event.message)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Start failed')
    }
    setActionLoading(false)
  }

  const handleStop = async (): Promise<void> => {
    setActionLoading(true)
    setError(null)
    try {
      const s = await stopMcp(skill.id)
      setMcpStatus(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stop failed')
    }
    setActionLoading(false)
  }

  if (skill.is_mcp === false) return <></>

  if (!isMcp) {
    return (
      <div className="flex flex-col gap-2 pt-1 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-2xs text-text-muted uppercase tracking-wider">MCP Server</span>
          {detectResult !== null && !detectResult.is_mcp && (
            <span className="text-2xs text-text-muted">Not an MCP server</span>
          )}
        </div>
        {detectResult === null || !detectResult.is_mcp ? (
          <button
            onClick={handleDetect}
            disabled={detecting}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm border border-border hover:border-border-hover text-text-secondary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-40"
          >
            {detecting ? (
              <><div className="w-3 h-3 border border-text-muted/30 border-t-text-muted rounded-full animate-spin" />Detecting…</>
            ) : (
              <><PlugIcon />Detect MCP</>
            )}
          </button>
        ) : null}
        {error && <p className="text-xs text-red">{error}</p>}
      </div>
    )
  }

  const status = mcpStatus?.status ?? 'stopped'
  const transport = detectResult?.transport ?? null
  const startCommand = detectResult?.start_command ?? skill.mcp_start_command ?? null

  return (
    <div className="flex flex-col gap-2 pt-1 border-t border-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlugIcon />
          <span className="text-xs font-medium text-text-secondary">MCP Server</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleStart}
            disabled={actionLoading || status === 'running' || status === 'starting'}
            className="text-xs px-2.5 py-1 rounded-sm bg-accent hover:bg-accent-hover disabled:opacity-40 text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {actionLoading && status !== 'running' ? (
              <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
            ) : 'Start'}
          </button>
          <button
            onClick={handleStop}
            disabled={actionLoading || status === 'stopped'}
            className="text-xs px-2.5 py-1 rounded-sm border border-border hover:border-border-hover text-text-secondary hover:text-text-primary disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            Stop
          </button>
        </div>
      </div>

      <motion.div
        className="bg-base border border-border rounded-md px-3 py-2.5 flex flex-col gap-1.5"
        initial={false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
      >
        <div className="flex items-center gap-2">
          <McpStatusDot status={status} />
          <span className={`text-xs font-medium capitalize ${
            status === 'running' ? 'text-green' :
            status === 'starting' ? 'text-yellow' :
            status === 'error' ? 'text-red' : 'text-text-muted'
          }`}>{status}</span>
          {mcpStatus?.port !== null && mcpStatus?.port !== undefined && (
            <span className="text-xs text-text-muted font-mono">:{mcpStatus.port}</span>
          )}
          {mcpStatus?.pid !== null && mcpStatus?.pid !== undefined && (
            <span className="text-2xs text-text-muted">PID {mcpStatus.pid}</span>
          )}
        </div>
        {(startLog.length > 0 || actionLoading) && (
          <div ref={startLogRef} className="bg-elevated border border-border/50 rounded px-2.5 py-2 max-h-[100px] overflow-y-auto font-mono text-2xs text-text-muted space-y-0.5">
            {startLog.map((l, i) => <div key={i}>{l}</div>)}
            {actionLoading && <div className="animate-pulse">▌</div>}
          </div>
        )}
        {transport && (
          <div className="flex items-center gap-1.5">
            <span className="text-2xs text-text-muted">Transport:</span>
            <span className="text-2xs text-text-secondary font-mono">{transport}</span>
          </div>
        )}
        {startCommand && (
          <div className="flex items-center gap-1.5">
            <span className="text-2xs text-text-muted">Command:</span>
            <span className="text-2xs text-text-secondary font-mono truncate">{startCommand}</span>
          </div>
        )}
        {mcpStatus?.error && (
          <p className="text-xs text-red leading-relaxed">{mcpStatus.error}</p>
        )}
      </motion.div>

      {error && <p className="text-xs text-red">{error}</p>}
    </div>
  )
}
