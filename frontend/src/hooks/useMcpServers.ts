import { useCallback, useEffect, useRef, useState } from 'react'
import { listMcpServers, startMcp, stopMcp } from '@/api/client'
import type { McpStatus } from '@/api/client'

const POLL_INTERVAL_MS = 3000

export function useMcpServers(): {
  servers: McpStatus[]
  start: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  loading: boolean
} {
  const [servers, setServers] = useState<McpStatus[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async (): Promise<void> => {
    try {
      const data = await listMcpServers()
      setServers(data)
    } catch { /* silently ignore — backend may not have MCP routes yet */ }
  }, [])

  useEffect(() => {
    void poll()
    timerRef.current = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current)
    }
  }, [poll])

  const start = useCallback(async (id: string): Promise<void> => {
    setLoading(true)
    try {
      const status = await startMcp(id)
      setServers(prev => {
        const next = prev.filter(s => s.skill_id !== id)
        return [...next, status]
      })
    } catch { /* bubble handled by caller */ }
    setLoading(false)
  }, [])

  const stop = useCallback(async (id: string): Promise<void> => {
    setLoading(true)
    try {
      const status = await stopMcp(id)
      setServers(prev => {
        const next = prev.filter(s => s.skill_id !== id)
        return [...next, status]
      })
    } catch { /* bubble handled by caller */ }
    setLoading(false)
  }, [])

  return { servers, start, stop, loading }
}
