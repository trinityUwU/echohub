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
