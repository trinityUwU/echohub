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

            CREATE TABLE IF NOT EXISTS benchmark_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                prompt TEXT NOT NULL,
                max_tokens INTEGER NOT NULL DEFAULT 200,
                temperature REAL NOT NULL DEFAULT 0.0,
                builtin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS training_pairs (
                id TEXT PRIMARY KEY,
                prompt TEXT NOT NULL,
                chosen TEXT NOT NULL,
                rejected TEXT NOT NULL,
                source_conv_id TEXT,
                source_msg_id TEXT,
                model_id TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS finetune_jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'pending',
                model_id TEXT NOT NULL,
                output_path TEXT,
                config TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                error TEXT
            );

            CREATE TABLE IF NOT EXISTS download_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_id TEXT NOT NULL UNIQUE,
                model_name TEXT,
                state TEXT NOT NULL DEFAULT 'pending',
                downloaded_gb REAL NOT NULL DEFAULT 0.0,
                total_gb REAL,
                error TEXT,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                params_billion REAL,
                quantization TEXT,
                size_gb REAL
            );

            CREATE TABLE IF NOT EXISTS finetune_profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                domain TEXT NOT NULL DEFAULT 'general',
                target_pairs INTEGER NOT NULL DEFAULT 100,
                color TEXT NOT NULL DEFAULT '#6366f1',
                created_at TEXT NOT NULL,
                builtin INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS finetune_evals (
                id TEXT PRIMARY KEY,
                job_id TEXT,
                profile_id TEXT,
                stage TEXT NOT NULL,
                model_path TEXT NOT NULL,
                model_id TEXT NOT NULL,
                results TEXT NOT NULL,
                score_avg REAL,
                created_at TEXT NOT NULL
            );
        """)
        conn.commit()
        # Migrations — add columns/tables missing from older DBs
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(conversations)")}
        if "archived" not in existing_cols:
            conn.execute("ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
            conn.commit()
        existing_tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "benchmarks" not in existing_tables:
            conn.execute("""
                CREATE TABLE benchmarks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    data TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            conn.commit()
        # Add pipeline_stage to finetune_jobs if missing
        ft_job_cols = {row[1] for row in conn.execute("PRAGMA table_info(finetune_jobs)")}
        if "pipeline_stage" not in ft_job_cols:
            conn.execute("ALTER TABLE finetune_jobs ADD COLUMN pipeline_stage TEXT")
            conn.commit()

        # Add name/archived columns to benchmarks if missing
        bench_cols = {row[1] for row in conn.execute("PRAGMA table_info(benchmarks)")}
        if "name" not in bench_cols:
            conn.execute("ALTER TABLE benchmarks ADD COLUMN name TEXT NOT NULL DEFAULT ''")
            conn.commit()
        if "archived" not in bench_cols:
            conn.execute("ALTER TABLE benchmarks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
            conn.commit()

        if "benchmark_profiles" not in existing_tables:
            conn.execute("""
                CREATE TABLE benchmark_profiles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    prompt TEXT NOT NULL,
                    max_tokens INTEGER NOT NULL DEFAULT 200,
                    temperature REAL NOT NULL DEFAULT 0.0,
                    builtin INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                )
            """)
            conn.commit()
        if "training_pairs" not in existing_tables:
            conn.execute("""
                CREATE TABLE training_pairs (
                    id TEXT PRIMARY KEY,
                    prompt TEXT NOT NULL,
                    chosen TEXT NOT NULL,
                    rejected TEXT NOT NULL,
                    source_conv_id TEXT,
                    source_msg_id TEXT,
                    model_id TEXT,
                    created_at TEXT NOT NULL
                )
            """)
            conn.commit()
        if "finetune_jobs" not in existing_tables:
            conn.execute("""
                CREATE TABLE finetune_jobs (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL DEFAULT 'pending',
                    model_id TEXT NOT NULL,
                    output_path TEXT,
                    config TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    error TEXT
                )
            """)
            conn.commit()
        if "download_history" not in existing_tables:
            conn.execute("""CREATE TABLE download_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_id TEXT NOT NULL UNIQUE,
                model_name TEXT,
                state TEXT NOT NULL DEFAULT 'pending',
                downloaded_gb REAL NOT NULL DEFAULT 0.0,
                total_gb REAL,
                error TEXT,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                params_billion REAL,
                quantization TEXT,
                size_gb REAL
            )""")
            conn.commit()
        if "finetune_profiles" not in existing_tables:
            conn.execute("""CREATE TABLE finetune_profiles (
                id TEXT PRIMARY KEY, name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                domain TEXT NOT NULL DEFAULT 'general',
                target_pairs INTEGER NOT NULL DEFAULT 100,
                color TEXT NOT NULL DEFAULT '#6366f1',
                created_at TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 0
            )""")
            conn.commit()
        if "finetune_evals" not in existing_tables:
            conn.execute("""CREATE TABLE finetune_evals (
                id TEXT PRIMARY KEY, job_id TEXT, profile_id TEXT,
                stage TEXT NOT NULL, model_path TEXT NOT NULL, model_id TEXT NOT NULL,
                results TEXT NOT NULL, score_avg REAL, created_at TEXT NOT NULL
            )""")
            conn.commit()
        # Add project_conversations and project_messages tables if missing
        existing_tables2 = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "project_conversations" not in existing_tables2:
            conn.execute("""
                CREATE TABLE project_conversations (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT 'New conversation',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_proj_convs ON project_conversations(project_id)")
            conn.commit()
        if "project_messages" not in existing_tables2:
            conn.execute("""
                CREATE TABLE project_messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES project_conversations(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_proj_msgs ON project_messages(conversation_id)")
            conn.commit()

        # Add load_config to messages if missing
        msg_cols = {row[1] for row in conn.execute("PRAGMA table_info(messages)")}
        if "load_config" not in msg_cols:
            conn.execute("ALTER TABLE messages ADD COLUMN load_config TEXT")
            conn.commit()
        # Add profile_id to training_pairs if missing
        pair_cols = {row[1] for row in conn.execute("PRAGMA table_info(training_pairs)")}
        if "profile_id" not in pair_cols:
            conn.execute("ALTER TABLE training_pairs ADD COLUMN profile_id TEXT")
            conn.commit()
        # Seed builtin finetune profiles — add any missing ones
        existing_profile_names = {row[0] for row in conn.execute("SELECT name FROM finetune_profiles WHERE builtin=1")}
        for p in _BUILTIN_FT_PROFILES:
            if p["name"] not in existing_profile_names:
                conn.execute(
                    "INSERT INTO finetune_profiles (id, name, description, domain, target_pairs, color, created_at, builtin) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
                    (str(__import__('uuid').uuid4()), p["name"], p["description"], p["domain"], p["target_pairs"], p["color"], _now())
                )
        conn.commit()
        # Seed builtin benchmark profiles — add any missing ones
        existing_names = {row[0] for row in conn.execute("SELECT name FROM benchmark_profiles WHERE builtin=1")}
        missing = [p for p in _BUILTIN_PROFILES if p["name"] not in existing_names]
        if missing:
            from datetime import datetime as _dt
            now = _dt.utcnow().isoformat()
            for p in missing:
                conn.execute(
                    "INSERT INTO benchmark_profiles (name, description, prompt, max_tokens, temperature, builtin, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
                    (p["name"], p["description"], p["prompt"], p["max_tokens"], p["temperature"], now)
                )
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
        d["load_config"] = _decode_stats(d.get("load_config"))  # same JSON→dict pattern
        result.append(d)
    return result


def add_message(
    conv_id: str,
    id: str,
    role: str,
    content: Any,
    stats: dict | None,
    load_config: dict | None = None,
) -> dict:
    now = _now()
    raw_content = json.dumps(content) if isinstance(content, list) else str(content)
    raw_stats = json.dumps(stats) if stats is not None else None
    raw_load_config = json.dumps(load_config) if load_config is not None else None

    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, stats, load_config, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (id, conv_id, role, raw_content, raw_stats, raw_load_config, now),
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
        "load_config": load_config,
        "created_at": now,
    }


def delete_messages(conv_id: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))
        conn.commit()


def delete_message(conv_id: str, message_id: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "DELETE FROM messages WHERE conversation_id = ? AND id = ?",
            (conv_id, message_id),
        )
        conn.commit()
        return cur.rowcount > 0


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


def _auto_bench_name(data: dict) -> str:
    """Generate default name: model-profile-date-time."""
    from datetime import datetime
    model = data.get("model_name", "unknown").split("/")[-1]
    # Shorten long model names (keep first 3 segments separated by -)
    parts = model.split("-")
    short_model = "-".join(parts[:4]) if len(parts) > 4 else model
    profile = data.get("profile_name", "")
    ts = data.get("timestamp")
    dt = datetime.utcfromtimestamp(ts) if ts else datetime.utcnow()
    date_str = dt.strftime("%d %b %H:%M")
    if profile:
        return f"{short_model}-{profile}-{date_str}"
    return f"{short_model}-{date_str}"


def save_benchmark(data: dict) -> int:
    import json as _json
    from datetime import datetime
    name = _auto_bench_name(data)
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "INSERT INTO benchmarks (data, created_at, name) VALUES (?, ?, ?)",
            (_json.dumps(data), datetime.utcnow().isoformat(), name)
        )
        conn.commit()
    return cur.lastrowid


