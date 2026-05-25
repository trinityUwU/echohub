import atexit
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

from backend.models.schemas import ModelInfo
from backend.services.vllm_process import (
    VLLM_PID_FILE, _write_pid, _read_pid, _remove_pid, _kill_pid, _log_vram_freed,
)
from backend.services.vllm_vram import (
    VRAM_SAFETY_MARGIN, VRAM_FIXED_OVERHEAD_MB, VRAM_SAMPLE_WINDOW,
    record_vram_sample, compute_safe_gpu_utilization, _parse_suggested_max_len,
)

VLLM_PORT = 37823
VLLM_BASE_URL = f"http://127.0.0.1:{VLLM_PORT}"


def _get_vllm_python(version: Optional[str] = None) -> Path:
    """Get vLLM python for a specific version, or the default."""
    try:
        from backend.services.vllm_manager import get_python_for_version, get_default_python
        if version:
            py = get_python_for_version(version)
            if py:
                return py
        return get_default_python()
    except Exception:
        # Fallback to legacy path relative to project root
        legacy = Path(__file__).resolve().parents[2] / ".venv-vllm" / "bin" / "python"
        if legacy.exists():
            return legacy
        raise FileNotFoundError("No vLLM installation found")


# Kept for backward compat — actual path resolved dynamically
VLLM_PYTHON = Path(__file__).resolve().parents[2] / ".venv-vllm" / "bin" / "python"
_PROJECT_ROOT = Path(__file__).resolve().parents[2]

