"""
mcp_stdio_client.py — JSON-RPC 2.0 over stdio for MCP servers.

Manages persistent subprocesses that communicate via stdin/stdout.
Each skill_id gets one long-lived process; calls are serialized per client.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

from loguru import logger

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CALL_TIMEOUT = 120.0         # seconds per JSON-RPC call (network tools can be slow)
SHUTDOWN_TIMEOUT = 5.0       # seconds to wait for clean shutdown response
SIGTERM_GRACE = 3.0          # seconds before SIGKILL

# ---------------------------------------------------------------------------
# Singleton pool
# ---------------------------------------------------------------------------

_stdio_clients: dict[str, "McpStdioClient"] = {}


async def get_or_create(skill_id: str, command_parts: list[str], cwd: str | None = None) -> "McpStdioClient":
    """Return existing client or spawn a new one and run initialize."""
    if skill_id in _stdio_clients:
        client = _stdio_clients[skill_id]
        if client.is_alive():
            return client
        # Process died — remove and recreate
        logger.warning("[stdio] client for '{}' is dead, recreating", skill_id)
        _stdio_clients.pop(skill_id, None)

    client = McpStdioClient(skill_id, command_parts, cwd=cwd)
    await client.start()
    _stdio_clients[skill_id] = client
    return client


async def stop(skill_id: str) -> None:
    """Gracefully stop and remove the client for skill_id."""
    client = _stdio_clients.pop(skill_id, None)
    if client:
        await client.stop()


def get_client(skill_id: str) -> "McpStdioClient | None":
    """Return existing client without creating one."""
    return _stdio_clients.get(skill_id)


# ---------------------------------------------------------------------------
# McpStdioClient
# ---------------------------------------------------------------------------

class McpStdioClient:
    """
    Manages a single MCP subprocess communicating via stdio JSON-RPC 2.0.

    Protocol: one JSON object per line on stdout (newline-delimited JSON).
    Requests are serialized — one in-flight at a time per client.
    """

    def __init__(self, skill_id: str, command_parts: list[str], cwd: str | None = None) -> None:
        self.skill_id = skill_id
        self.command_parts = command_parts
        self.cwd = cwd
        self._proc: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._call_id = 0
        self._initialized = False

    # -----------------------------------------------------------------------
    # Lifecycle
    # -----------------------------------------------------------------------

    async def start(self) -> None:
        """Spawn subprocess and run MCP initialize handshake."""
        logger.info("[stdio] starting '{}' — {}", self.skill_id, " ".join(self.command_parts))
        try:
            # limit=8MB — default 64KB is too small for large MCP responses (e.g. search_papers)
            reader_limit = 8 * 1024 * 1024
            self._proc = await asyncio.create_subprocess_exec(
                *self.command_parts,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.cwd,
                limit=reader_limit,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                f"[stdio] could not launch '{self.skill_id}': {exc}"
            ) from exc

        logger.info("[stdio] '{}' spawned with pid={}", self.skill_id, self._proc.pid)
        await self._initialize()

    async def stop(self) -> None:
        """Send shutdown request then terminate process."""
        if not self._proc:
            return

        # Try clean shutdown
        try:
            await asyncio.wait_for(
                self._send_shutdown(),
                timeout=SHUTDOWN_TIMEOUT,
            )
        except Exception as exc:
            logger.debug("[stdio] '{}' shutdown request failed (ok): {}", self.skill_id, exc)

        proc = self._proc
        self._proc = None
        self._initialized = False

        if proc.returncode is None:
            try:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=SIGTERM_GRACE)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
            except Exception as exc:
                logger.warning("[stdio] error killing '{}': {}", self.skill_id, exc)

        logger.info("[stdio] '{}' stopped", self.skill_id)

    def is_alive(self) -> bool:
        """Return True if the subprocess is still running."""
        return self._proc is not None and self._proc.returncode is None

    @property
    def pid(self) -> int | None:
        return self._proc.pid if self._proc else None

    # -----------------------------------------------------------------------
    # MCP protocol methods
    # -----------------------------------------------------------------------

    async def list_tools(self) -> list[dict]:
        """Send tools/list and return the list of tool objects."""
        resp = await self._call("tools/list", {})
        result = resp.get("result", {})
        return result.get("tools", [])

    async def call_tool(self, name: str, arguments: dict) -> str:
        """Send tools/call and return the result as a string."""
        resp = await self._call(
            "tools/call",
            {"name": name, "arguments": arguments},
        )
        return _extract_result(resp)

    # -----------------------------------------------------------------------
    # Internal JSON-RPC machinery
    # -----------------------------------------------------------------------

    async def _initialize(self) -> None:
        """Send MCP initialize + notifications/initialized."""
        resp = await self._call(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "echohub", "version": "1.0"},
            },
        )
        if "error" in resp:
            raise RuntimeError(
                f"[stdio] initialize failed for '{self.skill_id}': {resp['error']}"
            )
        # Send the required initialized notification (no response expected)
        await self._send_notification("notifications/initialized", {})
        self._initialized = True
        logger.info(
            "[stdio] '{}' initialized — server: {}",
            self.skill_id,
            resp.get("result", {}).get("serverInfo", {}),
        )

    async def _send_shutdown(self) -> None:
        """Send shutdown request (best-effort, ignore response)."""
        self._call_id += 1
        msg = json.dumps({"jsonrpc": "2.0", "id": self._call_id, "method": "shutdown", "params": {}})
        if self._proc and self._proc.stdin and not self._proc.stdin.is_closing():
            self._proc.stdin.write((msg + "\n").encode())
            await self._proc.stdin.drain()

    async def _send_notification(self, method: str, params: dict) -> None:
        """Send a JSON-RPC notification (no id, no response expected)."""
        msg = json.dumps({"jsonrpc": "2.0", "method": method, "params": params})
        if self._proc and self._proc.stdin and not self._proc.stdin.is_closing():
            self._proc.stdin.write((msg + "\n").encode())
            await self._proc.stdin.drain()

    async def _call(self, method: str, params: dict) -> dict:
        """
        Send a JSON-RPC request and wait for the matching response.
        Serialized via asyncio.Lock — one in-flight at a time.
        """
        async with self._lock:
            if not self._proc or self._proc.returncode is not None:
                raise RuntimeError(f"[stdio] process for '{self.skill_id}' is not running")

            self._call_id += 1
            call_id = self._call_id
            request = json.dumps(
                {"jsonrpc": "2.0", "id": call_id, "method": method, "params": params}
            )

            assert self._proc.stdin is not None
            assert self._proc.stdout is not None

            self._proc.stdin.write((request + "\n").encode())
            await self._proc.stdin.drain()

            return await asyncio.wait_for(
                self._read_response(call_id),
                timeout=CALL_TIMEOUT,
            )

    async def _read_response(self, expected_id: int) -> dict:
        """
        Read lines from stdout until we find a JSON-RPC response matching expected_id.
        Skip notifications and responses for other ids.
        """
        assert self._proc and self._proc.stdout is not None
        while True:
            try:
                raw = await self._proc.stdout.readline()
            except Exception as exc:
                raise RuntimeError(
                    f"[stdio] read error on '{self.skill_id}': {exc}"
                ) from exc

            if not raw:
                raise RuntimeError(
                    f"[stdio] stdout closed unexpectedly for '{self.skill_id}'"
                )

            line = raw.decode(errors="replace").strip()
            if not line:
                continue

            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                logger.debug("[stdio] '{}' non-JSON line: {}", self.skill_id, line[:200])
                continue

            # Skip notifications (no "id" field)
            if "id" not in data:
                continue

            if data["id"] == expected_id:
                return data

            # Response for a different id — shouldn't happen with our lock, but log it
            logger.warning(
                "[stdio] '{}' unexpected response id={} (expected {})",
                self.skill_id, data.get("id"), expected_id,
            )


# ---------------------------------------------------------------------------
# Result extraction (shared with mcp_client.py pattern)
# ---------------------------------------------------------------------------

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
        return json.dumps(result)

    return str(result)
