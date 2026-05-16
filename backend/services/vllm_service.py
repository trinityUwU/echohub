import atexit
import json
import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

from backend.models.schemas import ModelInfo

VLLM_PID_FILE = Path("/tmp/echohub_vllm.pid")
VLLM_PORT = 37823
VLLM_BASE_URL = f"http://127.0.0.1:{VLLM_PORT}"
VLLM_PYTHON = Path("/mnt/projects/echohub/.venv-vllm/bin/python")
VRAM_SAFETY_MARGIN = 0.02   # 2% of total reserved
VRAM_FIXED_OVERHEAD_MB = 1024  # 1GB fixed: vLLM process startup, NCCL, misc
VRAM_SAMPLE_WINDOW = 10    # last N nvidia-smi samples for baseline

_current_model: Optional[ModelInfo] = None
_vllm_proc: Optional[subprocess.Popen] = None
_vram_samples: list[int] = []  # used MB samples
_loading_model_id: Optional[str] = None  # set during async load
_load_error: Optional[str] = None        # last load error message
_eject_requested: bool = False           # set by unload_model() to abort in-progress load


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _write_pid(pid: int) -> None:
    VLLM_PID_FILE.write_text(str(pid))


def _read_pid() -> Optional[int]:
    if VLLM_PID_FILE.exists():
        try:
            return int(VLLM_PID_FILE.read_text().strip())
        except ValueError:
            return None
    return None


def _remove_pid() -> None:
    VLLM_PID_FILE.unlink(missing_ok=True)


def _kill_pid(pid: int) -> None:
    """Kill a process by PID, wait for it to die."""
    try:
        os.kill(pid, signal.SIGTERM)
        for _ in range(30):  # wait up to 3s
            time.sleep(0.1)
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                logger.info(f"vLLM PID {pid} terminated")
                return
        # Force kill if still alive
        os.kill(pid, signal.SIGKILL)
        logger.warning(f"vLLM PID {pid} force-killed with SIGKILL")
    except ProcessLookupError:
        logger.info(f"vLLM PID {pid} already gone")


def _log_vram_freed() -> None:
    """Log nvidia-smi VRAM after unload for verification."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            used, free = result.stdout.strip().split(",")
            logger.info(f"VRAM after unload — used: {used.strip()} MB, free: {free.strip()} MB")
    except Exception as e:
        logger.warning(f"Could not verify VRAM after unload: {e}")


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

def record_vram_sample() -> None:
    """Called periodically by gpu_service to track baseline VRAM usage."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        )
        if result.returncode == 0:
            used_mb, total_mb = [int(x.strip()) for x in result.stdout.strip().split(",")]
            _vram_samples.append(used_mb)
            if len(_vram_samples) > VRAM_SAMPLE_WINDOW:
                _vram_samples.pop(0)
    except Exception:
        pass


def compute_safe_gpu_utilization() -> tuple[float, int, int]:
    """
    Returns (gpu_memory_utilization, baseline_used_mb, total_mb).
    Uses average of recent VRAM samples as baseline, reserves 2% margin.
    """
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        )
        if result.returncode != 0:
            return 0.70, 0, 0
        current_used_mb, total_mb = [int(x.strip()) for x in result.stdout.strip().split(",")]

        # Use max of recent samples + current to avoid underestimating
        baseline_mb = max(_vram_samples + [current_used_mb]) if _vram_samples else current_used_mb
        free_mb = total_mb - baseline_mb
        # Apply 2% margin + 1GB fixed overhead for vLLM process startup
        safe_mb = free_mb - int(total_mb * VRAM_SAFETY_MARGIN) - VRAM_FIXED_OVERHEAD_MB
        utilization = round(safe_mb / total_mb, 3)
        utilization = max(0.50, min(utilization, 0.95))  # clamp 50%-95%

        logger.info(
            f"VRAM baseline: {baseline_mb} MB used / {total_mb} MB total — "
            f"safe allocation: {safe_mb} MB ({utilization:.1%})"
        )
        return utilization, baseline_mb, total_mb
    except Exception as e:
        logger.warning(f"compute_safe_gpu_utilization failed: {e} — using 0.70 fallback")
        return 0.70, 0, 0


