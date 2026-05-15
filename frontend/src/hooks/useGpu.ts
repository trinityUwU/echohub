import { useEffect, useState } from 'react'
import { getGpuStats } from '@/api/client'
import type { GpuStats } from '@/types'

export function useGpu(intervalMs = 3000) {
  const [gpu, setGpu] = useState<GpuStats | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const stats = await getGpuStats()
        if (!cancelled) setGpu(stats)
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, intervalMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [intervalMs])

  return gpu
}
