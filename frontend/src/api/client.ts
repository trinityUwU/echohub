import { apiRequest, apiUrl } from './base'
import type {
  ChatMessage, ChatParams, ChatRequest, ConversationSummary,
  DownloadJob, DownloadRequest, GenerationStats, GpuStats,
  LoadRequest, MessageStats, ModelInfo, StoredMessage,
} from '@/types'

// ── Conversations ──────────────────────────────────────────────────────────

export const getConversations = (): Promise<ConversationSummary[]> =>
  apiRequest('/conversations')

export const createConversation = (id: string, title: string, modelId?: string): Promise<ConversationSummary> =>
  apiRequest('/conversations', { method: 'POST', body: JSON.stringify({ id, title, model_id: modelId }) })

export const updateConversation = (id: string, data: { title?: string; model_id?: string }): Promise<ConversationSummary> =>
  apiRequest(`/conversations/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const deleteConversation = (id: string): Promise<void> =>
  apiRequest(`/conversations/${id}`, { method: 'DELETE' })

export const getMessages = (convId: string): Promise<StoredMessage[]> =>
  apiRequest(`/conversations/${convId}/messages`)

export const addMessage = (convId: string, msg: {
  id: string; role: string; content: ChatMessage['content']; stats?: MessageStats | null
}): Promise<StoredMessage> =>
  apiRequest(`/conversations/${convId}/messages`, { method: 'POST', body: JSON.stringify(msg) })

export const clearMessages = (convId: string): Promise<void> =>
  apiRequest(`/conversations/${convId}/messages`, { method: 'DELETE' })

// ── Models ─────────────────────────────────────────────────────────────────

export const searchModels = (q: string, filters?: string, page = 0): Promise<ModelInfo[]> =>
  apiRequest(`/models/search?q=${encodeURIComponent(q)}${filters ? `&filters=${filters}` : ''}&page=${page}`)

export const listDownloaded = (): Promise<ModelInfo[]> =>
  apiRequest('/models/downloaded')

export const getModelInfo = (modelId: string): Promise<ModelInfo> =>
  apiRequest(`/models/info/${modelId}`)

export const startDownload = (req: DownloadRequest): Promise<{ status: string; model_id: string }> =>
  apiRequest('/models/download', { method: 'POST', body: JSON.stringify(req) })

export const cancelDownload = (modelId: string): Promise<{ status: string }> =>
  apiRequest(`/models/download/${encodeURIComponent(modelId)}`, { method: 'DELETE' })

export const deleteModel = (modelId: string): Promise<{ status: string }> =>
  apiRequest(`/models/downloaded/${encodeURIComponent(modelId)}`, { method: 'DELETE' })

export const listDownloads = (): Promise<DownloadJob[]> =>
  apiRequest('/models/downloads')

export function subscribeDownloads(onUpdate: (jobs: DownloadJob[]) => void): () => void {
  let es: EventSource | null = null
  let cancelled = false

  apiUrl('/models/downloads/stream').then(url => {
    if (cancelled) return
    es = new EventSource(url)
    es.onmessage = (e) => {
      try { onUpdate(JSON.parse(e.data)) } catch { /* ignore */ }
    }
  })

  return () => {
    cancelled = true
    es?.close()
  }
}

// ── Inference ──────────────────────────────────────────────────────────────

export const loadModel = (req: LoadRequest): Promise<{ status: string; model_id: string }> =>
  apiRequest('/inference/load', { method: 'POST', body: JSON.stringify(req) })

export const unloadModel = (): Promise<{ status: string }> =>
  apiRequest('/inference/unload', { method: 'POST' })

export const getLoadState = (): Promise<{ loading_model_id: string | null; loaded_model_id: string | null; error: string | null }> =>
  apiRequest('/inference/load-state')

export const summarizeMessages = (messages: ChatMessage[]): Promise<{ summary: string }> =>
  apiRequest('/inference/summarize', { method: 'POST', body: JSON.stringify({ messages, stream: false }) })

export async function getInferenceStatus(): Promise<ModelInfo | null> {
  try {
    const url = await apiUrl('/inference/status')
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) return null
    const text = await res.text()
    if (!text || text === 'null') return null
    return JSON.parse(text) as ModelInfo
  } catch {
    return null
  }
}

export async function chatStream(
  req: ChatRequest,
  params: ChatParams,
  onChunk: (text: string) => void,
  onDone: (stats: GenerationStats) => void,
  onError: (err: Error) => void,
  modelId?: string,
  signal?: AbortSignal,
): Promise<void> {
  const stopList = params.stop.trim()
    ? params.stop.split(',').map(s => s.trim()).filter(Boolean)
    : undefined

  const isQwen3 = modelId?.toLowerCase().includes('qwen3') || modelId?.toLowerCase().includes('qwq')
  let system_prompt: string | undefined
  if (isQwen3) {
    system_prompt = params.enableThinking
      ? (params.systemPrompt ? `/think\n${params.systemPrompt}` : '/think')
      : (params.systemPrompt ? `/no_think\n${params.systemPrompt}` : '/no_think')
  } else {
    system_prompt = params.systemPrompt || undefined
  }

  const body: ChatRequest = {
    ...req, stream: true, system_prompt,
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    top_p: params.topP,
    top_k: params.topK,
    repetition_penalty: params.repetitionPenalty,
    presence_penalty: params.presencePenalty,
    frequency_penalty: params.frequencyPenalty,
    stop: stopList,
  }

  try {
    const url = await apiUrl('/inference/chat')
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`Chat request failed: ${res.status}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = '', firstTokenTime: number | null = null
    const startTime = Date.now()
    let completionTokens = 0, promptTokens = 0

    const processBlocks = (blocks: string[]): void => {
      for (const block of blocks) {
        if (!block.startsWith('data: ')) continue
        const raw = block.slice(6).trim()
        if (raw === '[DONE]') continue
        try {
          const json = JSON.parse(raw)
          if (json?.usage) {
            completionTokens = json.usage.completion_tokens ?? completionTokens
            promptTokens = json.usage.prompt_tokens ?? promptTokens
          }
          const delta = json?.choices?.[0]?.delta?.content
          if (delta) {
            if (firstTokenTime === null) firstTokenTime = Date.now()
            onChunk(delta)
          }
        } catch { /* skip malformed */ }
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        // Flush remaining buffer — last chunks (usage, [DONE]) may still be in buf
        processBlocks(buf.split('\n\n'))
        break
      }
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n\n')
      buf = lines.pop() ?? ''
      processBlocks(lines)
    }

    const endTime = Date.now()
    const timeMs = endTime - startTime
    const generationMs = firstTokenTime !== null ? endTime - firstTokenTime : timeMs
    onDone({
      tokensGenerated: completionTokens,
      tokensPerSecond: completionTokens > 0 && generationMs > 0 ? (completionTokens / generationMs) * 1000 : 0,
      timeMs,
      promptTokens,
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      onDone({ tokensGenerated: 0, tokensPerSecond: 0, timeMs: 0, promptTokens: 0 })
      return
    }
    onError(e instanceof Error ? e : new Error(String(e)))
  }
}

