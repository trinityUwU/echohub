# OpenAI-compatible /v1/chat/completions — proxifie vers l'engine actif (llama.cpp ou vLLM)
# EchoCode tape sur cet endpoint via vllmToolsBridge.ts (apiProvider: vllm, port 37821)
from __future__ import annotations

import json
import re
import time
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from loguru import logger

from backend.services import engine_router

router = APIRouter(prefix="/v1", tags=["openai-compat"])


class OAIMessage(BaseModel):
    role: str
    content: str | list | None = None
    tool_calls: list | None = None
    tool_call_id: str | None = None
    name: str | None = None


class OAITool(BaseModel):
    type: str = "function"
    function: dict


class OAIChatRequest(BaseModel):
    model: str = ""
    messages: list[OAIMessage]
    tools: list[OAITool] | None = None
    tool_choice: str | dict | None = None
    temperature: float = 0.2
    max_tokens: int = 4096
    stream: bool = False
    top_p: float | None = None
    top_k: int | None = None
    stop: list[str] | None = None


def _make_chunk(content: str, model: str, finish_reason: str | None = None) -> str:
    delta = {"content": content} if content else {}
    if finish_reason:
        delta = {}
    chunk = {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    return f"data: {json.dumps(chunk)}\n\n"


def _make_tool_chunk(tool_calls: list, model: str) -> str:
    chunk = {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "delta": {"tool_calls": tool_calls}, "finish_reason": None}],
    }
    return f"data: {json.dumps(chunk)}\n\n"


def _msgs_to_dicts(messages: list[OAIMessage]) -> list[dict]:
    out = []
    for m in messages:
        d: dict = {"role": m.role}
        if m.content is not None:
            d["content"] = m.content
        if m.tool_calls:
            d["tool_calls"] = m.tool_calls
        if m.tool_call_id:
            d["tool_call_id"] = m.tool_call_id
        if m.name:
            d["name"] = m.name
        out.append(d)
    return out


def _tools_to_dicts(tools: list[OAITool] | None) -> list[dict]:
    if not tools:
        return []
    return [{"type": t.type, "function": t.function} for t in tools]


@router.get("/models")
async def list_models():
    """Retourne le modèle actif — compatible OpenAI /v1/models."""
    status = engine_router.get_status()
    models = []
    if status:
        models.append({
            "id": status.id,
            "object": "model",
            "created": int(time.time()),
            "owned_by": "echohub",
        })
    return {"object": "list", "data": models}


@router.post("/chat/completions")
async def chat_completions(req: OAIChatRequest):
    """OpenAI-compatible chat completions — route vers llama.cpp ou vLLM selon l'engine actif."""
    if engine_router.get_status() is None:
        raise HTTPException(status_code=503, detail="No model loaded in EchoHub.")

    messages = _msgs_to_dicts(req.messages)
    tools = _tools_to_dicts(req.tools)
    model = req.model or (engine_router.get_status().id if engine_router.get_status() else "unknown")

    # --- Tool use (non-streaming) ---
    if tools:
        return await _handle_tool_completion(messages, tools, model, req)

    # --- Streaming ---
    if req.stream:
        return StreamingResponse(
            _stream_generate(messages, model, req),
            media_type="text/event-stream",
        )

    # --- Non-streaming ---
    return await _handle_simple_completion(messages, model, req)


async def _handle_simple_completion(messages: list[dict], model: str, req: OAIChatRequest) -> dict:
    full_text = ""
    async for chunk in engine_router.generate(
        messages=messages,
        stream=False,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
    ):
        if isinstance(chunk, dict):
            choices = chunk.get("choices", [])
            if choices:
                msg = choices[0].get("message", {})
                full_text = msg.get("content", "") or ""
        elif isinstance(chunk, str) and chunk.startswith("data:"):
            try:
                parsed = json.loads(chunk[5:].strip())
                choices = parsed.get("choices", [])
                if choices:
                    delta = choices[0].get("delta", {}) or choices[0].get("message", {})
                    full_text += delta.get("content", "") or ""
            except Exception:
                pass

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": _strip_thinking(full_text)},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


