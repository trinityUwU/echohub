import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '@/api/client'
import type { ModelInfo } from '@/types'

export function useModels() {
  const [downloaded, setDownloaded] = useState<ModelInfo[]>([])
  const [loadedModel, setLoadedModel] = useState<ModelInfo | null>(null)
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [unloading, setUnloading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [dl, status] = await Promise.all([
        api.listDownloaded(),
        api.getInferenceStatus(),
      ])
      setDownloaded(dl)
      setLoadedModel(status)
    } catch {
      // Backend temporarily unavailable — keep existing state, retry on next tick
    }
  }, [])

  // Heartbeat: resync every 5s regardless of other polling
  useEffect(() => {
    refresh()
    heartbeatRef.current = setInterval(refresh, 5000)
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [refresh])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const state = await api.getLoadState()
        if (state.error) {
          setLoadError(state.error)
          setLoadingModelId(null)
          stopPolling()
          await refresh()
          return
        }
        if (state.loading_model_id === null) {
          setLoadingModelId(null)
          stopPolling()
          await refresh()
        }
      } catch {
        // Backend restarting — keep polling, heartbeat will resync
      }
    }, 2000)
  }, [refresh, stopPolling])

  const loadModel = useCallback(async (
    modelId: string,
    config?: { maxModelLen?: number; gpuMemoryUtilization?: number; enforceEager?: boolean; maxCudagraphCaptureSize?: number | null; n_gpu_layers?: number | null; cpu_overflow?: boolean }
  ) => {
    setLoadError(null)

    // Auto-unload si un modèle est déjà chargé
    const currentStatus = await api.getInferenceStatus()
    if (currentStatus !== null) {
      setUnloading(true)
      stopPolling()
      setLoadingModelId(null)
      try {
        await api.unloadModel()
        await refresh()
      } catch {
        // continuer quand même
      } finally {
        setUnloading(false)
      }
    }

    setLoadingModelId(modelId)
    try {
      await api.loadModel({
        model_id: modelId,
        max_model_len: config?.maxModelLen ?? null,
        gpu_memory_utilization: config?.gpuMemoryUtilization ?? 0.75,
        enforce_eager: config?.enforceEager ?? false,
        max_cudagraph_capture_size: config?.maxCudagraphCaptureSize ?? null,
        n_gpu_layers: config?.n_gpu_layers ?? null,
        cpu_overflow: config?.cpu_overflow ?? false,
      })
      startPolling()
    } catch (e) {
      setLoadingModelId(null)
      setLoadError(String(e))
    }
  }, [startPolling, stopPolling, refresh])

  const unloadModel = useCallback(async () => {
    setUnloading(true)
    stopPolling()
    setLoadingModelId(null)
    setLoadError(null)
    try {
      await api.unloadModel()
      await refresh()
    } catch {
      await refresh()
    } finally {
      setUnloading(false)
    }
  }, [refresh, stopPolling])

  useEffect(() => () => {
    stopPolling()
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
  }, [stopPolling])

  return {
    downloaded,
    loadedModel,
    loadingModelId,
    loadError,
    unloading,
    refresh,
    loadModel,
    unloadModel,
  }
}
