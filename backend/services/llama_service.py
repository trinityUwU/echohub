"""
llama_service — backend llama-cpp-python pour GGUF.

Performance target : niveau LM Studio (~60 tok/s sur 4B), PAS Ollama.
Params critiques : n_gpu_layers=-1, n_batch=512, flash_attn=True.
"""
from __future__ import annotations

import asyncio
import atexit
import json
import os
import threading
import time
from pathlib import Path
from typing import AsyncGenerator, Optional

from loguru import logger

from backend.models.schemas import ModelInfo

def _model_params_from_path(gguf_path: str) -> float:
    """Estimate params_billion from GGUF filename — fast, no metadata read."""
    import re
    name = Path(gguf_path).stem.upper()
    m = re.search(r'(\d+\.?\d*)B', name)
    return float(m.group(1)) if m else 8.0


def estimateLayers_backend(params_billion: float) -> int:
    """Estimate total transformer layers from param count — mirrors frontend logic."""
    p = params_billion
    if p <= 1.5: return 28
    if p <= 3:   return 36
    if p <= 8:   return 32
    if p <= 14:  return 40
    if p <= 32:  return 64
    return 80


def _gguf_has_mtp_heads(gguf_path: str) -> bool:
    """Return True if GGUF metadata contains MTP head markers (Qwen3, DeepSeek-V3 style)."""
    try:
        with open(gguf_path, 'rb') as f:
            magic = f.read(4)
            if magic != b'GGUF':
                return False
            f.seek(0)
            header = f.read(65536)
        return b'mtp' in header.lower() or b'num_nextn_predict' in header
    except Exception:
        return False


def detect_mtp_support(gguf_path: str) -> bool:
    """Return True if this GGUF has MTP heads (Qwen3, DeepSeek-V3 style)."""
    return _gguf_has_mtp_heads(gguf_path)


def _flash_attn_enabled() -> bool:
    try:
        from backend.services.config_service import get_inference_settings
        return get_inference_settings().get("flash_attn", True)
    except Exception:
        return True



# ──────────────────────────────────────────────────────────────────────────────
# State
# ──────────────────────────────────────────────────────────────────────────────

_llm = None                                    # Llama instance
_current_model: Optional[ModelInfo] = None
_loading_model_id: Optional[str] = None
_load_error: Optional[str] = None
_eject_requested: bool = False
_lock = threading.Lock()
_load_config: Optional[dict] = None           # params used at last successful load

LOG_PATH = Path(__file__).resolve().parents[2] / "logs" / "llama.log"

# ──────────────────────────────────────────────────────────────────────────────
# GPU layer mapping
# ──────────────────────────────────────────────────────────────────────────────

def _n_gpu_layers(gpu_type: str) -> int:
    """Full offload sur tout GPU supporté — même politique que LM Studio."""
    if gpu_type in ("nvidia", "amd", "apple"):
        return -1   # -1 = offload toutes les couches
    return 0        # CPU only


def _detect_n_threads(gpu_layers: int = -1, total_layers: int = 32) -> int:
    """
    Thread count adapté à la charge CPU réelle.
    Quand la majorité des layers est sur CPU (profils Gaming/Minimal),
    utiliser tous les threads logiques disponibles — le bottleneck est CPU.
    Sinon, les cores physiques suffisent (GPU fait le vrai travail).
    """
    try:
        logical = os.cpu_count() or 4
        physical = max(4, logical // 2)
        if gpu_layers >= 0:
            gpu_pct = gpu_layers / max(total_layers, 1)
            # Plus de 80% des layers sur CPU → tous les threads logiques
            return logical if gpu_pct < 0.2 else physical
        return physical  # -1 = full GPU → cores physiques suffisent
    except Exception:
        return 4


# ──────────────────────────────────────────────────────────────────────────────
# Log helpers
# ──────────────────────────────────────────────────────────────────────────────

def _log(msg: str) -> None:
    logger.info(msg)
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_PATH, "a") as f:
            f.write(f"{msg}\n")
    except Exception:
        pass


