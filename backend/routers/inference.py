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
            kv_quant=req.kv_quant,
            offload_kqv=req.offload_kqv,
            n_batch=req.n_batch,
            tensor_parallel_size=req.tensor_parallel_size,
            pipeline_parallel_size=req.pipeline_parallel_size,
            tensor_split=req.tensor_split,
            main_gpu=req.main_gpu,
            speculative_mode=req.speculative_mode,
            draft_model_path=req.draft_model_path,
            n_pred_tokens=req.n_pred_tokens,
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


@router.get("/llama/mtp-support")
def check_mtp_support(model_id: str) -> dict:
    """Check if a downloaded GGUF has MTP prediction heads (Qwen3, DeepSeek-V3 style)."""
    try:
        model_path = _resolve_model_path(model_id)
        from backend.services.engine_router import find_gguf_file
        gguf_path = find_gguf_file(model_path)
        if not gguf_path:
            return {"mtp_supported": False, "model_id": model_id}
        from backend.services.llama_service import detect_mtp_support
        return {"mtp_supported": detect_mtp_support(gguf_path), "model_id": model_id}
    except Exception:
        return {"mtp_supported": False, "model_id": model_id}


@router.get("/llama/capabilities")
def get_llama_capabilities() -> dict:
    """Return which llama-cpp-python optional features are available in the current install."""
    caps: dict = {}
    try:
        import llama_cpp
        caps["version"] = getattr(llama_cpp, "__version__", "unknown")
    except ImportError:
        return {"version": None, "ngram": False, "mtp": False, "draft_model": False}

    try:
        from llama_cpp.llama_speculative import LlamaPromptLookupDecoding  # noqa: F401
        caps["ngram"] = True
    except ImportError:
        caps["ngram"] = False

    try:
        from llama_cpp import LlamaDraftModel  # noqa: F401
        caps["mtp"] = True
        caps["draft_model"] = True
    except ImportError:
        caps["mtp"] = False
        caps["draft_model"] = False

    return caps


