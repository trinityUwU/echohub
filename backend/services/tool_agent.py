"""
tool_agent.py — invoke_agent tool implementation for tool_service.
Provides _invoke_agent, _HARNESS_TOOLS, _SUB_AGENT_SYSTEM, _MAX_AGENT_TOOL_CALLS.
"""
from __future__ import annotations

import json
import re
from typing import Any

from loguru import logger


_HARNESS_TOOLS: dict[str, list[str]] = {
    "read_strict":    ["read_file", "list_files", "get_workspace_info", "web_search"],
    "write_validated": ["read_file", "list_files", "create_file", "edit_file", "delete_file",
                        "get_workspace_info", "web_search"],
    "shell_safe":     ["read_file", "list_files", "create_file", "edit_file", "delete_file",
                        "get_workspace_info", "web_search", "run_command"],
    "web_research":   ["web_search", "fetch_url"],
}

_SUB_AGENT_SYSTEM = (
    "You are a sub-agent operating under the ReAct framework (Reasoning + Acting).\n"
    "Complete the task by cycling through: Thought → Action (tool call) → Observation → repeat.\n\n"
    "PROCESS:\n"
    "- Thought: reason about what you know and what you need next\n"
    "- Action: call the appropriate tool with a precise query\n"
    "- Observation: what the tool returned — use it to inform the next Thought\n"
    "- Stop when the goal is reached or you have exhausted useful queries\n\n"
    "CONSTRAINTS:\n"
    "- Each tool call must have a different, more specific query than the previous\n"
    "- If a query returns no useful results after 2 tries, move on\n"
    "- Do not repeat the same tool call twice\n"
    "- Stop after 10 tool calls maximum\n\n"
    "FINAL OUTPUT — after all tool calls, output ONLY this JSON (no markdown, no explanation):\n"
    '{"status": "success|partial|failed", "summary": "<what you actually found in one sentence>", '
    '"findings": {"<key>": "<actual value from tools>"}, "actions_taken": ["tool(query)"]}\n\n'
    "CRITICAL: findings must contain real data from your tool calls — not placeholders or intentions."
)

_MAX_AGENT_TOOL_CALLS = 15

# Regex to extract <tool_call>...</tool_call> blocks (Qwen3 XML format)
_TC_RE = re.compile(r"<tool_call>(.*?)</tool_call>", re.DOTALL)


def _parse_xml_tool_calls(content: str) -> list[dict]:
    """Extract tool calls from Qwen3 XML <tool_call> format."""
    results = []
    for i, m in enumerate(_TC_RE.finditer(content)):
        try:
            data = json.loads(m.group(1).strip())
            name = data.get("name", "")
            args = data.get("arguments", data.get("args", {}))
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except (json.JSONDecodeError, ValueError):
                    args = {}
            results.append({
                "id": f"xml_{i}",
                "type": "function",
                "function": {"name": name, "arguments": json.dumps(args)},
            })
        except (json.JSONDecodeError, ValueError):
            pass
    return results


def _strip_think(content: str) -> str:
    """Remove <think>...</think> blocks from content."""
    return re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()


