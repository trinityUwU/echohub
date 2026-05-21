"""
vLLM command build + load failure helpers.
Extracted from vllm_service.py to keep it under 500 lines.
"""
from __future__ import annotations

import json as _json
from pathlib import Path
from typing import TYPE_CHECKING, Optional

from loguru import logger

if TYPE_CHECKING:
    pass

VLLM_PORT = 37823

_FALLBACK_CHAT_TEMPLATE = (
    "{% for message in messages %}"
    "{% if message['role'] == 'system' %}<|im_start|>system\n{{ message['content'] }}<|im_end|>\n{% endif %}"
    "{% if message['role'] == 'user' %}<|im_start|>user\n{{ message['content'] }}<|im_end|>\n<|im_start|>assistant\n{% endif %}"
    "{% if message['role'] == 'assistant' %}{{ message['content'] }}<|im_end|>\n{% endif %}"
    "{% endfor %}"
)


def resolve_max_model_len(model_path: str, max_model_len: Optional[int], is_vision: bool) -> int:
    if is_vision:
        if max_model_len is None:
            logger.info("Vision model — defaulting max_model_len to 4096")
            return 4096
        if max_model_len > 4096:
            logger.warning(f"Vision model with max_model_len={max_model_len} — may OOM on 12GB VRAM")
        return max_model_len
    if max_model_len is None:
        logger.info("max_model_len not specified — defaulting to 4096 (safe for 12GB VRAM)")
        return 4096
    if max_model_len > 8192:
        logger.warning(f"max_model_len={max_model_len} is large — may OOM on 12GB VRAM")
    return max_model_len


def _has_chat_template(model_path: str) -> bool:
    try:
        tc = Path(model_path) / "tokenizer_config.json"
        return bool(tc.exists() and _json.loads(tc.read_text(errors="ignore")).get("chat_template"))
    except Exception:
        return False


def build_vllm_cmd(
    model_path: str, model_id: str, gpu_memory_utilization: float,
    max_model_len: int, is_vision: bool, enforce_eager: bool,
    max_cudagraph_capture_size: Optional[int], tensor_parallel_size: Optional[int],
    pipeline_parallel_size: Optional[int], python_bin: str,
) -> list[str]:
    cmd = [python_bin, "-m", "vllm.entrypoints.openai.api_server",
           "--model", model_path, "--served-model-name", model_id,
           "--port", str(VLLM_PORT), "--host", "127.0.0.1",
           "--gpu-memory-utilization", str(gpu_memory_utilization),
           "--trust-remote-code", "--max-model-len", str(max_model_len)]
    if is_vision:
        cmd += ["--enforce-eager", "--limit-mm-per-prompt", '{"image": 4, "video": 0}', "--skip-mm-profiling"]
    else:
        cmd += ["--language-model-only"]
        if enforce_eager:
            cmd += ["--enforce-eager"]
        elif max_cudagraph_capture_size is not None:
            cmd += ["--max-cudagraph-capture-size", str(max_cudagraph_capture_size)]
    cmd += ["--no-enable-flashinfer-autotune"]
    if tensor_parallel_size and tensor_parallel_size > 1:
        cmd.extend(["--tensor-parallel-size", str(tensor_parallel_size)])
    if pipeline_parallel_size and pipeline_parallel_size > 1:
        cmd.extend(["--pipeline-parallel-size", str(pipeline_parallel_size)])
    if not _has_chat_template(model_path):
        cmd += ["--chat-template", _FALLBACK_CHAT_TEMPLATE]
    return cmd


def parse_load_error(log_content: str) -> tuple[Optional[int], bool, str]:
    """Returns (suggested_len, is_util_oom, root_cause)."""
    from backend.services.vllm_service import _parse_suggested_max_len, _vllm_version
    suggested = _parse_suggested_max_len(log_content)
    is_util_oom = ("Free memory on device" in log_content
                   and "is less than desired GPU memory utilization" in log_content)
    if "input size is not aligned with the quantized weight shape" in log_content:
        raise RuntimeError(
            f"AWQ alignment error: multimodal architecture incompatible with AWQ in vLLM {_vllm_version()}. "
            "Use a GGUF version instead."
        )
    root_cause = next(
        (ln.split("Error:")[-1].strip()[:200] for ln in reversed(log_content.splitlines())
         if any(t in ln for t in ("ValueError:", "RuntimeError:", "OSError:"))),
        ""
    )
    return suggested, is_util_oom, root_cause


def resolve_active_version(python_override: Optional[str]) -> Optional[str]:
    try:
        from backend.services.vllm_manager import get_default_python as _gp, list_versions as _lv
        active_py = str(python_override) if python_override else str(_gp())
        return next((v["version"] for v in _lv() if v["path"] in active_py), None)
    except Exception:
        return None
