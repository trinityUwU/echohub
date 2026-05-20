"""
tool_service.py — Dev mode tool use: file I/O + shell execution in per-project workspaces.
Workspace root: ~/.local/share/echohub/projects/{project_id}/workspace/
"""
from __future__ import annotations

import json
import os
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
            "description": "Create a new file. Returns an error if the file already exists (use overwrite=true to force, or edit_file to modify an existing file).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from workspace root"},
                    "content": {"type": "string", "description": "File content"},
                    "overwrite": {"type": "boolean", "description": "Set to true to replace an existing file. Default false.", "default": False},
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
            "name": "edit_file",
            "description": (
                "Edit a file. Two modes:\n"
                "1. String replacement (old_string + new_string): replaces the first exact occurrence. "
                "IMPORTANT: old_string must match the file content character-for-character including whitespace. "
                "If it fails with 'not found', use read_file first to get the exact content, then retry.\n"
                "2. Line replacement (start_line + end_line + new_content): replaces lines start_line..end_line (1-indexed, inclusive) "
                "with new_content. More reliable when the exact string is hard to reproduce."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from workspace root"},
                    "old_string": {"type": "string", "description": "Exact string to replace (mode 1)"},
                    "new_string": {"type": "string", "description": "Replacement string (mode 1)"},
                    "start_line": {"type": "integer", "description": "First line to replace, 1-indexed (mode 2)"},
                    "end_line": {"type": "integer", "description": "Last line to replace, 1-indexed inclusive (mode 2)"},
                    "new_content": {"type": "string", "description": "New content for the replaced lines (mode 2)"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_workspace_info",
            "description": "Return the absolute path of the current workspace and basic metadata (project id, total files, total size).",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_tool_limit",
            "description": (
                "Increase the maximum number of tool calls allowed for this session. "
                "Use this when you have a large task that requires more tool calls than the current limit. "
                "Only call this if you genuinely need more calls to complete the task — not as a workaround for loops. "
                "The new limit must be higher than the current one. Maximum allowed: 300."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "new_limit": {
                        "type": "integer",
                        "description": "The new maximum number of tool calls (must be > current limit, max 300)",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Why you need more tool calls",
                    },
                },
                "required": ["new_limit", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": (
                "Run a validation command in the workspace directory. "
                "Use this after creating or editing code files to catch syntax errors, type errors, and runtime issues. "
                "Examples: 'node --check app.js', 'node -e \"require(\\\"./app.js\\\")\"', "
                "'python3 -m py_compile script.py', 'tsc --noEmit'. "
                "Only whitelisted executables are allowed: node, python3, tsc, eslint, jshint, deno. "
                "Output is capped at 2KB. Timeout: 10s."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command to run (e.g. 'node --check index.js')",
                    },
                },
                "required": ["command"],
            },
        },
    },
]

_MAX_READ_BYTES = 50 * 1024       # 50 KB


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
        elif name == "edit_file":
            return _edit_file(workspace, arguments)
        elif name == "get_workspace_info":
            return _get_workspace_info(workspace, project_id)
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
    overwrite: bool = args.get("overwrite", False)
    if not path_str:
        raise ValueError("path is required")
    target = _safe_path(workspace, path_str)
    if target.exists() and not overwrite:
        raise ValueError(
            f"File '{path_str}' already exists. "
            "Use overwrite=true to replace it, edit_file to modify it, or choose a different name."
        )
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


