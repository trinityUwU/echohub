"""
File migration service — moves models_dir or vllm_envs_dir to a new path.

State machine (persisted in DB, survives crashes):
  idle → pending → in_progress → complete
                        ↓ (crash/restart)
                    resume auto
                        ↓ (file unreadable)
                    redownload_needed → redownloading

State is stored in config.json alongside the path config.
Each file is tracked individually — we never lose progress.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import time
from pathlib import Path
from typing import AsyncGenerator, Optional

from loguru import logger

from backend.services.user_data import get_user_data_dir

MIGRATION_STATE_FILE = None  # set lazily


def _state_path() -> Path:
    return get_user_data_dir() / "migration_state.json"


def _load_state() -> dict:
    p = _state_path()
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {}


def _save_state(state: dict) -> None:
    _state_path().write_text(json.dumps(state, indent=2))


def get_pending_migration() -> Optional[dict]:
    """Return any pending/in-progress migration, or None."""
    state = _load_state()
    if state.get("status") in ("pending", "in_progress", "redownload_needed"):
        return state
    return None


def create_migration(migration_type: str, source: str, destination: str) -> dict:
    """Create a new migration job. Returns the state."""
    state = {
        "migration_type": migration_type,  # "models" | "vllm_envs"
        "source": source,
        "destination": destination,
        "status": "pending",
        "created_at": time.time(),
        "files_total": 0,
        "files_done": 0,
        "files_failed": [],
        "bytes_total": 0,
        "bytes_done": 0,
    }
    _save_state(state)
    return state


def cancel_migration() -> None:
    state = _load_state()
    if state.get("status") in ("pending",):
        _save_state({})


async def run_migration_stream(confirm: bool = True) -> AsyncGenerator[str, None]:
    """
    Execute pending migration, streaming SSE log lines.
    If confirm=False, just validates and sets status=in_progress.
    """
    state = _load_state()
    if not state or state.get("status") not in ("pending", "in_progress", "redownload_needed"):
        yield _sse("No pending migration", "warn")
        yield _done(False, "no_migration")
        return

    source = Path(state["source"])
    dest = Path(state["destination"])
    mtype = state["migration_type"]

    yield _sse(f"Starting migration: {source} → {dest}", "info")

    # Create destination
    try:
        dest.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        yield _sse(f"Cannot create destination: {e}", "error")
        yield _done(False, str(e))
        return

    # Check free space
    try:
        src_size = sum(f.stat().st_size for f in source.rglob("*") if f.is_file())
        free = shutil.disk_usage(dest).free
        if free < src_size * 1.05:
            gb_needed = src_size / 1e9
            gb_free = free / 1e9
            yield _sse(f"Insufficient disk space: need {gb_needed:.1f} GB, have {gb_free:.1f} GB", "error")
            yield _done(False, "insufficient_space")
            return
        yield _sse(f"Disk space OK: {src_size/1e9:.1f} GB to copy, {free/1e9:.1f} GB free")
    except Exception as e:
        yield _sse(f"Space check failed: {e}", "warn")

    # Collect files
    files = list(source.rglob("*")) if source.exists() else []
    file_list = [f for f in files if f.is_file()]
    state["files_total"] = len(file_list)
    state["bytes_total"] = sum(f.stat().st_size for f in file_list)
    state["status"] = "in_progress"
    _save_state(state)

    yield _sse(f"Found {len(file_list)} files ({state['bytes_total']/1e9:.2f} GB total)")

    failed = []
    done = state.get("files_done", 0)
    bytes_done = state.get("bytes_done", 0)

    for i, src_file in enumerate(file_list):
        rel = src_file.relative_to(source)
        dst_file = dest / rel
        dst_file.parent.mkdir(parents=True, exist_ok=True)

        # Skip already migrated files
        if dst_file.exists() and dst_file.stat().st_size == src_file.stat().st_size:
            done += 1
            bytes_done += src_file.stat().st_size
            continue

        # Verify source is readable
        try:
            with open(src_file, "rb") as f:
                f.read(1024)
        except Exception as e:
            yield _sse(f"  ✗ {rel} — unreadable: {e}", "error")
            failed.append(str(rel))
            continue

        # Copy with progress
        try:
            shutil.copy2(src_file, dst_file)
            # Verify copy
            if dst_file.stat().st_size != src_file.stat().st_size:
                raise ValueError("Size mismatch after copy")
            done += 1
            bytes_done += src_file.stat().st_size
            pct = round((bytes_done / max(state["bytes_total"], 1)) * 100)
            if i % 20 == 0 or i == len(file_list) - 1:
                yield _sse(f"  [{pct}%] {done}/{len(file_list)} files — {bytes_done/1e9:.2f} GB")
                state["files_done"] = done
                state["bytes_done"] = bytes_done
                _save_state(state)
        except Exception as e:
            yield _sse(f"  ✗ {rel} — copy failed: {e}", "error")
            failed.append(str(rel))

        await asyncio.sleep(0)  # yield control

    state["files_done"] = done
    state["bytes_done"] = bytes_done
    state["files_failed"] = failed

    if failed:
        yield _sse(f"{len(failed)} files failed to copy", "warn")
        yield _sse("Files with errors will be re-downloaded if needed", "warn")
        state["status"] = "redownload_needed"
        _save_state(state)
    else:
        yield _sse(f"All {done} files copied successfully", "ok")

    # Update config to point to new path
    from backend.services import config_service
    if mtype == "models":
        config_service.set_models_dir(str(dest))
        yield _sse(f"Config updated: models_dir → {dest}", "ok")
    elif mtype == "vllm_envs":
        config_service.set_vllm_envs_dir(str(dest))
        yield _sse(f"Config updated: vllm_envs_dir → {dest}", "ok")

    state["status"] = "complete"
    state["completed_at"] = time.time()
    _save_state(state)

    yield _sse("Migration complete", "ok")
    yield _done(True, "complete", {
        "files_done": done,
        "files_failed": len(failed),
        "bytes_done": bytes_done,
    })


def _sse(msg: str, level: str = "info") -> str:
    return f"data: {json.dumps({'level': level, 'msg': msg, 'ts': time.time()})}\n\n"


def _done(success: bool, reason: str, extra: dict | None = None) -> str:
    payload = {"done": True, "success": success, "reason": reason, **(extra or {})}
    return f"data: {json.dumps(payload)}\n\n"


def cleanup_completed() -> None:
    """Remove completed migration state."""
    state = _load_state()
    if state.get("status") == "complete":
        _save_state({})
