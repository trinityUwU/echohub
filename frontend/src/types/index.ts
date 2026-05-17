export interface ModelCapabilities {
  thinking: boolean
  vision: boolean
  code: boolean
  multilingual: boolean
  tools: boolean
}

export interface GgufFile {
  name: string
  size_gb: number
  variant: string
}

export interface ModelStub {
  id: string
  downloads: number | null
  likes: number | null
}

export interface ModelInfo {
  id: string
  name: string
  size_gb: number | null
  capabilities: ModelCapabilities
  downloaded: boolean
  loaded: boolean
  quantization: string | null
  author: string | null
  downloads: number | null
  likes: number | null
  params_billion: number | null
  vram_estimate_gb: number | null
  max_context_window: number | null
  description: string | null
  last_modified: string | null
  pipeline_tag: string | null
  arch_tag: string | null
  gguf_files: GgufFile[] | null
  more_from_author: ModelStub[] | null
  gated: boolean
  engine?: string | null
}

export interface DownloadRequest {
  model_id: string
  revision?: string
  gguf_file?: string
}

export interface LoadRequest {
  model_id: string
  gpu_memory_utilization?: number
  max_model_len?: number | null
  enforce_eager?: boolean
  max_cudagraph_capture_size?: number | null
}

// OpenAI multimodal content part
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }  // url = data:image/...;base64,...

export interface MessageStats {
  tokens: number
  tok_per_sec: number
  time_ms: number
  prompt_tokens: number
  model_name?: string
}

export interface ConversationSummary {
  id: string
  title: string
  model_id: string | null
  created_at: string
  updated_at: string
  message_count: number
}

export interface StoredMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string | ContentPart[]
  stats: MessageStats | null
  created_at: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentPart[]
  id?: string
  stats?: MessageStats | null
}

// Attachment held in UI state before being serialized into a ChatMessage
export type AttachmentType = 'image' | 'text'

export interface Attachment {
  id: string
  name: string
  type: AttachmentType
  mimeType: string
  // images: base64 data URL (data:image/png;base64,...)
  // text files: raw file content
  data: string
  sizeBytes: number
}

export interface ChatParams {
  systemPrompt: string
  temperature: number
  maxTokens: number
  topP: number
  topK: number
  repetitionPenalty: number
  presencePenalty: number
  frequencyPenalty: number
  stop: string
  enableThinking: boolean
}

export interface ChatProfile {
  id: string
  name: string
  params: ChatParams
}

export interface GenerationStats {
  tokensGenerated: number
  tokensPerSecond: number
  timeMs: number
  promptTokens: number
}

export interface ChatRequest {
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  system_prompt?: string
  top_p?: number
  top_k?: number
  repetition_penalty?: number
  presence_penalty?: number
  frequency_penalty?: number
  stop?: string[]
}

export interface GpuStats {
  name: string
  vram_used_mb: number
  vram_total_mb: number
  vram_free_mb: number
  gpu_utilization_pct: number
  temperature_c: number | null
}

export type DownloadState = 'pending' | 'running' | 'paused' | 'complete' | 'cancelled' | 'error'

export interface DownloadJob {
  model_id: string
  state: DownloadState
  downloaded_gb: number
  total_gb: number | null
  progress: number | null  // 0.0–1.0
  error: string | null
}