def _edit_file(workspace: Path, args: dict[str, Any]) -> str:
    path_str: str = args.get("path", "")
    if not path_str:
        raise ValueError("path is required")
    target = _safe_path(workspace, path_str)
    if not target.exists():
        raise FileNotFoundError(f"File not found: {path_str}")
    if not target.is_file():
        raise ValueError(f"Not a file: {path_str}")

    content = target.read_text(encoding="utf-8")

    # Mode 2: line-range replacement
    start_line: int | None = args.get("start_line")
    end_line: int | None = args.get("end_line")
    new_content: str | None = args.get("new_content")
    if start_line is not None and new_content is not None:
        lines = content.splitlines(keepends=True)
        end = end_line if end_line is not None else start_line
        s, e = start_line - 1, end  # convert to 0-indexed
        if s < 0 or s >= len(lines) or e > len(lines):
            raise ValueError(f"Line range {start_line}..{end} out of bounds (file has {len(lines)} lines)")
        replacement = new_content if new_content.endswith("\n") else new_content + "\n"
        updated = "".join(lines[:s]) + replacement + "".join(lines[e:])
        target.write_text(updated, encoding="utf-8")
        logger.info(f"[tool_service] edit_file {target} lines {start_line}..{end}")
        return f"Edited: {path_str} (replaced lines {start_line}–{end})"

    # Mode 1: exact string replacement
    old_string: str = args.get("old_string", "")
    new_string: str = args.get("new_string", "")
    if not old_string:
        raise ValueError("old_string is required (or use start_line+end_line+new_content for line-based edit)")
    if old_string not in content:
        # Give a useful diagnostic: show lines that partially match
        lines = content.splitlines()
        first_word = old_string.strip().splitlines()[0][:40]
        close = [f"  line {i+1}: {l.rstrip()}" for i, l in enumerate(lines) if first_word in l][:3]
        hint = ("Closest matches:\n" + "\n".join(close)) if close else "No partial match found."
        raise ValueError(
            f"old_string not found in {path_str}. {hint}\n"
            "Tip: use read_file to get the exact content, then retry with the exact string. "
            "Or use start_line+end_line+new_content for line-based editing."
        )
    updated = content.replace(old_string, new_string, 1)
    target.write_text(updated, encoding="utf-8")
    logger.info(f"[tool_service] edit_file {target} (string replacement, {len(old_string)} chars)")
    return f"Edited: {path_str} (replaced {len(old_string)} chars)"


def _run_command(workspace: Path, args: dict[str, Any]) -> str:
    import shlex
    import subprocess

    _ALLOWED_BINS = {"node", "python3", "tsc", "eslint", "jshint", "deno"}
    _MAX_OUTPUT = 2048
    _TIMEOUT = 10

    command: str = args.get("command", "").strip()
    if not command:
        raise ValueError("command is required")

    try:
        parts = shlex.split(command)
    except ValueError as e:
        raise ValueError(f"Invalid command syntax: {e}") from e

    binary = Path(parts[0]).name
    if binary not in _ALLOWED_BINS:
        raise ValueError(
            f"Binary '{binary}' is not allowed. Allowed: {', '.join(sorted(_ALLOWED_BINS))}"
        )

    try:
        result = subprocess.run(
            parts,
            cwd=str(workspace),
            capture_output=True,
            text=True,
            timeout=_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return f"Error: command timed out after {_TIMEOUT}s"
    except FileNotFoundError:
        return f"Error: '{binary}' is not installed on this system"

    combined = ""
    if result.stdout:
        combined += result.stdout
    if result.stderr:
        combined += result.stderr

    if not combined.strip():
        combined = "(no output)" if result.returncode == 0 else f"(exit code {result.returncode}, no output)"
    elif len(combined) > _MAX_OUTPUT:
        combined = combined[:_MAX_OUTPUT] + f"\n... (truncated, {len(combined)} total chars)"

    status = "OK" if result.returncode == 0 else f"FAILED (exit {result.returncode})"
    logger.info(f"[tool_service] run_command {command!r} → {status}")
    return f"[{status}]\n{combined.strip()}"


def _get_workspace_info(workspace: Path, project_id: str) -> str:
    files = list(workspace.rglob("*"))
    file_list = [f for f in files if f.is_file()]
    total_size = sum(f.stat().st_size for f in file_list)
    return (
        f"Workspace path: {workspace}\n"
        f"Project ID: {project_id}\n"
        f"Files: {len(file_list)}\n"
        f"Total size: {total_size} bytes"
    )
