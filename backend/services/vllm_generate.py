"""
vllm_generate.py — Generation functions (chat completions, tool-use) via vLLM OpenAI-compatible API.
Imported by vllm_service.py and re-exported for backward compat.
"""
from typing import Optional

import httpx
from loguru import logger

VLLM_BASE_URL = "http://127.0.0.1:37823"


def _model():
    """Always read _current_model from the live vllm_service module."""
    import sys
    vs = sys.modules.get("backend.services.vllm_service")
    if vs is None:
        import backend.services.vllm_service as _vs
        vs = _vs
    return vs._current_model


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
    current_model = _model()
    if current_model is None:
        raise RuntimeError("No model loaded")

    # Ask vLLM what model name it's actually serving (path vs HF id depends on version)
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{VLLM_BASE_URL}/v1/models")
            actual_model_id = r.json()["data"][0]["id"]
    except Exception:
        actual_model_id = current_model.id

    # Clip max_tokens to avoid vLLM 400 when prompt + max_tokens > max_model_len
    safe_max_tokens = max_tokens
    if current_model.max_context_window:
        prompt_chars = sum(len(str(m.get("content", ""))) for m in messages)
        estimated_prompt_tokens = prompt_chars // 4 + 64
        budget = current_model.max_context_window - estimated_prompt_tokens
        if budget > 0:
            safe_max_tokens = min(max_tokens, budget)
        else:
            safe_max_tokens = 128

    payload: dict = {
        "model": actual_model_id,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": safe_max_tokens,
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
                if resp.status_code >= 400:
                    body = await resp.aread()
                    logger.error(f"vLLM {resp.status_code}: {body.decode(errors='replace')} | payload_msgs={[m['role'] for m in payload.get('messages', [])]}")
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
            if resp.status_code >= 400:
                logger.error(f"vLLM {resp.status_code}: {resp.text} | payload_msgs={[m['role'] for m in payload.get('messages', [])]}")
            resp.raise_for_status()
            yield resp.json()


async def generate_with_tools(
    messages: list[dict],
    tools: list[dict],
    temperature: float = 0.2,
    max_tokens: int = 2048,
    stop_event=None,
    **kwargs,
):
    """vLLM tool-use. Yields structured dicts compatible with tool-chat handler.

    text_delta  → {"type": "text_delta", "content": str}
    tool calls  → {"type": "response", "choices": [{"message": {"tool_calls": [...]}}]}
    """
    import json as _json
    current_model = _model()
    if current_model is None:
        raise RuntimeError("No model loaded")

    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{VLLM_BASE_URL}/v1/models")
            actual_model_id = r.json()["data"][0]["id"]
    except Exception:
        actual_model_id = current_model.id

    safe_max_tokens = max_tokens
    if current_model.max_context_window:
        prompt_chars = sum(len(str(m.get("content", ""))) for m in messages)
        estimated_prompt_tokens = prompt_chars // 4 + 64
        budget = current_model.max_context_window - estimated_prompt_tokens
        safe_max_tokens = min(max_tokens, budget) if budget > 0 else 128

    payload: dict = {
        "model": actual_model_id,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "temperature": temperature,
        "max_tokens": safe_max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }

    # Accumulate tool call deltas (vLLM streams them incrementally)
    tc_accum: dict[int, dict] = {}

    async def _stream_and_parse(stream_resp) -> None:  # type: ignore[type-arg]
        async for line in stream_resp.aiter_lines():
            if stop_event and stop_event.is_set():
                return
            if not line or not line.startswith("data: "):
                continue
            raw = line[6:].strip()
            if raw == "[DONE]":
                # Flush any accumulated tool calls
                if tc_accum:
                    tc_list = [tc_accum[i] for i in sorted(tc_accum)]
                    yield {"type": "response", "choices": [{"message": {"tool_calls": tc_list}}]}
                return
            try:
                chunk = _json.loads(raw)
            except _json.JSONDecodeError:
                continue
            choice = (chunk.get("choices") or [{}])[0]
            delta = choice.get("delta", {})
            content = delta.get("content") or ""
            if content:
                yield {"type": "text_delta", "content": content}
            # Accumulate tool call fragments
            for tc_delta in (delta.get("tool_calls") or []):
                idx = tc_delta.get("index", 0)
                if idx not in tc_accum:
                    tc_accum[idx] = {"id": tc_delta.get("id", ""), "type": "function",
                                     "function": {"name": "", "arguments": ""}}
                fn = tc_delta.get("function", {})
                if fn.get("name"):
                    tc_accum[idx]["function"]["name"] += fn["name"]
                if fn.get("arguments"):
                    tc_accum[idx]["function"]["arguments"] += fn["arguments"]

    async with httpx.AsyncClient(timeout=300) as client:
        async with client.stream("POST", f"{VLLM_BASE_URL}/v1/chat/completions", json=payload) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                err_text = body.decode(errors="replace")
                if resp.status_code == 400 and "tool choice" in err_text.lower():
                    logger.warning("vLLM tool choice not enabled — falling back to plain chat")
                    plain = {k: v for k, v in payload.items() if k not in ("tools", "tool_choice")}
                    async with client.stream("POST", f"{VLLM_BASE_URL}/v1/chat/completions", json=plain) as r2:
                        r2.raise_for_status()
                        async for ev in _stream_and_parse(r2):
                            yield ev
                    return
                logger.error(f"vLLM tools {resp.status_code}: {err_text}")
                resp.raise_for_status()
            async for ev in _stream_and_parse(resp):
                yield ev
