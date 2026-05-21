from __future__ import annotations

import os
import threading
from pathlib import Path

from loguru import logger

# nomic-embed-text-v1.5 GGUF — 137MB, multilingual, CPU-only
_EMBED_REPO = "nomic-ai/nomic-embed-text-v1.5-GGUF"
_EMBED_FILENAME = "nomic-embed-text-v1.5.Q4_K_M.gguf"
_EMBED_DIR = Path(os.getenv("MODELS_DIR", "/mnt/models/echohub")) / "_embeddings"
_EMBED_PATH = _EMBED_DIR / _EMBED_FILENAME

from backend.services.llama_lock import get_lock as _get_llama_lock
_lock = _get_llama_lock()
_model = None  # lazy init


def _ensure_model() -> Path:
    if _EMBED_PATH.exists():
        return _EMBED_PATH
    _EMBED_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("Downloading embedding model {} ...", _EMBED_FILENAME)
    from huggingface_hub import hf_hub_download
    hf_hub_download(
        repo_id=_EMBED_REPO,
        filename=_EMBED_FILENAME,
        local_dir=str(_EMBED_DIR),
    )
    logger.info("Embedding model downloaded → {}", _EMBED_PATH)
    return _EMBED_PATH


def _get_model():
    global _model
    if _model is not None:
        return _model
    from llama_cpp import Llama
    path = _ensure_model()
    logger.info("Loading embedding model (CPU) ...")
    _model = Llama(
        model_path=str(path),
        embedding=True,
        n_gpu_layers=0,
        n_ctx=512,
        n_batch=512,
        verbose=False,
    )
    logger.info("Embedding model ready")
    return _model


def encode(text: str) -> list[float]:
    with _lock:
        model = _get_model()
        result = model.create_embedding(text)
    return result["data"][0]["embedding"]


def encode_batch(texts: list[str]) -> list[list[float]]:
    with _lock:
        model = _get_model()
        results = [model.create_embedding(t)["data"][0]["embedding"] for t in texts]
    return results


def is_ready() -> bool:
    return _EMBED_PATH.exists()


def unload() -> None:
    global _model
    with _lock:
        _model = None
