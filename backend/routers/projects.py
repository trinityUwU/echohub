from __future__ import annotations

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from backend.services import db

router = APIRouter(prefix="/projects", tags=["projects"])


class CreateConversationBody(BaseModel):
    title: str = "New conversation"


class RenameConversationBody(BaseModel):
    title: str


class SaveMessageBody(BaseModel):
    role: str
    content: str


@router.get("/{project_id}/conversations")
def list_conversations(project_id: str) -> list[dict]:
    try:
        return db.list_project_conversations(project_id)
    except Exception as exc:
        logger.error("list_conversations error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/conversations")
def create_conversation(project_id: str, body: CreateConversationBody) -> dict:
    try:
        return db.create_project_conversation(project_id, body.title)
    except Exception as exc:
        logger.error("create_conversation error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/{project_id}/conversations/{conv_id}")
def delete_conversation(project_id: str, conv_id: str) -> dict:
    try:
        db.delete_project_conversation(conv_id)
        return {"ok": True}
    except Exception as exc:
        logger.error("delete_conversation error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/{project_id}/conversations/{conv_id}")
def rename_conversation(project_id: str, conv_id: str, body: RenameConversationBody) -> dict:
    try:
        db.rename_project_conversation(conv_id, body.title)
        return {"ok": True}
    except Exception as exc:
        logger.error("rename_conversation error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{project_id}/conversations/{conv_id}/messages")
def list_messages(project_id: str, conv_id: str) -> list[dict]:
    try:
        return db.list_project_messages(conv_id)
    except Exception as exc:
        logger.error("list_messages error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/conversations/{conv_id}/messages")
def save_message(project_id: str, conv_id: str, body: SaveMessageBody) -> dict:
    try:
        return db.save_project_message(conv_id, body.role, body.content)
    except Exception as exc:
        logger.error("save_message error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/{project_id}/conversations/{conv_id}/messages")
def clear_messages(project_id: str, conv_id: str) -> dict:
    try:
        db.delete_project_messages(conv_id)
        return {"ok": True}
    except Exception as exc:
        logger.error("clear_messages error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{project_id}/workspace-files")
def list_workspace_files_endpoint(project_id: str) -> list:
    from backend.services.tool_service import list_workspace_files
    return list_workspace_files(project_id)


@router.get("/{project_id}/workspace-files/{file_path:path}")
def read_workspace_file(project_id: str, file_path: str) -> dict:
    from backend.services.tool_service import get_workspace_path, _safe_path, _MAX_READ_BYTES
    workspace = get_workspace_path(project_id)
    try:
        target = _safe_path(workspace, file_path)
        if not target.exists() or not target.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        raw = target.read_bytes()
        if len(raw) > _MAX_READ_BYTES:
            content = raw[:_MAX_READ_BYTES].decode("utf-8", errors="replace") + f"\n\n[... truncated at {_MAX_READ_BYTES} bytes]"
        else:
            content = raw.decode("utf-8", errors="replace")
        return {"result": content}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/{project_id}/workspace-files/{file_path:path}")
def delete_workspace_file(project_id: str, file_path: str) -> dict:
    from backend.services.tool_service import get_workspace_path, _safe_path
    workspace = get_workspace_path(project_id)
    try:
        target = _safe_path(workspace, file_path)
        if not target.exists():
            raise HTTPException(status_code=404, detail="File not found")
        target.unlink()
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
