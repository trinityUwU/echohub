"""
skills.py — Community skill install/manage router.
Skills are cloned into ~/.local/share/echohub/skills/{skill_id}/
Each skill can declare its install instructions via echohub.yml or skill.yml.
Auto-detection fallback: package.json → bun install, pyproject.toml/setup.py → pip install,
requirements.txt → pip install -r, *.sh → chmod+exec.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

router = APIRouter(prefix="/skills", tags=["skills"])

SKILLS_DIR = Path.home() / ".local" / "share" / "echohub" / "skills"
REGISTRY_FILE = SKILLS_DIR / "registry.json"

# ── Native skills (built-in, read-only) ───────────────────────────────────────

NATIVE_SKILLS = [
    {
        "id": "web-search",
        "name": "Web Search",
        "description": "Fetch URLs and search the web using Scrapling. Exposes fetch_url and web_search tools.",
        "tools": ["fetch_url", "web_search"],
        "type": "native",
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": "Web search: use web_search to find URLs, fetch_url to read pages. Always search before fetching.",
        "version": "built-in",
        "author": "EchoHub",
    },
    {
        "id": "code-runner",
        "name": "Code Runner",
        "description": "Execute shell commands in the project workspace via run_command.",
        "tools": ["run_command"],
        "type": "native",
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": "Code runner: use run_command to execute shell commands, run scripts, validate code.",
        "version": "built-in",
        "author": "EchoHub",
    },
    {
        "id": "file-system",
        "name": "File System",
        "description": "Full workspace file management: create, read, edit, delete, list files.",
        "tools": ["create_file", "read_file", "edit_file", "delete_file", "list_files", "get_workspace_info"],
        "type": "native",
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": "File system: use create_file, read_file, edit_file, delete_file, list_files to manage workspace files.",
        "version": "built-in",
        "author": "EchoHub",
    },
    {
        "id": "calculator",
        "name": "Calculator",
        "description": "Precise arithmetic via python3 -c. Avoids floating point errors in LLM math.",
        "tools": ["run_command"],
        "type": "native",
        "storage": "Built-in (backend/services/tool_service.py)",
        "awareness": "Calculator: for precise math, run python3 -c \"print(expression)\" via run_command.",
        "version": "built-in",
        "author": "EchoHub",
    },
]


# ── Registry helpers ───────────────────────────────────────────────────────────

def _load_registry() -> list[dict[str, Any]]:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    if not REGISTRY_FILE.exists():
        return []
    try:
        return json.loads(REGISTRY_FILE.read_text())
    except Exception:
        return []


def _save_registry(entries: list[dict[str, Any]]) -> None:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    REGISTRY_FILE.write_text(json.dumps(entries, indent=2))


# ── Auto-detect install strategy ──────────────────────────────────────────────

def _detect_install_commands(skill_dir: Path) -> list[str]:
    """
    Return install commands in priority order:
    1. `install` key in package.json[echohub] or pyproject.toml[tool.echohub]
    2. Standard package manager: bun install (package.json), pip install (pyproject/setup/requirements)
    3. Shell script fallback
    """
    cmds: list[str] = []

    # JS/TS: package.json is the standard
    pkg_path = skill_dir / "package.json"
    if pkg_path.exists():
        try:
            pkg = json.loads(pkg_path.read_text())
            # Custom install override via echohub namespace
            override = (pkg.get("echohub") or {}).get("install")
            if isinstance(override, list):
                return override
            if isinstance(override, str):
                return [override]
        except Exception:
            pass
        cmds.append("bun install")
        try:
            pkg = json.loads(pkg_path.read_text())
            scripts = pkg.get("scripts") or {}
            if "build" in scripts:
                cmds.append("bun run build")
            elif "prepare" in scripts:
                cmds.append("bun run prepare")
        except Exception:
            pass
        return cmds

    # Python: pyproject.toml is the standard (PEP 517/518)
    if (skill_dir / "pyproject.toml").exists() or (skill_dir / "setup.py").exists():
        cmds.append(f"{sys.executable} -m pip install -e . --quiet")
        return cmds

    # requirements.txt fallback
    if (skill_dir / "requirements.txt").exists():
        cmds.append(f"{sys.executable} -m pip install -r requirements.txt --quiet")
        return cmds

    # Shell script last resort
    for sh in sorted(skill_dir.glob("install*.sh")):
        cmds.append(f"bash {sh.name}")
        return cmds

    return cmds


def _read_manifest(skill_dir: Path) -> dict[str, Any]:
    """
    Read skill metadata. Priority:
    1. package.json → `echohub` field (JS/TS standard)
    2. pyproject.toml → [tool.echohub] section (Python standard)
    3. Top-level package.json fields (name, description, version, author)
    """
    # JS/TS: read package.json with echohub namespace
    pkg_path = skill_dir / "package.json"
    if pkg_path.exists():
        try:
            pkg = json.loads(pkg_path.read_text())
            echohub = pkg.get("echohub") or {}
            return {
                "name": echohub.get("name") or pkg.get("name"),
                "description": echohub.get("description") or pkg.get("description"),
                "version": pkg.get("version"),
                "author": _extract_author(pkg.get("author")),
                "tools": echohub.get("tools") or [],
                "awareness": echohub.get("awareness") or "",
            }
        except Exception:
            pass

    # Python: read pyproject.toml [tool.echohub] section
    pyproject_path = skill_dir / "pyproject.toml"
    if pyproject_path.exists():
        try:
            # tomllib available in Python 3.11+, fallback to manual parse
            try:
                import tomllib
                data = tomllib.loads(pyproject_path.read_text())
            except ImportError:
                import tomli  # type: ignore
                data = tomli.loads(pyproject_path.read_text())
            meta = (data.get("project") or {})
            echohub = (data.get("tool") or {}).get("echohub") or {}
            return {
                "name": echohub.get("name") or meta.get("name"),
                "description": echohub.get("description") or meta.get("description"),
                "version": meta.get("version"),
                "author": _extract_author(next(iter(meta.get("authors") or []), None)),
                "tools": echohub.get("tools") or [],
                "awareness": echohub.get("awareness") or "",
            }
        except Exception:
            pass

    return {}


def _extract_author(raw: Any) -> str:
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        return raw.get("name") or raw.get("email") or ""
    return ""


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_skills() -> dict[str, Any]:
    community = _load_registry()
    return {"native": NATIVE_SKILLS, "community": community}


class InstallRequest(BaseModel):
    repo_url: str
    skill_id: str | None = None


@router.post("/install")
async def install_skill(req: InstallRequest) -> StreamingResponse:
    """
    Clone a GitHub repo and run install commands, streaming output line by line.
    Uses asyncio subprocesses so every line is flushed immediately.
    """
    import asyncio

    skill_id = req.skill_id or str(uuid.uuid4())[:8]
    if not req.skill_id:
        repo_name = req.repo_url.rstrip("/").split("/")[-1].replace(".git", "")
        skill_id = repo_name.lower().replace(" ", "-")

    target_dir = SKILLS_DIR / skill_id

    async def _run(cmd: list[str] | str, cwd: str | None = None) -> int:
        """Run a command, streaming stdout+stderr line by line. Returns exit code."""
        if isinstance(cmd, str):
            proc = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=cwd,
            )
        else:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=cwd,
            )
        return proc

    async def _stream():
        import asyncio as _asyncio

        def sse(msg: str) -> str:
            # Sanitize: newlines inside a message break SSE framing
            return f"data: {msg.rstrip()}\n\n"

        yield sse(f"Starting install: {req.repo_url}")

        # Conflict check
        if target_dir.exists():
            yield sse(f"Directory already exists — removing and re-cloning")
            await _asyncio.get_event_loop().run_in_executor(None, shutil.rmtree, str(target_dir))

        SKILLS_DIR.mkdir(parents=True, exist_ok=True)

        # ── Clone ─────────────────────────────────────────────────────────────
        yield sse(f"Cloning {req.repo_url} ...")
        try:
            proc = await _asyncio.create_subprocess_exec(
                "git", "clone", "--depth=1", "--progress", req.repo_url, str(target_dir),
                stdout=_asyncio.subprocess.PIPE,
                stderr=_asyncio.subprocess.STDOUT,
            )
            async for raw in proc.stdout:
                line = raw.decode(errors="replace").rstrip()
                if line:
                    yield sse(line)
            rc = await _asyncio.wait_for(proc.wait(), timeout=120)
            if rc != 0:
                yield sse("ERROR: git clone failed")
                yield sse("INSTALL_FAILED")
                return
        except _asyncio.TimeoutError:
            yield sse("ERROR: git clone timed out (120s)")
            yield sse("INSTALL_FAILED")
            return
        except Exception as e:
            yield sse(f"ERROR: {e}")
            yield sse("INSTALL_FAILED")
            return

        yield sse("Clone complete ✓")

        # Read manifest
        manifest = _read_manifest(target_dir)
        display_name = manifest.get("name") or skill_id
        description = manifest.get("description") or "Community skill"
        version = manifest.get("version") or "unknown"
        url_parts = req.repo_url.replace(".git", "").rstrip("/").split("/")
        author = manifest.get("author") or (url_parts[-2] if len(url_parts) >= 2 else "unknown")
        tools = manifest.get("tools") or []
        awareness = manifest.get("awareness") or ""

        # ── Install commands ──────────────────────────────────────────────────
        cmds = _detect_install_commands(target_dir)
        if cmds:
            yield sse(f"Running {len(cmds)} install command(s)...")
            for cmd in cmds:
                yield sse(f"$ {cmd}")
                try:
                    proc = await _asyncio.create_subprocess_shell(
                        cmd,
                        stdout=_asyncio.subprocess.PIPE,
                        stderr=_asyncio.subprocess.STDOUT,
                        cwd=str(target_dir),
                    )
                    async for raw in proc.stdout:
                        line = raw.decode(errors="replace").rstrip()
                        if line:
                            yield sse(line)
                    rc = await _asyncio.wait_for(proc.wait(), timeout=300)
                    if rc != 0:
                        yield sse(f"ERROR: command exited with code {rc}")
                        yield sse("INSTALL_FAILED")
                        return
                    yield sse(f"✓ done")
                except _asyncio.TimeoutError:
                    yield sse("ERROR: command timed out (300s)")
                    yield sse("INSTALL_FAILED")
                    return
                except Exception as e:
                    yield sse(f"ERROR: {e}")
                    yield sse("INSTALL_FAILED")
                    return
        else:
            yield sse("No install commands detected — registering as-is")

        # ── Register ──────────────────────────────────────────────────────────
        entry: dict[str, Any] = {
            "id": skill_id,
            "name": display_name,
            "description": description,
            "version": version,
            "author": author,
            "repo_url": req.repo_url,
            "path": str(target_dir),
            "tools": tools,
            "awareness": awareness,
            "type": "community",
        }
        registry = _load_registry()
        registry = [r for r in registry if r["id"] != skill_id]
        registry.append(entry)
        _save_registry(registry)

        yield sse(f"Skill '{display_name}' installed successfully ✓")
        yield sse(f"INSTALL_DONE:{skill_id}")

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/{skill_id}")
def delete_skill(skill_id: str) -> dict[str, str]:
    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")

    target_dir = Path(entry["path"])
    if target_dir.exists():
        shutil.rmtree(target_dir)

    registry = [r for r in registry if r["id"] != skill_id]
    _save_registry(registry)
    logger.info(f"[skills] deleted {skill_id}")
    return {"status": "deleted", "id": skill_id}


class SkillPatchRequest(BaseModel):
    tools: list[str] | None = None
    awareness: str | None = None
    name: str | None = None
    description: str | None = None


@router.patch("/{skill_id}")
def patch_skill(skill_id: str, req: SkillPatchRequest) -> dict[str, Any]:
    """Update tools/awareness/name/description of a community skill."""
    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
    if req.tools is not None:
        entry["tools"] = req.tools
    if req.awareness is not None:
        entry["awareness"] = req.awareness
    if req.name is not None:
        entry["name"] = req.name
    if req.description is not None:
        entry["description"] = req.description
    registry = [r if r["id"] != skill_id else entry for r in registry]
    _save_registry(registry)
    return entry


# ── MCP lifecycle routes ──────────────────────────────────────────────────────
# NOTE: GET /skills/mcp/all uses a literal segment — must come before /{skill_id}
# routes to avoid routing conflicts.

@router.get("/mcp/all")
async def list_all_mcp_servers() -> list[dict[str, Any]]:
    """List all MCP servers tracked by mcp_manager with their current status."""
    try:
        from backend.services.mcp_manager import mcp_manager
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"mcp_manager not available: {e}")
    try:
        return await mcp_manager.list_all()
    except Exception as e:
        logger.error(f"[mcp] list_all error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{skill_id}/detect-mcp")
async def detect_mcp(skill_id: str) -> dict[str, Any]:
    """
    Detect whether a community skill is an MCP server and what command starts it.
    Saves `is_mcp` (and start_command / transport / port_hint when found) to the registry.
    """
    try:
        from backend.services.mcp_manager import detect_mcp_server
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"mcp_manager not available: {e}")

    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")

    skill_path = Path(entry["path"])
    if not skill_path.exists():
        raise HTTPException(status_code=404, detail="Skill directory not found on disk")

    detected = detect_mcp_server(skill_path)
    is_mcp = detected is not None

    # Persist detection result into registry entry
    entry["is_mcp"] = is_mcp
    if detected:
        entry["mcp_start_command"] = detected.get("start_command")
        entry["mcp_transport"] = detected.get("transport")
        entry["mcp_port_hint"] = detected.get("port_hint")

    registry = [r if r["id"] != skill_id else entry for r in registry]
    _save_registry(registry)
    logger.info(f"[mcp] detect-mcp {skill_id}: is_mcp={is_mcp}")

    if is_mcp:
        transport = detected.get("transport")
        cmd = detected.get("start_command")
        port = detected.get("port_hint")
        detail = (
            f"MCP server detected — transport: {transport}, "
            f"start command: {cmd}"
            + (f", port hint: {port}" if port else "")
        )
    else:
        detail = "No MCP server detected in this skill (no @modelcontextprotocol/sdk, mcp package, or MCP entry point found)"

    return {
        "is_mcp": is_mcp,
        "transport": detected.get("transport") if detected else None,
        "start_command": detected.get("start_command") if detected else None,
        "port_hint": detected.get("port_hint") if detected else None,
        "detail": detail,
    }


@router.post("/{skill_id}/mcp/start")
async def start_mcp_server(skill_id: str) -> dict[str, Any]:
    """Start the MCP server process for a skill."""
    try:
        from backend.services.mcp_manager import mcp_manager, detect_mcp_server
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"mcp_manager not available: {e}")

    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")

    # Auto-detect if is_mcp not yet set
    if "is_mcp" not in entry:
        skill_path = Path(entry["path"])
        detected = detect_mcp_server(skill_path)
        entry["is_mcp"] = detected is not None
        if detected:
            entry["mcp_start_command"] = detected.get("start_command")
            entry["mcp_transport"] = detected.get("transport")
            entry["mcp_port_hint"] = detected.get("port_hint")
        registry = [r if r["id"] != skill_id else entry for r in registry]
        _save_registry(registry)

    if not entry.get("is_mcp"):
        raise HTTPException(
            status_code=422,
            detail=f"Skill '{skill_id}' is not an MCP server. Run POST /skills/{skill_id}/detect-mcp first.",
        )

    if not entry.get("mcp_start_command"):
        raise HTTPException(
            status_code=422,
            detail="No start_command configured. Run detect-mcp or configure-mcp first.",
        )

    try:
        result = await mcp_manager.start(skill_id)
        logger.info(f"[mcp] started {skill_id}: {result}")
        return result
    except Exception as e:
        logger.error(f"[mcp] start error {skill_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{skill_id}/mcp/stop")
async def stop_mcp_server(skill_id: str) -> dict[str, Any]:
    """Stop the MCP server process for a skill."""
    try:
        from backend.services.mcp_manager import mcp_manager
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"mcp_manager not available: {e}")

    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")

    try:
        result = await mcp_manager.stop(skill_id)
        logger.info(f"[mcp] stopped {skill_id}: {result}")
        return result
    except Exception as e:
        logger.error(f"[mcp] stop error {skill_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{skill_id}/mcp/status")
async def get_mcp_status(skill_id: str) -> dict[str, Any]:
    """Get the current runtime status of a skill's MCP server."""
    try:
        from backend.services.mcp_manager import mcp_manager
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"mcp_manager not available: {e}")

    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")

    try:
        return mcp_manager.status(skill_id)
    except Exception as e:
        logger.error(f"[mcp] status error {skill_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class McpConfigureRequest(BaseModel):
    start_command: str | None = None
    port: int | None = None
    env: dict[str, str] | None = None


@router.post("/{skill_id}/mcp/configure")
async def configure_mcp(skill_id: str, req: McpConfigureRequest | None = None) -> dict[str, Any]:
    """
    Auto-configure or manually configure MCP for a skill.
    If body is empty/null, auto-detect from source. Otherwise use provided values.
    Saves to registry.json. Upserts into mcp_servers DB table.
    """
    try:
        from backend.services.mcp_manager import detect_mcp_server
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"mcp_manager not available: {e}")

    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")

    skill_path = Path(entry["path"])
    if not skill_path.exists():
        raise HTTPException(status_code=404, detail="Skill directory not found on disk")

    auto_detect = req is None or (
        req.start_command is None and req.port is None and req.env is None
    )

    if auto_detect:
        detected = detect_mcp_server(skill_path)
        if not detected:
            raise HTTPException(
                status_code=422,
                detail="Auto-detection found no MCP server in this skill. Provide start_command manually.",
            )
        entry["is_mcp"] = True
        entry["mcp_start_command"] = detected.get("start_command")
        entry["mcp_transport"] = detected.get("transport")
        entry["mcp_port_hint"] = detected.get("port_hint")
        logger.info(f"[mcp] auto-configured {skill_id}: {detected}")
    else:
        entry["is_mcp"] = True
        if req.start_command is not None:
            entry["mcp_start_command"] = req.start_command
        if req.port is not None:
            entry["mcp_port_hint"] = req.port
        if req.env is not None:
            entry["mcp_env"] = req.env
        logger.info(f"[mcp] manually configured {skill_id}")

    registry = [r if r["id"] != skill_id else entry for r in registry]
    _save_registry(registry)

    # Upsert into mcp_servers DB table (best-effort — table may not exist yet)
    try:
        from backend.services.db import upsert_mcp_server
        upsert_mcp_server(
            skill_id=skill_id,
            start_command=entry.get("mcp_start_command"),
            transport=entry.get("mcp_transport"),
            port_hint=entry.get("mcp_port_hint"),
            env=entry.get("mcp_env"),
        )
    except Exception as db_err:
        logger.warning(f"[mcp] DB upsert skipped for {skill_id}: {db_err}")

    return entry