def _parse_suggested_max_len(log_content: str = "") -> Optional[int]:
    """Parse vLLM log for 'estimated maximum model length is X' after a KV cache OOM."""
    import re
    if not log_content:
        try:
            log_content = Path("/mnt/projects/echohub/logs/vllm.log").read_text(errors="replace")
        except Exception:
            return None
    m = re.search(r'estimated maximum model length is (\d+)', log_content)
    if m:
        suggested = int(m.group(1))
        # Round down to nearest power of 2 for clean context sizes
        p2 = 1
        while p2 * 2 <= suggested:
            p2 *= 2
        return p2
    return None


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


def load_model_async(model_path: str, model_id: str,
                     gpu_memory_utilization: Optional[float] = None,
                     max_model_len: Optional[int] = None) -> None:
    """Launch vLLM in a background thread — returns immediately."""
    import threading
    global _loading_model_id, _load_error, _eject_requested
    _loading_model_id = model_id
    _load_error = None
    _eject_requested = False

    def _run():
        global _loading_model_id, _load_error
        try:
            load_model(model_path, model_id, gpu_memory_utilization, max_model_len)
        except Exception as e:
            if not _eject_requested:
                _load_error = str(e)
                logger.error(f"Async load failed: {e}")
        finally:
            _loading_model_id = None

    threading.Thread(target=_run, daemon=True, name=f"load-{model_id}").start()


def load_model(model_path: str, model_id: str, gpu_memory_utilization: Optional[float] = None,
               max_model_len: Optional[int] = None) -> None:
    """Launch vLLM subprocess serving model_path on VLLM_PORT."""
    global _current_model, _vllm_proc, _eject_requested

    _eject_requested = False  # reset from any previous eject

    if _vllm_proc is not None:
        raise RuntimeError("A model is already loaded. Unload it first.")

    # Auto-compute safe utilization from current VRAM state
    if gpu_memory_utilization is None:
        gpu_memory_utilization, _, _ = compute_safe_gpu_utilization()

    model_lower = model_path.lower()
    # Detect vision by name pattern AND by presence of preprocessor_config.json
    _has_mm_config = (Path(model_path) / "preprocessor_config.json").exists()
    is_vision = _has_mm_config or any(k in model_lower for k in ("-vl", "vl-", "vision", "qwen2-vl", "qwen2vl"))

    if is_vision:
        # Vision encoder adds heavy overhead — default to 4096 if not specified
        if max_model_len is None:
            max_model_len = 4096
            logger.info("Vision model — defaulting max_model_len to 4096")
        elif max_model_len > 4096:
            logger.warning(f"Vision model with max_model_len={max_model_len} — may OOM on 12GB VRAM")
    else:
        # Default to 4096 only when user hasn't specified — user-provided values are respected
        if max_model_len is None:
            max_model_len = 4096
            logger.info("max_model_len not specified — defaulting to 4096 (safe for 12GB VRAM)")
        elif max_model_len > 8192:
            logger.warning(f"max_model_len={max_model_len} is large — may OOM on 12GB VRAM")

    env = {
        **os.environ,
        "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
        "VLLM_USE_FLASHINFER_SAMPLER": "0",          # FlashInfer JIT requires nvcc
        "VLLM_WORKER_MULTIPROC_METHOD": "spawn",
        # CUDA graph profiling enabled (default in v0.21) — user-facing utilization
        # is corrected below to account for the ~15% overhead
    }

    cmd = [
        str(VLLM_PYTHON), "-m", "vllm.entrypoints.openai.api_server",
        "--model", model_path,
        "--served-model-name", model_id,  # expose HF id, not local path
        "--port", str(VLLM_PORT),
        "--host", "127.0.0.1",
        "--gpu-memory-utilization", str(gpu_memory_utilization),
        "--trust-remote-code",
    ]
    if max_model_len is not None:
        cmd += ["--max-model-len", str(max_model_len)]
    if is_vision:
        cmd += [
            "--enforce-eager",
            "--limit-mm-per-prompt", '{"image": 4, "video": 0}',
            "--skip-mm-profiling",  # skip vision encoder profile_run — main OOM source
        ]
    # Disable FlashInfer JIT sampling — requires nvcc which is not installed
    cmd += ["--no-enable-flashinfer-autotune"]

    logger.info(f"Starting vLLM: {' '.join(cmd)}")

    log_path = Path("/mnt/projects/echohub/logs/vllm.log")
    log_file = open(log_path, "w")
    _vllm_log_path = log_path  # store for _parse_suggested_max_len

    _vllm_proc = subprocess.Popen(
        cmd,
        stdout=log_file,
        stderr=log_file,
        start_new_session=True,
        env=env,
    )
    _write_pid(_vllm_proc.pid)
    logger.info(f"vLLM started with PID {_vllm_proc.pid}")

    # Check eject immediately after spawn (user may have clicked while we were building the cmd)
    if _eject_requested:
        logger.info("Eject requested before ready wait — killing vLLM")
        unload_model()
        raise RuntimeError("Ejected by user")

    if not _wait_vllm_ready():
        # Capture log content NOW before unload kills process or log gets overwritten on retry
        log_content = ""
        try:
            log_file.flush()
            log_content = log_path.read_text(errors="replace")
        except Exception:
            pass
        suggested_len = _parse_suggested_max_len(log_content)
        unload_model()
        if _eject_requested:
            raise RuntimeError("Ejected by user")
        if suggested_len and (max_model_len is None or suggested_len < max_model_len):
            logger.warning(
                f"KV cache OOM: max_model_len={max_model_len} too large. "
                f"Auto-retrying with max_model_len={suggested_len}."
            )
            load_model(
                model_path=model_path,
                model_id=model_id,
                gpu_memory_utilization=gpu_memory_utilization,
                max_model_len=suggested_len,
            )
            return
        raise RuntimeError(
            f"vLLM failed to start. "
            + (f"Try reducing context window (suggested max: {suggested_len} tokens)." if suggested_len
               else "Check VRAM — not enough memory for this model.")
        )

    _current_model = ModelInfo(
        id=model_id,
        name=model_id.split("/")[-1],
        downloaded=True,
        loaded=True,
        max_context_window=max_model_len,  # actual context used by vLLM
    )
    logger.info(f"Model loaded: {model_id}")


