"""
mcp_manager.py — Lifecycle manager for MCP server subprocesses.

Each skill that is an MCP server runs as a subprocess on a dedicated port
in the 38000-38099 range.  The manager handles start/stop/restart, health
checks, PID tracking, log capture, and DB persistence.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import socket
import time
from pathlib import Path
from typing import Any

import aiohttp
import psutil
from loguru import logger

from backend.services import db as _db

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SKILLS_BASE = Path.home() / ".local/share/echohub/skills"
PORT_RANGE = range(38000, 38100)
HEALTH_POLL_INTERVAL = 0.5   # seconds
HEALTH_TIMEOUT = 10.0        # seconds
SIGTERM_GRACE = 3.0          # seconds before SIGKILL


# ---------------------------------------------------------------------------
# Detection helper
# ---------------------------------------------------------------------------

def detect_mcp_server(skill_path: Path) -> dict[str, Any] | None:
    """
    Inspect a skill directory and return MCP server metadata, or None.

    Returns:
        {"start_command": str, "port_hint": int | None, "transport": "http"|"stdio"}
        or None if the skill is not an MCP server.
    """
    if not skill_path.is_dir():
        return None

    start_command: str | None = None
    port_hint: int | None = None
    transport: str = "http"

    # -----------------------------------------------------------------------
    # 1. Claude Code / mcp.json
    # -----------------------------------------------------------------------
    for mcp_cfg_name in ("mcp.json", ".mcp.json"):
        mcp_cfg = skill_path / mcp_cfg_name
        if mcp_cfg.exists():
            try:
                data = json.loads(mcp_cfg.read_text())
                cmd = data.get("command") or data.get("start")
                if cmd:
                    start_command = cmd
                    transport = data.get("transport", "http")
                    port_hint = _extract_port(start_command)
                    return {
                        "start_command": start_command,
                        "port_hint": port_hint,
                        "transport": transport,
                    }
            except Exception:
                pass

    # -----------------------------------------------------------------------
    # 2. package.json — Node/TS MCP servers
    # -----------------------------------------------------------------------
    pkg_json = skill_path / "package.json"
    if pkg_json.exists():
        try:
            pkg = json.loads(pkg_json.read_text())
            deps = {
                **pkg.get("dependencies", {}),
                **pkg.get("devDependencies", {}),
            }
            # Direct MCP SDK dependency
            is_mcp_dep = "@modelcontextprotocol/sdk" in deps or "mcp" in deps

            # Source-level MCP detection: scan TS/JS files for MCP patterns
            # Covers repos that bundle MCP or use it indirectly (e.g. via ai-sdk)
            is_mcp_source = False
            _mcp_source_patterns = [
                r"StreamableHTTPServerTransport",
                r"McpServer|createMcpServer",
                r"from ['\"]@modelcontextprotocol",
                r"require\(['\"]@modelcontextprotocol",
                r"/api/mcp",
            ]
            if not is_mcp_dep:
                for ts_file in list(skill_path.rglob("*.ts"))[:40] + list(skill_path.rglob("*.js"))[:20]:
                    if "node_modules" in str(ts_file) or ".git" in str(ts_file):
                        continue
                    try:
                        txt = ts_file.read_text(errors="ignore")
                        if any(re.search(p, txt) for p in _mcp_source_patterns):
                            is_mcp_source = True
                            break
                    except Exception:
                        pass

            if is_mcp_dep or is_mcp_source:
                scripts = pkg.get("scripts", {})
                raw_cmd = scripts.get("start") or scripts.get("dev") or "bun run start"
                runner = "bun run start" if scripts.get("start") else "bun run dev"
                start_command = runner
                port_hint = _extract_port(raw_cmd) or 3000
                transport = "http"
                return {
                    "start_command": start_command,
                    "port_hint": port_hint,
                    "transport": transport,
                }
        except Exception:
            pass

    # -----------------------------------------------------------------------
    # 3. pyproject.toml / setup.py — Python MCP servers
    # -----------------------------------------------------------------------
    for pyproj in (skill_path / "pyproject.toml", skill_path / "setup.py"):
        if pyproj.exists():
            content = pyproj.read_text(errors="ignore")
            if re.search(r"\bmcp\b", content):
                # Try to find a start script
                candidate: str | None = None
                for fname in ("server.py", "mcp_server.py", "main.py", "app.py"):
                    if (skill_path / fname).exists():
                        candidate = fname
                        break
                if candidate is None:
                    # fallback: look for any .py with mcp patterns
                    for py in skill_path.glob("*.py"):
                        txt = py.read_text(errors="ignore")
                        if "FastMCP" in txt or "mcp.server" in txt or "Server(" in txt:
                            candidate = py.name
                            break
                if candidate:
                    start_command = f"python {candidate}"
                    port_hint = _extract_port(content)
                    transport = "http"
                    return {
                        "start_command": start_command,
                        "port_hint": port_hint,
                        "transport": transport,
                    }

    # -----------------------------------------------------------------------
    # 4. Standalone server files with MCP patterns
    # -----------------------------------------------------------------------
    _MCP_PATTERNS = re.compile(
        r"FastMCP|mcp\.server|@modelcontextprotocol|new Server\(|McpServer",
        re.IGNORECASE,
    )
    for candidate_path in [
        skill_path / "server.py",
        skill_path / "mcp_server.py",
        skill_path / "src" / "server.ts",
        skill_path / "src" / "index.ts",
    ]:
        if candidate_path.exists():
            try:
                content = candidate_path.read_text(errors="ignore")
                if _MCP_PATTERNS.search(content):
                    if candidate_path.suffix == ".ts":
                        start_command = "bun run src/server.ts"
                    else:
                        start_command = f"python {candidate_path.name}"
                    port_hint = _extract_port(content)
                    transport = "http"
                    return {
                        "start_command": start_command,
                        "port_hint": port_hint,
                        "transport": transport,
                    }
            except Exception:
                pass

    return None


def _extract_port(text: str) -> int | None:
    """Extract a port number from a command string or config text."""
    # PORT=XXXX or --port XXXX or -p XXXX
    for pattern in (
        r"PORT[=\s]+(\d{4,5})",
        r"--port[=\s]+(\d{4,5})",
        r"-p\s+(\d{4,5})",
    ):
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            val = int(m.group(1))
            if 1024 < val < 65535:
                return val
    return None


# ---------------------------------------------------------------------------
# Port allocator
# ---------------------------------------------------------------------------

def _find_free_port() -> int:
    """Return the first available port in PORT_RANGE."""
    used_ports = {s["port"] for s in _db.list_mcp_servers() if s.get("port")}
    for port in PORT_RANGE:
        if port in used_ports:
            continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.1)
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("No free port available in range 38000-38099")


# ---------------------------------------------------------------------------
# McpManager
# ---------------------------------------------------------------------------

class McpManager:
    """
    Manages lifecycle of MCP server processes.
    Each MCP server runs as a subprocess on a dedicated port.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        # Map skill_id -> asyncio.subprocess.Process
        self._processes: dict[str, asyncio.subprocess.Process] = {}

    # -----------------------------------------------------------------------
    # Public API
    # -----------------------------------------------------------------------

    async def start(self, skill_id: str) -> dict:
        """Start the MCP server for skill_id. Returns status dict."""
        async with self._lock:
            return await self._start_locked(skill_id)

    async def stop(self, skill_id: str) -> dict:
        """Kill the MCP server process and update DB."""
        async with self._lock:
            return await self._stop_locked(skill_id)

    async def restart(self, skill_id: str) -> dict:
        """Stop then start."""
        await self.stop(skill_id)
        return await self.start(skill_id)

    async def status(self, skill_id: str) -> dict:
        """Return current status from DB + live process check."""
        record = _db.get_mcp_server(skill_id)
        if not record:
            return {"skill_id": skill_id, "status": "unknown"}
        return self._enrich_status(record)

    async def list_all(self) -> list[dict]:
        """All registered MCP servers with live status."""
        servers = _db.list_mcp_servers()
        return [self._enrich_status(s) for s in servers]

    async def start_all_enabled(self) -> None:
        """Called at app startup — start all servers marked auto_start."""
        servers = _db.list_mcp_servers()
        tasks = []
        for s in servers:
            if s.get("auto_start"):
                tasks.append(self.start(s["skill_id"]))
        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for s, r in zip(servers, results):
                if isinstance(r, Exception):
                    logger.error("MCP auto-start failed for {}: {}", s["skill_id"], r)

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    async def _needs_build(self, skill_dir: Path) -> tuple[bool, str | None]:
        """
        Return (needs_build, build_command) for a skill directory.
        - Next.js: .next/ absent → bun run build
        - Python: never needs a separate build step
        - Others: check for a build script in package.json
        """
        pkg_json = skill_dir / "package.json"
        if pkg_json.exists():
            try:
                pkg = json.loads(pkg_json.read_text())
                scripts = pkg.get("scripts", {})
                # Next.js: .next dir is the build output
                if "next" in pkg.get("dependencies", {}) or "next" in pkg.get("devDependencies", {}):
                    if not (skill_dir / ".next").exists():
                        return True, "bun run build"
                    return False, None
                # Generic: has a build script and no dist/out dir
                if "build" in scripts:
                    for dist_dir in ("dist", "out", "build", ".next"):
                        if (skill_dir / dist_dir).exists():
                            return False, None
                    return True, "bun run build"
            except Exception:
                pass
        return False, None

    async def _run_build(self, skill_id: str, skill_dir: Path, build_cmd: str, log_file: Path, env: dict) -> bool:
        """Run build command, stream to log file. Returns True on success."""
        logger.info("[mcp] Building '{}' — {}", skill_id, build_cmd)
        _db.update_mcp_status(skill_id, "starting", error="Building...")
        try:
            with open(log_file, "a") as lf:
                lf.write(f"\n=== BUILD: {build_cmd} ===\n")
                proc = await asyncio.create_subprocess_shell(
                    build_cmd,
                    cwd=str(skill_dir),
                    env=env,
                    stdout=lf,
                    stderr=lf,
                )
            rc = await asyncio.wait_for(proc.wait(), timeout=300)
            if rc != 0:
                err = f"Build failed (exit {rc}) — check {log_file}"
                _db.update_mcp_status(skill_id, "error", error=err)
                logger.error("[mcp] {} build failed (exit {})", skill_id, rc)
                return False
            logger.info("[mcp] {} build succeeded", skill_id)
            return True
        except asyncio.TimeoutError:
            _db.update_mcp_status(skill_id, "error", error="Build timed out (300s)")
            return False
        except Exception as exc:
            _db.update_mcp_status(skill_id, "error", error=f"Build error: {exc}")
            return False

    async def _start_locked(self, skill_id: str) -> dict:
        record = _db.get_mcp_server(skill_id)
        if not record:
            raise ValueError(f"MCP server '{skill_id}' not registered in DB")

        # Already running?
        if self._is_alive(record.get("pid")):
            _db.update_mcp_status(skill_id, "running", last_seen=time.time())
            return _db.get_mcp_server(skill_id)  # type: ignore[return-value]

        port = record["port"]
        start_command = record["start_command"]
        env_json = record.get("env_json")
        skill_dir = SKILLS_BASE / skill_id
        log_file = skill_dir / "mcp.log"
        skill_dir.mkdir(parents=True, exist_ok=True)

        env = {**os.environ}
        if env_json:
            try:
                env.update(json.loads(env_json))
            except Exception:
                pass
        env["PORT"] = str(port)

        # ── Auto-build if needed ───────────────────────────────────────────────
        needs_build, build_cmd = await self._needs_build(skill_dir)
        if needs_build and build_cmd:
            ok = await self._run_build(skill_id, skill_dir, build_cmd, log_file, env)
            if not ok:
                return _db.get_mcp_server(skill_id)  # type: ignore[return-value]

        _db.update_mcp_status(skill_id, "starting", error=None)
        logger.info("Starting MCP server '{}' on port {} — {}", skill_id, port, start_command)

        try:
            log_fd = open(log_file, "a")  # noqa: SIM115 — needed for subprocess
            log_fd.write(f"\n=== START: {start_command} ===\n")
            proc = await asyncio.create_subprocess_shell(
                start_command,
                cwd=str(skill_dir),
                env=env,
                stdout=log_fd,
                stderr=log_fd,
            )
        except Exception as exc:
            _db.update_mcp_status(skill_id, "error", error=str(exc))
            raise

        self._processes[skill_id] = proc
        _db.update_mcp_status(skill_id, "starting", pid=proc.pid)

        # Health check
        healthy = await self._wait_healthy(port)
        if healthy:
            _db.update_mcp_status(skill_id, "running", pid=proc.pid, last_seen=time.time())
            logger.info("MCP server '{}' is running (pid={})", skill_id, proc.pid)
        else:
            # Read last log lines for a useful error message
            try:
                last_lines = log_file.read_text(errors="replace").splitlines()[-15:]
                error_hint = "\n".join(last_lines).strip() or "health check timeout"
            except Exception:
                error_hint = "health check timeout"
            _db.update_mcp_status(skill_id, "error", error=error_hint)
            logger.warning("MCP server '{}' did not become healthy", skill_id)

        return _db.get_mcp_server(skill_id)  # type: ignore[return-value]

    async def _stop_locked(self, skill_id: str) -> dict:
        record = _db.get_mcp_server(skill_id)
        proc = self._processes.get(skill_id)
        pid = record.get("pid") if record else None

        async def _kill_pid(p: int) -> None:
            try:
                os.kill(p, signal.SIGTERM)
                await asyncio.sleep(SIGTERM_GRACE)
                if psutil.pid_exists(p):
                    os.kill(p, signal.SIGKILL)
            except ProcessLookupError:
                pass

        if proc and proc.returncode is None:
            try:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=SIGTERM_GRACE)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
            except Exception as exc:
                logger.warning("Error stopping MCP '{}': {}", skill_id, exc)
            self._processes.pop(skill_id, None)
        elif pid and psutil.pid_exists(pid):
            await _kill_pid(pid)

        if record:
            _db.update_mcp_status(skill_id, "stopped", pid=None)
            logger.info("MCP server '{}' stopped", skill_id)
            return _db.get_mcp_server(skill_id)  # type: ignore[return-value]
        return {"skill_id": skill_id, "status": "stopped"}

    async def _wait_healthy(self, port: int) -> bool:
        """Poll port until a response is received or timeout."""
        url_candidates = [
            f"http://127.0.0.1:{port}/health",
            f"http://127.0.0.1:{port}/",
        ]
        deadline = time.monotonic() + HEALTH_TIMEOUT
        async with aiohttp.ClientSession() as session:
            while time.monotonic() < deadline:
                for url in url_candidates:
                    try:
                        async with session.get(url, timeout=aiohttp.ClientTimeout(total=0.5)) as resp:
                            if resp.status < 500:
                                return True
                    except Exception:
                        pass
                await asyncio.sleep(HEALTH_POLL_INTERVAL)
        return False

    def _is_alive(self, pid: int | None) -> bool:
        if not pid:
            return False
        return psutil.pid_exists(pid)

    def _enrich_status(self, record: dict) -> dict:
        """Add live `alive` flag based on PID check."""
        pid = record.get("pid")
        alive = self._is_alive(pid)
        # Reconcile stale 'running' entries
        if record.get("status") == "running" and not alive:
            record = dict(record, status="stopped")
            _db.update_mcp_status(record["skill_id"], "stopped")
        return {**record, "alive": alive}


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

mcp_manager = McpManager()
