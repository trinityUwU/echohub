"""
mcp_client.py — Bridge between EchoHub tool execution and MCP HTTP servers.
MCP servers expose tools via POST /api/mcp using JSON-RPC 2.0 or StreamableHTTP transport.
"""
from __future__ import annotations

import json
from typing import Any

import httpx
from loguru import logger

# ──────────────────────────────────────────────────────────────────────────────
# In-memory tool registry: skill_id → list of tool names
# Populated lazily by list_mcp_tools(); invalidated on server restart.
# ──────────────────────────────────────────────────────────────────────────────
_tool_registry: dict[str, list[str]] = {}   # skill_id → [tool_name, ...]
_tools_cache: dict[str, list[dict]] = {}    # skill_id → OpenAI-format tool defs

_MCP_TIMEOUT = 30.0

# ──────────────────────────────────────────────────────────────────────────────
# DB helpers
# ──────────────────────────────────────────────────────────────────────────────

def _get_all_running_servers() -> list[dict]:
    """Return all MCP server rows with status='running'."""
    try:
        from backend.services.db import get_running_mcp_servers
        return get_running_mcp_servers()
    except Exception as e:
        logger.warning(f"[mcp_client] could not fetch running MCP servers: {e}")
        return []


def _get_server(skill_id: str) -> dict | None:
    """Return MCP server row by skill_id, or None."""
    try:
        from backend.services.db import get_mcp_server
        return get_mcp_server(skill_id)
    except Exception as e:
        logger.warning(f"[mcp_client] could not fetch MCP server {skill_id!r}: {e}")
        return None


# ──────────────────────────────────────────────────────────────────────────────
# Core: call a single tool on an MCP server
# ──────────────────────────────────────────────────────────────────────────────

async def call_mcp_tool(skill_id: str, tool_name: str, arguments: dict) -> str:
    """
    Forward a tool call to a running MCP server.
    Returns a string result (or an error string).
    """
    server = _get_server(skill_id)
    if server is None:
        return f"Error: MCP server '{skill_id}' not found."
    if server.get("status") != "running":
        return f"Error: MCP server '{skill_id}' is not running. Start it first."

    port: int = server["port"]
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }

    async with httpx.AsyncClient(timeout=_MCP_TIMEOUT) as client:
        # Try /api/mcp first, fall back to /mcp
        for endpoint in ("/api/mcp", "/mcp"):
            url = f"http://localhost:{port}{endpoint}"
            try:
                resp = await client.post(
                    url,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json, text/event-stream",
                    },
                )
                if resp.status_code == 404 and endpoint == "/api/mcp":
                    continue  # try /mcp
                resp.raise_for_status()

                # Handle SSE response
                if "text/event-stream" in resp.headers.get("content-type", ""):
                    return _parse_sse_result(resp.text)

                data = resp.json()
                return _extract_result(data)

            except httpx.HTTPStatusError as e:
                if endpoint == "/api/mcp":
                    continue
                return f"Error: MCP server '{skill_id}' returned HTTP {e.response.status_code}"
            except httpx.ConnectError:
                return f"Error: MCP server '{skill_id}' is not reachable on port {port}."
            except Exception as e:
                if endpoint == "/api/mcp":
                    continue
                logger.error(f"[mcp_client] call_mcp_tool {skill_id}/{tool_name}: {e}")
                return f"Error: {e}"

    return f"Error: MCP server '{skill_id}' did not respond on any known endpoint."


def _extract_result(data: dict) -> str:
    """Parse JSON-RPC 2.0 response and return content as string."""
    if "error" in data:
        err = data["error"]
        msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
        return f"Error: {msg}"

    result = data.get("result", data)
    if isinstance(result, dict):
        content = result.get("content")
        if isinstance(content, list) and content:
            first = content[0]
            if isinstance(first, dict):
                return first.get("text", json.dumps(first))
            return str(first)
        if content is not None:
            return str(content)
        # No content key — return entire result as JSON
        return json.dumps(result)

    return str(result)


