from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.models.schemas import ConversationOut, MessageOut, MessageStats
from backend.services import db

router = APIRouter(prefix="/conversations", tags=["conversations"])

@router.get("", response_model=list)
def list_conversations_filtered(archived: int = 0):
    """Return conversations filtered by archived status (0=active, 1=archived)."""
    with db._lock:
        conn = db._get_conn()
        rows = conn.execute(
            "SELECT c.*, COUNT(m.id) AS message_count FROM conversations c "
            "LEFT JOIN messages m ON m.conversation_id = c.id "
            "WHERE c.archived = ? "
            "GROUP BY c.id ORDER BY c.updated_at DESC",
            (archived,)
        ).fetchall()
    return [dict(r) for r in rows]


class CreateConversationBody(BaseModel):
    id: str
    title: str = "New Chat"
    model_id: str | None = None


class UpdateConversationBody(BaseModel):
    title: str | None = None
    model_id: str | None = None


class AddMessageBody(BaseModel):
    id: str
    role: str
    content: Any
    stats: MessageStats | None = None
    load_config: dict | None = None


def _to_conversation_out(row: dict) -> ConversationOut:
    return ConversationOut(
        id=row["id"],
        title=row["title"],
        model_id=row.get("model_id"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        message_count=row.get("message_count", 0),
    )


def _to_message_out(row: dict) -> MessageOut:
    stats_raw = row.get("stats")
    stats = MessageStats(**stats_raw) if isinstance(stats_raw, dict) else None
    return MessageOut(
        id=row["id"],
        conversation_id=row["conversation_id"],
        role=row["role"],
        content=row["content"],
        stats=stats,
        load_config=row.get("load_config"),
        created_at=row["created_at"],
    )


@router.get("", response_model=list[ConversationOut])
def list_conversations() -> list[ConversationOut]:
    rows = db.get_conversations()
    return [_to_conversation_out(r) for r in rows]


@router.post("", response_model=ConversationOut, status_code=201)
def create_conversation(body: CreateConversationBody) -> ConversationOut:
    row = db.create_conversation(body.id, body.title, body.model_id)
    return _to_conversation_out(row)


@router.get("/{conv_id}", response_model=ConversationOut)
def get_conversation(conv_id: str) -> ConversationOut:
    row = db.get_conversation(conv_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return _to_conversation_out(row)


@router.put("/{conv_id}", response_model=ConversationOut)
def update_conversation(conv_id: str, body: UpdateConversationBody) -> ConversationOut:
    row = db.update_conversation(conv_id, body.title, body.model_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return _to_conversation_out(row)


@router.delete("/{conv_id}")
def delete_conversation(conv_id: str) -> dict:
    deleted = db.delete_conversation(conv_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted"}


@router.get("/{conv_id}/messages", response_model=list[MessageOut])
def get_messages(conv_id: str) -> list[MessageOut]:
    if db.get_conversation(conv_id) is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    rows = db.get_messages(conv_id)
    return [_to_message_out(r) for r in rows]


@router.post("/{conv_id}/messages", response_model=MessageOut, status_code=201)
def add_message(conv_id: str, body: AddMessageBody) -> MessageOut:
    if db.get_conversation(conv_id) is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    stats_dict = body.stats.model_dump() if body.stats else None
    row = db.add_message(conv_id, body.id, body.role, body.content, stats_dict, body.load_config)
    return _to_message_out(row)


@router.delete("/{conv_id}/messages")
def clear_messages(conv_id: str) -> dict:
    if db.get_conversation(conv_id) is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete_messages(conv_id)
    return {"status": "cleared"}


@router.delete("/{conv_id}/messages/{message_id}")
def delete_message(conv_id: str, message_id: str) -> dict:
    if db.get_conversation(conv_id) is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    deleted = db.delete_message(conv_id, message_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"status": "deleted"}


@router.patch("/{conv_id}/archive")
def archive_conversation(conv_id: str) -> dict:
    with db._lock:
        conn = db._get_conn()
        conn.execute("UPDATE conversations SET archived=1, updated_at=? WHERE id=?",
                     (datetime.utcnow().isoformat(), conv_id))
        conn.commit()
    return {"status": "archived", "id": conv_id}


@router.patch("/{conv_id}/unarchive")
def unarchive_conversation(conv_id: str) -> dict:
    with db._lock:
        conn = db._get_conn()
        conn.execute("UPDATE conversations SET archived=0, updated_at=? WHERE id=?",
                     (datetime.utcnow().isoformat(), conv_id))
        conn.commit()
    return {"status": "unarchived", "id": conv_id}
