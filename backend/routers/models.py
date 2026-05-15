import asyncio
import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from loguru import logger

from backend.models.schemas import DownloadRequest, ModelInfo
from backend.services import hf_service
from backend.services.hf_service import _get_hf_token
from huggingface_hub import model_info as hf_model_info
from backend.services import download_manager
from backend.services.download_manager import DownloadState

router = APIRouter(prefix="/models", tags=["models"])


@router.get("/search", response_model=list[ModelInfo])
def search_models(
    q: str = Query(..., min_length=1),
    filters: Optional[str] = Query(None, description="Comma-separated: awq,gptq,gguf"),
    page: int = Query(0, ge=0),
    page_size: int = Query(20, ge=5, le=50),
) -> list[ModelInfo]:
    filter_list = [f.strip() for f in filters.split(",")] if filters else None
    try:
        return hf_service.search_models(q, filter_list, page=page, page_size=page_size)
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/downloaded", response_model=list[ModelInfo])
def list_downloaded() -> list[ModelInfo]:
    try:
        return hf_service.list_downloaded()
    except Exception as e:
        logger.error(f"list_downloaded failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/info/{model_id:path}", response_model=ModelInfo)
def get_model_info(model_id: str) -> ModelInfo:
    try:
        return hf_service.get_model_info(model_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/download")
def start_download(req: DownloadRequest) -> dict:
    """Start a download job. Returns immediately — poll /downloads for progress."""
    existing = download_manager.get_job(req.model_id)
    if existing and existing.state == DownloadState.RUNNING:
        return {"status": "already_running", "model_id": req.model_id}

    # Calculer la taille exacte — fichier GGUF spécifique ou somme des poids
    total_gb: Optional[float] = None
    try:
        info = hf_service._api.model_info(req.model_id, files_metadata=True)
        if info.siblings:
            if req.gguf_file:
                # Taille du fichier GGUF sélectionné uniquement
                for s in info.siblings:
                    if s.rfilename == req.gguf_file:
                        size = getattr(s, "size", 0) or 0
                        if size:
                            total_gb = round(size / (1024 ** 3), 2)
                        break
            else:
                # Snapshot complet — sommer les poids
                total_bytes = sum(
                    getattr(s, "size", 0) or 0
                    for s in info.siblings
                    if s.rfilename.endswith((".safetensors", ".bin", ".pt", ".gguf"))
                )
                if total_bytes:
                    total_gb = round(total_bytes / (1024 ** 3), 2)
    except Exception:
        pass

    download_manager.start_download(req.model_id, req.revision, total_gb, gguf_file=req.gguf_file)
    return {"status": "started", "model_id": req.model_id}


@router.delete("/download/{model_id:path}")
def cancel_download(model_id: str) -> dict:
    """Cancel and delete partial download."""
    ok = download_manager.cancel_download(model_id)
    if not ok:
        raise HTTPException(status_code=404, detail="No active download for this model")
    return {"status": "cancelled", "model_id": model_id}


@router.delete("/downloaded/{model_id:path}")
def delete_model(model_id: str) -> dict:
    """Permanently delete a downloaded model from disk."""
    import shutil
    dest = hf_service._model_dir(model_id)
    if not dest.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {model_id}")
    try:
        shutil.rmtree(dest)
        logger.info(f"Deleted model: {model_id} ({dest})")
        return {"status": "deleted", "model_id": model_id}
    except Exception as e:
        logger.error(f"delete_model failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/downloads")
def list_downloads() -> list[dict]:
    """Return all active/recent download jobs."""
    return download_manager.get_all_jobs()


@router.post("/check-access")
def check_access(req: dict) -> dict:
    """Vérifie si model_id est accessible avec le token actuel."""
    model_id: str = req.get("model_id", "")
    try:
        info = hf_model_info(model_id, token=_get_hf_token())
        return {"accessible": True, "gated": bool(getattr(info, "gated", False))}
    except Exception as e:
        err = str(e)
        if "401" in err or "403" in err:
            return {
                "accessible": False,
                "gated": True,
                "reason": "token_required",
                "hf_url": f"https://huggingface.co/{model_id}",
            }
        if "404" in err:
            return {"accessible": False, "gated": False, "reason": "not_found"}
        return {"accessible": False, "gated": False, "reason": err}


@router.get("/downloads/stream")
async def stream_downloads() -> StreamingResponse:
    """SSE stream of download progress. Client subscribes once, receives updates every second."""

    async def event_stream():
        try:
            while True:
                jobs = download_manager.get_all_jobs()
                payload = json.dumps(jobs)
                yield f"data: {payload}\n\n"
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(event_stream(), media_type="text/event-stream")
