"""
skills_registry.py — CRUD routes for community skills: install, delete, patch, get.
"""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

from backend.routers.skills_helpers import (
    NATIVE_SKILLS, SKILLS_DIR,
    _load_registry, _save_registry, _read_manifest, _detect_install_commands,
)

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("")
def list_skills() -> dict[str, Any]:
    return {"native": NATIVE_SKILLS, "community": _load_registry()}


class InstallRequest(BaseModel):
    repo_url: str
    skill_id: str | None = None


@router.post("/install")
async def install_skill(req: InstallRequest) -> StreamingResponse:
    """Clone + install a skill. Streams SSE progress."""
    import asyncio as _asyncio

    skill_id = req.skill_id or req.repo_url.rstrip("/").split("/")[-1].replace(".git", "").lower().replace(" ", "-")
    target_dir = SKILLS_DIR / skill_id

    async def _stream():
        def sse(msg: str) -> str:
            return f"data: {msg.rstrip()}\n\n"

        yield sse(f"Starting install: {req.repo_url}")

        if target_dir.exists():
            yield sse("Directory exists — removing and re-cloning")
            await _asyncio.get_event_loop().run_in_executor(None, shutil.rmtree, str(target_dir))

        SKILLS_DIR.mkdir(parents=True, exist_ok=True)
        yield sse(f"Cloning {req.repo_url} ...")

        try:
            proc = await _asyncio.create_subprocess_exec(
                "git", "clone", "--depth=1", "--progress", req.repo_url, str(target_dir),
                stdout=_asyncio.subprocess.PIPE, stderr=_asyncio.subprocess.STDOUT,
            )
            async for raw in proc.stdout:
                if line := raw.decode(errors="replace").rstrip():
                    yield sse(line)
            rc = await _asyncio.wait_for(proc.wait(), timeout=120)
            if rc != 0:
                yield sse("ERROR: git clone failed"); yield sse("INSTALL_FAILED"); return
        except _asyncio.TimeoutError:
            yield sse("ERROR: git clone timed out (120s)"); yield sse("INSTALL_FAILED"); return
        except Exception as e:
            yield sse(f"ERROR: {e}"); yield sse("INSTALL_FAILED"); return

        yield sse("Clone complete ✓")
        manifest = _read_manifest(target_dir)
        url_parts = req.repo_url.replace(".git", "").rstrip("/").split("/")
        entry: dict[str, Any] = {
            "id": skill_id,
            "name": manifest.get("name") or skill_id,
            "description": manifest.get("description") or "Community skill",
            "version": manifest.get("version") or "unknown",
            "author": manifest.get("author") or (url_parts[-2] if len(url_parts) >= 2 else "unknown"),
            "repo_url": req.repo_url,
            "path": str(target_dir),
            "tools": manifest.get("tools") or [],
            "awareness": manifest.get("awareness") or "",
            "type": "community",
        }

        cmds = _detect_install_commands(target_dir)
        if cmds:
            yield sse(f"Running {len(cmds)} install command(s)...")
            for cmd in cmds:
                yield sse(f"$ {cmd}")
                try:
                    proc = await _asyncio.create_subprocess_shell(
                        cmd, cwd=str(target_dir),
                        stdout=_asyncio.subprocess.PIPE, stderr=_asyncio.subprocess.STDOUT,
                    )
                    async for raw in proc.stdout:
                        if line := raw.decode(errors="replace").rstrip():
                            yield sse(line)
                    rc = await _asyncio.wait_for(proc.wait(), timeout=300)
                    if rc != 0:
                        yield sse(f"ERROR: command exited with code {rc}"); yield sse("INSTALL_FAILED"); return
                    yield sse("✓ done")
                except _asyncio.TimeoutError:
                    yield sse("ERROR: command timed out (300s)"); yield sse("INSTALL_FAILED"); return
                except Exception as e:
                    yield sse(f"ERROR: {e}"); yield sse("INSTALL_FAILED"); return
        else:
            yield sse("No install commands — registering as-is")

        registry = [r for r in _load_registry() if r["id"] != skill_id]
        registry.append(entry)
        _save_registry(registry)
        yield sse(f"Skill '{entry['name']}' installed successfully ✓")
        yield sse(f"INSTALL_DONE:{skill_id}")

    return StreamingResponse(_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.delete("/{skill_id}")
def delete_skill(skill_id: str) -> dict[str, str]:
    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
    target_dir = Path(entry["path"])
    if target_dir.exists():
        shutil.rmtree(target_dir)
    _save_registry([r for r in registry if r["id"] != skill_id])
    logger.info(f"[skills] deleted {skill_id}")
    return {"status": "deleted", "id": skill_id}


class SkillPatchRequest(BaseModel):
    tools: list[str] | None = None
    awareness: str | None = None
    name: str | None = None
    description: str | None = None


@router.patch("/{skill_id}")
def patch_skill(skill_id: str, req: SkillPatchRequest) -> dict[str, Any]:
    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
    for field in ("tools", "awareness", "name", "description"):
        val = getattr(req, field)
        if val is not None:
            entry[field] = val
    _save_registry([r if r["id"] != skill_id else entry for r in registry])
    return entry


@router.get("/{skill_id}")
def get_skill(skill_id: str) -> dict[str, Any]:
    native = next((s for s in NATIVE_SKILLS if s["id"] == skill_id), None)
    if native:
        return native
    registry = _load_registry()
    entry = next((r for r in registry if r["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
    return entry