@router.post("/{skill_id}/analyze")
async def analyze_skill(skill_id: str) -> StreamingResponse:
    """
    Use the loaded model to analyze a skill. Streams tokens live as SSE, then
    emits a final DONE event with the parsed result.
    Events:
      data: {"type": "log", "msg": "..."}       — progress messages
      data: {"type": "token", "content": "..."}  — live model tokens
      data: {"type": "done", "result": {...}}    — final parsed result
      data: {"type": "error", "message": "..."}  — on failure
    """
    from backend.services import engine_router

    if engine_router.get_status() is None:
        async def _err():
            yield f'data: {json.dumps({"type":"error","message":"No model loaded. Load a model first."})}\n\n'
        return StreamingResponse(_err(), media_type="text/event-stream",
                                 headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)

    async def _stream():
        import re as _re

        def sse(obj: dict) -> str:
            return f"data: {json.dumps(obj)}\n\n"

        if not entry:
            yield sse({"type":"error","message":f"Skill '{skill_id}' not found"})
            return

        skill_dir = Path(entry["path"])
        if not skill_dir.exists():
            yield sse({"type":"error","message":"Skill directory not found on disk"})
            return

        # ── Collect context ───────────────────────────────────────────────────
        yield sse({"type":"log","msg":f"Scanning skill directory: {skill_dir}"})

        def _read_safe(path: Path, max_chars: int = 3000) -> str:
            try:
                return path.read_text(errors="replace")[:max_chars]
            except Exception:
                return ""

        context_parts: list[str] = []
        seen: set[str] = set()

        # 1. Always include package.json / pyproject.toml first (tool manifest)
        for fname in ["package.json", "pyproject.toml", "setup.py"]:
            p = skill_dir / fname
            if p.exists():
                content = _read_safe(p, 4000)
                if content.strip():
                    context_parts.append(f"=== {fname} ===\n{content}")
                    seen.add(fname)

        # 2. MCP-specific files — highest signal
        mcp_patterns = [
            "src/app/api/mcp/route.ts", "src/app/api/mcp/server.ts",
            "src/libs/mcp-server/index.ts", "src/libs/mcp-server/streamableHttp.ts",
            "mcp.json", ".mcp.json", "src/mcp.ts", "mcp_server.py", "server.py",
        ]
        for fname in mcp_patterns:
            p = skill_dir / fname
            if p.exists() and p.name not in seen:
                content = _read_safe(p, 3000)
                if content.strip():
                    context_parts.append(f"=== {fname} ===\n{content}")
                    seen.add(p.name)

        # 3. README for general description
        for fname in ["README.md", "README.rst"]:
            p = skill_dir / fname
            if p.exists() and p.name not in seen:
                content = _read_safe(p, 2000)
                if content.strip():
                    context_parts.append(f"=== {fname} ===\n{content}")
                    seen.add(p.name)

        # 4. Scan all TS/JS/PY for MCP patterns (max 5 extra files)
        mcp_source_patterns = [
            r"StreamableHTTPServerTransport", r"McpServer|createMcpServer",
            r"server\.tool\(", r"setRequestHandler", r"from.*@modelcontextprotocol",
            r"FastMCP", r"mcp\.server",
        ]
        extras = 0
        for p in sorted(skill_dir.rglob("*.ts")) + sorted(skill_dir.rglob("*.py")):
            if extras >= 5:
                break
            if "node_modules" in str(p) or ".git" in str(p) or p.name in seen:
                continue
            try:
                txt = p.read_text(errors="ignore")
                if any(_re.search(pat, txt) for pat in mcp_source_patterns):
                    content = txt[:2500]
                    context_parts.append(f"=== {p.relative_to(skill_dir)} ===\n{content}")
                    seen.add(p.name)
                    extras += 1
            except Exception:
                pass

        if not context_parts:
            yield sse({"type":"error","message":"No readable source files found in skill directory"})
            return

        full_context = "\n\n".join(context_parts)
        if len(full_context) > 12000:
            full_context = full_context[:12000] + "\n\n[... truncated ...]"

        yield sse({"type":"log","msg":f"Loaded {len(context_parts)} file(s), {len(full_context)} chars of context"})
        yield sse({"type":"log","msg":"Sending to model for analysis..."})

        # ── Build prompt ──────────────────────────────────────────────────────
        prompt = f"""Analyze this software skill to configure it for an AI assistant called EchoHub.

Skill: {entry.get('name', skill_id)}
Description: {entry.get('description', '')}

Source files:
{full_context}

Answer these questions:
1. What tool function names does this skill expose for an AI model to call?
2. Write a concise awareness block (≤80 tokens) telling the model how/when to use these tools.
3. Is this an MCP (Model Context Protocol) server? Signs: StreamableHTTPServerTransport, McpServer class, server.tool() registrations, /api/mcp routes, @modelcontextprotocol imports, FastMCP usage.
4. If MCP, what command starts it? (from package.json scripts.start or main entry). What transport: "http" or "stdio"?

Respond ONLY with this exact JSON, no explanation, no markdown:
{{"tools":["tool_name"],"awareness":"Brief description for the model.","is_mcp":true,"mcp_start_command":"bun run start","mcp_transport":"http"}}"""

        messages = [{"role": "user", "content": prompt}]
        accumulated = ""
        _in_think = False  # suppress <think>...</think> blocks from token display

        # ── Stream model tokens ───────────────────────────────────────────────
        try:
            async for chunk in engine_router.generate(
                messages=messages, temperature=0.1, max_tokens=512, stream=True,
            ):
                if not isinstance(chunk, str):
                    continue
                for line in chunk.splitlines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        continue
                    try:
                        parsed = json.loads(raw)
                        delta = parsed.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if not delta:
                            continue
                        accumulated += delta
                        # Track think blocks — don't stream them to frontend
                        if "<think>" in delta:
                            _in_think = True
                        if "</think>" in delta:
                            _in_think = False
                            continue
                        if not _in_think:
                            yield sse({"type":"token","content":delta})
                    except (json.JSONDecodeError, IndexError, KeyError):
                        pass
        except Exception as e:
            yield sse({"type":"error","message":f"Model generation failed: {e}"})
            return

        yield sse({"type":"log","msg":"Parsing result..."})

        # ── Parse JSON ────────────────────────────────────────────────────────
        text = accumulated.strip()
        if "```" in text:
            m = _re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, _re.DOTALL)
            if m:
                text = m.group(1)

        m = _re.search(r"\{.*\}", text, _re.DOTALL)
        if not m:
            yield sse({"type":"error","message":f"Model did not return valid JSON. Got: {accumulated[:200]}"})
            return

        try:
            result = json.loads(m.group())
        except json.JSONDecodeError as e:
            yield sse({"type":"error","message":f"JSON parse error: {e}"})
            return

        tools = result.get("tools", [])
        if not isinstance(tools, list):
            tools = []
        tools = [str(t).strip() for t in tools if t]

        awareness = str(result.get("awareness", ""))
        is_mcp: bool = bool(result.get("is_mcp", False))
        mcp_start_command: str | None = result.get("mcp_start_command") or None
        mcp_transport: str | None = result.get("mcp_transport") or None
        if mcp_transport not in ("http", "stdio"):
            mcp_transport = None

        model_id = engine_router.get_status().id if engine_router.get_status() else "unknown"
        yield sse({"type":"done","result":{
            "skill_id": skill_id,
            "suggested_tools": tools,
            "suggested_awareness": awareness,
            "is_mcp": is_mcp,
            "mcp_start_command": mcp_start_command,
            "mcp_transport": mcp_transport,
            "model_used": model_id,
        }})

    return StreamingResponse(
        _stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/search")
def search_skills(q: str = "", force_refresh: bool = False) -> dict[str, Any]:
    """
    Search GitHub for skill repos.
    Empty query → broad search (echohub-skill OR mcp-server OR llm-tool topics).
    Results cached in DB for 24h. Cache is always returned if GitHub is unavailable.
    """
    import httpx
    from backend.services.db import get_skills_cache, set_skills_cache, get_skills_cache_age

    q = q.strip()
    cache_key = q or "__default__"
    installed_urls = {r["repo_url"] for r in _load_registry()}

    def _mark_installed(results: list[dict]) -> list[dict]:
        for res in results:
            res["installed"] = res["repo_url"] in installed_urls
        return results

    # Check cache first (unless force_refresh)
    if not force_refresh:
        cached = get_skills_cache(cache_key)
        if cached:
            age_s = get_skills_cache_age(cache_key) or 0
            return {
                "results": _mark_installed(cached["results"]),
                "total": cached["total"],
                "from_cache": True,
                "cache_age_h": round(age_s / 3600, 1),
                "authenticated": bool(os.getenv("GITHUB_TOKEN")),
            }

    # Build GitHub query — GitHub API only supports OR between full qualifier expressions,
    # mixing stars: with OR-ed topics causes 422. Use plain keyword search instead.
    # Filter to focused MCP servers (size < 5000KB excludes platforms like n8n).
    # Compatible with Claude Code MCP format = compatible with EchoHub.
    if not q:
        github_query = "topic:mcp-server size:<5000 stars:>5 fork:false"
    else:
        github_query = f"{q} topic:mcp-server size:<5000 fork:false"

    headers: dict[str, str] = {"Accept": "application/vnd.github+json"}
    token = os.getenv("GITHUB_TOKEN", "")
    if token:
        headers["Authorization"] = f"Bearer {token}"
        rate_limit = 5000
    else:
        rate_limit = 60

    try:
        r = httpx.get(
            "https://api.github.com/search/repositories",
            params={"q": github_query, "sort": "stars", "order": "desc", "per_page": 30},
            headers=headers,
            timeout=10,
        )
        # Parse rate limit headers (always present even on success)
        rl_remaining = int(r.headers.get("X-RateLimit-Remaining", -1))
        rl_limit = int(r.headers.get("X-RateLimit-Limit", rate_limit))
        rl_reset = int(r.headers.get("X-RateLimit-Reset", 0))  # unix timestamp

        if r.status_code == 403:
            stale_data = get_skills_cache(cache_key)
            base = {"rate_limited": True, "authenticated": bool(token), "rl_remaining": 0, "rl_limit": rl_limit, "rl_reset": rl_reset}
            if stale_data:
                return {**base, "results": _mark_installed(stale_data["results"]), "total": stale_data["total"], "from_cache": True}
            return {**base, "results": [], "total": 0}

        r.raise_for_status()
        data = r.json()
        results = [
            {
                "id": item["full_name"].replace("/", "-").lower(),
                "name": item["name"],
                "full_name": item["full_name"],
                "description": item.get("description") or "",
                "stars": item.get("stargazers_count", 0),
                "author": item["owner"]["login"],
                "repo_url": item["clone_url"],
                "html_url": item["html_url"],
                "topics": item.get("topics", []),
                "updated_at": item.get("updated_at", ""),
                "language": item.get("language"),
            }
            for item in data.get("items", [])
        ]
        total = data.get("total_count", 0)
        set_skills_cache(cache_key, results, total)

        return {
            "results": _mark_installed(results),
            "total": total,
            "from_cache": False,
            "authenticated": bool(token),
            "rate_limited": False,
            "rl_remaining": rl_remaining,
            "rl_limit": rl_limit,
            "rl_reset": rl_reset,
        }

    except httpx.TimeoutException:
        # Network failure — return stale cache if available
        stale = get_skills_cache(cache_key)
        if stale:
            return {
                "results": _mark_installed(stale["results"]),
                "total": stale["total"],
                "from_cache": True,
                "error": "GitHub timed out — showing cached results",
                "authenticated": bool(token),
            }
        return {"results": [], "total": 0, "error": "GitHub API timed out", "authenticated": bool(token)}

    except Exception as e:
        logger.error(f"[skills] search error: {e}")
        stale = get_skills_cache(cache_key)
        if stale:
            return {
                "results": _mark_installed(stale["results"]),
                "total": stale["total"],
                "from_cache": True,
                "error": str(e),
                "authenticated": bool(token),
            }
        return {"results": [], "total": 0, "error": str(e), "authenticated": bool(token)}


@router.get("/{skill_id}")
def get_skill(skill_id: str) -> dict[str, Any]:
    # Check native first
    native = next((s for s in NATIVE_SKILLS if s["id"] == skill_id), None)
    if native:
        return native
    # Then community
    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
    return entry