def _invoke_agent(
    args: dict[str, Any],
    project_id: str,
    conv_id: str,
    progress_cb: Any = None,  # Optional[Callable[[dict], None]]
) -> str:
    """
    progress_cb(event: dict) is called for each sub-agent step:
      {"type": "agent_thinking"}
      {"type": "agent_tool_start", "tool": name, "args": {}}
      {"type": "agent_tool_done", "tool": name, "result_preview": str}
      {"type": "agent_done", "status": str}
    """
    task = args.get("task", "")
    harness = args.get("harness", "read_strict")
    if not task:
        return json.dumps({"status": "failed", "summary": "task is required", "findings": {}, "actions_taken": []})
    if harness not in _HARNESS_TOOLS:
        harness = "read_strict"

    def _emit(event: dict) -> None:
        if progress_cb:
            try:
                progress_cb(event)
            except Exception:
                pass

    from backend.services import engine_router
    if engine_router.get_status() is None:
        return json.dumps({"status": "failed", "summary": "No model loaded", "findings": {}, "actions_taken": []})

    from backend.services.tool_service import execute_tool, get_tools, get_workspace_path

    enabled = _HARNESS_TOOLS[harness]
    agent_tools = get_tools(enabled)

    messages: list[dict] = [
        {"role": "system", "content": _SUB_AGENT_SYSTEM},
        {"role": "user", "content": task},
    ]

    actions_taken: list[str] = []
    tool_calls_count = 0

    try:
        while tool_calls_count < _MAX_AGENT_TOOL_CALLS:
            response = engine_router.chat_completion(
                messages=messages,
                tools=agent_tools,
                temperature=0.1,
                max_tokens=2048,
            )
            if response is None:
                break

            choice = response.get("choices", [{}])[0]
            msg = choice.get("message", {})
            raw_content = msg.get("content") or ""
            content = _strip_think(raw_content)

            # Try native tool_calls first, fall back to XML parsing
            tool_calls: list[dict] = msg.get("tool_calls") or []
            if not tool_calls and "<tool_call>" in raw_content:
                tool_calls = _parse_xml_tool_calls(raw_content)

            # Strip <tool_call> blocks from visible content before appending
            clean_content = _TC_RE.sub("", raw_content).strip()
            clean_content = _strip_think(clean_content)

            if clean_content and not tool_calls:
                _emit({"type": "agent_thinking"})

            messages.append({"role": "assistant", "content": clean_content, "tool_calls": tool_calls if tool_calls else None})

            if not tool_calls:
                # Final answer — extract JSON from content
                json_match = re.search(r"\{.*\}", content, re.DOTALL)
                if json_match:
                    try:
                        result = json.loads(json_match.group())
                        result.setdefault("actions_taken", actions_taken)
                        _emit({"type": "agent_done", "status": result.get("status", "success")})
                        return json.dumps(result)
                    except (json.JSONDecodeError, ValueError):
                        pass
                _emit({"type": "agent_done", "status": "success"})
                return json.dumps({
                    "status": "success",
                    "summary": content or "No response",
                    "findings": {},
                    "actions_taken": actions_taken,
                })

            for tc in tool_calls:
                tool_calls_count += 1
                fn = tc.get("function", {})
                t_name = fn.get("name", "")
                try:
                    t_args = json.loads(fn.get("arguments", "{}"))
                except (json.JSONDecodeError, ValueError):
                    t_args = {}

                logger.info(f"[invoke_agent] {t_name}({list(t_args.keys())})")
                _emit({"type": "agent_tool_start", "tool": t_name, "args": t_args})

                if t_name not in enabled:
                    tool_result = f"Error: tool '{t_name}' not available in harness '{harness}'"
                else:
                    tool_result = execute_tool(t_name, t_args, project_id, conv_id)

                    if t_name in ("create_file", "edit_file") and "Error:" not in tool_result:
                        file_path = t_args.get("path", "")
                        if file_path:
                            try:
                                from backend.services.harness_service import validate_and_format_for_agent
                                workspace = get_workspace_path(project_id)
                                full_path = workspace / file_path
                                if full_path.exists():
                                    content_str = full_path.read_text(encoding="utf-8", errors="replace")
                                    harness_feedback = validate_and_format_for_agent(file_path, content_str)
                                    tool_result = f"{tool_result}\n{harness_feedback}"
                            except Exception as he:
                                logger.warning("[invoke_agent] harness error: {}", he)

                preview = tool_result[:120].replace("\n", " ") if tool_result else ""
                _emit({"type": "agent_tool_done", "tool": t_name, "result_preview": preview})

                actions_taken.append(f"{t_name}({list(t_args.keys())})")
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content": tool_result,
                })

        result = json.dumps({
            "status": "partial",
            "summary": f"Reached tool call limit ({_MAX_AGENT_TOOL_CALLS})",
            "findings": {},
            "actions_taken": actions_taken,
        })
        _emit({"type": "agent_done", "status": "partial"})
        return result

    except Exception as e:
        logger.error(f"[invoke_agent] error: {e}")
        return json.dumps({"status": "failed", "summary": str(e), "findings": {}, "actions_taken": actions_taken})