def get_benchmarks(limit: int = 50, include_archived: bool = False) -> list[dict]:
    import json as _json
    with _lock:
        conn = _get_conn()
        where = "" if include_archived else "WHERE archived = 0"
        rows = conn.execute(
            f"SELECT id, data, created_at, name, archived FROM benchmarks {where} ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    results = []
    for row in rows:
        try:
            d = _json.loads(row["data"])
            d["_db_id"] = row["id"]
            d["_name"] = row["name"] or ""
            d["_archived"] = bool(row["archived"])
            results.append(d)
        except Exception:
            pass
    return results


def update_benchmark(bench_id: int, name: str | None = None, archived: bool | None = None) -> bool:
    with _lock:
        conn = _get_conn()
        fields, values = [], []
        if name is not None:
            fields.append("name = ?"); values.append(name)
        if archived is not None:
            fields.append("archived = ?"); values.append(1 if archived else 0)
        if not fields:
            return False
        values.append(bench_id)
        conn.execute(f"UPDATE benchmarks SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    return True


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


# ── Finetune profiles ─────────────────────────────────────────────────────

def get_finetune_profiles() -> list[dict]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute("SELECT * FROM finetune_profiles ORDER BY builtin DESC, created_at ASC").fetchall()
    return [_row_to_dict(r) for r in rows]


def get_finetune_profile(profile_id: str) -> dict | None:
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT * FROM finetune_profiles WHERE id = ?", (profile_id,)).fetchone()
    return _row_to_dict(row) if row else None


def create_finetune_profile(id: str, name: str, description: str, domain: str,
                             target_pairs: int, color: str) -> dict:
    now = _now()
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO finetune_profiles (id, name, description, domain, target_pairs, color, created_at, builtin) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
            (id, name, description, domain, target_pairs, color, now)
        )
        conn.commit()
    return {"id": id, "name": name, "description": description, "domain": domain,
            "target_pairs": target_pairs, "color": color, "created_at": now, "builtin": 0}


def delete_finetune_profile(profile_id: str) -> bool:
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT builtin FROM finetune_profiles WHERE id = ?", (profile_id,)).fetchone()
        if not row or row["builtin"]:
            return False
        conn.execute("DELETE FROM finetune_profiles WHERE id = ?", (profile_id,))
        conn.commit()
    return True


def get_training_pairs_for_profile(profile_id: str) -> list[dict]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM training_pairs WHERE profile_id = ? ORDER BY created_at DESC", (profile_id,)
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_profile_pair_counts() -> dict[str, int]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT profile_id, COUNT(*) as cnt FROM training_pairs WHERE profile_id IS NOT NULL GROUP BY profile_id"
        ).fetchall()
    return {row["profile_id"]: row["cnt"] for row in rows}


