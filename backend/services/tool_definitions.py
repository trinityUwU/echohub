"""
tool_definitions.py — OpenAI function calling tool definitions for EchoHub dev mode.
Re-exported by tool_service for backward compat.
"""
from __future__ import annotations

from typing import Any


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
    {
        "type": "function",
        "function": {
            "name": "search_memory",
            "description": "Search your semantic memory for relevant past knowledge across conversations. Use before answering questions about past decisions, preferences, or recurring topics.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to look for"},
                    "scope": {
                        "type": "string",
                        "enum": ["global", "conversation", "project"],
                        "description": "Search scope. 'global' searches across all sessions. 'conversation' limits to current conv. 'project' limits to current project. Default: global.",
                        "default": "global",
                    },
                    "limit": {"type": "integer", "description": "Max results to return (1-10). Default: 5.", "default": 5},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "store_memory",
            "description": "Save an important fact, decision, preference, or lesson to your persistent memory. Use when the user shares something worth remembering across sessions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "What to remember"},
                    "type": {
                        "type": "string",
                        "enum": ["user_trait", "decision", "fact", "context", "error_learned"],
                        "description": "Memory category: user_trait (preferences/habits), decision (technical/product choices), fact (factual knowledge), context (project context), error_learned (mistakes to avoid)",
                    },
                    "importance": {"type": "integer", "description": "Importance 1-10. Use 7+ for things that should surface often.", "default": 5},
                },
                "required": ["content", "type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "invoke_agent",
            "description": "Delegate an isolated subtask to a sub-agent running on the same loaded model with a clean context. Use for tasks that are self-contained: reading/analyzing files, producing a structured output, running a validation. The sub-agent has no access to the current conversation context — include everything it needs in the task brief.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {"type": "string", "description": "Complete self-contained brief for the sub-agent. Include all necessary context, expected output format, and constraints."},
                    "harness": {
                        "type": "string",
                        "enum": ["read_strict", "write_validated", "shell_safe", "web_research"],
                        "description": "Tool set profile. 'read_strict': read-only (find, read, grep). 'write_validated': read + file edits with validation. 'shell_safe': read + write + restricted shell. 'web_research': web_search + fetch_url for deep web research. Default: read_strict.",
                        "default": "read_strict",
                    },
                },
                "required": ["task"],
            },
        },
    },
]


def get_tools(enabled: list[str] | None = None) -> list[dict[str, Any]]:
    """Return tools, optionally filtered to the enabled set."""
    if enabled is None:
        return TOOLS
    return [t for t in TOOLS if t["function"]["name"] in enabled]