@router.get("/multi-gpu-config")
def get_multi_gpu_config_endpoint() -> dict:
    """Retourne la config multi-GPU détectée : gpu_count, gpus, tensor_split suggéré."""
    from backend.services.multi_gpu import get_multi_gpu_config
    return get_multi_gpu_config()


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
                "Summarize the following conversation in maximum 400 tokens. "
                "Be extremely dense: preserve all technical decisions, file names, errors encountered, "
                "tools used, and current state of the work. Write in third person, past tense. "
                "No fluff — every word must carry information.\n\n"
                f"{messages_text}"
            )
        }
    ]
    result = None
    async for chunk in engine_router.generate(
        messages=summarize_prompt,
        stream=False,
        temperature=0.2,
        max_tokens=400,
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
    conv_id: str = "global"
    project_mode: str = ""   # "dev" | "docs" | "research" | "" (chat normal)
    system_prompt: str = ""
    temperature: float = 0.2
    max_tokens: int = 8192
    stream: bool = True
    enabled_tools: list[str] | None = None
    awareness_block: str | None = None


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

    tools = get_tools(req.enabled_tools)
    _mcp_awareness_blocks: list[str] = []
    # Inject tools from running MCP servers + collect their awareness blocks
    try:
        from backend.services.mcp_client import get_mcp_tools_definitions
        from backend.services.db import get_running_mcp_servers
        from backend.routers.skills import _load_registry
        mcp_tools = await get_mcp_tools_definitions()
        if mcp_tools:
            tools = tools + mcp_tools
            logger.info(f"[tool-chat] injected {len(mcp_tools)} MCP tool(s) from running servers")
        # Collect awareness blocks from running MCP server registry entries
        running_ids = {s["skill_id"] for s in get_running_mcp_servers()}
        if running_ids:
            registry = _load_registry()
            for entry in registry:
                if entry.get("id") in running_ids and entry.get("awareness", "").strip():
                    _mcp_awareness_blocks.append(entry["awareness"].strip())
    except Exception as _mcp_err:
        logger.debug(f"[tool-chat] MCP tools injection skipped: {_mcp_err}")
    MAX_ITERATIONS = 40  # generous — model decides when it's done; we warn at threshold

    async def _event_stream():
        import re as _re
        import time as _time
        _start = _time.perf_counter()
        _first_token_time: float | None = None
        _token_count = 0
        _active_engine = engine_router.get_active_engine()
        _model_status = engine_router.get_status()
        messages: list[dict] = []
        _SYNTHESIS_PROMPT = (
            "You have reached the tool call limit. Stop all research immediately. "
            "Based on everything you have gathered so far, write a complete, well-structured final answer. "
            "Do not call any more tools. Synthesize all findings now."
        )
        _DEV_SYSTEM_PROMPT = (
            "You are a coding assistant in Dev mode. You have tools to read and write files and run commands.\n\n"
            "RULES:\n"
            "- Respond ONLY to the current USER message. Never generate fake examples, past conversations, or demo outputs.\n"
            "- Use tools to create/edit files. Never output code in markdown blocks.\n"
            "- After creating or editing code, validate with run_command (python3 -m py_compile for Python, node --check for JS).\n"
            "- If a tool returns an error, fix it immediately before continuing.\n"
            "- End with a 1-2 sentence summary. No code blocks in the summary."
        )
        user_system = (req.system_prompt or "").strip()
        # Merge awareness from: frontend skills toggles + running MCP servers
        skill_awareness = (req.awareness_block or "").strip()
        all_awareness_parts = [p for p in [skill_awareness] + _mcp_awareness_blocks if p]
        awareness = "\n".join(all_awareness_parts)
        _DOCS_SYSTEM_PROMPT = (
            "You are a document analysis assistant. You help read, summarize, analyze, and extract "
            "information from documents and files in the workspace.\n\n"
            "RULES:\n"
            "- Use read_file and list_files to access documents. Never invent file content.\n"
            "- Cite the source file and section when referencing document content.\n"
            "- Be precise and factual. Flag uncertainty explicitly."
        )
        _RESEARCH_SYSTEM_PROMPT = (
            "You are a research assistant with access to web search and browsing tools.\n\n"
            "RULES:\n"
            "- Use web_search to find sources, fetch_url to read them.\n"
            "- Always verify claims with at least one source before stating them as facts.\n"
            "- Cite URLs for all factual claims.\n"
            "- Synthesize findings into a clear, structured answer."
        )

        # Select base system prompt by project mode
        _mode = req.project_mode or ""
        if _mode == "dev":
            base_system = _DEV_SYSTEM_PROMPT
        elif _mode == "docs":
            base_system = _DOCS_SYSTEM_PROMPT
        elif _mode == "research":
            base_system = _RESEARCH_SYSTEM_PROMPT
        else:
            # Chat normal — dev prompt si fs tools actifs, sinon assistant généraliste
            _fs_tools = {"create_file", "edit_file", "read_file", "delete_file", "list_files",
                         "get_workspace_info", "run_command"}
            _active_tools = set(req.enabled_tools or [t["function"]["name"] for t in tools])
            base_system = _DEV_SYSTEM_PROMPT if (_active_tools & _fs_tools) else "You are a helpful assistant."

        combined_system = base_system
        if awareness:
            combined_system += f"\n\n---\nACTIVE SKILLS:\n{awareness}"
        if user_system:
            combined_system += f"\n\n---\nADDITIONAL INSTRUCTIONS:\n{user_system}"

        # Inject docs context files (Docs mode)
        if _mode == "docs" and req.project_id:
            try:
                from backend.services import db as _db
                ctx_files = _db.get_all_context_files_content(req.project_id)
                if ctx_files:
                    blocks = "\n\n".join(
                        f"[FILE: {f['filename']}]\n{f['content'][:8000]}"
                        for f in ctx_files
                    )
                    combined_system += f"\n\n---\nCONTEXT DOCUMENTS:\n{blocks}"
            except Exception as _e:
                logger.warning("Failed to inject context files: {}", _e)

        # Inject research sources (Research mode)
        if _mode == "research" and req.project_id:
            try:
                from backend.services import db as _db
                sources = _db.get_all_sources_content(req.project_id)
                if sources:
                    blocks = "\n\n".join(
                        f"[SOURCE: {s['label']}{(' — ' + s['url']) if s.get('url') else ''}]\n{s['content'][:8000]}"
                        for s in sources
                    )
                    combined_system += f"\n\n---\nRESEARCH SOURCES:\n{blocks}"
            except Exception as _e:
                logger.warning("Failed to inject research sources: {}", _e)

        messages.append({"role": "system", "content": combined_system})

        # Inject memory context if memory is enabled for this conversation
        if req.conv_id and req.conv_id != "global":
            try:
                from backend.services.conversation_manager import get_conversation
                from backend.services import memory_service as _ms
                conv_data = get_conversation(req.conv_id)
                if conv_data and conv_data.get("memory_enabled"):
                    last_user_msg = next(
                        (m.get("content", "") for m in reversed(req.messages) if m.get("role") == "user"),
                        "",
                    )
                    if isinstance(last_user_msg, list):
                        last_user_msg = " ".join(
                            p.get("text", "") for p in last_user_msg if isinstance(p, dict)
                        )
                    memories = _ms.search(query=str(last_user_msg)[:300], limit=5)
                    if memories:
                        mem_block = "\n".join(
                            f"[{m.type}] (importance={m.importance}) {m.content}"
                            for m in memories
                        )
                        combined_system += (
                            "\n\n---\nMEMORY CONTEXT (from your persistent knowledge base):\n"
                            + mem_block
                            + "\n\nYou can use search_memory, store_memory, and invoke_agent tools. "
                            "Store important new facts the user shares. Search memory before answering "
                            "questions about past decisions or preferences."
                        )
                    else:
                        combined_system += (
                            "\n\n---\nMemory is enabled for this conversation. "
                            "Use store_memory to save important facts, "
                            "search_memory to retrieve past knowledge, "
                            "and invoke_agent to delegate subtasks."
                        )
            except Exception as _me:
                logger.debug("[tool-chat] memory inject failed: {}", _me)

        # Update combined_system in messages after memory injection
        # (re-assign the last system message we appended above)
        messages[-1]["content"] = combined_system

        # Filter out empty messages — llama.cpp crashes on empty assistant content
        for m in req.messages:
            role: str = m.get("role", "")
            content = m.get("content", "")
            tool_calls = m.get("tool_calls")

            if role == "tool":
                # Always keep tool results
                messages.append(m)
            elif role in ("user", "system"):
                if isinstance(content, str) and content.strip():
                    messages.append(m)
                elif isinstance(content, list) and content:
                    messages.append(m)
            elif role == "assistant":
                has_content = isinstance(content, str) and content.strip()
                has_tool_calls = bool(tool_calls)
                if has_content or has_tool_calls:
                    messages.append(m)

        # Require at least one user message
        if not any(m.get("role") == "user" for m in messages):
            yield f"data: {_json.dumps({'type': 'error', 'error': 'No user message in conversation'})}\n\n"
            return

        import threading as _threading

        # Interleaved streaming: detect <tool_call>...</tool_call> token-by-token,
        # interrupt the generation, execute the tool immediately, inject the result,
        # and resume generation — all while streaming live to the client.
        _TC_OPEN = "<tool_call>"
        _TC_CLOSE = "</tool_call>"
        _TC_JSON_RE = _re.compile(r"\{.*\}", _re.DOTALL)

        total_tool_calls = 0
        MAX_TOOL_CALLS = 60  # model can raise this via set_tool_limit tool
        ABSOLUTE_CAP = 300   # hard ceiling the model cannot exceed
        WARN_THRESHOLD = 2
        _total_text_len = 0
        _cap_warning_injected = False
        # Context budget: warn at 75%, hard-stop at 92% to leave room for a final answer
        _ctx_window = (_model_status.max_context_window if _model_status and _model_status.max_context_window else 4096)
        _CTX_WARN_PCT = 0.75
        _CTX_STOP_PCT = 0.92
        _context_exhausted = False

        def _estimate_tokens(msgs: list) -> int:
            return sum(len(str(m.get("content", ""))) for m in msgs) // 4

        def _context_footer(msgs: list) -> str:
            used = _estimate_tokens(msgs)
            pct = used / _ctx_window
            remaining = _ctx_window - used
            if pct >= _CTX_WARN_PCT:
                return (
                    f"\n\n[CONTEXT BUDGET: {used:,}/{_ctx_window:,} tokens used ({pct:.0%}). "
                    f"Only {remaining:,} tokens remaining. "
                    f"STOP all research immediately — synthesize your findings and give a final answer now.]"
                )
            return f"\n\n[Context: {used:,}/{_ctx_window:,} tokens ({pct:.0%} used)]"

        async def _execute_tool_with_intercept(tool_name: str, tool_args: dict) -> str:
            nonlocal MAX_TOOL_CALLS, _cap_warning_injected, _context_exhausted
            if _context_exhausted:
                return "[BLOCKED: context window exhausted. You must stop tool calls and give your final answer now.]"
            if tool_name == "set_tool_limit":
                new_limit = int(tool_args.get("new_limit", 0))
                reason = str(tool_args.get("reason", ""))
                if new_limit <= MAX_TOOL_CALLS:
                    return f"Error: new_limit ({new_limit}) must be greater than current limit ({MAX_TOOL_CALLS})."
                if new_limit > ABSOLUTE_CAP:
                    return f"Error: new_limit ({new_limit}) exceeds the absolute maximum ({ABSOLUTE_CAP})."
                old = MAX_TOOL_CALLS
                MAX_TOOL_CALLS = new_limit
                _cap_warning_injected = False
                logger.info(f"[tool-chat] set_tool_limit {old} → {new_limit} (reason: {reason})")
                return f"Tool limit updated: {old} → {new_limit}. Reason recorded: {reason}"
            # Route MCP tools directly
            try:
                from backend.services.mcp_client import is_mcp_tool, call_mcp_tool
                is_mcp, skill_id = is_mcp_tool(tool_name, req.project_id)
                if is_mcp and skill_id:
                    logger.info(f"[tool-chat] routing {tool_name!r} → MCP server {skill_id!r}")
                    import asyncio as _asyncio
                    try:
                        mcp_result = await _asyncio.wait_for(
                            call_mcp_tool(skill_id, tool_name, tool_args),
                            timeout=60.0,
                        )
                    except _asyncio.TimeoutError:
                        mcp_result = f"Error: MCP tool '{tool_name}' timed out after 60s"
                    mcp_result += _context_footer(messages)
                    if _estimate_tokens(messages) / _ctx_window >= _CTX_STOP_PCT:
                        _context_exhausted = True
                        mcp_result += "\n\n[HARD STOP: context window at 92%+. No more tool calls allowed. Summarize now.]"
                    return mcp_result
            except ImportError:
                pass
            except Exception as e:
                logger.warning(f"[tool-chat] MCP routing check failed: {e}")
            result = execute_tool(tool_name, tool_args, req.project_id, req.conv_id)
            result += _context_footer(messages)
            if _estimate_tokens(messages) / _ctx_window >= _CTX_STOP_PCT:
                _context_exhausted = True
                result += "\n\n[HARD STOP: context window at 92%+. No more tool calls allowed. Summarize now.]"
            return result

        def _maybe_inject_cap_warning() -> None:
            nonlocal _cap_warning_injected
            remaining = MAX_TOOL_CALLS - total_tool_calls
            if remaining <= WARN_THRESHOLD and not _cap_warning_injected:
                _cap_warning_injected = True
                messages.append({
                    "role": "system",
                    "content": (
                        f"[System] You have used {total_tool_calls} tool calls and have {remaining} remaining. "
                        f"If your task is not complete and you need more tool calls, call set_tool_limit NOW with a higher value and a clear reason before continuing. "
                        f"If your task is complete or nearly complete, finish it without requesting more calls."
                    ),
                })

        # Track the current turn's full assistant text for history injection
        turn_assistant_text = ""

        for iteration in range(MAX_ITERATIONS):
            stop_event = _threading.Event()
            accumulated_buf = ""       # running buffer for current generation pass
            in_tool_call = False       # currently inside <tool_call>...</tool_call>
            tool_call_buf = ""         # accumulates content inside <tool_call>
            tool_executed_this_pass = False
            pass_text = ""             # text emitted to client this pass (no tool_call tags)

            try:
                async for event in engine_router.generate_with_tools(
                    messages=messages,
                    tools=tools,
                    temperature=req.temperature,
                    max_tokens=req.max_tokens,
                    stop_event=stop_event,
                ):
                    if isinstance(event, dict) and event.get("type") == "error":
                        yield f"data: {_json.dumps({'type': 'error', 'error': event.get('error', 'Unknown error')})}\n\n"
                        return

                    if isinstance(event, dict) and event.get("type") == "timings":
                        yield f"data: {_json.dumps({'timings': event['timings']})}\n\n"
                        continue

                    if not isinstance(event, dict) or event.get("type") not in ("text_delta", "response"):
                        continue

                    if event.get("type") == "response":
                        # Structured tool_calls from llama.cpp native API
                        tool_calls_native = (event.get("choices", [{}])[0]
                                             .get("message", {})
                                             .get("tool_calls")) or []
                        if tool_calls_native and not tool_executed_this_pass:
                            for tc in tool_calls_native:
                                total_tool_calls += 1
                                _maybe_inject_cap_warning()
                                if total_tool_calls >= MAX_TOOL_CALLS:
                                    break
                                func = tc.get("function", {})
                                tool_name = func.get("name", "")
                                raw_args = func.get("arguments", "{}")
                                try:
                                    tool_args = _json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                                except _json.JSONDecodeError:
                                    tool_args = {}
                                tc_id = tc.get("id", f"native_{iteration}_{total_tool_calls}")

                                yield f"data: {_json.dumps({'type': 'tool_call', 'tool': tool_name, 'args': tool_args})}\n\n"
                                tool_result = await _execute_tool_with_intercept(tool_name, tool_args)
                                yield f"data: {_json.dumps({'type': 'tool_result', 'tool': tool_name, 'result': tool_result})}\n\n"

                                messages.append({"role": "assistant", "content": pass_text or "", "tool_calls": [tc]})
                                messages.append({"role": "tool", "tool_call_id": tc_id, "content": tool_result})
                                tool_executed_this_pass = True
                        continue

                    # text_delta — the interesting path
                    content = event.get("content", "")
                    if not content:
                        continue

                    if _first_token_time is None:
                        _first_token_time = _time.perf_counter()

                    accumulated_buf += content

                    if not in_tool_call:
                        # Check if accumulated_buf now contains a <tool_call> opening tag
                        open_pos = accumulated_buf.find(_TC_OPEN, len(pass_text))
                        if open_pos == -1:
                            # No tag found — emit everything except the last 10 chars (guard zone)
                            # to safely detect a tag that may span multiple chunks
                            GUARD = len(_TC_OPEN) - 1  # 10
                            safe_until = max(len(pass_text), len(accumulated_buf) - GUARD)
                            to_emit = accumulated_buf[len(pass_text):safe_until]
                            if to_emit:
                                _total_text_len += len(to_emit)
                                pass_text += to_emit
                                turn_assistant_text += to_emit
                                chunk_evt = _json.dumps({"type": "text_chunk", "content": to_emit})
                                yield f"data: {chunk_evt}\n\n"
                        else:
                            # Found <tool_call> — emit text before it, then enter tool_call mode
                            to_emit = accumulated_buf[len(pass_text):open_pos]
                            if to_emit:
                                _total_text_len += len(to_emit)
                                pass_text += to_emit
                                turn_assistant_text += to_emit
                                chunk_evt = _json.dumps({"type": "text_chunk", "content": to_emit})
                                yield f"data: {chunk_evt}\n\n"
                            in_tool_call = True
                            tool_call_buf = accumulated_buf[open_pos + len(_TC_OPEN):]
                    else:
                        # Inside a tool_call — stream JSON content live to client
                        tool_call_buf += content
                        # Emit the raw token so frontend can show it in real-time inside the tool block
                        tc_live_evt = _json.dumps({"type": "tool_call_streaming", "content": content})
                        yield f"data: {tc_live_evt}\n\n"
                        # Check if we have the closing tag
                        close_pos = tool_call_buf.find(_TC_CLOSE)
                        if close_pos != -1:
                            raw_tc_content = tool_call_buf[:close_pos]
                            tool_call_buf = ""
                            in_tool_call = False

                            tc_json_match = _TC_JSON_RE.search(raw_tc_content)
                            if tc_json_match:
                                try:
                                    tc_data = _json.loads(tc_json_match.group())
                                    tool_name = tc_data.get("name", "")
                                    raw_args = tc_data.get("arguments", tc_data.get("args", {}))
                                    tool_args = _json.loads(raw_args) if isinstance(raw_args, str) else raw_args

                                    total_tool_calls += 1
                                    _maybe_inject_cap_warning()
                                    if total_tool_calls >= MAX_TOOL_CALLS:
                                        stop_event.set()
                                        messages.append({"role": "user", "content": _SYNTHESIS_PROMPT})
                                        tool_executed_this_pass = True
                                        break

                                    stop_event.set()

                                    yield f"data: {_json.dumps({'type': 'tool_call', 'tool': tool_name, 'args': tool_args})}\n\n"
                                    tool_result = await _execute_tool_with_intercept(tool_name, tool_args)
                                    yield f"data: {_json.dumps({'type': 'tool_result', 'tool': tool_name, 'result': tool_result})}\n\n"

                                    tc_id = f"tc_{iteration}_{total_tool_calls}"
                                    messages.append({
                                        "role": "assistant",
                                        "content": pass_text or "",
                                        "tool_calls": [{
                                            "id": tc_id,
                                            "type": "function",
                                            "function": {
                                                "name": tool_name,
                                                "arguments": _json.dumps(tool_args),
                                            },
                                        }],
                                    })
                                    messages.append({"role": "tool", "tool_call_id": tc_id, "content": tool_result})
                                    tool_executed_this_pass = True
                                    pass_text = ""  # reset for next pass
                                except (_json.JSONDecodeError, Exception) as parse_err:
                                    logger.warning(f"[tool-chat] failed to parse inline tool_call: {parse_err}")

            except Exception as e:
                logger.error(f"[tool-chat] generate error: {e}")
                yield f"data: {_json.dumps({'type': 'error', 'error': str(e)})}\n\n"
                return

            if tool_executed_this_pass:
                # Tool was executed mid-stream — loop back to let the model continue
                continue

            # No tool calls — pure text response, we're done
            if pass_text or accumulated_buf:
                # Emit any remaining buffered text not yet sent
                already = len(pass_text)
                tail = accumulated_buf[already:]
                # Strip any incomplete <tool_call> at the end (model cut off)
                if _TC_OPEN in tail and _TC_CLOSE not in tail:
                    tail = tail[:tail.rfind(_TC_OPEN)].rstrip()
                if tail:
                    _total_text_len += len(tail)
                    pass_text += tail
                    turn_assistant_text += tail
                    chunk_evt = _json.dumps({"type": "text_chunk", "content": tail})
                    yield f"data: {chunk_evt}\n\n"
            messages.append({"role": "assistant", "content": turn_assistant_text})
            break

        else:
            # MAX_ITERATIONS exhausted — inject synthesis prompt and do one final pass
            messages.append({"role": "user", "content": _SYNTHESIS_PROMPT})
            async for _chunk in engine_router.generate(
                messages=messages,
                max_tokens=req.max_tokens,
                temperature=req.temperature,
                stream=True,
            ):
                if isinstance(_chunk, dict):
                    _c = _chunk.get("content") or _chunk.get("text") or ""
                else:
                    _c = str(_chunk)
                if _c:
                    yield f"data: {_json.dumps({'type': 'text_chunk', 'content': _c})}\n\n"

        # Always emit done with workspace file list — even after errors/loops
        try:
            files = list_workspace_files(req.project_id)
        except Exception as e:
            logger.warning(f"[tool-chat] list_workspace_files error: {e}")
            files = []
        _end = _time.perf_counter()
        _total_ms = round((_end - _start) * 1000)
        _ttft_ms = round((_first_token_time - _start) * 1000) if _first_token_time else None
        _estimated_tokens = max(1, _total_text_len // 4)
        _decode_ms = max(_total_ms - (_ttft_ms or 0), 1)
        _tok_per_sec = round(_estimated_tokens / (_decode_ms / 1000), 1) if _estimated_tokens else 0.0
        _model_name = _model_status.name if _model_status else None
        yield f"data: {_json.dumps({'type': 'done', 'files': files, 'tokens_generated': _estimated_tokens, 'tok_per_sec': _tok_per_sec, 'ttft_ms': _ttft_ms, 'total_ms': _total_ms, 'engine': _active_engine, 'model_name': _model_name})}\n\n"

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
