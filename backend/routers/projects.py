from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from loguru import logger
from pydantic import BaseModel

from backend.services import conversation_manager as cm
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
def list_conversations(project_id: str, archived: bool = False) -> list[dict]:
    try:
        return cm.list_project_conversations(project_id, archived=archived)
    except Exception as exc:
        logger.error("list_conversations error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/conversations")
def create_conversation(project_id: str, body: CreateConversationBody) -> dict:
    try:
        return cm.create_project_conversation(project_id, body.title)
    except Exception as exc:
        logger.error("create_conversation error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/{project_id}/conversations/{conv_id}")
def delete_conversation(project_id: str, conv_id: str) -> dict:
    try:
        cm.delete_project_conversation(conv_id)
        return {"ok": True}
    except Exception as exc:
        logger.error("delete_conversation error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/{project_id}/conversations/{conv_id}")
def rename_conversation(project_id: str, conv_id: str, body: RenameConversationBody) -> dict:
    try:
        cm.rename_project_conversation(conv_id, body.title)
        return {"ok": True}
    except Exception as exc:
        logger.error("rename_conversation error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{project_id}/conversations/{conv_id}/messages")
def list_messages(project_id: str, conv_id: str) -> list[dict]:
    try:
        return cm.list_project_messages(conv_id)
    except Exception as exc:
        logger.error("list_messages error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/conversations/{conv_id}/messages")
def save_message(project_id: str, conv_id: str, body: SaveMessageBody) -> dict:
    try:
        return cm.save_project_message(conv_id, body.role, body.content)
    except Exception as exc:
        logger.error("save_message error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/{project_id}/conversations/{conv_id}/archive")
def archive_conversation(project_id: str, conv_id: str) -> dict:
    try:
        cm.archive_project_conversation(conv_id, archived=True)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.patch("/{project_id}/conversations/{conv_id}/unarchive")
def unarchive_conversation(project_id: str, conv_id: str) -> dict:
    try:
        cm.archive_project_conversation(conv_id, archived=False)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/{project_id}/conversations/{conv_id}/messages")
def clear_messages(project_id: str, conv_id: str) -> dict:
    try:
        cm.delete_project_messages(conv_id)
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


# ── Context files (Docs mode) ──────────────────────────────────────────────────

@router.get("/{project_id}/context-files")
def list_context_files(project_id: str) -> list[dict]:
    try:
        return db.list_context_files(project_id)
    except Exception as exc:
        logger.error("list_context_files error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/context-files")
async def upload_context_file(
    project_id: str,
    file: UploadFile = File(...),
) -> dict:
    try:
        raw = await file.read()
        content = raw.decode("utf-8", errors="replace")
        filename = file.filename or "file.txt"
        return db.add_context_file(project_id, filename, content)
    except Exception as exc:
        logger.error("upload_context_file error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/{project_id}/context-files/{file_id}")
def delete_context_file(project_id: str, file_id: str) -> dict:
    try:
        db.delete_context_file(file_id)
        return {"ok": True}
    except Exception as exc:
        logger.error("delete_context_file error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── Sources (Research mode) ────────────────────────────────────────────────────

class AddSourceBody(BaseModel):
    label: str
    url: str | None = None
    content: str = ""
    source_type: str = "url"


@router.get("/{project_id}/sources")
def list_sources(project_id: str) -> list[dict]:
    try:
        return db.list_sources(project_id)
    except Exception as exc:
        logger.error("list_sources error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/sources")
def add_source(project_id: str, body: AddSourceBody) -> dict:
    try:
        return db.add_source(project_id, body.label, body.url, body.content, body.source_type)
    except Exception as exc:
        logger.error("add_source error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{project_id}/sources/upload")
async def upload_source_file(
    project_id: str,
    file: UploadFile = File(...),
) -> dict:
    try:
        raw = await file.read()
        content = raw.decode("utf-8", errors="replace")
        filename = file.filename or "document.txt"
        return db.add_source(project_id, filename, None, content, "file")
    except Exception as exc:
        logger.error("upload_source_file error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/{project_id}/sources/{source_id}")
def delete_source(project_id: str, source_id: str) -> dict:
    try:
        db.delete_source(source_id)
        return {"ok": True}
    except Exception as exc:
        logger.error("delete_source error: {}", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
