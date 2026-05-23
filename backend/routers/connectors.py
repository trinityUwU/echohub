# Gestion des connecteurs externes — CRUD config + start/stop/status du sidecar Discord Bun
from __future__ import annotations

import os
import shutil
import signal
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from backend.services import db as _db

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/connectors", tags=["connectors"])

# ---------------------------------------------------------------------------
# Module-level sidecar state
# ---------------------------------------------------------------------------

_discord_process: subprocess.Popen[bytes] | None = None

SIGTERM_GRACE_SECONDS = 3

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class ConnectorConfigBody(BaseModel):
    bot_token: str
    client_id: str
    authorized_user_id: str


class ConnectorStatusResponse(BaseModel):
    id: str
    status: str
    error: str | None
    config: dict[str, Any] | None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _is_discord_running() -> bool:
    """Return True if the Discord sidecar process is alive."""
    global _discord_process
    if _discord_process is None:
        return False
    if _discord_process.poll() is None:
        return True
    # Process has exited — mark as error in DB
    logger.warning("Discord sidecar exited unexpectedly (returncode={})", _discord_process.returncode)
    try:
        _db.update_connector_status("discord", "error", error="Process exited unexpectedly")
    except Exception:
        logger.exception("Failed to update connector status after unexpected exit")
    _discord_process = None
    return False


def _mask_config(config: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return a copy of config with bot_token masked."""
    if config is None:
        return None
    masked = dict(config)
    if masked.get("bot_token"):
        masked["bot_token"] = "***"
    return masked


def _get_db_status(connector_id: str) -> str:
    """Return stored status string from DB, defaulting to 'stopped'."""
    try:
        row = _db.get_connector_config(connector_id)
        # get_connector_config returns the config dict, not the full row
        # We need status from DB — use get_all_connectors to find status
        for c in _db.get_all_connectors():
            if c.get("id") == connector_id:
                return c.get("status", "stopped")
    except Exception:
        logger.exception("Failed to read connector status for connector_id={}", connector_id)
    return "stopped"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/discord", response_model=ConnectorStatusResponse)
def get_discord_status() -> ConnectorStatusResponse:
    """Return current config (bot_token masked) and runtime status of the Discord connector."""
    try:
        config = _db.get_connector_config("discord")
    except Exception:
        logger.exception("get_discord_status: DB read failed")
        raise HTTPException(status_code=500, detail="Failed to read connector config")

    running = _is_discord_running()
    db_status = _get_db_status("discord")

    # Reconcile: if process is running but DB says stopped, align to running
    if running and db_status not in ("running", "starting"):
        db_status = "running"
    elif not running and db_status == "running":
        db_status = "stopped"

    return ConnectorStatusResponse(
        id="discord",
        status=db_status,
        error=None,
        config=_mask_config(config),
    )


@router.post("/discord/config")
def save_discord_config(body: ConnectorConfigBody) -> dict[str, bool]:
    """Persist Discord connector configuration (bot_token stored securely in DB)."""
    config_dict = {
        "bot_token": body.bot_token,
        "client_id": body.client_id,
        "authorized_user_id": body.authorized_user_id,
    }
    try:
        _db.save_connector_config("discord", config_dict)
    except Exception:
        logger.exception("save_discord_config: DB write failed")
        raise HTTPException(status_code=500, detail="Failed to save connector config")

    logger.info("Discord connector config saved (client_id={})", body.client_id)
    return {"ok": True}


@router.post("/discord/start")
def start_discord() -> dict[str, Any]:
    """Start the Discord DM bot sidecar via Bun."""
    global _discord_process

    # ── Validate config ──────────────────────────────────────────────────────
    try:
        config = _db.get_connector_config("discord")
    except Exception:
        logger.exception("start_discord: DB read failed")
        raise HTTPException(status_code=500, detail="Failed to read connector config")

    if not config:
        raise HTTPException(status_code=400, detail="Discord connector not configured")

    missing = [k for k in ("bot_token", "client_id", "authorized_user_id") if not config.get(k)]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required config fields: {', '.join(missing)}")

    # ── Check bun availability ────────────────────────────────────────────────
    if not shutil.which("bun"):
        raise HTTPException(status_code=400, detail="bun is not available in PATH — install bun to run the Discord sidecar")

    # ── Idempotency: already running ─────────────────────────────────────────
    if _is_discord_running():
        raise HTTPException(status_code=409, detail="Discord sidecar is already running")

    # ── Spawn the sidecar ────────────────────────────────────────────────────
    cwd = Path(__file__).resolve().parents[2] / "connectors" / "discord"
    env = {
        **os.environ,
        "DISCORD_BOT_TOKEN": config["bot_token"],
        "DISCORD_CLIENT_ID": config["client_id"],
        "DISCORD_AUTHORIZED_USER_ID": config["authorized_user_id"],
    }

    try:
        process = subprocess.Popen(
            ["bun", "run", "discord-dm-bot.ts"],
            cwd=str(cwd),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except Exception as exc:
        logger.error("start_discord: failed to spawn sidecar — {}", exc)
        raise HTTPException(status_code=500, detail=f"Failed to start Discord sidecar: {exc}")

    _discord_process = process
    logger.info("Discord sidecar started (pid={})", process.pid)

    try:
        _db.update_connector_status("discord", "running")
    except Exception:
        logger.exception("start_discord: failed to update DB status")

    return {"ok": True, "pid": process.pid}


@router.post("/discord/stop")
def stop_discord() -> dict[str, bool]:
    """Stop the Discord DM bot sidecar gracefully (SIGTERM → SIGKILL after 3s)."""
    global _discord_process

    # ── Idempotent: nothing to stop ──────────────────────────────────────────
    if not _is_discord_running():
        logger.info("stop_discord: no running process — nothing to stop")
        return {"ok": True}

    assert _discord_process is not None  # guaranteed by _is_discord_running()

    pid = _discord_process.pid
    logger.info("Stopping Discord sidecar (pid={}) …", pid)

    try:
        _discord_process.send_signal(signal.SIGTERM)
        try:
            _discord_process.wait(timeout=SIGTERM_GRACE_SECONDS)
            logger.info("Discord sidecar (pid={}) stopped gracefully", pid)
        except subprocess.TimeoutExpired:
            logger.warning("Discord sidecar (pid={}) did not exit in {}s — sending SIGKILL", pid, SIGTERM_GRACE_SECONDS)
            _discord_process.kill()
            _discord_process.wait()
            logger.info("Discord sidecar (pid={}) killed", pid)
    except Exception as exc:
        logger.error("stop_discord: error while stopping process (pid={}) — {}", pid, exc)

    _discord_process = None

    try:
        _db.update_connector_status("discord", "stopped")
    except Exception:
        logger.exception("stop_discord: failed to update DB status")

    return {"ok": True}
