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
  is_moe?: boolean
  has_mtp?: boolean
  active_params_billion?: number | null
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
  n_gpu_layers?: number | null
  cpu_overflow?: boolean
  gguf_path?: string | null
  is_moe?: boolean
  kv_quant?: 'q8_0' | 'q4_0' | 'bf16'
}

export interface FinetunedModel {
  id: string
  name: string
  path: string
  size_gb: number
  job_id: string
  base_model_id: string
  quantization: string
  downloaded: boolean
  loaded: boolean
  source: 'finetuned'
  created_at: number
}

export interface LlamaCompatResult {
  compatible: boolean
  needs_upgrade?: boolean
  error?: string
  version?: string
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
  ttft_ms?: number | null
  engine?: string | null
  model_name?: string | null
  oom?: boolean | null
}

export interface ConversationSummary {
  id: string
  title: string
  model_id: string | null
  created_at: string
  updated_at: string
  message_count: number
}

export interface LoadConfig {
  model_id: string
  engine?: string
  n_ctx?: number | null
  n_gpu_layers?: number | null
  cpu_overflow?: boolean
  is_moe?: boolean
  gpu_memory_utilization?: number
  vllm_version?: string | null
  gguf_path?: string | null
}

export interface StoredMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string | ContentPart[]
  stats: MessageStats | null
  load_config: LoadConfig | null
  created_at: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentPart[]
  id?: string
  stats?: MessageStats | null
  loadConfig?: LoadConfig | null
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
  permanentRules: string
  temperature: number
  maxTokens: number
  topP: number
  topK: number
  repetitionPenalty: number
  presencePenalty: number
  frequencyPenalty: number
  stop: string
  enableThinking: boolean
  autoTitle: boolean
  contextCompaction: boolean
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
  ttftMs?: number | null
  engine?: string | null
  modelName?: string | null
  oom?: boolean
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

export interface CpuStats {
  name: string
  cores_physical: number
  cores_logical: number
  usage_pct: number
  ram_used_gb: number
  ram_total_gb: number
  temperature_c: number | null
}

export interface GpuStats {
  name: string
  vram_used_mb: number
  vram_total_mb: number
  vram_free_mb: number
  gpu_utilization_pct: number
  temperature_c: number | null
  cpu: CpuStats | null
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

// ── Finetune training pairs ──────────────────────────────────────────────────

export interface TrainingPair {
  id: string
  prompt: string
  chosen: string
  rejected: string
  source_conv_id: string | null
  source_msg_id: string | null
  model_id: string | null
  profile_id: string | null
  created_at: string
}

export interface FinetuneJob {
  id: string
  model_id: string
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number | null
  error: string | null
  created_at: string
  profile_id?: string | null
}

// ── Finetune profiles ────────────────────────────────────────────────────────

export interface FinetuneProfile {
  id: string
  name: string
  description: string
  domain: 'dev' | 'reasoning' | 'general' | 'analysis' | 'debug' | string
  target_pairs: number
  color: string
  created_at: string
  builtin: boolean
  pair_count?: number
}

export interface EvalPrompt {
  id: string
  prompt: string
}

export interface EvalResult {
  prompt_id: string
  prompt: string
  response: string
  score: number | null
}

export interface FinetuneEval {
  id: string
  job_id: string | null
  profile_id: string | null
  stage: 'before' | 'after'
  model_id: string
  model_path: string
  results: EvalResult[]
  score_avg: number | null
  created_at: string
}

export interface EvalReadyResponse {
  eval_id: string
  profile_id: string
  stage: string
  model_id: string
  prompt_count: number
  prompts: EvalPrompt[]
  status: string
}

export interface FtStatus {
  unsloth_available: boolean
  unsloth_venv: string
  pair_count: number
}

export interface FtTrainingConfig {
  max_seq_length: number
  per_device_train_batch_size: number
  gradient_accumulation_steps: number
  lora_rank: 8 | 16 | 32 | 64
  lora_alpha: number
  num_epochs: number
  learning_rate: number
  optim: string
  target_modules: string[]
  cpu_offload_gb: number
}

export interface FtRecommendedConfig {
  gpu_name: string
  vram_total_gb: number
  ram_total_gb: number
  ram_free_gb: number
  has_gpu: boolean
  qlora_vram_estimate_gb: number | null
  model_fits: boolean
  recommended: FtTrainingConfig
  rationale: string
}

export interface GgufFileCandidate {
  name: string
  size_gb: number
}

export interface GgufCandidate {
  id: string
  same_author: boolean
  downloads: number
  gguf_files?: GgufFileCandidate[]
  recommended_file?: string | null
}

export interface GgufSearchResult {
  candidates: GgufCandidate[]
  query_model: string
}

// ── Tool use / Dev mode ───────────────────────────────────────────────────────

export interface WorkspaceFile {
  path: string
  size: number
  modified: number
}

export interface ToolCall {
  id: string
  tool: string
  args: Record<string, unknown>
  result?: string
  status: 'pending' | 'running' | 'done' | 'error'
}

export interface ToolChatRequest {
  messages: Array<{ role: string; content: string }>
  project_id: string
  system_prompt?: string
  temperature?: number
  max_tokens?: number
  enabled_tools?: string[]
  awareness_block?: string
}

export interface SkillsConfig {
  enabledTools: string[]
  awarenessBlock: string
  hasToolSkills: boolean
}

export interface DownloadHistoryEntry {
  id: number
  model_id: string
  model_name: string | null
  state: DownloadState
  downloaded_gb: number
  total_gb: number | null
  error: string | null
  started_at: string
  completed_at: string | null
  params_billion: number | null
  quantization: string | null
  size_gb: number | null
  files_exist: boolean
}
