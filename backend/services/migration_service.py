"""
File migration service — moves models_dir or vllm_envs_dir to a new path.

State machine (persisted in DB, survives crashes):
  idle → pending → in_progress → complete
                        ↓ (cancel requested)
                    cancelled (rollback: dest files deleted, config restored)
                        ↓ (crash/restart)
                    resume auto
                        ↓ (file unreadable)
                    redownload_needed → redownloading
"""
from __future__ import annotations

import asyncio
import json
import shutil
import time
from pathlib import Path
from typing import AsyncGenerator, Optional

from loguru import logger

from backend.services.user_data import get_user_data_dir

# In-memory cancel flag — set by cancel_migration(), checked by the copy loop
_cancel_requested: bool = False


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
    state = _load_state()
    if state.get("status") in ("pending", "in_progress", "redownload_needed"):
        return state
    return None


def create_migration(migration_type: str, source: str, destination: str) -> dict:
    global _cancel_requested
    _cancel_requested = False
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
        "copied_files": [],  # tracks files copied so far for rollback
    }
    _save_state(state)
    return state


def cancel_migration() -> None:
    global _cancel_requested
    _cancel_requested = True
    state = _load_state()
    if state.get("status") == "pending":
        # Not started yet — clean cancel
        _save_state({})


async def run_migration_stream(confirm: bool = True) -> AsyncGenerator[str, None]:
    global _cancel_requested
    _cancel_requested = False

    state = _load_state()
    if not state or state.get("status") not in ("pending", "in_progress", "redownload_needed"):
        yield _sse("No pending migration", "warn")
        yield _done(False, "no_migration")
        return

    source = Path(state["source"])
    dest = Path(state["destination"])
    mtype = state["migration_type"]

    yield _sse(f"Starting migration: {source} → {dest}", "info")

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
            yield _sse(f"Insufficient disk space: need {src_size/1e9:.1f} GB, have {free/1e9:.1f} GB", "error")
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
    state.setdefault("copied_files", [])
    _save_state(state)

    yield _sse(f"Found {len(file_list)} files ({state['bytes_total']/1e9:.2f} GB total)")

    failed = []
    done = state.get("files_done", 0)
    bytes_done = state.get("bytes_done", 0)
    copied_files: list[str] = state.get("copied_files", [])

    for i, src_file in enumerate(file_list):
        # Check cancel flag every file
        if _cancel_requested:
            yield _sse("Cancellation requested — rolling back…", "warn")
            async for msg in _rollback(dest, copied_files, source, mtype):
                yield msg
            yield _done(False, "cancelled")
            return

        rel = src_file.relative_to(source)
        dst_file = dest / rel
        dst_file.parent.mkdir(parents=True, exist_ok=True)

        if dst_file.exists() and dst_file.stat().st_size == src_file.stat().st_size:
            done += 1
            bytes_done += src_file.stat().st_size
            continue

        try:
            with open(src_file, "rb") as f:
                f.read(1024)
        except Exception as e:
            yield _sse(f"  ✗ {rel} — unreadable: {e}", "error")
            failed.append(str(rel))
            continue

        try:
            shutil.copy2(src_file, dst_file)
            if dst_file.stat().st_size != src_file.stat().st_size:
                raise ValueError("Size mismatch after copy")
            done += 1
            bytes_done += src_file.stat().st_size
            copied_files.append(str(dst_file))
            pct = round((bytes_done / max(state["bytes_total"], 1)) * 100)
            if i % 20 == 0 or i == len(file_list) - 1:
                yield _sse(f"  [{pct}%] {done}/{len(file_list)} files — {bytes_done/1e9:.2f} GB")
                state["files_done"] = done
                state["bytes_done"] = bytes_done
                state["copied_files"] = copied_files
                _save_state(state)
        except Exception as e:
            yield _sse(f"  ✗ {rel} — copy failed: {e}", "error")
            failed.append(str(rel))

        await asyncio.sleep(0)

    state["files_done"] = done
    state["bytes_done"] = bytes_done
    state["files_failed"] = failed

    if failed:
        yield _sse(f"{len(failed)} files failed to copy", "warn")
        state["status"] = "redownload_needed"
        _save_state(state)
    else:
        yield _sse(f"All {done} files copied successfully", "ok")

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


async def _rollback(dest: Path, copied_files: list[str], source: Path, mtype: str) -> AsyncGenerator[str, None]:
    """Delete files copied to dest, restore config to source."""
    deleted = 0
    errors = 0
    for dst_str in copied_files:
        dst = Path(dst_str)
        try:
            if dst.exists():
                dst.unlink()
                deleted += 1
        except Exception as e:
            logger.warning(f"Rollback: could not delete {dst}: {e}")
            errors += 1
        await asyncio.sleep(0)

    # Clean up empty dirs in dest
    try:
        for d in sorted(dest.rglob("*"), reverse=True):
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()
    except Exception:
        pass

    yield _sse(f"Rollback: {deleted} files removed{f', {errors} errors' if errors else ''}", "ok" if not errors else "warn")

    # Restore config to source
    from backend.services import config_service
    if mtype == "models":
        config_service.set_models_dir(str(source))
        yield _sse(f"Config restored: models_dir → {source}", "ok")
    elif mtype == "vllm_envs":
        config_service.set_vllm_envs_dir(str(source))
        yield _sse(f"Config restored: vllm_envs_dir → {source}", "ok")

    _save_state({"status": "cancelled"})


def _sse(msg: str, level: str = "info") -> str:
    return f"data: {json.dumps({'level': level, 'msg': msg, 'ts': time.time()})}\n\n"


def _done(success: bool, reason: str, extra: dict | None = None) -> str:
    payload = {"done": True, "success": success, "reason": reason, **(extra or {})}
    return f"data: {json.dumps(payload)}\n\n"


def cleanup_completed() -> None:
    state = _load_state()
    if state.get("status") in ("complete", "cancelled"):
        _save_state({})