def _reset_log() -> None:
    try:
        LOG_PATH.write_text("")
    except Exception:
        pass


def get_log(n_lines: int = 100) -> str:
    if not LOG_PATH.exists():
        return ""
    try:
        lines = LOG_PATH.read_text(errors="replace").splitlines()
        return "\n".join(lines[-n_lines:])
    except Exception:
        return ""


# ──────────────────────────────────────────────────────────────────────────────
# Load / unload
# ──────────────────────────────────────────────────────────────────────────────

def load_model(
    gguf_path: str,
    model_id: str,
    n_ctx: int = 4096,
    gpu_type: str = "nvidia",
    n_gpu_layers_override: int | None = None,
    cpu_overflow: bool = False,
    is_moe: bool = False,
    mmproj_path: Optional[str] = None,
    vision_handler: Optional[str] = None,
    kv_quant: Optional[str] = None,
    offload_kqv: bool = False,
    n_batch_override: int | None = None,
    speculative_mode: str = "off",
    draft_model_path: Optional[str] = None,
    n_pred_tokens: int = 10,
    tensor_split: list[float] | None = None,
    main_gpu: int | None = None,
) -> None:
    """Charge le modèle GGUF. Bloquant — appelé depuis un thread."""
    global _llm, _current_model, _load_error, _eject_requested, _load_config

    try:
        from llama_cpp import Llama
    except ImportError:
        raise RuntimeError(
            "llama-cpp-python not installed. "
            "Run: pip install llama-cpp-python "
            "(CUDA: CMAKE_ARGS='-DGGML_CUDA=on' pip install llama-cpp-python)"
        )

    _reset_log()
    # n_gpu_layers: user override > auto detection
    n_gpu = n_gpu_layers_override if n_gpu_layers_override is not None else _n_gpu_layers(gpu_type)

    # MoE on 12GB VRAM: key insight from llama.cpp community —
    # Only 3B active params per token, but ALL expert weights must be in accessible memory.
    # Strategy confirmed working on RTX 3060 12GB (r/LocalLLaMA):
    #   - n_gpu_layers=65 (not -1): fits GPU layers without OOM at load time
    #   - GGML_CUDA_ENABLE_UNIFIED_MEMORY=1: spills expert weights to system RAM transparently
    #   - split_mode=LAYER (NOT ROW): MoE does not support tensor parallelism
    #   - n_batch=128: reduces activation memory during inference
    # IQ4_XS ~18.8GB total, ~10GB on GPU, rest in unified/RAM → works.
    if is_moe and n_gpu == -1 and n_gpu_layers_override is None:
        free_vram_mb = _get_free_vram_mb() or 0
        # Scale GPU layers based on available VRAM: ~150MB per layer for MoE
        safe_layers = max(16, min(65, int(free_vram_mb / 150)))
        n_gpu = safe_layers
        _log(f"[llama] MoE VRAM guard: n_gpu_layers={n_gpu} (free VRAM: {free_vram_mb}MB)")

    # Enable CUDA unified memory for MoE — spills expert weights to system RAM automatically
    if is_moe:
        import os as _os
        _os.environ.setdefault("GGML_CUDA_ENABLE_UNIFIED_MEMORY", "1")

    total_layers = estimateLayers_backend(_model_params_from_path(gguf_path))
    n_threads = _detect_n_threads(gpu_layers=n_gpu, total_layers=total_layers)

    # n_batch:
    # - User override always wins
    # - MoE: 128 to reduce GPU activation memory
    # - CPU-heavy (< 20% layers on GPU): 512 — no VRAM pressure, bigger batch = faster prefill
    # - Default: 512
    if n_batch_override is not None:
        n_batch = n_batch_override
    elif is_moe:
        n_batch = 128
    elif n_gpu >= 0 and n_gpu < max(4, total_layers // 5):
        # Most layers on CPU — maximize batch for prefill throughput
        n_batch = 512
    else:
        n_batch = 512

    _log(f"[llama] Loading {model_id}")
    _log(f"[llama] File: {gguf_path}")
    _log(f"[llama] n_gpu_layers={n_gpu} | n_ctx={n_ctx} | n_batch={n_batch} | flash_attn={_flash_attn_enabled()} | n_threads={n_threads} | cpu_overflow={cpu_overflow} | is_moe={is_moe} | offload_kqv={offload_kqv} | vision={mmproj_path is not None}")

    if _eject_requested:
        raise RuntimeError("Ejected by user")

    start = time.time()

    # KV cache quantization — user-selectable
    # q8_0=8, q4_0=2 (llama-cpp-python numeric type IDs)
    # None = don't pass type_k/type_v → llama.cpp native default (F16)
    _KV_TYPE = {"q8_0": 8, "q4_0": 2, "bf16": 1}
    # Default to Q4_0 — best speed/quality tradeoff. Only skip if explicitly None.
    effective_kv = kv_quant if kv_quant is not None else "q4_0"
    kv_type_id = _KV_TYPE.get(effective_kv, 2)
    _log(f"[llama] KV cache: {effective_kv} (type_k=type_v={kv_type_id})")

    llama_kwargs: dict = dict(
        model_path=gguf_path,
        n_ctx=n_ctx,
        n_batch=n_batch,
        n_gpu_layers=n_gpu,
        flash_attn=_flash_attn_enabled(),
        n_threads=n_threads,
        verbose=False,
        use_mmap=True,
        use_mlock=False,
        type_k=kv_type_id,
        type_v=kv_type_id,
        offload_kqv=offload_kqv,
    )
    # split_mode: ROW for dense cpu_overflow, LAYER for MoE (MoE does not support tensor parallelism)
    if is_moe:
        try:
            from llama_cpp import LLAMA_SPLIT_MODE_LAYER
            llama_kwargs["split_mode"] = LLAMA_SPLIT_MODE_LAYER
            _log(f"[llama] MoE: split_mode=LAYER, n_batch={n_batch}")
        except ImportError:
            _log("[llama] MoE: LLAMA_SPLIT_MODE_LAYER not available, using default")
    elif cpu_overflow and n_gpu != 0:
        try:
            from llama_cpp import LLAMA_SPLIT_MODE_ROW
            llama_kwargs["split_mode"] = LLAMA_SPLIT_MODE_ROW
        except ImportError:
            _log("[llama] cpu_overflow requested but split_mode not available in this llama-cpp version", "warn")

    # MoE with CPU overflow: skip CUDA graph profiling to prevent OOM at 88%
    # n_batch already set to 128 for MoE above unless user overrode it
    if is_moe and cpu_overflow:
        llama_kwargs["use_mmap"] = True
        # no_perf disables CUDA graph warmup in llama-cpp-python >= 0.3.x
        try:
            llama_kwargs["no_perf"] = True
        except Exception:
            pass  # param not supported — n_batch=128 is the fallback mitigation
        _log("[llama] MoE + cpu_overflow: n_batch=128, no_perf=True to avoid CUDA graph OOM")

    # Speculative decoding — must be set in llama_kwargs before Llama() is constructed
    if speculative_mode == "ngram":
        try:
            from llama_cpp.llama_speculative import LlamaPromptLookupDecoding
            llama_kwargs["draft_model"] = LlamaPromptLookupDecoding(num_pred_tokens=n_pred_tokens)
            _log(f"[llama] Speculative ngram: num_pred_tokens={n_pred_tokens}")
        except (ImportError, Exception) as _e:
            _log(f"[llama] Speculative ngram not available ({_e}) — disabled")
    elif speculative_mode == "mtp":
        try:
            from llama_cpp import Llama as _LlamaInner, LlamaDraftModel
            _draft = _LlamaInner(
                model_path=gguf_path, n_ctx=n_ctx, n_gpu_layers=n_gpu,
                n_batch=32, verbose=False,
            )
            llama_kwargs["draft_model"] = LlamaDraftModel(llm=_draft, n_pred=n_pred_tokens)
            _log(f"[llama] Speculative MTP: LlamaDraftModel n_pred={n_pred_tokens}")
        except (ImportError, Exception) as _e:
            _log(f"[llama] MTP draft failed ({_e}), falling back to ngram")
            try:
                from llama_cpp.llama_speculative import LlamaPromptLookupDecoding
                llama_kwargs["draft_model"] = LlamaPromptLookupDecoding(num_pred_tokens=n_pred_tokens)
            except (ImportError, Exception):
                pass
    elif speculative_mode == "draft_model" and draft_model_path:
        try:
            from llama_cpp import Llama as _LlamaInner, LlamaDraftModel
            _draft = _LlamaInner(
                model_path=draft_model_path, n_ctx=n_ctx, n_gpu_layers=n_gpu,
                n_batch=32, verbose=False,
            )
            llama_kwargs["draft_model"] = LlamaDraftModel(llm=_draft, n_pred=n_pred_tokens)
            _log(f"[llama] Speculative draft model: {draft_model_path}")
        except (ImportError, Exception) as _e:
            _log(f"[llama] Draft model failed ({_e})")
    # speculative_mode == "off" → nothing added

    # Vision: load multimodal projector if present
    if mmproj_path and vision_handler:
        try:
            import llama_cpp.llama_chat_format as _fmt
            handler_cls = getattr(_fmt, vision_handler)
            llama_kwargs["chat_handler"] = handler_cls(clip_model_path=mmproj_path, verbose=False)
            _log(f"[llama] Vision handler: {vision_handler} + {mmproj_path}")
        except Exception as e:
            _log(f"[llama] Vision handler load failed ({e}) — falling back to text-only")

    # Multi-GPU tensor split — only for dense models (MoE uses LAYER split, incompatible)
    if tensor_split is not None and not is_moe:
        llama_kwargs["tensor_split"] = tensor_split
        _log(f"[llama] Multi-GPU tensor_split={tensor_split}")
    if main_gpu is not None:
        llama_kwargs["main_gpu"] = main_gpu

    _llm = Llama(**llama_kwargs)

    elapsed = time.time() - start
    _log(f"[llama] Model loaded in {elapsed:.1f}s")

    from backend.services.hf_service import _detect_capabilities
    _caps = _detect_capabilities([], model_id)
    _current_model = ModelInfo(
        id=model_id,
        name=model_id.split("/")[-1],
        downloaded=True,
        loaded=True,
        max_context_window=n_ctx,
        quantization=_detect_quant_from_path(gguf_path),
        capabilities=_caps,
    )
    _load_config = {
        "engine": "llama",
        "n_ctx": n_ctx,
        "n_gpu_layers": n_gpu,
        "n_batch": n_batch,
        "cpu_overflow": cpu_overflow,
        "is_moe": is_moe,
        "offload_kqv": offload_kqv,
        "kv_quant": kv_quant or "q8_0",
        "gguf_path": gguf_path,
        "speculative_mode": speculative_mode,
        "n_pred_tokens": n_pred_tokens,
        "tensor_split": tensor_split,
        "main_gpu": main_gpu,
    }
    logger.info(f"llama model loaded: {model_id} ({elapsed:.1f}s)")


def load_model_async(
    gguf_path: str,
    model_id: str,
    n_ctx: int = 4096,
    gpu_type: str = "nvidia",
    n_gpu_layers_override: int | None = None,
    cpu_overflow: bool = False,
    is_moe: bool = False,
    mmproj_path: Optional[str] = None,
    vision_handler: Optional[str] = None,
    kv_quant: Optional[str] = None,
    offload_kqv: bool = False,
    n_batch_override: int | None = None,
    speculative_mode: str = "off",
    draft_model_path: Optional[str] = None,
    n_pred_tokens: int = 10,
    tensor_split: list[float] | None = None,
    main_gpu: int | None = None,
) -> None:
    """Lance le chargement dans un thread background — retourne immédiatement."""
    global _loading_model_id, _load_error, _eject_requested
    _loading_model_id = model_id
    _load_error = None
    _eject_requested = False

    def _run() -> None:
        global _loading_model_id, _load_error
        try:
            load_model(
                gguf_path, model_id, n_ctx, gpu_type, n_gpu_layers_override,
                cpu_overflow, is_moe, mmproj_path, vision_handler, kv_quant,
                offload_kqv, n_batch_override, speculative_mode, draft_model_path,
                n_pred_tokens, tensor_split, main_gpu,
            )
        except Exception as e:
            if not _eject_requested:
                _load_error = str(e)
                _log(f"[llama] ERROR: {e}")
                logger.error(f"llama async load failed: {e}")
        finally:
            _loading_model_id = None

    threading.Thread(target=_run, daemon=True, name=f"llama-load-{model_id}").start()


def get_load_config() -> Optional[dict]:
    """Return the params used at last successful model load, or None."""
    return _load_config


def unload_model() -> None:
    """Décharge le modèle et libère la VRAM."""
    global _llm, _current_model, _loading_model_id, _eject_requested, _load_config

    _eject_requested = True
    _loading_model_id = None

    with _lock:
        if _llm is not None:
            try:
                # llama_cpp libère automatiquement via __del__ mais on force
                _llm.close() if hasattr(_llm, "close") else None
            except Exception as e:
                logger.warning(f"llama unload warning: {e}")
            finally:
                _llm = None

    _current_model = None
    _load_config = None
    _log("[llama] Model unloaded")
    logger.info("llama model unloaded")

    # Log VRAM après unload pour vérification
    _log_vram_freed()


def _get_free_vram_mb() -> Optional[int]:
    """Return free VRAM in MB from nvidia-smi, or None if unavailable."""
    import subprocess
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return int(result.stdout.strip().split("\n")[0].strip())
    except Exception:
        pass
    return None


def _log_vram_freed() -> None:
    import subprocess
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            used, free = result.stdout.strip().split(",")
            _log(f"[llama] VRAM after unload — used: {used.strip()} MB, free: {free.strip()} MB")
    except Exception:
        pass


# ──────────────────────────────────────────────────────────────────────────────
# State queries
# ──────────────────────────────────────────────────────────────────────────────

def get_status() -> Optional[ModelInfo]:
    return _current_model


def get_load_state() -> dict:
    return {
        "loading_model_id": _loading_model_id,
        "loaded_model_id": _current_model.id if _current_model else None,
        "error": _load_error,
        "engine": "llama",
    }


# ──────────────────────────────────────────────────────────────────────────────
# Generation
# ──────────────────────────────────────────────────────────────────────────────

async def generate(
    messages: list[dict],
    stream: bool = True,
    temperature: float = 0.7,
    max_tokens: int = 2048,
    top_p: float = 0.95,
    top_k: int = -1,
    repetition_penalty: float = 1.1,
    stop: Optional[list[str]] = None,
    # Ces params sont acceptés pour compatibilité avec l'interface vLLM mais ignorés
    presence_penalty: float = 0.0,
    frequency_penalty: float = 0.0,
    **_ignored,
) -> AsyncGenerator:
    """
    Génère une réponse via llama-cpp-python.
    Quand stream=True, yield des chaînes SSE format OpenAI compatible.
    Quand stream=False, yield un seul dict.
    """
    if _llm is None:
        raise RuntimeError("No model loaded")

    # llama-cpp-python est synchrone — on le run dans un executor
    loop = asyncio.get_event_loop()

    top_k_val = top_k if top_k > 0 else 40  # llama.cpp préfère une valeur positive

    common_kwargs = dict(
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
        top_k=top_k_val,
        repeat_penalty=repetition_penalty,
        stop=stop or [],
    )

    if stream:
        # prompt_tokens sera mis à jour depuis le chunk natif llama-cpp (finish_reason)
        prompt_tokens = 0

        # Streaming via thread + queue
        queue: asyncio.Queue = asyncio.Queue()
        completion_tokens = 0
        USAGE_INTERVAL = 10  # envoyer un chunk usage tous les N tokens générés

        def _stream_sync() -> None:
            nonlocal completion_tokens, prompt_tokens

            def _safe_chunks():
                """Yield chunks, falling back to no speculative on numpy shape errors."""
                _kwargs = dict(common_kwargs)
                for _attempt in range(2):
                    try:
                        for c in _llm.create_chat_completion(stream=True, **_kwargs):
                            yield c
                        return
                    except Exception as _spec_err:
                        _msg = str(_spec_err).lower()
                        if _attempt == 0 and ("broadcast" in _msg or "shape" in _msg or "ngram" in _msg):
                            _log(f"[llama] speculative error ({_spec_err}) — retrying without draft model", "warn")
                            if hasattr(_llm, 'draft_model'):
                                _llm.draft_model = None
                            continue
                        raise

            try:
                for chunk in _safe_chunks():  # type: ignore[assignment]
                    if _eject_requested:
                        break
                    choice = chunk.get("choices", [{}])[0]
                    delta = choice.get("delta", {}).get("content", "")
                    finish = choice.get("finish_reason")
                    # Chunk final avec usage natif = source de vérité
                    native_usage = chunk.get("usage")
                    if native_usage:
                        completion_tokens = native_usage.get("completion_tokens", completion_tokens)
                        prompt_tokens = native_usage.get("prompt_tokens", prompt_tokens)
                    if delta:
                        completion_tokens += 1
                        payload = json.dumps({
                            "choices": [{"delta": {"content": delta}, "finish_reason": None}]
                        })
                        asyncio.run_coroutine_threadsafe(queue.put(f"data: {payload}"), loop)
                        # Usage intermédiaire toutes les USAGE_INTERVAL tokens
                        if completion_tokens % USAGE_INTERVAL == 0:
                            usage_payload = json.dumps({
                                "usage": {"completion_tokens": completion_tokens, "prompt_tokens": prompt_tokens}
                            })
                            asyncio.run_coroutine_threadsafe(queue.put(f"data: {usage_payload}"), loop)
                    if finish:
                        _log(f"[llama] finish_reason={finish} | prompt_tokens={prompt_tokens} | completion_tokens={completion_tokens}")
                        # Emit timings from llama_perf_context
                        try:
                            import llama_cpp as _lc
                            perf = _lc.llama_perf_context(_llm._ctx.ctx)
                            t_prompt_ms = perf.t_p_eval_ms
                            t_eval_ms = perf.t_eval_ms
                            n_prompt = perf.n_p_eval
                            n_eval = perf.n_eval
                            prompt_tps = (n_prompt / t_prompt_ms * 1000) if t_prompt_ms > 0 else 0
                            eval_tps = (n_eval / t_eval_ms * 1000) if t_eval_ms > 0 else 0
                            timings_log = (
                                f"prompt eval time = {t_prompt_ms:>10.2f} ms / {n_prompt:>5} tokens"
                                f" ({t_prompt_ms/n_prompt:.2f} ms per token, {prompt_tps:.2f} tokens per second)\n"
                                f"       eval time = {t_eval_ms:>10.2f} ms / {n_eval:>5} tokens"
                                f" ({t_eval_ms/n_eval:.2f} ms per token, {eval_tps:.2f} tokens per second)\n"
                                f"      total time = {(t_prompt_ms+t_eval_ms):>10.2f} ms / {n_prompt+n_eval:>5} tokens"
                            )
                            _log(timings_log)
                            timings_payload = json.dumps({
                                "timings": {
                                    "prompt_ms": round(t_prompt_ms, 2),
                                    "eval_ms": round(t_eval_ms, 2),
                                    "n_prompt": n_prompt,
                                    "n_eval": n_eval,
                                    "prompt_tps": round(prompt_tps, 2),
                                    "eval_tps": round(eval_tps, 2),
                                    "log": timings_log,
                                }
                            })
                            asyncio.run_coroutine_threadsafe(queue.put(f"data: {timings_payload}"), loop)
                        except Exception as _te:
                            _log(f"[llama] timings unavailable: {_te}", "warn")
                        break
            except Exception as e:
                if not _eject_requested:
                    err_str = str(e).lower()
                    is_ctx_exceeded = any(k in err_str for k in (
                        "exceed context", "context window", "kv cache is full",
                        "exceed the maximum", "tokens exceed",
                    ))
                    is_oom = any(k in err_str for k in (
                        "out of memory", "cuda error", "cuda out", "ggml_cuda",
                        "failed to allocate", "memory allocation", "killed",
                    ))
                    if is_ctx_exceeded:
                        current_ctx = _load_config.get("n_ctx", 4096) if _load_config else 4096
                        next_ctx = min(current_ctx * 2, 32768)
                        _log(f"[llama] context exceeded ({current_ctx} tokens) — signaling resize to {next_ctx}", "warn")
                        payload = json.dumps({"error": str(e), "error_type": "ctx_exceeded", "current_ctx": current_ctx, "next_ctx": next_ctx})
                    elif is_oom:
                        _log(f"[llama] OOM detected during generation: {e}")
                        payload = json.dumps({"error": str(e), "error_type": "oom"})
                    else:
                        _log(f"[llama] Error during generation: {e}")
                        payload = json.dumps({"error": str(e), "error_type": "error"})
                    asyncio.run_coroutine_threadsafe(queue.put(f"data: {payload}"), loop)
            finally:
                asyncio.run_coroutine_threadsafe(queue.put(None), loop)  # sentinel

        threading.Thread(target=_stream_sync, daemon=True).start()

        while True:
            item = await queue.get()
            if item is None:
                # Envoyer usage final — prompt_tokens et completion_tokens mis à jour
                # depuis le chunk natif llama-cpp (finish_reason) si disponible
                usage_payload = json.dumps({
                    "usage": {"completion_tokens": completion_tokens, "prompt_tokens": prompt_tokens}
                })
                yield f"data: {usage_payload}"
                break
            yield item

    else:
        def _sync() -> dict:
            return _llm.create_chat_completion(stream=False, **common_kwargs)

        result = await loop.run_in_executor(None, _sync)
        yield result


# ──────────────────────────────────────────────────────────────────────────────
# Tool use
# ──────────────────────────────────────────────────────────────────────────────

async def generate_with_tools(
    messages: list[dict],
    tools: list[dict],
    temperature: float = 0.2,
    max_tokens: int = 8192,
    stop_event: threading.Event | None = None,
    **_ignored,
) -> AsyncGenerator:
    """
    Streaming tool use via llama-cpp-python.

    Yields dicts:
    - {"type": "text_delta", "content": "..."} — streaming text token
    - {"type": "response", "choices": [...]} — final response (tool_calls if any)

    stop_event: when set by caller, the sync thread exits cleanly after the current chunk.
    Used for interleaved tool execution — caller stops the stream, runs the tool,
    then calls generate_with_tools again with the enriched message history.
    """
    if _llm is None:
        raise RuntimeError("No model loaded")

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()
    _stop = stop_event or threading.Event()

    def _stream_sync() -> None:
        has_user = any(m.get("role") == "user" for m in messages)
        if not has_user:
            asyncio.run_coroutine_threadsafe(
                queue.put({"type": "error", "error": "No user message in conversation"}), loop
            )
            asyncio.run_coroutine_threadsafe(queue.put(None), loop)
            return

        accumulated_text = ""
        accumulated_tool_calls: list = []

        try:
            try:
                chunks = _llm.create_chat_completion(
                    messages=messages,
                    tools=tools,
                    tool_choice="auto",
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=True,
                )
            except Exception as tools_err:
                logger.warning(f"[llama] tools streaming failed ({tools_err}), falling back to plain stream")
                chunks = _llm.create_chat_completion(
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=True,
                )

            for chunk in chunks:
                if _eject_requested or _stop.is_set():
                    break
                choice = chunk.get("choices", [{}])[0]
                delta = choice.get("delta", {})

                content = delta.get("content") or ""
                if content:
                    accumulated_text += content
                    asyncio.run_coroutine_threadsafe(
                        queue.put({"type": "text_delta", "content": content}), loop
                    )

                tc_deltas = delta.get("tool_calls")
                if tc_deltas:
                    for tc_delta in tc_deltas:
                        idx = tc_delta.get("index", 0)
                        while len(accumulated_tool_calls) <= idx:
                            accumulated_tool_calls.append(
                                {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
                            )
                        if tc_delta.get("id"):
                            accumulated_tool_calls[idx]["id"] = tc_delta["id"]
                        func = tc_delta.get("function", {})
                        if func.get("name"):
                            accumulated_tool_calls[idx]["function"]["name"] += func["name"]
                        if func.get("arguments"):
                            accumulated_tool_calls[idx]["function"]["arguments"] += func["arguments"]

            # Emit timings
            try:
                import llama_cpp as _lc
                perf = _lc.llama_perf_context(_llm._ctx.ctx)
                t_prompt_ms = perf.t_p_eval_ms
                t_eval_ms = perf.t_eval_ms
                n_prompt = perf.n_p_eval
                n_eval = perf.n_eval
                prompt_tps = (n_prompt / t_prompt_ms * 1000) if t_prompt_ms > 0 else 0
                eval_tps = (n_eval / t_eval_ms * 1000) if t_eval_ms > 0 else 0
                timings_log = (
                    f"prompt eval time = {t_prompt_ms:>10.2f} ms / {n_prompt:>5} tokens"
                    f" ({t_prompt_ms/n_prompt:.2f} ms per token, {prompt_tps:.2f} tokens per second)\n"
                    f"       eval time = {t_eval_ms:>10.2f} ms / {n_eval:>5} tokens"
                    f" ({t_eval_ms/n_eval:.2f} ms per token, {eval_tps:.2f} tokens per second)\n"
                    f"      total time = {(t_prompt_ms+t_eval_ms):>10.2f} ms / {n_prompt+n_eval:>5} tokens"
                )
                _log(timings_log)
                asyncio.run_coroutine_threadsafe(
                    queue.put({"type": "timings", "timings": {
                        "prompt_ms": round(t_prompt_ms, 2), "eval_ms": round(t_eval_ms, 2),
                        "n_prompt": n_prompt, "n_eval": n_eval,
                        "prompt_tps": round(prompt_tps, 2), "eval_tps": round(eval_tps, 2),
                        "log": timings_log,
                    }}), loop
                )
            except Exception as _te:
                _log(f"[llama] timings unavailable: {_te}", "warn")

            final_message: dict = {"role": "assistant", "content": accumulated_text or None}
            if accumulated_tool_calls:
                final_message["tool_calls"] = accumulated_tool_calls
            asyncio.run_coroutine_threadsafe(
                queue.put({"type": "response", "choices": [{"message": final_message}]}), loop
            )

        except Exception as e:
            logger.error(f"[llama] generate_with_tools streaming error: {e}")
            err_str = str(e).lower()
            is_ctx = any(k in err_str for k in ("exceed context", "context window", "kv cache is full", "tokens exceed"))
            if is_ctx:
                current_ctx = _load_config.get("n_ctx", 4096) if _load_config else 4096
                next_ctx = min(current_ctx * 2, 32768)
                asyncio.run_coroutine_threadsafe(queue.put({
                    "type": "error", "error": str(e),
                    "error_type": "ctx_exceeded", "current_ctx": current_ctx, "next_ctx": next_ctx
                }), loop)
            else:
                asyncio.run_coroutine_threadsafe(queue.put({"type": "error", "error": str(e)}), loop)
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(None), loop)

    threading.Thread(target=_stream_sync, daemon=True).start()

    while True:
        item = await queue.get()
        if item is None:
            break
        yield item


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _detect_quant_from_path(gguf_path: str) -> Optional[str]:
    name = Path(gguf_path).stem.upper()
    for q in ("Q4_K_M", "Q5_K_M", "Q4_K_S", "Q5_K_S", "Q8_0", "Q4_0", "Q6_K", "F16"):
        if q in name:
            return q
    return "GGUF"


# ──────────────────────────────────────────────────────────────────────────────
# Cleanup
# ──────────────────────────────────────────────────────────────────────────────

def cleanup() -> None:
    logger.info("llama cleanup — unloading if needed")
    try:
        unload_model()
    except Exception as e:
        logger.error(f"llama cleanup error: {e}")


atexit.register(cleanup)
