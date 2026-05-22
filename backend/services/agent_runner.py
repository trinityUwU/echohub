"""
agent_runner.py — Async streaming invoke_agent.

Remplace _invoke_agent synchrone par un async generator qui yield les events
en temps réel : tokens du sous-agent, tool starts/dones, résultat final.

Event types yielded:
  {"type": "agent_text_chunk",    "content": str}        — token live du sous-agent
  {"type": "agent_thinking_chunk","content": str}        — token live dans <think>
  {"type": "agent_thinking_end"}                         — fin du bloc think
  {"type": "agent_tool_start",    "tool": str, "args": dict}
  {"type": "agent_tool_done",     "tool": str, "result_preview": str}
  {"type": "agent_done",          "status": str, "summary": str, "actions_taken": list}
  {"type": "agent_error",         "error": str}
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import AsyncGenerator, Any

from loguru import logger

from backend.services.tool_agent import (
    _HARNESS_TOOLS,
    _SUB_AGENT_SYSTEM,
    _MAX_AGENT_TOOL_CALLS,
    _parse_xml_tool_calls,
    _strip_think,
)

_THINK_OPEN = "<think>"
_THINK_CLOSE = "</think>"
_TC_RE = re.compile(r"<tool_call>(.*?)</tool_call>", re.DOTALL)


async def run_agent_streaming(
    args: dict[str, Any],
    project_id: str,
    conv_id: str,
) -> AsyncGenerator[dict, None]:
    """
    Async generator — yields real-time events for the sub-agent execution.
    Runs generate_with_tools() async so every token is streamed immediately.
    """
    task = args.get("task", "")
    harness = args.get("harness", "read_strict")

    if not task:
        yield {"type": "agent_error", "error": "task is required"}
        return
    if harness not in _HARNESS_TOOLS:
        harness = "read_strict"

    from backend.services import engine_router
    if engine_router.get_status() is None:
        yield {"type": "agent_error", "error": "No model loaded"}
        return

    from backend.services.tool_service import execute_tool, get_tools
    from backend.services.tool_definitions import TOOLS

    enabled = _HARNESS_TOOLS[harness]
    agent_tools = get_tools(enabled)

    messages: list[dict] = [
        {"role": "system", "content": _SUB_AGENT_SYSTEM},
        {"role": "user",   "content": task},
    ]

    actions_taken: list[str] = []
    tool_calls_count = 0

    try:
        while tool_calls_count < _MAX_AGENT_TOOL_CALLS:
            # ── async streaming generation ────────────────────────────────
            accumulated_text = ""
            in_think = False
            think_buf = ""
            final_response: dict | None = None

            async for event in engine_router.generate_with_tools(
                messages=messages,
                tools=agent_tools,
                temperature=0.1,
                max_tokens=2048,
            ):
                etype = event.get("type") if isinstance(event, dict) else None

                if etype == "text_delta":
                    chunk = event.get("content", "")
                    if not chunk:
                        continue
                    accumulated_text += chunk

                    # Route <think> tokens separately
                    for evt in _route_text_chunk(chunk, in_think):
                        yield evt
                    in_think = _update_think_state(accumulated_text)

                elif etype == "response":
                    final_response = event
                    break

                elif etype == "error":
                    yield {"type": "agent_error", "error": event.get("error", "generation error")}
                    return

            if final_response is None:
                yield {"type": "agent_error", "error": "No response from model"}
                return

            # ── parse tool calls from final response ──────────────────────
            choice = (final_response.get("choices") or [{}])[0]
            msg = choice.get("message", {})
            raw_content = msg.get("content") or accumulated_text or ""

            tool_calls: list[dict] = msg.get("tool_calls") or []
            if not tool_calls and "<tool_call>" in raw_content:
                tool_calls = _parse_xml_tool_calls(raw_content)

            clean_content = _TC_RE.sub("", raw_content).strip()
            clean_content = _strip_think(clean_content)

            messages.append({
                "role": "assistant",
                "content": clean_content,
                "tool_calls": tool_calls or None,
            })

            if not tool_calls:
                # Final answer
                json_match = re.search(r"\{.*\}", clean_content, re.DOTALL)
                result_data: dict = {
                    "status": "success",
                    "summary": clean_content or "No response",
                    "findings": {},
                    "actions_taken": actions_taken,
                }
                if json_match:
                    try:
                        parsed = json.loads(json_match.group())
                        parsed.setdefault("actions_taken", actions_taken)
                        result_data = parsed
                    except (json.JSONDecodeError, ValueError):
                        pass

                yield {
                    "type": "agent_done",
                    "status": result_data.get("status", "success"),
                    "summary": result_data.get("summary", ""),
                    "actions_taken": result_data.get("actions_taken", actions_taken),
                    "result_json": json.dumps(result_data),
                }
                return

            # ── execute tools ─────────────────────────────────────────────
            for tc in tool_calls:
                tool_calls_count += 1
                fn = tc.get("function", {})
                t_name = fn.get("name", "")
                try:
                    t_args = json.loads(fn.get("arguments", "{}"))
                except (json.JSONDecodeError, ValueError):
                    t_args = {}

                logger.info(f"[agent_runner] {t_name}({list(t_args.keys())})")
                yield {"type": "agent_tool_start", "tool": t_name, "args": t_args}

                if t_name not in enabled:
                    tool_result = f"Error: tool '{t_name}' not available in harness '{harness}'"
                else:
                    try:
                        tool_result = await asyncio.get_event_loop().run_in_executor(
                            None,
                            lambda n=t_name, a=t_args: execute_tool(n, a, project_id, conv_id),
                        )
                    except Exception as te:
                        tool_result = f"Error: {te}"

                preview = tool_result[:120].replace("\n", " ") if tool_result else ""
                yield {"type": "agent_tool_done", "tool": t_name, "result_preview": preview}

                actions_taken.append(f"{t_name}({list(t_args.keys())})")
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", f"tc_{tool_calls_count}"),
                    "content": tool_result,
                })

        # Reached tool call limit
        yield {
            "type": "agent_done",
            "status": "partial",
            "summary": f"Reached tool call limit ({_MAX_AGENT_TOOL_CALLS})",
            "actions_taken": actions_taken,
            "result_json": json.dumps({
                "status": "partial",
                "summary": f"Reached tool call limit ({_MAX_AGENT_TOOL_CALLS})",
                "findings": {},
                "actions_taken": actions_taken,
            }),
        }

    except Exception as e:
        logger.error(f"[agent_runner] error: {e}")
        yield {"type": "agent_error", "error": str(e)}


def _route_text_chunk(chunk: str, currently_in_think: bool) -> list[dict]:
    """Return events to yield for a text chunk, routing think vs normal text."""
    events: list[dict] = []
    if currently_in_think:
        if _THINK_CLOSE in chunk:
            before_close = chunk[:chunk.index(_THINK_CLOSE)]
            if before_close:
                events.append({"type": "agent_thinking_chunk", "content": before_close})
            events.append({"type": "agent_thinking_end"})
            after_close = chunk[chunk.index(_THINK_CLOSE) + len(_THINK_CLOSE):]
            if after_close and not after_close.startswith("<tool_call>"):
                events.append({"type": "agent_text_chunk", "content": after_close})
        else:
            events.append({"type": "agent_thinking_chunk", "content": chunk})
    else:
        if _THINK_OPEN in chunk:
            before_open = chunk[:chunk.index(_THINK_OPEN)]
            if before_open:
                events.append({"type": "agent_text_chunk", "content": before_open})
            after_open = chunk[chunk.index(_THINK_OPEN) + len(_THINK_OPEN):]
            if after_open:
                events.append({"type": "agent_thinking_chunk", "content": after_open})
        elif not chunk.startswith("<tool_call>") and "<tool_call>" not in chunk:
            events.append({"type": "agent_text_chunk", "content": chunk})
    return events


def _update_think_state(accumulated: str) -> bool:
    """Return True if we're currently inside a <think> block."""
    last_open = accumulated.rfind(_THINK_OPEN)
    last_close = accumulated.rfind(_THINK_CLOSE)
    return last_open > last_close
