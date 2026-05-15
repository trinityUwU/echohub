import os
import threading
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Callable, Dict, Optional

from huggingface_hub import snapshot_download, hf_hub_download
from loguru import logger

from backend.services.hf_service import MODELS_DIR, _model_dir


class DownloadState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETE = "complete"
    CANCELLED = "cancelled"
    ERROR = "error"


@dataclass
class DownloadJob:
    model_id: str
    total_gb: Optional[float]
    state: DownloadState = DownloadState.PENDING
    downloaded_gb: float = 0.0
    error: Optional[str] = None
    _cancel_event: threading.Event = field(default_factory=threading.Event)
    _pause_event: threading.Event = field(default_factory=threading.Event)
    _thread: Optional[threading.Thread] = field(default=None)

    def to_dict(self) -> dict:
        return {
            "model_id": self.model_id,
            "state": self.state,
            "downloaded_gb": round(self.downloaded_gb, 3),
            "total_gb": self.total_gb,
            "progress": round(self.downloaded_gb / self.total_gb, 4) if self.total_gb else None,
            "error": self.error,
        }


# Global job registry
_jobs: Dict[str, DownloadJob] = {}
_lock = threading.Lock()


def _disk_usage_gb(path: Path) -> float:
    if not path.exists():
        return 0.0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) / (1024 ** 3)


def _run_download(job: DownloadJob, revision: str, on_update: Callable, gguf_file: Optional[str] = None) -> None:
    dest = _model_dir(job.model_id)
    dest.mkdir(parents=True, exist_ok=True)
    job.state = DownloadState.RUNNING

    # Progress polling thread
    stop_poll = threading.Event()

    def poll_progress():
        while not stop_poll.is_set():
            job.downloaded_gb = _disk_usage_gb(dest)
            on_update(job)
            stop_poll.wait(1.5)

    poll_thread = threading.Thread(target=poll_progress, daemon=True)
    poll_thread.start()

    hf_token = os.getenv("HF_TOKEN") or None

    try:
        if gguf_file:
            hf_hub_download(
                repo_id=job.model_id,
                filename=gguf_file,
                revision=revision,
                local_dir=str(dest),
                token=hf_token,
            )
        else:
            snapshot_download(
                repo_id=job.model_id,
                revision=revision,
                local_dir=str(dest),
                ignore_patterns=["*.md", "*.txt", "original/*"],
                token=hf_token,
            )

        if job.state == DownloadState.CANCELLED:
            logger.info(f"Download cancelled after completion signal for {job.model_id} — cleaning up")
            import shutil
            shutil.rmtree(dest, ignore_errors=True)
        else:
            job.state = DownloadState.COMPLETE
            job.downloaded_gb = _disk_usage_gb(dest)
            logger.info(f"Download complete: {job.model_id} ({job.downloaded_gb:.2f} GB)")

    except Exception as e:
        if job.state not in (DownloadState.CANCELLED, DownloadState.PAUSED):
            job.state = DownloadState.ERROR
            err_str = str(e)
            # 401 = modèle gated, token manquant ou invalide
            if "401" in err_str or "gated" in err_str.lower() or "access" in err_str.lower():
                job.error = (
                    "Access denied (401) — this model requires accepting the license on HuggingFace. "
                    "Set HF_TOKEN in your .env file with a token that has access to this model."
                )
            else:
                job.error = err_str
            logger.error(f"Download error for {job.model_id}: {job.error}")
    finally:
        stop_poll.set()
        poll_thread.join(timeout=3)
        on_update(job)


def start_download(
    model_id: str,
    revision: str = "main",
    total_gb: Optional[float] = None,
    gguf_file: Optional[str] = None,
) -> DownloadJob:
    with _lock:
        existing = _jobs.get(model_id)
        if existing and existing.state in (DownloadState.RUNNING, DownloadState.PENDING):
            return existing

        job = DownloadJob(model_id=model_id, total_gb=total_gb)
        _jobs[model_id] = job

    def on_update(j: DownloadJob):
        pass  # SSE endpoint polls _jobs directly

    thread = threading.Thread(
        target=_run_download,
        args=(job, revision, on_update),
        kwargs={"gguf_file": gguf_file},
        daemon=True,
        name=f"dl-{model_id}",
    )
    job._thread = thread
    thread.start()
    logger.info(f"Download started: {model_id}")
    return job


def cancel_download(model_id: str) -> bool:
    with _lock:
        job = _jobs.get(model_id)
    if not job or job.state not in (DownloadState.RUNNING, DownloadState.PAUSED, DownloadState.PENDING):
        return False

    job.state = DownloadState.CANCELLED
    logger.info(f"Download cancelled: {model_id}")

    # Clean up partial files
    import shutil
    dest = _model_dir(model_id)
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
        logger.info(f"Partial files removed: {dest}")

    with _lock:
        _jobs.pop(model_id, None)
    return True


def get_job(model_id: str) -> Optional[DownloadJob]:
    return _jobs.get(model_id)


def get_all_jobs() -> list[dict]:
    with _lock:
        return [j.to_dict() for j in _jobs.values()]