async def _stream_generate(
    messages: list[dict], model: str, req: OAIChatRequest
) -> AsyncGenerator[str, None]:
    try:
        async for chunk in engine_router.generate(
            messages=messages,
            stream=True,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        ):
            if isinstance(chunk, str) and chunk.startswith("data:"):
                # Déjà au format SSE OpenAI — passer tel quel
                yield f"{chunk}\n\n"
            elif isinstance(chunk, dict):
                choices = chunk.get("choices", [])
                if choices:
                    delta = choices[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield _make_chunk(content, model)
    except Exception as e:
        logger.error(f"[openai-compat] stream error: {e}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
    yield _make_chunk("", model, finish_reason="stop")
    yield "data: [DONE]\n\n"


def _strip_thinking(text: str) -> str:
    """Supprime les blocs <think>...</think> et les pensées tronquées."""
    # Blocs complets
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # </think> orphelin (thinking coupé par max_tokens)
    if "</think>" in text:
        text = text[text.rfind("</think>") + len("</think>"):]
    # <think> ouvert sans fermeture = pensée tronquée, tout supprimer
    if "<think>" in text:
        text = ""
    return text.strip()


_TC_OPEN = "<tool_call>"
_TC_CLOSE = "</tool_call>"
_TC_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_xml_tool_calls(text: str) -> tuple[str, list[dict]]:
    """Parse <tool_call>...</tool_call> blocs depuis le texte llama.cpp.
    Retourne (texte_sans_tool_calls, tool_calls_openai_format)."""
    tool_calls: list[dict] = []
    clean = text

    for match in re.finditer(re.escape(_TC_OPEN) + r"(.*?)" + re.escape(_TC_CLOSE), text, re.DOTALL):
        raw = match.group(1).strip()
        json_match = _TC_JSON_RE.search(raw)
        if not json_match:
            continue
        try:
            tc = json.loads(json_match.group())
            name = tc.get("name", "")
            args = tc.get("arguments", tc.get("args", {}))
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    pass
            tool_calls.append({
                "id": f"call_{uuid.uuid4().hex[:8]}",
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": json.dumps(args) if not isinstance(args, str) else args,
                },
            })
        except (json.JSONDecodeError, Exception):
            pass
        clean = clean.replace(match.group(0), "")

    clean = _strip_thinking(clean)
    return clean, tool_calls


async def _handle_tool_completion(
    messages: list[dict], tools: list[dict], model: str, req: OAIChatRequest
) -> dict:
    """generate_with_tools → OpenAI format. Supporte native tool_calls (vLLM) et XML inline (llama.cpp)."""
    try:
        result: dict | None = None
        accumulated_text = ""

        async for event in engine_router.generate_with_tools(
            messages=messages,
            tools=tools,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
        ):
            if not isinstance(event, dict):
                continue
            etype = event.get("type")
            if etype == "response":
                result = event
            elif etype == "text_delta":
                accumulated_text += event.get("content", "")
            elif etype == "error":
                raise HTTPException(status_code=500, detail=event.get("error", "Engine error"))

        # Engine a retourné un result structuré (vLLM native tool_calls)
        if result is not None:
            choices = result.get("choices", [{}])
            msg = choices[0].get("message", {}) if choices else {}
            native_tool_calls = msg.get("tool_calls") or []
            content = msg.get("content") or accumulated_text or None

            # Fallback: si pas de native tool_calls, parser le XML dans le contenu
            if not native_tool_calls and content:
                clean_content, xml_tool_calls = _extract_xml_tool_calls(str(content))
                if xml_tool_calls:
                    native_tool_calls = xml_tool_calls
                    content = clean_content or None

            return _build_completion_response(model, content, native_tool_calls)

        # Engine n'a pas retourné de result (llama.cpp texte brut avec <tool_call>)
        if accumulated_text:
            clean_content, xml_tool_calls = _extract_xml_tool_calls(accumulated_text)
            return _build_completion_response(model, clean_content or None, xml_tool_calls)

        # Fallback generate() normal si generate_with_tools ne supporte pas le modèle
        logger.warning("[openai-compat] generate_with_tools returned nothing, falling back to generate()")
        return await _handle_simple_completion(messages, model, req)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[openai-compat] tool_completion error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _build_completion_response(model: str, content: str | None, tool_calls: list[dict]) -> dict:
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": content,
                "tool_calls": tool_calls if tool_calls else None,
            },
            "finish_reason": "tool_calls" if tool_calls else "stop",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
