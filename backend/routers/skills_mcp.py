"""
skills_mcp.py — MCP lifecycle routes for community skills.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

from backend.routers.skills_helpers import _load_registry, _save_registry

router = APIRouter(prefix="/skills", tags=["skills"])


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

    # Ensure DB row exists — upsert from registry before calling mcp_manager.start()
    try:
        from backend.services.db import upsert_mcp_server, get_mcp_server
        if not get_mcp_server(skill_id):
            transport = entry.get("mcp_transport", "http")
            port_hint = int(entry.get("mcp_port_hint") or 0) if transport == "http" else 0
            upsert_mcp_server(
                skill_id=skill_id,
                port=port_hint,
                start_command=entry["mcp_start_command"],
                transport=transport,
            )
    except Exception as e:
        logger.warning(f"[mcp] DB upsert failed for {skill_id}: {e}")

    try:
        result = await mcp_manager.start(skill_id)
        logger.info(f"[mcp] started {skill_id}: {result}")
        return result
    except Exception as e:
        logger.error(f"[mcp] start error {skill_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{skill_id}/mcp/start-stream")
async def start_mcp_server_stream(skill_id: str) -> StreamingResponse:
    """
    Start MCP server with SSE progress stream.
    Events: {"type":"log","msg":"..."} | {"type":"done","result":{...}} | {"type":"error","message":"..."}
    Auto-builds if needed (Next.js .next/, Python dist etc.) before starting.
    """
    try:
        from backend.services.mcp_manager import mcp_manager, detect_mcp_server
    except ImportError as e:
        async def _err():
            yield f'data: {json.dumps({"type":"error","message":str(e)})}\n\n'
        return StreamingResponse(_err(), media_type="text/event-stream",
                                 headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)

    async def _stream():
        def sse(obj: dict) -> str:
            return f"data: {json.dumps(obj)}\n\n"

        if not entry:
            yield sse({"type":"error","message":f"Skill '{skill_id}' not found"})
            return

        skill_path = Path(entry["path"])

        # Auto-detect MCP if not yet done
        if not entry.get("is_mcp"):
            yield sse({"type":"log","msg":"Detecting MCP server..."})
            detected = detect_mcp_server(skill_path)
            if not detected:
                yield sse({"type":"error","message":"This skill is not an MCP server."})
                return
            entry["is_mcp"] = True
            entry["mcp_start_command"] = detected.get("start_command")
            entry["mcp_transport"] = detected.get("transport")
            entry["mcp_port_hint"] = detected.get("port_hint")
            reg = _load_registry()
            _save_registry([r if r["id"] != skill_id else entry for r in reg])
            yield sse({"type":"log","msg":f"Detected: {detected.get('start_command')} ({detected.get('transport')})"})

        start_cmd = entry.get("mcp_start_command") or ""
        if not start_cmd:
            yield sse({"type":"error","message":"No start command configured."})
            return

        # Register in DB (upsert)
        from backend.services.db import upsert_mcp_server
        env_json = entry.get("env_json")
        transport = entry.get("mcp_transport", "http")
        port_hint = entry.get("mcp_port_hint")
        effective_port = int(port_hint or 0) if transport == "http" else 0
        upsert_mcp_server(
            skill_id=skill_id,
            port=effective_port,
            start_command=start_cmd,
            transport=transport,
            env_json=(
                json.dumps({"PORT": str(effective_port)})
                if not env_json and effective_port
                else env_json
            ),
        )

        # Check if build needed — stream build output
        needs_build, build_cmd = await mcp_manager._needs_build(skill_path)
        if needs_build and build_cmd:
            yield sse({"type":"log","msg":f"Build required — running: {build_cmd}"})
            env = {**__import__('os').environ, "PORT": str(port_hint or 3000)}
            log_file = skill_path / "mcp.log"
            # Stream build output line by line
            try:
                proc = await __import__('asyncio').create_subprocess_shell(
                    build_cmd,
                    cwd=str(skill_path),
                    env=env,
                    stdout=__import__('asyncio').subprocess.PIPE,
                    stderr=__import__('asyncio').subprocess.STDOUT,
                )
                async for raw in proc.stdout:
                    line = raw.decode(errors="replace").rstrip()
                    if line:
                        yield sse({"type":"log","msg":line})
                rc = await __import__('asyncio').wait_for(proc.wait(), timeout=300)
                if rc != 0:
                    yield sse({"type":"error","message":f"Build failed (exit {rc})"})
                    return
                yield sse({"type":"log","msg":"Build succeeded ✓"})
            except Exception as e:
                yield sse({"type":"error","message":f"Build error: {e}"})
                return

        # Start the server
        yield sse({"type":"log","msg":f"Starting server: {start_cmd}"})
        try:
            result = await mcp_manager.start(skill_id)
            if result.get("status") == "running":
                yield sse({"type":"log","msg":f"Server running on port {result.get('port')} (pid {result.get('pid')}) ✓"})
                yield sse({"type":"done","result":result})
            else:
                error = result.get("error") or "Unknown error"
                yield sse({"type":"error","message":f"Server failed to start: {error}"})
        except Exception as e:
            yield sse({"type":"error","message":str(e)})

    return StreamingResponse(
        _stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
        transport_val = entry.get("mcp_transport") or "http"
        port_val = int(entry.get("mcp_port_hint") or 0) if transport_val == "http" else 0
        upsert_mcp_server(
            skill_id=skill_id,
            port=port_val,
            start_command=entry.get("mcp_start_command") or "",
            transport=transport_val,
            env=entry.get("mcp_env"),
        )
    except Exception as db_err:
        logger.warning(f"[mcp] DB upsert skipped for {skill_id}: {db_err}")

    return entry
