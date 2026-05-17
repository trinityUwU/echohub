from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger

from backend.models.schemas import ChatRequest, LoadRequest, ModelInfo
from backend.services import engine_router, hf_service

router = APIRouter(prefix="/inference", tags=["inference"])

def _get_models_dir():
    try:
        from backend.services.config_service import get_models_dir
        return get_models_dir()
    except Exception:
        return Path("/mnt/models/echohub")


def _resolve_model_path(model_id: str) -> str:
    candidate = _get_models_dir() / model_id.replace("/", "--")
    if candidate.exists():
        return str(candidate)
    raise FileNotFoundError(f"Model not found locally: {model_id}")


@router.post("/load")
def load_model(req: LoadRequest) -> dict:
    """Start loading a model asynchronously. Poll /inference/load-state for progress."""
    if engine_router.get_status() is not None:
        raise HTTPException(status_code=409, detail="A model is already loaded. Unload it first.")
    state = engine_router.get_load_state()
    if state.get("loading_model_id") is not None:
        raise HTTPException(status_code=409, detail="A model is already loading.")
    try:
        model_path = _resolve_model_path(req.model_id)
        engine_router.load_model_async(
            model_path=model_path,
            model_id=req.model_id,
            gpu_memory_utilization=req.gpu_memory_utilization if req.gpu_memory_utilization != 0.75 else None,
            max_model_len=req.max_model_len,
            enforce_eager=req.enforce_eager,
            max_cudagraph_capture_size=req.max_cudagraph_capture_size,
            vllm_version=req.vllm_version,
        )
        return {"status": "loading", "model_id": req.model_id}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"load_model failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/load-state")
def get_load_state() -> dict:
    """Poll loading progress. loading_model_id is set while loading, null when done."""
    return engine_router.get_load_state()


@router.post("/unload")
def unload_model() -> dict:
    """Unload the current model and free VRAM."""
    if engine_router.get_status() is None:
        raise HTTPException(status_code=404, detail="No model currently loaded.")
    try:
        engine_router.unload_model()
        return {"status": "unloaded"}
    except Exception as e:
        logger.error(f"unload_model failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status", response_model=Optional[ModelInfo])
def get_status() -> Optional[ModelInfo]:
    """Return the currently loaded model, or null."""
    return engine_router.get_status()


@router.get("/engine")
def get_engine() -> dict:
    """Return which inference engine is currently active."""
    return {
        "engine": engine_router.get_active_engine(),
        "available_engines": _get_available_engines(),
    }


def _get_available_engines() -> list[str]:
    engines = ["llama"]
    if engine_router.is_vllm_available():
        engines.append("vllm")
    return engines


@router.post("/chat")
async def chat(req: ChatRequest):
    """Chat with the loaded model. Supports streaming via SSE."""
    if engine_router.get_status() is None:
        raise HTTPException(status_code=404, detail="No model loaded.")

    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    if req.system_prompt and req.system_prompt.strip():
        messages = [{"role": "system", "content": req.system_prompt}] + messages

    generate_kwargs = dict(
        stream=req.stream,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
        top_p=req.top_p,
        top_k=req.top_k,
        repetition_penalty=req.repetition_penalty,
        presence_penalty=req.presence_penalty,
        frequency_penalty=req.frequency_penalty,
        stop=req.stop,
    )

    if req.stream:
        async def event_stream():
            try:
                async for chunk in engine_router.generate(messages=messages, **generate_kwargs):
                    yield f"{chunk}\n\n"
            except Exception as e:
                logger.error(f"chat stream error: {e}")
                yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    result = None
    async for chunk in engine_router.generate(messages=messages, **generate_kwargs):
        result = chunk
    return result


@router.post("/summarize")
async def summarize_messages(req: ChatRequest) -> dict:
    """Summarize a list of messages into a compact context string."""
    if engine_router.get_status() is None:
        raise HTTPException(status_code=404, detail="No model loaded.")

    messages_text = "\n".join(
        f"{m.role.upper()}: {m.content}" for m in req.messages
    )
    summarize_prompt = [
        {
            "role": "user",
            "content": (
                "Summarize the following conversation concisely. "
                "Preserve all key facts, decisions, and context. "
                "Write in third person, past tense. Be dense and complete.\n\n"
                f"{messages_text}"
            )
        }
    ]
    result = None
    async for chunk in engine_router.generate(
        messages=summarize_prompt,
        stream=False,
        temperature=0.3,
        max_tokens=512,
    ):
        result = chunk

    if not result:
        raise HTTPException(status_code=500, detail="Summarization failed")

    summary = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    return {"summary": summary}


