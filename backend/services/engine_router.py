"""
Engine router — détecte le format du modèle et dispatche vers le bon engine.

Logique de routing :
  GGUF → llama_service (cross-platform, défaut)
  AWQ / GPTQ / FP8 / EXL2 / FP16 → vllm_service (NVIDIA requis)

L'engine actif est unique — un seul modèle chargé à la fois.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional

from loguru import logger

from backend.models.schemas import ModelInfo

_PROJECT_ROOT = Path(__file__).resolve().parents[3]

# ──────────────────────────────────────────────────────────────────────────────
# Format detection
# ──────────────────────────────────────────────────────────────────────────────

def detect_format(model_id: str, model_path: str) -> str:
    """
    Retourne 'gguf' ou 'vllm' selon le format du modèle.
    Priorité : fichiers présents > nom du modèle.
    """
    path = Path(model_path)
    if path.is_dir():
        gguf_files = list(path.glob("*.gguf"))
        if gguf_files:
            return "gguf"
        safetensor_files = list(path.glob("*.safetensors")) + list(path.glob("*.bin"))
        if safetensor_files:
            return "vllm"

    name_lower = model_id.lower()
    if "gguf" in name_lower:
        return "gguf"
    if any(k in name_lower for k in ("awq", "gptq", "fp8", "exl2")):
        return "vllm"

    # Défaut : llama si aucun signal clair
    return "gguf"


def find_gguf_file(model_path: str) -> Optional[str]:
    """Trouve le fichier .gguf principal dans le répertoire du modèle."""
    path = Path(model_path)
    if path.suffix == ".gguf" and path.exists():
        return str(path)

    # Préférer Q4_K_M > Q5_K_M > Q8_0 > tout autre
    priority = ["q4_k_m", "q5_k_m", "q4_k_s", "q5_k_s", "q8_0", "q4_0"]
    gguf_files = list(path.glob("*.gguf")) if path.is_dir() else []

    for pref in priority:
        for f in gguf_files:
            if pref in f.name.lower():
                return str(f)

    # Fallback : premier fichier trouvé
    return str(gguf_files[0]) if gguf_files else None


# ──────────────────────────────────────────────────────────────────────────────
# GPU detection
# ──────────────────────────────────────────────────────────────────────────────

def detect_gpu() -> dict:
    """
    Détecte le GPU disponible.
    Retourne : { "type": "nvidia"|"amd"|"apple"|"cpu", "vram_mb": int }
    """
    # NVIDIA
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            vram_mb = int(result.stdout.strip().split("\n")[0].strip())
            logger.info(f"GPU detected: NVIDIA ({vram_mb} MB VRAM)")
            return {"type": "nvidia", "vram_mb": vram_mb}
    except Exception:
        pass

    # AMD ROCm
    try:
        result = subprocess.run(
            ["rocm-smi", "--showmeminfo", "vram", "--noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and "vram" in result.stdout.lower():
            logger.info("GPU detected: AMD ROCm")
            return {"type": "amd", "vram_mb": 0}
    except Exception:
        pass

    # Apple Metal
    try:
        import platform
        if platform.system() == "Darwin":
            result = subprocess.run(
                ["system_profiler", "SPDisplaysDataType"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0 and "Metal" in result.stdout:
                logger.info("GPU detected: Apple Metal")
                return {"type": "apple", "vram_mb": 0}
    except Exception:
        pass

    logger.info("No GPU detected — CPU only")
    return {"type": "cpu", "vram_mb": 0}


def is_vllm_available() -> bool:
    """Check vLLM availability via vllm_manager (supports multi-venv)."""
    try:
        from backend.services.vllm_manager import list_versions
        return any(v["installed"] for v in list_versions())
    except Exception:
        # Fallback: check legacy path relative to project root
        import glob as _glob
        legacy = Path(__file__).resolve().parents[3] / ".venv-vllm"
        if (legacy / "bin" / "python").exists():
            for sp in legacy.glob("lib/python*/site-packages"):
                if (sp / "vllm").is_dir() or _glob.glob(str(sp / "vllm-*.dist-info")):
                    return True
        return False


# ──────────────────────────────────────────────────────────────────────────────
# Active engine tracking
# ──────────────────────────────────────────────────────────────────────────────

_active_engine: Optional[str] = None  # "llama" | "vllm" | None


def get_active_engine() -> Optional[str]:
    return _active_engine


def set_active_engine(engine: Optional[str]) -> None:
    global _active_engine
    _active_engine = engine


# ──────────────────────────────────────────────────────────────────────────────
# Unified interface — délègue au bon engine
# ──────────────────────────────────────────────────────────────────────────────

def get_status() -> Optional[ModelInfo]:
    from backend.services import llama_service, vllm_service
    info = None
    if _active_engine == "llama":
        info = llama_service.get_status()
    elif _active_engine == "vllm":
        info = vllm_service.get_status()
    if info is not None:
        info.engine = _active_engine
    return info


def get_load_state() -> dict:
    from backend.services import llama_service, vllm_service

    if _active_engine == "llama":
        state = llama_service.get_load_state()
        state["load_config"] = llama_service.get_load_config()
        return state
    if _active_engine == "vllm":
        state = vllm_service.get_load_state()
        state["load_config"] = vllm_service.get_load_config()
        return state
    # No active engine — check if a load is in progress
    vllm_state = vllm_service.get_load_state()
    if vllm_state["loading_model_id"]:
        vllm_state["load_config"] = vllm_service.get_load_config()
        return vllm_state
    llama_state = llama_service.get_load_state()
    llama_state["load_config"] = llama_service.get_load_config()
    return llama_state


def load_model_async(
    model_path: str,
    model_id: str,
    gpu_memory_utilization: Optional[float] = None,
    max_model_len: Optional[int] = None,
    enforce_eager: bool = False,
    max_cudagraph_capture_size: Optional[int] = None,
    vllm_version: Optional[str] = None,
    n_gpu_layers: Optional[int] = None,
    cpu_overflow: bool = False,
    is_moe: bool = False,
    kv_quant: Optional[str] = None,
    offload_kqv: bool = False,
    n_batch: Optional[int] = None,
    tensor_parallel_size: Optional[int] = None,
    pipeline_parallel_size: Optional[int] = None,
) -> None:
    from backend.services import llama_service, vllm_service

    fmt = detect_format(model_id, model_path)
    gpu = detect_gpu()

    # GGUF → toujours llama
    if fmt == "gguf":
        gguf_path = find_gguf_file(model_path)
        if not gguf_path:
            raise FileNotFoundError(f"No .gguf file found in {model_path}")
        from backend.services.gguf_utils import find_mmproj, detect_vision_handler
        mmproj = find_mmproj(model_path)
        vision_handler = detect_vision_handler(model_id) if mmproj else None
        set_active_engine("llama")
        logger.info(f"Routing {model_id} → llama-cpp-python (GGUF: {Path(gguf_path).name})"
                    + (f" + mmproj ({vision_handler})" if mmproj else ""))
        llama_service.load_model_async(
            gguf_path=gguf_path,
            model_id=model_id,
            n_ctx=max_model_len or 4096,
            gpu_type=gpu["type"],
            n_gpu_layers_override=n_gpu_layers,
            cpu_overflow=cpu_overflow,
            is_moe=is_moe,
            mmproj_path=mmproj,
            vision_handler=vision_handler,
            kv_quant=kv_quant,
            offload_kqv=offload_kqv,
            n_batch_override=n_batch,
        )
        return

    # AWQ/GPTQ/FP8 → vLLM si NVIDIA disponible
    if gpu["type"] == "nvidia" and is_vllm_available():
        set_active_engine("vllm")
        logger.info(f"Routing {model_id} → vLLM ({fmt.upper()})")
        # Resolve vllm python: use requested version or auto-pick best compatible
        from backend.services.vllm_manager import get_python_for_version, get_default_python
        if vllm_version:
            py = get_python_for_version(vllm_version)
            if not py:
                raise RuntimeError(
                    f"vLLM {vllm_version} is not installed. "
                    f"Install it in Settings → Engines."
                )
            logger.info(f"Using vLLM {vllm_version} at {py}")
        else:
            py = get_default_python()

        vllm_service.load_model_async(
            model_path=model_path,
            model_id=model_id,
            gpu_memory_utilization=gpu_memory_utilization,
            max_model_len=max_model_len,
            enforce_eager=enforce_eager,
            max_cudagraph_capture_size=max_cudagraph_capture_size,
            python_override=str(py),
            tensor_parallel_size=tensor_parallel_size,
            pipeline_parallel_size=pipeline_parallel_size,
        )
        return

    raise RuntimeError(
        f"Cannot load {fmt.upper()} model: vLLM not available or no NVIDIA GPU detected. "
        "Install vLLM in .venv-vllm or use a GGUF model instead."
    )


def unload_model() -> None:
    from backend.services import llama_service, vllm_service
    engine = _active_engine
    set_active_engine(None)
    if engine == "llama":
        llama_service.unload_model()
    elif engine == "vllm":
        vllm_service.unload_model()


async def generate(messages: list[dict], **kwargs):
    from backend.services import llama_service, vllm_service
    if _active_engine == "llama":
        async for chunk in llama_service.generate(messages=messages, **kwargs):
            yield chunk
    elif _active_engine == "vllm":
        async for chunk in vllm_service.generate(messages=messages, **kwargs):
            yield chunk
    else:
        raise RuntimeError("No model loaded")


async def generate_with_tools(
    messages: list[dict],
    tools: list[dict],
    stop_event=None,
    **kwargs,
):
    """Route tool use call to the active engine. Yields a single response dict."""
    from backend.services import llama_service, vllm_service
    if _active_engine == "llama":
        async for result in llama_service.generate_with_tools(
            messages=messages, tools=tools, stop_event=stop_event, **kwargs
        ):
            yield result
    elif _active_engine == "vllm":
        # vLLM tool use: delegate to vllm_service if it supports it,
        # otherwise fall back to llama-style non-streaming call.
        if hasattr(vllm_service, "generate_with_tools"):
            async for result in vllm_service.generate_with_tools(
                messages=messages, tools=tools, **kwargs
            ):
                yield result
        else:
            raise RuntimeError("vLLM engine does not support tool use in this build")
    else:
        raise RuntimeError("No model loaded")


def get_engine_log(n_lines: int = 100) -> str:
    from backend.services import llama_service, vllm_service
    if _active_engine == "llama":
        return llama_service.get_log(n_lines)
    if _active_engine == "vllm":
        log_path = _PROJECT_ROOT / "logs" / "vllm.log"
        if not log_path.exists():
            return ""
        lines = log_path.read_text(errors="replace").splitlines()
        return "\n".join(lines[-n_lines:])
    return ""


def cleanup() -> None:
    from backend.services import llama_service, vllm_service
    llama_service.cleanup()
    vllm_service.cleanup()
