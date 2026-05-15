import type {
  ChatMessage,
  ChatParams,
  ChatRequest,
  ConversationSummary,
  DownloadJob,
  DownloadRequest,
  GenerationStats,
  GpuStats,
  LoadRequest,
  MessageStats,
  ModelInfo,
  StoredMessage,
} from '@/types'

const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// Conversations
export const getConversations = (): Promise<ConversationSummary[]> =>
  request('/conversations')

export const createConversation = (id: string, title: string, modelId?: string): Promise<ConversationSummary> =>
  request('/conversations', { method: 'POST', body: JSON.stringify({ id, title, model_id: modelId }) })

export const updateConversation = (id: string, data: { title?: string; model_id?: string }): Promise<ConversationSummary> =>
  request(`/conversations/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const deleteConversation = (id: string): Promise<void> =>
  request(`/conversations/${id}`, { method: 'DELETE' })

export const getMessages = (convId: string): Promise<StoredMessage[]> =>
  request(`/conversations/${convId}/messages`)

export const addMessage = (convId: string, msg: {
  id: string; role: string; content: ChatMessage['content']; stats?: MessageStats | null
}): Promise<StoredMessage> =>
  request(`/conversations/${convId}/messages`, { method: 'POST', body: JSON.stringify(msg) })

export const clearMessages = (convId: string): Promise<void> =>
  request(`/conversations/${convId}/messages`, { method: 'DELETE' })

// Models
export const searchModels = (q: string, filters?: string, page = 0): Promise<ModelInfo[]> =>
  request<ModelInfo[]>(`/models/search?q=${encodeURIComponent(q)}${filters ? `&filters=${filters}` : ''}&page=${page}`)

export const listDownloaded = (): Promise<ModelInfo[]> =>
  request<ModelInfo[]>('/models/downloaded')

export const getModelInfo = (modelId: string): Promise<ModelInfo> =>
  request<ModelInfo>(`/models/info/${modelId}`)

export const downloadModel = (req: DownloadRequest): EventSource => {
  // POST-style SSE: use fetch with ReadableStream
  return new EventSource(`${BASE}/models/download?model_id=${encodeURIComponent(req.model_id)}`)
}

export async function downloadModelStream(
  req: DownloadRequest,
  onProgress: (data: { status: string; model_id?: string; error?: string }) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/models/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok || !res.body) throw new Error(`Download request failed: ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6))
          onProgress(data)
        } catch {
          // ignore parse errors
        }
      }
    }
  }
}

// Inference
export const loadModel = (req: LoadRequest): Promise<{ status: string; model_id: string }> =>
  request('/inference/load', { method: 'POST', body: JSON.stringify(req) })

export const unloadModel = (): Promise<{ status: string }> =>
  request('/inference/unload', { method: 'POST' })

export const getLoadState = (): Promise<{ loading_model_id: string | null; loaded_model_id: string | null; error: string | null }> =>
  request('/inference/load-state')

export const summarizeMessages = (messages: import('@/types').ChatMessage[]): Promise<{ summary: string }> =>
  request('/inference/summarize', {
    method: 'POST',
    body: JSON.stringify({ messages, stream: false }),
  })

export const getInferenceStatus = async (): Promise<ModelInfo | null> => {
  const res = await fetch(`${BASE}/inference/status`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) return null
  const text = await res.text()
  if (!text || text === 'null') return null
  try {
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
    ? params.stop.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined

  // /think prefix uniquement pour Qwen3 — les autres modèles pensent nativement
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
    ...req,
    stream: true,
    system_prompt,
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
    const res = await fetch(`${BASE}/inference/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`Chat request failed: ${res.status}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let firstTokenTime: number | null = null
    const startTime = Date.now()
    let completionTokens = 0
    let promptTokens = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n\n')
      buf = lines.pop() ?? ''
      for (const block of lines) {
        if (block.startsWith('data: ')) {
          const raw = block.slice(6).trim()
          if (raw === '[DONE]') continue
          try {
            const json = JSON.parse(raw)
            // Usage chunk from stream_options
            if (json?.usage) {
              completionTokens = json.usage.completion_tokens ?? completionTokens
              promptTokens = json.usage.prompt_tokens ?? promptTokens
            }
            const delta = json?.choices?.[0]?.delta?.content
            if (delta) {
              if (firstTokenTime === null) firstTokenTime = Date.now()
              onChunk(delta)
            }
          } catch {
            // skip malformed
          }
        }
      }
    }

    const endTime = Date.now()
    const timeMs = endTime - startTime
    const generationMs = firstTokenTime !== null ? endTime - firstTokenTime : timeMs
    const tokensPerSecond = completionTokens > 0 && generationMs > 0
      ? (completionTokens / generationMs) * 1000
      : 0

    onDone({
      tokensGenerated: completionTokens,
      tokensPerSecond,
      timeMs,
      promptTokens,
    })
  } catch (e) {
    // AbortError = stop volontaire, pas une vraie erreur
    if (e instanceof Error && e.name === 'AbortError') {
      onDone({ tokensGenerated: 0, tokensPerSecond: 0, timeMs: 0, promptTokens: 0 })
      return
    }
    onError(e instanceof Error ? e : new Error(String(e)))
  }
}

// Downloads
export const startDownload = (req: DownloadRequest): Promise<{ status: string; model_id: string }> =>
  request('/models/download', { method: 'POST', body: JSON.stringify(req) })

export const cancelDownload = (modelId: string): Promise<{ status: string }> =>
  request(`/models/download/${encodeURIComponent(modelId)}`, { method: 'DELETE' })

export const deleteModel = (modelId: string): Promise<{ status: string }> =>
  request(`/models/downloaded/${encodeURIComponent(modelId)}`, { method: 'DELETE' })

export const listDownloads = (): Promise<DownloadJob[]> =>
  request<DownloadJob[]>('/models/downloads')

export function subscribeDownloads(onUpdate: (jobs: DownloadJob[]) => void): () => void {
  const es = new EventSource('/api/models/downloads/stream')
  es.onmessage = (e) => {
    try {
      onUpdate(JSON.parse(e.data))
    } catch {
      // ignore
    }
  }
  return () => es.close()
}

// Settings
export const getHfToken = (): Promise<{ token_set: boolean; token_preview: string }> =>
  request('/settings/hf-token')

export const getGpuBackend = (): Promise<{
  backend: 'cuda' | 'rocm' | 'metal' | 'cpu'
  gpu_name: string | null
  cuda_available: boolean
  reason?: string
}> => request('/settings/gpu-backend')

export const setHfToken = (token: string): Promise<{ status: string; token_set: boolean }> =>
  request('/settings/hf-token', { method: 'POST', body: JSON.stringify({ token }) })

export const checkModelAccess = (modelId: string): Promise<{
  accessible: boolean
  gated: boolean
  reason?: string
  hf_url?: string
}> => request('/models/check-access', { method: 'POST', body: JSON.stringify({ model_id: modelId }) })

// System
export const getGpuStats = (): Promise<GpuStats> =>
  request<GpuStats>('/system/gpu')