def unload_model() -> None:
    """Kill vLLM subprocess, free VRAM. Safe to call during loading (eject)."""
    global _current_model, _vllm_proc, _loading_model_id, _eject_requested

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
    time.sleep(1)
    _log_vram_freed()
    logger.info("Model unloaded / ejected")


def get_status() -> Optional[ModelInfo]:
    """Return loaded model info, or None if nothing is loaded."""
    return _current_model


async def generate(
    messages: list[dict],
    stream: bool = True,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    top_p: float = 0.95,
    top_k: int = -1,
    repetition_penalty: float = 1.1,
    presence_penalty: float = 0.0,
    frequency_penalty: float = 0.0,
    stop: Optional[list[str]] = None,
):
    """Proxy chat completion request to vLLM's OpenAI-compatible API.

    When stream=True, yields raw SSE data strings.
    When stream=False, returns the full response dict.
    """
    if _current_model is None:
        raise RuntimeError("No model loaded")

    # Ask vLLM what model name it's actually serving (path vs HF id depends on version)
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{VLLM_BASE_URL}/v1/models")
            actual_model_id = r.json()["data"][0]["id"]
    except Exception:
        actual_model_id = _current_model.id

    payload: dict = {
        "model": actual_model_id,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "top_p": top_p,
        "repetition_penalty": repetition_penalty,
        "presence_penalty": presence_penalty,
        "frequency_penalty": frequency_penalty,
        "stream": stream,
    }

    # top_k: vLLM errors on -1 in some versions, only include if > 0
    if top_k > 0:
        payload["top_k"] = top_k

    if stop:
        payload["stop"] = stop

    if stream:
        payload["stream_options"] = {"include_usage": True}

    if stream:
        async with httpx.AsyncClient(timeout=300) as client:
            async with client.stream(
                "POST",
                f"{VLLM_BASE_URL}/v1/chat/completions",
                json=payload,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if line:
                        yield line
    else:
        async with httpx.AsyncClient(timeout=300) as client:
            resp = await client.post(
                f"{VLLM_BASE_URL}/v1/chat/completions",
                json=payload,
            )
            resp.raise_for_status()
            yield resp.json()


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
