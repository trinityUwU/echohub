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
    """vLLM tool-use via OpenAI-compatible API. Yields raw SSE lines (streaming)."""
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

    async with httpx.AsyncClient(timeout=300) as client:
        async with client.stream(
            "POST",
            f"{VLLM_BASE_URL}/v1/chat/completions",
            json=payload,
        ) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                logger.error(f"vLLM tools {resp.status_code}: {body.decode(errors='replace')}")
                resp.raise_for_status()
            async for line in resp.aiter_lines():
                if stop_event and stop_event.is_set():
                    break
                if line:
                    yield line
