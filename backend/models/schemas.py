from __future__ import annotations

from typing import Any, Optional, Union
from pydantic import BaseModel


class ModelCapabilities(BaseModel):
    thinking: bool = False
    vision: bool = False
    code: bool = False
    multilingual: bool = False
    tools: bool = False


class ModelInfo(BaseModel):
    id: str
    name: str
    size_gb: Optional[float] = None
    capabilities: ModelCapabilities = ModelCapabilities()
    downloaded: bool = False
    loaded: bool = False
    quantization: Optional[str] = None
    author: Optional[str] = None
    downloads: Optional[int] = None
    likes: Optional[int] = None
    params_billion: Optional[float] = None    # e.g. 7.0, 14.0, 30.0
    vram_estimate_gb: Optional[float] = None  # estimated VRAM needed to load
    max_context_window: Optional[int] = None  # max context from model card (tokens)
    description: Optional[str] = None           # extrait du README ou cardData
    last_modified: Optional[str] = None         # ISO string "YYYY-MM-DD"
    pipeline_tag: Optional[str] = None          # "text-generation", "image-text-to-text"
    arch_tag: Optional[str] = None              # ex: "qwen3", "llama", "mistral"
    gguf_files: Optional[list[dict]] = None     # [{"name": "...", "size_gb": 4.2, "variant": "Q4_K_M"}]
    more_from_author: Optional[list[dict]] = None  # [{"id": "...", "downloads": 123, "likes": 5}]
    gated: bool = False  # modèle nécessitant acceptation de licence sur HF
    engine: Optional[str] = None  # "llama" | "vllm" | None
    is_moe: bool = False
    has_mtp: bool = False
    active_params_billion: Optional[float] = None  # MoE only: active params per token


class DownloadRequest(BaseModel):
    model_id: str
    revision: str = "main"
    gguf_file: Optional[str] = None  # specific GGUF file to download


class LoadRequest(BaseModel):
    model_id: str
    gpu_memory_utilization: float = 0.75
    max_model_len: Optional[int] = None
    enforce_eager: bool = False
    max_cudagraph_capture_size: Optional[int] = None
    vllm_version: Optional[str] = None
    n_gpu_layers: Optional[int] = None  # llama.cpp only: -1=full GPU, 0=CPU, N=N layers on GPU
    cpu_overflow: bool = False          # llama.cpp only: allow overflow to CPU RAM if VRAM exceeded
    gguf_path: Optional[str] = None    # absolute path for finetuned GGUFs — bypasses HF resolution
    is_moe: bool = False               # llama.cpp only: MoE model — reduces n_batch + disables CUDA graph profiling


class ChatMessage(BaseModel):
    role: str
    # str for text-only, list for multimodal (OpenAI content array format)
    content: Union[str, list[dict[str, Any]]]


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    stream: bool = True
    temperature: float = 0.7
    max_tokens: int = 2048
    system_prompt: Optional[str] = None
    top_p: float = 0.95
    top_k: int = -1
    repetition_penalty: float = 1.1
    presence_penalty: float = 0.0
    frequency_penalty: float = 0.0
    stop: Optional[list[str]] = None


class MessageStats(BaseModel):
    tokens: int = 0
    tok_per_sec: float = 0.0
    time_ms: int = 0
    prompt_tokens: int = 0
    ttft_ms: Optional[int] = None
    engine: Optional[str] = None
    model_name: Optional[str] = None
    oom: Optional[bool] = None


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: Any  # str ou list
    stats: Optional[MessageStats] = None
    created_at: str


class ConversationOut(BaseModel):
    id: str
    title: str
    model_id: Optional[str] = None
    created_at: str
    updated_at: str
    message_count: int = 0


class CpuStats(BaseModel):
    name: str
    cores_physical: int
    cores_logical: int
    usage_pct: float
    ram_used_gb: float
    ram_total_gb: float
    temperature_c: Optional[float] = None


class GpuStats(BaseModel):
    name: str
    vram_used_mb: int
    vram_total_mb: int
    vram_free_mb: int
    gpu_utilization_pct: int
    temperature_c: Optional[int] = None
    cpu: Optional[CpuStats] = None
