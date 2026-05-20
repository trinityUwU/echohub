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
            "description": (
                "Read a file with line numbers. Every line is prefixed with its number (e.g. '  42 | code here'). "
                "Use start_line and end_line to read a specific range (1-indexed, inclusive). "
                "Omit both to read the entire file. Use line numbers with edit_file's start_line/end_line for precise edits."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from workspace root"},
                    "start_line": {"type": "integer", "description": "First line to read (1-indexed). Omit to start from line 1."},
                    "end_line": {"type": "integer", "description": "Last line to read (1-indexed, inclusive). Omit to read to end of file."},
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
            "name": "fetch_url",
            "description": (
                "Fetch a URL and return its content as readable text (Markdown-like). "
                "Use this to read documentation, GitHub files, API references, or any web page. "
                "Returns the page content stripped of ads/nav, with links preserved. "
                "For JavaScript-heavy pages, set dynamic=true (slower, uses a real browser)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to fetch"},
                    "dynamic": {"type": "boolean", "description": "Use real browser for JS-rendered pages (default false)", "default": False},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Search the web and return a list of results (title, URL, snippet). "
                "Use this to find documentation, examples, error solutions, or any information not in your context. "
                "Returns top results with titles and snippets — use fetch_url to read a specific result."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "max_results": {"type": "integer", "description": "Number of results (default 5, max 10)", "default": 5},
                },
                "required": ["query"],
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

def get_tools(enabled: list[str] | None = None) -> list[dict[str, Any]]:
    """Return tools, optionally filtered to the enabled set."""
    if enabled is None:
        return TOOLS
    return [t for t in TOOLS if t["function"]["name"] in enabled]


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
        elif name == "fetch_url":
            return _fetch_url(arguments)
        elif name == "web_search":
            return _web_search(arguments)
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
        text = raw[:_MAX_READ_BYTES].decode("utf-8", errors="replace")
        truncated = True
    else:
        text = raw.decode("utf-8", errors="replace")
        truncated = False

    lines = text.splitlines()
    total = len(lines)

    start_line: int | None = args.get("start_line")
    end_line: int | None = args.get("end_line")

    if start_line is not None or end_line is not None:
        s = max(1, start_line or 1)
        e = min(total, end_line or total)
        selected = lines[s - 1:e]
        numbered = "\n".join(f"{s + i:>5} | {l}" for i, l in enumerate(selected))
        header = f"[{path_str} lines {s}–{e} of {total}]\n"
        return header + numbered
    else:
        numbered = "\n".join(f"{i + 1:>5} | {l}" for i, l in enumerate(lines))
        header = f"[{path_str} — {total} lines]\n"
        suffix = f"\n\n[truncated — file is {len(raw)} bytes]" if truncated else ""
        return header + numbered + suffix


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


def _fetch_url(args: dict[str, Any]) -> str:
    url: str = args.get("url", "").strip()
    dynamic: bool = args.get("dynamic", False)
    if not url:
        raise ValueError("url is required")

    _MAX_CHARS = 8000

    try:
        if dynamic:
            from scrapling.fetchers import DynamicFetcher
            f = DynamicFetcher()
            r = f.get(url, timeout=20)
        else:
            from scrapling.fetchers import Fetcher
            f = Fetcher()
            r = f.get(url, timeout=15)

        if r.status >= 400:
            return f"Error: HTTP {r.status} for {url}"

        # Try to get markdown-like text, fall back to raw text
        try:
            text = r.get_all_text(ignore_tags=["script", "style", "nav", "footer", "header"])
        except Exception:
            text = r.get_all_text() if hasattr(r, 'get_all_text') else str(r.html)

        if len(text) > _MAX_CHARS:
            text = text[:_MAX_CHARS] + f"\n\n[... truncated — {len(text)} total chars]"

        return f"[{r.status}] {url}\n\n{text.strip()}"

    except Exception as e:
        return f"Error fetching {url}: {e}"


def _web_search(args: dict[str, Any]) -> str:
    query: str = args.get("query", "").strip()
    max_results: int = min(int(args.get("max_results", 5)), 10)
    if not query:
        raise ValueError("query is required")

    try:
        from scrapling.fetchers import Fetcher
        f = Fetcher()
        # Use DuckDuckGo HTML (no JS required, no API key)
        search_url = f"https://html.duckduckgo.com/html/?q={query.replace(' ', '+')}"
        r = f.get(search_url, timeout=15)

        results = []
        # Parse DDG HTML results
        result_divs = r.css(".result")
        for div in result_divs[:max_results]:
            title_els = div.css(".result__title a")
            snippet_els = div.css(".result__snippet")
            if not title_els:
                continue
            title_el = title_els[0]
            title = title_el.text.strip()
            href = title_el.attrib.get("href", "")
            snippet = snippet_els[0].text.strip() if snippet_els else ""
            # DDG wraps URLs — extract actual URL
            if "uddg=" in href:
                import urllib.parse
                parsed = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
                href = parsed.get("uddg", [href])[0]
            results.append(f"**{title}**\n{href}\n{snippet}")

        if not results:
            return f"No results found for: {query}"

        return f"Search results for: {query}\n\n" + "\n\n---\n\n".join(results)

    except Exception as e:
        return f"Error searching '{query}': {e}"


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