def _parse_sse_result(text: str) -> str:
    """Extract last data event from SSE stream."""
    last_data = None
    for line in text.splitlines():
        if line.startswith("data: "):
            last_data = line[6:].strip()
    if last_data is None:
        return text
    try:
        return _extract_result(json.loads(last_data))
    except json.JSONDecodeError:
        return last_data


# ──────────────────────────────────────────────────────────────────────────────
# Tool discovery
# ──────────────────────────────────────────────────────────────────────────────

async def list_mcp_tools(skill_id: str) -> list[dict]:
    """
    Query the MCP server for its tool list, cache it, and return OpenAI-format defs.
    """
    if skill_id in _tools_cache:
        return _tools_cache[skill_id]

    server = _get_server(skill_id)
    if server is None or server.get("status") != "running":
        return []

    port: int = server["port"]
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}

    async with httpx.AsyncClient(timeout=_MCP_TIMEOUT) as client:
        for endpoint in ("/api/mcp", "/mcp"):
            url = f"http://localhost:{port}{endpoint}"
            try:
                resp = await client.post(url, json=payload)
                if resp.status_code == 404 and endpoint == "/api/mcp":
                    continue
                resp.raise_for_status()
                data = resp.json()
                tools_raw = data.get("result", {}).get("tools", [])
                openai_tools = [_mcp_tool_to_openai(t, skill_id) for t in tools_raw]

                # Update caches
                _tools_cache[skill_id] = openai_tools
                _tool_registry[skill_id] = [t["function"]["name"] for t in openai_tools]
                return openai_tools
            except Exception as e:
                if endpoint == "/api/mcp":
                    continue
                logger.warning(f"[mcp_client] list_mcp_tools {skill_id}: {e}")
                return []

    return []


def _mcp_tool_to_openai(mcp_tool: dict, skill_id: str) -> dict:
    """Convert MCP tool schema to OpenAI function calling format."""
    name = mcp_tool.get("name", "unknown")
    description = mcp_tool.get("description", "")
    input_schema = mcp_tool.get("inputSchema", {"type": "object", "properties": {}})
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": f"[{skill_id}] {description}",
            "parameters": input_schema,
        },
        "_mcp_skill_id": skill_id,  # internal tag for routing
    }


# ──────────────────────────────────────────────────────────────────────────────
# Registry / routing
# ──────────────────────────────────────────────────────────────────────────────

def is_mcp_tool(tool_name: str, project_id: str) -> tuple[bool, str | None]:
    """
    Check if tool_name belongs to a running MCP server.
    Returns (True, skill_id) or (False, None).

    Uses the in-memory registry built by list_mcp_tools().
    Falls back to DB to check tool_names field if registry is empty.
    """
    # Fast path: already in registry
    for skill_id, names in _tool_registry.items():
        if tool_name in names:
            return (True, skill_id)

    # Slow path: check DB tool_names column (CSV)
    servers = _get_all_running_servers()
    for server in servers:
        tool_names_raw = server.get("tool_names") or ""
        names = [n.strip() for n in tool_names_raw.split(",") if n.strip()]
        if tool_name in names:
            skill_id = server["skill_id"]
            # Seed registry
            if skill_id not in _tool_registry:
                _tool_registry[skill_id] = names
            return (True, skill_id)

    return (False, None)


def invalidate_cache(skill_id: str | None = None) -> None:
    """Invalidate tool cache. Call when an MCP server starts or stops."""
    if skill_id:
        _tools_cache.pop(skill_id, None)
        _tool_registry.pop(skill_id, None)
    else:
        _tools_cache.clear()
        _tool_registry.clear()


async def get_mcp_tools_definitions() -> list[dict]:
    """
    Return combined tool definitions from all running MCP servers.
    Used to inject MCP tools into the model's tool list.
    """
    servers = _get_all_running_servers()
    all_tools: list[dict] = []
    for server in servers:
        skill_id = server["skill_id"]
        tools = await list_mcp_tools(skill_id)
        all_tools.extend(tools)
    return all_tools