_current_model: Optional[ModelInfo] = None
_vllm_proc: Optional[subprocess.Popen] = None
_loading_model_id: Optional[str] = None  # set during async load
_load_error: Optional[str] = None        # last load error message
_eject_requested: bool = False           # set by unload_model() to abort in-progress load
_load_config: Optional[dict] = None      # params used at last successful load


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _wait_vllm_ready(timeout: int = 300) -> bool:
    """Poll vLLM /health until ready, timeout, or eject requested."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _eject_requested:
            logger.info("Eject requested — aborting vLLM ready wait")
            return False
        # Also check if subprocess died on its own
        if _vllm_proc is not None and _vllm_proc.poll() is not None:
            logger.warning(f"vLLM process exited with code {_vllm_proc.returncode}")
            return False
        try:
            r = httpx.get(f"{VLLM_BASE_URL}/health", timeout=2)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def kill_stale_pid() -> None:
    """On startup: kill any leftover vLLM process from a previous crash."""
    pid = _read_pid()
    if pid is None:
        return
    logger.warning(f"Stale vLLM PID {pid} found — killing before startup")
    _kill_pid(pid)
    _remove_pid()
    time.sleep(1)
    _log_vram_freed()


def get_load_state() -> dict:
    """Return current loading state for polling."""
    return {
        "loading_model_id": _loading_model_id,
        "loaded_model_id": _current_model.id if _current_model else None,
        "error": _load_error,
    }


def get_load_config() -> Optional[dict]:
    """Return the params used at last successful model load, or None."""
    return _load_config


def load_model_async(model_path: str, model_id: str,
                     gpu_memory_utilization: Optional[float] = None,
                     max_model_len: Optional[int] = None,
                     enforce_eager: bool = False,
                     max_cudagraph_capture_size: Optional[int] = None,
                     python_override: Optional[str] = None,
                     tensor_parallel_size: Optional[int] = None,
                     pipeline_parallel_size: Optional[int] = None) -> None:
    """Launch vLLM in a background thread — returns immediately."""
    import threading
    global _loading_model_id, _load_error, _eject_requested
    _loading_model_id = model_id
    _load_error = None
    _eject_requested = False

    def _run():
        global _loading_model_id, _load_error
        try:
            load_model(model_path, model_id, gpu_memory_utilization, max_model_len,
                       enforce_eager, max_cudagraph_capture_size, python_override,
                       tensor_parallel_size, pipeline_parallel_size)
        except Exception as e:
            if not _eject_requested:
                _load_error = str(e)
                logger.error(f"Async load failed: {e}")
        finally:
            _loading_model_id = None

    threading.Thread(target=_run, daemon=True, name=f"load-{model_id}").start()


_FALLBACK_CHAT_TEMPLATE = (
    "{% for message in messages %}"
    "{% if message['role'] == 'system' %}<|im_start|>system\n{{ message['content'] }}<|im_end|>\n{% endif %}"
    "{% if message['role'] == 'user' %}<|im_start|>user\n{{ message['content'] }}<|im_end|>\n<|im_start|>assistant\n{% endif %}"
    "{% if message['role'] == 'assistant' %}{{ message['content'] }}<|im_end|>\n{% endif %}"
    "{% endfor %}"
)


def _resolve_max_model_len(model_path: str, max_model_len: Optional[int], is_vision: bool) -> int:
    if is_vision:
        if max_model_len is None:
            logger.info("Vision model — defaulting max_model_len to 4096")
            return 4096
        if max_model_len > 4096:
            logger.warning(f"Vision model with max_model_len={max_model_len} — may OOM on 12GB VRAM")
        return max_model_len
    if max_model_len is None:
        logger.info("max_model_len not specified — defaulting to 32768 for EchoCode compatibility")
        return 32768
    if max_model_len > 32768:
        logger.warning(f"max_model_len={max_model_len} is large — may OOM on 12GB VRAM")
    return max_model_len


def _build_vllm_cmd(
    model_path: str, model_id: str, gpu_memory_utilization: float,
    max_model_len: int, is_vision: bool, enforce_eager: bool,
    max_cudagraph_capture_size: Optional[int], tensor_parallel_size: Optional[int],
    pipeline_parallel_size: Optional[int], python_override: Optional[str],
) -> list[str]:
    py = str(Path(python_override) if python_override else _get_vllm_python())
    cmd = [py, "-m", "vllm.entrypoints.openai.api_server",
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
    # Fallback chat template if model has none
    has_template = False
    try:
        import json as _j
        tc = Path(model_path) / "tokenizer_config.json"
        if tc.exists():
            has_template = bool(_j.loads(tc.read_text(errors="ignore")).get("chat_template"))
    except Exception:
        pass
    if not has_template:
        cmd += ["--chat-template", _FALLBACK_CHAT_TEMPLATE]
    return cmd


def _handle_load_failure(
    log_path: Path, log_file: object,  # type: ignore[type-arg]
    model_path: str, model_id: str, gpu_memory_utilization: float,
    max_model_len: int, python_override: Optional[str],
    tensor_parallel_size: Optional[int], pipeline_parallel_size: Optional[int],
) -> None:
    """Parse vLLM failure log and retry or raise with clear message."""
    log_content = ""
    try:
        log_file.flush()  # type: ignore[attr-defined]
        log_content = log_path.read_text(errors="replace")
    except Exception:
        pass
    suggested_len = _parse_suggested_max_len(log_content)
    is_util_oom = ("Free memory on device" in log_content
                   and "is less than desired GPU memory utilization" in log_content)
    unload_model()
    if _eject_requested:
        raise RuntimeError("Ejected by user")
    if suggested_len and suggested_len < max_model_len:
        logger.warning(f"KV cache OOM — retrying with max_model_len={suggested_len}")
        load_model(model_path=model_path, model_id=model_id,
                   gpu_memory_utilization=gpu_memory_utilization, max_model_len=suggested_len,
                   python_override=python_override, tensor_parallel_size=tensor_parallel_size,
                   pipeline_parallel_size=pipeline_parallel_size)
        return
    if is_util_oom and gpu_memory_utilization > 0.55:
        reduced = round(gpu_memory_utilization - 0.03, 2)
        logger.warning(f"GPU util OOM — retrying with gpu_memory_utilization={reduced}")
        load_model(model_path=model_path, model_id=model_id,
                   gpu_memory_utilization=reduced, max_model_len=max_model_len,
                   python_override=python_override, tensor_parallel_size=tensor_parallel_size,
                   pipeline_parallel_size=pipeline_parallel_size)
        return
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
    raise RuntimeError(root_cause or (
        "Not enough VRAM — lower GPU utilization % or reduce context length."
        if is_util_oom else "vLLM failed to start — check model compatibility."
    ))


def _resolve_active_version(python_override: Optional[str]) -> Optional[str]:
    try:
        from backend.services.vllm_manager import get_default_python as _gp, list_versions as _lv
        active_py = str(python_override) if python_override else str(_gp())
        return next((v["version"] for v in _lv() if v["path"] in active_py), None)
    except Exception:
        return None


def load_model(model_path: str, model_id: str, gpu_memory_utilization: Optional[float] = None,
               max_model_len: Optional[int] = None, enforce_eager: bool = False,
               max_cudagraph_capture_size: Optional[int] = None,
               python_override: Optional[str] = None,
               tensor_parallel_size: Optional[int] = None,
               pipeline_parallel_size: Optional[int] = None) -> None:
    """Launch vLLM subprocess serving model_path on VLLM_PORT."""
    global _current_model, _vllm_proc, _eject_requested, _load_config
    _eject_requested = False
    if _vllm_proc is not None:
        raise RuntimeError("A model is already loaded. Unload it first.")
    if gpu_memory_utilization is None:
        gpu_memory_utilization, _, _ = compute_safe_gpu_utilization()

    model_lower = model_path.lower()
    is_vision = ((Path(model_path) / "preprocessor_config.json").exists()
                 or any(k in model_lower for k in ("-vl", "vl-", "vision", "qwen2-vl", "qwen2vl")))
    max_model_len = _resolve_max_model_len(model_path, max_model_len, is_vision)

    cmd = _build_vllm_cmd(model_path, model_id, gpu_memory_utilization, max_model_len,
                           is_vision, enforce_eager, max_cudagraph_capture_size,
                           tensor_parallel_size, pipeline_parallel_size, python_override)
    logger.info(f"Starting vLLM: {' '.join(cmd)}")
    log_path = _PROJECT_ROOT / "logs" / "vllm.log"
    log_file = open(log_path, "w")
    env = {**os.environ, "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
           "VLLM_USE_FLASHINFER_SAMPLER": "0", "VLLM_WORKER_MULTIPROC_METHOD": "spawn"}
    _vllm_proc = subprocess.Popen(cmd, stdout=log_file, stderr=log_file, start_new_session=True, env=env)
    _write_pid(_vllm_proc.pid)
    logger.info(f"vLLM started with PID {_vllm_proc.pid}")

    if _eject_requested:
        unload_model()
        raise RuntimeError("Ejected by user")

    if not _wait_vllm_ready():
        _handle_load_failure(log_path, log_file, model_path, model_id, gpu_memory_utilization,
                             max_model_len, python_override, tensor_parallel_size, pipeline_parallel_size)
        return

    active_version = _resolve_active_version(python_override)
    _current_model = ModelInfo(id=model_id, name=model_id.split("/")[-1],
                               downloaded=True, loaded=True,
                               max_context_window=max_model_len, engine="vllm")
    _load_config = {"engine": "vllm", "gpu_memory_utilization": gpu_memory_utilization,
                    "max_model_len": max_model_len, "vllm_version": active_version,
                    "gguf_path": model_path if model_path.endswith(".gguf") else None,
                    "tensor_parallel_size": tensor_parallel_size,
                    "pipeline_parallel_size": pipeline_parallel_size}
    try:
        from backend.services.db import set_app_state
        set_app_state(f"engine:{model_id}", f"vllm:{active_version or '?'}")
    except Exception:
        pass
    logger.info(f"Model loaded: {model_id} (vLLM {active_version})")


def unload_model() -> None:
    """Kill vLLM subprocess, free VRAM. Safe to call during loading (eject)."""
    global _current_model, _vllm_proc, _loading_model_id, _eject_requested, _load_config

    # Signal the load thread to abort
    _eject_requested = True
    _loading_model_id = None

    pid = _read_pid()
    if pid is not None:
        _kill_pid(pid)
        _remove_pid()

    if _vllm_proc is not None:
        try:
            _vllm_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _vllm_proc.kill()
        _vllm_proc = None

    _current_model = None
    _load_config = None
    time.sleep(1)
    _log_vram_freed()
    logger.info("Model unloaded / ejected")


def get_status() -> Optional[ModelInfo]:
    """Return loaded model info, or None if nothing is loaded."""
    return _current_model


# ---------------------------------------------------------------------------
# Re-export generation functions for backward compat
# ---------------------------------------------------------------------------
from backend.services.vllm_generate import generate, generate_with_tools  # noqa: E402

__all__ = [
    "VLLM_BASE_URL",
    "VLLM_PORT",
    "VLLM_PID_FILE",
    "VLLM_PYTHON",
    "_current_model",
    "load_model",
    "load_model_async",
    "unload_model",
    "get_status",
    "get_load_state",
    "get_load_config",
    "kill_stale_pid",
    "record_vram_sample",
    "compute_safe_gpu_utilization",
    "cleanup",
    "generate",
    "generate_with_tools",
]


def cleanup() -> None:
    """Called by atexit — always kills vLLM subprocess on process exit."""
    logger.info("EchoHub cleanup — killing vLLM if running")
    try:
        unload_model()
    except Exception as e:
        logger.error(f"cleanup error: {e}")


# atexit only — do NOT override SIGTERM/SIGINT here.
# Those signals are owned by uvicorn; overriding them kills the entire
# backend (including search, GPU endpoints) when vLLM crashes.
# FastAPI lifespan handles graceful shutdown via atexit.
atexit.register(cleanup)


def _vllm_version() -> str:
    try:
        py = _get_vllm_python()
        result = subprocess.run(
            [str(py), "-c", "import importlib.metadata; print(importlib.metadata.version('vllm'))"],
            capture_output=True, text=True, timeout=10
        )
        v = result.stdout.strip()
        return v if v else "unknown"
    except Exception:
        return "unknown"
