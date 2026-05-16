import type { GpuStats } from '@/types'

interface Props { gpu: GpuStats | null }

function Metric({ label, value, pct }: { label: string; value: string; pct: number }) {
  const color = pct > 0.90 ? '#ef4444' : pct > 0.75 ? '#f59e0b' : 'rgba(74,158,191,0.70)'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-white/25">{label}</span>
        <span className="text-[10px] font-mono text-white/30">{value}</span>
      </div>
      <div className="h-px rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(pct * 100, 100)}%`, background: color }} />
      </div>
    </div>
  )
}

export function GpuMonitor({ gpu }: Props) {
  if (!gpu) return <p className="text-[10px] text-white/18">No GPU</p>

  return (
    <div className="space-y-2">
      <Metric
        label="VRAM"
        value={`${(gpu.vram_used_mb / 1024).toFixed(1)} / ${(gpu.vram_total_mb / 1024).toFixed(1)} GB`}
        pct={gpu.vram_used_mb / gpu.vram_total_mb}
      />
      <Metric
        label="GPU"
        value={`${gpu.gpu_utilization_pct}%`}
        pct={gpu.gpu_utilization_pct / 100}
      />
      {gpu.temperature_c != null && (
        <p className="text-[10px] font-mono text-white/18 text-right">{gpu.temperature_c}°C</p>
      )}
    </div>
  )
}
