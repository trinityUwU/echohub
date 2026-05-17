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
        # Seed builtin profiles — add any missing ones
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
