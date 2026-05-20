"""
tool_service.py — Dev mode tool use: file I/O + shell execution in per-project workspaces.
Workspace root: ~/.local/share/echohub/projects/{project_id}/workspace/
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from loguru import logger


# ──────────────────────────────────────────────────────────────────────────────
# Tool definitions (OpenAI function calling format)
# ──────────────────────────────────────────────────────────────────────────────

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "create_file",
            "description": "Create or overwrite a file with the given content",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from workspace root"},
                    "content": {"type": "string", "description": "File content"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the content of a file",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from workspace root"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List all files in the workspace or a subdirectory",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path, defaults to root",
                        "default": ".",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a file from the workspace",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from workspace root"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Run a shell command in the workspace directory. Only safe commands allowed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to run"},
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in seconds, max 30",
                        "default": 10,
                    },
                },
                "required": ["command"],
            },
        },
    },
]

# Commands that are never allowed in run_command
_BLACKLIST_PATTERNS: list[str] = [
    "rm -rf /",
    "sudo",
    "curl",
    "wget",
    "nc ",
    "ncat",
    " nc\n",
    ";nc",
    "&&nc",
]

_MAX_READ_BYTES = 50 * 1024       # 50 KB
_MAX_OUTPUT_BYTES = 4 * 1024      # 4 KB
_MAX_COMMAND_TIMEOUT = 30


# ──────────────────────────────────────────────────────────────────────────────
# Workspace helpers
# ──────────────────────────────────────────────────────────────────────────────

def get_workspace_path(project_id: str) -> Path:
    """Return ~/.local/share/echohub/projects/{project_id}/workspace/, creating it if needed."""
    workspace = Path.home() / ".local" / "share" / "echohub" / "projects" / project_id / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace


def _safe_path(workspace: Path, relative: str) -> Path:
    """
    Resolve relative path under workspace, raising ValueError on path traversal.
    """
    resolved = (workspace / relative).resolve()
    if not str(resolved).startswith(str(workspace.resolve())):
        raise ValueError(f"Path traversal detected: {relative!r} escapes workspace")
    return resolved


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def get_tools() -> list[dict[str, Any]]:
    """Return the TOOLS list for use as tool_choice param."""
    return TOOLS


def execute_tool(name: str, arguments: dict[str, Any], project_id: str) -> str:
    """
    Execute a tool call and return the result as a string.
    Raises ValueError on bad arguments, RuntimeError on execution failure.
    """
    workspace = get_workspace_path(project_id)
    logger.debug(f"[tool_service] execute_tool name={name!r} project_id={project_id!r}")

    try:
        if name == "create_file":
            return _create_file(workspace, arguments)
        elif name == "read_file":
            return _read_file(workspace, arguments)
        elif name == "list_files":
            return _list_files(workspace, arguments)
        elif name == "delete_file":
            return _delete_file(workspace, arguments)
        elif name == "run_command":
            return _run_command(workspace, arguments)
        else:
            raise ValueError(f"Unknown tool: {name!r}")
    except (ValueError, FileNotFoundError) as e:
        logger.warning(f"[tool_service] {name} failed: {e}")
        return f"Error: {e}"
    except Exception as e:
        logger.error(f"[tool_service] {name} unexpected error: {e}")
        return f"Error: {e}"


def list_workspace_files(project_id: str) -> list[dict[str, Any]]:
    """Return [{path, size, modified}] for all files in workspace (non-recursive flat list)."""
    workspace = get_workspace_path(project_id)
    results: list[dict[str, Any]] = []
    try:
        for entry in sorted(workspace.rglob("*")):
            if entry.is_file():
                stat = entry.stat()
                rel = str(entry.relative_to(workspace))
                results.append({
                    "path": rel,
                    "size": stat.st_size,
                    "modified": int(stat.st_mtime),
                })
    except Exception as e:
        logger.error(f"[tool_service] list_workspace_files error: {e}")
    return results


# ──────────────────────────────────────────────────────────────────────────────
# Tool implementations
# ──────────────────────────────────────────────────────────────────────────────

def _create_file(workspace: Path, args: dict[str, Any]) -> str:
    path_str: str = args.get("path", "")
    content: str = args.get("content", "")
    if not path_str:
        raise ValueError("path is required")
    target = _safe_path(workspace, path_str)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    logger.info(f"[tool_service] create_file {target}")
    return f"File created: {path_str}"


def _read_file(workspace: Path, args: dict[str, Any]) -> str:
    path_str: str = args.get("path", "")
    if not path_str:
        raise ValueError("path is required")
    target = _safe_path(workspace, path_str)
    if not target.exists():
        raise FileNotFoundError(f"File not found: {path_str}")
    if not target.is_file():
        raise ValueError(f"Not a file: {path_str}")
    raw = target.read_bytes()
    if len(raw) > _MAX_READ_BYTES:
        content = raw[:_MAX_READ_BYTES].decode("utf-8", errors="replace")
        return content + f"\n\n[... truncated — file is {len(raw)} bytes, showing first {_MAX_READ_BYTES}]"
    return raw.decode("utf-8", errors="replace")


def _list_files(workspace: Path, args: dict[str, Any]) -> str:
    path_str: str = args.get("path", ".")
    target = _safe_path(workspace, path_str)
    if not target.exists():
        raise FileNotFoundError(f"Directory not found: {path_str}")
    lines: list[str] = []
    for entry in sorted(target.rglob("*")):
        if entry.is_file():
            rel = str(entry.relative_to(workspace))
            size = entry.stat().st_size
            lines.append(f"{rel}  ({size} bytes)")
    if not lines:
        return "(empty workspace)"
    return "\n".join(lines)


def _delete_file(workspace: Path, args: dict[str, Any]) -> str:
    path_str: str = args.get("path", "")
    if not path_str:
        raise ValueError("path is required")
    target = _safe_path(workspace, path_str)
    if not target.exists():
        raise FileNotFoundError(f"File not found: {path_str}")
    target.unlink()
    logger.info(f"[tool_service] delete_file {target}")
    return f"Deleted: {path_str}"


def _run_command(workspace: Path, args: dict[str, Any]) -> str:
    command: str = args.get("command", "")
    timeout: int = min(int(args.get("timeout", 10)), _MAX_COMMAND_TIMEOUT)
    if not command:
        raise ValueError("command is required")

    # Blacklist check
    cmd_lower = command.lower()
    for pattern in _BLACKLIST_PATTERNS:
        if pattern in cmd_lower:
            logger.warning(f"[tool_service] run_command blocked: {command!r} matches pattern {pattern!r}")
            return f"Error: command blocked by security policy (matched: {pattern!r})"

    logger.info(f"[tool_service] run_command cwd={workspace} cmd={command!r} timeout={timeout}s")
    try:
        proc = subprocess.run(
            command,
            shell=True,
            cwd=str(workspace),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = proc.stdout + proc.stderr
        if len(output.encode()) > _MAX_OUTPUT_BYTES:
            output = output[:_MAX_OUTPUT_BYTES] + f"\n[... output truncated at {_MAX_OUTPUT_BYTES} bytes]"
        return_info = f"\n[exit code: {proc.returncode}]"
        return (output or "(no output)") + return_info
    except subprocess.TimeoutExpired:
        return f"Error: command timed out after {timeout}s"
    except Exception as e:
        return f"Error: {e}"
