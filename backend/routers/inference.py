from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger

from pydantic import BaseModel

from backend.models.schemas import ChatRequest, LoadRequest, ModelInfo
from backend.services import engine_router, hf_service
from backend.services.tool_service import (
    execute_tool,
    get_tools,
    list_workspace_files,
)

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
        if req.gguf_path:
            from pathlib import Path as _Path
            if not _Path(req.gguf_path).exists():
                raise FileNotFoundError(f"GGUF file not found: {req.gguf_path}")
            model_path = req.gguf_path
        else:
            model_path = _resolve_model_path(req.model_id)
        # n_ctx is an alias for max_model_len — prefer n_ctx when explicitly provided
        resolved_ctx = req.n_ctx or req.max_model_len
        engine_router.load_model_async(
            model_path=model_path,
            model_id=req.model_id,
            gpu_memory_utilization=req.gpu_memory_utilization if req.gpu_memory_utilization != 0.75 else None,
            max_model_len=resolved_ctx,
            enforce_eager=req.enforce_eager,
            max_cudagraph_capture_size=req.max_cudagraph_capture_size,
            vllm_version=req.vllm_version,
            n_gpu_layers=req.n_gpu_layers,
            cpu_overflow=req.cpu_overflow,
            is_moe=req.is_moe,
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

    # Detect vision support for the active engine
    _active_model = engine_router.get_status()
    _has_vision = bool(_active_model and getattr(_active_model, "capabilities", None) and _active_model.capabilities.vision)

    # Build messages — filter empty content, strip images if model has no vision
    messages = []
    for m in req.messages:
        content = m.content
        # Skip messages with empty string content
        if isinstance(content, str) and not content.strip():
            continue
        # Skip empty list content
        if isinstance(content, list) and not content:
            continue
        # If model has no vision and content is multimodal, extract text only
        if isinstance(content, list) and not _has_vision:
            text_parts = [p.get("text", "") for p in content if p.get("type") == "text"]
            content = " ".join(text_parts).strip()
            if not content:
                continue
        messages.append({"role": m.role, "content": content})

    if not messages:
        raise HTTPException(status_code=400, detail="No valid messages to send.")

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
            import time as _t, json as _j
            start = _t.perf_counter()
            first_token_time: float | None = None
            token_count = 0
            active_engine = engine_router.get_active_engine()
            model = engine_router.get_status()
            try:
                async for chunk in engine_router.generate(messages=messages, **generate_kwargs):
                    # Track first token for TTFT
                    if first_token_time is None:
                        try:
                            parsed = _j.loads(chunk[6:]) if isinstance(chunk, str) and chunk.startswith("data: ") else None
                            if parsed and parsed.get("choices", [{}])[0].get("delta", {}).get("content"):
                                first_token_time = _t.perf_counter()
                        except Exception:
                            pass
                    token_count += 1
                    yield f"{chunk}\n\n"
            except Exception as e:
                logger.error(f"chat stream error: {e}")
                yield f"data: {_j.dumps({'error': str(e), 'error_type': 'error'})}\n\n"
                return

            end = _t.perf_counter()
            ttft_ms = round((first_token_time - start) * 1000) if first_token_time else None
            total_ms = round((end - start) * 1000)
            model_name = model.name if model else None
            yield f"data: {_j.dumps({'type': 'echohub_stats', 'ttft_ms': ttft_ms, 'total_ms': total_ms, 'engine': active_engine, 'model_name': model_name})}\n\n"

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


class ToolChatRequest(BaseModel):
    messages: list[dict]
    project_id: str
    system_prompt: str = ""
    temperature: float = 0.2
    max_tokens: int = 8192
    stream: bool = True


@router.post("/tool-chat")
async def tool_chat(req: ToolChatRequest):
    """
    Agentic tool-use loop with SSE.
    Streams events: tool_call, tool_result, text chunks, done.
    Max 10 iterations to prevent infinite loops.
    """
    import json as _json

    if engine_router.get_status() is None:
        raise HTTPException(status_code=404, detail="No model loaded.")

    tools = get_tools()
    MAX_ITERATIONS = 10

    async def _event_stream():
        messages: list[dict] = []
        if req.system_prompt and req.system_prompt.strip():
            messages.append({"role": "system", "content": req.system_prompt})
        messages.extend(req.messages)

        for iteration in range(MAX_ITERATIONS):
            # Call the model with tools
            response_dict: dict | None = None
            try:
                async for result in engine_router.generate_with_tools(
                    messages=messages,
                    tools=tools,
                    temperature=req.temperature,
                    max_tokens=req.max_tokens,
                ):
                    response_dict = result
            except Exception as e:
                logger.error(f"[tool-chat] generate_with_tools error: {e}")
                yield f"data: {_json.dumps({'type': 'error', 'error': str(e)})}\n\n"
                return

            if response_dict is None:
                yield f"data: {_json.dumps({'type': 'error', 'error': 'No response from model'})}\n\n"
                return

            choice = response_dict.get("choices", [{}])[0]
            message = choice.get("message", {})
            tool_calls = message.get("tool_calls")

            if tool_calls:
                # Append assistant message with tool_calls for context continuity
                messages.append({
                    "role": "assistant",
                    "content": message.get("content") or "",
                    "tool_calls": tool_calls,
                })

                for tc in tool_calls:
                    tc_id: str = tc.get("id", f"call_{iteration}")
                    func = tc.get("function", {})
                    tool_name: str = func.get("name", "")
                    raw_args: str = func.get("arguments", "{}")

                    try:
                        tool_args: dict = _json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                    except _json.JSONDecodeError:
                        tool_args = {}

                    # Notify client of the tool call
                    yield f"data: {_json.dumps({'type': 'tool_call', 'tool': tool_name, 'args': tool_args})}\n\n"

                    # Execute
                    tool_result: str = execute_tool(tool_name, tool_args, req.project_id)

                    # Notify client of the result
                    yield f"data: {_json.dumps({'type': 'tool_result', 'tool': tool_name, 'result': tool_result})}\n\n"

                    # Inject tool result back into messages
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": tool_result,
                    })

                # Continue loop — model may want to call more tools
                continue

            # No tool_calls → final text answer
            final_text: str = message.get("content") or ""
            if final_text:
                # Stream text as standard SSE content chunks
                chunk_payload = _json.dumps({
                    "choices": [{"delta": {"content": final_text}, "finish_reason": "stop"}]
                })
                yield f"data: {chunk_payload}\n\n"

            break  # done

        else:
            # Hit max iterations without a final text answer
            yield f"data: {_json.dumps({'type': 'error', 'error': 'Max iterations reached without final answer'})}\n\n"
            return

        # Final event with workspace file list
        try:
            files = list_workspace_files(req.project_id)
        except Exception as e:
            logger.warning(f"[tool-chat] list_workspace_files error: {e}")
            files = []
        yield f"data: {_json.dumps({'type': 'done', 'files': files})}\n\n"

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
    all_tokens = 0      # all tokens including thinking — used for tok/s
    thinking_tokens = 0
    output_tokens = 0   # non-thinking tokens
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

            if first_token_time is None:
                first_token_time = time.perf_counter()

            generated_text += content
            all_tokens += 1

            if "<think>" in content:
                in_think_block = True
            if "</think>" in content:
                in_think_block = False
            if in_think_block or "<think>" in content:
                thinking_tokens += 1
            else:
                output_tokens += 1
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Benchmark failed: {e}")

    end = time.perf_counter()

    total_ms = round((end - start) * 1000)
    ttft_ms = round((first_token_time - start) * 1000) if first_token_time else None
    prefill_ms = ttft_ms
    decode_ms = round((end - (first_token_time or start)) * 1000)
    # tok/s based on all tokens (thinking included) — reflects true throughput
    tok_per_sec = round(all_tokens / max(decode_ms / 1000, 0.001), 1) if all_tokens else 0.0
    prefill_tok_per_sec = None
    decode_tokens = all_tokens  # total tokens for display

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
    # Quality scoring
    try:
        from backend.services.quality_scorer import score_response
        profile_name = result.get("profile_name", "throughput")
        quality = score_response(profile_name, BENCH_PROMPT, generated_text)
        result["quality"] = quality
    except Exception as _qe:
        result["quality"] = None
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

            messages = [{"role": "system", "content": "/no_think"}, {"role": "user", "content": profile["prompt"]}]
            start = _time.perf_counter()
            first_token_time = None
            all_tokens = 0
            thinking_tokens = 0
            output_tokens = 0
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

                    if first_token_time is None:
                        first_token_time = _time.perf_counter()

                    generated_text += content
                    all_tokens += 1

                    if "<think>" in content:
                        in_think_block = True
                    if "</think>" in content:
                        in_think_block = False
                    if in_think_block or "<think>" in content:
                        thinking_tokens += 1
                    else:
                        output_tokens += 1
            except Exception as e:
                yield f"data: {_json.dumps({'type': 'error', 'profile_id': pid, 'error': str(e)})}\n\n"
                continue

            end = _time.perf_counter()
            total_ms = round((end - start) * 1000)
            ttft_ms = round((first_token_time - start) * 1000) if first_token_time else None
            decode_ms = round((end - (first_token_time or start)) * 1000)
            tok_per_sec = round(all_tokens / max(decode_ms / 1000, 0.001), 1) if all_tokens else 0.0
            decode_tokens = all_tokens

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
            # Quality scoring
            try:
                from backend.services.quality_scorer import score_response as _score
                quality = _score(profile["name"], profile["prompt"], generated_text)
                result["quality"] = quality
            except Exception:
                result["quality"] = None
            result["_db_id"] = save_benchmark(result)
            yield f"data: {_json.dumps({'type': 'result', 'profile_id': pid, 'profile_name': profile['name'], 'index': idx, 'total': total, 'result': result})}\n\n"

        yield f"data: {_json.dumps({'type': 'done', 'total': total})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
