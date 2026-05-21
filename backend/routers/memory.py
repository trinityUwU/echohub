from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services import memory_service as ms

router = APIRouter(prefix="/memory", tags=["memory"])

MemoryType = Literal["user_trait", "decision", "fact", "context", "error_learned"]


class StoreBody(BaseModel):
    content: str
    type: MemoryType
    conv_id: str = "global"
    project_id: str = "global"
    importance: int = Field(default=5, ge=1, le=10)
    source_msg_id: str | None = None


class SearchBody(BaseModel):
    query: str
    conv_id: str | None = None
    project_id: str | None = None
    type: MemoryType | None = None
    limit: int = Field(default=5, ge=1, le=20)


@router.post("/store")
def store_memory(body: StoreBody) -> dict:
    try:
        mem_id = ms.store(
            content=body.content,
            type=body.type,
            conv_id=body.conv_id,
            project_id=body.project_id,
            importance=body.importance,
            source_msg_id=body.source_msg_id,
        )
        return {"id": mem_id, "stored": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/search")
def search_memory(body: SearchBody) -> list[dict]:
    try:
        results = ms.search(
            query=body.query,
            conv_id=body.conv_id,
            project_id=body.project_id,
            memory_type=body.type,
            limit=body.limit,
        )
        return [r.to_dict() for r in results]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/list")
def list_memories(
    conv_id: str | None = None,
    project_id: str | None = None,
    type: MemoryType | None = None,
    limit: int = 100,
) -> list[dict]:
    try:
        results = ms.get_all(conv_id=conv_id, project_id=project_id, memory_type=type, limit=limit)
        return [r.to_dict() for r in results]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/{memory_id}")
def delete_memory(memory_id: str) -> dict:
    deleted = ms.delete(memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"deleted": True}


@router.get("/stats")
def memory_stats() -> dict:
    try:
        s = ms.stats()
        return {"total": s.total, "by_type": s.by_type, "chroma_dir": s.chroma_dir}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
