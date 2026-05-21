import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '@/api/client'
import type { ModelInfo } from '@/types'

export function useModels() {
  const [downloaded, setDownloaded] = useState<ModelInfo[]>([])
  const [loadedModel, setLoadedModel] = useState<ModelInfo | null>(null)
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [unloading, setUnloading] = useState(false)
  const [activeLoadConfig, setActiveLoadConfig] = useState<import('@/types').LoadConfig | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [dl, status] = await Promise.all([
        api.listDownloaded(),
        api.getInferenceStatus(),
      ])
      setDownloaded(dl)
      // status=null means backend responded but no model is loaded — trust it
      setLoadedModel(status)
    } catch {
      // Network error — backend unreachable, keep existing state until it comes back
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

  type LoadConfig = {
    maxModelLen?: number; gpuMemoryUtilization?: number; enforceEager?: boolean
    maxCudagraphCaptureSize?: number | null; n_gpu_layers?: number | null; cpu_overflow?: boolean
    gguf_path?: string | null; is_moe?: boolean; kv_quant?: 'q8_0' | 'q4_0' | 'bf16'
    offload_kqv?: boolean; n_batch?: number | null; ctxMode?: 'adaptive' | 'fixed'
    tensorParallelSize?: number | null; pipelineParallelSize?: number | null
    tensor_split?: number[] | null; main_gpu?: number | null
    speculative_mode?: 'off' | 'ngram' | 'mtp' | 'draft_model'
    draft_model_path?: string | null; n_pred_tokens?: number
  }

  const _doLoad = useCallback(async (modelId: string, req: import('@/types').LoadRequest) => {
    setLoadError(null)
    const currentStatus = await api.getInferenceStatus()
    if (currentStatus !== null) {
      setUnloading(true)
      stopPolling()
      setLoadingModelId(null)
      try { await api.unloadModel(); await refresh() } catch { /* continue */ } finally { setUnloading(false) }
    }
    setLoadingModelId(modelId)
    try {
      await api.loadModel(req)
      startPolling()
    } catch (e) {
      setLoadingModelId(null)
      setLoadError(String(e))
    }
  }, [startPolling, stopPolling, refresh])

  const loadModel = useCallback(async (modelId: string, config?: LoadConfig) => {
    setActiveLoadConfig(config ? { model_id: modelId, engine: undefined, ctx_mode: config.ctxMode, n_ctx: config.maxModelLen } : null)
    await _doLoad(modelId, {
      model_id: modelId,
      max_model_len: config?.maxModelLen ?? null,
      gpu_memory_utilization: config?.gpuMemoryUtilization ?? 0.75,
      enforce_eager: config?.enforceEager ?? false,
      max_cudagraph_capture_size: config?.maxCudagraphCaptureSize ?? null,
      n_gpu_layers: config?.n_gpu_layers ?? null,
      cpu_overflow: config?.cpu_overflow ?? false,
      is_moe: config?.is_moe ?? false,
      kv_quant: config?.kv_quant,
      offload_kqv: config?.offload_kqv ?? false,
      n_batch: config?.n_batch ?? null,
      tensor_parallel_size: config?.tensorParallelSize ?? null,
      pipeline_parallel_size: config?.pipelineParallelSize ?? null,
      tensor_split: config?.tensor_split ?? null,
      main_gpu: config?.main_gpu ?? null,
      speculative_mode: config?.speculative_mode ?? 'off',
      draft_model_path: config?.draft_model_path ?? null,
      n_pred_tokens: config?.n_pred_tokens ?? 10,
    })
  }, [_doLoad])

  const loadModelFromPath = useCallback(async (modelId: string, ggufPath: string) => {
    await _doLoad(modelId, {
      model_id: modelId,
      gguf_path: ggufPath,
      gpu_memory_utilization: 0.75,
      enforce_eager: false,
    })
  }, [_doLoad])

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
    activeLoadConfig,
    refresh,
    loadModel,
    loadModelFromPath,
    unloadModel,
  }
}