# ── Finetune evals ────────────────────────────────────────────────────────

def create_finetune_eval(id: str, job_id: str | None, profile_id: str | None,
                          stage: str, model_path: str, model_id: str,
                          results: list[dict], score_avg: float | None) -> dict:
    import json as _json
    now = _now()
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO finetune_evals (id, job_id, profile_id, stage, model_path, model_id, results, score_avg, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (id, job_id, profile_id, stage, model_path, model_id, _json.dumps(results), score_avg, now)
        )
        conn.commit()
    return {"id": id, "job_id": job_id, "profile_id": profile_id, "stage": stage,
            "model_path": model_path, "model_id": model_id, "results": results,
            "score_avg": score_avg, "created_at": now}


def get_finetune_evals(job_id: str | None = None, profile_id: str | None = None) -> list[dict]:
    import json as _json
    with _lock:
        conn = _get_conn()
        if job_id:
            rows = conn.execute("SELECT * FROM finetune_evals WHERE job_id = ? ORDER BY created_at ASC", (job_id,)).fetchall()
        elif profile_id:
            rows = conn.execute("SELECT * FROM finetune_evals WHERE profile_id = ? ORDER BY created_at DESC LIMIT 20", (profile_id,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM finetune_evals ORDER BY created_at DESC LIMIT 50").fetchall()
    result = []
    for row in rows:
        d = _row_to_dict(row)
        try:
            d["results"] = _json.loads(d["results"])
        except Exception:
            d["results"] = []
        result.append(d)
    return result


# ── Training pairs ────────────────────────────────────────────────────────

def create_training_pair(
    id: str,
    prompt: str,
    chosen: str,
    rejected: str,
    source_conv_id: str | None,
    source_msg_id: str | None,
    model_id: str | None,
    profile_id: str | None = None,
) -> dict:
    now = _now()
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO training_pairs (id, prompt, chosen, rejected, source_conv_id, source_msg_id, model_id, profile_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (id, prompt, chosen, rejected, source_conv_id, source_msg_id, model_id, profile_id, now),
        )
        conn.commit()
    return {
        "id": id,
        "prompt": prompt,
        "chosen": chosen,
        "rejected": rejected,
        "source_conv_id": source_conv_id,
        "source_msg_id": source_msg_id,
        "model_id": model_id,
        "profile_id": profile_id,
        "created_at": now,
    }


def get_training_pairs(limit: int = 200) -> list[dict]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM training_pairs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def delete_training_pair(pair_id: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute("DELETE FROM training_pairs WHERE id = ?", (pair_id,))
        conn.commit()
    return cur.rowcount > 0


def get_training_pair_count() -> int:
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT COUNT(*) FROM training_pairs").fetchone()
    return row[0]


# ── Finetune jobs ─────────────────────────────────────────────────────────

def create_finetune_job(id: str, model_id: str, config: dict) -> dict:
    import json as _json
    now = _now()
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO finetune_jobs (id, status, model_id, config, created_at, updated_at) "
            "VALUES (?, 'pending', ?, ?, ?, ?)",
            (id, model_id, _json.dumps(config), now, now),
        )
        conn.commit()
    return {
        "id": id,
        "status": "pending",
        "model_id": model_id,
        "config": config,
        "output_path": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }


def update_finetune_job(
    job_id: str,
    status: str | None = None,
    output_path: str | None = None,
    error: str | None = None,
    pipeline_stage: str | None = None,
) -> dict | None:
    import json as _json
    now = _now()
    fields: list[str] = ["updated_at = ?"]
    values: list[Any] = [now]
    if status is not None:
        fields.append("status = ?")
        values.append(status)
    if output_path is not None:
        fields.append("output_path = ?")
        values.append(output_path)
    if error is not None:
        fields.append("error = ?")
        values.append(error)
    if pipeline_stage is not None:
        fields.append("pipeline_stage = ?")
        values.append(pipeline_stage)
    values.append(job_id)
    with _lock:
        conn = _get_conn()
        conn.execute(f"UPDATE finetune_jobs SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
        row = conn.execute("SELECT * FROM finetune_jobs WHERE id = ?", (job_id,)).fetchone()
    if not row:
        return None
    d = _row_to_dict(row)
    try:
        d["config"] = _json.loads(d["config"])
    except Exception:
        pass
    return d


def get_finetune_job(job_id: str) -> dict | None:
    import json as _json
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT * FROM finetune_jobs WHERE id = ?", (job_id,)).fetchone()
    if not row:
        return None
    d = _row_to_dict(row)
    try:
        d["config"] = _json.loads(d["config"])
    except Exception:
        pass
    return d


def get_finetune_jobs(limit: int = 20) -> list[dict]:
    import json as _json
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM finetune_jobs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    result = []
    for row in rows:
        d = _row_to_dict(row)
        try:
            d["config"] = _json.loads(d["config"])
        except Exception:
            pass
        result.append(d)
    return result


# ── Download history ──────────────────────────────────────────────────────

def upsert_download_history(
    model_id: str,
    state: str,
    downloaded_gb: float = 0.0,
    total_gb: float | None = None,
    error: str | None = None,
    model_name: str | None = None,
    params_billion: float | None = None,
    quantization: str | None = None,
    size_gb: float | None = None,
    completed_at: str | None = None,
) -> None:
    now = _now()
    with _lock:
        conn = _get_conn()
        existing = conn.execute("SELECT id FROM download_history WHERE model_id = ?", (model_id,)).fetchone()
        if existing:
            fields = ["state = ?", "downloaded_gb = ?", "total_gb = ?"]
            values: list = [state, downloaded_gb, total_gb]
            if error is not None:
                fields.append("error = ?"); values.append(error)
            if model_name is not None:
                fields.append("model_name = ?"); values.append(model_name)
            if params_billion is not None:
                fields.append("params_billion = ?"); values.append(params_billion)
            if quantization is not None:
                fields.append("quantization = ?"); values.append(quantization)
            if size_gb is not None:
                fields.append("size_gb = ?"); values.append(size_gb)
            if completed_at is not None:
                fields.append("completed_at = ?"); values.append(completed_at)
            values.append(model_id)
            conn.execute(f"UPDATE download_history SET {', '.join(fields)} WHERE model_id = ?", values)
        else:
            conn.execute(
                "INSERT INTO download_history (model_id, model_name, state, downloaded_gb, total_gb, error, started_at, completed_at, params_billion, quantization, size_gb) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (model_id, model_name, state, downloaded_gb, total_gb, error, now, completed_at, params_billion, quantization, size_gb)
            )
        conn.commit()


def get_download_history(limit: int = 100) -> list[dict]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM download_history ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def delete_download_history_entry(model_id: str) -> bool:
    with _lock:
        conn = _get_conn()
        cur = conn.execute("DELETE FROM download_history WHERE model_id = ?", (model_id,))
        conn.commit()
    return cur.rowcount > 0


# ── Project conversations ──────────────────────────────────────────────────

import time as _time
import uuid as _uuid


def create_project_conversation(project_id: str, title: str = "New conversation") -> dict:
    now = _time.time()
    conv_id = str(_uuid.uuid4())
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO project_conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (conv_id, project_id, title, now, now),
        )
        conn.commit()
    return {"id": conv_id, "project_id": project_id, "title": title, "created_at": now, "updated_at": now}


def list_project_conversations(project_id: str) -> list[dict]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM project_conversations WHERE project_id = ? ORDER BY updated_at DESC",
            (project_id,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def delete_project_conversation(conv_id: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute("DELETE FROM project_conversations WHERE id = ?", (conv_id,))
        conn.commit()


def rename_project_conversation(conv_id: str, title: str) -> None:
    now = _time.time()
    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE project_conversations SET title = ?, updated_at = ? WHERE id = ?",
            (title, now, conv_id),
        )
        conn.commit()


def save_project_message(conv_id: str, role: str, content: str) -> dict:
    now = _time.time()
    msg_id = str(_uuid.uuid4())
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT INTO project_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (msg_id, conv_id, role, content, now),
        )
        conn.execute(
            "UPDATE project_conversations SET updated_at = ? WHERE id = ?",
            (now, conv_id),
        )
        conn.commit()
    return {"id": msg_id, "conversation_id": conv_id, "role": role, "content": content, "created_at": now}


def list_project_messages(conv_id: str) -> list[dict]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM project_messages WHERE conversation_id = ? ORDER BY created_at ASC",
            (conv_id,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def delete_project_messages(conv_id: str) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute("DELETE FROM project_messages WHERE conversation_id = ?", (conv_id,))
        conn.commit()


_BUILTIN_PROFILES = [
    {
        "name": "Latency",
        "description": "Short prompt, few tokens — measures TTFT and perceived responsiveness.",
        "prompt": "What is the capital of France? Answer in one sentence.",
        "max_tokens": 50,
        "temperature": 0.0,
    },
    {
        "name": "Throughput",
        "description": "Medium prompt, long output — measures sustained decode speed.",
        "prompt": (
            "Write a detailed explanation of how transformers work in machine learning, "
            "including attention mechanisms, positional encoding, and training objectives. "
            "Be thorough and technical."
        ),
        "max_tokens": 500,
        "temperature": 0.0,
    },
    {
        "name": "Prefill",
        "description": "Long prompt, short output — measures context ingestion speed.",
        "prompt": (
            "The following is a passage about the history of computing: "
            "The history of computing begins with mechanical calculators in the 17th century. "
            "Blaise Pascal invented the Pascaline in 1642, followed by Leibniz's step reckoner in 1672. "
            "Charles Babbage designed the Difference Engine in 1822 and the Analytical Engine in 1837, "
            "which contained the essential elements of a modern computer. Ada Lovelace wrote what is "
            "considered the first algorithm intended for processing on the Analytical Engine. "
            "The 20th century saw the development of vacuum tube computers, transistors, integrated "
            "circuits, and microprocessors. Alan Turing's theoretical work laid the foundation for "
            "computer science. The first general-purpose electronic computer, ENIAC, was completed in 1945. "
            "The invention of the transistor in 1947 at Bell Labs revolutionized computing. "
            "Summarize the key milestones mentioned above in three bullet points."
        ),
        "max_tokens": 80,
        "temperature": 0.0,
    },
    {
        "name": "Code",
        "description": "Realistic coding prompt — measures generation speed on code tasks.",
        "prompt": (
            "Write a Python function that implements a binary search tree with insert, "
            "search, and inorder traversal methods. Include type hints and docstrings."
        ),
        "max_tokens": 400,
        "temperature": 0.0,
    },
    {
        "name": "Long Context",
        "description": "Large context window stress test — measures prefill speed on ~1500 token input.",
        "prompt": (
            "You are given the following codebase to review:\n\n"
            "```python\n"
            "import asyncio\nimport json\nimport threading\nfrom pathlib import Path\nfrom typing import Optional, List, Dict, Any\n\n"
            "class DataPipeline:\n"
            "    def __init__(self, config: Dict[str, Any]):\n"
            "        self.config = config\n"
            "        self.workers: List[threading.Thread] = []\n"
            "        self.results: Dict[str, Any] = {}\n"
            "        self._lock = threading.Lock()\n"
            "        self._queue: asyncio.Queue = asyncio.Queue(maxsize=100)\n\n"
            "    async def process_batch(self, items: List[str]) -> List[Dict]:\n"
            "        processed = []\n"
            "        for item in items:\n"
            "            try:\n"
            "                result = await self._transform(item)\n"
            "                if result and self._validate(result):\n"
            "                    processed.append(result)\n"
            "                    with self._lock:\n"
            "                        self.results[item] = result\n"
            "            except Exception as e:\n"
            "                print(f'Error processing {item}: {e}')\n"
            "                continue\n"
            "        return processed\n\n"
            "    async def _transform(self, item: str) -> Optional[Dict]:\n"
            "        await asyncio.sleep(0.001)\n"
            "        parts = item.split(':')\n"
            "        if len(parts) != 2:\n"
            "            return None\n"
            "        key, value = parts\n"
            "        return {'key': key.strip(), 'value': value.strip(), 'timestamp': asyncio.get_event_loop().time()}\n\n"
            "    def _validate(self, result: Dict) -> bool:\n"
            "        return bool(result.get('key')) and bool(result.get('value'))\n\n"
            "    def start_workers(self, n: int = 4) -> None:\n"
            "        for i in range(n):\n"
            "            t = threading.Thread(target=self._worker_loop, args=(i,), daemon=True)\n"
            "            t.start()\n"
            "            self.workers.append(t)\n\n"
            "    def _worker_loop(self, worker_id: int) -> None:\n"
            "        while True:\n"
            "            try:\n"
            "                item = self._queue.get_nowait()\n"
            "                asyncio.run(self._transform(item))\n"
            "            except Exception:\n"
            "                threading.Event().wait(0.1)\n"
            "```\n\n"
            "Identify the top 3 bugs or design issues in this code and suggest fixes for each."
        ),
        "max_tokens": 300,
        "temperature": 0.0,
    },
    {
        "name": "Reasoning",
        "description": "Logic and math problem — tests reasoning quality and speed.",
        "prompt": (
            "A train leaves station A at 9:00 AM traveling at 80 km/h toward station B. "
            "Another train leaves station B at 9:30 AM traveling at 120 km/h toward station A. "
            "The distance between the two stations is 420 km. "
            "At what time will the two trains meet, and how far from station A? "
            "Show your reasoning step by step."
        ),
        "max_tokens": 300,
        "temperature": 0.0,
    },
    {
        "name": "Conversation Short",
        "description": "Minimal context dialogue — detects hallucination on established facts.",
        "prompt": (
            "We've been discussing a Python project called 'DataSync' that syncs PostgreSQL to Redis. "
            "The project uses asyncio and was started in 2024. "
            "Now tell me: what database is DataSync syncing to, what async library does it use, "
            "and what year was it started? Answer each question in one sentence."
        ),
        "max_tokens": 150,
        "temperature": 0.0,
    },
    {
        "name": "Conversation Medium",
        "description": "Medium context — retention across a multi-turn simulated conversation.",
        "prompt": (
            "Earlier in our conversation we established these facts: "
            "1) The server runs on port 8421. "
            "2) Authentication uses JWT tokens with a 24-hour expiry. "
            "3) The database has 3 tables: users, sessions, and events. "
            "4) The tech lead's name is Marie. "
            "5) The project deadline is Q3 2026. "
            "Based on these facts, answer: What port does the server run on? "
            "How long do JWT tokens last? Who is the tech lead? "
            "When is the deadline? List all 3 database tables."
        ),
        "max_tokens": 200,
        "temperature": 0.0,
    },
    {
        "name": "Conversation Long",
        "description": "Dense context — memory and coherence across complex multi-fact scenario.",
        "prompt": (
            "Context from our previous conversation: "
            "Project: EchoNet — a distributed message broker written in Go. "
            "Architecture: 5 nodes in a Raft consensus cluster. Leader election timeout: 150ms. "
            "Storage: RocksDB with WAL enabled, 8GB memory budget per node. "
            "Network: nodes communicate over gRPC, TLS 1.3 mandatory. "
            "Performance targets: p99 latency < 2ms, throughput > 50k msg/s per node. "
            "Current issues: node 3 has 40% higher latency, suspected cause is disk I/O contention. "
            "Team: Alice (Go), Bob (infrastructure), Carol (monitoring), Dave (QA). "
            "Deployment: Kubernetes, 3 regions (EU, US-East, AP-South). "
            "Based on all of the above, answer these questions: "
            "1. What is the consensus algorithm used? "
            "2. What storage engine is used and what feature is enabled? "
            "3. Which node has performance issues and what is the suspected cause? "
            "4. What are the two performance targets? "
            "5. Name all team members and their roles."
        ),
        "max_tokens": 300,
        "temperature": 0.0,
    },
    {
        "name": "Instruction",
        "description": "Instruction following — measures compliance and output speed on structured tasks.",
        "prompt": (
            "List exactly 5 best practices for writing production-ready REST APIs. "
            "Format your response as a numbered list. Each item must be one sentence. "
            "Do not include any introduction or conclusion."
        ),
        "max_tokens": 200,
        "temperature": 0.0,
    },
]


_BUILTIN_FT_PROFILES = [
    {
        "name": "Dev",
        "description": "Code generation, debugging, architecture explanations. Target: precise, well-structured code with explanations.",
        "domain": "dev",
        "target_pairs": 100,
        "color": "#3b82f6",
    },
    {
        "name": "Reasoning",
        "description": "Deep analysis, step-by-step reasoning, logic problems. Target: structured thinking with explicit reasoning chains.",
        "domain": "reasoning",
        "target_pairs": 80,
        "color": "#8b5cf6",
    },
    {
        "name": "General",
        "description": "General knowledge, factual Q&A, explanations. Target: accurate, concise, well-sourced answers.",
        "domain": "general",
        "target_pairs": 150,
        "color": "#6366f1",
    },
    {
        "name": "Analysis",
        "description": "Document analysis, summarization, critique. Target: comprehensive coverage of key points without hallucination.",
        "domain": "analysis",
        "target_pairs": 80,
        "color": "#06b6d4",
    },
    {
        "name": "Debug",
        "description": "Error diagnosis, root cause analysis, fix suggestions. Target: systematic diagnosis with actionable fixes.",
        "domain": "debug",
        "target_pairs": 60,
        "color": "#f59e0b",
    },
]


def _seed_builtin_profiles(conn) -> None:
    from datetime import datetime
    now = datetime.utcnow().isoformat()
    for p in _BUILTIN_PROFILES:
        conn.execute(
            "INSERT INTO benchmark_profiles (name, description, prompt, max_tokens, temperature, builtin, created_at) "
            "VALUES (?, ?, ?, ?, ?, 1, ?)",
            (p["name"], p["description"], p["prompt"], p["max_tokens"], p["temperature"], now)
        )
    conn.commit()


def get_benchmark_profiles() -> list[dict]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM benchmark_profiles ORDER BY builtin DESC, id ASC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_benchmark_profile(profile_id: int) -> dict | None:
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT * FROM benchmark_profiles WHERE id=?", (profile_id,)).fetchone()
    return dict(row) if row else None


def create_benchmark_profile(name: str, description: str, prompt: str, max_tokens: int, temperature: float) -> dict:
    from datetime import datetime
    now = datetime.utcnow().isoformat()
    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "INSERT INTO benchmark_profiles (name, description, prompt, max_tokens, temperature, builtin, created_at) "
            "VALUES (?, ?, ?, ?, ?, 0, ?)",
            (name, description, prompt, max_tokens, temperature, now)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM benchmark_profiles WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)


def delete_benchmark_profile(profile_id: int) -> bool:
    with _lock:
        conn = _get_conn()
        # Can't delete builtins
        row = conn.execute("SELECT builtin FROM benchmark_profiles WHERE id=?", (profile_id,)).fetchone()
        if not row or row["builtin"]:
            return False
        conn.execute("DELETE FROM benchmark_profiles WHERE id=?", (profile_id,))
        conn.commit()
    return True