// ── Settings / System ──────────────────────────────────────────────────────

export const getHfToken = (): Promise<{ token_set: boolean; token_preview: string }> =>
  apiRequest('/settings/hf-token')

export const setHfToken = (token: string): Promise<{ status: string; token_set: boolean }> =>
  apiRequest('/settings/hf-token', { method: 'POST', body: JSON.stringify({ token }) })

export const getGpuBackend = (): Promise<{
  backend: 'cuda' | 'rocm' | 'metal' | 'cpu'
  gpu_name: string | null
  cuda_available: boolean
  reason?: string
}> => apiRequest('/settings/gpu-backend')

export const checkModelAccess = (modelId: string): Promise<{
  accessible: boolean; gated: boolean; reason?: string; hf_url?: string
}> => apiRequest('/models/check-access', { method: 'POST', body: JSON.stringify({ model_id: modelId }) })

export const getGpuStats = (): Promise<GpuStats> =>
  apiRequest('/system/gpu')

export const downloadModel = startDownload

export const canLoadModel = (modelId: string, gpuUtil?: number, maxModelLen?: number): Promise<{
  engine: string
  format: string
  feasible: boolean
  reason: string | null
  vram_estimate_gb: number | null
  gpu_type: string
  vllm_available: boolean
}> => apiRequest('/inference/can-load', {
  method: 'POST',
  body: JSON.stringify({ model_id: modelId, gpu_memory_utilization: gpuUtil, max_model_len: maxModelLen }),
})

export const getModelReadme = (modelId: string): Promise<{ content: string | null; error?: string }> =>
  apiRequest(`/models/readme/${encodeURIComponent(modelId)}`)

export const checkModelCompatibility = (modelId: string): Promise<{
  compatible_vllm: boolean | null
  compatible_llama: boolean | null
  architecture: string
  quantization: string
  bits: number | null
  vllm_issues: string[]
  llama_issues: string[]
  recommendation: string
  vllm_version: string
  error?: string
}> => apiRequest(`/models/compatibility/${encodeURIComponent(modelId)}`)

// ── Engine management ──────────────────────────────────────────────────────

