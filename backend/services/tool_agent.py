"""
tool_agent.py — invoke_agent tool implementation for tool_service.
Provides _invoke_agent, _HARNESS_TOOLS, _SUB_AGENT_SYSTEM, _MAX_AGENT_TOOL_CALLS.
"""
from __future__ import annotations

import json
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
    "You are a sub-agent running in an isolated context. "
    "You have been given a precise task. Complete it using the available tools. "
    "When done, output a structured result in this exact JSON format:\n"
    '{"status": "success|partial|failed", "summary": "...", "findings": {}, "actions_taken": []}\n'
    "Do not include anything outside this JSON in your final response. "
    "Be concise. If you cannot complete the task, set status to 'failed' and explain why in summary."
)

_MAX_AGENT_TOOL_CALLS = 15


def _invoke_agent(args: dict[str, Any], project_id: str, conv_id: str) -> str:
    task = args.get("task", "")
    harness = args.get("harness", "read_strict")
    if not task:
        return json.dumps({"status": "failed", "summary": "task is required", "findings": {}, "actions_taken": []})
    if harness not in _HARNESS_TOOLS:
        harness = "read_strict"

    from backend.services import engine_router
    status = engine_router.get_status()
    if status is None:
        return json.dumps({"status": "failed", "summary": "No model loaded", "findings": {}, "actions_taken": []})

    # Local import to avoid circular dependency
    from backend.services.tool_service import execute_tool, get_tools, get_workspace_path

    enabled = _HARNESS_TOOLS[harness]
    agent_tools = get_tools(enabled)

    messages: list[dict] = [
        {"role": "system", "content": _SUB_AGENT_SYSTEM},
        {"role": "user", "content": task},
    ]

    actions_taken: list[str] = []
    tool_calls_count = 0
    max_tokens = 2048

    try:
        while tool_calls_count < _MAX_AGENT_TOOL_CALLS:
            response = engine_router.chat_completion(
                messages=messages,
                tools=agent_tools,
                temperature=0.1,
                max_tokens=max_tokens,
            )
            if response is None:
                break

            choice = response.get("choices", [{}])[0]
            msg = choice.get("message", {})
            tool_calls = msg.get("tool_calls") or []
            content = msg.get("content") or ""

            messages.append({"role": "assistant", "content": content, "tool_calls": tool_calls})

            if not tool_calls:
                # Final response — parse JSON result
                try:
                    result = json.loads(content)
                    result.setdefault("actions_taken", actions_taken)
                    return json.dumps(result)
                except (json.JSONDecodeError, ValueError):
                    return json.dumps({
                        "status": "success",
                        "summary": content,
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

                if t_name not in enabled:
                    tool_result = f"Error: tool '{t_name}' not available in harness '{harness}'"
                else:
                    tool_result = execute_tool(t_name, t_args, project_id, conv_id)

                    # Harness validation after file mutations
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

                actions_taken.append(f"{t_name}({list(t_args.keys())})")
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content": tool_result,
                })

        return json.dumps({
            "status": "partial",
            "summary": f"Reached tool call limit ({_MAX_AGENT_TOOL_CALLS})",
            "findings": {},
            "actions_taken": actions_taken,
        })

    except Exception as e:
        logger.error(f"[invoke_agent] error: {e}")
        return json.dumps({"status": "failed", "summary": str(e), "findings": {}, "actions_taken": actions_taken})
