import { useEffect, useState } from 'react'
import { getGpuStats } from '@/api/client'
import type { GpuStats } from '@/types'

export function GpuMonitor() {
  const [stats, setStats] = useState<GpuStats | null>(null)

  useEffect(() => {
    let mounted = true

    const poll = async () => {
      try {
        const s = await getGpuStats()
        if (mounted) setStats(s)
      } catch {
        // silently ignore
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  if (!stats) {
    return (
      <div className="p-3 rounded-lg bg-surface-2 border border-border">
        <p className="text-xs text-muted">Loading GPU info…</p>
      </div>
    )
  }

  const vramPct = stats.vram_total_mb > 0
    ? Math.round((stats.vram_used_mb / stats.vram_total_mb) * 100)
    : 0

  const vramColor =
    vramPct > 85 ? 'bg-red-500' : vramPct > 60 ? 'bg-yellow-500' : 'bg-accent'

  return (
    <div className="p-3 rounded-lg bg-surface-2 border border-border space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-white truncate max-w-[140px]" title={stats.name}>
          {stats.name}
        </span>
        {stats.temperature_c !== null && (
          <span className="text-xs text-muted">{stats.temperature_c}°C</span>
        )}
      </div>

      <div>
        <div className="flex justify-between text-xs text-muted mb-1">
          <span>VRAM</span>
          <span>
            {(stats.vram_used_mb / 1024).toFixed(1)} / {(stats.vram_total_mb / 1024).toFixed(1)} GB
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-4 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${vramColor}`}
            style={{ width: `${vramPct}%` }}
          />
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs text-muted mb-1">
          <span>GPU</span>
          <span>{stats.gpu_utilization_pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-4 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 bg-violet-500"
            style={{ width: `${stats.gpu_utilization_pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}
