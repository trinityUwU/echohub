"""
tool_memory.py — Memory tool implementations for tool_service.
Provides _search_memory and _store_memory backed by memory_service.
"""
from __future__ import annotations

from typing import Any

from loguru import logger


def _search_memory(args: dict[str, Any], conv_id: str, project_id: str) -> str:
    from backend.services import memory_service as ms
    query = args.get("query", "")
    if not query:
        return "Error: query is required"
    scope = args.get("scope", "global")
    limit = min(int(args.get("limit", 5)), 10)

    scoped_conv = conv_id if scope == "conversation" else None
    scoped_proj = project_id if scope == "project" else None

    results = ms.search(query=query, conv_id=scoped_conv, project_id=scoped_proj, limit=limit)
    if not results:
        return "No relevant memories found."

    lines = [f"Found {len(results)} memories:\n"]
    for r in results:
        lines.append(f"[{r.type}] (importance={r.importance}) {r.content}")
    return "\n".join(lines)


def _store_memory(args: dict[str, Any], conv_id: str, project_id: str) -> str:
    from backend.services import memory_service as ms
    content = args.get("content", "")
    mem_type = args.get("type", "fact")
    importance = min(max(int(args.get("importance", 5)), 1), 10)

    if not content:
        return "Error: content is required"

    mem_id = ms.store(
        content=content,
        type=mem_type,
        conv_id=conv_id,
        project_id=project_id,
        importance=importance,
    )
    return f"Memory stored (id={mem_id[:8]}...)."
