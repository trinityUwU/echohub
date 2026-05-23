# Gestion des connecteurs externes — CRUD config + start/stop/status du sidecar Discord Bun
from __future__ import annotations

import asyncio
import os
import shutil
import signal
import subprocess
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

from backend.services import conversation_manager as cm
from backend.services import db as _db
from backend.services import engine_router

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


class DiscordChatRequest(BaseModel):
    conv_id: str
    messages: list[dict]
    user_message_id: str
    temperature: float = 0.7
    max_tokens: int = 2048
    system_prompt: str | None = None


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
    # Process has exited — capture stderr for diagnosis
    stderr_out = ""
    try:
        if _discord_process.stderr:
            raw = _discord_process.stderr.read()
            if raw:
                stderr_out = raw.decode("utf-8", errors="replace").strip()[-300:]
    except Exception:
        pass
    error_msg = stderr_out or f"Process exited (code {_discord_process.returncode})"
    logger.warning("Discord sidecar exited (rc={}) — {}", _discord_process.returncode, error_msg)
    try:
        _db.update_connector_status("discord", "error", error=error_msg)
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
    # bot_token="" is a sentinel meaning "keep existing token" — never overwrite with empty
    existing = _db.get_connector_config("discord") or {}
    config_dict = {
        "bot_token": body.bot_token if body.bot_token else existing.get("bot_token", ""),
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


# ---------------------------------------------------------------------------
# Discord Chat — streaming inference with automatic persistence
# ---------------------------------------------------------------------------


async def _persist_assistant_reply(
    conv_id: str,
    content: str,
    stats: dict[str, Any] | None,
    load_config: dict[str, Any] | None,
) -> None:
    """Persist the assistant reply to the conversation DB (background task)."""
    msg_id = str(uuid.uuid4())
    try:
        cm.add_message(
            conv_id=conv_id,
            id=msg_id,
            role="assistant",
            content=content,
            stats=stats,
            load_config=load_config,
        )
    except Exception:
        logger.exception("discord_chat: failed to persist assistant reply (conv_id={})", conv_id)


@router.post("/discord/chat")
async def discord_chat(req: DiscordChatRequest) -> StreamingResponse:
    """Stream an LLM response and persist user + assistant messages in SQLite."""
    model_info = engine_router.get_status()
    if model_info is None:
        raise HTTPException(status_code=404, detail="No model loaded")

    try:
        conversation = cm.get_conversation(req.conv_id)
    except Exception:
        logger.exception("discord_chat: DB read failed (conv_id={})", req.conv_id)
        raise HTTPException(status_code=500, detail="Failed to read conversation")

    if conversation is None:
        raise HTTPException(status_code=404, detail=f"Conversation '{req.conv_id}' not found")

    # Persist the last user message before streaming
    user_content = ""
    for msg in reversed(req.messages):
        if msg.get("role") == "user":
            user_content = msg.get("content", "")
            break

    try:
        cm.add_message(
            conv_id=req.conv_id,
            id=req.user_message_id,
            role="user",
            content=user_content,
            stats=None,
            load_config=None,
        )
    except Exception:
        logger.exception("discord_chat: failed to persist user message (conv_id={})", req.conv_id)
        raise HTTPException(status_code=500, detail="Failed to persist user message")

    # Build messages — inject system_prompt if provided
    messages_to_send: list[dict] = list(req.messages)
    if req.system_prompt and req.system_prompt.strip():
        messages_to_send = [{"role": "system", "content": req.system_prompt}] + messages_to_send

    async def _stream_and_collect() -> Any:
        accumulated: list[str] = []
        echohub_stats: dict[str, Any] | None = None
        load_cfg: dict[str, Any] | None = None

        logger.info("discord_chat: starting generation (conv_id={}, msgs={})", req.conv_id, len(messages_to_send))
        try:
            async for chunk in engine_router.generate(
                messages=messages_to_send,
                stream=True,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
            ):
                # Collect assistant text from content delta chunks
                try:
                    import json as _json
                    parsed = _json.loads(chunk.removeprefix("data: ").strip())
                    if parsed.get("type") == "echohub_stats":
                        echohub_stats = parsed
                        load_cfg = parsed.get("load_config")
                    else:
                        delta = parsed.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if delta:
                            accumulated.append(delta)
                except Exception:
                    pass
                yield chunk
        except Exception:
            logger.exception("discord_chat: error during generation (conv_id={})", req.conv_id)
            return

        # Persist assistant reply in background — does not block the SSE response
        full_reply = "".join(accumulated)
        asyncio.create_task(
            _persist_assistant_reply(req.conv_id, full_reply, echohub_stats, load_cfg)
        )

        yield f'data: {{"type": "discord_done", "conv_id": "{req.conv_id}"}}\n\n'

    return StreamingResponse(
        _stream_and_collect(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