@router.post("/can-load")
def can_load(req: LoadRequest) -> dict:
    """
    Preview what would happen if we load this model.
    Returns engine, estimated VRAM, and whether it's feasible.
    """
    try:
        model_path = _resolve_model_path(req.model_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    fmt = engine_router.detect_format(req.model_id, model_path)
    gpu = engine_router.detect_gpu()
    vllm_ok = engine_router.is_vllm_available()

    if fmt == "gguf":
        engine = "llama"
        feasible = True
        reason = None
    elif gpu["type"] == "nvidia" and vllm_ok:
        engine = "vllm"
        feasible = True
        reason = None
    else:
        engine = "vllm"
        feasible = False
        if gpu["type"] != "nvidia":
            reason = "vLLM requires an NVIDIA GPU"
        else:
            reason = "vLLM not installed — use a GGUF model or install vLLM in .venv-vllm"

    # VRAM estimate
    vram_model_gb = None
    if fmt == "gguf":
        gguf_path = engine_router.find_gguf_file(model_path)
        if gguf_path:
            from pathlib import Path as _P
            size_bytes = _P(gguf_path).stat().st_size
            vram_model_gb = round(size_bytes / (1024 ** 3) * 1.05, 2)  # +5% overhead
    else:
        # vLLM: safetensors size + KV cache estimate
        from pathlib import Path as _P
        st_files = list(_P(model_path).glob("*.safetensors")) if _P(model_path).is_dir() else []
        if st_files:
            total = sum(f.stat().st_size for f in st_files)
            vram_model_gb = round(total / (1024 ** 3) + 1.1, 2)  # +1.1GB CUDA graph overhead

    return {
        "engine": engine,
        "format": fmt,
        "feasible": feasible,
        "reason": reason,
        "vram_estimate_gb": vram_model_gb,
        "gpu_type": gpu["type"],
        "vllm_available": vllm_ok,
    }


@router.websocket("/chat/ws")
async def chat_ws(ws: WebSocket):
    """WebSocket alternative to SSE streaming — same protocol, better for Tauri prod."""
    await ws.accept()
    try:
        req_data = await ws.receive_json()
        req = ChatRequest(**req_data)

        if engine_router.get_status() is None:
            await ws.send_json({"error": "No model loaded"})
            return

        messages = [{"role": m.role, "content": m.content} for m in req.messages]
        if req.system_prompt and req.system_prompt.strip():
            messages = [{"role": "system", "content": req.system_prompt}] + messages

        generate_kwargs = dict(
            stream=True,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            top_p=req.top_p,
            top_k=req.top_k,
            repetition_penalty=req.repetition_penalty,
            presence_penalty=req.presence_penalty,
            frequency_penalty=req.frequency_penalty,
            stop=req.stop,
        )

        async for chunk in engine_router.generate(messages=messages, **generate_kwargs):
            await ws.send_text(chunk)

        await ws.send_json({"done": True})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"chat_ws error: {e}")
        try:
            await ws.send_json({"error": str(e)})
        except Exception:
            pass


