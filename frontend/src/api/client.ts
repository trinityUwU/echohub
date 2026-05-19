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

export const deleteMessage = (convId: string, messageId: string): Promise<void> =>
  apiRequest(`/conversations/${convId}/messages/${messageId}`, { method: 'DELETE' })

// ── Models ─────────────────────────────────────────────────────────────────

export const searchModels = (
  q: string,
  filters?: string[],
  page = 0,
  sort = 'downloads',
  sortDir = 'desc',
): Promise<ModelInfo[]> => {
  const params = new URLSearchParams({ q, page: String(page), sort, sort_dir: sortDir })
  if (filters?.length) params.set('filters', filters.join(','))
  return apiRequest(`/models/search?${params}`)
}

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

export interface MoeLoadConfig {
  is_moe: boolean
  total_params_b?: number
  active_params_b?: number | null
  total_vram_needed_gb?: number
  recommended_n_gpu_layers?: number
  estimated_gpu_vram_gb?: number
  estimated_ram_gb?: number
  recommended_cpu_overflow?: boolean
  recommended_ctx?: number
  note?: string
}

export const getMoeLoadConfig = (modelId: string, vramGb: number): Promise<MoeLoadConfig> =>
  apiRequest(`/models/moe-load-config?model_id=${encodeURIComponent(modelId)}&vram_gb=${vramGb}`)

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
  onTokensUpdate?: (prompt: number, completion: number) => void,
  onOom?: () => void,
): Promise<void> {
  const stopList = params.stop.trim()
    ? params.stop.split(',').map(s => s.trim()).filter(Boolean)
    : undefined

  const isQwen3 = modelId?.toLowerCase().includes('qwen3') || modelId?.toLowerCase().includes('qwq')

  // Merge system prompt + permanent rules (rules always appended last, highest priority)
  const basePrompt = [
    params.systemPrompt,
    params.permanentRules ? `\n\n---\nPERMANENT RULES (always apply, never ignore):\n${params.permanentRules}` : '',
  ].join('').trim()

  let system_prompt: string | undefined
  if (isQwen3) {
    system_prompt = params.enableThinking
      ? (basePrompt ? `/think\n${basePrompt}` : '/think')
      : (basePrompt ? `/no_think\n${basePrompt}` : '/no_think')
  } else {
    system_prompt = basePrompt || undefined
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
    let backendTtftMs: number | null = null
    let backendEngine: string | null = null
    let backendModelName: string | null = null

    const processBlocks = (blocks: string[]): void => {
      for (const block of blocks) {
        if (!block.startsWith('data: ')) continue
        const raw = block.slice(6).trim()
        if (raw === '[DONE]') continue
        try {
          const json = JSON.parse(raw)
          // Backend stats event
          if (json?.type === 'echohub_stats') {
            backendTtftMs = json.ttft_ms ?? null
            backendEngine = json.engine ?? null
            backendModelName = json.model_name ?? null
            continue
          }
          if (json?.error) {
            if (json.error_type === 'oom') {
              onOom?.()
              // Flush any remaining chunks then call onDone with oom flag
              onDone({
                tokensGenerated: completionTokens,
                tokensPerSecond: 0,
                timeMs: Date.now() - startTime,
                promptTokens,
                ttftMs: backendTtftMs,
                engine: backendEngine,
                modelName: backendModelName,
                oom: true,
              })
            } else {
              onError(new Error(json.error))
            }
            return
          }
          if (json?.usage) {
            completionTokens = json.usage.completion_tokens ?? completionTokens
            if (json.usage.prompt_tokens) promptTokens = json.usage.prompt_tokens
            onTokensUpdate?.(promptTokens, completionTokens)
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
    const ttftMs = backendTtftMs ?? (firstTokenTime !== null ? firstTokenTime - startTime : null)
    onDone({
      tokensGenerated: completionTokens,
      tokensPerSecond: completionTokens > 0 && generationMs > 0 ? (completionTokens / generationMs) * 1000 : 0,
      timeMs,
      promptTokens,
      ttftMs,
      engine: backendEngine,
      modelName: backendModelName,
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
    size_gb: number; arch_count: number; is_legacy: boolean; is_builtin: boolean
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

export const runBenchmark = (): Promise<Record<string, unknown>> =>
  apiRequest('/inference/benchmark', { method: 'POST' })


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

export const archiveConversation = (id: string): Promise<{ status: string }> =>
  apiRequest(`/conversations/${id}/archive`, { method: 'PATCH' })

export const unarchiveConversation = (id: string): Promise<{ status: string }> =>
  apiRequest(`/conversations/${id}/unarchive`, { method: 'PATCH' })

export const getArchivedConversations = (): Promise<ConversationSummary[]> =>
  apiRequest('/conversations?archived=1')

// ── Update system ──────────────────────────────────────────────────────────

export const checkForUpdates = (): Promise<{
  up_to_date: boolean; commits_behind: number
  local_sha: string; remote_sha: string; changelog: string[]; error?: string
}> => apiRequest('/settings/update/check', { signal: AbortSignal.timeout(15_000) })

export function runUpdate(
  onLine: (data: { level: string; msg: string }) => void,
  onDone: (result: { success: boolean }) => void,
): () => void {
  let cancelled = false
  apiUrl('/settings/update/run').then(url => {
    if (cancelled) return
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.done) { onDone(data); es.close() }
        else onLine(data)
      } catch {}
    }
    es.onerror = () => { onDone({ success: false }); es.close() }
  })
  return () => { cancelled = true }
}

export const saveChangelog = (changelog: string[]): Promise<{ status: string }> =>
  apiRequest('/settings/update/save-changelog', { method: 'POST', body: JSON.stringify({ changelog }) })

export const getPendingChangelog = (): Promise<{ changelog: string[] }> =>
  apiRequest('/settings/update/pending-changelog')

export const clearChangelog = (): Promise<{ status: string }> =>
  apiRequest('/settings/update/clear-changelog', { method: 'POST' })

// ── Fine-tuning ─────────────────────────────────────────────────────────────

export const getDownloadHistory = (): Promise<import('@/types').DownloadHistoryEntry[]> =>
  apiRequest('/models/history')

export const deleteDownloadHistoryEntry = (modelId: string): Promise<void> =>
  apiRequest(`/models/history/${encodeURIComponent(modelId)}`, { method: 'DELETE' })

export const getFtStatus = (): Promise<import('@/types').FtStatus> =>
  apiRequest('/finetune/status')

export const listTrainingPairs = (): Promise<import('@/types').TrainingPair[]> =>
  apiRequest('/finetune/pairs')

export const createTrainingPair = (data: {
  prompt: string; chosen: string; rejected: string
  source_conv_id?: string | null; source_msg_id?: string | null
  model_id?: string | null; profile_id?: string | null
}): Promise<import('@/types').TrainingPair> =>
  apiRequest('/finetune/pairs', { method: 'POST', body: JSON.stringify(data) })

export const deleteTrainingPair = (id: string): Promise<void> =>
  apiRequest(`/finetune/pairs/${id}`, { method: 'DELETE' })

export const listFinetuneJobs = (): Promise<import('@/types').FinetuneJob[]> =>
  apiRequest('/finetune/jobs')

export const createFinetuneJob = (data: {
  model_id: string; profile_id?: string | null
  max_seq_length?: number; per_device_train_batch_size?: number
  gradient_accumulation_steps?: number; lora_rank?: number; lora_alpha?: number
  num_epochs?: number; learning_rate?: number; optim?: string
  target_modules?: string[]; cpu_offload_gb?: number
  eval_before?: boolean; eval_after?: boolean
  eval_gguf_model_id?: string; eval_gguf_file?: string
}): Promise<import('@/types').FinetuneJob> =>
  apiRequest('/finetune/jobs', { method: 'POST', body: JSON.stringify(data) })

export const getRecommendedConfig = (paramsBillion?: number): Promise<import('@/types').FtRecommendedConfig> =>
  apiRequest(`/finetune/recommended-config${paramsBillion ? `?params_billion=${paramsBillion}` : ''}`)

export const cancelFinetuneJob = (id: string): Promise<{ cancelled: boolean }> =>
  apiRequest(`/finetune/jobs/${id}/cancel`, { method: 'DELETE' })

export const getVramEstimate = (paramsBillion: number): Promise<{ vram_gb: number }> =>
  apiRequest(`/finetune/vram-estimate?params_billion=${paramsBillion}`)

export async function ftJobStreamUrl(jobId: string): Promise<string> {
  return apiUrl(`/finetune/jobs/${jobId}/stream`)
}
export async function ftExportStreamUrl(jobId: string): Promise<string> {
  return apiUrl(`/finetune/jobs/${jobId}/export/stream`)
}
export async function ftInstallStreamUrl(): Promise<string> {
  return apiUrl('/finetune/install/stream')
}

// ── Finetune profiles ────────────────────────────────────────────────────────

export const listFinetuneProfiles = (): Promise<import('@/types').FinetuneProfile[]> =>
  apiRequest('/finetune/profiles')

export const createFinetuneProfile = (data: {
  name: string; description: string; domain: string; target_pairs: number; color: string
}): Promise<import('@/types').FinetuneProfile> =>
  apiRequest('/finetune/profiles', { method: 'POST', body: JSON.stringify(data) })

export const deleteFinetuneProfile = (id: string): Promise<void> =>
  apiRequest(`/finetune/profiles/${id}`, { method: 'DELETE' })

export const listProfilePairs = (profileId: string): Promise<import('@/types').TrainingPair[]> =>
  apiRequest(`/finetune/profiles/${profileId}/pairs`)

export const initEval = (data: {
  profile_id: string; stage: string; model_id: string; model_path: string; job_id?: string
}): Promise<import('@/types').EvalReadyResponse> =>
  apiRequest('/finetune/evals', { method: 'POST', body: JSON.stringify(data) })

export const submitEval = (data: {
  profile_id: string; stage: string; model_id: string; model_path: string
  job_id?: string; results: import('@/types').EvalResult[]
}): Promise<import('@/types').FinetuneEval> =>
  apiRequest('/finetune/evals/submit', { method: 'POST', body: JSON.stringify(data) })

export const listEvals = (params?: { job_id?: string; profile_id?: string }): Promise<import('@/types').FinetuneEval[]> => {
  const q = new URLSearchParams()
  if (params?.job_id) q.set('job_id', params.job_id)
  if (params?.profile_id) q.set('profile_id', params.profile_id)
  return apiRequest(`/finetune/evals${q.toString() ? '?' + q : ''}`)
}

export const recoverFinetuneJob = (id: string): Promise<{ status: string; output_dir: string }> =>
  apiRequest(`/finetune/jobs/${id}/recover`, { method: 'POST' })

export const getFinetuneJobLogs = (id: string): Promise<{ lines: string[]; exists: boolean }> =>
  apiRequest(`/finetune/jobs/${id}/logs`)

export const findGguf = (modelId: string): Promise<import('@/types').GgufSearchResult> =>
  apiRequest(`/finetune/find-gguf?model_id=${encodeURIComponent(modelId)}`)

export const listFinetunedModels = (): Promise<import('@/types').FinetunedModel[]> =>
  apiRequest('/models/finetuned')

export const checkLlamaCompat = (ggufPath: string): Promise<import('@/types').LlamaCompatResult> =>
  apiRequest(`/models/llama-compat-check?gguf_path=${encodeURIComponent(ggufPath)}`)

export async function llamaUpgradeStreamUrl(): Promise<string> {
  return apiUrl('/models/llama-upgrade/stream')
}

export const getLlamaCppStatus = (): Promise<{
  installed: boolean; version: string | null; cuda_enabled: boolean; size_gb: number; path: string
}> => apiRequest('/models/llama-cpp/status')

export async function evalRunStreamUrl(): Promise<string> {
  return apiUrl('/finetune/eval-run/stream')
}

export const deleteFinetunedModel = (jobId: string): Promise<{ status: string }> =>
  apiRequest(`/models/finetuned/${jobId}`, { method: 'DELETE' })
