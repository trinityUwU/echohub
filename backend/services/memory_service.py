from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import chromadb
from chromadb.config import Settings
from loguru import logger

from backend.services.user_data import get_user_data_dir

MemoryType = Literal["user_trait", "decision", "fact", "context", "error_learned"]

_CHROMA_DIR = Path(os.getenv("CHROMA_DIR", "")) or (get_user_data_dir() / "chromadb")
_client: chromadb.ClientAPI | None = None


def _get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        _CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(
            path=str(_CHROMA_DIR),
            settings=Settings(anonymized_telemetry=False),
        )
    return _client


def _get_collection(name: str) -> chromadb.Collection:
    return _get_client().get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
    )


def _embed(text: str) -> list[float]:
    from backend.services.embedding_service import encode
    return encode(text)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class MemoryResult:
    id: str
    content: str
    type: str
    conv_id: str
    project_id: str
    importance: int
    distance: float
    created_at: str

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "content": self.content,
            "type": self.type,
            "conv_id": self.conv_id,
            "project_id": self.project_id,
            "importance": self.importance,
            "distance": self.distance,
            "created_at": self.created_at,
        }


@dataclass
class MemoryStats:
    total: int
    by_type: dict[str, int]
    chroma_dir: str


def store(
    content: str,
    type: MemoryType,
    conv_id: str = "global",
    project_id: str = "global",
    importance: int = 5,
    source_msg_id: str | None = None,
) -> str:
    """Store a memory chunk. Returns the memory id."""
    coll = _get_collection("echohub_memory")
    mem_id = str(uuid.uuid4())
    embedding = _embed(content)
    meta: dict = {
        "type": type,
        "conv_id": conv_id,
        "project_id": project_id,
        "importance": importance,
        "created_at": _now(),
    }
    if source_msg_id:
        meta["source_msg_id"] = source_msg_id
    coll.add(
        ids=[mem_id],
        embeddings=[embedding],
        documents=[content],
        metadatas=[meta],
    )
    logger.debug("Memory stored [{}] conv={} proj={}", type, conv_id, project_id)
    return mem_id


def search(
    query: str,
    conv_id: str | None = None,
    project_id: str | None = None,
    memory_type: MemoryType | None = None,
    limit: int = 5,
) -> list[MemoryResult]:
    """Semantic search. No filters = global cross-session search."""
    coll = _get_collection("echohub_memory")
    embedding = _embed(query)

    where: dict = {}
    if conv_id is not None:
        where["conv_id"] = conv_id
    if project_id is not None:
        where["project_id"] = project_id
    if memory_type is not None:
        where["type"] = memory_type

    kwargs: dict = {
        "query_embeddings": [embedding],
        "n_results": limit,
        "include": ["documents", "metadatas", "distances"],
    }
    if where:
        kwargs["where"] = where

    try:
        results = coll.query(**kwargs)
    except Exception as e:
        # Collection empty or no results
        logger.debug("Memory search returned no results: {}", e)
        return []

    memories: list[MemoryResult] = []
    ids = results["ids"][0]
    docs = results["documents"][0]
    metas = results["metadatas"][0]
    distances = results["distances"][0]

    for i, mem_id in enumerate(ids):
        meta = metas[i]
        memories.append(MemoryResult(
            id=mem_id,
            content=docs[i],
            type=meta.get("type", "fact"),
            conv_id=meta.get("conv_id", "global"),
            project_id=meta.get("project_id", "global"),
            importance=int(meta.get("importance", 5)),
            distance=float(distances[i]),
            created_at=meta.get("created_at", ""),
        ))

    return memories


def delete(memory_id: str) -> bool:
    coll = _get_collection("echohub_memory")
    try:
        coll.delete(ids=[memory_id])
        return True
    except Exception:
        return False


def delete_by_conv(conv_id: str) -> int:
    coll = _get_collection("echohub_memory")
    try:
        results = coll.get(where={"conv_id": conv_id})
        ids = results["ids"]
        if ids:
            coll.delete(ids=ids)
        return len(ids)
    except Exception:
        return 0


def get_all(
    conv_id: str | None = None,
    project_id: str | None = None,
    memory_type: MemoryType | None = None,
    limit: int = 200,
) -> list[MemoryResult]:
    coll = _get_collection("echohub_memory")
    where: dict = {}
    if conv_id is not None:
        where["conv_id"] = conv_id
    if project_id is not None:
        where["project_id"] = project_id
    if memory_type is not None:
        where["type"] = memory_type

    kwargs: dict = {"include": ["documents", "metadatas"], "limit": limit}
    if where:
        kwargs["where"] = where

    try:
        results = coll.get(**kwargs)
    except Exception:
        return []

    memories: list[MemoryResult] = []
    for i, mem_id in enumerate(results["ids"]):
        meta = results["metadatas"][i]
        memories.append(MemoryResult(
            id=mem_id,
            content=results["documents"][i],
            type=meta.get("type", "fact"),
            conv_id=meta.get("conv_id", "global"),
            project_id=meta.get("project_id", "global"),
            importance=int(meta.get("importance", 5)),
            distance=0.0,
            created_at=meta.get("created_at", ""),
        ))

    return sorted(memories, key=lambda m: m.created_at, reverse=True)


def stats() -> MemoryStats:
    coll = _get_collection("echohub_memory")
    try:
        all_metas = coll.get(include=["metadatas"])["metadatas"]
    except Exception:
        all_metas = []

    by_type: dict[str, int] = {}
    for m in all_metas:
        t = m.get("type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1

    return MemoryStats(
        total=len(all_metas),
        by_type=by_type,
        chroma_dir=str(_CHROMA_DIR),
    )
