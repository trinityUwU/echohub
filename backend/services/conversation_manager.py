from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from loguru import logger

from backend.services.user_data import get_user_data_dir


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _token_estimate(content: Any) -> int:
    if isinstance(content, str):
        return max(1, len(content) // 4)
    if isinstance(content, list):
        return max(1, sum(len(str(b)) for b in content) // 4)
    return 1


def _conv_dir() -> Path:
    d = get_user_data_dir() / "conversations"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _proj_conv_dir() -> Path:
    d = get_user_data_dir() / "project_conversations"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path() -> Path:
    return _conv_dir() / "_index.json"


def _proj_index_path() -> Path:
    return _proj_conv_dir() / "_index.json"


def _conv_path(conv_id: str) -> Path:
    return _conv_dir() / f"{conv_id}.json"


def _proj_conv_path(conv_id: str) -> Path:
    return _proj_conv_dir() / f"{conv_id}.json"


# ---------------------------------------------------------------------------
# Index helpers
# ---------------------------------------------------------------------------

_index_lock = threading.Lock()
_proj_index_lock = threading.Lock()


def _read_index(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def _write_index(path: Path, entries: list[dict]) -> None:
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def _upsert_index(path: Path, lock: threading.Lock, meta: dict) -> None:
    with lock:
        entries = _read_index(path)
        entries = [e for e in entries if e["id"] != meta["id"]]
        entries.insert(0, meta)
        _write_index(path, entries)


def _remove_from_index(path: Path, lock: threading.Lock, conv_id: str) -> None:
    with lock:
        entries = _read_index(path)
        entries = [e for e in entries if e["id"] != conv_id]
        _write_index(path, entries)


# ---------------------------------------------------------------------------
# Chat conversations
# ---------------------------------------------------------------------------

def create_conversation(id: str, title: str = "New Chat", model_id: str | None = None) -> dict:
    now = _now()
    conv = {
        "id": id,
        "title": title,
        "model_id": model_id,
        "memory_enabled": False,
        "archived": False,
        "created_at": now,
        "updated_at": now,
        "messages": [],
    }
    _conv_path(id).write_text(json.dumps(conv, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = {k: conv[k] for k in ("id", "title", "model_id", "memory_enabled", "archived", "created_at", "updated_at")}
    meta["message_count"] = 0
    _upsert_index(_index_path(), _index_lock, meta)
    return {**meta, "message_count": 0}


def get_conversation(conv_id: str) -> dict | None:
    p = _conv_path(conv_id)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        data["message_count"] = len(data.get("messages", []))
        return data
    except Exception:
        return None


def list_conversations(archived: bool = False) -> list[dict]:
    with _index_lock:
        entries = _read_index(_index_path())
    result = []
    for e in entries:
        if bool(e.get("archived", False)) == archived:
            result.append(e)
    return result


def update_conversation(conv_id: str, title: str | None = None, model_id: str | None = None,
                        memory_enabled: bool | None = None, archived: bool | None = None) -> dict | None:
    p = _conv_path(conv_id)
    if not p.exists():
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    if title is not None:
        data["title"] = title
    if model_id is not None:
        data["model_id"] = model_id
    if memory_enabled is not None:
        data["memory_enabled"] = memory_enabled
    if archived is not None:
        data["archived"] = archived
    data["updated_at"] = _now()
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = {k: data[k] for k in ("id", "title", "model_id", "memory_enabled", "archived", "created_at", "updated_at")}
    meta["message_count"] = len(data.get("messages", []))
    _upsert_index(_index_path(), _index_lock, meta)
    return {**meta}


def delete_conversation(conv_id: str) -> bool:
    p = _conv_path(conv_id)
    if not p.exists():
        return False
    p.unlink()
    _remove_from_index(_index_path(), _index_lock, conv_id)
    return True


def get_messages(conv_id: str) -> list[dict]:
    data = get_conversation(conv_id)
    if data is None:
        return []
    return data.get("messages", [])


def add_message(conv_id: str, id: str, role: str, content: Any,
                stats: dict | None = None, load_config: dict | None = None) -> dict | None:
    p = _conv_path(conv_id)
    if not p.exists():
        return None
    data = json.loads(p.read_text(encoding="utf-8"))
    now = _now()
    msg: dict[str, Any] = {"id": id, "role": role, "content": content, "created_at": now}
    if stats:
        msg["stats"] = stats
    if load_config:
        msg["load_config"] = load_config
    data["messages"].append(msg)
    data["updated_at"] = now
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    _update_meta_count(conv_id, len(data["messages"]), now)
    return {**msg, "conversation_id": conv_id}


def delete_messages(conv_id: str) -> bool:
    p = _conv_path(conv_id)
    if not p.exists():
        return False
    data = json.loads(p.read_text(encoding="utf-8"))
    data["messages"] = []
    data["updated_at"] = _now()
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    _update_meta_count(conv_id, 0, data["updated_at"])
    return True


def delete_message(conv_id: str, message_id: str) -> bool:
    p = _conv_path(conv_id)
    if not p.exists():
        return False
    data = json.loads(p.read_text(encoding="utf-8"))
    before = len(data["messages"])
    data["messages"] = [m for m in data["messages"] if m["id"] != message_id]
    if len(data["messages"]) == before:
        return False
    data["updated_at"] = _now()
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    _update_meta_count(conv_id, len(data["messages"]), data["updated_at"])
    return True


def _update_meta_count(conv_id: str, count: int, updated_at: str) -> None:
    with _index_lock:
        entries = _read_index(_index_path())
        for e in entries:
            if e["id"] == conv_id:
                e["message_count"] = count
                e["updated_at"] = updated_at
                break
        _write_index(_index_path(), entries)


def to_context(conv_id: str, max_tokens: int = 4096) -> list[dict]:
    """Sliding window → OpenAI [{role, content}] format."""
    messages = get_messages(conv_id)
    if not messages:
        return []
    window: list[dict] = []
    budget = max_tokens
    for msg in reversed(messages):
        cost = _token_estimate(msg["content"])
        if budget - cost < 0 and window:
            break
        budget -= cost
        window.insert(0, {"role": msg["role"], "content": msg["content"]})
    return window


# ---------------------------------------------------------------------------
# Project conversations (same format, separate directory)
# ---------------------------------------------------------------------------

def create_project_conversation(project_id: str, title: str = "New conversation") -> dict:
    conv_id = str(uuid.uuid4())
    now = _now()
    conv = {
        "id": conv_id,
        "project_id": project_id,
        "title": title,
        "archived": False,
        "memory_enabled": False,
        "created_at": now,
        "updated_at": now,
        "messages": [],
    }
    _proj_conv_path(conv_id).write_text(json.dumps(conv, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = {k: conv[k] for k in ("id", "project_id", "title", "archived", "memory_enabled", "created_at", "updated_at")}
    meta["message_count"] = 0
    _upsert_index(_proj_index_path(), _proj_index_lock, meta)
    return meta


def get_project_conversation(conv_id: str) -> dict | None:
    p = _proj_conv_path(conv_id)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        data["message_count"] = len(data.get("messages", []))
        return data
    except Exception:
        return None


def list_project_conversations(project_id: str, archived: bool = False) -> list[dict]:
    with _proj_index_lock:
        entries = _read_index(_proj_index_path())
    return [e for e in entries if e.get("project_id") == project_id and bool(e.get("archived", False)) == archived]


def archive_project_conversation(conv_id: str, archived: bool) -> None:
    p = _proj_conv_path(conv_id)
    if not p.exists():
        return
    data = json.loads(p.read_text(encoding="utf-8"))
    data["archived"] = archived
    data["updated_at"] = _now()
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    with _proj_index_lock:
        entries = _read_index(_proj_index_path())
        for e in entries:
            if e["id"] == conv_id:
                e["archived"] = archived
                e["updated_at"] = data["updated_at"]
                break
        _write_index(_proj_index_path(), entries)


def delete_project_conversation(conv_id: str) -> None:
    p = _proj_conv_path(conv_id)
    if p.exists():
        p.unlink()
    _remove_from_index(_proj_index_path(), _proj_index_lock, conv_id)


def rename_project_conversation(conv_id: str, title: str) -> None:
    p = _proj_conv_path(conv_id)
    if not p.exists():
        return
    data = json.loads(p.read_text(encoding="utf-8"))
    data["title"] = title
    data["updated_at"] = _now()
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    with _proj_index_lock:
        entries = _read_index(_proj_index_path())
        for e in entries:
            if e["id"] == conv_id:
                e["title"] = title
                e["updated_at"] = data["updated_at"]
                break
        _write_index(_proj_index_path(), entries)


def save_project_message(conv_id: str, role: str, content: str) -> dict:
    p = _proj_conv_path(conv_id)
    if not p.exists():
        raise ValueError(f"Project conversation {conv_id} not found")
    data = json.loads(p.read_text(encoding="utf-8"))
    now = _now()
    msg_id = str(uuid.uuid4())
    msg = {"id": msg_id, "conversation_id": conv_id, "role": role, "content": content, "created_at": now}
    data["messages"].append(msg)
    data["updated_at"] = now
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    with _proj_index_lock:
        entries = _read_index(_proj_index_path())
        for e in entries:
            if e["id"] == conv_id:
                e["message_count"] = len(data["messages"])
                e["updated_at"] = now
                break
        _write_index(_proj_index_path(), entries)
    return msg


def list_project_messages(conv_id: str) -> list[dict]:
    data = get_project_conversation(conv_id)
    if data is None:
        return []
    return data.get("messages", [])


def delete_project_messages(conv_id: str) -> None:
    p = _proj_conv_path(conv_id)
    if not p.exists():
        return
    data = json.loads(p.read_text(encoding="utf-8"))
    data["messages"] = []
    data["updated_at"] = _now()
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def project_to_context(conv_id: str, max_tokens: int = 4096) -> list[dict]:
    messages = list_project_messages(conv_id)
    if not messages:
        return []
    window: list[dict] = []
    budget = max_tokens
    for msg in reversed(messages):
        cost = _token_estimate(msg["content"])
        if budget - cost < 0 and window:
            break
        budget -= cost
        window.insert(0, {"role": msg["role"], "content": msg["content"]})
    return window


# ---------------------------------------------------------------------------
# Migration SQLite → JSON (one-shot)
# ---------------------------------------------------------------------------

def _migrate_chat_convs(_db: object) -> int:  # type: ignore[return]
    """Migrate chat conversations from SQLite. Returns count."""
    rows = _db.get_conversations()  # type: ignore[attr-defined]
    count = 0
    for row in rows:
        conv_id = row["id"]
        if _conv_path(conv_id).exists():
            continue
        messages = _db.get_messages(conv_id)  # type: ignore[attr-defined]
        now = _now()
        conv = {
            "id": conv_id,
            "title": row.get("title", ""),
            "model_id": row.get("model_id"),
            "memory_enabled": False,
            "archived": bool(row.get("archived", False)),
            "created_at": row.get("created_at", now),
            "updated_at": row.get("updated_at", now),
            "messages": [
                {
                    "id": m["id"], "role": m["role"], "content": m["content"],
                    "stats": m.get("stats"), "load_config": m.get("load_config"),
                    "created_at": m.get("created_at", now),
                }
                for m in messages
            ],
        }
        _conv_path(conv_id).write_text(json.dumps(conv, ensure_ascii=False, indent=2), encoding="utf-8")
        meta = {k: conv[k] for k in ("id", "title", "model_id", "archived", "created_at", "updated_at")}
        meta.update({"memory_enabled": False, "message_count": len(messages)})
        _upsert_index(_index_path(), _index_lock, meta)
        count += 1
    return count


def _write_proj_conv(row: object, msgs: list) -> None:  # type: ignore[type-arg]
    conv_id = row["id"]  # type: ignore[index]
    now = _now()
    conv = {
        "id": conv_id, "project_id": row["project_id"], "title": row["title"],  # type: ignore[index]
        "memory_enabled": False, "created_at": row["created_at"], "updated_at": row["updated_at"],  # type: ignore[index]
        "messages": [{"id": m["id"], "conversation_id": conv_id, "role": m["role"],  # type: ignore[index]
                      "content": m["content"], "created_at": m["created_at"]} for m in msgs],  # type: ignore[index]
    }
    _proj_conv_path(conv_id).write_text(json.dumps(conv, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = {k: conv[k] for k in ("id", "project_id", "title", "created_at", "updated_at")}
    meta.update({"memory_enabled": False, "message_count": len(msgs)})
    _upsert_index(_proj_index_path(), _proj_index_lock, meta)


def _migrate_project_convs(db_path: str) -> int:
    """Migrate project conversations from SQLite. Returns count."""
    import sqlite3
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    count = 0
    try:
        for row in conn.execute("SELECT * FROM project_conversations ORDER BY updated_at DESC").fetchall():
            if _proj_conv_path(row["id"]).exists():
                continue
            msgs = conn.execute(
                "SELECT * FROM project_messages WHERE conversation_id = ? ORDER BY created_at ASC",
                (row["id"],),
            ).fetchall()
            _write_proj_conv(row, msgs)
            count += 1
    finally:
        conn.close()
    return count


def migrate_from_sqlite() -> None:
    """Run once at startup. No-op if already migrated."""
    marker = get_user_data_dir() / ".conv_migrated"
    if marker.exists():
        return
    try:
        from backend.services import db as _db
        chat_count = _migrate_chat_convs(_db)
        proj_count = 0
        try:
            proj_count = _migrate_project_convs(str(_db.get_db_path()))
        except Exception as e:
            logger.warning("Project migration partial: {}", e)
        marker.touch()
        logger.info("Migration SQLite → JSON: {} chat convs, {} project convs", chat_count, proj_count)
    except Exception as e:
        logger.error("Migration failed: {}", e)
