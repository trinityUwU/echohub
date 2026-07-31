"""
Génération via l'endpoint OpenAI-compatible du process llama-server externe.

Même contrat de sortie que vllm_generate.py pour rester interchangeable dans
engine_router :
  generate(stream=True)  → yield les lignes SSE brutes ("data: {...}")
  generate(stream=False) → yield le dict de réponse complet
  generate_with_tools    → yield {"type": "text_delta"} puis {"type": "response"}
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, Optional

import httpx
from loguru import logger

from backend.services.llama_server_config import LLAMA_SERVER_BASE_URL

_CHAT_URL = f"{LLAMA_SERVER_BASE_URL}/v1/chat/completions"


def _model_id() -> str:
    """Alias servi par llama-server — lu sur le module live pour éviter un import figé."""
    import sys
    svc = sys.modules.get("backend.services.llama_server_service")
    model = getattr(svc, "_current_model", None) if svc else None
    if model is None:
        raise RuntimeError("No model loaded on llama-server")
    return model.id


def _safe_max_tokens(messages: list[dict], max_tokens: int) -> int:
    """Rogne max_tokens pour ne pas dépasser la fenêtre de contexte."""
    import sys
    svc = sys.modules.get("backend.services.llama_server_service")
    model = getattr(svc, "_current_model", None) if svc else None
    ctx = getattr(model, "max_context_window", None) if model else None
    if not ctx:
        return max_tokens
    prompt_chars = sum(len(str(m.get("content", ""))) for m in messages)
    budget = ctx - (prompt_chars // 4 + 64)
    return min(max_tokens, budget) if budget > 0 else 128


def _build_payload(messages: list[dict], stream: bool, temperature: float,
                   max_tokens: int, top_p: float, top_k: int,
                   repetition_penalty: float, presence_penalty: float,
                   frequency_penalty: float, stop: Optional[list[str]]) -> dict:
    payload: dict[str, Any] = {
        "model": _model_id(),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": _safe_max_tokens(messages, max_tokens),
        "top_p": top_p,
        "presence_penalty": presence_penalty,
        "frequency_penalty": frequency_penalty,
        "stream": stream,
    }
    if top_k > 0:
        payload["top_k"] = top_k
    if repetition_penalty and repetition_penalty != 1.0:
        payload["repeat_penalty"] = repetition_penalty
    if stop:
        payload["stop"] = stop
    if stream:
        payload["stream_options"] = {"include_usage": True}
    return payload


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
    **_ignored,
) -> AsyncIterator:
    """Proxy chat completion vers llama-server."""
    payload = _build_payload(messages, stream, temperature, max_tokens, top_p, top_k,
                             repetition_penalty, presence_penalty, frequency_penalty, stop)
    try:
        if stream:
            async for line in _stream_lines(payload):
                yield line
        else:
            async with httpx.AsyncClient(timeout=600) as client:
                resp = await client.post(_CHAT_URL, json=payload)
                if resp.status_code >= 400:
                    logger.error(f"[llama_server] {resp.status_code}: {resp.text[:500]}")
                resp.raise_for_status()
                yield resp.json()
    except httpx.HTTPError as e:
        logger.error(f"[llama_server] generate transport error: {e}")
        raise RuntimeError(f"llama-server unreachable: {e}")


async def _stream_lines(payload: dict) -> AsyncIterator[str]:
    """Yield les lignes SSE brutes renvoyées par llama-server."""
    async with httpx.AsyncClient(timeout=600) as client:
        async with client.stream("POST", _CHAT_URL, json=payload) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                logger.error(f"[llama_server] {resp.status_code}: {body.decode(errors='replace')[:500]}")
                resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line:
                    yield line


async def _parse_tool_stream(resp, stop_event) -> AsyncIterator[dict]:
    """Découpe le flux SSE en text_delta + accumulation des tool_calls."""
    accum: dict[int, dict] = {}
    async for line in resp.aiter_lines():
        if stop_event is not None and stop_event.is_set():
            return
        if not line or not line.startswith("data: "):
            continue
        raw = line[6:].strip()
        if raw == "[DONE]":
            break
        try:
            chunk = json.loads(raw)
        except json.JSONDecodeError:
            continue
        delta = (chunk.get("choices") or [{}])[0].get("delta", {}) or {}
        if delta.get("content"):
            yield {"type": "text_delta", "content": delta["content"]}
        for tc in (delta.get("tool_calls") or []):
            idx = tc.get("index", 0)
            slot = accum.setdefault(idx, {"id": tc.get("id", ""), "type": "function",
                                          "function": {"name": "", "arguments": ""}})
            if tc.get("id"):
                slot["id"] = tc["id"]
            fn = tc.get("function", {}) or {}
            slot["function"]["name"] += fn.get("name") or ""
            slot["function"]["arguments"] += fn.get("arguments") or ""
    if accum:
        yield {"type": "response",
               "choices": [{"message": {"tool_calls": [accum[i] for i in sorted(accum)]}}]}


async def generate_with_tools(
    messages: list[dict],
    tools: list[dict],
    temperature: float = 0.2,
    max_tokens: int = 2048,
    stop_event=None,
    **_ignored,
) -> AsyncIterator[dict]:
    """Tool use via llama-server (--jinja active le parsing natif des tool calls)."""
    payload: dict[str, Any] = {
        "model": _model_id(),
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
        "temperature": temperature,
        "max_tokens": _safe_max_tokens(messages, max_tokens),
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    try:
        async with httpx.AsyncClient(timeout=600) as client:
            async with client.stream("POST", _CHAT_URL, json=payload) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode(errors="replace")
                    logger.error(f"[llama_server] tools {resp.status_code}: {body[:500]}")
                    resp.raise_for_status()
                async for event in _parse_tool_stream(resp, stop_event):
                    yield event
    except httpx.HTTPError as e:
        logger.error(f"[llama_server] generate_with_tools transport error: {e}")
        raise RuntimeError(f"llama-server unreachable: {e}")


def chat_completion_sync(messages: list[dict], tools: list[dict],
                         temperature: float = 0.1, max_tokens: int = 2048,
                         **_ignored) -> Optional[dict]:
    """Appel bloquant non-streamé, pour les sous-agents."""
    payload = {"model": _model_id(), "messages": messages, "tools": tools,
               "tool_choice": "auto", "temperature": temperature,
               "max_tokens": _safe_max_tokens(messages, max_tokens), "stream": False}
    try:
        resp = httpx.post(_CHAT_URL, json=payload, timeout=600)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.error(f"[llama_server] chat_completion_sync failed: {e}")
        return None