@router.post("/benchmark")
async def run_benchmark() -> dict:
    """
    Run a standardized benchmark. Returns full metrics: tok/s, TTFT, prefill/decode speeds,
    engine params (n_ctx, n_batch, flash_attn, gpu_layers, gpu_memory_utilization),
    VRAM used, engine version, prompt info.
    """
    import re as _re
    import time
    import importlib.metadata
    from backend.services import engine_router, gpu_service

    if engine_router.get_status() is None:
        raise HTTPException(status_code=404, detail="No model loaded — load a model first.")

    model = engine_router.get_status()
    active_engine = engine_router.get_active_engine()  # "llama" | "vllm"

    gpu = None
    try:
        gpu = gpu_service.get_gpu_stats()
    except Exception:
        pass

    # VRAM snapshot before bench
    vram_used_mb = gpu.vram_used_mb if gpu else None

    BENCH_PROMPT = (
        "Write a detailed explanation of how transformers work in machine learning, "
        "including attention mechanisms, positional encoding, and training objectives. "
        "Be thorough and technical."
    )
    PROMPT_TOKENS = 35  # approximate — llama.cpp tokenizer not exposed here
    MAX_TOKENS = 200

    messages = [{"role": "system", "content": "/no_think"}, {"role": "user", "content": BENCH_PROMPT}]
    start = time.perf_counter()
    first_token_time = None
    decode_tokens = 0
    thinking_tokens = 0
    generated_text = ""
    in_think_block = False

    try:
        async for chunk in engine_router.generate(
            messages=messages,
            stream=True,
            temperature=0.0,
            max_tokens=MAX_TOKENS,
        ):
            if not chunk:
                continue
            content = ""
            if isinstance(chunk, str) and '"content"' in chunk:
                m = _re.search(r'"content"\s*:\s*"((?:[^"\\]|\\.)*)"', chunk)
                content = m.group(1) if m else ""
            elif isinstance(chunk, dict):
                content = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "") or ""

            if not content:
                continue

            generated_text += content
            if "<think>" in content:
                in_think_block = True
            if "</think>" in content:
                in_think_block = False
                continue
            if in_think_block:
                thinking_tokens += 1
                continue

            if first_token_time is None:
                first_token_time = time.perf_counter()
            decode_tokens += 1
            generated_text += content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Benchmark failed: {e}")

    end = time.perf_counter()

    total_ms = round((end - start) * 1000)
    ttft_ms = round((first_token_time - start) * 1000) if first_token_time else None
    prefill_ms = ttft_ms  # prefill = time to first token
    decode_ms = round((end - (first_token_time or start)) * 1000)
    tok_per_sec = round(decode_tokens / max(decode_ms / 1000, 0.001), 1)
    prefill_tok_per_sec = None  # not meaningful with short benchmark prompt

    # Engine-specific params
    engine_params: dict = {}
    engine_version = "unknown"

    if active_engine == "llama":
        try:
            from backend.services import llama_service
            engine_version = importlib.metadata.version("llama_cpp_python")
            engine_params = {
                "n_ctx": model.max_context_window,
                "n_batch": 512,
                "n_gpu_layers": -1,
                "flash_attn": llama_service._flash_attn_enabled(),
            }
        except Exception:
            pass
    elif active_engine == "vllm":
        try:
            from backend.services import vllm_service
            engine_version = vllm_service._vllm_version()
            engine_params = {
                "max_model_len": model.max_context_window,
                "gpu_memory_utilization": None,  # not stored post-load
                "enforce_eager": False,
            }
        except Exception:
            pass

    gpu_short = (gpu.name.replace("NVIDIA GeForce ", "").replace("AMD Radeon ", "").replace("Apple ", "")) if gpu else "CPU"

    share_lines = [
        f"🔥 {model.name}",
        f"   {tok_per_sec} tok/s decode · {ttft_ms}ms TTFT",
        f"   {decode_tokens} tokens · {total_ms/1000:.1f}s total",
        f"   {gpu_short} · {active_engine} {engine_version}",
        f"   EchoHub — github.com/trinityUwU/echohub",
    ]

    result = {
        # Identity
        "model_id": model.id,
        "model_name": model.name,
        "engine": active_engine,
        "engine_version": engine_version,
        # Timing
        "tokens_generated": decode_tokens,
        "prompt_tokens": PROMPT_TOKENS,
        "tok_per_sec": tok_per_sec,
        "prefill_tok_per_sec": prefill_tok_per_sec,
        "ttft_ms": ttft_ms,
        "prefill_ms": prefill_ms,
        "decode_ms": decode_ms,
        "total_ms": total_ms,
        # Hardware
        "gpu_name": gpu.name if gpu else "CPU",
        "gpu_short": gpu_short,
        "vram_total_gb": round(gpu.vram_total_mb / 1024, 1) if gpu else 0,
        "vram_used_gb": round(vram_used_mb / 1024, 1) if vram_used_mb else None,
        "gpu_util_pct": gpu.gpu_utilization_pct if gpu else None,
        # Engine params
        "engine_params": engine_params,
        # Meta
        "bench_prompt": BENCH_PROMPT,
        "bench_max_tokens": MAX_TOKENS,
        "bench_temperature": 0.0,
        "generated_text": generated_text,
        "thinking_tokens": thinking_tokens if thinking_tokens > 0 else None,
        "timestamp": int(time.time()),
        "share_text": "\n".join(share_lines),
    }
    # Auto-save to DB
    from backend.services.db import save_benchmark
    result["_db_id"] = save_benchmark(result)
    return result


