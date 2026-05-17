from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any

from loguru import logger

from backend.services.user_data import get_db_path

_lock = threading.Lock()
_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        db_path = get_db_path()
        conn = sqlite3.connect(str(db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return _local.conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def _decode_content(raw: str) -> Any:
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return parsed
        return raw
    except (json.JSONDecodeError, TypeError):
        return raw


def _decode_stats(raw: str | None) -> dict | None:
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def init_db() -> None:
    with _lock:
        conn = _get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New Chat',
                model_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                stats TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS benchmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        """)
        conn.commit()
        # Migrations — add columns that may be missing from older DBs
        existing = {row[1] for row in conn.execute("PRAGMA table_info(conversations)")}
        if "archived" not in existing:
            conn.execute("ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
            conn.commit()
    logger.info("DB initialized at {}", get_db_path())


def get_conversations() -> list[dict]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute("""
            SELECT c.*, COUNT(m.id) AS message_count
            FROM conversations c
            LEFT JOIN messages m ON m.conversation_id = c.id
            GROUP BY c.id
            ORDER BY c.updated_at DESC
        """).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_conversation(conv_id: str) -> dict | None:
    with _lock:
        conn = _get_conn()
        row = conn.execute("""
            SELECT c.*, COUNT(m.id) AS message_count
            FROM conversations c
            LEFT JOIN messages m ON m.conversation_id = c.id
            WHERE c.id = ?
            GROUP BY c.id
        """, (conv_id,)).fetchone()
    return _row_to_dict(row) if row else None


def create_conversation(id: str, title: str, model_id: str | None) -> dict:
    now = _now()
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO conversations (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (id, title, model_id, now, now),
        )
        conn.commit()
    return {
        "id": id,
        "title": title,
        "model_id": model_id,
        "created_at": now,
        "updated_at": now,
        "message_count": 0,
    }


def update_conversation(conv_id: str, title: str | None, model_id: str | None) -> dict | None:
    fields: list[str] = []
    values: list[Any] = []

    if title is not None:
        fields.append("title = ?")
        values.append(title)
    if model_id is not None:
        fields.append("model_id = ?")
        values.append(model_id)

    if not fields:
        return get_conversation(conv_id)

    now = _now()
    fields.append("updated_at = ?")
    values.append(now)
    values.append(conv_id)

    with _lock:
        conn = _get_conn()
        conn.execute(
            f"UPDATE conversations SET {', '.join(fields)} WHERE id = ?",
            values,
        )
        conn.commit()
    return get_conversation(conv_id)


def delete_conversation(conv_id: str) -> bool:
    with _lock:
        conn = _get_conn()
        cursor = conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
        conn.commit()
    return cursor.rowcount > 0


def get_messages(conv_id: str) -> list[dict]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
            (conv_id,),
        ).fetchall()
    result = []
    for row in rows:
        d = _row_to_dict(row)
        d["content"] = _decode_content(d["content"])
        d["stats"] = _decode_stats(d.get("stats"))
        result.append(d)
    return result


def add_message(
    conv_id: str,
    id: str,
    role: str,
    content: Any,
    stats: dict | None,
) -> dict:
    now = _now()
    raw_content = json.dumps(content) if isinstance(content, list) else str(content)
    raw_stats = json.dumps(stats) if stats is not None else None

    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, stats, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (id, conv_id, role, raw_content, raw_stats, now),
        )
        conn.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (now, conv_id),
        )
        conn.commit()

    return {
        "id": id,
        "conversation_id": conv_id,
        "role": role,
        "content": content,
        "stats": stats,
        "created_at": now,
    }


def delete_messages(conv_id: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))
        conn.commit()


def get_app_state(key: str) -> str | None:
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT value FROM app_state WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_app_state(key: str, value: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO app_state (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value)
        )
        conn.commit()


def save_benchmark(data: dict) -> int:
    import json as _json
    from datetime import datetime
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "INSERT INTO benchmarks (data, created_at) VALUES (?, ?)",
            (_json.dumps(data), datetime.utcnow().isoformat())
        )
        conn.commit()
    return cur.lastrowid


def get_benchmarks(limit: int = 50) -> list[dict]:
    import json as _json
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT id, data, created_at FROM benchmarks ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    results = []
    for row in rows:
        try:
            d = _json.loads(row["data"])
            d["_db_id"] = row["id"]
            results.append(d)
        except Exception:
            pass
    return results


def delete_benchmark(bench_id: int) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute("DELETE FROM benchmarks WHERE id = ?", (bench_id,))
        conn.commit()


def clear_benchmarks() -> None:
    with _lock:
        conn = _get_conn()
        conn.execute("DELETE FROM benchmarks")
        conn.commit()