export const listEngines = (): Promise<{
  versions: Array<{
    version: string; path: string; installed: boolean; operational: boolean
    size_gb: number; arch_count: number; is_legacy: boolean
  }>
  coverage_warning: string | null
  total_versions: number
  operational_count: number
}> => apiRequest('/settings/engines')

export const deleteEngine = (version: string): Promise<{ status: string; version: string }> =>
  apiRequest(`/settings/engines/${encodeURIComponent(version)}`, { method: 'DELETE' })

export function installEngineStream(
  version: string,
  onLine: (data: { level: string; msg: string; ts: number }) => void,
  onDone: (result: { success: boolean; version?: string; size_gb?: number }) => void,
): () => void {
  let cancelled = false
  apiUrl(`/settings/engines/install/${encodeURIComponent(version)}`).then(url => {
    if (cancelled) return
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.done) { onDone(data); es.close() }
        else onLine(data)
      } catch { /* ignore */ }
    }
    es.onerror = () => { onDone({ success: false }); es.close() }
  })
  return () => { cancelled = true }
}

// ── Path configuration & migration ────────────────────────────────────────

export const getPaths = (): Promise<{
  models_dir: string; vllm_envs_dir: string; user_data_dir: string; db_path: string
  models_dir_is_default: boolean; vllm_envs_dir_is_default: boolean
}> => apiRequest('/settings/paths')

export const setModelsDir = (path: string): Promise<{
  status: string; source?: string; destination?: string; state?: object
}> => apiRequest('/settings/paths/models-dir', { method: 'POST', body: JSON.stringify({ path }) })

export const setVllmEnvsDir = (path: string): Promise<{
  status: string; source?: string; destination?: string; state?: object
}> => apiRequest('/settings/paths/vllm-envs-dir', { method: 'POST', body: JSON.stringify({ path }) })

export const getMigrationState = (): Promise<{
  status: string; migration_type?: string; source?: string; destination?: string
  files_total?: number; files_done?: number; bytes_total?: number; bytes_done?: number
  files_failed?: string[]
}> => apiRequest('/settings/paths/migration-state')

export const cancelMigration = (): Promise<{ status: string }> =>
  apiRequest('/settings/paths/migration-cancel', { method: 'POST' })

export const cleanupMigration = (): Promise<{ status: string }> =>
  apiRequest('/settings/paths/migration-cleanup', { method: 'POST' })

export function runMigrationStream(
  onLine: (data: { level: string; msg: string }) => void,
  onDone: (result: { success: boolean; reason: string }) => void,
): () => void {
  let cancelled = false
  apiUrl('/settings/paths/migrate').then(url => {
    if (cancelled) return
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.done) { onDone(data); es.close() }
        else onLine(data)
      } catch { /* ignore */ }
    }
    es.onerror = () => { onDone({ success: false, reason: 'connection_error' }); es.close() }
  })
  return () => { cancelled = true }
}

export const getInferenceSettings = (): Promise<{
  flash_attn: boolean; keep_model_in_memory: boolean
  gpu: { name: string; vram_gb: number; type: string }
}> => apiRequest('/settings/inference')

export const setInferenceSetting = (key: string, value: boolean | number | string): Promise<{ status: string }> =>
  apiRequest(`/settings/inference/${key}`, { method: 'POST', body: JSON.stringify({ value }) })

export const getOnboardingStatus = (): Promise<{ complete: boolean }> =>
  apiRequest('/settings/onboarding')

export const completeOnboarding = (): Promise<{ status: string }> =>
  apiRequest('/settings/onboarding/complete', { method: 'POST' })

export const runBenchmark = (): Promise<{
  model_id: string; model_name: string; engine: string | null
  tokens_generated: number; tok_per_sec: number; ttft_ms: number | null
  total_ms: number; gpu_name: string; vram_total_gb: number
  timestamp: number; share_text: string
}> => apiRequest('/inference/benchmark', { method: 'POST' })


/** Returns true if the model supports /think /no_think tokens (Qwen3, QwQ).
 *  Returns false if the model thinks natively and it cannot be disabled. */
export function isThinkingControllable(modelId: string | undefined): boolean {
  if (!modelId) return true
  const m = modelId.toLowerCase()
  return m.includes('qwen3') || m.includes('qwq')
}

export const getGpuLimits = (): Promise<{
  gpu_vram_limit_gb: number | null
  gpu_util_limit_pct: number | null
  cpu_threads: number | null
}> => apiRequest('/settings/inference')

export const setGpuLimit = (key: string, value: number | null): Promise<{ status: string }> =>
  apiRequest(`/settings/inference/${key}`, { method: 'POST', body: JSON.stringify({ value }) })