@router.post("/benchmark/run-profiles")
async def run_benchmark_profiles(body: dict):
    """SSE stream — runs multiple benchmark profiles sequentially."""
    import json as _json
    import re as _re
    import time as _time
    import importlib.metadata
    from fastapi.responses import StreamingResponse
    from backend.services import engine_router as _er, gpu_service as _gpu_svc
    from backend.services.db import get_benchmark_profile, save_benchmark

    profile_ids: list[int] = body.get("profile_ids", [])
    if not profile_ids:
        raise HTTPException(status_code=400, detail="profile_ids is required")

    if _er.get_status() is None:
        raise HTTPException(status_code=404, detail="No model loaded")

    async def _stream():
        model = _er.get_status()
        active_engine = _er.get_active_engine()

        try:
            gpu = _gpu_svc.get_gpu_stats()
        except Exception:
            gpu = None

        # Engine version + params
        engine_version = "unknown"
        engine_params = {}
        if active_engine == "llama":
            try:
                from backend.services import llama_service
                engine_version = importlib.metadata.version("llama_cpp_python")
                engine_params = {
                    "n_ctx": model.max_context_window,
                    "n_batch": 512,
                    "n_gpu_layers": -1,
                    "flash_attn": llama_service._flash_attn_enabled(),
                }
            except Exception:
                pass
        elif active_engine == "vllm":
            try:
                from backend.services import vllm_service
                engine_version = vllm_service._vllm_version()
                engine_params = {"max_model_len": model.max_context_window}
            except Exception:
                pass

        gpu_short = (gpu.name.replace("NVIDIA GeForce ", "").replace("AMD Radeon ", "").replace("Apple ", "")) if gpu else "CPU"

        total = len(profile_ids)
        for idx, pid in enumerate(profile_ids):
            profile = get_benchmark_profile(pid)
            if not profile:
                yield f"data: {_json.dumps({'type': 'skip', 'profile_id': pid, 'reason': 'not found'})}\n\n"
                continue

            yield f"data: {_json.dumps({'type': 'start', 'profile_id': pid, 'profile_name': profile['name'], 'index': idx, 'total': total})}\n\n"

            # Disable thinking for benchmark — measures output generation, not reasoning
            messages = [{"role": "system", "content": "/no_think"}, {"role": "user", "content": profile["prompt"]}]
            start = _time.perf_counter()
            first_token_time = None
            decode_tokens = 0
            thinking_tokens = 0
            generated_text = ""
            vram_used_mb = gpu.vram_used_mb if gpu else None
            in_think_block = False

            try:
                async for chunk in _er.generate(
                    messages=messages,
                    stream=True,
                    temperature=float(profile["temperature"]),
                    max_tokens=int(profile["max_tokens"]),
                ):
                    if not chunk:
                        continue
                    content = ""
                    if isinstance(chunk, str) and '"content"' in chunk:
                        m = _re.search(r'"content"\s*:\s*"((?:[^"\\]|\\.)*)"', chunk)
                        content = m.group(1) if m else ""
                    elif isinstance(chunk, dict):
                        content = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "") or ""
                    if not content:
                        continue

                    # Track think blocks — don't count them as output tokens
                    generated_text += content
                    if "<think>" in content:
                        in_think_block = True
                    if "</think>" in content:
                        in_think_block = False
                        continue
                    if in_think_block:
                        thinking_tokens += 1
                        continue

                    if first_token_time is None:
                        first_token_time = _time.perf_counter()
                    decode_tokens += 1
            except Exception as e:
                yield f"data: {_json.dumps({'type': 'error', 'profile_id': pid, 'error': str(e)})}\n\n"
                continue

            end = _time.perf_counter()
            total_ms = round((end - start) * 1000)
            ttft_ms = round((first_token_time - start) * 1000) if first_token_time else None
            decode_ms = round((end - (first_token_time or start)) * 1000)
            tok_per_sec = round(decode_tokens / max(decode_ms / 1000, 0.001), 1)

            share_lines = [
                f"[{profile['name']}] {model.name}",
                f"   {tok_per_sec} tok/s · {ttft_ms}ms TTFT · {decode_tokens} tokens",
                f"   {gpu_short} · {active_engine} {engine_version}",
                f"   EchoHub — github.com/trinityUwU/echohub",
            ]

            result = {
                "model_id": model.id,
                "model_name": model.name,
                "engine": active_engine,
                "engine_version": engine_version,
                "profile_id": pid,
                "profile_name": profile["name"],
                "profile_description": profile["description"],
                "tokens_generated": decode_tokens,
                "prompt_tokens": len(profile["prompt"].split()),
                "tok_per_sec": tok_per_sec,
                "ttft_ms": ttft_ms,
                "decode_ms": decode_ms,
                "total_ms": total_ms,
                "gpu_name": gpu.name if gpu else "CPU",
                "gpu_short": gpu_short,
                "vram_total_gb": round(gpu.vram_total_mb / 1024, 1) if gpu else 0,
                "vram_used_gb": round(vram_used_mb / 1024, 1) if vram_used_mb else None,
                "gpu_util_pct": gpu.gpu_utilization_pct if gpu else None,
                "engine_params": engine_params,
                "bench_prompt": profile["prompt"],
                "bench_max_tokens": profile["max_tokens"],
                "bench_temperature": profile["temperature"],
                "generated_text": generated_text,
                "thinking_tokens": thinking_tokens if thinking_tokens > 0 else None,
                "timestamp": int(_time.time()),
                "share_text": "\n".join(share_lines),
            }
            result["_db_id"] = save_benchmark(result)
            yield f"data: {_json.dumps({'type': 'result', 'profile_id': pid, 'profile_name': profile['name'], 'index': idx, 'total': total, 'result': result})}\n\n"

        yield f"data: {_json.dumps({'type': 'done', 'total': total})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
